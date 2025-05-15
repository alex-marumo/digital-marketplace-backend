const { getTrustLevel, TRUST_LEVELS } = require('../services/trustService');

const requireTrustLevel = (level) => {
  return async (req, res, next) => {
    try {
      const keycloakId = req.kauth?.grant?.access_token?.content?.sub;

      if (!keycloakId) {
        console.warn('Keycloak ID missing from token', { endpoint: req.originalUrl });
        return res.status(403).json({ error: 'Forbidden - No user ID in token' });
      }

      const userTrustLevel = await getTrustLevel(keycloakId);

      if (userTrustLevel === undefined || userTrustLevel === null) {
        console.warn(`No trust level found for user ${keycloakId}`, { endpoint: req.originalUrl });
        return res.status(403).json({ error: 'User trust level not found' });
      }

      if (userTrustLevel >= level) {
        req.user = { trustLevel: userTrustLevel, keycloakId };
        console.log(`User ${keycloakId} passed trust check: ${userTrustLevel} >= ${level}`, { endpoint: req.originalUrl });
        next();
      } else {
        console.warn(`User ${keycloakId} blocked: trust level ${userTrustLevel} < ${level}`, { endpoint: req.originalUrl });
        return res.status(403).json({ error: `Insufficient trust level - required: ${level}, user: ${userTrustLevel}` });
      }
    } catch (err) {
      console.error('Trust check failed:', err.message, { endpoint: req.originalUrl, userId: keycloakId });
      return res.status(500).json({ error: 'Server error during trust verification', details: err.message });
    }
  };
};

module.exports = { requireTrustLevel, TRUST_LEVELS };