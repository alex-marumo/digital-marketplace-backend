const crypto = require('crypto');
const { pool } = require('../db');

// Generate a 6-digit verification code and store it
const createVerificationCode = async (userId) => {
  try {
    const code = Math.floor(100000 + Math.random() * 900000).toString(); // 6-digit code
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiration
    await pool.query(
      'INSERT INTO verification_codes (user_id, code, expires_at) VALUES ($1, $2, $3)',
      [userId, code, expiresAt]
    );
    return code; // Return the generated code
  } catch (error) {
    console.error('Error creating verification code:', error.message);
    throw new Error('Failed to generate verification code');
  }
};

// Verify the code and clean up
const verifyCode = async (userId, code) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM verification_codes WHERE user_id = $1 AND code = $2',
      [userId, code]
    );
    if (rows.length === 0) {
      return { valid: false, userId: null };
    }

    const record = rows[0];
    const now = new Date();
    if (now > new Date(record.expires_at)) {
      await pool.query(
        'DELETE FROM verification_codes WHERE user_id = $1 AND code = $2',
        [userId, code]
      );
      return { valid: false, userId: null };
    }

    // Code is valid, clean it up and return success
    await pool.query(
      'DELETE FROM verification_codes WHERE user_id = $1 AND code = $2',
      [userId, code]
    );
    return { valid: true, userId };
  } catch (error) {
    console.error('Error verifying code:', error.message);
    throw new Error('Failed to verify code');
  }
};

module.exports = { createVerificationCode, verifyCode };
module.exports = { createVerificationCode, verifyCode };