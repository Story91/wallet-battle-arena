# Wallet Due Intelligence

Unified wallet due diligence API with MCP tools and x402 payments. Built for AI agents to query wallet data on Base and other chains.

## Features

- **REST API** - HTTP endpoints for wallet data
- **MCP Server** - Tools for AI agents (Claude, Cody, etc.)
- **x402 Payments** - USDC on Base, pay-per-query
- **Nansen CLI** - Powered by Nansen's onchain data

## Pricing

| Endpoint | Price |
|----------|-------|
| Full profile | $0.05 USDC |
| PnL summary | $0.05 USDC |
| Transactions | $0.05 USDC |
| Counterparties | $0.05 USDC |
| Tokens | $0.01 USDC |

## Quick Start

```bash
cd wallet-due-intelligence
npm install
npm start
```

Server: http://localhost:3000

## REST API

### Endpoints

```
GET /api/wallet/:address           # Full profile
GET /api/wallet/:address/summary    # PnL summary
GET /api/wallet/:address/transactions
GET /api/wallet/:address/counterparties
GET /api/wallet/:address/tokens
```

### Example

```bash
# Without payment (returns 402)
curl http://localhost:3000/api/wallet/0x742d35Cc6634C0532925a3b844Bc9e7595f0eB1D

# With payment header
curl -H "X-Payment: USDC:0xRECEIPIENT:50000" \
  http://localhost:3000/api/wallet/0x742d35Cc6634C0532925a3b844Bc9e7595f0eB1D
```

## MCP Server

Run as MCP server for AI agent integration:

```bash
npm run mcp
```

### Available Tools

- `wallet_profile` - Full wallet data
- `wallet_pnl_summary` - PnL only
- `wallet_transactions` - Recent txs
- `wallet_counterparties` - Who they interact with
- `wallet_tokens` - Token holdings

## Configuration

Create `.env` file:

```env
PORT=3000
NODE_ENV=development
USE_MOCK=true
PAYMENT_ADDRESS=0x...
```

## Supported Chains

- base (default)
- ethereum
- solana
- arbitrum
- optimism

## Built with

- [Nansen](https://nansen.ai) - Onchain data
- [x402](https://x402.org) - Payment protocol
