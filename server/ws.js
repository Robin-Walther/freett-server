'use strict';

const { WebSocketServer } = require('ws');
const { table } = require('./state');
const { isValidToken, parseCookies } = require('./auth');

function broadcastToPlayers(msg, exceptWs) {
  const str = JSON.stringify(msg);
  for (const [ws] of table.players) {
    if (ws !== exceptWs && ws.readyState === 1) ws.send(str);
  }
}

function sendToDm(msg) {
  if (table.dmSocket && table.dmSocket.readyState === 1) {
    table.dmSocket.send(JSON.stringify(msg));
  }
}

// DM-pushed state that gets cached so late-joining/reconnecting players catch up.
const CACHEABLE = new Set(['map', 'fog', 'grid', 'tokens', 'view', 'volume']);

function handleDmMessage(msg) {
  if (!msg || typeof msg.type !== 'string') return;

  if (CACHEABLE.has(msg.type)) {
    table.lastState[msg.type] = msg;
    broadcastToPlayers(msg);
    return;
  }

  switch (msg.type) {
    case 'ping':
      broadcastToPlayers(msg);
      break;
    // Full-list reset, sent by the DM whenever the active scene/slot changes.
    case 'pins':
      table.lastState.pins = msg.pins || [];
      broadcastToPlayers(msg);
      break;
    case 'place-pin':
      if (!table.lastState.pins) table.lastState.pins = [];
      table.lastState.pins.push(msg.pin);
      broadcastToPlayers(msg);
      break;
    case 'remove-pin':
      table.lastState.pins = (table.lastState.pins || []).filter(p => p.id !== msg.pinId);
      broadcastToPlayers(msg);
      break;
  }
}

function handlePlayerMessage(ws, playerId, msg) {
  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case 'token-move':
      sendToDm({ type: 'token-move', tokenId: msg.tokenId, tokenX: msg.tokenX, tokenY: msg.tokenY });
      broadcastToPlayers(msg, ws);
      break;
    case 'player-ping':
      sendToDm({ type: 'player-ping', playerId, imgX: msg.imgX, imgY: msg.imgY, color: msg.color });
      broadcastToPlayers(msg, ws);
      break;
    case 'place-pin':
      if (!table.lastState.pins) table.lastState.pins = [];
      table.lastState.pins.push(msg.pin);
      sendToDm(msg);
      broadcastToPlayers(msg, ws);
      break;
    case 'remove-pin':
      table.lastState.pins = (table.lastState.pins || []).filter(p => p.id !== msg.pinId);
      sendToDm(msg);
      broadcastToPlayers(msg, ws);
      break;
  }
}

function sendCachedStateTo(ws) {
  const s = table.lastState;
  try {
    for (const key of ['map', 'fog', 'grid', 'tokens', 'view', 'volume']) {
      if (s[key]) ws.send(JSON.stringify(s[key]));
    }
    if (s.pins && s.pins.length > 0) ws.send(JSON.stringify({ type: 'pins', pins: s.pins }));
  } catch { /* socket already gone */ }
}

function attachWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');

    if (url.pathname === '/ws/dm') {
      const cookies = parseCookies(req.headers.cookie);
      if (!isValidToken(cookies[require('./auth').COOKIE_NAME])) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        table.dmSocket = ws;
        ws.on('message', (data) => {
          try { handleDmMessage(JSON.parse(data.toString())); } catch { /* ignore malformed */ }
        });
        ws.on('close', () => { if (table.dmSocket === ws) table.dmSocket = null; });
      });
      return;
    }

    if (url.pathname === '/ws/player') {
      const sessionCode = url.searchParams.get('session');
      if (sessionCode !== table.sessionCode) {
        wss.handleUpgrade(req, socket, head, (ws) => ws.close(4000, 'Session not found'));
        return;
      }
      const playerId = url.searchParams.get('player') || null;
      wss.handleUpgrade(req, socket, head, (ws) => {
        table.players.set(ws, { playerId });
        sendCachedStateTo(ws);
        ws.on('message', (data) => {
          try { handlePlayerMessage(ws, playerId, JSON.parse(data.toString())); } catch { /* ignore malformed */ }
        });
        ws.on('close', () => table.players.delete(ws));
        ws.on('error', () => table.players.delete(ws));
      });
      return;
    }

    socket.destroy();
  });

  return wss;
}

module.exports = { attachWebSocketServer };
