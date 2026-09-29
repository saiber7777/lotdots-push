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
  app.listen(PORT, () => {
    console.log(`Blossom Rock Crew App running on http://localhost:${PORT}`);
  });
}

if (require.main === module) start();

module.exports = app;
