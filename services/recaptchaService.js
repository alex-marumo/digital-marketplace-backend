const axios = require('axios');
const qs = require('qs');

const verifyRecaptcha = async (token) => {
  try {
    const response = await axios.post(
      'https://www.google.com/recaptcha/api/siteverify',
      qs.stringify({
        secret: process.env.RECAPTCHA_SECRET_KEY,
        response: token
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      }
    );
    console.log('reCAPTCHA response:', response.data);
    return {
      success: response.data.success,
      score: response.data.score || 0
    };
  } catch (error) {
    console.error('reCAPTCHA verification error:', error.response?.data || error.message);
    return { success: false };
  }
};

module.exports = { verifyRecaptcha };