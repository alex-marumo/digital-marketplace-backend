const rateLimit = require('express-rate-limit');

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

const registrationLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 5, // Limit each IP to 5 registration attempts per window
  message: { error: 'Too many registration attempts, please try again later.' }
});

const orderLimiter = rateLimit({
  windowMs: WINDOW_MS,
  max: 10, // Limit each IP to 10 orders per window
  message: { error: 'Too many orders placed from this IP, please try again later.' }
});

module.exports = { registrationLimiter, orderLimiter };
