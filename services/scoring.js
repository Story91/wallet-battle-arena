/**
 * Score Engine — converts raw Nansen data into RPG stats (0-100)
 */

function clamp(val, min = 0, max = 100) {
  return Math.max(min, Math.min(max, Math.round(val)));
}

function logScale(value, cap) {
  if (value <= 0) return 0;
  return Math.min(1, Math.log10(value + 1) / Math.log10(cap + 1));
}

/**
 * ATK — Trading Power
 * PnL + win rate + volume
 */
function calcTradingPower(data) {
  const pnl = parseFloat(data.pnlSummary?.totalPnlUsd || '0');
  const pnlScore = logScale(Math.abs(pnl), 100000) * 30;
  const pnlSign = pnl >= 0 ? 1 : 0.5;

  // Prefer real win_rate from Nansen, fallback to trade-level calculation
  let winRate = parseFloat(data.pnlSummary?.winRate || 0);
  if (!winRate) {
    const trades = data.trades || [];
    const winning = trades.filter(t => parseFloat(t.pnl || '0') > 0).length;
    winRate = trades.length > 0 ? winning / trades.length : 0;
  }
  const winRateScore = winRate * 30;

  // Use traded_times for volume proxy if no totalVolumeUsd
  const tradedTimes = parseInt(data.pnlSummary?.tradedTimes || 0);
  const volume = parseFloat(data.profile?.totalVolumeUsd || '0');
  const volumeScore = volume > 0
    ? logScale(volume, 1000000) * 20
    : logScale(tradedTimes, 500) * 20;

  // Bonus for traded token diversity
  const tradedTokenCount = parseInt(data.pnlSummary?.tradedTokenCount || 0);
  const diversityBonus = Math.min(20, tradedTokenCount * 3);

  return clamp(pnlScore * pnlSign + winRateScore + volumeScore + diversityBonus);
}

/**
 * DEF — Diamond Hands
 * Holding duration + unrealized PnL + patience (low frequency)
 */
function calcDiamondHands(data) {
  const profile = data.profile || {};
  const pnlSummary = data.pnlSummary || {};

  // Account age in days
  const firstSeen = profile.firstSeen ? new Date(profile.firstSeen) : new Date();
  const lastSeen = profile.lastSeen ? new Date(profile.lastSeen) : new Date();
  const accountAgeDays = Math.max(1, (lastSeen - firstSeen) / (1000 * 60 * 60 * 24));

  // Holding duration proxy: account age
  const holdScore = Math.min(50, (accountAgeDays / 365) * 50);

  // Unrealized PnL positive = holding winners
  const unrealized = parseFloat(pnlSummary.unrealizedPnl || '0');
  const unrealizedScore = unrealized > 0 ? Math.min(25, logScale(unrealized, 10000) * 25) : 0;

  // Patience: low tx frequency = diamond hands
  const txCount = parseInt(profile.txCount || '0');
  const txPerDay = txCount / Math.max(1, accountAgeDays);
  const patienceScore = txPerDay < 1 ? 25 : txPerDay < 5 ? 15 : txPerDay < 20 ? 8 : 0;

  return clamp(holdScore + unrealizedScore + patienceScore);
}

/**
 * INT — Diversity
 * Unique tokens + DEXs + counterparties
 */
function calcDiversity(data) {
  const tokens = data.tokens || [];
  const tokenScore = Math.min(35, tokens.length * 3);

  const dexInteractions = data.dexInteractions || [];
  const uniqueDexes = new Set(dexInteractions.map(i => i.dex)).size;
  const dexScore = Math.min(35, uniqueDexes * 10);

  const counterparties = data.counterparties || [];
  const cpScore = logScale(counterparties.length, 200) * 30;

  return clamp(tokenScore + dexScore + cpScore);
}

/**
 * SPD — Activity
 * Tx count + recency + last seen freshness
 */
