'use strict';

const express = require('express');
const { requireDmAuth } = require('../auth');
const { table, regenerateSessionCode } = require('../state');

const router = express.Router();

router.get('/api/table', requireDmAuth, (req, res) => {
  res.json({ code: table.sessionCode });
});

// Kicks all currently-connected players; anyone with the old link needs the new one.
router.post('/api/table/regenerate', requireDmAuth, (req, res) => {
  res.json({ code: regenerateSessionCode() });
});

module.exports = router;
