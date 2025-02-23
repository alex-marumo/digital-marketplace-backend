const { Sequelize } = require("sequelize");

// Load database URL from environment variables
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("❌ DATABASE_URL is not set. Check your Railway environment variables.");
  process.exit(1); // Stop the app if the database URL is missing
}

// Initialize Sequelize with SSL support for Railway
const sequelize = new Sequelize(databaseUrl, {
  dialect: "postgres",
  dialectOptions: process.env.NODE_ENV === "production" ? {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  } : {}
});

module.exports = sequelize;
