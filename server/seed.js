/**
 * Seed script: creates the admin user and the Blossom Rock property.
 * Credentials come ONLY from env vars (never hardcoded):
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-strong-password' npm run seed
 *
 * Safe to re-run: it skips anything that already exists.
 */
require('dotenv').config();
const { db } = require('./db');
const { hashPassword } = require('./auth');

async function main() {
  await db.migrate();

  const email = (process.env.ADMIN_EMAIL || '').toLowerCase().trim();
  const password = process.env.ADMIN_PASSWORD || '';
  const name = (process.env.ADMIN_NAME || 'Admin').trim();

  if (!email || !password) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD env vars, e.g.:');
    console.error("  ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='strong-pass' npm run seed");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('ADMIN_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    console.log(`Admin already exists: ${email}`);
  } else {
    await db.run('INSERT INTO users(email, password_hash, role, name) VALUES(?,?,?,?)', [
      email, await hashPassword(password), 'admin', name,
    ]);
    console.log(`Admin created: ${email}`);
  }

  const prop = await db.get('SELECT id FROM properties WHERE name = ?', ['Blossom Rock']);
  if (prop) {
    console.log('Property already exists: Blossom Rock');
  } else {
    await db.run(
      'INSERT INTO properties(name, city, state, center_lat, center_lng, default_zoom) VALUES(?,?,?,?,?,?)',
      ['Blossom Rock', 'Apache Junction', 'AZ', 33.4123, -111.5496, 15]
    );
    console.log('Property created: Blossom Rock (Apache Junction, AZ)');
  }
  console.log('Seed complete.');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
