// Import TRUST_LEVELS from the service instead of redeclaring
const { getTrustLevel, TRUST_LEVELS } = require('../services/trustService');

const requireTrustLevel = (level) => {
    return (req, res, next) => {
        if (req.user.trustLevel >= level) {
            next();
        } else {
            res.status(403).json({ error: 'Insufficient trust level' });
        }
    };
};

const updateUserTrustAfterOrder = async (userId) => {
    // Implementation for updating user trust level after an order
};

module.exports = { requireTrustLevel, TRUST_LEVELS, updateUserTrustAfterOrder };