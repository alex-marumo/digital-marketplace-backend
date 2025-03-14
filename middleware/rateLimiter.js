const rateLimit = require('express-rate-limit');

const orderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hours
  max: 10, // Limit each IP to 10 orders per window
  message: { error: "Too many orders placed from this IP, please try again later." },
  keyGenerator: (req) => req.ip,
  skip: (req) => process.env.WHITELISTED_IPS?.split(',').includes(req.ip) || false
});

module.exports = { registrationLimiter };