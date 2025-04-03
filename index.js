require('dotenv').config();
console.log('DATABASE_URL:', process.env.DATABASE_URL);
const express = require('express');
const bodyParser = require('body-parser');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const { keycloak } = require('./keycloak');
const axios = require('axios');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const swaggerUI = require('swagger-ui-express');
const fs = require('fs');
const { pool } = require('./db');
const { sendVerificationEmail } = require('./services/emailService');
const { createVerificationCode, verifyCode } = require('./services/verificationService');
const { verifyRecaptcha } = require('./services/recaptchaService');

const { registrationLimiter, orderLimiter, publicDataLimiter, messageLimiter, artworkManagementLimiter, authGetLimiter, authPostLimiter, authPutLimiter, authDeleteLimiter } = require('./middleware/rateLimiter');
console.log('Rate Limiters:', { registrationLimiter, orderLimiter, publicDataLimiter, messageLimiter, artworkManagementLimiter, authGetLimiter, authPostLimiter, authPutLimiter, authDeleteLimiter });
console.log('SYSTEM_USER_ID:', process.env.SYSTEM_USER_ID);

const { requireTrustLevel } = require('./middleware/trustLevel');
const { TRUST_LEVELS, updateTrustLevel, updateUserTrustAfterOrder } = require('./services/trustService');

const swaggerFile = path.join(__dirname, 'docs', 'openapi3_0.json');
const swaggerData = JSON.parse(fs.readFileSync(swaggerFile, 'utf8'));

const app = express();
const port = process.env.PORT || 3000;

// Middleware setup
app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(swaggerData));
app.use(express.json());
app.use(cors());
app.use(bodyParser.json());
app.use(keycloak.middleware());

// Multer setup for general uploads (artworks)
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage });

// Multer setup for artist verification
const artistStorage = multer.diskStorage({
  destination: './uploads/artist_verification/',
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(ext)) {
      return cb(new Error('Invalid file type—only PDF, JPG, PNG allowed'));
    }
    cb(null, `${req.kauth.grant.access_token.content.sub}-${Date.now()}${ext}`);
  },
});
const artistUpload = multer({
  storage: artistStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(ext)) {
      return cb(new Error('Invalid file type'));
    }
    cb(null, true);
  },
}).fields([
  { name: 'idDocument', maxCount: 1 },
  { name: 'proofOfWork', maxCount: 1 },
]);

// --- User Routes ---

