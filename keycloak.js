const session = require('express-session');
const Keycloak = require('keycloak-connect');

const memoryStore = new session.MemoryStore();

const keycloak = new Keycloak({ store: memoryStore }, {
  "realm": process.env.KEYCLOAK_REALM,              // e.g., digital-marketplace
  "auth-server-url": process.env.KEYCLOAK_URL,       // e.g., http://localhost:8080/auth
  "resource": process.env.KEYCLOAK_CLIENT_ID,        // e.g., digital-marketplace-backend
  "credentials": { "secret": process.env.KEYCLOAK_CLIENT_SECRET || "" }, // if applicable, for confidential clients
  "public-client": true,                             // true if using public access, false otherwise
  "confidential-port": 0                             // Set to 0 for development\n});

module.exports = { keycloak, memoryStore };
