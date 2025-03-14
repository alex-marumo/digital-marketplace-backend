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
const { pool } = require('./db'); // Single pool import
const { sendVerificationEmail } = require('./services/emailService');
const { createVerificationToken, verifyToken } = require('./services/verificationService');
const { verifyRecaptcha } = require('./services/recaptchaService');
const { registrationLimiter, orderLimiter } = require('./middleware/rateLimiter');
const { requireTrustLevel, TRUST_LEVELS, updateUserTrustAfterOrder } = require('./middleware/trustLevel');

const swaggerFile = path.join(__dirname, 'docs', 'openapi3_0.json');
const swaggerData = JSON.parse(fs.readFileSync(swaggerFile, 'utf8'));

const app = express();
const port = process.env.PORT || 3000;

// Middleware setup
app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(swaggerData));
app.use(express.json());
app.use(cors());
app.use(bodyParser.json());

// Keycloak middleware
app.use(keycloak.middleware());
// app.use(keycloak.middleware()); // Duplicate middleware removed
// Multer for file uploads
const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage });

// --- User Routes ---

// Pre-registration endpoint (before Keycloak signup)
app.post('/api/pre-register', registrationLimiter, async (req, res) => {
  const { recaptchaToken } = req.body;
  if (!recaptchaToken) return res.status(400).json({ error: 'reCAPTCHA required' });

  const recaptchaResult = await verifyRecaptcha(recaptchaToken);
  if (!recaptchaResult.success || recaptchaResult.score < 0.5) {
    return res.status(400).json({ error: 'reCAPTCHA verification failed' });
  }
  res.json({ redirect: `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/registrations` });
});

// Verify email endpoint
app.get('/api/verify-email', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const result = await verifyToken(token);
  if (!result.valid) return res.status(400).json({ error: 'Invalid or expired token' });

  await updateTrustLevel(result.userId, TRUST_LEVELS.VERIFIED);
  res.json({ message: 'Email verified' });
});

// Fetch User Profile (Authenticated)
app.get('/api/users/me', keycloak.protect(), async (req, res) => {
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
      const token = await createVerificationToken(keycloakId);
      await sendVerificationEmail(newUser[0], token);
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

// Update User Profile (Authenticated)
app.put('/api/users/me', keycloak.protect(), async (req, res) => {
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
    
    // Remove trailing comma and complete the query
    query = query.slice(0, -1) + ` WHERE user_id = $${values.length + 1} RETURNING user_id, name, email`;
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

// Create Artist Profile (Artist only)
app.post('/api/artists', keycloak.protect('realm:artist'), async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { bio, portfolio } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO artists (user_id, bio, portfolio) VALUES ($1, $2, $3) RETURNING *',
      [userId, bio, portfolio]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Fetch All Artists (Public)
app.get('/api/artists', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM artists');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Fetch Specific Artist (Public)
app.get('/api/artists/:id', async (req, res) => {
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

// Update Artist Profile (Artist only)
app.put('/api/artists/:id', keycloak.protect('realm:artist'), async (req, res) => {
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

// Add Artwork (Artist only)
app.post('/api/artworks', keycloak.protect('realm:artist'), upload.single('image'), async (req, res) => {
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

// Upload Images for Artwork (Artist only)
app.post('/api/artworks/:id/images', keycloak.protect('realm:artist'), upload.array('images', 5), async (req, res) => {
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

// Fetch All Artworks (Public)
app.get('/api/artworks', async (req, res) => {
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

// Fetch Single Artwork (Public)
app.get('/api/artworks/:id', async (req, res) => {
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

// Edit Artwork (Artist only)
app.put('/api/artworks/:id', keycloak.protect('realm:artist'), async (req, res) => {
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

// Delete Artwork (Artist or Admin only)
app.delete('/api/artworks/:id', keycloak.protect(), async (req, res) => {
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

// Add Category (Admin only)
app.post('/api/categories', keycloak.protect('realm:admin'), async (req, res) => {
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

// Fetch All Categories (Public)
app.get('/api/categories', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM categories');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Update Category (Admin only)
app.put('/api/categories/:id', keycloak.protect('realm:admin'), async (req, res) => {
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

// Search Artworks (Public)
app.post('/api/search', async (req, res) => {
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

// Place Order (Buyer only)
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

// Fetch User Orders (Authenticated)
app.get('/api/orders', keycloak.protect(), async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  try {
    const { rows } = await pool.query('SELECT * FROM orders WHERE buyer_id = $1', [userId]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Fetch Specific Order (Authenticated)
app.get('/api/orders/:id', keycloak.protect(), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM orders WHERE order_id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Update Order Status (Admin only)
app.put('/api/orders/:id/status', keycloak.protect('realm:admin'), async (req, res) => {
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

// Add Items to Order (Authenticated)
app.post('/api/order-items', keycloak.protect(), async (req, res) => {
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

// Fetch Order Items (Authenticated)
app.get('/api/order-items/:order_id', keycloak.protect(), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [req.params.order_id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Payment Routes ---

// Create Payment (Authenticated)
app.post('/api/payments', keycloak.protect(), async (req, res) => {
  const { order_id, amount } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO payments (order_id, amount, status) VALUES ($1, $2, $3) RETURNING *',
      [order_id, amount, 'pending']
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Fetch Payment Details (Authenticated)
app.get('/api/payments/:order_id', keycloak.protect(), async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM payments WHERE order_id = $1', [req.params.order_id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Update Payment Status (Admin only)
app.put('/api/payments/:id/status', keycloak.protect('realm:admin'), async (req, res) => {
  const { status } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE payments SET status = $1 WHERE payment_id = $2 RETURNING *',
      [status, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Review Routes ---

// Leave Review (Buyer only)
app.post('/api/reviews', keycloak.protect('realm:buyer'), async (req, res) => {
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

// Fetch Reviews for Artwork (Public)
app.get('/api/reviews/:artwork_id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM reviews WHERE artwork_id = $1', [req.params.artwork_id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Message Routes ---

// Send Message (Authenticated)
app.post('/api/messages', keycloak.protect(), async (req, res) => {
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
      'INSERT INTO artworks (title, description, price, user_id, category_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
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