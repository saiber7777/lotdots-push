/** Shared picklists: park areas and work categories. */
const AREAS = [
  'J. Waltz Park',
  'Saddle Run Park',
  'Goldstone Park',
  'Ridge Park',
  'Cave Trail Park',
  'Ironwood Park / Ironwood Linear Park',
  'Ridgeline Trail Park / Ridgeline Linear Park / Ridgeline Park at Painted Sky',
  'Painted Sky Park',
  "Miner's Run Adventure Playground",
  'Ruff Ranch Dog Park',
  'Oro Canyon Park',
];

const CATEGORIES = [
  'dead plant',
  'irrigation leak',
  'trash',
  'pressure wash',
  'broken/damaged',
  'weeds',
  'other',
];

const STATUSES = ['open', 'assigned', 'done'];

module.exports = { AREAS, CATEGORIES, STATUSES };
