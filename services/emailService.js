const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
});

const sendEmail = async (to, subject, html) => {
  const mailOptions = {
    from: `"Art Marketplace" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html
  };
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.response);
    return info;
  } catch (error) {
    console.error('Email sending failed:', error.message);
    throw new Error('Email delivery failed');
  }
};

const sendVerificationEmail = async (user, token) => {
  const verificationUrl = `${process.env.APP_URL}/api/verify-email?token=${token}`;
  const html = `
    <h1>Welcome to Art Marketplace!</h1>
    <p>Thanks for signing up, ${user.name}. Verify your email by clicking below:</p>
    <a href="${verificationUrl}">Verify Email</a>
    <p>Expires in 24 hours. Ignore if you didn’t sign up.</p>
  `;
  return sendEmail(user.email, 'Email Verification', html);
};

module.exports = { sendEmail, sendVerificationEmail };