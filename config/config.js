module.exports = {
  development: {
    username: "your_db_user",
    password: "your_db_password",
    database: "digital_marketplace",
    host: "127.0.0.1",
    dialect: "postgres",
  },
  production: {
    use_env_variable: "DATABASE_URL", // Railway provides DATABASE_URL
    dialect: "postgres",
    dialectOptions: { ssl: { require: true, rejectUnauthorized: false } },
  },
};
