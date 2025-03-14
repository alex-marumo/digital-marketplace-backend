const rateLimit = require('express-rate-limit');

const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: 'Too many registration attempts from this IP' },
  keyGenerator: (req) => req.ip,
  skip: (req) => process.env.WHITELISTED_IPS?.split(',').includes(req.ip) || false
});

module.exports = { registrationLimiter };