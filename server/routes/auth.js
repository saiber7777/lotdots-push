const express = require('express');
const { db } = require('../db');
const { checkPassword, signToken, requireAuth } = require('../auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = await db.get('SELECT * FROM users WHERE email = ?', [String(email).toLowerCase().trim()]);
  if (!user) return res.status(401).json({ error: 'Wrong email or password' });
  const ok = await checkPassword(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Wrong email or password' });
  const safe = { id: user.id, email: user.email, role: user.role, name: user.name };
  res.json({ token: signToken(safe), user: safe });
});

router.get('/me', requireAuth, async (req, res) => {
  const user = await db.get('SELECT id, email, role, name FROM users WHERE id = ?', [req.user.id]);
  if (!user) return res.status(401).json({ error: 'Account no longer exists' });
  res.json({ user });
});

module.exports = router;
