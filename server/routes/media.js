'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { requireDmAuth } = require('../auth');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = /\.(jpe?g|png|webp|gif|mp4|webm|ogg|mov)$/i;

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // video maps can be large
  fileFilter: (req, file, cb) => cb(null, ALLOWED_EXT.test(file.originalname)),
});

// DM-only: upload one or more maps/tokens, returns their permanent server URLs.
router.post('/api/media', requireDmAuth, upload.array('files', 20), (req, res) => {
  const results = (req.files || []).map(f => ({
    url: `/media/${f.filename}`,
    name: f.originalname,
    isVideo: /\.(mp4|webm|ogg|mov)$/i.test(f.filename),
  }));
  res.json(results);
});

const MIME = {
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.mov': 'video/quicktime',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif',
};

// Public: players need to load maps/tokens directly, same as the DM's own browser tab.
router.get('/media/:token', (req, res) => {
  const token = req.params.token;
  if (!/^[a-f0-9]+\.[a-z0-9]+$/i.test(token)) return res.status(404).end();
  const filePath = path.join(UPLOAD_DIR, token);

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) return res.status(404).end();
    const contentType = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? Math.min(parseInt(endStr, 10), stat.size - 1) : stat.size - 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': contentType,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': contentType, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(filePath).pipe(res);
    }
  });
});

module.exports = router;
