const { pool } = require('../db');

const cryptoRandomString = require('crypto-random-string');

const createVerificationToken = async (userId) => { // userId is '550e8400-e29b-41d4-a716-446655440000'
  const token = cryptoRandomString({ length: 64, type: 'url-safe' });
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const { rows } = await pool.query(
    'INSERT INTO verification_tokens (user_id, token, expires_at) VALUES ($1, $2, $3) RETURNING token',
    [userId, token, expiresAt]
  );
  return rows[0].token;
};

const verifyToken = async (token) => {
  const { rows } = await pool.query(
    'SELECT * FROM verification_tokens WHERE token = $1 AND expires_at > NOW() AND verified = FALSE',
    [token]
  );
  if (rows.length === 0) return { valid: false };

  await pool.query('UPDATE verification_tokens SET verified = TRUE WHERE token_id = $1', [rows[0].token_id]);
  await pool.query('UPDATE users SET is_verified = TRUE WHERE keycloak_id = $1', [rows[0].user_id]);
  return { valid: true, userId: rows[0].user_id };
};

module.exports = { createVerificationToken, verifyToken };