require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors(
  //origin: 'http://your-frontend-domain.com'
));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Error connecting to the database:', err);
  } else {
    console.log('✅ Database connected successfully at', res.rows[0].now);
  }
});

const storage = multer.diskStorage({
  destination: './uploads/',
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}${path.extname(file.originalname)}`);
  },
});
const upload = multer({ storage });

// Middleware for authentication
const authenticate = (req, res, next) => {
  const token = req.header('Authorization')?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (error) {
    console.error('JWT Verification Error:', error.message); // 🔥 Log the actual error
    res.status(403).json({ error: 'Invalid or expired token' });
  }
};

// User Signup
app.post('/api/signup', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !['buyer', 'artist', 'admin'].includes(role))
    return res.status(400).json({ error: 'Invalid input' });

  try {
    // 🔥 Check if email already exists
    const existingUser = await pool.query('SELECT email FROM users WHERE email = $1', [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Email already exists. Please use a different one.' });
    }

    // Hash password and insert user
    const hashedPassword = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      'INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING user_id, name, email, role',
      [name, email, hashedPassword, role]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Signup Error:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// User Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password)))
      return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ user_id: rows[0].user_id, role: rows[0].role }, process.env.JWT_SECRET, { expiresIn: '1h' });
    res.json({ token });
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Fetch User Profile
app.get('/api/users/me', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT user_id, name, email, role FROM users WHERE user_id = $1', [req.user.user_id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Update User Profile
app.put('/api/users/me', authenticate, async (req, res) => {
  const { name, email, password } = req.body;
  try {
    // Build dynamic update query
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
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      values.push(hashedPassword);
      query += ` password = $${values.length},`;
    }
    
    // Remove trailing comma & add WHERE condition
    query = query.slice(0, -1) + ` WHERE user_id = $${values.length + 1} RETURNING user_id, name, email`;
    values.push(req.user.user_id);

    const { rows } = await pool.query(query, values);
    res.json({ message: 'Profile updated', user: rows[0] });
  } catch (error) {
    console.error('Update User Error:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Create an artist profile
app.post('/api/artists', authenticate, async (req, res) => {
  if (req.user.role !== 'artist') return res.status(403).json({ error: 'Only artists can create profiles' });
  const { bio, portfolio } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO artists (user_id, bio, portfolio) VALUES ($1, $2, $3) RETURNING *',
      [req.user.user_id, bio, portfolio]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Fetch all artists
app.get('/api/artists', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM artists');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Fetch a specific artist
app.get('/api/artists/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM artists WHERE user_id = $1',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Artist not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Update artist bio & portfolio (protected)
app.put('/api/artists/:id', authenticate, async (req, res) => {
  if (parseInt(req.user.user_id) !== parseInt(req.params.id)) return res.status(403).json({ error: 'Unauthorized' });
  const { bio, portfolio } = req.body;
  try {
    const { rows } = await pool.query(
      'UPDATE artists SET bio = $1, portfolio = $2 WHERE user_id = $3 RETURNING *',
      [bio, portfolio, req.params.id]
    );
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Add Artwork
app.post('/api/artworks', authenticate, upload.single('image'), async (req, res) => {
  if (req.user.role !== 'artist') return res.status(403).json({ error: 'Only artists can add artworks' });
  const { title, description, price, category_id } = req.body;
  try {
    const imagePath = req.file?.path || null;
    const { rows } = await pool.query(
      'INSERT INTO artworks (title, description, price, user_id, category_id, image_path) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [title, description, price, req.user.user_id, category_id, imagePath]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error' });
  }
});

// Upload images for an artwork
app.post('/api/artworks/:id/images', authenticate, upload.array('images', 5), async (req, res) => {
  if (req.user.role !== 'artist') return res.status(403).json({ error: 'Only artists can upload images' });

  const artworkId = req.params.id;
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No images uploaded' });

  try {
    const artwork = await pool.query('SELECT * FROM artworks WHERE artwork_id = $1 AND artist_id = $2', [artworkId, req.user.user_id]);
    if (artwork.rows.length === 0) return res.status(404).json({ error: 'Artwork not found or unauthorized' });

    const values = req.files.map(file => `(${artworkId}, '${file.path}')`).join(',');
    await pool.query(`INSERT INTO artwork_images (artwork_id, image_path) VALUES ${values}`);

    res.json({ message: 'Images uploaded successfully', images: req.files.map(file => file.path) });
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Fetch Artworks
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

// Fetch single artwork
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

// Edit artwork (only by the artist who uploaded it)
app.put('/api/artworks/:id', authenticate, async (req, res) => {
  const { title, description, price, category_id } = req.body;
  try {
    const { rows: artwork } = await pool.query('SELECT * FROM artworks WHERE artwork_id = $1', [req.params.id]);
    if (artwork.length === 0) return res.status(404).json({ error: 'Artwork not found' });
    if (parseInt(artwork[0].artist_id) !== parseInt(req.user.user_id)) return res.status(403).json({ error: 'Unauthorized' });
    const { rows } = await pool.query(
      'UPDATE artworks SET title = $1, description = $2, price = $3, category_id = $4 WHERE artwork_id = $5 RETURNING *',
      [title, description, price, category_id, req.params.id]
    );
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Delete artwork (only by the artist or admin)
app.delete('/api/artworks/:id', authenticate, async (req, res) => {
  try {
    const { rows: artwork } = await pool.query('SELECT * FROM artworks WHERE artwork_id = $1', [req.params.id]);
    if (artwork.length === 0) return res.status(404).json({ error: 'Artwork not found' });
    if (parseInt(artwork[0].artist_id) !== parseInt(req.user.user_id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    await pool.query('DELETE FROM artworks WHERE artwork_id = $1', [req.params.id]);
    res.json({ message: 'Artwork deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Add a new category (Admin only)
app.post('/api/categories', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can add categories' });
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

// Fetch all categories
app.get('/api/categories', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM categories');
    res.json(rows);
  } catch (error) {
    console.error('Fetch Categories Error:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Update category (admin only)
app.put('/api/categories/:id', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
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

// Search artworks by title, artist name, or category
app.post('/api/search', async (req, res) => {
  const { query } = req.body;
  try {
  const { rows } = await pool.query(`
        SELECT a.*, 
               ar.name AS artist_name, 
               c.name AS category_name,
               COALESCE(json_agg(ai.image_path) FILTER (WHERE ai.image_path IS NOT NULL), '[]') AS images
        FROM artworks a
        JOIN artists ar ON a.user_id = a.artist_id
        JOIN categories c ON a.category_id = c.category_id
        LEFT JOIN artwork_images ai ON a.artwork_id = ai.artwork_id
        WHERE a.title ILIKE $1 OR ar.name ILIKE $1 OR c.name ILIKE $1
        GROUP BY a.artwork_id, ar.name, c.name
    `, [`%${query}%`]);
    res.json(rows);
  } catch (error) {
  res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Place Order
app.post('/api/orders', authenticate, async (req, res) => {
  if (req.user.role !== 'buyer') return res.status(403).json({ error: 'Only buyers can place orders' });

  const { artwork_id, total_amount } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO orders (buyer_id, order_id, total_amount) VALUES ($1, $2, $3) RETURNING *',
      [req.user.user_id, artwork_id, total_amount]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    console.error('Order Creation Error:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Fetch User Orders
app.get('/api/orders', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM orders WHERE buyer_id = $1', [req.user.user_id]);
    res.json(rows);
  } catch (error) {
    console.error('Fetch Orders Error:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Fetch a specific order
app.get('/api/orders/:id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM orders WHERE order_id = $1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Update order status (admin only)
app.put('/api/orders/:id/status', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
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

// Add items to an order
app.post('/api/order-items', authenticate, async (req, res) => {
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

// Fetch items for a specific order
app.get('/api/order-items/:order_id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM order_items WHERE order_id = $1', [req.params.order_id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Create a payment record
app.post('/api/payments', authenticate, async (req, res) => {
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

// Fetch payment details for an order
app.get('/api/payments/:order_id', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM payments WHERE order_id = $1', [req.params.order_id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Update payment status (admin only)
app.put('/api/payments/:id/status', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Unauthorized' });
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

// Leave a review for an artwork
app.post('/api/reviews', authenticate, async (req, res) => {
  if (req.user.role !== 'buyer') return res.status(403).json({ error: 'Only buyers can leave reviews' });
  const { artwork_id, rating, comment } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO reviews (artwork_id, user_id, rating, comment) VALUES ($1, $2, $3, $4) RETURNING *',
      [artwork_id, req.user.user_id, rating, comment]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Send a message between users
app.post('/api/messages', authenticate, async (req, res) => {
  const { receiver_id, content } = req.body;
  try {
    const { rows } = await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *',
      [req.user.user_id, receiver_id, content]
    );
    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Filter artworks by category or artist
app.get('/api/artworks', async (req, res) => {
  const { category, artist } = req.query;
  let query = 'SELECT * FROM artworks';
  const conditions = [];
  const values = [];

  if (category) {
    conditions.push('category_id = $' + (values.length + 1));
    values.push(category);
  }
  if (artist) {
    conditions.push('artist_id = $' + (values.length + 1));
    values.push(artist);
  }
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  try {
    const { rows } = await pool.query(query, values);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Filter orders by status
app.get('/api/orders', authenticate, async (req, res) => {
  const { status } = req.query;
  let query = 'SELECT * FROM orders';
  const values = [];

  if (status) {
    query += ' WHERE status = $1';
    values.push(status);
  }
  try {
    const { rows } = await pool.query(query, values);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Fetch reviews for a specific artwork
app.get('/api/reviews/:artwork_id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM reviews WHERE artwork_id = $1', [req.params.artwork_id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// Delete user or artist account
app.delete('/api/users/me', authenticate, async (req, res) => {
  try {
    await pool.query('DELETE FROM artists WHERE user_id = $1', [req.user.user_id]);
    await pool.query('DELETE FROM users WHERE user_id = $1', [req.user.user_id]);
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.listen(port, () => console.log(`Server running on port ${port}`));
