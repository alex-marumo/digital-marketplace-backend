const nodemailer = require('nodemailer');

// Transporter unchanged
// Transporter unchanged
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
});

const sendEmail = async (to, subject, html) => {
  const sendTime = new Date().toISOString();
  console.log('Sending email to:', to, 'at:', sendTime);

  const mailOptions = {
    from: `"Art Marketplace" <${process.env.EMAIL_FROM}>`,
    to,
    subject,
    html,
  };
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log('Email sent successfully:', info.response, 'at:', new Date().toISOString());
    return info;
  } catch (error) {
    console.error('Email sending failed:', error.message);
    throw new Error('Email delivery failed');
  }
};

// Updated to send a code
const sendVerificationEmail = async (user, code) => {
  const html = `
    <h1>Welcome to Art Marketplace!</h1>
    <p>Thanks for signing up, ${user.name}. Enter this code in the app to verify your email:</p>
    <h2>${code}</h2>
    <p>Expires in 10 minutes. Ignore if you didn’t sign up.</p>
  `;
  return sendEmail(user.email, 'Email Verification Code', html);
};

module.exports = { sendEmail, sendVerificationEmail };
module.exports = { sendEmail, sendVerificationEmail };