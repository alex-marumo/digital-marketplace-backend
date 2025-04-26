const session = require('express-session');
const PostgreSqlStore = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const Keycloak = require('keycloak-connect');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

const sessionStore = new PostgreSqlStore({
  pool: pool,
  tableName: 'sessions'
});

console.log('Session store initialized:', sessionStore);

const keycloak = new Keycloak({
  store: sessionStore
}, {
  realm: process.env.KEYCLOAK_REALM || 'art-marketplace-realm',
  'auth-server-url': process.env.KEYCLOAK_URL || 'http://localhost:8080/',
  'ssl-required': 'external',
  resource: process.env.KEYCLOAK_CLIENT_ID || 'your-client-id',
  credentials: {
    secret: process.env.KEYCLOAK_CLIENT_SECRET || 'your-client-secret'
  },
  'confidential-port': 0,
  bearerOnly: true // Prevents redirects, returns 401
});

keycloak.verifyToken = async (token) => {
  try {
    const grant = await keycloak.grantManager.validateAccessToken(token);
    return grant.isExpired() ? null : grant.access_token;
  } catch (err) {
    console.error('Token validation failed:', err.message);
    return null;
  }
};

keycloak.debug = true;

module.exports = { keycloak, sessionStore };