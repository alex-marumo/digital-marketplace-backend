const { getTrustLevel, TRUST_LEVELS } = require('../services/trustService');

const requireTrustLevel = (level) => {
  return async (req, res, next) => {
    const keycloakId = req.kauth.grant.access_token.content.sub;
    const userTrustLevel = await getTrustLevel(keycloakId);
    if (userTrustLevel >= level) {
      req.user = { trustLevel: userTrustLevel, keycloakId }; // Attach for downstream use
      next();
    } else {
      res.status(403).json({ error: 'Insufficient trust level' });
    }
  };
};

module.exports = { requireTrustLevel, TRUST_LEVELS };