const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');

const router = express.Router();
router.use(requireAuth);

// Snapshot a set of items into a work order (supervisor/admin), or read one back.
router.post('/', async (req, res) => {
  if (!['admin', 'supervisor'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only supervisors and admins create work orders' });
  }
  const { property_id, title, item_ids } = req.body || {};
  if (!property_id || !Array.isArray(item_ids) || !item_ids.length) {
    return res.status(400).json({ error: 'Property and at least one item required' });
  }
  const property = await db.get('SELECT * FROM properties WHERE id = ?', [property_id]);
  if (!property) return res.status(404).json({ error: 'Property not found' });
  const r = await db.run(
    'INSERT INTO work_orders(property_id, title, item_ids, created_by) VALUES(?,?,?,?)',
    [property_id, String(title || 'Work order').trim(), JSON.stringify(item_ids.map(Number)), req.user.id]
  );
  const wo = await db.get('SELECT * FROM work_orders WHERE id = ?', [r.lastID]);
  res.status(201).json({ work_order: wo });
});

router.get('/:id', async (req, res) => {
  const wo = await db.get(
    `SELECT w.*, p.name AS property_name, u.name AS created_by_name
     FROM work_orders w
     JOIN properties p ON p.id = w.property_id
     LEFT JOIN users u ON u.id = w.created_by
     WHERE w.id = ?`,
    [req.params.id]
  );
  if (!wo) return res.status(404).json({ error: 'Work order not found' });
  const ids = JSON.parse(wo.item_ids || '[]');
  let items = [];
  if (ids.length) {
    const placeholders = ids.map(() => '?').join(',');
    items = await db.all(
      `SELECT i.*, p.name AS property_name, u.name AS assigned_name
       FROM items i JOIN properties p ON p.id = i.property_id
       LEFT JOIN users u ON u.id = i.assigned_to
       WHERE i.id IN (${placeholders}) ORDER BY i.pin_number ASC`,
      ids
    );
  }
  res.json({ work_order: wo, items });
});

router.get('/', async (req, res) => {
  const { property_id } = req.query;
  const params = [];
  let where = '';
  if (property_id) { where = 'WHERE w.property_id = ?'; params.push(property_id); }
  const orders = await db.all(
    `SELECT w.*, p.name AS property_name FROM work_orders w
     JOIN properties p ON p.id = w.property_id
     ${where} ORDER BY w.created_at DESC`,
    params
  );
  res.json({ work_orders: orders });
});

module.exports = router;
