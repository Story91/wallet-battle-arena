/**
 * Wallet Routes
 * REST API endpoints for wallet due diligence
 */

const express = require('express');
const router = express.Router();
const { requirePayment, getPrice } = require('../services/payment');
const { getWalletData } = require('../services/nansen');

const USE_MOCK = process.env.USE_MOCK !== 'false';

function validateAddress(req, res, next) {
  const { address } = req.params;
  if (!address) {
    return res.status(400).json({ error: 'Address is required' });
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    return res.status(400).json({ error: 'Invalid address format', expected: '0x followed by 40 hex chars' });
  }
  next();
}

/**
 * GET /api/wallet/:address - Full profile
 */
router.get('/:address', validateAddress, requirePayment, async (req, res) => {
  const { address } = req.params;
  const chain = req.query.chain || 'base';
  
  try {
    const [balance, profile, pnlSummary, transactions, counterparties] = await Promise.all([
      getWalletData('balance', address, chain, USE_MOCK),
      getWalletData('profile', address, chain, USE_MOCK),
      getWalletData('pnl-summary', address, chain, USE_MOCK),
      getWalletData('transactions', address, chain, USE_MOCK),
      getWalletData('counterparties', address, chain, USE_MOCK)
    ]);
    
    res.json({
      address, chain, price: getPrice('advanced'),
      data: { balance, profile, pnlSummary, transactions: transactions.slice(0, 10), counterparties: counterparties.slice(0, 10) }
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch wallet', message: error.message });
  }
});

/**
 * GET /api/wallet/:address/summary - PnL summary
 */
router.get('/:address/summary', validateAddress, requirePayment, async (req, res) => {
  const { address } = req.params;
  const chain = req.query.chain || 'base';
  
  try {
    const [pnlSummary, profile] = await Promise.all([
      getWalletData('pnl-summary', address, chain, USE_MOCK),
      getWalletData('profile', address, chain, USE_MOCK)
    ]);
    
    res.json({ address, chain, price: getPrice('advanced'), data: { pnlSummary, profile: { labels: profile.labels || [], txCount: profile.txCount || 0 } } });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch summary', message: error.message });
  }
});

/**
 * GET /api/wallet/:address/transactions
 */
router.get('/:address/transactions', validateAddress, requirePayment, async (req, res) => {
  const { address } = req.params;
  const chain = req.query.chain || 'base';
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  
  try {
    const transactions = await getWalletData('transactions', address, chain, USE_MOCK);
    res.json({ address, chain, price: getPrice('advanced'), count: transactions.length, data: transactions.slice(0, limit) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch transactions', message: error.message });
  }
});

/**
 * GET /api/wallet/:address/counterparties
 */
router.get('/:address/counterparties', validateAddress, requirePayment, async (req, res) => {
  const { address } = req.params;
  const chain = req.query.chain || 'base';
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  
  try {
    const counterparties = await getWalletData('counterparties', address, chain, USE_MOCK);
    res.json({ address, chain, price: getPrice('advanced'), count: counterparties.length, data: counterparties.slice(0, limit) });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch counterparties', message: error.message });
  }
});

/**
 * GET /api/wallet/:address/tokens
 */
router.get('/:address/tokens', validateAddress, requirePayment, async (req, res) => {
  const { address } = req.params;
  const chain = req.query.chain || 'base';
  
  try {
    const tokens = await getWalletData('tokens', address, chain, USE_MOCK);
    const totalValue = tokens.reduce((sum, t) => sum + parseFloat(t.valueUsd || t.value || '0'), 0);
    res.json({ address, chain, price: getPrice('basic'), totalValueUsd: totalValue.toFixed(2), count: tokens.length, data: tokens });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch tokens', message: error.message });
  }
});

/**
 * GET /api/wallet/:address/trades - Recent trades with PnL per trade
 */
router.get('/:address/trades', validateAddress, requirePayment, async (req, res) => {
  const { address } = req.params;
  const chain = req.query.chain || 'base';
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  
  try {
    const trades = await getWalletData('trades', address, chain, USE_MOCK);
    
    // Calculate total PnL
    const totalPnl = trades.reduce((sum, t) => sum + parseFloat(t.pnl || '0'), 0);
    const winningTrades = trades.filter(t => parseFloat(t.pnl || '0') > 0).length;
    
    res.json({ 
      address, 
      chain, 
      price: getPrice('advanced'), 
      summary: {
        totalTrades: trades.length,
        totalPnlUsd: totalPnl.toFixed(2),
        winningTrades,
        winRate: trades.length > 0 ? ((winningTrades / trades.length) * 100).toFixed(1) + '%' : '0%'
      },
      count: trades.length, 
      data: trades.slice(0, limit) 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch trades', message: error.message });
  }
});

/**
 * GET /api/wallet/:address/dex-interactions - DEX swaps and LP positions
 */
router.get('/:address/dex-interactions', validateAddress, requirePayment, async (req, res) => {
  const { address } = req.params;
  const chain = req.query.chain || 'base';
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  
  try {
    const interactions = await getWalletData('dex-interactions', address, chain, USE_MOCK);
    
    // Group by type
    const swaps = interactions.filter(i => i.type === 'swap');
    const lpActions = interactions.filter(i => i.type === 'addLiquidity' || i.type === 'removeLiquidity');
    
    // Group by DEX
    const byDex = {};
    interactions.forEach(i => {
      byDex[i.dex] = byDex[i.dex] ? byDex[i.dex] + 1 : 1;
    });
    
    res.json({ 
      address, 
      chain, 
      price: getPrice('advanced'), 
      summary: {
        totalInteractions: interactions.length,
        totalSwaps: swaps.length,
        totalLpActions: lpActions.length,
        dexBreakdown: byDex
      },
      count: interactions.length, 
      data: interactions.slice(0, limit) 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch DEX interactions', message: error.message });
  }
});

/**
 * GET /api/wallet/:address/nfts - NFT holdings
 */
router.get('/:address/nfts', validateAddress, requirePayment, async (req, res) => {
  const { address } = req.params;
  const chain = req.query.chain || 'base';
  
  try {
    const nfts = await getWalletData('nfts', address, chain, USE_MOCK);
    
    // Calculate total value and group by collection
    const totalValue = nfts.reduce((sum, n) => sum + parseFloat(n.valueUsd || '0'), 0);
    const byCollection = {};
    nfts.forEach(n => {
      if (!byCollection[n.collection]) {
        byCollection[n.collection] = { count: 0, totalValue: 0, items: [] };
      }
      byCollection[n.collection].count++;
      byCollection[n.collection].totalValue += parseFloat(n.valueUsd || '0');
      byCollection[n.collection].items.push(n);
    });
    
    res.json({ 
      address, 
      chain, 
      price: getPrice('basic'), 
      totalValueUsd: totalValue.toFixed(2),
      collectionCount: Object.keys(byCollection).length,
      collections: byCollection,
      count: nfts.length, 
      data: nfts 
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch NFTs', message: error.message });
  }
});

module.exports = router;
