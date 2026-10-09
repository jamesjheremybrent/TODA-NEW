require('dotenv').config();
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const csv = require('csv-parser');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 5000;

// MySQL connection pool (localhost only)
const pool = mysql.createPool({
  host: '127.0.0.1',
  user: process.env.DB_USER || 'toda_user',
  password: process.env.DB_PASSWORD || '',
  database: 'toda',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

function normalizeDateOnly(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function isValidDateOnly(value) {
  return value === null || value === undefined || value === '' || /^\d{4}-\d{2}-\d{2}$/.test(String(value));
}

function validatePhotoData(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return 'Photo data must be a string';
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return 'Photo must be a JPG, PNG, or WebP data URL';
  if (Buffer.byteLength(match[2], 'base64') > 5 * 1024 * 1024) return 'Photo must be 5 MB or smaller';
  return null;
}

// Session middleware – HttpOnly cookie, 15‑min inactivity timeout
const ONE_MINUTE = 60 * 1000;
const FIFTEEN_MIN = 15 * ONE_MINUTE;
const MAX_LOGIN_ATTEMPTS = 5;
const SESSION_COOKIE_SECURE = process.env.SESSION_COOKIE_SECURE === 'true';
const ALLOWED_ORIGINS = new Set([
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://localhost:8443',
  'http://127.0.0.1:8443'
]);
const sessionStore = new MySQLStore({
  host: '127.0.0.1',
  user: process.env.DB_USER || 'toda_user',
  password: process.env.DB_PASSWORD || '',
  database: 'toda',
  clearExpired: true,
  checkExpirationInterval: FIFTEEN_MIN
});
app.use(
  session({
    name: 'toda_sid',
    secret: process.env.SESSION_SECRET || uuidv4(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: SESSION_COOKIE_SECURE,
      sameSite: 'strict',
      maxAge: FIFTEEN_MIN
    },
    store: sessionStore
  })
);

// Refresh maxAge on each request to reset inactivity timer
app.use((req, res, next) => {
  if (req.session && req.session.adminId) {
    req.session.cookie.maxAge = FIFTEEN_MIN;
  }
  next();
});

async function recordAudit(req, action, entityType, entityId, details = null) {
  await pool.query(
    `INSERT INTO audit_logs (admin_id, action, entity_type, entity_id, details)
     VALUES (?, ?, ?, ?, ?)`,
    [req.session.adminId, action, entityType, entityId == null ? null : String(entityId), details ? JSON.stringify(details) : null]
  );
}

function normalizedRequiredText(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim()) {
    return { error: `${label} is required` };
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    return { error: `${label} must be ${maxLength} characters or fewer` };
  }
  return { value: normalized };
}

function validUnitId(value) {
  return /^\d+$/.test(String(value)) && Number(value) > 0;
}

// Authentication validation middleware
function protectRoute(req, res, next) {
  if (!req.session || !req.session.adminId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// Body parsers
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  }
  if (origin && !ALLOWED_ORIGINS.has(origin) && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Static frontend (served from Vite build output or dev server)
app.use(express.static(path.join(__dirname, 'dist'))); // Adjust if needed

// Helper: compute SHA-256 hash of a string
function sha256(str) {
  return crypto.createHash('sha256').update(str, 'utf8').digest('hex');
}

// Temp directory for uploads
const tmpDir = path.join(__dirname, 'temp');
const photoDir = path.join(__dirname, 'uploads', 'driver-photos');
if (!fs.existsSync(tmpDir)) {
  fs.mkdirSync(tmpDir, { recursive: true });
}
if (!fs.existsSync(photoDir)) {
  fs.mkdirSync(photoDir, { recursive: true });
}

function photoExtension(dataUrl) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' })[dataUrl.match(/^data:(image\/(?:jpeg|png|webp));base64,/)?.[1]];
}

function savePhotoFile(unitId, dataUrl) {
  if (!dataUrl) return null;
  const extension = photoExtension(dataUrl);
  const filename = `driver-${unitId}.${extension}`;
  fs.writeFileSync(path.join(photoDir, filename), Buffer.from(dataUrl.split(',')[1], 'base64'));
  return filename;
}

function removePhotoFile(filename) {
  if (filename) {
    try { fs.unlinkSync(path.join(photoDir, path.basename(filename))); } catch (_) {}
  }
}

// Multer configuration for CSV upload
const upload = multer({
  dest: tmpDir,
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== 'text/csv' && file.mimetype !== 'application/vnd.ms-excel') {
      return cb(new Error('Only CSV files are allowed'), false);
    }
    cb(null, true);
  },
  limits: { fileSize: 5 * 1024 * 1024 } // 5 MB max
});

// ====================== Routes ======================

// Public: Health check
app.get('/api/health', async (req, res) => {
  try {
    const [row] = await pool.query('SELECT 1 AS ok');
    res.json({ status: 'OK', db: row[0].ok === 1 });
  } catch (err) {
    console.error('Health check failed:', err);
    res.status(503).json({ status: 'DB_ERROR', error: err.message });
  }
});

// Public: Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required' });
  }
  const address = req.ip || 'unknown';
  const now = Date.now();
  try {
    const [[attempt]] = await pool.query(
      `SELECT UNIX_TIMESTAMP(window_started_at) * 1000 AS startedAt, attempt_count AS count
       FROM login_attempts WHERE address = ?`,
      [address]
    );
    if (attempt && now - Number(attempt.startedAt) < FIFTEEN_MIN && attempt.count >= MAX_LOGIN_ATTEMPTS) {
      return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }
    if (!attempt || now - Number(attempt.startedAt) >= FIFTEEN_MIN) {
      await pool.query(
        `INSERT INTO login_attempts (address, window_started_at, attempt_count)
         VALUES (?, NOW(), 0)
         ON DUPLICATE KEY UPDATE window_started_at = NOW(), attempt_count = 0`,
        [address]
      );
    }
    const [rows] = await pool.query(
      'SELECT admin_id, password_hash FROM toda_admin WHERE username = ?',
      [username]
    );
    if (rows.length === 0) {
      await pool.query('UPDATE login_attempts SET attempt_count = attempt_count + 1 WHERE address = ?', [address]);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const admin = rows[0];
    const match = await bcrypt.compare(password, admin.password_hash);
    if (!match) {
      await pool.query('UPDATE login_attempts SET attempt_count = attempt_count + 1 WHERE address = ?', [address]);
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    await pool.query('DELETE FROM login_attempts WHERE address = ?', [address]);

    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.adminId = admin.admin_id;
    req.session.username = username;
    await recordAudit(req, 'LOGIN_SUCCEEDED', 'admin', admin.admin_id);
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
    res.json({ success: true, redirect: '/' });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Public: Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.clearCookie('toda_sid');
    res.json({ success: true });
  });
});

