const express = require('express');
const { db } = require('../db');
const { hashPassword, requireAuth, requireRole } = require('../auth');

const router = express.Router();
router.use(requireAuth);

const PUBLIC = 'id, email, role, name, created_at';

// Admin creates crew/supervisor accounts (and additional admins).
router.post('/', requireRole('admin'), async (req, res) => {
  const { email, password, role, name } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  if (!['admin', 'supervisor', 'crew'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin, supervisor, or crew' });
  }
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const exists = await db.get('SELECT id FROM users WHERE email = ?', [String(email).toLowerCase().trim()]);
  if (exists) return res.status(409).json({ error: 'That email is already registered' });
  const r = await db.run(
    'INSERT INTO users(email, password_hash, role, name) VALUES(?,?,?,?)',
    [String(email).toLowerCase().trim(), await hashPassword(password), role, String(name || '').trim()]
  );
  const user = await db.get(`SELECT ${PUBLIC} FROM users WHERE id = ?`, [r.lastID]);
  res.status(201).json({ user });
});

router.get('/', requireRole('admin', 'supervisor'), async (req, res) => {
  const users = await db.all(`SELECT ${PUBLIC} FROM users ORDER BY created_at ASC`);
  res.json({ users });
});

module.exports = router;
