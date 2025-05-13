const { getTrustLevel, TRUST_LEVELS } = require('../services/trustService');

const requireTrustLevel = (level) => {
  return async (req, res, next) => {
    try {
      const keycloakId = req.kauth?.grant?.access_token?.content?.sub;

      if (!keycloakId) {
        console.warn("Keycloak ID missing from token");
        return res.status(403).json({ error: 'Forbidden - No user ID in token' });
      }

      const userTrustLevel = await getTrustLevel(keycloakId);

      if (userTrustLevel === undefined || userTrustLevel === null) {
        console.warn(`No trust level found for user ${keycloakId}`);
        return res.status(403).json({ error: 'User trust level not found' });
      }

      if (userTrustLevel >= level) {
        req.user = { trustLevel: userTrustLevel, keycloakId };
        next();
      } else {
        console.warn(`User ${keycloakId} has trust level ${userTrustLevel}, required: ${level}`);
        res.status(403).json({ error: 'Insufficient trust level' });
      }
    } catch (err) {
      console.error('Trust check failed:', err.message);
      res.status(500).json({ error: 'Server error during trust verification' });
    }
  };
};

module.exports = { requireTrustLevel, TRUST_LEVELS };
