'use strict';

const crypto = require('crypto');

function generateSessionCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Single-DM v1: one server process = one running "table". No multi-tenant state.
const table = {
  sessionCode: generateSessionCode(),
  dmSocket: null,
  players: new Map(), // ws -> { playerId }
  lastState: { map: null, fog: null, grid: null, tokens: null, pins: [], view: null, volume: null },
};

// Kicks all connected players (they auto-reconnect and get "session not found"
// until given the new link) — used as a lightweight "reset access" admin action.
function regenerateSessionCode() {
  table.sessionCode = generateSessionCode();
  for (const [ws] of table.players) {
    try { ws.close(4000, 'Session code regenerated'); } catch {}
  }
  table.players.clear();
  return table.sessionCode;
}

module.exports = { table, regenerateSessionCode };
