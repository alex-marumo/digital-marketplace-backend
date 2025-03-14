const rateLimit = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const registrationLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 5,
  message: { error: 'Too many registration attempts, please try again later.' }
});

const orderLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  message: { error: 'Too many orders placed from this IP, please try again later.' }
});

const publicDataLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 100,
  message: { error: 'Too many requests, please try again later.' }
});

const messageLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 20,
  message: { error: 'Too many messages sent, please try again later.' },
  keyGenerator: (req) => req.kauth.grant.access_token.content.sub
});

const artworkManagementLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  message: { error: 'Too many artwork operations, please try again later.' },
  keyGenerator: (req) => req.kauth.grant.access_token.content.sub
});

const authGetLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 50, // 50 requests per 15 minutes per user
  message: { error: 'Too many profile requests, please try again later.' },
  keyGenerator: (req) => req.kauth.grant.access_token.content.sub // Per Keycloak user ID
});

module.exports = { registrationLimiter, orderLimiter, publicDataLimiter, messageLimiter, artworkManagementLimiter, authGetLimiter };