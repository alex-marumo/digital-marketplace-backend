const { pool } = require('../db');

const TRUST_LEVELS = {
  NEW: 1,      // Just registered
  VERIFIED: 2, // Email verified or artist approved
  ESTABLISHED: 3, // First purchase
  TRUSTED: 4   // Multiple transactions
};

const isValidUUID = (str) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

const updateTrustLevel = async (userId, newLevel) => {
  if (!isValidUUID(userId)) {
    console.error('Invalid userId for trust update:', userId);
    throw new Error('Invalid user ID format');
  }
  if (!Object.values(TRUST_LEVELS).includes(newLevel)) {
    console.error('Invalid trust level:', newLevel);
    throw new Error('Invalid trust level');
  }
  try {
    await pool.query(
      'UPDATE users SET trust_level = $1 WHERE keycloak_id = $2',
      [newLevel, userId]
    );
    console.log('Trust level updated for user:', userId, 'to:', newLevel);
  } catch (error) {
    console.error('Update trust level error:', error.message, 'User:', userId);
    throw error;
  }
};

const getTrustLevel = async (userId) => {
  if (!isValidUUID(userId)) {
    console.error('Invalid userId for trust fetch:', userId);
    throw new Error('Invalid user ID format');
  }
  try {
    const { rows } = await pool.query(
      'SELECT trust_level, is_verified FROM users WHERE keycloak_id = $1',
      [userId]
    );
    if (!rows[0]) {
      console.warn(`No user found for keycloak_id: ${userId}`);
      return TRUST_LEVELS.NEW;
    }
    const level = rows[0].trust_level || (rows[0].is_verified ? TRUST_LEVELS.VERIFIED : TRUST_LEVELS.NEW);
    console.log(`[getTrustLevel] Fetched level for ${userId}: ${level}, is_verified: ${rows[0].is_verified}`);
    return level;
  } catch (error) {
    console.error('Fetch trust level error:', error.message, 'User:', userId);
    throw error;
  }
};

const updateUserTrustAfterOrder = async (userId) => {
  if (!isValidUUID(userId)) {
    console.error('Invalid userId for order trust update:', userId);
    throw new Error('Invalid user ID format');
  }
  try {
    const { rows } = await pool.query(
      'SELECT COUNT(*) as order_count FROM orders WHERE buyer_id = $1 AND status = $2',
      [userId, 'completed']
    );
    const orderCount = parseInt(rows[0].order_count);
    console.log('Order count for user:', userId, 'is:', orderCount);
    if (orderCount >= 5) {
      await updateTrustLevel(userId, TRUST_LEVELS.TRUSTED);
    } else if (orderCount >= 1) {
      await updateTrustLevel(userId, TRUST_LEVELS.ESTABLISHED);
    } else {
      await updateTrustLevel(userId, TRUST_LEVELS.VERIFIED); // Ensure at least VERIFIED after any order attempt
    }
  } catch (error) {
    console.error('Update trust after order error:', error.message, 'User:', userId);
    throw error;
  }
};

module.exports = { TRUST_LEVELS, updateTrustLevel, getTrustLevel, updateUserTrustAfterOrder };