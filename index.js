require('dotenv').config();
console.log('Keycloak Config:', {
  url: process.env.KEYCLOAK_URL,
  realm: process.env.KEYCLOAK_REALM,
  clientId: process.env.KEYCLOAK_CLIENT_ID,
  secret: process.env.KEYCLOAK_CLIENT_SECRET ? '****' : 'MISSING'
});
console.log('[ENV DEBUG] PayPal Config:', {
  clientId: process.env.PAYPAL_CLIENT_ID,
  clientSecret: process.env.PAYPAL_CLIENT_SECRET,
  appUrl: process.env.APP_URL
});

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const session = require('express-session');
const { keycloak, sessionStore } = require('./keycloak');
const axios = require('axios');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const swaggerUI = require('swagger-ui-express');
const { pool } = require('./db');
const { sendVerificationEmail, sendEmail } = require('./services/emailService');
const { createVerificationCode, verifyCode } = require('./services/verificationService');
const { verifyRecaptcha } = require('./services/recaptchaService');
// Ensure uploads folder exists
const fs = require('fs');
const uploadsDir = path.join(__dirname, 'Uploads', 'artworks');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const fsPromises = require('fs').promises;
const router = express.Router();

const mime = require('mime-types'); 

const paypal = require('@paypal/checkout-server-sdk');
const environment = new paypal.core.SandboxEnvironment(process.env.PAYPAL_CLIENT_ID, process.env.PAYPAL_CLIENT_SECRET);
const paypalClient = new paypal.core.PayPalHttpClient(environment);

const { registrationLimiter, orderLimiter, publicDataLimiter, messageLimiter, artworkManagementLimiter, authGetLimiter, authPostLimiter, authPutLimiter, authDeleteLimiter } = require('./middleware/rateLimiter');
console.log('Rate Limiters:', { registrationLimiter, orderLimiter, publicDataLimiter, messageLimiter, artworkManagementLimiter, authGetLimiter, authPostLimiter, authPutLimiter, authDeleteLimiter });

if (process.env.NODE_ENV === 'development') {
  console.debug('Keycloak Config:', {
    url: process.env.KEYCLOAK_URL,
    realm: process.env.KEYCLOAK_REALM,
    clientId: process.env.KEYCLOAK_CLIENT_ID,
    secret: process.env.KEYCLOAK_CLIENT_SECRET ? '****' : 'MISSING'
  });
}

// UUID validation
const isValidUUID = (str) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

const { requireTrustLevel } = require('./middleware/trustLevel');
const { TRUST_LEVELS, updateTrustLevel, updateUserTrustAfterOrder } = require('./services/trustService');

const swaggerFile = path.join(__dirname, 'docs', 'openapi3_0.json');

