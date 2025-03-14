const { pool } = require('../db');
const cryptoRandomString = require('crypto-random-string');

const createVerificationToken = async (userId) => {
  const token = cryptoRandomString({ length: 64, type: 'url-safe' });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
  const { rows } = await pool.query(
    'INSERT INTO verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3) RETURNING token',
    [userId, token, expiresAt]
  );
  return rows[0].token;
};

const verifyToken = async (token) => {
  const { rows } = await pool.query(
    'SELECT user_id, expires_at FROM verification_tokens WHERE token = $1 AND verified = FALSE',
    [token]
  );
  if (rows.length === 0) return { valid: false };
  const { user_id, expires_at } = rows[0];
  if (new Date() > expires_at) return { valid: false };
  await pool.query('UPDATE verification_tokens SET verified = TRUE WHERE token = $1', [token]);
  return { valid: true, userId: user_id };
};

module.exports = { createVerificationToken, verifyToken };