const session = require('express-session');
const PostgreSqlStore = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const Keycloak = require('keycloak-connect');

// Connect to PostgreSQL (same as index.js)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// Set up the session store (same as index.js)
const sessionStore = new PostgreSqlStore({
  pool: pool,
  tableName: 'sessions'
});

// Configure Keycloak with the store
const keycloak = new Keycloak({}, {
  'realm': process.env.KEYCLOAK_REALM,
  'auth-server-url': process.env.KEYCLOAK_URL,
  'ssl-required': 'external',
  'resource': process.env.KEYCLOAK_CLIENT_ID,
  'bearer-only': true,
  'clientId': process.env.KEYCLOAK_CLIENT_ID,
  'secret': process.env.KEYCLOAK_CLIENT_SECRET
});

keycloak.debug = true;

module.exports = { keycloak, sessionStore };