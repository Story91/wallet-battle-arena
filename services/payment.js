/**
 * x402 Payment Service
 * Handles payment verification for USDC on Base
 */

const PRICE_BASIC = BigInt(10000);   // 0.01 USDC (6 decimals)
const PRICE_ADVANCED = BigInt(50000); // 0.05 USDC

function parsePaymentHeader(paymentHeader) {
  if (!paymentHeader) return null;
  try {
    const parts = paymentHeader.split(':');
    if (parts.length >= 3) {
      return { token: parts[0], recipient: parts[1], amount: parts[2] };
    }
    return JSON.parse(paymentHeader);
  } catch (e) { return null; }
}

function verifyPayment(payment, tier = 'advanced') {
  if (!payment) return false;
  const minAmount = tier === 'basic' ? PRICE_BASIC : PRICE_ADVANCED;
  try {
    return BigInt(payment.amount) >= minAmount;
  } catch (e) { return false; }
}

function paymentRequired(res, endpoint, tier = 'advanced') {
  const price = tier === 'basic' ? '0.01' : '0.05';
  const wei = tier === 'basic' ? '10000' : '50000';
  
  res.status(402).json({
    error: 'Payment Required',
    message: `This endpoint requires ${price} USDC payment`,
    price: { amount: price, currency: 'USDC', chain: 'base', wei },
    paymentInstructions: {
      header: 'X-Payment',
      format: 'USDC:<recipient>:<amount_wei>',
      example: `USDC:0x...:${wei}`
    }
  });
}

function requirePayment(req, res, next) {
  const paymentHeader = req.headers['x-payment'];
  const payment = parsePaymentHeader(paymentHeader);
  
  // For development, skip payment check
  if (process.env.NODE_ENV !== 'production' && !paymentHeader) {
    return next();
  }
  
  if (!payment) {
    return paymentRequired(res, req.path);
  }
  
  if (!verifyPayment(payment)) {
    return res.status(402).json({
      error: 'Insufficient Payment',
      message: 'Payment amount too low',
      required: '50000',
      received: payment.amount
    });
  }
  
  req.payment = payment;
  next();
}

function getPrice(tier = 'advanced') {
  return {
    amount: tier === 'basic' ? '0.01' : '0.05',
    currency: 'USDC',
    chain: 'base',
    wei: tier === 'basic' ? '10000' : '50000'
  };
}

module.exports = { parsePaymentHeader, verifyPayment, paymentRequired, requirePayment, getPrice };
