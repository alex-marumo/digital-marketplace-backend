const axios = require('axios');

const verifyRecaptcha = async (token) => {
  const response = await axios.post(
    'https://www.google.com/recaptcha/api/siteverify',
    null,
    { params: { secret: process.env.RECAPTCHA_SECRET_KEY, response: token } }
  );
  return {
    success: response.data.success,
    score: response.data.score
  };
};

module.exports = { verifyRecaptcha };