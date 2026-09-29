const express = require('express');
const { db } = require('../db');
const { requireAuth, requireRole } = require('../auth');
const { upload, storePhoto } = require('../uploads');
const { AREAS, CATEGORIES, STATUSES } = require('../constants');

const router = express.Router();
router.use(requireAuth);

const SELECT = `
  SELECT i.*,
         p.name AS property_name,
         u.name AS assigned_name,
         c.name AS created_by_name
  FROM items i
  JOIN properties p ON p.id = i.property_id
  LEFT JOIN users u ON u.id = i.assigned_to
  LEFT JOIN users c ON c.id = i.created_by
`;

// Allowed status moves. Admins may also reopen.
const FLOW = { open: ['assigned'], assigned: ['done', 'open'], done: [] };

router.get('/', async (req, res) => {
  const { property_id, status } = req.query;
  const where = [];
  const params = [];
  if (property_id) { where.push('i.property_id = ?'); params.push(property_id); }
  if (status && STATUSES.includes(status)) { where.push('i.status = ?'); params.push(status); }
  const items = await db.all(
    `${SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.pin_number ASC`,
    params
  );
  res.json({ items });
});

router.get('/:id', async (req, res) => {
  const item = await db.get(`${SELECT} WHERE i.id = ?`, [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  res.json({ item });
});

// Crew drops a pin. Photo optional at creation.
router.post('/', upload.single('photo'), async (req, res) => {
  try {
    const { property_id, area, category, notes, lat, lng } = req.body || {};
    if (!property_id || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'Property and map location required' });
    }
    const property = await db.get('SELECT id FROM properties WHERE id = ?', [property_id]);
    if (!property) return res.status(404).json({ error: 'Property not found' });
    if (area && !AREAS.includes(area)) return res.status(400).json({ error: 'Unknown area' });
    if (category && !CATEGORIES.includes(category)) return res.status(400).json({ error: 'Unknown category' });

    const row = await db.get('SELECT MAX(pin_number) AS m FROM items WHERE property_id = ?', [property_id]);
    const pin_number = (row && row.m ? row.m : 0) + 1;

    let photo_path = null;
    if (req.file) photo_path = await storePhoto(req.file.path, 'pin');

    const r = await db.run(
      `INSERT INTO items(property_id, pin_number, area, category, notes, status, lat, lng, photo_path, created_by)
       VALUES(?,?,?,?,?,'open',?,?,?,?)`,
      [
        property_id, pin_number,
        area || '', category || 'other', String(notes || '').trim(),
        Number(lat), Number(lng), photo_path, req.user.id,
      ]
    );
    const item = await db.get(`${SELECT} WHERE i.id = ?`, [r.lastID]);
    res.status(201).json({ item });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Update notes/area/category/assignment/status (status transitions validated).
router.patch('/:id', async (req, res) => {
  const item = await db.get('SELECT * FROM items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  const updates = [];
  const params = [];
  const set = (col, val) => { updates.push(`${col} = ?`); params.push(val); };

  if (req.body.notes !== undefined) set('notes', String(req.body.notes).trim());
  if (req.body.area !== undefined) {
    if (req.body.area && !AREAS.includes(req.body.area)) return res.status(400).json({ error: 'Unknown area' });
    set('area', req.body.area || '');
  }
  if (req.body.category !== undefined) {
    if (!CATEGORIES.includes(req.body.category)) return res.status(400).json({ error: 'Unknown category' });
    set('category', req.body.category);
  }
  if (req.body.assigned_to !== undefined) {
    if (!['supervisor', 'admin'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Only supervisors and admins can assign work' });
    }
    if (req.body.assigned_to) {
      const u = await db.get('SELECT id FROM users WHERE id = ?', [req.body.assigned_to]);
      if (!u) return res.status(400).json({ error: 'Unknown user' });
    }
    set('assigned_to', req.body.assigned_to || null);
  }
  if (req.body.status !== undefined) {
    const next = req.body.status;
    if (!STATUSES.includes(next)) return res.status(400).json({ error: 'Unknown status' });
    const allowed = [...(FLOW[item.status] || [])];
    if (req.user.role === 'admin' && next === 'open') allowed.push('open'); // admins can reopen
    if (next !== item.status && !allowed.includes(next)) {
      return res.status(400).json({ error: `Cannot move from ${item.status} to ${next}` });
    }
    if (next === 'done') {
      return res.status(400).json({ error: 'Use the completion endpoint with a proof photo to mark done' });
    }
    set('status', next);
    if (next === 'open') { set('completed_at', null); set('proof_photo_path', null); }
  }

  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  set('updated_at', new Date().toISOString());
  params.push(req.params.id);
  await db.run(`UPDATE items SET ${updates.join(', ')} WHERE id = ?`, params);
  const updated = await db.get(`${SELECT} WHERE i.id = ?`, [req.params.id]);
  res.json({ item: updated });
});

// Mark done WITH a proof photo (required).
router.post('/:id/complete', upload.single('proof'), async (req, res) => {
  const item = await db.get('SELECT * FROM items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (item.status !== 'assigned') {
    return res.status(400).json({ error: 'Only assigned items can be completed' });
  }
  if (!req.file) return res.status(400).json({ error: 'A completion photo is required' });
  const proof_photo_path = await storePhoto(req.file.path, 'proof');
  await db.run(
    `UPDATE items SET status = 'done', proof_photo_path = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
    [proof_photo_path, new Date().toISOString(), new Date().toISOString(), req.params.id]
  );
  const updated = await db.get(`${SELECT} WHERE i.id = ?`, [req.params.id]);
  res.json({ item: updated });
});

// Add or replace the pin's main photo.
router.post('/:id/photo', upload.single('photo'), async (req, res) => {
  const item = await db.get('SELECT * FROM items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
  const photo_path = await storePhoto(req.file.path, 'pin');
  await db.run('UPDATE items SET photo_path = ?, updated_at = ? WHERE id = ?', [
    photo_path, new Date().toISOString(), req.params.id,
  ]);
  const updated = await db.get(`${SELECT} WHERE i.id = ?`, [req.params.id]);
  res.json({ item: updated });
});

router.delete('/:id', requireRole('admin', 'supervisor'), async (req, res) => {
  const r = await db.run('DELETE FROM items WHERE id = ?', [req.params.id]);
  if (!r.changes) return res.status(404).json({ error: 'Item not found' });
  res.json({ ok: true });
});

module.exports = router;
