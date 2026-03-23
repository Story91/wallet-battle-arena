/**
 * Wallet Battle Arena — Unified Server
 *
 * MCP tools for AI agents + REST API + x402 payments + Battle Arena
 *
 * Usage:
 *   npm start           - REST API server + Battle Arena
 *   npm run mcp         - MCP stdio server
 */

const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

// Import routes and services
const walletRoutes = require('./routes/wallet');
const battleRoutes = require('./routes/battle');
const { battles } = require('./routes/battle');
const { requirePayment } = require('./services/payment');
const { generateOgImage } = require('./services/og-image');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Battle Arena Routes (no payment required)
app.use('/api/battle', battleRoutes);

// Battle page (serve battle.html for /battle/:id)
app.get('/battle/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'battle.html'));
});

// OG Image endpoint
app.get('/api/battle/:id/og', async (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) {
    return res.status(404).json({ error: 'Battle not found' });
  }
  try {
    const png = await generateOgImage(battle);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(png));
  } catch (error) {
    console.error('OG image error:', error.message);
    res.status(500).json({ error: 'Failed to generate image' });
  }
});

// Wallet API Routes (with payment)
app.use('/api/wallet', walletRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'wallet-battle-arena',
    version: '2.0.0',
    features: {
      battle: true,
      mcp: true,
      x402: true,
      ogImages: true
    }
  });
});

// Pricing info
app.get('/pricing', (req, res) => {
  res.json({
    endpoints: {
      'POST /api/battle': { price: 'free', description: 'Start a wallet battle' },
      'GET /api/battle/:id': { price: 'free', description: 'Get battle result' },
      'GET /api/battle/:id/og': { price: 'free', description: 'OG image for social sharing' },
      'GET /api/wallet/:address': { price: '$0.05', tier: 'advanced', description: 'Full profile' },
      'GET /api/wallet/:address/summary': { price: '$0.05', tier: 'advanced', description: 'PnL summary' },
      'GET /api/wallet/:address/transactions': { price: '$0.05', tier: 'advanced', description: 'Recent transactions' },
      'GET /api/wallet/:address/counterparties': { price: '$0.05', tier: 'advanced', description: 'Who they interact with' },
      'GET /api/wallet/:address/tokens': { price: '$0.01', tier: 'basic', description: 'Token holdings' },
      'GET /api/wallet/:address/trades': { price: '$0.05', tier: 'advanced', description: 'Recent trades' },
      'GET /api/wallet/:address/dex-interactions': { price: '$0.05', tier: 'advanced', description: 'DEX swaps, LP' },
      'GET /api/wallet/:address/nfts': { price: '$0.01', tier: 'basic', description: 'NFT holdings' }
    },
    currency: 'USDC',
    chain: 'base',
    paymentHeader: 'X-Payment',
    format: 'USDC:<recipient>:<amount_wei>'
  });
});

