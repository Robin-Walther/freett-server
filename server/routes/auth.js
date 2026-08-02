'use strict';

const express = require('express');
const router = express.Router();
const { checkPassword, createToken, revokeToken, getTokenFromReq, isValidToken, COOKIE_NAME } = require('../auth');

router.post('/api/login', express.json(), (req, res) => {
  const { password } = req.body || {};
  if (!checkPassword(password)) return res.status(401).json({ success: false });
  const token = createToken();
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  res.json({ success: true });
});

router.post('/api/logout', (req, res) => {
  const token = getTokenFromReq(req);
  if (token) revokeToken(token);
  res.clearCookie(COOKIE_NAME);
  res.json({ success: true });
});

router.get('/api/me', (req, res) => {
  res.json({ authenticated: isValidToken(getTokenFromReq(req)) });
});

module.exports = router;
