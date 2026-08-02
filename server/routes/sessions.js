'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { requireDmAuth } = require('../auth');

const router = express.Router();

const SESSIONS_DIR = path.join(__dirname, '..', '..', 'data', 'sessions');
fs.mkdirSync(SESSIONS_DIR, { recursive: true });

function safeName(name) {
  const cleaned = String(name || 'current').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return cleaned || 'current';
}

// List saved session names (without the .json extension)
router.get('/api/sessions', requireDmAuth, (req, res) => {
  const files = fs.readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.json'));
  res.json(files.map(f => f.replace(/\.json$/, '')));
});

router.post('/api/session', requireDmAuth, express.json({ limit: '50mb' }), (req, res) => {
  const filePath = path.join(SESSIONS_DIR, `${safeName(req.query.name)}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(req.body, null, 2), 'utf-8');
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/api/session', requireDmAuth, (req, res) => {
  const filePath = path.join(SESSIONS_DIR, `${safeName(req.query.name)}.json`);
  fs.readFile(filePath, 'utf-8', (err, raw) => {
    if (err) return res.status(404).json(null);
    try { res.json(JSON.parse(raw)); } catch { res.status(500).json(null); }
  });
});

module.exports = router;
