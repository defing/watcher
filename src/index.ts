import { config } from "dotenv";
import { Contract, JsonRpcProvider, Wallet, formatUnits } from "ethers";
import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

config();

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
  monitorAddress?: string;
  destinationAddress: string;
  pollIntervalMs?: number;
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

  constructor(config: EventWatcherConfig) {
    this.validateConfig(config);

    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.wallet = new Wallet(config.privateKey, this.provider);
    this.monitorAddress = (config.monitorAddress ?? this.wallet.address).toLowerCase();
    this.destinationAddress = config.destinationAddress;
    this.pollIntervalMs = config.pollIntervalMs ?? 15000;

  this.token = new Contract(config.tokenAddress, IERC4626_ABI, this.provider);
    this.tokenWithSigner = this.token.connect(this.wallet) as Contract;
  }

  private validateConfig(config: EventWatcherConfig): void {
    if (!config.rpcUrl) {
      throw new Error("RPC_URL is required");
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
        console.warn("Falling back to generic token symbol", error);
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

        console.log(
          `Detected ${formattedAssets} ${this.cachedSymbol ?? "assets"} withdrawable for ${this.monitorAddress}. Initiating vault withdraw...`
        );

        const tx = await this.tokenWithSigner.withdraw(
          withdrawableAssets,
          this.destinationAddress,
          this.monitorAddress
        );
        console.log(`Submitted withdraw tx ${tx.hash}`);

        const receipt = await tx.wait();
        console.log(`Withdraw confirmed in block ${receipt.blockNumber}`);
      } else {
        console.log(`No withdrawable assets for ${this.monitorAddress}, skipping action.`);
      }
    } catch (error) {
      console.error("Error while checking balance or submitting transaction", error);
    } finally {
      this.isProcessing = false;
    }
  }

  public async start(): Promise<void> {
    console.log(`Monitoring ${this.token.target} for ${this.monitorAddress}`);

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
      console.log("Event watcher stopped");
    }
  }
}

async function main(): Promise<void> {
  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    throw new Error("RPC_URL is required");
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
    monitorAddress: process.env.MONITOR_ADDRESS,
    destinationAddress,
    pollIntervalMs
  });

  await watcher.start();
}

void main().catch((error) => {
  console.error("Fatal error in watcher", error);
  process.exit(1);
});