// MCP Server mode (stdio)
const startMCP = () => {
  const readline = require('readline');
  const { nansen } = require('./services/nansen');
  const { runBattle } = require('./services/scoring');

  const USE_MOCK = process.env.USE_MOCK !== 'false';

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  const send = (msg) => console.log(JSON.stringify(msg));

  send({
    jsonrpc: '2.0',
    id: null,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'wallet-battle-arena', version: '2.0.0' }
    }
  });

  rl.on('line', async (line) => {
    try {
      const msg = JSON.parse(line);

      if (msg.method === 'tools/list') {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            tools: [
              {
                name: 'wallet_battle',
                description: 'Battle two wallets! Compares onchain activity and generates RPG-style stats (ATK, DEF, INT, SPD, CHA, LCK), levels, titles, and a winner. Returns shareable battle card URL.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    wallet_a: { type: 'string', description: 'First wallet address (0x...)' },
                    wallet_b: { type: 'string', description: 'Second wallet address (0x...)' },
                    chain: { type: 'string', default: 'base', enum: ['base', 'ethereum', 'solana', 'arbitrum', 'optimism'] }
                  },
                  required: ['wallet_a', 'wallet_b']
                }
              },
              {
                name: 'wallet_profile',
                description: 'Get full wallet profile (balance, labels, PnL, transactions)',
                inputSchema: {
                  type: 'object',
                  properties: {
                    address: { type: 'string', description: 'Wallet address (0x...)' },
                    chain: { type: 'string', default: 'base', enum: ['base', 'ethereum', 'solana', 'arbitrum', 'optimism'] }
                  },
                  required: ['address']
                }
              },
              {
                name: 'wallet_pnl_summary',
                description: 'Get PnL summary for a wallet',
                inputSchema: {
                  type: 'object',
                  properties: {
                    address: { type: 'string', description: 'Wallet address (0x...)' },
                    chain: { type: 'string', default: 'base' }
                  },
                  required: ['address']
                }
              },
              {
                name: 'wallet_transactions',
                description: 'Get recent transactions for a wallet',
                inputSchema: {
                  type: 'object',
                  properties: {
                    address: { type: 'string', description: 'Wallet address (0x...)' },
                    chain: { type: 'string', default: 'base' },
                    limit: { type: 'number', default: 20 }
                  },
                  required: ['address']
                }
              },
              {
                name: 'wallet_counterparties',
                description: 'Get who a wallet interacts with',
                inputSchema: {
                  type: 'object',
                  properties: {
                    address: { type: 'string', description: 'Wallet address (0x...)' },
                    chain: { type: 'string', default: 'base' }
                  },
                  required: ['address']
                }
              },
              {
                name: 'wallet_tokens',
                description: 'Get token holdings for a wallet',
                inputSchema: {
                  type: 'object',
                  properties: {
                    address: { type: 'string', description: 'Wallet address (0x...)' },
                    chain: { type: 'string', default: 'base' }
                  },
                  required: ['address']
                }
              }
            ]
          }
        });
      }

      else if (msg.method === 'tools/call') {
        const toolName = msg.params.name;
        const args = msg.params.arguments || {};

        let result;

        if (toolName === 'wallet_battle') {
          const { wallet_a, wallet_b, chain = 'base' } = args;
          const { getAllWalletData } = nansen;
          const [dataA, dataB] = await Promise.all([
            getAllWalletData(wallet_a, chain, USE_MOCK),
            getAllWalletData(wallet_b, chain, USE_MOCK)
          ]);
          result = runBattle(dataA, dataB);
          result.tip = 'Share this battle at /battle/:id on the web UI!';
        } else {
          const { address, chain = 'base', limit = 20 } = args;
          switch (toolName) {
            case 'wallet_profile':
              result = await nansen.getWalletData('profile', address, chain, USE_MOCK);
              result.balance = await nansen.getWalletData('balance', address, chain, USE_MOCK);
              result.pnlSummary = await nansen.getWalletData('pnl-summary', address, chain, USE_MOCK);
              break;
            case 'wallet_pnl_summary':
              result = await nansen.getWalletData('pnl-summary', address, chain, USE_MOCK);
              break;
            case 'wallet_transactions':
              result = await nansen.getWalletData('transactions', address, chain, USE_MOCK);
              result = result.slice(0, limit);
              break;
            case 'wallet_counterparties':
              result = await nansen.getWalletData('counterparties', address, chain, USE_MOCK);
              break;
            case 'wallet_tokens':
              result = await nansen.getWalletData('tokens', address, chain, USE_MOCK);
              break;
            default:
              result = { error: 'Unknown tool' };
          }
        }

        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
          }
        });
      }
    } catch (e) {
      console.error('MCP Error:', e.message);
    }
  });
};

// CLI
const args = process.argv.slice(2);
if (args.includes('--mcp')) {
  startMCP();
} else if (!process.env.VERCEL) {
  // Only listen when running locally (not on Vercel serverless)
  app.listen(PORT, () => {
    console.log(`⚔️  Wallet Battle Arena running on http://localhost:${PORT}`);
    console.log(`   Battle:  http://localhost:${PORT}`);
    console.log(`   API:     http://localhost:${PORT}/api/battle`);
    console.log(`   Health:  http://localhost:${PORT}/health`);
    console.log(`   MCP:     npm run mcp`);
  });
}

// Export for Vercel serverless
module.exports = app;
