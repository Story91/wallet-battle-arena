/**
 * Nansen CLI Service
 * Wrapper for Nansen profiler commands
 */

const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const DEFAULT_CHAIN = 'base';

/**
 * Execute nansen CLI command safely (no shell interpolation)
 * Uses 'nansen research profiler' (new API) with fallback to 'nansen profiler' (legacy)
 */
const { exec } = require('child_process');
const execAsync = promisify(exec);

const EXEC_OPTS = {
  encoding: 'utf-8',
  timeout: 30000,
  maxBuffer: 10 * 1024 * 1024
};

// Resolve nansen binary: prefer local node_modules, fallback to global
const path = require('path');
const localNansen = path.join(__dirname, '..', 'node_modules', '.bin', 'nansen');

async function execCommand(args) {
  // Strict validation: only allow safe characters in args
  for (const arg of args) {
    if (!/^[a-zA-Z0-9_\-.:\/x]+$/.test(arg)) {
      throw new Error(`Invalid argument: ${arg}`);
    }
  }

  const safeArgs = args.join(' ');

  // Try: local nansen → npx nansen → global nansen (new API then legacy)
  const commands = [
    `"${localNansen}" research ${safeArgs}`,
    `npx nansen research ${safeArgs}`,
    `nansen research ${safeArgs}`,
    `"${localNansen}" ${safeArgs}`,
    `nansen ${safeArgs}`
  ];

  for (const cmd of commands) {
    try {
      const { stdout } = await execAsync(cmd, EXEC_OPTS);
      try { return JSON.parse(stdout); } catch (e) { return { raw: stdout }; }
    } catch (e) {
      continue;
    }
  }

  throw new Error('Nansen CLI not available or command failed');
}

/**
 * Unwrap Nansen API response: {success, data: {data: [...]}} → normalized
 */
function unwrap(result) {
  if (!result) return result;
  if (result.success === false) throw new Error(result.error || 'Nansen API error');
  if (result.data?.data) return result.data.data;
  if (result.data) return result.data;
  return result;
}

async function getBalance(address, chain = DEFAULT_CHAIN) {
  const raw = await execCommand(['profiler', 'balance', '--address', address, '--chain', chain]);
  const tokens = unwrap(raw);
  // Normalize: Nansen returns array of token objects
  if (Array.isArray(tokens)) {
    const totalValueUsd = tokens.reduce((s, t) => s + (t.value_usd || 0), 0);
    const nativeToken = tokens.find(t => t.token_symbol === 'ETH' && t.token_address?.includes('eeeeee'));
    return {
      address, chain,
      totalValueUsd: totalValueUsd.toFixed(2),
      nativeBalance: nativeToken ? String(nativeToken.token_amount) : '0',
      nativeSymbol: 'ETH',
      tokens: tokens.map(t => ({
        symbol: t.token_symbol,
        name: t.token_name,
        balance: String(t.token_amount || 0),
        valueUsd: (t.value_usd || 0).toFixed(2),
        tokenAddress: t.token_address
      }))
    };
  }
  return { address, chain, totalValueUsd: '0', nativeBalance: '0', nativeSymbol: 'ETH', tokens: [] };
}

