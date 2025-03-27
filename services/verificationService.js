const crypto = require('crypto');
const { pool } = require('../db');

// Generate a 6-digit code and store it
const createVerificationCode = async (userId) => {
  const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiration
  await pool.query(
    'INSERT INTO verification_codes (user_id, code, expires_at) VALUES ($1, $2, $3)',
    [userId, code, expiresAt]
  );
  return code;
};

// Verify the code
const verifyCode = async (userId, code) => {
  const { rows } = await pool.query(
    'SELECT * FROM verification_codes WHERE user_id = $1 AND code = $2',
    [userId, code]
  );
  if (rows.length === 0) return { valid: false };
  const record = rows[0];
  if (new Date() > new Date(record.expires_at)) {
    await pool.query('DELETE FROM verification_codes WHERE user_id = $1 AND code = $2', [userId, code]);
    return { valid: false };
  }
  await pool.query('DELETE FROM verification_codes WHERE user_id = $1 AND code = $2', [userId, code]);
  return { valid: true, userId };
};

module.exports = { createVerificationCode, verifyCode };