const Keycloak = require('keycloak-connect');
const session = require('express-session');

const memoryStore = new session.MemoryStore();

const keycloak = new Keycloak({
  store: memoryStore
}, {
  'realm': process.env.KEYCLOAK_REALM,
  'auth-server-url': process.env.KEYCLOAK_AUTH_SERVER_URL,
  'ssl-required': 'external',
  'resource': process.env.KEYCLOAK_CLIENT_ID,
  'confidential-port': 0,
  'clientId': process.env.KEYCLOAK_CLIENT_ID,
  'secret': process.env.KEYCLOAK_CLIENT_SECRET
});

module.exports = { keycloak, memoryStore };