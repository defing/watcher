# eth-event-watcher

Monitor the ERC20 token balance of an address and automatically transfer any detected balance to a destination account. Built with TypeScript and ethers v6.

## Features

- Polls an ERC20 `balanceOf` for a configured address.
- Uses a private key to sign transfers when a positive balance is detected.
- Uses `dotenv` to manage secrets.

## Prerequisites

- Node.js 18 or newer.
- npm (bundled with Node.js).
- An Ethereum JSON-RPC endpoint (Infura, Alchemy, etc).
- A funded Ethereum account with permission to transfer the monitored tokens.

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
| `PRIVATE_KEY` | Private key that signs transactions (keep it secret). |
| `TOKEN_ADDRESS` | ERC20 token contract to monitor. |
| `MONITOR_ADDRESS` | Address whose balance should trigger a transfer (defaults to the signer). |
| `DESTINATION_ADDRESS` | Address receiving the transferred tokens. |
| `POLL_INTERVAL_MS` | Optional polling frequency in milliseconds (default 15000). |

## Running

Compile TypeScript and start the watcher with ts-node:

```fish
npm run start
```

To emit more verbose logs run with `DEBUG=ethers:*`.

## Notes

- The watcher transfers the entire detected balance in one transaction.
- Ensure the signer has enough ETH to pay gas.
- Consider rate limits on your RPC provider when lowering the polling interval.
