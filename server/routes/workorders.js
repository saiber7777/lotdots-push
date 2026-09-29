const express = require('express');
const crypto = require('crypto');
const sharp = require('sharp');
const { db } = require('../db');
const { requireAuth, verifyToken } = require('../auth');

const router = express.Router();

// ---- Work order cover map: static PNG from the same current Google satellite
// tiles the app map uses (NOT the stale Esri export). ------------------------
const TILE_URL = (x, y, z) => `https://mt1.google.com/vt/lyrs=s&x=${x}&y=${y}&z=${z}`;
const TILE = 256, MAX_W = 1280, MAX_H = 900;

const lonToPx = (lon, z) => ((lon + 180) / 360) * 2 ** z * TILE;
const latToPy = (lat, z) => {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z * TILE;
};

const mapCache = new Map(); // sha1(item coords) -> PNG buffer, capped at 50

// Category colors must match public/js/common.js CATEGORY_COLORS
const CATEGORY_COLORS = {
  'dead plant': '#92400e',
  'irrigation leak': '#1d6fd8',
  'trash': '#525252',
  'pressure wash': '#0e7490',
  'broken/damaged': '#dc2626',
  'weeds': '#16a34a',
  'other': '#7c3aed',
};

async function fetchTile(x, y, z) {
  const res = await fetch(TILE_URL(x, y, z), {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`tile ${z}/${x}/${y} -> HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function renderWorkOrderMap(items) {
  const lats = items.map(i => i.lat), lngs = items.map(i => i.lng);
  let minLat = Math.min(...lats), maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  // Tight padding: keep the map zoomed in close on the pins like the app's
  // map view, so pins appear in the same spots the user placed them.
  // 0.0008° ≈ 90m — enough context without losing the location.
  const padLat = Math.max((maxLat - minLat) * 0.25, 0.0008);
  const padLng = Math.max((maxLng - minLng) * 0.25, 0.0008);
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;

  // Start at z=19 (closest Google satellite zoom) and only zoom out as far
  // as needed to fit. This matches the app's close-up pin placement view.
  let z = 19;
  while (z > 10) {
    const w = lonToPx(maxLng, z) - lonToPx(minLng, z);
    const h = latToPy(minLat, z) - latToPy(maxLat, z);
    if (w <= MAX_W && h <= MAX_H) break;
    z--;
  }

  const px0 = lonToPx(minLng, z), px1 = lonToPx(maxLng, z);
  const py0 = latToPy(maxLat, z), py1 = latToPy(minLat, z);
  const tx0 = Math.floor(px0 / TILE), tx1 = Math.floor(px1 / TILE);
  const ty0 = Math.floor(py0 / TILE), ty1 = Math.floor(py1 / TILE);

  const jobs = [];
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++)
      jobs.push(fetchTile(tx, ty, z).then(buf => ({ tx, ty, buf })));
  const tiles = await Promise.all(jobs);

  const full = sharp({
    create: {
      width: (tx1 - tx0 + 1) * TILE,
      height: (ty1 - ty0 + 1) * TILE,
      channels: 3,
      background: { r: 232, g: 232, b: 232 },
    },
  }).composite(tiles.map(t => ({
    input: t.buf, left: (t.tx - tx0) * TILE, top: (t.ty - ty0) * TILE,
  })));

  const extracted = await full.extract({
    left: Math.round(px0 - tx0 * TILE),
    top: Math.round(py0 - ty0 * TILE),
    width: Math.max(1, Math.round(px1 - px0)),
    height: Math.max(1, Math.round(py1 - py0)),
  }).png().toBuffer();

  // Draw category-colored numbered pins directly into the image so the
  // map and pins can never drift out of alignment (no client overlay).
  // Pins are drawn at their exact GPS positions — never shifted — so the
  // map stays truthful even when pins overlap.
  const W = Math.max(1, Math.round(px1 - px0));
  const H = Math.max(1, Math.round(py1 - py0));
  const R = 15; // pin radius in px
  let svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">`;
  for (const it of items) {
    const cx = Math.round(lonToPx(it.lng, z) - px0);
    const cy = Math.round(latToPy(it.lat, z) - py0);
    const color = CATEGORY_COLORS[it.category] || CATEGORY_COLORS.other;
    const label = String(it.pin_number ?? '');
    svg += `<g><circle cx="${cx}" cy="${cy}" r="${R}" fill="${color}" stroke="#ffffff" stroke-width="3"/>` +
      `<text x="${cx}" y="${cy + 5}" text-anchor="middle" font-family="DejaVu Sans, sans-serif" ` +
      `font-size="14" font-weight="800" fill="#ffffff">${label}</text></g>`;
  }
  svg += `</svg>`;

  return sharp(extracted).composite([{ input: Buffer.from(svg), top: 0, left: 0 }]).png().toBuffer();
}

// Static map image for the work order cover. JWT comes via ?token= because
// <img> tags can't set an Authorization header.
router.get('/:id/map.png', async (req, res) => {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    let user = null;
    if (token) { try { user = verifyToken(token); } catch { /* fall through to 401 */ } }
    if (!user) return res.status(401).json({ error: 'Login required' });

    const wo = await db.get('SELECT * FROM work_orders WHERE id = ?', [req.params.id]);
    if (!wo) return res.status(404).json({ error: 'Work order not found' });
    const ids = JSON.parse(wo.item_ids || '[]');
    if (!ids.length) return res.status(404).json({ error: 'Work order has no items' });
    const placeholders = ids.map(() => '?').join(',');
    const items = await db.all(
      `SELECT lat, lng, pin_number, category FROM items WHERE id IN (${placeholders}) ORDER BY pin_number ASC`,
      ids
    );
    if (!items.length) return res.status(404).json({ error: 'Work order has no items' });

    const key = crypto.createHash('sha1')
      .update(`${wo.id}:${items.map(i => `${i.lat},${i.lng},${i.pin_number},${i.category}`).join('|')}`)
      .digest('hex');
    if (!mapCache.has(key)) {
      if (mapCache.size >= 50) mapCache.delete(mapCache.keys().next().value);
      mapCache.set(key, await renderWorkOrderMap(items));
    }
    res.set('Content-Type', 'image/png');
    // No browser cache: the server's in-memory mapCache is content-keyed and
    // fast, so always revalidate. A max-age here would show a stale map for
    // minutes after pins are added/deleted/recategorized.
    res.set('Cache-Control', 'no-store');
    res.send(mapCache.get(key));
  } catch (e) {
    console.error('map.png failed:', e.message);
    res.status(502).json({ error: 'Could not render map image' });
  }
});

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
  // Report the count of items that actually still exist (pins may have been
  // deleted after the work order was created).
  for (const o of orders) {
    let ids = [];
    try { ids = JSON.parse(o.item_ids || '[]'); } catch { ids = []; }
    if (!ids.length) { o.item_count = 0; continue; }
    const placeholders = ids.map(() => '?').join(',');
    const row = await db.get(`SELECT COUNT(*) AS c FROM items WHERE id IN (${placeholders})`, ids);
    o.item_count = row ? row.c : 0;
  }
  res.json({ work_orders: orders });
});

module.exports = router;