// Public: Session check (returns user info if logged in)
app.get('/api/session', (req, res) => {
  if (req.session && req.session.adminId) {
    // We don't have full user info in session; could fetch from DB but for simplicity return placeholder
    res.json({ id: req.session.adminId, full_name: req.session.username, email: '' });
  } else {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

// Protect all API routes below this line
app.use('/api', protectRoute);

app.get('/api/driver-photos/:filename', (req, res) => {
  const filename = path.basename(req.params.filename);
  if (!/^driver-\d+\.(jpg|png|webp)$/.test(filename)) return res.status(400).json({ error: 'Invalid photo path' });
  res.sendFile(path.join(photoDir, filename), (error) => {
    if (error && !res.headersSent) res.status(error.statusCode === 404 ? 404 : 500).json({ error: 'Photo not found' });
  });
});

app.post('/api/account/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
    return res.status(400).json({ error: 'Current and new passwords are required' });
  }
  if (newPassword.length < 12 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword) || !/[^A-Za-z0-9]/.test(newPassword)) {
    return res.status(400).json({ error: 'New password must be at least 12 characters with uppercase, lowercase, number, and symbol' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'New password must be different from the current password' });
  }
  try {
    const [rows] = await pool.query(
      'SELECT admin_id, password_hash FROM toda_admin WHERE admin_id = ? LIMIT 1',
      [req.session.adminId]
    );
    if (!rows.length || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await pool.query('UPDATE toda_admin SET password_hash = ? WHERE admin_id = ?', [passwordHash, req.session.adminId]);
    await recordAudit(req, 'PASSWORD_CHANGED', 'admin', req.session.adminId);
    res.json({ success: true });
  } catch (err) {
    console.error('Password change error:', err);
    res.status(500).json({ error: 'Unable to change password' });
  }
});

// Dashboard summary
app.get('/api/dashboard/summary', async (req, res) => {
  try {
    const [[drivers]] = await pool.query('SELECT COUNT(*) AS total FROM tricycle_units WHERE archived_at IS NULL');
    const [[active]] = await pool.query('SELECT COUNT(*) AS active FROM tricycle_units WHERE status = \'ACTIVE\' AND archived_at IS NULL');
    const [[complaints]] = await pool.query('SELECT COUNT(*) AS unresolved FROM tricycle_complaints WHERE status = \'PENDING\'');
    res.json({
      totalRegisteredDrivers: drivers.total,
      activeTricycles: active.active,
      unresolvedComplaints: complaints.unresolved
    });
  } catch (err) {
    console.error('Dashboard summary error:', err);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

// Tricycle Units – list
app.get('/api/tricycles', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT unit_id, driver_name, body_number, plate_number, status, phone, address, license_number, member_since, photo_path, photo_data, created_at, updated_at
       FROM tricycle_units
       WHERE archived_at IS NULL
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('List tricycles error:', err);
    res.status(500).json({ error: 'Failed to load registry' });
  }
});

// Tricycle Units – create (register new unit)
app.post('/api/tricycles', async (req, res) => {
  const { driver_name, body_number, plate_number, status = 'ACTIVE', phone = null, address = null, license_number = null, member_since = null, photo_data = null } = req.body;
  const driverName = normalizedRequiredText(driver_name, 'Driver name', 100);
  const bodyNumber = normalizedRequiredText(body_number, 'Body number', 20);
  const plateNumber = normalizedRequiredText(plate_number, 'Plate number', 20);
  if (driverName.error || bodyNumber.error || plateNumber.error) {
    return res.status(400).json({ error: driverName.error || bodyNumber.error || plateNumber.error });
  }
  if (!['ACTIVE', 'INACTIVE'].includes(status)) return res.status(400).json({ error: 'Status must be ACTIVE or INACTIVE' });
  if (!isValidDateOnly(member_since)) return res.status(400).json({ error: 'Member-since date must use YYYY-MM-DD format' });
  const photoError = validatePhotoData(photo_data);
  if (photoError) return res.status(400).json({ error: photoError });
  try {
    const [result] = await pool.query(
      `INSERT INTO tricycle_units (driver_name, body_number, plate_number, status, phone, address, license_number, member_since)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [driverName.value, bodyNumber.value.toUpperCase(), plateNumber.value.toUpperCase(), status, phone, address, license_number, normalizeDateOnly(member_since)]
    );
    const photoPath = savePhotoFile(result.insertId, photo_data);
    if (photoPath) await pool.query('UPDATE tricycle_units SET photo_path = ? WHERE unit_id = ?', [photoPath, result.insertId]);
    await recordAudit(req, 'DRIVER_CREATED', 'tricycle', result.insertId, { body_number: bodyNumber.value.toUpperCase() });
    res.json({ success: true, unitId: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'A unit with that body number or plate number already exists' });
    }
    console.error('Create tricycle error:', err);
    res.status(500).json({ error: 'Failed to register unit' });
  }
});

// Tricycle Units – update details, status, or archive (soft delete)
app.patch('/api/tricycles/:id', async (req, res) => {
  const { id } = req.params;
  if (!validUnitId(id)) return res.status(400).json({ error: 'Invalid unit id' });
  const { status, archive, driver_name, body_number, plate_number, phone, address, license_number, member_since, photo_data } = req.body; // archive: true => set archived_at = NOW()
  let previousPhotoPath = null;
  let fields = [];
  let values = [];
  if (status !== undefined) {
    if (!['ACTIVE', 'INACTIVE'].includes(status)) return res.status(400).json({ error: 'Status must be ACTIVE or INACTIVE' });
    fields.push('status = ?');
    values.push(status);
  }
  if (driver_name !== undefined) {
    const value = normalizedRequiredText(driver_name, 'Driver name', 100);
    if (value.error) return res.status(400).json({ error: value.error });
    fields.push('driver_name = ?'); values.push(value.value);
  }
  if (body_number !== undefined) {
    const value = normalizedRequiredText(body_number, 'Body number', 20);
    if (value.error) return res.status(400).json({ error: value.error });
    fields.push('body_number = ?'); values.push(value.value.toUpperCase());
  }
  if (plate_number !== undefined) {
    const value = normalizedRequiredText(plate_number, 'Plate number', 20);
    if (value.error) return res.status(400).json({ error: value.error });
    fields.push('plate_number = ?'); values.push(value.value.toUpperCase());
  }
  if (phone !== undefined) { fields.push('phone = ?'); values.push(phone); }
  if (address !== undefined) { fields.push('address = ?'); values.push(address); }
  if (license_number !== undefined) { fields.push('license_number = ?'); values.push(license_number); }
  if (member_since !== undefined && !isValidDateOnly(member_since)) return res.status(400).json({ error: 'Member-since date must use YYYY-MM-DD format' });
  if (member_since !== undefined) { fields.push('member_since = ?'); values.push(normalizeDateOnly(member_since)); }
  if (photo_data !== undefined && photo_data === null) { fields.push('photo_path = NULL'); }
  const photoError = validatePhotoData(photo_data);
  if (photoError) return res.status(400).json({ error: photoError });
  if (archive === true) {
    fields.push('archived_at = NOW()');
  }
  if (fields.length === 0) {
    return res.status(400).json({ error: 'No updatable fields provided' });
  }
  values.push(id);
  try {
    if (photo_data === null) {
      const [[existing]] = await pool.query('SELECT photo_path FROM tricycle_units WHERE unit_id = ? AND archived_at IS NULL', [id]);
      previousPhotoPath = existing?.photo_path || null;
    }
    const [result] = await pool.query(
      `UPDATE tricycle_units SET ${fields.join(', ')} WHERE unit_id = ? AND archived_at IS NULL`,
      values
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Unit not found or already archived' });
    }
    if (photo_data) {
      const photoPath = savePhotoFile(id, photo_data);
      await pool.query('UPDATE tricycle_units SET photo_path = ? WHERE unit_id = ?', [photoPath, id]);
    }
    if (photo_data === null) removePhotoFile(previousPhotoPath);
    await recordAudit(req, archive === true ? 'DRIVER_ARCHIVED' : 'DRIVER_UPDATED', 'tricycle', id, { fields: Object.keys(req.body).filter((key) => key !== 'photo_data') });
    res.json({ success: true });
  } catch (err) {
    console.error('Update tricycle error:', err);
    res.status(500).json({ error: 'Failed to update unit' });
  }
});

app.delete('/api/tricycles/:id', async (req, res) => {
  if (!validUnitId(req.params.id)) return res.status(400).json({ error: 'Invalid unit id' });
  try {
    const [[unit]] = await pool.query('SELECT photo_path FROM tricycle_units WHERE unit_id = ? AND archived_at IS NULL', [req.params.id]);
    const [result] = await pool.query(
      'UPDATE tricycle_units SET archived_at = NOW() WHERE unit_id = ? AND archived_at IS NULL',
      [req.params.id]
    );
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Unit not found or already archived' });
    removePhotoFile(unit?.photo_path);
    await recordAudit(req, 'DRIVER_ARCHIVED', 'tricycle', req.params.id);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete tricycle error:', err);
    res.status(500).json({ error: 'Failed to delete unit' });
  }
});

// Fare Settings – get
app.get('/api/fare-settings', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT minimum_fare FROM fare_settings WHERE setting_id = 1');
    res.json({ minimum_fare: rows[0]?.minimum_fare ?? null });
  } catch (err) {
    console.error('Get fare error:', err);
    res.status(500).json({ error: 'Failed to load fare setting' });
  }
});

// Fare Settings – put (update)
app.put('/api/fare-settings', async (req, res) => {
  const { minimum_fare } = req.body;
  if (minimum_fare === null || minimum_fare === undefined) {
    if (typeof minimum_fare !== 'number' && minimum_fare !== null) {
      return res.status(400).json({ error: 'Minimum fare must be a number or null' });
    }
  } else {
    if (typeof minimum_fare !== 'number' || minimum_fare < 0) {
      return res.status(400).json({ error: 'Minimum fare must be a non‑negative number' });
    }
  }
  try {
    await pool.query(
      'UPDATE fare_settings SET minimum_fare = ? WHERE setting_id = 1',
      [minimum_fare]
    );
    await recordAudit(req, 'FARE_UPDATED', 'fare_settings', '1', { minimum_fare });
    res.json({ success: true });
  } catch (err) {
    console.error('Update fare error:', err);
    res.status(500).json({ error: 'Failed to save fare setting' });
  }
});

// Complaint CSV Import
app.post('/api/complaints/import', upload.single('csvFile'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No CSV file uploaded' });
  }
  const csvPath = req.file.path;
  let imported = 0;
  let duplicates = 0;
  let errors = 0;
  const errorDetails = [];

  try {
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(csvPath)
        .pipe(csv({
          separator: ',',
          mapHeaders: ({ header }) => header.replace(/^\uFEFF/, '').trim()
        }));

      stream.on('data', async (row) => {
        stream.pause();
        try {
          // Helper to get column value case-insensitively
          const get = (key) => {
            const lowerKey = key.toLowerCase();
            const match = Object.keys(row).find(h => h.toLowerCase().replace(/\s/g, '') === lowerKey.replace(/\s/g, ''));
            return match ? row[match] : undefined;
          };

          const dateSubmitted = get('Timestamp') || get('date_submitted') || get('Date');
          const bodyNumber = get('Tricycle Body Number') || get('target_body_number') || get('Body Number');
          const complaintTxt = get('Complaint Details') || get('complaint_summary') || get('Complaint Summary');

          if (!dateSubmitted || !bodyNumber || complaintTxt === undefined) {
            errors++;
            errorDetails.push(`Missing required columns in row: ${JSON.stringify(row)}`);
            stream.resume();
            return;
          }

          // Build deterministic hash
          const hashInput = `${dateSubmitted.trim()}|${bodyNumber.trim()}|${complaintTxt.trim()}`;
          const rowHash = sha256(hashInput);

          // Check if hash already exists
          const [exists] = await pool.query(
            'SELECT 1 FROM tricycle_complaints WHERE external_row_hash = ? LIMIT 1',
            [rowHash]
          );

          if (exists.length > 0) {
            duplicates++;
          } else {
            // Insert new complaint
            await pool.query(
              `INSERT INTO tricycle_complaints
               (external_row_hash, passenger_date_submitted, target_body_number, complaint_summary, status)
               VALUES (?, ?, ?, ?, 'PENDING')`,
              [
                rowHash,
                new Date(dateSubmitted), // MySQL will parse the date string
                bodyNumber.trim().toUpperCase(),
                complaintTxt.trim() // verbatim – imported_at uses its database default
              ]
            );
            imported++;
          }
        } catch (e) {
          errors++;
          errorDetails.push(`Error processing row: ${e.message}`);
        } finally {
          stream.resume();
        }
      });

      stream.on('end', () => {
        resolve();
      });

      stream.on('error', (err) => {
        reject(err);
      });
    });

    // Clean up temp file
    try { fs.unlinkSync(csvPath); } catch (_) {}
  } catch (err) {
    // Ensure temp file removal even on catastrophic failure
    try { fs.unlinkSync(csvPath); } catch (_) {}
    console.error('CSV import failed:', err);
    return res.status(500).json({ error: 'CSV import failed', details: err.message });
  }

  res.json({
    success: true,
    imported,
    duplicates,
    errors,
    errorDetails: errors > 0 ? errorDetails.slice(0, 5) : []
  });
});

// Complaints – list
app.get('/api/complaints', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT complaint_id, external_row_hash, passenger_date_submitted, target_body_number, complaint_summary, status, resolved_at, imported_at
       FROM tricycle_complaints
       ORDER BY imported_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error('List complaints error:', err);
    res.status(500).json({ error: 'Failed to load complaints' });
  }
});

app.get('/api/audit-logs', async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 50, 1), 200);
  try {
    const [rows] = await pool.query(
      `SELECT audit_id, admin_id, action, entity_type, entity_id, details, created_at
       FROM audit_logs ORDER BY created_at DESC, audit_id DESC LIMIT ?`,
      [limit]
    );
    res.json(rows);
  } catch (err) {
    console.error('List audit logs error:', err);
    res.status(500).json({ error: 'Failed to load audit logs' });
  }
});

// Complaint – resolve (toggle)
app.patch('/api/complaints/:id/resolve', async (req, res) => {
  const { id } = req.params;
  try {
    const [result] = await pool.query(
      `UPDATE tricycle_complaints SET status = CASE WHEN status = 'PENDING' THEN 'RESOLVED' ELSE 'PENDING' END, resolved_at = CASE WHEN status = 'PENDING' THEN NOW() ELSE NULL END WHERE complaint_id = ?`,
      [id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Complaint not found' });
    }
    await recordAudit(req, 'COMPLAINT_STATUS_CHANGED', 'complaint', id);
    res.json({ success: true });
  } catch (err) {
    console.error('Resolve complaint error:', err);
    res.status(500).json({ error: 'Failed to resolve complaint' });
  }
});

// ====================== Start Server ======================
if (require.main === module) {
  app.listen(PORT, '127.0.0.1', () => {
    console.log(`[${new Date().toISOString()}] TODA Backend listening on http://127.0.0.1:${PORT}`);
  });
}

app.locals.shutdown = async () => {
  if (typeof sessionStore.close === 'function') sessionStore.close();
  await pool.end();
};

module.exports = app;