function calcActivity(data) {
  const profile = data.profile || {};
  const txCount = parseInt(profile.txCount || '0');
  const txScore = logScale(txCount, 10000) * 40;

  // Recent transactions bonus
  const transactions = data.transactions || [];
  const now = new Date();
  const recentTx = transactions.filter(t => {
    const txDate = new Date(t.timestamp);
    return (now - txDate) < 7 * 24 * 60 * 60 * 1000; // 7 days
  });
  const recencyScore = Math.min(35, recentTx.length * 8);

  // Last seen freshness
  const lastSeen = profile.lastSeen ? new Date(profile.lastSeen) : new Date(0);
  const daysSinceActive = (now - lastSeen) / (1000 * 60 * 60 * 24);
  const freshnessScore = daysSinceActive < 1 ? 25 : daysSinceActive < 7 ? 18 : daysSinceActive < 30 ? 8 : 0;

  return clamp(txScore + recencyScore + freshnessScore);
}

/**
 * CHA — Network
 * Counterparty count + labeled interactions + diversity
 */
function calcNetwork(data) {
  const counterparties = data.counterparties || [];
  const cpScore = logScale(counterparties.length, 200) * 35;

  // Labeled counterparties (whale, protocol, DEX, etc.)
  const labeled = counterparties.filter(c => c.label && c.label !== 'Unknown');
  const labelScore = Math.min(35, labeled.length * 7);

  // Interaction type diversity
  const dexInteractions = data.dexInteractions || [];
  const types = new Set(dexInteractions.map(i => i.type));
  const diversityScore = Math.min(30, types.size * 10);

  return clamp(cpScore + labelScore + diversityScore);
}

/**
 * LCK — Risk (inverted: higher = safer/luckier)
 * Portfolio concentration + PnL stability + no rug exposure
 */
function calcRisk(data) {
  const tokens = data.tokens || [];

  // Portfolio concentration — less concentrated = better
  const totalValue = tokens.reduce((s, t) => s + parseFloat(t.valueUsd || t.value || '0'), 0);
  let concentrationScore = 20;
  if (totalValue > 0 && tokens.length > 0) {
    const maxTokenValue = Math.max(...tokens.map(t => parseFloat(t.valueUsd || t.value || '0')));
    const topPercent = maxTokenValue / totalValue;
    concentrationScore = clamp((1 - topPercent) * 35, 0, 35);
  }

  // PnL positive = lucky
  const pnlPercent = parseFloat(data.pnlSummary?.pnlPercent || '0');
  const pnlStabilityScore = pnlPercent > 0 ? Math.min(35, pnlPercent * 2) : Math.max(0, 15 + pnlPercent);

  // No rug exposure (check labels for suspicious activity)
  const profile = data.profile || {};
  const labels = (profile.labels || []).map(l => l.toLowerCase());
  const suspicious = labels.some(l => l.includes('scam') || l.includes('rug') || l.includes('exploit'));
  const safetyScore = suspicious ? 0 : 30;

  return clamp(concentrationScore + pnlStabilityScore + safetyScore);
}

/**
 * Calculate all 6 stats for a wallet
 */
function calculateStats(walletData) {
  return {
    atk: calcTradingPower(walletData),
    def: calcDiamondHands(walletData),
    int: calcDiversity(walletData),
    spd: calcActivity(walletData),
    cha: calcNetwork(walletData),
    lck: calcRisk(walletData)
  };
}

/**
 * Calculate level from stats (1-99)
 */
function calculateLevel(stats) {
  const avg = (stats.atk + stats.def + stats.int + stats.spd + stats.cha + stats.lck) / 6;
  return clamp(Math.round(avg * 0.99), 1, 99);
}

/**
 * Calculate total score (sum of all stats)
 */
function calculateTotalScore(stats) {
  return stats.atk + stats.def + stats.int + stats.spd + stats.cha + stats.lck;
}

/**
 * Assign title based on top 2 stats
 */
