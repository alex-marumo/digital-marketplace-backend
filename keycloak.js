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
  store: sessionStore // Use Postgres store here
}, {
  realm: process.env.KEYCLOAK_REALM,
  'auth-server-url': process.env.KEYCLOAK_URL,
  'ssl-required': 'external',
  resource: process.env.KEYCLOAK_CLIENT_ID,
  credentials: {
    secret: process.env.KEYCLOAK_CLIENT_SECRET
  },
  'confidential-port': 0,
  'policy-enforcer': {}
});

keycloak.debug = true;

module.exports = { keycloak, sessionStore };