async function getAddressProfile(address, chain = DEFAULT_CHAIN) {
  // Labels endpoint may require credits, so wrap in try/catch
  let labels = [];
  try {
    const raw = await execCommand(['profiler', 'labels', '--address', address, '--chain', chain]);
    const data = unwrap(raw);
    if (Array.isArray(data)) labels = data.map(l => l.label || l.name || l).filter(Boolean);
    else if (data?.labels) labels = data.labels;
  } catch (e) {
    // Credits exhausted or not available — continue without labels
  }

  // Get transactions for tx count + first/last seen + ENS name extraction
  let txCount = 0, firstSeen = null, lastSeen = null, totalVolumeUsd = 0, ensName = null;
  try {
    const raw = await execCommand(['profiler', 'transactions', '--address', address, '--chain', chain]);
    const txs = unwrap(raw);
    if (Array.isArray(txs) && txs.length > 0) {
      txCount = txs.length;
      const timestamps = txs.map(t => t.block_timestamp).filter(Boolean).sort();
      firstSeen = timestamps[0] || null;
      lastSeen = timestamps[timestamps.length - 1] || null;
      totalVolumeUsd = txs.reduce((s, t) => s + (t.volume_usd || 0), 0);

      // Extract ENS name from transaction labels (format: "name.eth [0xaddr]")
      const addrLower = address.toLowerCase();
      for (const tx of txs) {
        const allLabels = [
          ...(tx.tokens_received || []).map(t => t.to_address?.toLowerCase() === addrLower ? t.to_address_label : t.from_address_label),
          ...(tx.tokens_sent || []).map(t => t.from_address?.toLowerCase() === addrLower ? t.from_address_label : t.to_address_label)
        ].filter(Boolean);
        for (const lbl of allLabels) {
          const ensMatch = lbl.match(/^(\S+\.eth)\s/);
          if (ensMatch) { ensName = ensMatch[1]; break; }
        }
        if (ensName) break;
      }
    }
  } catch (e) {}

  return {
    address, chain, labels, tags: [], ensName,
    firstSeen: firstSeen ? firstSeen.split('T')[0] : null,
    lastSeen: lastSeen ? lastSeen.split('T')[0] : null,
    txCount,
    totalVolumeUsd: totalVolumeUsd.toFixed(0)
  };
}

async function getPnLSummary(address, chain = DEFAULT_CHAIN) {
  const raw = await execCommand(['profiler', 'pnl-summary', '--address', address, '--chain', chain]);
  const data = raw?.data || raw;
  return {
    address, chain,
    totalPnlUsd: String(data.realized_pnl_usd || 0),
    pnlPercent: String(data.realized_pnl_percent || 0),
    realizedPnl: String(data.realized_pnl_usd || 0),
    unrealizedPnl: '0',
    winRate: data.win_rate || 0,
    tradedTokenCount: data.traded_token_count || 0,
    tradedTimes: data.traded_times || 0
  };
}

async function getTransactions(address, chain = DEFAULT_CHAIN, limit = 20) {
  const raw = await execCommand(['profiler', 'transactions', '--address', address, '--chain', chain]);
  const txs = unwrap(raw);
  if (!Array.isArray(txs)) return [];
  return txs.slice(0, limit).map(t => ({
    hash: t.transaction_hash,
    timestamp: t.block_timestamp,
    method: t.method,
    from: t.tokens_sent?.[0]?.from_address || address,
    to: t.tokens_received?.[0]?.to_address || address,
    value: String(t.volume_usd || 0),
    symbol: t.tokens_received?.[0]?.token_symbol || t.tokens_sent?.[0]?.token_symbol || 'ETH',
    status: 'success',
    tokensReceived: t.tokens_received || [],
    tokensSent: t.tokens_sent || []
  }));
}

async function getCounterparties(address, chain = DEFAULT_CHAIN, limit = 20) {
  const raw = await execCommand(['profiler', 'counterparties', '--address', address, '--chain', chain]);
  const cps = unwrap(raw);
  if (!Array.isArray(cps)) return [];
  return cps.slice(0, limit).map(c => ({
    address: c.counterparty_address,
    label: c.counterparty_address_label?.[0] || 'Unknown',
    interactionCount: c.interaction_count || 0,
    totalVolumeUsd: c.total_volume_usd || 0,
    tokens: c.tokens_info || []
  }));
}

async function getTokens(address, chain = DEFAULT_CHAIN) {
  const balance = await getBalance(address, chain);
  return balance.tokens || [];
}

async function getTrades(address, chain = DEFAULT_CHAIN, limit = 20) {
  // Use pnl-summary for aggregate trade data since per-trade endpoint may not exist
  const pnl = await getPnLSummary(address, chain);
  // Build synthetic trades from transactions with value
  const txs = await getTransactions(address, chain, limit);
  return txs.filter(t => parseFloat(t.value) > 0).map((t, i) => ({
    id: t.hash || `tx${i}`,
    type: t.tokensSent?.length > 0 ? 'sell' : 'buy',
    tokenIn: t.tokensSent?.[0]?.token_symbol || 'ETH',
    tokenOut: t.tokensReceived?.[0]?.token_symbol || 'ETH',
    amountIn: String(t.tokensSent?.[0]?.token_amount || 0),
    amountOut: String(t.tokensReceived?.[0]?.token_amount || 0),
    pnl: '0',
    timestamp: t.timestamp,
    dex: t.method || 'Unknown'
  }));
}

