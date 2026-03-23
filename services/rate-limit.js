/**
 * Rate Limiter — IP-based with x402 paid credits
 *
 * Free tier:  1 battle per day per IP
 * Paid:       0.50 USDC = 5 additional battles
 */

const { parsePaymentHeader } = require('./payment');

const FREE_BATTLES = 1;
const PAID_BATTLES = 5; // battles per 0.50 USDC payment
const WINDOW_MS = 24 * 60 * 60 * 1000;
const BATTLE_PRICE_WEI = BigInt(500000); // 0.50 USDC (6 decimals)

// Map<ip, { freeUsed, paidCredits, resetAt }>
const store = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of store) {
    if (now >= entry.resetAt) store.delete(ip);
  }
}, 10 * 60 * 1000).unref();

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.ip ||
    req.connection?.remoteAddress ||
    'unknown'
  );
}

function getRecipient() {
  return process.env.PAYMENT_RECIPIENT || '0x0000000000000000000000000000000000000000';
}

function getEntry(ip) {
  const now = Date.now();
  let entry = store.get(ip);
  if (!entry || now >= entry.resetAt) {
    entry = { freeUsed: 0, paidCredits: 0, resetAt: now + WINDOW_MS };
    store.set(ip, entry);
  }
  return entry;
}

function battleRateLimit(req, res, next) {
  if (process.env.NODE_ENV === 'development' || process.env.RATE_LIMIT_DISABLED === 'true') {
    return next();
  }

  const ip = getClientIp(req);
  const entry = getEntry(ip);
  const now = Date.now();
  const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);

  // ── 1. Check for x402 payment → add credits ──
  const paymentHeader = req.headers['x-payment'];
  if (paymentHeader) {
    const payment = parsePaymentHeader(paymentHeader);
    if (payment) {
      try {
        if (BigInt(payment.amount) >= BATTLE_PRICE_WEI) {
          entry.paidCredits += PAID_BATTLES;
          req.payment = payment;
          // Use one paid credit now
          entry.paidCredits--;
          res.set('X-RateLimit-Remaining', String(remaining(entry)));
          return next();
        }
      } catch (e) { /* invalid amount, fall through */ }
    }
  }

  // ── 2. Use free battle if available ──
  if (entry.freeUsed < FREE_BATTLES) {
    entry.freeUsed++;
    res.set('X-RateLimit-Remaining', String(remaining(entry)));
    return next();
  }

  // ── 3. Use paid credit if available ──
  if (entry.paidCredits > 0) {
    entry.paidCredits--;
    res.set('X-RateLimit-Remaining', String(remaining(entry)));
    return next();
  }

  // ── 4. No credits left → 402 ──
  const hours = Math.floor(retryAfterSec / 3600);
  const minutes = Math.ceil((retryAfterSec % 3600) / 60);
  res.set('Retry-After', String(retryAfterSec));

  return res.status(402).json({
    error: 'Payment Required',
    message: `Free battle used! Pay 0.50 USDC for ${PAID_BATTLES} more battles, or wait ${hours}h ${minutes}m.`,
    remaining: 0,
    resetAt: new Date(entry.resetAt).toISOString(),
    retryAfterSeconds: retryAfterSec,
    payment: {
      price: '0.50',
      priceWei: '500000',
      currency: 'USDC',
      chain: 'base',
      recipient: getRecipient(),
      usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      battlesIncluded: PAID_BATTLES,
      header: 'X-Payment',
      format: 'USDC:<recipient>:<amount_wei>',
      example: `USDC:${getRecipient()}:500000`
    }
  });
}

function remaining(entry) {
  return Math.max(0, FREE_BATTLES - entry.freeUsed) + entry.paidCredits;
}

module.exports = { battleRateLimit, BATTLE_PRICE_WEI, getRecipient };
