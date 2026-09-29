require('dotenv').config();
const express = require('express');
const path = require('path');
const cors = require('cors');
const { db } = require('./db');
const { UPLOAD_DIR } = require('./uploads');
const { AREAS, CATEGORIES, STATUSES } = require('./constants');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Public picklists for the frontend dropdowns
app.get('/api/meta', (req, res) => res.json({ areas: AREAS, categories: CATEGORIES, statuses: STATUSES }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/properties', require('./routes/properties'));
app.use('/api/items', require('./routes/items'));
app.use('/api/workorders', require('./routes/workorders'));

// Uploaded photos
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d' }));

// Frontend
app.use(express.static(path.join(__dirname, '..', 'public')));

// SPA-ish fallback: unknown non-API routes serve the app shell
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Server error' });
});

async function start() {
  await db.migrate();
  await maybeSeedAdmin();
  app.listen(PORT, () => {
    console.log(`Lot Dots running on http://localhost:${PORT}`);
  });
}

// Boot-time admin seed (free-plan friendly: no shell needed).
// If ADMIN_EMAIL + ADMIN_PASSWORD env vars are set and that admin doesn't
// exist yet, create it (and the Blossom Rock property). Safe to leave the
// env vars set — it skips anything that already exists. Remove them from
// the dashboard after the first successful login if you prefer.
async function maybeSeedAdmin() {
  const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || '';
  const name = (process.env.ADMIN_NAME || 'Admin').trim();
  if (!email || !password) return;
  if (password.length < 8) {
    console.error('Boot seed skipped: ADMIN_PASSWORD must be at least 8 characters.');
    return;
  }
  try {
    const { hashPassword } = require('./auth');
    const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      console.log(`Boot seed: admin already exists (${email})`);
    } else {
      await db.run('INSERT INTO users(email, password_hash, role, name) VALUES(?,?,?,?)', [
        email, await hashPassword(password), 'admin', name,
      ]);
      console.log(`Boot seed: admin created (${email})`);
    }
    const prop = await db.get('SELECT id FROM properties WHERE name = ?', ['Blossom Rock']);
    if (!prop) {
      await db.run(
        'INSERT INTO properties(name, city, state, center_lat, center_lng, default_zoom) VALUES(?,?,?,?,?,?)',
        ['Blossom Rock', 'Apache Junction', 'AZ', 33.4123, -111.5496, 15]
      );
      console.log('Boot seed: property created (Blossom Rock)');
    }
  } catch (e) {
    console.error('Boot seed failed:', e.message);
  }
}

if (require.main === module) start();

module.exports = app;
