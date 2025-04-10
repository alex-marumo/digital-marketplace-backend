const session = require('express-session');
const PostgreSqlStore = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const Keycloak = require('keycloak-connect');
require('dotenv').config(); // Load .env vars right here

// Connect to PostgreSQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Set up the session store
const sessionStore = new PostgreSqlStore({
  pool: pool,
  tableName: 'sessions'
});

// Configure Keycloak with the store
const keycloak = new Keycloak({}, {
  realm: process.env.KEYCLOAK_REALM,
  "auth-server-url": process.env.KEYCLOAK_URL,
  "ssl-required": "none", // Fine for local dev, change to "external" for prod if needed
  resource: process.env.KEYCLOAK_CLIENT_ID,
  "confidential-port": 0,
  "client-secret": process.env.KEYCLOAK_CLIENT_SECRET,
});

keycloak.debug = true;

module.exports = { keycloak, sessionStore };