/**
 * Battle Routes
 * Wallet vs Wallet Battle Arena API
 */

const express = require('express');
const router = express.Router();
const { getAllWalletData } = require('../services/nansen');
const { runBattle } = require('../services/scoring');
const { battleRateLimit } = require('../services/rate-limit');

const USE_MOCK = process.env.USE_MOCK !== 'false';

// In-memory battle storage
const battles = new Map();

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function validateAddress(address) {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * POST /api/battle — Start a new battle
 * Body: { wallet_a: "0x...", wallet_b: "0x...", chain?: "base" }
 */
router.post('/', battleRateLimit, async (req, res) => {
  const { wallet_a, wallet_b, chain = 'base' } = req.body;

  if (!wallet_a || !wallet_b) {
    return res.status(400).json({ error: 'Both wallet_a and wallet_b are required' });
  }
  if (!validateAddress(wallet_a) || !validateAddress(wallet_b)) {
    return res.status(400).json({ error: 'Invalid address format', expected: '0x followed by 40 hex chars' });
  }
  if (wallet_a.toLowerCase() === wallet_b.toLowerCase()) {
    return res.status(400).json({ error: 'Cannot battle the same wallet against itself' });
  }

  try {
    // Fetch all data for both wallets in parallel
    const [dataA, dataB] = await Promise.all([
      getAllWalletData(wallet_a, chain, USE_MOCK),
      getAllWalletData(wallet_b, chain, USE_MOCK)
    ]);

    // Run battle
    const result = runBattle(dataA, dataB);
    const id = generateId();

    // Store battle
    battles.set(id, { id, chain, ...result });

    // Keep max 1000 battles in memory
    if (battles.size > 1000) {
      const oldest = battles.keys().next().value;
      battles.delete(oldest);
    }

    res.json({ id, url: `/battle/${id}`, ...result });
  } catch (error) {
    res.status(500).json({ error: 'Battle failed', message: error.message });
  }
});

/**
 * GET /api/battle/:id — Get battle result
 */
router.get('/:id', (req, res) => {
  const battle = battles.get(req.params.id);
  if (!battle) {
    return res.status(404).json({ error: 'Battle not found' });
  }
  res.json(battle);
});

/**
 * GET /api/battle/recent — Get recent battles
 */
router.get('/recent/list', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
  const recent = Array.from(battles.values())
    .reverse()
    .slice(0, limit)
    .map(b => ({
      id: b.id,
      walletA: b.walletA.address,
      walletB: b.walletB.address,
      winner: b.winner,
      timestamp: b.timestamp
    }));
  res.json(recent);
});

// Export battles map for use in other modules (OG image, etc.)
module.exports = router;
module.exports.battles = battles;
