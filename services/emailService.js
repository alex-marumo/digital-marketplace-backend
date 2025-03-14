const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
});

const sendVerificationEmail = async (user, token) => {
  const verificationUrl = `${process.env.APP_URL}/api/verify-email?token=${token}`;
  const mailOptions = {
    from: `"Art Marketplace" <${process.env.EMAIL_FROM}>`,
    to: user.email,
    subject: 'Verify Your Email Address',
    html: `
      <h1>Welcome to Art Marketplace!</h1>
      <p>Thanks for signing up, ${user.name}. Verify your email by clicking below:</p>
      <a href="${verificationUrl}">Verify Email</a>
      <p>Expires in 24 hours. Ignore if you didn’t sign up.</p>
    `
  };
  return transporter.sendMail(mailOptions);
};

module.exports = { sendVerificationEmail };