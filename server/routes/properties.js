const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const properties = await db.all('SELECT * FROM properties ORDER BY name ASC');
  res.json({ properties });
});

router.get('/:id', async (req, res) => {
  const property = await db.get('SELECT * FROM properties WHERE id = ?', [req.params.id]);
  if (!property) return res.status(404).json({ error: 'Property not found' });
  res.json({ property });
});

router.post('/', requireRole('admin'), async (req, res) => {
  const { name, city, state, center_lat, center_lng, default_zoom } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Property name required' });
  const r = await db.run(
    'INSERT INTO properties(name, city, state, center_lat, center_lng, default_zoom) VALUES(?,?,?,?,?,?)',
    [
      String(name).trim(),
      String(city || '').trim(),
      String(state || '').trim(),
      Number(center_lat) || 33.4123,
      Number(center_lng) || -111.5496,
      Number(default_zoom) || 15,
    ]
  );
  const property = await db.get('SELECT * FROM properties WHERE id = ?', [r.lastID]);
  res.status(201).json({ property });
});

module.exports = router;