async function getDexInteractions(address, chain = DEFAULT_CHAIN, limit = 20) {
  // Derive from transactions that look like DEX interactions
  const txs = await getTransactions(address, chain, limit);
  return txs.filter(t => t.method && (t.method.includes('swap') || t.method.includes('Ops'))).map(t => ({
    type: 'swap',
    dex: t.method,
    fromToken: t.tokensSent?.[0]?.token_symbol || 'ETH',
    toToken: t.tokensReceived?.[0]?.token_symbol || 'ETH',
    fromAmount: String(t.tokensSent?.[0]?.token_amount || 0),
    toAmount: String(t.tokensReceived?.[0]?.token_amount || 0),
    timestamp: t.timestamp,
    txHash: t.hash
  }));
}

async function getNfts(address, chain = DEFAULT_CHAIN) {
  // Nansen CLI doesn't have a direct NFT endpoint — return empty
  return [];
}

/**
 * Deterministic seed from address for varied mock data
 */
function addrSeed(address) {
  const hex = (address || '0x0000').slice(2, 10);
  return parseInt(hex, 16);
}

function seededRandom(seed, min, max) {
  const x = Math.sin(seed) * 10000;
  const r = x - Math.floor(x);
  return min + r * (max - min);
}

function pick(arr, seed) {
  return arr[Math.abs(seed) % arr.length];
}

/**
 * Mock data for testing — varies deterministically by address
 */
