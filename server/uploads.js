/** Photo uploads: multer receives the file, sharp resizes it, storage keeps it. */
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const sharp = require('sharp');
const { putPhoto, UPLOAD_DIR } = require('./storage');

const TMP_DIR = path.join(UPLOAD_DIR, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });

const upload = multer({
  dest: TMP_DIR,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|heic|heif)/i.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

/** Resize to max 1600px on the long edge, JPEG quality 80. Returns public URL/path. */
async function storePhoto(tmpPath, prefix) {
  const name = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}.jpg`;
  try {
    const buffer = await sharp(tmpPath)
      .rotate() // honor EXIF orientation
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
    return await putPhoto(buffer, name);
  } finally {
    fs.unlink(tmpPath, () => {});
  }
}

module.exports = { upload, storePhoto, UPLOAD_DIR };
