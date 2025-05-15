require('dotenv').config();
const axios = require('axios');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function syncKeycloakUsernames() {
  try {
    const { rows } = await pool.query('SELECT keycloak_id, email FROM users WHERE status != $1', ['deleted']);
    console.log(`Found ${rows.length} users to sync:`, rows.map(r => ({ id: r.keycloak_id, email: r.email })));

    const adminTokenResponse = await axios.post(
      `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.KEYCLOAK_CLIENT_ID,
        client_secret: process.env.KEYCLOAK_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const adminToken = adminTokenResponse.data.access_token;
    console.log('Admin token acquired');

    for (const user of rows) {
      try {
        await axios.put(
          `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${user.keycloak_id}`,
          { username: user.email, email: user.email },
          { headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' } }
        );
        console.log(`Synced username for user ${user.keycloak_id} to ${user.email}`);
      } catch (err) {
        console.error(`Failed to sync user ${user.keycloak_id}:`, {
          status: err.response?.status,
          data: err.response?.data,
          message: err.message,
        });
      }
    }
    console.log('Sync complete');
  } catch (err) {
    console.error('Sync error:', {
      message: err.message,
      response: err.response?.data,
    });
  } finally {
    await pool.end();
  }
}

syncKeycloakUsernames();