(async () => {
  const swaggerData = JSON.parse(await fsPromises.readFile(swaggerFile, 'utf8'));

  const app = express();
  const port = process.env.PORT || 3000;
  app.set('trust proxy', 1);

  // Swagger setup
  app.use('/api-docs', swaggerUI.serve, swaggerUI.setup(swaggerData));

  // CORS config
  app.use(cors({ 
    origin: "http://localhost:3001",
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type']
  }));

  app.use(express.json());
  app.use(bodyParser.json());

  app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || "your-secret-here",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === 'production',
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      sameSite: 'lax'
    }
  }));

  app.use((req, res, next) => {
    console.log('Session exists pre-Keycloak:', !!req.session);
    if (req.session) req.session.test = 'test-value';
    next();
  });

  app.use(keycloak.middleware());

  app.use('/uploads', express.static(path.join(__dirname, 'Uploads')));

  app.get('/test-session', publicDataLimiter, (req, res) => {
    console.log('Test route - req.session:', req.session);
    res.json({ session: req.session ? 'alive' : 'dead', test: req.session?.test });
  });

  const { createProxyMiddleware } = require('http-proxy-middleware');
  app.use(
    '/keycloak',
    createProxyMiddleware({
      target: process.env.KEYCLOAK_URL || 'http://localhost:8080',
      changeOrigin: true,
      pathRewrite: { '^/keycloak': '' },
      onProxyRes: (proxyRes) => {
        proxyRes.headers['Access-Control-Allow-Origin'] = 'http://localhost:3001';
        proxyRes.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS';
        proxyRes.headers['Access-Control-Allow-Headers'] = 'Authorization,Content-Type';
      },
    })
  );

  // Multer setup for general uploads (artworks)
  if (!fs.existsSync('Uploads/artworks')) {
  fs.mkdirSync('Uploads/artworks', { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'Uploads/artworks/');
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${req.kauth.grant.access_token.content.sub}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = filetypes.test(file.mimetype);
    if (extname && mimetype) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG/PNG images allowed'));
    }
  },
});

  // Multer setup for artist verification
  const artistStorage = multer.diskStorage({
    destination: path.join(__dirname, 'Uploads', 'artist_verification'),
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
    limits: { fileSize: 5 * 1024 * 1024 },
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

  // Multer setup for profile photos
  const profileStorage = multer.diskStorage({
    destination: './Uploads/profiles/',
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${req.kauth.grant.access_token.content.sub}-${Date.now()}${ext}`);
    },
  });

  const profileUpload = multer({
    storage: profileStorage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!['.jpg', '.jpeg', '.png'].includes(ext)) {
        return cb(new Error('Only JPG, JPEG, or PNG allowed'));
      }
      cb(null, true);
    },
  }).single('profilePhoto');

// --- User Routes ---

app.post('/api/pre-register', registrationLimiter, async (req, res) => {
  console.log('Pre-register hit:', req.body);
  const { recaptchaToken, email, name, password } = req.body;
  if (!recaptchaToken || !email || !name || !password) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const recaptchaResult = await verifyRecaptcha(recaptchaToken);
  console.log('reCAPTCHA result:', recaptchaResult);
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

    // Get admin token
    const adminTokenResponse = await axios.post(
      `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.KEYCLOAK_CLIENT_ID,
        client_secret: process.env.KEYCLOAK_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    console.log('Admin token response:', {
      status: adminTokenResponse.status,
      token: adminTokenResponse.data.access_token ? '****' : 'MISSING'
    });

    // Create user in Keycloak
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
          Authorization: `Bearer ${adminTokenResponse.data.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('Keycloak user creation response:', {
      status: userResponse.status,
      headers: userResponse.headers,
      data: userResponse.data
    });

    // Extract keycloakId
    const location = userResponse.headers.location;
    if (!location) {
      throw new Error('No location header in Keycloak response');
    }
    const keycloakId = location.split('/').pop();
    console.log('Extracted keycloakId:', keycloakId);

    // Insert into database
    const { rows } = await pool.query(
      'INSERT INTO users (keycloak_id, name, email, role, is_verified, trust_level, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [keycloakId, name, email, 'buyer', false, TRUST_LEVELS.NEW, 'pending_email_verification']
    );

    const code = await createVerificationCode(keycloakId);
    await sendVerificationEmail(rows[0], code);

    res.status(201).json({ message: 'User registered, enter the code from your email in the app' });
  } catch (error) {
    console.error('Registration error:', {
      message: error.message,
      response: error.response ? {
        status: error.response.status,
        data: error.response.data
      } : null
    });
    if (error.message.includes('duplicate key')) {
      return res.status(409).json({ error: 'Email already registered' });
    }
    res.status(500).json({ error: 'Registration failed', details: error.message });
  }
});

app.post('/api/verify-email-code', registrationLimiter, async (req, res) => {
  console.log('Verify email request:', req.body);
  const { code, email } = req.body;
  if (!code || !email) return res.status(400).json({ error: 'Missing code or email' });

  try {
    const { rows } = await pool.query('SELECT keycloak_id FROM users WHERE email = $1', [email]);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const keycloakId = rows[0].keycloak_id;

    const result = await verifyCode(keycloakId, code);
    console.log('Verification result:', result);
    if (!result.valid) return res.status(400).json({ error: 'Invalid or expired code' });

    // Update Keycloak
    const adminToken = await axios.post(
      `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.KEYCLOAK_CLIENT_ID,
        client_secret: process.env.KEYCLOAK_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    await axios.put(
      `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${keycloakId}`,
      { emailVerified: true },
      {
        headers: {
          Authorization: `Bearer ${adminToken.data.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // Update database
    const { rows: updatedUser } = await pool.query(
      'UPDATE users SET is_verified = $1, status = $2 WHERE keycloak_id = $3 RETURNING *',
      [true, 'pending_role_selection', keycloakId]
    );
    console.log('Updated user status:', updatedUser[0].status);

    res.json({ message: 'Email verified, please select your role' });
  } catch (error) {
    console.error('Code verification error:', error.message);
    res.status(500).json({ error: 'Verification failed', details: error.message });
  }
});

app.post('/api/select-role', keycloak.protect(), authPostLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { role } = req.body;
  if (!['buyer', 'artist'].includes(role)) {
    return res.status(400).json({ error: 'Pick buyer or artist' });
  }
  const newStatus = role === 'buyer' ? 'verified' : 'pending_verification';

  try {
    const { rows } = await pool.query(
      'UPDATE users SET role = $1, status = $2 WHERE keycloak_id = $3 RETURNING *',
      [role, newStatus, userId]
    );
    console.log('DB:', rows[0]);

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
    const tokenPayload = adminToken.split('.')[1];
    const decoded = JSON.parse(Buffer.from(tokenPayload, 'base64').toString());
    console.log('Admin token scope:', decoded.scope);
    console.log('Admin token roles:', decoded.realm_access?.roles);

    const rolesResponse = await axios.get(
      `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/roles`,
      { headers: { Authorization: `Bearer ${adminToken}` } }
    );
    const roleToAssign = rolesResponse.data.find(r => r.name === role);
    if (!roleToAssign) {
      console.log('Available roles:', rolesResponse.data);
      throw new Error(`Role ${role} not found`);
    }
    console.log('Role:', roleToAssign);

    await axios.post(
      `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${userId}/role-mappings/realm`,
      [{ id: roleToAssign.id, name: roleToAssign.name }],
      {
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log(`Assigned ${role}`);

    res.json({ message: `Role ${role} set` });
  } catch (error) {
    console.error('Error:', error.message, error.response?.status, error.response?.data);
    res.status(500).json({ error: 'Failed to set role', details: error.message });
  }
});

app.post('/api/upload-artist-docs', keycloak.protect(), artistUpload, authPostLimiter, async (req, res) => {
  console.log('Incoming fields:', req.body);
  console.log('Incoming files:', req.files);

  const userId = req.kauth.grant.access_token.content.sub;
  const { files } = req;

  if (!files?.idDocument || !files?.proofOfWork) {
    return res.status(400).json({ error: 'Missing required files: idDocument or proofOfWork' });
  }

  try {
    const idPath = files.idDocument[0].path;
    const proofPath = files.proofOfWork[0].path;
    const selfiePath = files.selfie?.[0]?.path || null;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'INSERT INTO artist_requests (user_id, id_document_path, proof_of_work_path, selfie_path, status, requested_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING request_id',
        [userId, idPath, proofPath, selfiePath, 'pending']
      );
      const requestId = rows[0].request_id;
      console.log('Inserted artist request:', { requestId, userId, idPath, status: 'pending' });

      // Verify insert
      const { rows: verifyRows } = await client.query(
        'SELECT request_id, user_id, status FROM artist_requests WHERE request_id = $1',
        [requestId]
      );
      console.log('Verified artist request in DB:', verifyRows[0]);

      await client.query(
        'UPDATE users SET status = $1 WHERE keycloak_id = $2',
        ['pending_admin_review', userId]
      );
      console.log('Updated user status to pending_admin_review for:', userId);

      await client.query('COMMIT');
      console.log('Transaction committed for request:', requestId);

      // Post-commit check
      const { rows: postCommitRows } = await pool.query(
        'SELECT request_id, user_id, status FROM artist_requests WHERE request_id = $1',
        [requestId]
      );
      console.log('Post-commit check:', postCommitRows[0]);

      const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
      const emailHtml = `
        <h1>New Artist Request</h1>
        <p>User ${userId} submitted an artist request (ID: ${requestId}). Review portfolio: ${proofPath}.</p>
      `;
      try {
        await sendEmail(adminEmail, 'New Artist Verification Request', emailHtml);
        console.log('Admin email sent for request:', requestId);
      } catch (emailError) {
        console.error('Admin email failed:', emailError.message);
        await pool.query(
          'INSERT INTO system_logs (event_type, details) VALUES ($1, $2)',
          ['email_failure', `Failed to notify admin for request ${requestId}: ${emailError.message}`]
        );
      }

      res.json({ message: 'Documents uploaded—awaiting admin approval', requestId });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Upload error:', error.message, error.stack);
      res.status(500).json({ error: 'Upload failed', details: error.message });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Upload error:', error.message, error.stack);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

// List all pending artist requests
app.get('/api/admin/artist-requests/pending', keycloak.protect('realm:admin'), authGetLimiter, async (req, res) => {
  try {
    // Main query
    const { rows } = await pool.query(
      `SELECT ar.*, u.email, u.name
       FROM artist_requests ar
       LEFT JOIN users u ON ar.user_id = u.keycloak_id
       WHERE LOWER(ar.status) = 'pending'
       ORDER BY ar.requested_at ASC`
    );
    console.log('Fetched pending artist requests:', {
      count: rows.length,
      requestIds: rows.map(r => r.request_id),
      usersMissing: rows.filter(r => !r.email).map(r => r.user_id),
      rawRows: rows
    });

    // Debug query: all rows
    const { rows: allRows } = await pool.query(
      `SELECT request_id, user_id, status, requested_at FROM artist_requests`
    );
    console.log('All artist_requests rows:', allRows);

    res.json(rows);
  } catch (error) {
    console.error('Error fetching requests:', error.message, error.stack);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});
// Stream document file
app.get('/api/admin/artist-requests/:requestId/file/:type', keycloak.protect('realm:admin'), authGetLimiter, async (req, res) => {
  try {
    const { requestId, type } = req.params;
    const accessToken = req.query.access_token || req.kauth?.grant?.access_token?.token;
    const userId = req.kauth?.grant?.access_token?.content?.sub || (accessToken ? keycloak.verifyToken(accessToken)?.content?.sub : null);
    const roles = req.kauth?.grant?.access_token?.content?.realm_access?.roles || (accessToken ? keycloak.verifyToken(accessToken)?.content?.realm_access?.roles : []);
    console.log('Fetching document:', { requestId, type, userId, roles, hasQueryToken: !!req.query.access_token });
    const validTypes = ['id_document', 'proof_of_work', 'selfie'];
    if (!validTypes.includes(type)) {
      console.error('Invalid document type:', type);
      return res.status(400).json({ error: 'Invalid document type' });
    }
    if (!roles.includes('admin')) {
      console.error('User lacks admin role:', { userId, roles });
      return res.status(403).json({ error: 'Admin role required' });
    }
    const column = type === 'id_document' ? 'id_document_path' :
                   type === 'proof_of_work' ? 'proof_of_work_path' : 'selfie_path';
    
    const { rows } = await pool.query(
      `SELECT ${column} AS file_path FROM artist_requests WHERE request_id = $1`,
      [requestId]
    );
    console.log('DB query result:', { requestId, type, rows, file_path: rows[0]?.file_path });
    if (!rows.length || !rows[0].file_path) {
      console.error('Document not found in DB:', { requestId, type, rows });
      return res.status(404).json({ error: 'Document not found in database' });
    }
    const baseDir = path.resolve(__dirname, 'Uploads', 'artist_verification');
    const rawFilePath = rows[0].file_path;
    const cleanedFileName = path.basename(rawFilePath.replace(/^.*artist_verification[\\/]?/i, '')).toLowerCase();
    const filePath = path.join(baseDir, cleanedFileName);
    console.log('File path details:', {
      rawFilePath,
      cleanedFileName,
      filePath,
      baseDir,
      cwd: __dirname
    });

    let fileExists = false;
    try {
      await fs.access(filePath, fs.constants.R_OK);
      fileExists = true;
      console.log('File exists and is readable:', filePath);
    } catch (err) {
      console.warn('File access failed:', { filePath, error: err.message });
    }

    if (!fileExists) {
      let files = [];
      try {
        files = await fs.readdir(baseDir);
        const matchingFile = files.find(f => f.toLowerCase() === cleanedFileName);
        if (matchingFile) {
          console.log('Found matching file with different case:', matchingFile);
          const altFilePath = path.join(baseDir, matchingFile);
          try {
            await fs.access(altFilePath, fs.constants.R_OK);
            return await streamFile(res, altFilePath);
          } catch (altErr) {
            console.warn('Alternate file access failed:', { altFilePath, error: altErr.message });
          }
        }
        console.error('File missing on disk:', { filePath, requestId, type, availableFiles: files });
        return res.status(404).json({ error: 'File missing on disk', availableFiles: files });
      } catch (dirErr) {
        console.error('Directory read failed:', { baseDir, error: dirErr.message });
        return res.status(403).json({ error: 'Cannot access directory', details: dirErr.message });
      }
    }
    await streamFile(res, filePath);
  } catch (error) {
    console.error('Error streaming document:', {
      message: error.message,
      stack: error.stack,
      requestId: req.params.requestId,
      type: req.params.type
    });
    res.status(500).json({ error: 'Server error', details: error.message, stack: error.stack });
  }
});

// Review artist request
app.post('/api/admin/artist-requests/:requestId/review', keycloak.protect('realm:admin'), authPostLimiter, async (req, res) => {
  const { requestId } = req.params;
  const { status, rejection_reason } = req.body;
  const reviewerId = req.kauth.grant.access_token.content.sub;

  console.log('📥 Review request:', { requestId, status, rejection_reason, reviewerId });

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (status === 'rejected' && !rejection_reason?.trim()) {
    return res.status(400).json({ error: 'Rejection reason required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🔍 Fetching artist request:', { requestId });
    const { rows } = await client.query(
      'SELECT user_id, id_document_path, proof_of_work_path, selfie_path FROM artist_requests WHERE request_id = $1 AND status = $2',
      [requestId, 'pending']
    );
    if (!rows.length) {
      console.log('❌ Request not found or already reviewed:', { requestId });
      return res.status(404).json({ error: 'Request not found or already reviewed' });
    }
    const { user_id: userId } = rows[0];
    console.log('✅ Found request:', { userId });

    console.log('🔄 Updating artist_requests:', { status, rejection_reason });
    await client.query(
      'UPDATE artist_requests SET status = $1, rejection_reason = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP WHERE request_id = $4',
      [status, rejection_reason || null, reviewerId, requestId]
    );

    if (status === 'approved') {
      console.log('🔄 Updating user to artist:', { userId });
      const { rows: userRows } = await client.query(
        'UPDATE users SET role = $1, status = $2 WHERE keycloak_id = $3 RETURNING user_id',
        ['artist', 'verified', userId]
      );
      if (!userRows.length) throw new Error('User not found in users table');
      const dbUserId = userRows[0].user_id;
      console.log('✅ Updated user:', { dbUserId });

      console.log('🔄 Inserting into artists table:', { dbUserId });
      await client.query(
        'INSERT INTO artists (user_id, bio, portfolio) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING',
        [dbUserId, '', '']
      );

      try {
        console.log('🔄 Fetching Keycloak admin token');
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
        if (!adminToken) throw new Error('No admin token received');
        console.log('✅ Admin token received');

        console.log('🔄 Fetching Keycloak roles');
        const rolesResponse = await axios.get(
          `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/roles`,
          { headers: { Authorization: `Bearer ${adminToken}` } }
        );
        const artistRole = rolesResponse.data.find(r => r.name === 'artist');
        if (!artistRole) throw new Error('Artist role not found in Keycloak');
        console.log('✅ Found artist role:', artistRole);

        console.log('🔄 Assigning artist role in Keycloak:', { userId });
        await axios.post(
          `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${userId}/role-mappings/realm`,
          [{ id: artistRole.id, name: artistRole.name }],
          {
            headers: {
              Authorization: `Bearer ${adminToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
        console.log('✅ Artist role assigned');
      } catch (keycloakError) {
        console.error('⚠️ Keycloak error (continuing):', keycloakError.message);
        try {
          await pool.query(
            'INSERT INTO system_logs (event_type, details) VALUES ($1, $2)',
            ['keycloak_failure', `Failed to assign artist role for user ${userId}: ${keycloakError.message}`]
          );
        } catch (logError) {
          console.error('⚠️ Failed to log Keycloak error:', logError.message);
        }
      }
    }

    console.log('📧 Fetching user for notification:', { userId });
    const { rows: userRows } = await client.query('SELECT email, name FROM users WHERE keycloak_id = $1', [userId]);
    if (!userRows.length) throw new Error('User not found for notification');
    const emailHtml = status === 'approved'
      ? `<h1>Artist Verification Approved!</h1><p>Congratulations, ${userRows[0].name}! You’re now an approved artist. Start uploading your artworks!</p>`
      : `<h1>Artist Verification Rejected</h1><p>Sorry, ${userRows[0].name}. Your request was rejected. Reason: ${rejection_reason}. Please resubmit or contact support.</p>`;
    try {
      console.log('📧 Sending email to:', userRows[0].email);
      await sendEmail(userRows[0].email, `Artist Verification ${status.charAt(0).toUpperCase() + status.slice(1)}`, emailHtml);
      console.log('✅ Email sent');
    } catch (emailError) {
      console.error('⚠️ Email sending failed:', emailError.message);
      try {
        await pool.query(
          'INSERT INTO system_logs (event_type, details) VALUES ($1, $2)',
          ['email_failure', `Failed to send review notification for request ${requestId}: ${emailError.message}`]
        );
      } catch (logError) {
        console.error('⚠️ Failed to log email error:', logError.message);
      }
    }

    await client.query('COMMIT');
    console.log(`✅ Request ${requestId} ${status} by ${reviewerId}`);
    res.json({ message: `Request ${status}` });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Review error:', error.message, error.stack);
    res.status(500).json({ error: 'Review failed', details: error.message });
  } finally {
    client.release();
  }
});

// Generate a signed URL
app.get('/api/admin/artist-requests/:requestId/file/:type/signed-url', keycloak.protect('realm:admin'), authGetLimiter, async (req, res) => {
  try {
    const { requestId, type } = req.params;
    const validTypes = ['id_document', 'proof_of_work', 'selfie'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: 'Invalid document type' });
    }
    const column = type === 'id_document' ? 'id_document_path' :
                   type === 'proof_of_work' ? 'proof_of_work_path' : 'selfie_path';
    
    const { rows } = await pool.query(
      `SELECT ${column} AS file_path FROM artist_requests WHERE request_id = $1`,
      [requestId]
    );
    if (!rows.length || !rows[0].file_path) {
      return res.status(404).json({ error: 'Document not found' });
    }
    
    // Create a signed token (expires in 5 minutes)
    const token = crypto.randomBytes(32).toString('hex');
    const expires = Date.now() + 5 * 60 * 1000; // 5 minutes
    await pool.query(
      'INSERT INTO signed_urls (token, file_path, expires_at) VALUES ($1, $2, $3)',
      [token, rows[0].file_path, new Date(expires)]
    );
    
    const signedUrl = `http://localhost:3001/api/admin/artist-requests/file?token=${token}`;
    res.json({ signedUrl });
  } catch (error) {
    console.error('Error generating signed URL:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Serve the file with the token
app.get('/api/admin/artist-requests/file', authGetLimiter, async (req, res) => {
  const { token } = req.query;
  if (!token) {
    return res.status(400).json({ error: 'Missing token' });
  }
  try {
    const { rows } = await pool.query(
      'SELECT file_path FROM signed_urls WHERE token = $1 AND expires_at > NOW()',
      [token]
    );
    if (!rows.length) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    const filePath = path.join(__dirname, rows[0].file_path);
    try {
      await fsPromises.access(filePath, fs.constants.R_OK);
    } catch (err) {
      return res.status(404).json({ error: 'File not found or not readable' });
    }
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3001');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
    const stream = require('fs').createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('Stream error:', { filePath, error: err.message });
      res.status(500).json({ error: 'Failed to stream file', details: err.message });
    });
    stream.pipe(res);
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({ error: 'Server error' });
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
  const keycloakId = req.kauth.grant.access_token.content.sub;
  console.log('Keycloak ID from token:', keycloakId);
  try {
    const keycloakId = req.kauth.grant.access_token.content.sub;
    const emailVerified = req.kauth.grant.access_token.content.email_verified || false;
    const { rows } = await pool.query(
      'SELECT user_id, name, email, role, is_verified, trust_level, status, profile_photo FROM users WHERE keycloak_id = $1',
      [keycloakId]
    );

    if (rows.length === 0) {
      const userName = req.kauth.grant.access_token.content.name || 'Unknown';
      const userEmail = req.kauth.grant.access_token.content.email || 'unknown@example.com';
      const { rows: newUser } = await pool.query(
        'INSERT INTO users (keycloak_id, name, email, role, is_verified, trust_level, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
        [keycloakId, userName, userEmail, 'buyer', emailVerified, TRUST_LEVELS.NEW, emailVerified ? 'pending_role_selection' : 'pending_email_verification']
      );
      if (!emailVerified) {
        const code = await createVerificationCode(keycloakId);
        await sendVerificationEmail(newUser[0], code);
      }
      return res.status(201).json({ message: emailVerified ? 'User synced' : 'User created, please verify your email', user: newUser[0] });
    }

    // Sync is_verified with Keycloak
    if (rows[0].is_verified !== emailVerified) {
      const { rows: updated } = await pool.query(
        'UPDATE users SET is_verified = $1 WHERE keycloak_id = $2 RETURNING *',
        [emailVerified, keycloakId]
      );
      console.log(`Synced is_verified for ${keycloakId}: ${emailVerified}`);
      return res.json(updated[0]);
    }

    console.log('User fetched:', rows[0]); // Debug log
    res.json(rows[0]);
  } catch (error) {
    console.error('User fetch error:', error.message);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.put('/api/users/me', keycloak.protect(), authPutLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { name, email } = req.body;
  try {
    // Update local database
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

    // Update Keycloak
    if (name || email) {
      const adminTokenResponse = await axios.post(
        `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
        new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: process.env.KEYCLOAK_CLIENT_ID,
          client_secret: process.env.KEYCLOAK_CLIENT_SECRET,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      try {
        await axios.put(
          `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${userId}`,
          {
            firstName: name ? name.split(' ')[0] : undefined,
            lastName: name ? name.split(' ')[1] || '' : undefined,
            email: email || undefined,
            username: email || undefined, // Sync username with email
          },
          {
            headers: {
              Authorization: `Bearer ${adminTokenResponse.data.access_token}`,
              'Content-Type': 'application/json',
            },
          }
        );
        console.log(`Updated Keycloak for user ${userId}: email=${email}, username=${email}`);
      } catch (keycloakError) {
        if (keycloakError.response?.status === 409) {
          return res.status(409).json({ error: 'Email already in use' });
        }
        throw keycloakError; // Rethrow other errors
      }
    }

    res.json({ message: 'Profile updated', user: rows[0] });
  } catch (error) {
    console.error('Update User Error:', error.message);
    res.status(500).json({ error: 'Database or Keycloak error', details: error.message });
  }
});

// Profile Photo Upload
app.post('/api/users/me/photo', keycloak.protect(), authPostLimiter, profileUpload, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  if (!req.file) {
    return res.status(400).json({ error: 'No photo uploaded' });
  }
  try {
    const photoPath = req.file.path.replace(/\\/g, '/');
    const { rows } = await pool.query(
      'UPDATE users SET profile_photo = $1 WHERE keycloak_id = $2 RETURNING user_id, profile_photo',
      [photoPath, userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const photoUrl = `http://localhost:3000/api/users/${userId}/photo`;
    console.log('Uploaded file:', req.file);
    res.json({ message: 'Profile photo uploaded', pictureUrl: photoUrl });
  } catch (error) {
    console.error('Profile photo upload error:', error.message);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

// Profile Update 
app.put('/api/profile', keycloak.protect(), authPutLimiter, async (req, res) => {
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
    query = query.slice(0, -1) + ` WHERE keycloak_id = $${values.length + 1} RETURNING user_id, name, email, profile_photo`;
    values.push(userId);
    const { rows } = await pool.query(query, values);
    if (rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const user = rows[0];
    user.pictureUrl = user.profile_photo ? `http://localhost:3000/api/users/${userId}/photo` : null;
    res.json({ message: 'Profile updated', user });
  } catch (error) {
    console.error('Update User Error:', error);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.get('/api/users/:userId/photo', publicDataLimiter, async (req, res) => {
  try {
    const { userId } = req.params;
    console.log('Serving photo for userId:', userId);

    // Validate UUID
    if (!isValidUUID(userId)) {
      console.warn('Invalid userId format:', userId);
      return res.status(400).json({ error: 'Invalid user ID format' });
    }

    // Fetch profile photo path
    const { rows } = await pool.query(
      'SELECT profile_photo FROM users WHERE keycloak_id = $1 AND status != $2',
      [userId, 'deleted']
    );
    if (!rows.length || !rows[0].profile_photo) {
      console.warn('No profile photo found for userId:', userId);
      return res.status(404).json({ error: 'Photo not found' });
    }

    // Resolve file path
    const photoPath = rows[0].profile_photo.replace(/\\/g, '/'); // Normalize slashes
    const filePath = path.resolve(__dirname, photoPath);
    console.log('Resolved filePath:', filePath);

    // Check file existence and readability using fsPromises
    try {
      await fsPromises.access(filePath, fs.constants.R_OK);
      console.log('File accessible:', filePath);
    } catch (err) {
      console.error('File access error:', { filePath, error: err.message });
      return res.status(404).json({ error: 'Photo file not found or inaccessible' });
    }

    // Set headers
    const contentType = mime.lookup(filePath) || 'image/jpeg';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3001');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');

    // Serve file with callback
    res.sendFile(filePath, (err) => {
      if (err) {
        console.error('SendFile error:', { filePath, error: err.message });
        res.status(500).json({ error: 'Failed to serve photo', details: err.message });
      } else {
        console.log('Photo served successfully:', filePath);
      }
    });
  } catch (error) {
    console.error('Serve photo error:', { message: error.message, stack: error.stack });
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

app.put('/api/settings', keycloak.protect(), authPutLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { emailNotifications } = req.body;

  if (typeof emailNotifications !== 'boolean') {
    return res.status(400).json({ error: 'emailNotifications must be a boolean' });
  }

  try {
    const { rows } = await pool.query(
      'UPDATE users SET email_notifications = $1 WHERE keycloak_id = $2 RETURNING user_id, email_notifications',
      [emailNotifications, userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    console.log('Settings updated:', { userId, emailNotifications: rows[0].email_notifications });
    res.json({ message: 'Settings updated', settings: rows[0] });
  } catch (error) {
    console.error('Settings update error:', error.message);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.post('/api/reset-password', keycloak.protect(), authPostLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const { rows } = await pool.query(
      'SELECT email FROM users WHERE keycloak_id = $1 AND email = $2',
      [userId, email]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'User or email not found' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Store reset token in DB
    await pool.query(
      'INSERT INTO password_resets (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [userId, resetToken, expiresAt]
    );

    // Send reset email
    const resetUrl = `${process.env.APP_URL}/reset-password?token=${resetToken}&userId=${userId}`;
    const emailHtml = `
      <h1>Password Reset Request</h1>
      <p>Click the link below to reset your password. This link expires in 15 minutes.</p>
      <a href="${resetUrl}">${resetUrl}</a>
    `;
    await sendEmail(email, 'Reset Your ARTISTIC Password', emailHtml);
    console.log('Password reset email sent:', { userId, email });
    res.json({ message: 'Password reset email sent' });
  } catch (error) {
    console.error('Reset password error:', error.message);
    res.status(500).json({ error: 'Failed to send reset email', details: error.message });
  }
});

app.post('/api/delete-account', keycloak.protect(), authPostLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;

  const client = await pool.connect();
   try {
    await client.query('BEGIN');

    // Check if user exists and is not already deleted
    const { rows } = await client.query(
      'SELECT status FROM users WHERE keycloak_id = $1',
      [userId]
    );
    if (rows.length === 0) {
    return res.status(404).json({ error: 'User not found' });
    }
    if (rows[0].status === 'deleted') {
      return res.status(400).json({ error: 'Account already deleted' });
    }

    // Soft delete in database
    await client.query(
      'UPDATE users SET status = $1, email = $2, name = $3 WHERE keycloak_id = $4',
      ['deleted', `deleted_${userId}@example.com`, 'Deleted User', userId]
    );

    // Disable user in Keycloak
    const adminTokenResponse = await axios.post(
      `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.KEYCLOAK_CLIENT_ID,
        client_secret: process.env.KEYCLOAK_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    await axios.put(
    `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${userId}`,
      { enabled: false },
      {
        headers: {
          Authorization: `Bearer ${adminTokenResponse.data.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    await client.query('COMMIT');
    console.log('Account deleted:', { userId });
    res.json({ message: 'Account deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Delete account error:', error.message);
    res.status(500).json({ error: 'Failed to delete account', details: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/change-password', keycloak.protect(), authPostLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { oldPassword, newPassword } = req.body;

  if (!oldPassword || !newPassword) {
    return res.status(400).json({ error: 'Old and new passwords are required' });
  }

  try {
    // Verify old password by attempting to get a token
    const email = req.kauth.grant.access_token.content.email;
    try {
      await axios.post(
       `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
        new URLSearchParams({
          grant_type: 'password',
          client_id: process.env.KEYCLOAK_CLIENT_ID,
          client_secret: process.env.KEYCLOAK_CLIENT_SECRET,
          username: email,
          password: oldPassword,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
    } catch (error) {
      console.error('Old password verification failed:', error.response?.data);
      return res.status(401).json({ error: 'Incorrect current password' });
    }

    // Validate new password complexity
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        error: 'New password must be at least 8 characters, with 1 uppercase, 1 lowercase, 1 number, and 1 special character'
      });
    }

    // Update password in Keycloak
    const adminTokenResponse = await axios.post(
    `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.KEYCLOAK_CLIENT_ID,
        client_secret: process.env.KEYCLOAK_CLIENT_SECRET,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    await axios.put(
      `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/users/${userId}/reset-password`,
      { type: 'password', value: newPassword, temporary: false },
      {
        headers: {
          Authorization: `Bearer ${adminTokenResponse.data.access_token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    // Log the action
    await pool.query(
      'INSERT INTO system_logs (event_type, user_id, details) VALUES ($1, $2, $3)',
      ['password_change', userId, 'User changed their password']
    );

    console.log('Password changed successfully:', { userId });
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error.message, error.response?.data);
    res.status(500).json({ error: 'Failed to change password', details: error.message });
  }
});

// --- Artist Routes ---

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

app.post('/api/artworks', keycloak.protect('realm:artist'), upload.single('image'), artworkManagementLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { title, description, price, category_id } = req.body;
  const imagePath = req.file ? req.file.path.replace(/\\/g, '/') : null;

  console.log('[ARTWORK POST DEBUG] Request:', { userId, title, price, category_id, imagePath });

  try {
    // Validate inputs
    if (!title || !price || !category_id || !imagePath) {
      console.log('[ARTWORK POST ERROR] Missing fields:', { title, price, category_id, imagePath });
      return res.status(400).json({ error: 'Missing required fields: title, price, category_id, or image' });
    }

    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      console.log('[ARTWORK POST ERROR] Invalid price:', price);
      return res.status(400).json({ error: 'Price must be a positive number' });
    }

    // Validate category
    const parsedCategoryId = await validateCategory(category_id);

    // Fetch artist_id from users table
    const { rows: userRows } = await pool.query(
      'SELECT user_id FROM users WHERE keycloak_id = $1 AND role = $2',
      [userId, 'artist']
    );
    if (userRows.length === 0) {
      console.log('[ARTWORK POST ERROR] User not found or not an artist:', userId);
      return res.status(403).json({ error: 'User not found or not an artist' });
    }
    const dbUserId = userRows[0].user_id;

    // Insert artwork
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const artwork = await insertArtwork(title, description, parsedPrice, dbUserId, parsedCategoryId);
      await insertArtworkImage(artwork.artwork_id, imagePath);
      await client.query('COMMIT');

      console.log('[ARTWORK POST SUCCESS] Artwork created:', { artwork_id: artwork.artwork_id });
      res.status(201).json({
        message: 'Artwork created successfully',
        artwork: {
          artwork_id: artwork.artwork_id,
          title,
          description,
          price: parsedPrice,
          category_id: parsedCategoryId,
          image_url: `/uploads/artworks/${path.basename(imagePath)}`,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[ARTWORK POST ERROR]', { message: err.message, stack: err.stack });
    if (err.message.includes('Only JPEG/PNG images allowed')) {
      res.status(400).json({ error: err.message });
    } else if (err.message.includes('Invalid category ID')) {
      res.status(400).json({ error: err.message });
    } else {
      res.status(500).json({ error: 'Failed to create artwork', details: err.message });
    }
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

app.get('/api/artworks', keycloak.protect(), publicDataLimiter, async (req, res) => {
  const { artist, category, query, sort_by = 'created_at', order = 'desc' } = req.query;
  let sql = `
    SELECT a.*, c.name AS category_name,
           '/uploads/artworks/' || SPLIT_PART(REPLACE(ai.image_path, '\\', '/'), '/', -1) AS image_url
    FROM artworks a
    JOIN categories c ON a.category_id = c.category_id
    LEFT JOIN artwork_images ai ON a.artwork_id = ai.artwork_id
  `;
  let conditions = [];
  let params = [];
  let paramIndex = 1;

  if (artist && artist !== 'undefined') {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(artist)) {
      console.error('Invalid artist keycloak_id format:', artist);
      return res.status(400).json({ error: 'Invalid artist ID format' });
    }
    const { rows: userRows } = await pool.query('SELECT user_id FROM users WHERE keycloak_id = $1', [artist]);
    if (userRows.length === 0) {
      console.error('Artist not found:', artist);
      return res.status(404).json({ error: 'Artist not found' });
    }
    conditions.push(`a.artist_id = $${paramIndex}`);
    params.push(userRows[0].user_id);
    paramIndex++;
  }

  if (category && category !== 'undefined') {
    conditions.push(`a.category_id = $${paramIndex}`);
    params.push(category);
    paramIndex++;
  }

  if (query && query !== 'undefined') {
    conditions.push(`(a.title ILIKE $${paramIndex} OR a.description ILIKE $${paramIndex})`);
    params.push(`%${query}%`);
    paramIndex++;
  }

  if (conditions.length > 0) {
    sql += ' WHERE ' + conditions.join(' AND ');
  }

  // Sanitize sort_by to prevent SQL injection
  const validSortFields = ['created_at', 'price', 'category_id'];
  const sortField = validSortFields.includes(sort_by) ? sort_by : 'created_at';
  const sortOrder = order.toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  sql += ` ORDER BY a.${sortField} ${sortOrder}`;

  try {
    console.log('Executing query:', sql, 'with params:', params);
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (error) {
    console.error('Fetch artworks error:', error.message);
    res.status(500).json({ error: 'Failed to fetch artworks', details: error.message });
  }
});

app.get('/api/artworks/:id', keycloak.protect(), publicDataLimiter, async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query(
      `
      SELECT a.*, c.name AS category_name,
             '/uploads/artworks/' || SPLIT_PART(REPLACE(ai.image_path, '\\', '/'), '/', -1) AS image_url,
             u.name AS artist_name
      FROM artworks a
      JOIN categories c ON a.category_id = c.category_id
      LEFT JOIN artwork_images ai ON a.artwork_id = ai.artwork_id
      JOIN users u ON a.artist_id = u.user_id
      WHERE a.artwork_id = $1
      `,
      [id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Artwork not found' });
    }
    res.json(rows[0]);
  } catch (error) {
    console.error('Fetch artwork error:', error.message);
    res.status(500).json({ error: 'Failed to fetch artwork', details: error.message });
  }
});

app.put('/api/artworks/:id', keycloak.protect(), authPutLimiter, async (req, res) => {
  const keycloakId = req.kauth.grant.access_token.content.sub; // UUID
  const { title, description, price, category_id } = req.body;
  try {
    const parsedPrice = parseFloat(price);
    if (isNaN(parsedPrice) || parsedPrice <= 0) {
      return res.status(400).json({ error: 'Invalid price' });
    }
    const parsedCategoryId = await validateCategory(category_id);
    const parsedArtworkId = parseInt(req.params.id, 10); // Ensure artwork_id is an integer
    if (isNaN(parsedArtworkId)) {
      return res.status(400).json({ error: 'Invalid artwork ID' });
    }

    // Fetch user_id (integer) from users table using keycloak_id (UUID)
    const { rows: user } = await pool.query(
      'SELECT user_id FROM users WHERE keycloak_id = $1',
      [keycloakId]
    );
    if (user.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = user[0].user_id; // Integer

    // Check artwork ownership
    const { rows: artwork } = await pool.query(
      'SELECT * FROM artworks WHERE artwork_id = $1 AND artist_id = $2',
      [parsedArtworkId, userId]
    );
    if (artwork.length === 0) {
      return res.status(404).json({ error: 'Artwork not found or unauthorized' });
    }

    // Update artwork
    const { rows } = await pool.query(
      'UPDATE artworks SET title = $1, description = $2, price = $3, category_id = $4 WHERE artwork_id = $5 RETURNING *',
      [title, description, parsedPrice, parsedCategoryId, parsedArtworkId]
    );
    res.json(rows[0]);
  } catch (error) {
    console.error('PUT error:', error.message, error.stack);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.delete('/api/artworks/:id', keycloak.protect(), authDeleteLimiter, async (req, res) => {
  const keycloakId = req.kauth.grant.access_token.content.sub; // UUID
  const userRoles = req.kauth.grant.access_token.content.realm_access.roles;
  try {
    const parsedId = parseInt(req.params.id, 10); // Ensure artwork_id is an integer
    if (isNaN(parsedId)) {
      return res.status(400).json({ error: 'Invalid artwork ID' });
    }

    // Fetch user_id (integer) from users table using keycloak_id (UUID)
    const { rows: user } = await pool.query(
      'SELECT user_id FROM users WHERE keycloak_id = $1',
      [keycloakId]
    );
    if (user.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    const userId = user[0].user_id; // Integer

    // Fetch artwork for authorization
    const { rows: artwork } = await pool.query(
      'SELECT artwork_id, artist_id FROM artworks WHERE artwork_id = $1',
      [parsedId]
    );
    if (artwork.length === 0) {
      return res.status(404).json({ error: 'Artwork not found' });
    }

    // Authorization check
    if (artwork[0].artist_id !== userId && !userRoles.includes('admin')) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    // Fetch image_path from artwork_images
    const { rows: images } = await pool.query(
      'SELECT image_path FROM artwork_images WHERE artwork_id = $1',
      [parsedId]
    );
    console.log('🖼️ Images found for artwork_id', parsedId, ':', images);

    // Delete image files
    for (const image of images) {
      if (image.image_path) {
        // Normalize slashes and extract filename
        const normalizedPath = image.image_path.replace(/\\/g, '/');
        const fileName = path.basename(normalizedPath);
        const imagePath = path.join(__dirname, 'Uploads', 'artworks', fileName);
        console.log('🗑️ Attempting to delete file:', imagePath);

        try {
          await fsPromises.unlink(imagePath); // Explicit promise-based unlink
          console.log(`✅ Deleted image file: ${imagePath}`);
        } catch (fileError) {
          if (fileError.code === 'ENOENT') {
            console.log(`ℹ️ Image file not found: ${imagePath}`);
          } else {
            console.error(`❌ Failed to delete image file: ${imagePath}`, fileError.message, fileError.stack);
          }
        }
      } else {
        console.log('⚠️ No image_path for image record:', image);
      }
    }

    // Delete artwork (cascades to artwork_images due to ON DELETE CASCADE)
    await pool.query('DELETE FROM artworks WHERE artwork_id = $1', [parsedId]);

    res.json({ message: 'Artwork deleted successfully' });
  } catch (error) {
    console.error('DELETE error:', error.message, error.stack);
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

router.get('/categories', keycloak.protect(), requireTrustLevel(TRUST_LEVELS.VERIFIED), publicDataLimiter, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT category_id, name, description FROM categories ORDER BY name');
    console.log(`Fetched ${rows.length} categories:`, rows.map(r => r.name));
    res.json(rows);
  } catch (error) {
    console.error('Category fetch error:', {
      message: error.message,
      stack: error.stack,
    });
    res.status(500).json({ error: 'Failed to fetch categories', details: error.message });
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
      LEFT JOIN orders o ON a.artwork_id = o.artwork_id
      LEFT JOIN payments p ON o.order_id = p.order_id
      WHERE (o.order_id IS NULL OR p.status != 'completed')
        AND (a.title ILIKE $1 OR u.name ILIKE $1 OR c.name ILIKE $1)
      GROUP BY a.artwork_id, u.name, c.name
    `, [`%${query}%`]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

// --- Order Routes ---

router.post('/orders', keycloak.protect(), orderLimiter, requireTrustLevel(TRUST_LEVELS.VERIFIED), async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { artworkId, paymentMethod } = req.body;

  console.log('[ORDER POST DEBUG] Request:', { userId, artworkId, paymentMethod });

  if (!artworkId || isNaN(parseInt(artworkId))) {
    console.log('[ORDER POST ERROR] Invalid artwork ID:', artworkId);
    return res.status(400).json({ error: 'Invalid artwork ID' });
  }
  if (!['paypal', 'orange_money', 'myzaka'].includes(paymentMethod)) {
    console.log('[ORDER POST ERROR] Invalid payment method:', paymentMethod);
    return res.status(400).json({ error: 'Invalid payment method' });
  }

  const client = await pool.connect();
  try {
    console.log('[ORDER POST DEBUG] Fetching user:', userId);
    const { rows: userRows } = await client.query(
      'SELECT user_id FROM users WHERE keycloak_id = $1',
      [userId]
    );
    if (userRows.length === 0) {
      console.log('[ORDER POST ERROR] User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }
    const dbUserId = userRows[0].user_id;

    console.log('[ORDER POST DEBUG] Fetching artwork:', artworkId);
    const { rows: artworkRows } = await client.query(
      'SELECT artwork_id, title, price FROM artworks WHERE artwork_id = $1 AND status = $2',
      [artworkId, 'available']
    );
    if (artworkRows.length === 0) {
      console.log('[ORDER POST ERROR] Artwork not found or unavailable:', artworkId);
      return res.status(404).json({ error: 'Artwork not found or unavailable' });
    }

    let paymentId, paymentUrl, paymentStatus = 'pending';
    if (paymentMethod === 'paypal') {
      const request = new paypal.orders.OrdersCreateRequest();
      request.prefer('return=representation');
      request.requestBody({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: {
            currency_code: 'BWP',
            value: artworkRows[0].price.toFixed(2)
          },
          description: `Purchase of ${artworkRows[0].title}`
        }],
        application_context: {
          return_url: `${API_BASE_URL}/order-success`,
          cancel_url: `${API_BASE_URL}/order-cancel`
        }
      });
      const response = await paypalClient.execute(request);
      paymentId = response.result.id;
      paymentUrl = response.result.links.find(link => link.rel === 'approve').href;
      console.log('[ORDER POST PAYPAL] Created order:', { paymentId, paymentUrl });
    } else {
      // Mock Orange Money and MyZaka
      paymentId = `${paymentMethod}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      paymentUrl = `/mock-payment/${paymentId}`;
      console.log(`[ORDER POST MOCK ${paymentMethod.toUpperCase()}] Mocked payment:`, { paymentId, paymentUrl });
    }

    console.log('[ORDER POST DEBUG] Creating order:', { dbUserId, artworkId });
    const { rows: orderRows } = await client.query(
      'INSERT INTO orders (buyer_id, artwork_id, total_amount, status, payment_status, payment_method, payment_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING order_id',
      [dbUserId, artworkId, artworkRows[0].price, 'pending', paymentStatus, paymentMethod, paymentId]
    );

    console.log('[ORDER POST SUCCESS] Order created:', orderRows[0]);
    res.status(200).json({ order_id: orderRows[0].order_id, redirect: paymentUrl });
  } catch (error) {
    console.error('[ORDER POST ERROR]', {
      message: error.message,
      stack: error.stack,
      userId,
      artworkId
    });
    res.status(500).json({ error: 'Failed to create order', details: error.message });
  } finally {
    client.release();
    console.log('[ORDER POST DEBUG] Database client released');
  }
});

// Update GET /api/orders to include payment_method
router.get('/orders', keycloak.protect(), requireTrustLevel(TRUST_LEVELS.VERIFIED), async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { page = 1, limit = 10 } = req.query;
  const parsedPage = parseInt(page);
  const parsedLimit = parseInt(limit);

  console.log('[ORDERS GET DEBUG] Request:', { userId, page, limit });

  if (isNaN(parsedPage) || parsedPage < 1 || isNaN(parsedLimit) || parsedLimit < 1) {
    console.log('[ORDERS GET ERROR] Invalid pagination params:', { page, limit });
    return res.status(400).json({ error: 'Invalid page or limit' });
  }

  const client = await pool.connect();
  try {
    console.log('[ORDERS GET DEBUG] Fetching user:', userId);
    const { rows: userRows } = await client.query(
      'SELECT user_id FROM users WHERE keycloak_id = $1',
      [userId]
    );
    if (userRows.length === 0) {
      console.log('[ORDERS GET ERROR] User not found:', userId);
      return res.status(404).json({ error: 'User not found' });
    }
    const dbUserId = userRows[0].user_id;

    console.log('[ORDERS GET DEBUG] Counting orders for user:', dbUserId);
    const { rows: countRows } = await client.query(
      'SELECT COUNT(*) AS total FROM orders WHERE buyer_id = $1',
      [dbUserId]
    );
    const total = parseInt(countRows[0].total);
    const totalPages = Math.ceil(total / parsedLimit);
    const offset = (parsedPage - 1) * parsedLimit;

    console.log('[ORDERS GET DEBUG] Fetching orders:', { dbUserId, limit: parsedLimit, offset });
    const { rows: orderRows } = await client.query(
      `SELECT 
         o.order_id, 
         o.buyer_id, 
         o.artwork_id, 
         o.total_amount AS price, 
         o.status, 
         o.created_at, 
         o.payment_status,
         o.payment_method,
         a.title AS artwork_title,
         COALESCE(
           '/uploads/artworks/' || SPLIT_PART(REPLACE(ai.image_path, '\\', '/'), '/', -1),
           '/placeholder.jpg'
         ) AS image_url
       FROM orders o
       JOIN artworks a ON o.artwork_id = a.artwork_id
       LEFT JOIN artwork_images ai ON o.artwork_id = ai.artwork_id
       WHERE o.buyer_id = $1
       ORDER BY o.created_at DESC
       LIMIT $2 OFFSET $3`,
      [dbUserId, parsedLimit, offset]
    );
    console.log('[ORDERS GET DEBUG] Orders fetched:', orderRows);

    const response = {
      orders: orderRows.map(row => ({
        order_id: row.order_id,
        artwork_id: row.artwork_id,
        artwork_title: row.artwork_title,
        price: parseFloat(row.price),
        status: row.status,
        created_at: row.created_at,
        image_url: row.image_url,
        payment_status: row.payment_status,
        payment_method: row.payment_method
      })),
      pagination: {
        page: parsedPage,
        limit: parsedLimit,
        total,
        totalPages
      }
    };

    console.log('[ORDERS GET SUCCESS] Response:', response);
    res.status(200).json(response);
  } catch (error) {
    console.error('[ORDERS GET ERROR]', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      detail: error.detail,
      userId
    });
    res.status(500).json({ error: 'Failed to fetch orders', details: error.message });
  } finally {
    client.release();
    console.log('[ORDERS GET DEBUG] Database client released');
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

// PayPal Webhook
app.post('/api/payments', keycloak.protect(), authPostLimiter, async (req, res) => {
  const { order_id, amount, payment_method, phone_number } = req.body;
  const currency = payment_method === 'paypal' ? 'USD' : 'BWP';
  const client = await pool.connect();
  try {
    console.log('[PAYMENTS POST DEBUG] Request:', { order_id, amount, payment_method, phone_number });

    if (!order_id || !amount || !payment_method) {
      console.log('[PAYMENTS POST ERROR] Missing fields:', { order_id, amount, payment_method });
      return res.status(400).json({ error: 'Missing required fields: order_id, amount, or payment_method' });
    }
    if (typeof amount !== 'number' || amount <= 0) {
      console.log('[PAYMENTS POST ERROR] Invalid amount:', amount);
      return res.status(400).json({ error: 'Amount must be a positive number' });
    }
    if ((payment_method === 'orange_money' || payment_method === 'myzaka') && !phone_number) {
      console.log('[PAYMENTS POST ERROR] Missing phone_number for mobile money');
      return res.status(400).json({ error: 'Phone number is required for mobile money payments' });
    }

    // Verify order exists and matches amount
    const { rows: orderRows } = await client.query(
      'SELECT total_amount FROM orders WHERE order_id = $1',
      [order_id]
    );
    if (orderRows.length === 0) {
      console.log('[PAYMENTS POST ERROR] Order not found:', order_id);
      return res.status(404).json({ error: 'Order not found' });
    }
    if (Math.abs(orderRows[0].total_amount - amount) > 0.01) {
      console.log('[PAYMENTS POST ERROR] Amount mismatch:', { order_amount: orderRows[0].total_amount, requested_amount: amount });
      return res.status(400).json({ error: 'Amount does not match order total' });
    }

    let paymentUrl, paymentRef;

    if (payment_method === 'paypal') {
      try {
        const request = new paypal.orders.OrdersCreateRequest();
        request.prefer('return=representation');
        const orderBody = {
          intent: 'CAPTURE',
          purchase_units: [
            {
              amount: {
                currency_code: 'USD',
                value: amount.toFixed(2)
              },
              description: `Artwork Purchase for Order ${order_id}`
            }
          ],
          application_context: {
            return_url: `${process.env.APP_URL}/payment-callback`,
            cancel_url: `${process.env.APP_URL}/payment-cancel`
          }
        };
        console.log('[PAYMENTS POST PAYPAL BODY DEBUG] Order body:', JSON.stringify(orderBody, null, 2));
        request.body = orderBody;
        console.log('[PAYMENTS POST PAYPAL DEBUG] Sending PayPal request:', {
          clientId: process.env.PAYPAL_CLIENT_ID ? 'set' : 'unset',
          clientSecret: process.env.PAYPAL_CLIENT_SECRET ? 'set' : 'unset'
        });
        const response = await paypalClient.execute(request);
        paymentRef = response.result.id;
        paymentUrl = response.result.links.find(link => link.rel === 'approve').href;
        console.log('[PAYMENTS POST PAYPAL] Created order:', { paymentRef, paymentUrl });

        // Dynamic column handling
        const columns = ['order_id', 'amount', 'status', 'payment_url', 'payment_ref'];
        const values = [order_id, amount, 'pending', paymentUrl, paymentRef];
        const placeholders = ['$1', '$2', '$3', '$4', '$5'];

        // Add payment_method if column exists
        try {
          await client.query('SELECT payment_method FROM payments LIMIT 1');
          columns.push('payment_method');
          values.push(payment_method);
          placeholders.push(`$${placeholders.length + 1}`);
        } catch (e) {
          console.warn('[PAYMENTS POST DB WARN] payment_method column not found, skipping');
        }

        // Add original_amount and original_currency if columns exist
        try {
          await client.query('SELECT original_amount, original_currency FROM payments LIMIT 1');
          columns.push('original_amount', 'original_currency');
          values.push(amount, 'BWP');
          placeholders.push(`$${placeholders.length + 1}`, `$${placeholders.length + 2}`);
        } catch (e) {
          console.warn('[PAYMENTS POST DB WARN] original_amount/original_currency columns not found, skipping');
        }

        const queryText = `INSERT INTO payments (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING payment_id`;
        console.log('[PAYMENTS POST DB DEBUG] Insert query:', queryText, values);
        const { rows } = await client.query(queryText, values);
        const paymentId = rows[0].payment_id;
        console.log('[PAYMENTS POST DB SUCCESS] Payment inserted:', paymentId);

        // Update orders table for consistency
        await client.query(
          'UPDATE orders SET payment_status = $1, payment_method = $2, payment_id = $3 WHERE order_id = $4',
          ['pending', payment_method, paymentRef, order_id]
        );

        console.log('[PAYMENTS POST SUCCESS] Payment initiated:', { payment_id: paymentId, paymentRef });
        res.status(201).json({ paymentUrl });
      } catch (error) {
        console.error('[PAYMENTS POST PAYPAL ERROR]', {
          message: error.message,
          response: error.response?.data,
          status: error.response?.status,
          stack: error.stack
        });
        return res.status(500).json({ error: 'Failed to initiate payment', details: error.message });
      }
    } else if (payment_method === 'orange_money' || payment_method === 'myzaka') {
      const ussdCode = payment_method === 'orange_money' ? '*145#' : '*167#';
      paymentRef = `${payment_method}-${order_id}-${Date.now()}`;
      paymentUrl = `/mock-payment/${paymentRef}`;
      console.log(`[PAYMENTS POST ${payment_method.toUpperCase()}] Mocked payment:`, { paymentRef, paymentUrl });

      const { rows } = await client.query(
        'INSERT INTO payments (order_id, amount, status, payment_method, payment_url, payment_ref) VALUES ($1, $2, $3, $4, $5, $6) RETURNING payment_id',
        [order_id, amount, 'pending', payment_method, paymentUrl, paymentRef]
      );
      const paymentId = rows[0].payment_id; // ✅ Moved after query

      // Update orders table for consistency
      await client.query(
        'UPDATE orders SET payment_status = $1, payment_method = $2, payment_id = $3 WHERE order_id = $4',
        ['pending', payment_method, paymentRef, order_id]
      );

      console.log('[PAYMENTS POST SUCCESS] Payment initiated:', { payment_id: paymentId, paymentRef });
      res.status(201).json({ paymentUrl });
    } else {
      console.log('[PAYMENTS POST ERROR] Unsupported payment method:', payment_method);
      return res.status(400).json({ error: 'Unsupported payment method' });
    }
  } catch (error) {
    console.error('[PAYMENTS POST ERROR]', { message: error.message, stack: error.stack });
    res.status(500).json({ error: 'Failed to initiate payment', details: error.message });
  } finally {
    client.release();
  }
});

app.get('/api/payments/:order_id', keycloak.protect(), authGetLimiter, async (req, res) => {
  try {
    console.log('[PAYMENTS GET DEBUG] Fetching payments for order:', req.params.order_id);
    const { rows } = await pool.query('SELECT * FROM payments WHERE order_id = $1', [req.params.order_id]);
    console.log('[PAYMENTS GET SUCCESS] Payments:', rows);
    res.json(rows);
  } catch (error) {
    console.error('[PAYMENTS GET ERROR]', error.message);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.put('/api/payments/:id/status', keycloak.protect('realm:admin'), authPutLimiter, async (req, res) => {
  const { status } = req.body;
  const client = await pool.connect();
  try {
    console.log('[PAYMENTS PUT DEBUG] Updating payment status:', { payment_id: req.params.id, status });
    if (!['pending', 'completed', 'failed'].includes(status)) {
      console.log('[PAYMENTS PUT ERROR] Invalid status:', status);
      return res.status(400).json({ error: 'Invalid status' });
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      'UPDATE payments SET status = $1 WHERE payment_id = $2 RETURNING order_id',
      [status, req.params.id]
    );
    if (rows.length === 0) {
      console.log('[PAYMENTS PUT ERROR] Payment not found:', req.params.id);
      return res.status(404).json({ error: 'Payment not found' });
    }

    const orderId = rows[0].order_id;
    await client.query(
      'UPDATE orders SET payment_status = $1 WHERE order_id = $2',
      [status, orderId]
    );

    if (status === 'completed') {
      const { rows: orderRows } = await client.query(
        'SELECT artwork_id FROM orders WHERE order_id = $1',
        [orderId]
      );
      const artworkId = orderRows[0].artwork_id;
      const { rows: artworkRows } = await client.query(
        'SELECT artist_id FROM artworks WHERE artwork_id = $1',
        [artworkId]
      );
      const artistId = artworkRows[0].artist_id;
      const { rows: userRows } = await client.query(
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
      await client.query(
        'INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3)',
        [system_user_id, artistId, messageContent]
      );
    }

    await client.query('COMMIT');
    console.log('[PAYMENTS PUT SUCCESS] Status updated:', { payment_id: req.params.id, status });
    res.json(rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[PAYMENTS PUT ERROR]', error.message);
    res.status(500).json({ error: 'Database or notification error', details: error.message });
  } finally {
    client.release();
  }
});

app.post('/api/payments/confirm', keycloak.protect(), orderLimiter, async (req, res) => {
  const { order_id, transaction_ref } = req.body;
  const client = await pool.connect();
  try {
    console.log('[PAYMENTS CONFIRM DEBUG] Confirming payment:', { order_id, transaction_ref });
    if (!order_id || !transaction_ref) {
      console.log('[PAYMENTS CONFIRM ERROR] Missing fields:', { order_id, transaction_ref });
      return res.status(400).json({ error: 'Missing order_id or transaction_ref' });
    }
    if (!transaction_ref.startsWith('orange_money-') && !transaction_ref.startsWith('myzaka-')) {
      console.log('[PAYMENTS CONFIRM ERROR] Invalid transaction reference:', transaction_ref);
      return res.status(400).json({ error: 'Invalid transaction reference' });
    }

    await client.query('BEGIN');
    const { rows } = await client.query(
      'UPDATE payments SET status = $1, payment_ref = $2 WHERE order_id = $3 RETURNING order_id, payment_method',
      ['completed', transaction_ref, order_id]
    );
    if (rows.length === 0) {
      console.log('[PAYMENTS CONFIRM ERROR] Payment not found:', order_id);
      return res.status(404).json({ error: 'Payment not found' });
    }

    const orderId = rows[0].order_id;
    const paymentMethod = rows[0].payment_method;
    await client.query(
      'UPDATE orders SET payment_status = $1 WHERE order_id = $2',
      ['completed', orderId]
    );

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
    console.log('[PAYMENTS CONFIRM SUCCESS] Payment confirmed:', { order_id, transaction_ref });
    res.status(200).json({ message: 'Payment confirmed' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('[PAYMENTS CONFIRM ERROR]', error.message);
    res.status(500).json({ error: 'Confirmation failed', details: error.message });
  } finally {
    client.release();
  }
});

// PayPal Webhook
app.post('/webhook/paypal', express.raw({ type: 'application/json' }), async (req, res) => {
  const webhookEvent = req.body;
  try {
    console.log('[PAYPAL WEBHOOK DEBUG] Event:', webhookEvent.event_type);
    if (webhookEvent.event_type === 'CHECKOUT.ORDER.APPROVED') {
      const paymentRef = webhookEvent.resource.id;
      const client = await pool.connect();
      try {
        if (payment_method !== 'paypal') {
        const { rows } = await client.query(
          'UPDATE payments SET status = $1 WHERE payment_ref = $2 RETURNING order_id',
          ['completed', paymentRef]
        );
      }
      if (rows.length > 0) {
        await client.query(
          'UPDATE orders SET payment_status = $1 WHERE order_id = $2',
          ['completed', rows[0].order_id]
        );
        console.log('[PAYPAL WEBHOOK SUCCESS] Payment completed:', { paymentRef, order_id: rows[0].order_id });
      }
    } finally {
      client.release();
    }
    }
    res.status(200).send('Webhook received');
  } catch (error) {
    console.error('[PAYPAL WEBHOOK ERROR]', error);
    res.status(400).send('Webhook error');
    response: error.response?.data;
  }
});

// Mock Payment Page
app.get('/mock-payment/:paymentRef', (req, res) => {
  const { paymentRef } = req.params;
  const paymentMethod = paymentRef.startsWith('orange_money-') ? 'Orange Money' : 'MyZaka';
  const ussdCode = paymentMethod === 'Orange Money' ? '*145#' : '*167#';
  res.send(`
    <h1>${paymentMethod} Payment</h1>
    <p>Order Reference: ${paymentRef}</p>
    <p>Please complete payment via USSD: ${ussdCode}</p>
    <p>After payment, confirm with transaction reference: ${paymentRef}</p>
    <form action="/api/payments/confirm" method="POST">
      <input type="hidden" name="order_id" value="${paymentRef.split('-')[1]}">
      <input type="text" name="transaction_ref" value="${paymentRef}" readonly>
      <button type="submit">Confirm Payment</button>
    </form>
    <a href="/orders">Back to Orders</a>
  `);
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

// Get all artworks
router.get('/artworks', keycloak.protect(), publicDataLimiter, async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT a.*, c.name AS category_name,
             '/uploads/artworks/' || SPLIT_PART(REPLACE(ai.image_path, '\\', '/'), '/', -1) AS image_url
      FROM artworks a
      JOIN categories c ON a.category_id = c.category_id
      LEFT JOIN artwork_images ai ON a.artwork_id = ai.artwork_id
      ORDER BY a.created_at DESC
      `
    );
    console.log('Artworks fetched:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    console.error('Fetch artworks error:', error.message);
    res.status(500).json({ error: 'Failed to fetch artworks', details: error.message });
  }
});

// Get user threads
router.get('/threads', keycloak.protect(), messageLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  if (!isValidUUID(userId)) {
    console.error('Invalid user ID:', userId);
    return res.status(400).json({ error: 'Invalid user ID format' });
  }
  try {
    const result = await pool.query(
      `
      SELECT t.id, t.participant_id, t.artwork_id, u.name AS username, u.role, a.title AS artwork_title,
             (SELECT content FROM messages m WHERE m.thread_id = t.id AND m.status != 'deleted' ORDER BY created_at DESC LIMIT 1) as last_message
      FROM threads t
      JOIN users u ON u.keycloak_id = t.participant_id
      LEFT JOIN artworks a ON a.artwork_id = t.artwork_id
      WHERE (t.user_id = $1 OR t.participant_id = $1) AND t.status != 'deleted'
      ORDER BY t.created_at DESC
      `,
      [userId]
    );
    console.log('Threads fetched for user:', userId, 'Count:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    console.error('Fetch threads error:', error.message, 'User:', userId);
    res.status(500).json({ error: 'Failed to fetch threads', details: error.message });
  }
});

// Create a new thread or redirect to existing
router.post('/threads', keycloak.protect(), messageLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub; // UUID
  const { artworkId } = req.body; // Integer
  if (!isValidUUID(userId) || isNaN(artworkId)) {
    console.error('Invalid input:', { userId, artworkId });
    return res.status(400).json({ error: 'Invalid user ID or artwork ID format' });
  }
  try {
    // Fetch artwork and artist details
    const { rows: artwork } = await pool.query(
      'SELECT a.artist_id, u.keycloak_id FROM artworks a JOIN users u ON a.artist_id = u.user_id WHERE a.artwork_id = $1',
      [artworkId]
    );
    if (artwork.length === 0) {
      console.log('Artwork not found:', artworkId);
      return res.status(404).json({ error: 'Artwork not found' });
    }
    const recipientId = artwork[0].keycloak_id; // UUID
    if (recipientId === userId) {
      return res.status(400).json({ error: 'Cannot create thread with yourself' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check for existing active thread
      const { rows: existingThread } = await client.query(
        `SELECT id, user_id, participant_id, artwork_id
         FROM threads
         WHERE user_id = $1 AND participant_id = $2 AND artwork_id = $3 AND status != 'deleted'`,
        [userId, recipientId, artworkId]
      );

      if (existingThread.length > 0) {
        console.log('Existing active thread found:', existingThread[0]);
        await client.query('COMMIT');
        return res.status(200).json({
          message: 'Thread already exists',
          thread: existingThread[0],
          redirect: true
        });
      }

      // Check for soft-deleted thread
      const { rows: deletedThread } = await client.query(
        `SELECT id, user_id, participant_id, artwork_id
         FROM threads
         WHERE user_id = $1 AND participant_id = $2 AND artwork_id = $3 AND status = 'deleted'`,
        [userId, recipientId, artworkId]
      );

      if (deletedThread.length > 0) {
        console.log('Restoring soft-deleted thread:', deletedThread[0]);
        await client.query(
          `UPDATE threads SET status = 'active' WHERE id = $1`,
          [deletedThread[0].id]
        );
        await client.query(
          `UPDATE messages SET status = 'active' WHERE thread_id = $1`,
          [deletedThread[0].id]
        );
        await client.query('COMMIT');
        return res.status(200).json({
          message: 'Thread restored',
          thread: deletedThread[0],
          redirect: true
        });
      }

      // Create new thread if none exists
      const result = await client.query(
        `INSERT INTO threads (user_id, participant_id, artwork_id, status)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [userId, recipientId, artworkId, 'active']
      );
      console.log('New thread created:', result.rows[0]);
      await client.query('COMMIT');
      res.status(201).json(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505' && error.constraint === 'threads_user_id_participant_id_artwork_id_key') {
        console.error('Duplicate thread attempt:', { userId, recipientId, artworkId });
        return res.status(409).json({
          error: 'A thread for this artwork and user already exists',
          details: 'Check your messages for an existing conversation.'
        });
      }
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Create thread error:', error.message, 'User:', userId);
    res.status(500).json({ error: 'Failed to create or fetch thread', details: error.message });
  }
});

// Get messages for a thread
router.get('/threads/:threadId/messages', keycloak.protect(), messageLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { threadId } = req.params;
  if (!isValidUUID(userId) || isNaN(threadId)) {
    console.error('Invalid input:', { userId, threadId });
    return res.status(400).json({ error: 'Invalid user ID or thread ID format' });
  }
  try {
    const threadCheck = await pool.query(
      'SELECT * FROM threads WHERE id = $1 AND (user_id = $2 OR participant_id = $2) AND status != \'deleted\'',
      [threadId, userId]
    );
    if (threadCheck.rows.length === 0) {
      console.log('Unauthorized thread access:', { threadId, userId });
      return res.status(403).json({ error: 'Unauthorized access to thread' });
    }
    const result = await pool.query(
      `
      SELECT m.id, m.content, m.created_at, m.sender_id, u.name AS username
      FROM messages m
      JOIN users u ON u.keycloak_id = m.sender_id
      WHERE m.thread_id = $1 AND m.status != 'deleted'
      ORDER BY m.created_at ASC
      `,
      [threadId]
    );
    console.log('Messages fetched for thread:', threadId, 'Count:', result.rows.length);
    res.json(result.rows);
  } catch (error) {
    console.error('Fetch messages error:', error.message, 'User:', userId);
    res.status(500).json({ error: 'Failed to fetch messages', details: error.message });
  }
});

// Send a message
router.post('/threads/:threadId/messages', keycloak.protect(), messageLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { threadId } = req.params;
  const { content } = req.body;
  if (!isValidUUID(userId) || isNaN(threadId)) {
    console.error('Invalid input:', { userId, threadId });
    return res.status(400).json({ error: 'Invalid user ID or thread ID format' });
  }
  if (!content || !content.trim()) {
    return res.status(400).json({ error: 'Message content cannot be empty' });
  }
  try {
    const threadCheck = await pool.query(
      'SELECT * FROM threads WHERE id = $1 AND (user_id = $2 OR participant_id = $2) AND status != \'deleted\'',
      [threadId, userId]
    );
    if (threadCheck.rows.length === 0) {
      console.log('Unauthorized thread access:', { threadId, userId });
      return res.status(403).json({ error: 'Unauthorized access to thread' });
    }
    const result = await pool.query(
      `
      INSERT INTO messages (thread_id, sender_id, content, status)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `,
      [threadId, userId, content, 'active']
    );
    console.log('Message sent:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Send message error:', error.message, 'User:', userId);
    res.status(500).json({ error: 'Failed to send message', details: error.message });
  }
});

// Delete a thread
router.delete('/threads/:threadId', keycloak.protect(), messageLimiter, async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { threadId } = req.params;

  if (!isValidUUID(userId) || isNaN(threadId)) {
    console.error('Invalid input:', { userId, threadId });
    return res.status(400).json({ error: 'Invalid user ID or thread ID format' });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Check if the user owns or is a participant in the thread
      const { rows: thread } = await client.query(
        'SELECT id FROM threads WHERE id = $1 AND (user_id = $2 OR participant_id = $2) AND status != $3',
        [threadId, userId, 'deleted']
      );

      if (thread.length === 0) {
        console.log('Unauthorized or thread not found:', { threadId, userId });
        return res.status(403).json({ error: 'Unauthorized or thread not found' });
      }

      // Soft delete the thread
      await client.query(
        'UPDATE threads SET status = $1 WHERE id = $2',
        ['deleted', threadId]
      );

      // Soft delete associated messages
      await client.query(
        'UPDATE messages SET status = $1 WHERE thread_id = $2',
        ['deleted', threadId]
      );

      await client.query('COMMIT');
      console.log(`Thread ${threadId} deleted by user ${userId}`);
      res.status(200).json({ message: 'Thread deleted successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Delete thread error:', error.message, 'User:', userId);
      res.status(500).json({ error: 'Failed to delete thread', details: error.message });
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Delete thread error:', error.message, 'User:', userId);
    res.status(500).json({ error: 'Server error', details: error.message });
  }
});

// Mount the router
app.use('/api', router);

// --- PayPal Callback ---

app.post('/payment-callback', express.json(), publicDataLimiter, authPostLimiter, messageLimiter, async (req, res) => {
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
  try {
    const parsedCategoryId = parseInt(category_id);
    if (isNaN(parsedCategoryId)) {
      console.error('Invalid category_id: Not a number', { category_id });
      throw new Error('Invalid category ID: Must be a number');
    }
    const categoryResult = await pool.query('SELECT * FROM categories WHERE category_id = $1', [parsedCategoryId]);
    if (categoryResult.rows.length === 0) {
      console.error('Category not found for category_id:', parsedCategoryId);
      throw new Error('Invalid category ID: Category not found');
    }
    console.log('Validated category_id:', parsedCategoryId);
    return parsedCategoryId;
  } catch (error) {
    console.error('validateCategory error:', {
      category_id,
      message: error.message,
      stack: error.stack,
    });
    throw error; // Re-throw to maintain existing error handling
  }
};

const validateImage = (file) => {
  if (!file) throw new Error('At least one image is required to create an artwork');
  const filename = path.basename(file.path);
  console.log('Validating filename:', filename);
  if (/[^a-zA-Z0-9_\-.]/.test(filename)) {
    throw new Error(`Invalid characters in filename: ${filename}`);
  }
  return filename;
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

async function streamFile(res, filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = {
      '.pdf': 'application/pdf',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png'
    }[ext] || 'application/octet-stream';
    console.log('Streaming file:', { filePath, contentType, ext });
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', 'http://localhost:3001'); // Frontend port, not 3000
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,HEAD');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
    const stream = require('fs').createReadStream(filePath);
    stream.on('error', (err) => {
      console.error('Stream error:', { filePath, error: err.message });
      res.status(500).json({ error: 'Failed to stream file', details: err.message });
    });
    stream.pipe(res);
  } catch (error) {
    console.error('Stream setup error:', { filePath, error: error.message });
    res.status(500).json({ error: 'Failed to set up stream', details: error.message });
  }
}

// Image upload endpoint
app.post('/api/upload', keycloak.protect('realm:artist'), upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    const imagePath = req.file.path.replace(/\\/g, '/').replace(/^Uploads\//, '/uploads/');
    console.log('✅ Image uploaded:', imagePath);
    res.json({ image_url: imagePath });
  } catch (error) {
    console.error('❌ Upload error:', error.message);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
});

// Insert artwork image
app.post('/api/artwork-images', keycloak.protect('realm:artist'), async (req, res) => {
  const userId = req.kauth.grant.access_token.content.sub;
  const { artwork_id, image_path } = req.body;
  try {
    // Verify artwork ownership
    const { rows: artwork } = await pool.query(
      'SELECT * FROM artworks WHERE artwork_id = $1 AND artist_id = $2',
      [artwork_id, userId]
    );
    if (artwork.length === 0) {
      return res.status(404).json({ error: 'Artwork not found or unauthorized' });
    }

    // Insert image
    await pool.query(
      'INSERT INTO artwork_images (artwork_id, image_path) VALUES ($1, $2)',
      [artwork_id, image_path]
    );
    console.log('✅ Artwork image saved:', { artwork_id, image_path });
    res.status(201).json({ message: 'Image added to artwork' });
  } catch (error) {
    console.error('❌ Artwork image error:', error.message);
    res.status(500).json({ error: 'Database error', details: error.message });
  }
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message, err.stack);
  res.status(500).json({ error: 'Something broke on the server', details: err.message });
});

// Start the server
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
})();