'use strict';

const crypto = require('crypto');

const COOKIE_NAME = 'freett_dm';
const validTokens = new Set();

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function checkPassword(candidate) {
  const expected = process.env.DM_PASSWORD || '';
  if (!expected) return false;
  const a = crypto.createHash('sha256').update(String(candidate || '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function createToken() {
  const token = crypto.randomBytes(32).toString('hex');
  validTokens.add(token);
  return token;
}

function revokeToken(token) {
  validTokens.delete(token);
}

function isValidToken(token) {
  return !!token && validTokens.has(token);
}

function getTokenFromReq(req) {
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
}

// Protects both page routes (redirect to login) and /api/* routes (401 JSON).
function requireDmAuth(req, res, next) {
  if (isValidToken(getTokenFromReq(req))) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  res.redirect('/login.html');
}

module.exports = {
  COOKIE_NAME,
  parseCookies,
  checkPassword,
  createToken,
  revokeToken,
  isValidToken,
  getTokenFromReq,
  requireDmAuth,
};
