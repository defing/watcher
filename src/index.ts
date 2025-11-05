import { config } from "dotenv";
import { Contract, JsonRpcProvider, Wallet, formatUnits } from "ethers";
import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";
import { format as formatLog } from "node:util";

config();

const LOG_FILE_PATH = process.env.LOG_FILE ?? "watcher.log";
const logStream = createWriteStream(LOG_FILE_PATH, { flags: "a" });

process.once("exit", () => {
  logStream.end();
});

type LogLevel = "INFO" | "ERROR";

function writeLog(stream: WriteStream, level: LogLevel, message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}`;

  if (level === "ERROR") {
    console.error(line);
  } else {
    console.log(line);
  }

  stream.write(`${line}\n`);
}

// Minimal IERC4626 ABI to support balance checks and vault withdrawals.
const IERC4626_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function totalAssets() view returns (uint256)",
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function withdraw(uint256 assets, address receiver, address owner) returns (uint256 shares)",
  "function maxWithdraw(address owner) view returns (uint256 assets)",
];

interface EventWatcherConfig {
  rpcUrl: string;
  privateKey: string;
  tokenAddress: string;
  chainId: number;
  monitorAddress?: string;
  destinationAddress: string;
  pollIntervalMs?: number;
  logStream: WriteStream;
}
async function promptPrivateKey(): Promise<string> {
  const rl = readline.createInterface({ input, output });

  return new Promise((resolve) => {
    rl.question("Enter private key: ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

class EthEventWatcher {
  private provider: JsonRpcProvider;
  private wallet: Wallet;
  private monitorAddress: string;
  private destinationAddress: string;
  private pollIntervalMs: number;
  private token: Contract;
  private tokenWithSigner: Contract;
  private cachedDecimals?: number;
  private cachedSymbol?: string;
  private isProcessing = false;
  private intervalId?: NodeJS.Timeout;
  private logStream: WriteStream;
  private chainId: number;

  constructor(config: EventWatcherConfig) {
    this.validateConfig(config);

    this.chainId = config.chainId;
    this.provider = new JsonRpcProvider(config.rpcUrl, config.chainId);
    this.wallet = new Wallet(config.privateKey, this.provider);
    this.monitorAddress = (config.monitorAddress ?? this.wallet.address).toLowerCase();
    this.destinationAddress = config.destinationAddress;
    this.pollIntervalMs = config.pollIntervalMs ?? 15000;
    this.logStream = config.logStream;

    this.token = new Contract(config.tokenAddress, IERC4626_ABI, this.provider);
    this.tokenWithSigner = this.token.connect(this.wallet) as Contract;
  }

  private validateConfig(config: EventWatcherConfig): void {
    if (!config.rpcUrl) {
      throw new Error("RPC_URL is required");
    }

    if (!Number.isInteger(config.chainId) || config.chainId <= 0) {
      throw new Error("CHAIN_ID must be a positive integer");
    }

    if (!config.privateKey) {
      throw new Error("PRIVATE_KEY is required to sign transactions");
    }

    if (!config.tokenAddress) {
      throw new Error("TOKEN_ADDRESS is required");
    }

    if (!config.destinationAddress) {
      throw new Error("DESTINATION_ADDRESS is required");
    }
  }

  private async ensureTokenMetadata(): Promise<void> {
    if (this.cachedDecimals === undefined) {
      this.cachedDecimals = Number(await this.token.decimals());
    }

    if (this.cachedSymbol === undefined) {
      try {
        this.cachedSymbol = await this.token.symbol();
      } catch (error) {
        this.cachedSymbol = "ERC20";
        this.log("Falling back to generic token symbol: %o", error);
      }
    }
  }

  private async checkBalanceAndAct(): Promise<void> {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      await this.ensureTokenMetadata();
      const withdrawableAssets = (await this.token.maxWithdraw(this.monitorAddress)) as bigint;

      if (withdrawableAssets > 0n) {
        const formattedAssets = this.cachedDecimals !== undefined
          ? formatUnits(withdrawableAssets, this.cachedDecimals)
          : withdrawableAssets.toString();

        this.log(
          "Detected %s %s withdrawable for %s. Initiating vault withdraw...",
          formattedAssets,
          this.cachedSymbol ?? "assets",
          this.monitorAddress
        );

        const tx = await this.tokenWithSigner.withdraw(
          withdrawableAssets,
          this.destinationAddress,
          this.monitorAddress
        );
        this.log("Submitted withdraw tx %s", tx.hash);

        const receipt = await tx.wait();
        this.log("Withdraw confirmed in block %d", receipt.blockNumber);
      } else {
        this.log("No withdrawable assets for %s, skipping action.", this.monitorAddress);
      }
    } catch (error) {
      this.logError("Error while checking balance or submitting transaction", error);
    } finally {
      this.isProcessing = false;
    }
  }

  public async start(): Promise<void> {
    this.log("Monitoring %s for %s on chain %d", this.token.target, this.monitorAddress, this.chainId);

    await this.checkBalanceAndAct();

    // Polling loop ensures predictable cadence even if blocks are slow.
    this.intervalId = setInterval(() => {
      void this.checkBalanceAndAct();
    }, this.pollIntervalMs);
  }

  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
      this.log("Event watcher stopped");
    }
  }

  private log(message: string, ...args: unknown[]): void {
    writeLog(this.logStream, "INFO", formatLog(message, ...args));
  }

  private logError(message: string, error: unknown): void {
    const errorDetails = error instanceof Error
      ? error.stack ?? error.message
      : formatLog("%o", error);

    writeLog(this.logStream, "ERROR", `${message}: ${errorDetails}`);
  }
}

async function main(): Promise<void> {
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    throw new Error("RPC_URL is required");
  }

  const chainIdRaw = process.env.CHAIN_ID;
  if (!chainIdRaw) {
    throw new Error("CHAIN_ID is required");
  }

  const chainId = Number(chainIdRaw);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error("CHAIN_ID must be a positive integer");
  }

  const tokenAddress = process.env.TOKEN_ADDRESS;
  if (!tokenAddress) {
    throw new Error("TOKEN_ADDRESS is required");
  }

  const destinationAddress = process.env.DESTINATION_ADDRESS;
  if (!destinationAddress) {
    throw new Error("DESTINATION_ADDRESS is required");
  }

  const pollIntervalMs = Number(process.env.POLL_INTERVAL_MS ?? "15000");
  const privateKey = await promptPrivateKey();

  if (!privateKey) {
    throw new Error("PRIVATE_KEY input is required to sign transactions");
  }

  const watcher = new EthEventWatcher({
    rpcUrl,
    privateKey,
    tokenAddress,
    chainId,
    monitorAddress: process.env.MONITOR_ADDRESS,
    destinationAddress,
    pollIntervalMs,
    logStream,
  });

  await watcher.start();
}

void main().catch((error) => {
  const errorDetails = error instanceof Error
    ? error.stack ?? error.message
    : formatLog("%o", error);

  writeLog(logStream, "ERROR", `Fatal error in watcher: ${errorDetails}`);
  process.exit(1);
});
