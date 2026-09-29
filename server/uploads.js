/** Photo uploads: multer receives the file, sharp resizes it, original is deleted. */
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(path.join(UPLOAD_DIR, 'tmp'), { recursive: true });

const upload = multer({
  dest: path.join(UPLOAD_DIR, 'tmp'),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|heic|heif)/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

/** Resize to max 1600px on the long edge, JPEG quality 80. Returns public path. */
async function storePhoto(tmpPath, prefix) {
  const name = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
  const outPath = path.join(UPLOAD_DIR, name);
  await sharp(tmpPath)
    .rotate() // honor EXIF orientation
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(outPath);
  fs.unlink(tmpPath, () => {});
  return `/uploads/${name}`;
}

module.exports = { upload, storePhoto, UPLOAD_DIR };