app.post('/api/pre-register', registrationLimiter, async (req, res) => {
  const { recaptchaToken, email, name, password } = req.body;
  if (!recaptchaToken || !email || !name || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const recaptchaResult = await verifyRecaptcha(recaptchaToken);
  if (!recaptchaResult.success || recaptchaResult.score < 0.5) {
    return res.status(400).json({ error: 'reCAPTCHA verification failed' });
  }

  try {
    const { rows: existingUser } = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    if (existingUser.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const adminToken = await axios.post(
      `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.KEYCLOAK_ADMIN_CLIENT_ID,
        client_secret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const userResponse = await axios.post(
      `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users`,
      {
        username: email,
        email,
        firstName: name.split(' ')[0],
        lastName: name.split(' ')[1] || '',
        enabled: true,
        credentials: [{ type: 'password', value: password, temporary: false }],
        emailVerified: false,
      },
      {
        headers: {
          Authorization: `Bearer ${adminToken.data.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const keycloakId = userResponse.headers.location.split('/').pop();
    const { rows } = await pool.query(
      'INSERT INTO users (keycloak_id, name, email, role, is_verified, trust_level) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [keycloakId, name, email, 'buyer', false, TRUST_LEVELS.NEW]
    );

    const code = await createVerificationCode(keycloakId);
    await sendVerificationEmail(rows[0], code);

    res.status(201).json({ message: 'User registered, enter the code from your email in the app' });
  } catch (error) {
    console.error('Registration error:', error.response?.data || error.message);
    if (error.message.includes('duplicate key')) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    res.status(500).json({ error: 'Registration failed', details: error.message });
  }
});

app.post('/api/verify-email-code', registrationLimiter, async (req, res) => {
  const { code, email } = req.body;
  if (!code || !email) return res.status(400).json({ error: 'Missing code or email' });

  try {
    const { rows } = await pool.query('SELECT keycloak_id FROM users WHERE email = $1', [email]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const keycloakId = rows[0].keycloak_id;

    const result = await verifyCode(keycloakId, code);
    if (!result.valid) return res.status(400).json({ error: 'Invalid or expired code' });

    const adminToken = await axios.post(
      `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.KEYCLOAK_ADMIN_CLIENT_ID,
        client_secret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    await axios.put(
      `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${result.userId}`,
      { emailVerified: true },
      {
        headers: {
          Authorization: `Bearer ${adminToken.data.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    await pool.query(
      'UPDATE users SET is_verified = $1 WHERE keycloak_id = $2',
      [true, result.userId]
    );

    await updateTrustLevel(result.userId, TRUST_LEVELS.VERIFIED);
    res.json({ message: 'Email verified' });
  } catch (error) {
    console.error('Code verification error:', error.message);
    res.status(500).json({ error: 'Verification failed', details: error.message });
  }
});

app.post('/api/resend-verification-code', registrationLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Missing email' });

  try {
    const { rows } = await pool.query('SELECT keycloak_id, name FROM users WHERE email = $1 AND is_verified = $2', [email, false]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found or already verified' });

    const user = rows[0];
    const keycloakId = user.keycloak_id;

    const code = await createVerificationCode(keycloakId);
    await sendVerificationEmail({ email, name: user.name }, code);

    res.json({ message: 'New verification code sent' });
  } catch (error) {
    console.error('Resend error:', error.message);
    res.status(500).json({ error: 'Failed to resend code', details: error.message });
  }
});

app.get('/api/users/me', keycloak.protect(), authGetLimiter, async (req, res) => {
  try {
    const keycloakId = req.kauth.grant.access_token.content.sub;
    const { rows } = await pool.query(
      'SELECT user_id, name, email, role, is_verified, trust_level FROM users WHERE keycloak_id = $1',
      [keycloakId]
    );

    if (rows.length === 0) {
      const userName = req.kauth.grant.access_token.content.name || 'Unknown';
      const userEmail = req.kauth.grant.access_token.content.email || 'unknown@example.com';
      const { rows: newUser } = await pool.query(
        'INSERT INTO users (keycloak_id, name, email, role, is_verified, trust_level) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
        [keycloakId, userName, userEmail, 'buyer', false, TRUST_LEVELS.NEW]
      );
      const code = await createVerificationCode(keycloakId);
      await sendVerificationEmail(newUser[0], code);
      return res.status(201).json({ message: 'User created, please verify your email', user: newUser[0] });
    }

    if (!rows[0].is_verified) {
      return res.status(403).json({ error: 'Please verify your email' });
    }

    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.put('/api/users/me', keycloak.protect(), authPutLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { name, email } = req.body;
  try {
    let query = 'UPDATE users SET';
    const values = [];
    
    if (name) {
      values.push(name);
      query += ` name = $${values.length},`;
    }
    if (email) {
      values.push(email);
      query += ` email = $${values.length},`;
    }
    
    query = query.slice(0, -1) + ` WHERE keycloak_id = $${values.length + 1} RETURNING user_id, name, email`;
    values.push(userId);

    const { rows } = await pool.query(query, values);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ message: 'Profile updated', user: rows[0] });
  } catch (error) {
    console.error('Update User Error:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Artist Routes ---

app.post('/api/request-artist', keycloak.protect(), artistUpload, authPostLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { files } = req;

  if (!files?.idDocument || !files?.proofOfWork) {
    return res.status(400).json({ error: 'Missing ID document or proof of work' });
  }

  try {
    const { rows: userRows } = await pool.query(
      'SELECT is_verified FROM users WHERE keycloak_id = $1',
      [userId]
    );
    if (userRows.length === 0 || !userRows[0].is_verified) {
      return res.status(403).json({ error: 'Must be email-verified to request artist status' });
    }

    const { rows: existing } = await pool.query(
      'SELECT status FROM artist_requests WHERE user_id = $1',
      [userId]
    );
    if (existing.length > 0 && existing[0].status === 'pending') {
      return res.status(409).json({ error: 'Artist request already pending' });
    }
    if (existing.length > 0 && existing[0].status === 'approved') {
      return res.status(409).json({ error: 'Already an artist' });
    }

    const idPath = path.normalize(files.idDocument[0].path).replace(/^(\.\.(\/|\\|$))+/, '');
    const proofPath = path.normalize(files.proofOfWork[0].path).replace(/^(\.\.(\/|\\|$))+/, '');

    const { rows } = await pool.query(
      'INSERT INTO artist_requests (user_id, id_document_path, proof_of_work_path) VALUES ($1, $2, $3) RETURNING request_id',
      [userId, idPath, proofPath]
    );
    res.status(201).json({ message: 'Artist request submitted—awaiting admin review', requestId: rows[0].request_id });
  } catch (error) {
    console.error('Artist request error:', error.message);
    res.status(500).json({ error: 'Failed to submit request', details: error.message });
  }
});

app.post('/api/review-artist-request', (req, res, next) => {
  console.log('Raw Header:', req.headers.authorization);
  console.log('Decoded Token:', req.kauth?.grant?.access_token?.content);
  console.log('Roles:', req.kauth?.grant?.access_token?.content?.realm_access); // Fixed!
  next();
}, keycloak.protect('realm:admin'), authPostLimiter, async (req, res) => {
  const adminId = req.kauth.grant.access_token.content.sub;
  const { requestId, approve, rejectionReason } = req.body;

  if (!requestId || typeof approve !== 'boolean' || (!approve && !rejectionReason)) {
    return res.status(400).json({ error: 'Missing requestId, approve flag, or rejection reason' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: requestRows } = await client.query(
      'SELECT user_id, status FROM artist_requests WHERE request_id = $1',
      [requestId]
    );
    if (requestRows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    if (requestRows[0].status !== 'pending') {
      return res.status(409).json({ error: 'Request already reviewed' });
    }
    const userId = requestRows[0].user_id;

    const status = approve ? 'approved' : 'rejected';
    const updateQuery = approve
      ? 'UPDATE artist_requests SET status = $1, reviewed_at = NOW(), reviewed_by = $2 WHERE request_id = $3'
      : 'UPDATE artist_requests SET status = $1, reviewed_at = NOW(), reviewed_by = $2, rejection_reason = $4 WHERE request_id = $3';
    const values = approve
      ? [status, adminId, requestId]
      : [status, adminId, requestId, rejectionReason];
    await client.query(updateQuery, values);

    if (approve) {
      const adminToken = await axios.post(
        `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: process.env.KEYCLOAK_ADMIN_CLIENT_ID,
          client_secret: process.env.KEYCLOAK_ADMIN_CLIENT_SECRET,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      await axios.post(
        `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${userId}/role-mappings/realm`,
        [{ id: 'artist-role-id', name: 'artist' }], // REPLACE WITH YOUR REAL ARTIST ROLE ID FROM KEYCLOAK
        { headers: { Authorization: `Bearer ${adminToken.data.access_token}`, 'Content-Type': 'application/json' } }
      );

      await client.query(
        'UPDATE users SET role = $1 WHERE keycloak_id = $2',
        ['artist', userId]
      );
      await client.query(
        'INSERT INTO artists (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING',
        [userId]
      );
    }

    await client.query('COMMIT');
    const message = approve ? 'Artist approved—roles assigned' : `Artist rejected: ${rejectionReason}`;
    res.json({ message });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Review artist error:', error.message);
    res.status(500).json({ error: 'Failed to review request', details: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/artists', keycloak.protect('realm:artist'), authPostLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { bio, portfolio } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO artists (user_id, bio, portfolio) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET bio = $2, portfolio = $3 RETURNING *',
      [userId, bio, portfolio]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.get('/api/artists', publicDataLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM artists');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.get('/api/artists/:id', publicDataLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM artists WHERE user_id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Artist not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.put('/api/artists/:id', keycloak.protect('realm:artist'), authPutLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  if (userId !== req.params.id) return res.status(403).json({ error: 'Unauthorized' });
  const { bio, portfolio } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE artists SET bio = $1, portfolio = $2 WHERE user_id = $3 RETURNING *',
      [bio, portfolio, userId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Artist not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Artwork Routes ---

app.post('/api/artworks', keycloak.protect('realm:artist'), artworkManagementLimiter, upload.single('image'), async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { title, description, price, category_id } = req.body;
  try {
    await validateCategory(category_id);
    const imagePath = validateImage(req.file);
    const artwork = await insertArtwork(title, description, price, userId, category_id);
    await insertArtworkImage(artwork.artwork_id, imagePath);
    res.status(201).json(artwork);
  } catch (error) {
    console.error('Database error:', error.message);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.post('/api/artworks/:id/images', keycloak.protect('realm:artist'), artworkManagementLimiter, upload.array('images', 5), async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const artworkId = req.params.id;
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No images uploaded' });
  try {
    const artwork = await pool.query('SELECT * FROM artworks WHERE artwork_id = $1 AND artist_id = $2', [artworkId, userId]);
    if (artwork.rows.length === 0) return res.status(404).json({ error: 'Artwork not found or unauthorized' });
    const values = req.files.map(file => `(${artworkId}, '${file.path}')`).join(',');
    await pool.query(`INSERT INTO artwork_images (artwork_id, image_path) VALUES ${values}`);
    res.json({ message: 'Images uploaded successfully', images: req.files.map(file => file.path) });
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.get('/api/artworks', publicDataLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.*, COALESCE(json_agg(ai.image_path) FILTER (WHERE ai.image_path IS NOT NULL), '[]') AS images
      FROM artworks a
      LEFT JOIN artwork_images ai ON a.artwork_id = ai.artwork_id
      GROUP BY a.artwork_id
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.get('/api/artworks/:id', publicDataLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.*, COALESCE(json_agg(ai.image_path) FILTER (WHERE ai.image_path IS NOT NULL), '[]') AS images
      FROM artworks a
      LEFT JOIN artwork_images ai ON a.artwork_id = ai.artwork_id
      WHERE a.artwork_id = $1
      GROUP BY a.artwork_id
    `, [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Artwork not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.put('/api/artworks/:id', keycloak.protect('realm:artist'), artworkManagementLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { title, description, price, category_id } = req.body;
  try {
    const { rows: artwork } = await pool.query('SELECT * FROM artworks WHERE artwork_id = $1 AND artist_id = $2', [req.params.id, userId]);
    if (artwork.length === 0) return res.status(404).json({ error: 'Artwork not found or unauthorized' });
    const { rows } = await pool.query(
      'UPDATE artworks SET title = $1, description = $2, price = $3, category_id = $4 WHERE artwork_id = $5 RETURNING *',
      [title, description, price, category_id, req.params.id]
    );
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.delete('/api/artworks/:id', keycloak.protect(), authDeleteLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const userRoles = req.kauth.grant.access_token.content.realm_access.roles;
  try {
    const { rows: artwork } = await pool.query('SELECT * FROM artworks WHERE artwork_id = $1', [req.params.id]);
    if (artwork.length === 0) return res.status(404).json({ error: 'Artwork not found' });
    if (artwork[0].artist_id !== userId && !userRoles.includes('admin')) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    await pool.query('DELETE FROM artworks WHERE artwork_id = $1', [req.params.id]);
    res.json({ message: 'Artwork deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Category Routes ---

app.post('/api/categories', keycloak.protect('realm:admin'), authPostLimiter, async (req, res) => {
  const { name, description } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO categories (name, description) VALUES ($1, $2) RETURNING *',
      [name, description]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.get('/api/categories', publicDataLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM categories');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.put('/api/categories/:id', keycloak.protect('realm:admin'), authPutLimiter, async (req, res) => {
  const { name, description } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE categories SET name = $1, description = $2 WHERE category_id = $3 RETURNING *',
      [name, description, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Category not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Search Route ---

app.post('/api/search', publicDataLimiter, async (req, res) => {
  const { query } = req.body;
  try {
    const { rows } = await pool.query(`
      SELECT a.*, 
        u.name AS artist_name,
        c.name AS category_name,
        COALESCE(json_agg(ai.image_path) FILTER (WHERE ai.image_path IS NOT NULL), '[]') AS images
      FROM artworks a
      JOIN artists ar ON a.artist_id = ar.user_id
      JOIN users u ON ar.user_id = u.user_id
      JOIN categories c ON a.category_id = c.category_id
      LEFT JOIN artwork_images ai ON a.artwork_id = ai.artwork_id
      WHERE a.title ILIKE $1 OR u.name ILIKE $1 OR c.name ILIKE $1
      GROUP BY a.artwork_id, u.name, c.name
    `, [`%${query}%`]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Order Routes ---

app.post('/api/orders', keycloak.protect('realm:buyer'), orderLimiter, requireTrustLevel(TRUST_LEVELS.VERIFIED), async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { artwork_id, total_amount } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO orders (buyer_id, artwork_id, total_amount) VALUES ($1, $2, $3) RETURNING *',
      [userId, artwork_id, total_amount]
    );
    await updateUserTrustAfterOrder(userId);
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.get('/api/orders', keycloak.protect(), authGetLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  try {
    const { rows } = await pool.query('SELECT * FROM orders WHERE buyer_id = $1', [userId]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.get('/api/orders/:id', keycloak.protect(), authGetLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM orders WHERE order_id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.put('/api/orders/:id/status', keycloak.protect('realm:admin'), authPutLimiter, async (req, res) => {
  const { status } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE orders SET status = $1 WHERE order_id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Order Items Routes ---

app.post('/api/order-items', keycloak.protect(), authPostLimiter, async (req, res) => {
  const { order_id, artwork_id, quantity, price } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO order_items (order_id, artwork_id, quantity, price) VALUES ($1, $2, $3, $4) RETURNING *',
      [order_id, artwork_id, quantity, price]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.get('/api/order-items/:order_id', keycloak.protect(), authGetLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [req.params.order_id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Payment Routes ---

app.post('/api/payments', keycloak.protect(), authPostLimiter, async (req, res) => {
  const { order_id, amount, payment_method, phone_number } = req.body;
  try {
    if (!order_id || !amount || !payment_method) {
      return res.status(400).json({ error: 'Missing required fields: order_id, amount, or payment_method' });
    }
    if (typeof amount !== 'number' || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }
    if ((payment_method === 'orange_money' || payment_method === 'myzaka') && !phone_number) {
      return res.status(400).json({ error: 'Phone number is required for mobile money payments' });
    }

    let paymentUrl, paymentRef;

    if (payment_method === 'paypal') {
      try {
        const response = await axios.post(
          'https://api.sandbox.paypal.com/v1/payments/payment',
          {
            intent: 'sale',
            payer: { payment_method: 'paypal' },
            transactions: [{ amount: { total: amount.toFixed(2), currency: 'BWP' }, description: 'Artwork Purchase' }],
            redirect_urls: { return_url: `${process.env.APP_URL}/payment-callback`, cancel_url: `${process.env.APP_URL}/payment-cancel` },
          },
          {
            headers: {
              Authorization: `Basic ${Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_SECRET}`).toString('base64')}`,
              'Content-Type': 'application/json',
            },
          }
        );
        paymentUrl = response.data.links.find(link => link.rel === 'approval_url').href;
        paymentRef = response.data.id;
      } catch (error) {
        console.error('PayPal API error:', error.message);
        return res.status(503).json({ error: 'PayPal service unavailable' });
      }
    } else if (payment_method === 'orange_money' || payment_method === 'myzaka') {
      const ussdCode = payment_method === 'orange_money' ? '*145#' : '*167#';
      paymentRef = `${payment_method}-${order_id}-${Date.now()}`;
      paymentUrl = `Please complete payment via USSD: ${ussdCode}`;
    } else {
      return res.status(400).json({ error: 'Unsupported payment method' });
    }

    const { rows } = await pool.query(
      'INSERT INTO payments (order_id, amount, status, payment_method, payment_url, payment_ref) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [order_id, amount, 'pending', payment_method, paymentUrl, paymentRef]
    );
    console.log('Payment initiated:', { payment_id: rows[0].payment_id, paymentRef });
    res.status(201).json({ paymentUrl });
  } catch (error) {
    console.error('Payment initiation error:', error.message);
    res.status(500).json({ error: 'Failed to initiate payment', details: error.message });
  }
});

app.get('/api/payments/:order_id', keycloak.protect(), authGetLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM payments WHERE order_id = $1', [req.params.order_id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.put('/api/payments/:id/status', keycloak.protect('realm:admin'), authPutLimiter, async (req, res) => {
  const { status } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE payments SET status = $1 WHERE payment_id = $2 RETURNING order_id',
      [status, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Payment not found' });

    if (status === 'completed') {
      const orderId = rows[0].order_id;
      const { rows: orderRows } = await pool.query(
        'SELECT artwork_id FROM orders WHERE order_id = $1',
        [orderId]
      );
      const artworkId = orderRows[0].artwork_id;
      const { rows: artworkRows } = await pool.query(
        'SELECT artist_id FROM artworks WHERE artwork_id = $1',
        [artworkId]
      );
      const artistId = artworkRows[0].artist_id;
      const { rows: userRows } = await pool.query(
        'SELECT email FROM users WHERE keycloak_id = $1',
        [artistId]
      );
      const artistEmail = userRows[0].email;

      const emailHtml = `
        <h1>Artwork Sold!</h1>
        <p>Congratulations, your artwork has been sold and payment has been completed. Please fulfill the order.</p>
      `;
      await sendEmail(artistEmail, 'Artwork Sale Completed', emailHtml);

      const system_user_id = process.env.SYSTEM_USER_ID;
      if (!system_user_id) throw new Error('SYSTEM_USER_ID not configured');
      const messageContent = 'Your artwork has been sold and payment is complete. Please fulfill the order.';
      await pool.query(
        'INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3)',
        [system_user_id, artistId, messageContent]
      );
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Payment status update error:', error.message);
    res.status(500).json({ error: 'Database or notification error', details: error.message });
  }
});

app.post('/api/payments/confirm', keycloak.protect(), async (req, res) => {
  const { order_id, transaction_ref } = req.body;
  const client = await pool.connect();
  try {
    if (!order_id || !transaction_ref) {
      return res.status(400).json({ error: 'Missing order_id or transaction_ref' });
    }
    if (!transaction_ref.startsWith('orange_money-') && !transaction_ref.startsWith('myzaka-')) {
      return res.status(400).json({ error: 'Invalid transaction reference' });
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      'UPDATE payments SET status = $1, payment_ref = $2 WHERE order_id = $3 RETURNING order_id',
      ['completed', transaction_ref, order_id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Payment not found' });

    const orderId = rows[0].order_id;
    const { rows: orderRows } = await client.query(
      'SELECT artwork_id, buyer_id FROM orders WHERE order_id = $1',
      [orderId]
    );
    const artworkId = orderRows[0].artwork_id;
    const buyerId = orderRows[0].buyer_id;

    const { rows: artworkRows } = await client.query(
      'SELECT artist_id, title FROM artworks WHERE artwork_id = $1',
      [artworkId]
    );
    const artistId = artworkRows[0].artist_id;
    const artworkTitle = artworkRows[0].title;

    const { rows: artistRows } = await client.query(
      'SELECT email FROM users WHERE keycloak_id = $1',
      [artistId]
    );
    const artistEmail = artistRows[0].email;

    const { rows: buyerRows } = await client.query(
      'SELECT email FROM users WHERE keycloak_id = $1',
      [buyerId]
    );
    const buyerEmail = buyerRows[0].email;

    const artistEmailHtml = `<h1>Artwork Sold!</h1><p>Your artwork "${artworkTitle}" has been sold and payment is complete. Please fulfill the order.</p>`;
    await sendEmail(artistEmail, 'Artwork Sale Completed', artistEmailHtml);

    const system_user_id = process.env.SYSTEM_USER_ID;
    if (!system_user_id) throw new Error('SYSTEM_USER_ID not configured');
    const artistMessage = `Your artwork "${artworkTitle}" is sold and paid. Fulfill the order.`;
    await client.query(
      'INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3)',
      [system_user_id, artistId, artistMessage]
    );

    const buyerEmailHtml = `<h1>Payment Confirmed</h1><p>Your payment for "${artworkTitle}" is complete. Thank you for your purchase!</p>`;
    await sendEmail(buyerEmail, 'Payment Confirmation', buyerEmailHtml);

    await client.query('COMMIT');
    res.status(200).json({ message: 'Payment confirmed' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('USSD confirmation error:', error.message);
    res.status(500).json({ error: 'Confirmation failed', details: error.message });
  } finally {
    client.release();
  }
});

// --- Review Routes ---

app.post('/api/reviews', keycloak.protect('realm:buyer'), authPostLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { artwork_id, rating, comment } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO reviews (artwork_id, user_id, rating, comment) VALUES ($1, $2, $3, $4) RETURNING *',
      [artwork_id, userId, rating, comment]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.get('/api/reviews/:artwork_id', publicDataLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM reviews WHERE artwork_id = $1', [req.params.artwork_id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Message Routes ---

app.post('/api/messages', keycloak.protect(), messageLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { receiver_id, content } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *',
      [userId, receiver_id, content]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- PayPal Callback ---

app.post('/payment-callback', express.json(), async (req, res) => {
  const { payment_status, txn_id, custom } = req.body;
  const client = await pool.connect();
  try {
    const allowedIps = ['66.211.170.66', '173.0.81.1']; // Example PayPal IPs
    if (!allowedIps.includes(req.ip)) {
      console.warn('Unauthorized callback attempt from IP:', req.ip);
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (payment_status === 'Completed') {
      const orderId = custom;
      await client.query('BEGIN');
      const { rows } = await client.query(
        'UPDATE payments SET status = $1, payment_ref = $2 WHERE order_id = $3 RETURNING order_id',
        ['completed', txn_id, orderId]
      );
      if (rows.length === 0) {
        console.error('Payment not found for order_id:', orderId);
        return res.status(404).json({ error: 'Payment not found' });
      }

      const { rows: orderRows } = await client.query(
        'SELECT artwork_id FROM orders WHERE order_id = $1',
        [orderId]
      );
      const artworkId = orderRows[0].artwork_id;
      const { rows: artworkRows } = await client.query(
        'SELECT artist_id, title FROM artworks WHERE artwork_id = $1',
        [artworkId]
      );
      const artistId = artworkRows[0].artist_id;
      const artworkTitle = artworkRows[0].title;

      const { rows: userRows } = await client.query(
        'SELECT email FROM users WHERE keycloak_id = $1',
        [artistId]
      );
      const artistEmail = userRows[0].email;

      const emailHtml = `<h1>Artwork Sold!</h1><p>Your artwork "${artworkTitle}" has been sold and payment is complete. Please fulfill the order.</p>`;
      await sendEmail(artistEmail, 'Artwork Sale Completed', emailHtml);

      const system_user_id = process.env.SYSTEM_USER_ID;
      if (!system_user_id) throw new Error('SYSTEM_USER_ID not configured');
      const messageContent = `Your artwork "${artworkTitle}" is sold and paid. Fulfill the order.`;
      await client.query(
        'INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3)',
        [system_user_id, artistId, messageContent]
      );
      await client.query('COMMIT');

      console.log('Payment completed and artist notified for order:', orderId);
    }
    res.status(200).json({ status: 'Processed' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('PayPal callback error:', error.message);
    res.status(500).json({ error: 'Callback processing failed', details: error.message });
  } finally {
    client.release();
  }
});

// --- Helper Functions ---

const validateCategory = async (category_id) => {
  const categoryResult = await pool.query('SELECT * FROM categories WHERE category_id = $1', [category_id]);
  if (categoryResult.rows.length === 0) throw new Error('Invalid category ID');
};

const validateImage = (file) => {
  if (!file) throw new Error('At least one image is required to create an artwork');
  const normalizedPath = path.normalize(file.path).replace(/^(\.\.(\/|\\|$))+/, '');
  if (/[^a-zA-Z0-9_\-\/\\\.]/.test(normalizedPath)) {
    throw new Error('Invalid characters in file path');
  }
  return normalizedPath;
};

const insertArtwork = async (title, description, price, user_id, category_id) => {
  try {
    const artworkResult = await pool.query(
      'INSERT INTO artworks (title, description, price, artist_id, category_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [title, description, price, user_id, category_id]
    );
    return artworkResult.rows[0];
  } catch (error) {
    console.error('Error inserting artwork:', error.message);
    throw new Error('Database error while inserting artwork');
  }
};

const insertArtworkImage = async (artwork_id, imagePath) => {
  try {
    await pool.query(
      'INSERT INTO artwork_images (artwork_id, image_path) VALUES ($1, $2)',
      [artwork_id, imagePath]
    );
  } catch (error) {
    console.error('Error inserting artwork image:', error.message);
    throw new Error('Database error while inserting artwork image');
  }
};

// Start the server
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));