function getMockData(type, address) {
  const baseData = { address, chain: DEFAULT_CHAIN, timestamp: new Date().toISOString() };
  const s = addrSeed(address);

  const tokenPool = [
    { symbol: 'USDC', name: 'USD Coin' },
    { symbol: 'DEGEN', name: 'Degen' },
    { symbol: 'WETH', name: 'Wrapped ETH' },
    { symbol: 'AERO', name: 'Aerodrome' },
    { symbol: 'BRETT', name: 'Brett' },
    { symbol: 'TOSHI', name: 'Toshi' },
    { symbol: 'cbETH', name: 'Coinbase ETH' },
    { symbol: 'DAI', name: 'Dai' }
  ];
  const dexPool = ['Uniswap', 'Aerodrome', 'BaseSwap', 'SushiSwap', 'Curve'];
  const labelPool = ['whale', 'defi-user', 'smart-money', 'nft-collector', 'degen', 'yield-farmer', 'dao-voter'];

  switch (type) {
    case 'balance': {
      const totalVal = seededRandom(s, 500, 150000).toFixed(2);
      const ethBal = seededRandom(s + 1, 0.01, 50).toFixed(4);
      const numTokens = Math.floor(seededRandom(s + 2, 2, 7));
      const tokens = [];
      for (let i = 0; i < numTokens; i++) {
        const tok = tokenPool[(s + i) % tokenPool.length];
        const val = seededRandom(s + i + 10, 50, parseFloat(totalVal) / numTokens).toFixed(2);
        tokens.push({ symbol: tok.symbol, balance: seededRandom(s + i + 20, 10, 50000).toFixed(2), valueUsd: val });
      }
      return { ...baseData, totalValueUsd: totalVal, nativeBalance: ethBal, nativeSymbol: 'ETH', tokens };
    }
    case 'profile': {
      const numLabels = Math.floor(seededRandom(s + 3, 1, 4));
      const labels = [];
      for (let i = 0; i < numLabels; i++) labels.push(labelPool[(s + i) % labelPool.length]);
      const txCount = Math.floor(seededRandom(s + 4, 50, 8000));
      const volume = seededRandom(s + 5, 10000, 2000000).toFixed(0);
      const startYear = Math.floor(seededRandom(s + 6, 2022, 2025));
      const startMonth = String(Math.floor(seededRandom(s + 7, 1, 12))).padStart(2, '0');
      return {
        ...baseData,
        labels: [...new Set(labels)],
        tags: [pick(['active', 'degen', 'cautious', 'whale', 'new'], s)],
        firstSeen: `${startYear}-${startMonth}-15`,
        lastSeen: '2026-03-22',
        txCount,
        totalVolumeUsd: volume
      };
    }
    case 'pnl-summary': {
      const pnl = seededRandom(s + 8, -5000, 50000).toFixed(2);
      const pct = seededRandom(s + 9, -20, 60).toFixed(1);
      const realized = (parseFloat(pnl) * seededRandom(s + 10, 0.2, 0.8)).toFixed(2);
      const unrealized = (parseFloat(pnl) - parseFloat(realized)).toFixed(2);
      return { ...baseData, totalPnlUsd: pnl, pnlPercent: pct, realizedPnl: realized, unrealizedPnl: unrealized };
    }
    case 'transactions': {
      const count = Math.floor(seededRandom(s + 11, 3, 15));
      const txs = [];
      for (let i = 0; i < count; i++) {
        const daysAgo = Math.floor(seededRandom(s + i + 30, 0, 30));
        const date = new Date(Date.now() - daysAgo * 86400000);
        const tok = tokenPool[(s + i) % tokenPool.length];
        txs.push({
          hash: `0x${(s + i).toString(16).padStart(8, '0')}...`,
          timestamp: date.toISOString(),
          from: i % 2 === 0 ? address : `0x${((s + i) * 7).toString(16).padStart(40, '0').slice(0, 40)}`,
          to: i % 2 === 1 ? address : `0x${((s + i) * 13).toString(16).padStart(40, '0').slice(0, 40)}`,
          value: seededRandom(s + i + 40, 0.01, 500).toFixed(4),
          symbol: tok.symbol,
          status: 'success'
        });
      }
      return txs;
    }
    case 'counterparties': {
      const count = Math.floor(seededRandom(s + 12, 2, 10));
      const cps = [];
      const cpLabels = ['DEX', 'Lending Protocol', 'Bridge', 'NFT Marketplace', 'Whale', 'DAO Treasury', 'CEX Hot Wallet', 'Unknown'];
      for (let i = 0; i < count; i++) {
        cps.push({
          address: `0x${((s + i) * 17).toString(16).padStart(40, '0').slice(0, 40)}`,
          label: cpLabels[(s + i) % cpLabels.length],
          interactionCount: Math.floor(seededRandom(s + i + 50, 1, 80))
        });
      }
      return cps;
    }
    case 'tokens': {
      const count = Math.floor(seededRandom(s + 13, 2, 8));
      const toks = [];
      for (let i = 0; i < count; i++) {
        const tok = tokenPool[(s + i + 1) % tokenPool.length];
        const val = seededRandom(s + i + 60, 10, 20000).toFixed(2);
        toks.push({ symbol: tok.symbol, balance: seededRandom(s + i + 70, 0.1, 100000).toFixed(2), valueUsd: val });
      }
      return toks;
    }
    case 'trades': {
      const count = Math.floor(seededRandom(s + 14, 3, 12));
      const trades = [];
      for (let i = 0; i < count; i++) {
        const daysAgo = Math.floor(seededRandom(s + i + 80, 0, 14));
        const date = new Date(Date.now() - daysAgo * 86400000);
        const tokIn = tokenPool[(s + i) % tokenPool.length];
        const tokOut = tokenPool[(s + i + 3) % tokenPool.length];
        const pnl = seededRandom(s + i + 90, -50, 200).toFixed(2);
        trades.push({
          id: `tx${i}`,
          type: i % 3 === 0 ? 'sell' : 'buy',
          tokenIn: tokIn.symbol,
          tokenOut: tokOut.symbol,
          amountIn: seededRandom(s + i + 100, 0.01, 500).toFixed(4),
          amountOut: seededRandom(s + i + 110, 0.01, 5000).toFixed(4),
          price: seededRandom(s + i + 120, 0.001, 3000).toFixed(4),
          pnl,
          timestamp: date.toISOString(),
          dex: dexPool[(s + i) % dexPool.length]
        });
      }
      return trades;
    }
    case 'dex-interactions': {
      const count = Math.floor(seededRandom(s + 15, 3, 10));
      const interactions = [];
      const types = ['swap', 'swap', 'swap', 'addLiquidity', 'removeLiquidity'];
      for (let i = 0; i < count; i++) {
        const daysAgo = Math.floor(seededRandom(s + i + 130, 0, 21));
        const date = new Date(Date.now() - daysAgo * 86400000);
        const iType = types[(s + i) % types.length];
        const dex = dexPool[(s + i) % dexPool.length];
        const tokA = tokenPool[(s + i) % tokenPool.length];
        const tokB = tokenPool[(s + i + 2) % tokenPool.length];
        interactions.push({
          type: iType,
          dex,
          fromToken: tokA.symbol,
          toToken: tokB.symbol,
          fromAmount: seededRandom(s + i + 140, 0.01, 1000).toFixed(4),
          toAmount: seededRandom(s + i + 150, 0.01, 5000).toFixed(4),
          timestamp: date.toISOString(),
          txHash: `0x${(s + i + 200).toString(16).padStart(8, '0')}...`
        });
      }
      return interactions;
    }
    case 'nfts': {
      const count = Math.floor(seededRandom(s + 16, 0, 5));
      const collections = ['BAYC', 'Pudgy Penguins', 'OnChainMonkey', 'Base Punks', 'Tiny Based Frogs', 'CryptoPunks'];
      const nfts = [];
      for (let i = 0; i < count; i++) {
        const col = collections[(s + i) % collections.length];
        const tokenId = Math.floor(seededRandom(s + i + 160, 1, 9999));
        nfts.push({
          collection: col,
          tokenId: String(tokenId),
          name: `${col} #${tokenId}`,
          valueUsd: seededRandom(s + i + 170, 100, 30000).toFixed(2)
        });
      }
      return nfts;
    }
    default:
      return baseData;
  }
}