const TITLES = {
  'atk+spd': 'Degen Warrior',
  'atk+int': 'Strategic Trader',
  'atk+cha': 'Whale Whisperer',
  'atk+def': 'Patient Predator',
  'atk+lck': "Fortune's Blade",
  'def+int': 'Diamond Sage',
  'def+spd': 'Steady Sprinter',
  'def+cha': 'Community Anchor',
  'def+lck': "Fortune's Shield",
  'int+spd': 'DeFi Explorer',
  'int+cha': 'Protocol Diplomat',
  'int+lck': 'Diversified Oracle',
  'spd+cha': 'Social Degen',
  'spd+lck': 'Speed Demon',
  'cha+lck': 'Lucky Networker'
};

function assignTitle(stats) {
  const sorted = Object.entries(stats)
    .sort(([, a], [, b]) => b - a)
    .map(([key]) => key);

  const top2 = [sorted[0], sorted[1]].sort().join('+');
  return TITLES[top2] || 'Onchain Adventurer';
}

/**
 * Assign rarity based on portfolio value
 */
function assignRarity(walletData) {
  const balance = walletData.balance || {};
  const totalValue = parseFloat(balance.totalValueUsd || '0');

  if (totalValue >= 100000) return 'diamond';
  if (totalValue >= 10000) return 'gold';
  if (totalValue >= 1000) return 'silver';
  return 'bronze';
}

/**
 * Run a full battle between two wallets
 */
/**
 * Extract extra info for battle card display
 */
function extractExtras(walletData) {
  // Top 5 tokens
  const tokens = (walletData.tokens || walletData.balance?.tokens || [])
    .sort((a, b) => parseFloat(b.valueUsd || 0) - parseFloat(a.valueUsd || 0))
    .slice(0, 5)
    .map(t => ({ symbol: t.symbol, valueUsd: t.valueUsd || '0' }));

  // ENS name from profile
  const ensName = walletData.profile?.ensName || null;

  // Win rate
  const winRate = parseFloat(walletData.pnlSummary?.winRate || 0);
  const tradedTimes = parseInt(walletData.pnlSummary?.tradedTimes || 0);
  const tradedTokenCount = parseInt(walletData.pnlSummary?.tradedTokenCount || 0);

  // Labels
  const labels = walletData.profile?.labels || [];

  return { tokens, ensName, winRate, tradedTimes, tradedTokenCount, labels };
}

function runBattle(walletA, walletB) {
  const statsA = calculateStats(walletA);
  const statsB = calculateStats(walletB);

  const scoreA = calculateTotalScore(statsA);
  const scoreB = calculateTotalScore(statsB);

  const levelA = calculateLevel(statsA);
  const levelB = calculateLevel(statsB);

  const titleA = assignTitle(statsA);
  const titleB = assignTitle(statsB);

  const rarityA = assignRarity(walletA);
  const rarityB = assignRarity(walletB);

  const extrasA = extractExtras(walletA);
  const extrasB = extractExtras(walletB);

  const diff = Math.abs(scoreA - scoreB);
  let winner;
  if (diff < 5) {
    winner = 'draw';
  } else if (scoreA > scoreB) {
    winner = 'a';
  } else {
    winner = 'b';
  }

  return {
    walletA: {
      address: walletA.address,
      stats: statsA,
      totalScore: scoreA,
      level: levelA,
      title: titleA,
      rarity: rarityA,
      portfolioValue: walletA.balance?.totalValueUsd || '0',
      ...extrasA
    },
    walletB: {
      address: walletB.address,
      stats: statsB,
      totalScore: scoreB,
      level: levelB,
      title: titleB,
      rarity: rarityB,
      portfolioValue: walletB.balance?.totalValueUsd || '0',
      ...extrasB
    },
    winner,
    scoreDiff: diff,
    timestamp: new Date().toISOString()
  };
}

module.exports = {
  calculateStats, calculateLevel, calculateTotalScore,
  assignTitle, assignRarity, runBattle
};
