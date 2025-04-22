require('dotenv').config();
console.log('Keycloak Config:', {
  url: process.env.KEYCLOAK_URL,
  realm: process.env.KEYCLOAK_REALM,
  clientId: process.env.KEYCLOAK_CLIENT_ID,
  secret: process.env.KEYCLOAK_CLIENT_SECRET ? '****' : 'MISSING'
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
const fs = require('fs');
const fsPromises = fs.promises; // Switch to promises for async handling


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
      maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
  }));

  app.use((req, res, next) => {
    console.log('Session exists pre-Keycloak:', !!req.session);
    if (req.session) req.session.test = 'test-value';
    next();
  });

  app.use(keycloak.middleware());

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
  const storage = multer.diskStorage({
    destination: './Uploads/',
    filename: (req, file, cb) => {
      cb(null, `${Date.now()}${path.extname(file.originalname)}`);
    },
  });
  const upload = multer({ storage });

  // Multer setup for artist verification
  const artistStorage = multer.diskStorage({
    destination: './Uploads/artist_verification/',
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
  const userId = req.kauth.grant.access_token.content.sub;
  const { files } = req;

  if (!files?.idDocument || !files?.proofOfWork) {
    return res.status(400).json({ error: 'ID document and portfolio are required' });
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

  if (!['approved', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  if (status === 'rejected' && !rejection_reason) {
    return res.status(400).json({ error: 'Rejection reason required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT user_id, id_document_path, proof_of_work_path, selfie_path FROM artist_requests WHERE request_id = $1 AND status = $2',
      [requestId, 'pending']
    );
    if (!rows.length) {
      return res.status(404).json({ error: 'Request not found or already reviewed' });
    }
    const { user_id: userId } = rows[0];

    await client.query(
      'UPDATE artist_requests SET status = $1, rejection_reason = $2, reviewed_by = $3, reviewed_at = CURRENT_TIMESTAMP WHERE request_id = $4',
      [status, rejection_reason || null, reviewerId, requestId]
    );

    if (status === 'approved') {
      // Update user
      const { rows: userRows } = await client.query(
        'UPDATE users SET role = $1, status = $2 WHERE keycloak_id = $3 RETURNING user_id',
        ['artist', 'verified', userId]
      );
      const dbUserId = userRows[0].user_id;

      // Insert into artists table
      await client.query(
        'INSERT INTO artists (user_id, bio, portfolio) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING',
        [dbUserId, '', '']
      );

      // Sync Keycloak
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

      const rolesResponse = await axios.get(
        `${process.env.KEYCLOAK_URL}/admin/realms/${process.env.KEYCLOAK_REALM}/roles`,
        { headers: { Authorization: `Bearer ${adminToken}` } }
      );
      const artistRole = rolesResponse.data.find(r => r.name === 'artist');
      if (!artistRole) throw new Error('Artist role not found in Keycloak');

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
    }

    // Notify artist
    const { rows: userRows } = await client.query('SELECT email, name FROM users WHERE keycloak_id = $1', [userId]);
    const emailHtml = status === 'approved'
      ? `<h1>Artist Verification Approved!</h1><p>Congratulations, ${userRows[0].name}! You’re now an approved artist. Start uploading your artworks!</p>`
      : `<h1>Artist Verification Rejected</h1><p>Sorry, ${userRows[0].name}. Your request was rejected. Reason: ${rejection_reason}. Please resubmit or contact support.</p>`;
    await sendEmail(userRows[0].email, `Artist Verification ${status.charAt(0).toUpperCase() + status.slice(1)}`, emailHtml);

    await client.query('COMMIT');
    console.log(`Request ${requestId} ${status} by ${reviewerId}`);
    res.json({ message: `Request ${status}` });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Review error:', error.message);
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
  try {
    const keycloakId = req.kauth.grant.access_token.content.sub;
    const emailVerified = req.kauth.grant.access_token.content.email_verified || false;
    const { rows } = await pool.query(
      'SELECT user_id, name, email, role, is_verified, trust_level, status FROM users WHERE keycloak_id = $1',
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
    const { artist, category, sort_by, order } = req.query;
    let query = `
      SELECT a.*, 
             COALESCE(json_agg(ai.image_path) FILTER (WHERE ai.image_path IS NOT NULL), '[]') AS images,
             u.name AS artist_name
      FROM artworks a
      LEFT JOIN artwork_images ai ON a.artwork_id = ai.artwork_id
      LEFT JOIN order_items oi ON a.artwork_id = oi.artwork_id
      LEFT JOIN orders o ON oi.order_id = o.order_id
      LEFT JOIN payments p ON o.order_id = p.order_id
      LEFT JOIN artists ar ON a.artist_id = ar.user_id
      LEFT JOIN users u ON ar.user_id = u.user_id
      WHERE (o.order_id IS NULL OR p.status != 'completed')
    `;
    const values = [];
    let conditions = [];

    if (artist) {
      conditions.push(`a.artist_id = $${values.length + 1}`);
      values.push(artist);
    }
    if (category) {
      conditions.push(`a.category_id = (SELECT category_id FROM categories WHERE name = $${values.length + 1})`);
      values.push(category);
    }
    if (conditions.length > 0) {
      query += ` AND ${conditions.join(' AND ')}`;
    }
    query += ` GROUP BY a.artwork_id, u.name`;
    if (sort_by) {
      const validSortFields = ['created_at', 'price'];
      const validOrders = ['asc', 'desc'];
      if (validSortFields.includes(sort_by) && validOrders.includes(order || 'asc')) {
        query += ` ORDER BY a.${sort_by} ${order || 'asc'}`;
      }
    }
    const { rows } = await pool.query(query, values);
    res.json(rows);
  } catch (error) {
    console.error('Artwork fetch error:', error.message, error.stack);
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

app.post('/api/payments/confirm', keycloak.protect(), orderLimiter, async (req, res) => {
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

// Start the server
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));
})();