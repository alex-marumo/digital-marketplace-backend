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
  keyGenerator: (req) => {
    return req.kauth?.grant?.access_token?.content?.sub || req.query.token || req.ip || 'anonymous';
  }
});

const artworkManagementLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  message: { error: 'Too many artwork operations, please try again later.' },
  keyGenerator: (req) => {
    return req.kauth?.grant?.access_token?.content?.sub || req.query.token || req.ip || 'anonymous';
  }
});

const authGetLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 50,
  message: { error: 'Too many requests, please try again later.' },
  keyGenerator: (req) => {
    return req.kauth?.grant?.access_token?.content?.sub || req.query.token || req.ip || 'anonymous';
  }
});

const authPostLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 20,
  message: { error: 'Too many actions, please try again later.' },
  keyGenerator: (req) => {
    return req.kauth?.grant?.access_token?.content?.sub || req.query.token || req.ip || 'anonymous';
  }
});

const authPutLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 15,
  message: { error: 'Too many updates, please try again later.' },
  keyGenerator: (req) => {
    return req.kauth?.grant?.access_token?.content?.sub || req.query.token || req.ip || 'anonymous';
  }
});

const authDeleteLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 10,
  message: { error: 'Too many deletions, please try again later.' },
  keyGenerator: (req) => {
    return req.kauth?.grant?.access_token?.content?.sub || req.query.token || req.ip || 'anonymous';
  }
});

module.exports = {
  registrationLimiter,
  orderLimiter,
  publicDataLimiter,
  messageLimiter,
  artworkManagementLimiter,
  authGetLimiter,
  authPostLimiter,
  authPutLimiter,
  authDeleteLimiter
};