async function getWalletData(type, address, chain = DEFAULT_CHAIN, useMock = false) {
  if (useMock) return getMockData(type, address);

  try {
    switch (type) {
      case 'balance': return await getBalance(address, chain);
      case 'profile': return await getAddressProfile(address, chain);
      case 'pnl-summary': return await getPnLSummary(address, chain);
      case 'transactions': return await getTransactions(address, chain);
      case 'counterparties': return await getCounterparties(address, chain);
      case 'tokens': return await getTokens(address, chain);
      case 'trades': return await getTrades(address, chain);
      case 'dex-interactions': return await getDexInteractions(address, chain);
      case 'nfts': return await getNfts(address, chain);
      default: throw new Error(`Unknown type: ${type}`);
    }
  } catch (error) {
    console.log(`[Nansen] CLI error: ${error.message}, using mock`);
    return getMockData(type, address);
  }
}

/**
 * Fetch all data for a wallet (for battle mode)
 */
async function getAllWalletData(address, chain = DEFAULT_CHAIN, useMock = false) {
  const [balance, profile, pnlSummary, transactions, counterparties, tokens, trades, dexInteractions] = await Promise.all([
    getWalletData('balance', address, chain, useMock),
    getWalletData('profile', address, chain, useMock),
    getWalletData('pnl-summary', address, chain, useMock),
    getWalletData('transactions', address, chain, useMock),
    getWalletData('counterparties', address, chain, useMock),
    getWalletData('tokens', address, chain, useMock),
    getWalletData('trades', address, chain, useMock),
    getWalletData('dex-interactions', address, chain, useMock)
  ]);
  return { address, chain, balance, profile, pnlSummary, transactions, counterparties, tokens, trades, dexInteractions };
}

module.exports = {
  getBalance, getAddressProfile, getPnLSummary,
  getTransactions, getCounterparties, getTokens,
  getTrades, getDexInteractions, getNfts,
  getMockData, getWalletData, getAllWalletData, DEFAULT_CHAIN, nansen: { getWalletData, getAllWalletData }
};
