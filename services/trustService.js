const { pool } = require('../db');

const TRUST_LEVELS = {
  NEW: 1,      // Just registered
  VERIFIED: 2, // Email verified
  ESTABLISHED: 3, // First purchase
  TRUSTED: 4   // Multiple transactions
};

const updateTrustLevel = async (userId, newLevel) => {
  await pool.query('UPDATE users SET trust_level = $1 WHERE keycloak_id = $2', [newLevel, userId]);
};

const getTrustLevel = async (userId) => {
  const { rows } = await pool.query('SELECT trust_level FROM users WHERE keycloak_id = $1', [userId]);
  return rows[0]?.trust_level || TRUST_LEVELS.NEW;
};

const updateUserTrustAfterOrder = async (userId) => {
  const { rows } = await pool.query(
    'SELECT COUNT(*) as order_count FROM orders WHERE buyer_id = $1 AND status = $2',
    [userId, 'completed']
  );
  const orderCount = parseInt(rows[0].order_count);
  if (orderCount === 1) {
    await updateTrustLevel(userId, TRUST_LEVELS.ESTABLISHED);
  } else if (orderCount >= 5) {
    await updateTrustLevel(userId, TRUST_LEVELS.TRUSTED);
  }
};

module.exports = { TRUST_LEVELS, updateTrustLevel, getTrustLevel, updateUserTrustAfterOrder };