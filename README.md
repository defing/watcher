# liquidity-watcher

Watch an IERC4626-compatible vault for withdrawable assets and automatically call `withdraw` when funds are available. Built with TypeScript and ethers v6.

## Features

- Polls `maxWithdraw` on an IERC4626 vault for a configured owner.
- Prompts for the private key on startup and signs withdrawals on your behalf.
- Streams structured logs to both stdout and a configurable log file.
- Uses `dotenv` for the remaining configuration values.

## Prerequisites

- Node.js 18 or newer.
- npm (bundled with Node.js).
- An Ethereum JSON-RPC endpoint (Infura, Alchemy, etc).
- A funded Ethereum account with permission to withdraw from the vault and enough ETH for gas.

## Setup

1. Install dependencies:

```fish
cd eth-event-watcher
npm install
```

2. Copy `.env.example` to `.env` and fill in your values:

```fish
cp .env.example .env
```

| Variable | Description |
| --- | --- |
| `RPC_URL` | Ethereum RPC URL. |
| `CHAIN_ID` | Numeric chain id (e.g. `1` for mainnet, `9745` for Plusma). |
| `TOKEN_ADDRESS` | IERC4626 vault contract to monitor. |
| `MONITOR_ADDRESS` | Address whose withdrawable balance should be swept (defaults to the signer). |
| `DESTINATION_ADDRESS` | Address receiving the withdrawn assets. |
| `POLL_INTERVAL_MS` | Optional polling frequency in milliseconds (default `15000`). |
| `LOG_FILE` | Optional path for log output (default `watcher.log`). |

## Running

Compile TypeScript and start the watcher with ts-node:

```fish
npm run start
```

Enter the private key when prompted. To emit more verbose logs run with `DEBUG=ethers:*`.

## Notes

- The watcher withdraws the full amount reported by `maxWithdraw` in one call.
- Ensure the signer has enough ETH to pay gas.
- Consider rate limits on your RPC provider when lowering the polling interval.
