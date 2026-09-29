/** Photo storage: S3-compatible object storage when configured, local disk otherwise.
 *
 * Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY (and optionally
 * S3_PUBLIC_URL, S3_REGION) to store photos permanently in object storage
 * (Cloudflare R2, AWS S3, etc.). Without them, photos stay on local disk
 * under UPLOAD_DIR — fine for dev, but wiped on redeploy on Render.
 */
const path = require('path');
const fs = require('fs');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './uploads');

let s3 = null;
const bucket = process.env.S3_BUCKET;
if (process.env.S3_ENDPOINT && bucket && process.env.S3_ACCESS_KEY && process.env.S3_SECRET_KEY) {
  const { S3Client } = require('@aws-sdk/client-s3');
  s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || 'auto',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY,
      secretAccessKey: process.env.S3_SECRET_KEY,
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === '1',
  });
  console.log(`Photo storage: S3-compatible bucket "${bucket}"`);
} else {
  console.log('Photo storage: local disk (set S3_* env vars for permanent storage)');
}

/** Store a JPEG buffer. Returns the public URL (absolute) or local path. */
async function putPhoto(buffer, filename) {
  const key = `photos/${filename}`;
  if (s3) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: 'image/jpeg',
      CacheControl: 'public, max-age=31536000',
    }));
    const base = (process.env.S3_PUBLIC_URL || `${process.env.S3_ENDPOINT}/${bucket}`).replace(/\/$/, '');
    return `${base}/${key}`;
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, filename), buffer);
  return `/uploads/${filename}`;
}

module.exports = { putPhoto, UPLOAD_DIR, usingRemoteStorage: !!s3 };
