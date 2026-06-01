const { app, BrowserWindow, ipcMain, dialog, screen, session } = require('electron');
const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const WebSocket = require('ws');

let dmWindow = null;
let playerWindow = null;

function createWindows() {
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();

  // Find secondary display if available
  const secondaryDisplay = displays.find(d => d.id !== primaryDisplay.id) || primaryDisplay;

  // DM Screen on primary monitor
  dmWindow = new BrowserWindow({
    x: primaryDisplay.bounds.x + 50,
    y: primaryDisplay.bounds.y + 50,
    width: 1280,
    height: 800,
    title: 'FreeTT – DM Screen',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  dmWindow.loadFile('dm/dm-screen.html');

  // Player Screen on secondary monitor (or primary if only one)
  const playerX = secondaryDisplay === primaryDisplay
    ? primaryDisplay.bounds.x + primaryDisplay.bounds.width - 1280 - 50
    : secondaryDisplay.bounds.x + 50;
  const playerY = secondaryDisplay.bounds.y + 50;

  playerWindow = new BrowserWindow({
    x: playerX,
    y: playerY,
    width: 1280,
    height: 800,
    title: 'FreeTT – Player Screen',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  playerWindow.loadFile('player-local/player-screen.html');

  dmWindow.on('closed', () => {
    dmWindow = null;
    if (playerWindow) playerWindow.close();
    for (const [, session] of remoteSessions) {
      for (const [client] of session.clients) {
        try { client.close(4001, 'Session ended'); } catch {}
      }
    }
    remoteSessions.clear();
    if (currentTunnel) { try { currentTunnel.close(); } catch {} currentTunnel = null; }
    mediaRegistry.clear();
  });

  playerWindow.on('closed', () => {
    playerWindow = null;
  });
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

app.whenReady().then(() => {
  // Strip "Electron/x.x.x" from the music session UA so YouTube doesn't block playback
  const musicSession = session.fromPartition('music');
  musicSession.setUserAgent(musicSession.getUserAgent().replace(/\s*Electron\/[\d.]+/, ''));
  createWindows();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindows();
});

// IPC: DM closes local player window (when switching to remote mode)
ipcMain.on('close-player-window', () => {
  if (playerWindow) playerWindow.close();
});

// IPC: DM reopens local player window (when switching back to local mode)
ipcMain.on('reopen-player-window', () => {
  if (playerWindow) return;
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();
  const secondaryDisplay = displays.find(d => d.id !== primaryDisplay.id) || primaryDisplay;
  const playerX = secondaryDisplay === primaryDisplay
    ? primaryDisplay.bounds.x + primaryDisplay.bounds.width - 1280 - 50
    : secondaryDisplay.bounds.x + 50;
  const playerY = secondaryDisplay.bounds.y + 50;
  playerWindow = new BrowserWindow({
    x: playerX,
    y: playerY,
    width: 1280,
    height: 800,
    title: 'FreeTT – Player Screen',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  playerWindow.loadFile('player-local/player-screen.html');
  playerWindow.on('closed', () => { playerWindow = null; });
});

// IPC: Player toggles native fullscreen
ipcMain.handle('toggle-player-fullscreen', () => {
  if (playerWindow) {
    const goFullscreen = !playerWindow.isFullScreen();
    playerWindow.setFullScreen(goFullscreen);
    playerWindow.setMenuBarVisibility(!goFullscreen);
  }
});

// IPC: DM requests file dialog (multi-select)
ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(dmWindow, {
    title: 'Karten/Bilder/Videos laden',
    filters: [
      { name: 'Medien', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'ogg', 'mov'] },
      { name: 'Bilder', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif'] },
      { name: 'Videos', extensions: ['mp4', 'webm', 'ogg', 'mov'] },
    ],
    properties: ['openFile', 'multiSelections'],
  });

  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths;
});

// IPC: DM loaded an image -> forward to player
ipcMain.on('image-loaded', (event, filePath) => {
  if (playerWindow) {
    playerWindow.webContents.send('image-loaded', filePath);
  }
});

// IPC: Fog of War update from DM -> forward to player
ipcMain.on('fog-update', (event, fogData) => {
  if (playerWindow) {
    playerWindow.webContents.send('fog-update', fogData);
  }
});

// IPC: Full fog reset
ipcMain.on('fog-reset', (event, data) => {
  if (playerWindow) {
    playerWindow.webContents.send('fog-reset', data);
  }
});

// IPC: Volume/mute change from DM -> forward to player
// executeJavaScript with userGesture:true bypasses Chromium's gesture lock so that
// video.muted = false takes effect even without prior user interaction in the player window
ipcMain.on('volume-change', (event, data) => {
  if (playerWindow) {
    playerWindow.webContents.send('volume-change', data);
    playerWindow.webContents.executeJavaScript(
      `typeof __playerApplyVolume === 'function' && __playerApplyVolume(${data.volume}, ${data.muted})`,
      true
    ).catch(() => {});
  }
});

// IPC: Player signals video is ready -> forward to DM
ipcMain.on('video-ready', () => {
  if (dmWindow) {
    dmWindow.webContents.send('video-ready');
  }
});

// YouTube search via internal API (no API key required)
function youtubeSearch(query) {
  const body = JSON.stringify({
    context: { client: { clientName: 'WEB', clientVersion: '2.20210721.00.00' } },
    query,
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.youtube.com',
      path: '/youtubei/v1/search?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const sections = json.contents?.twoColumnSearchResultsRenderer
            ?.primaryContents?.sectionListRenderer?.contents ?? [];
          const videos = [];
          for (const section of sections) {
            for (const item of section.itemSectionRenderer?.contents ?? []) {
              if (item.videoRenderer) {
                videos.push({
                  id: item.videoRenderer.videoId,
                  title: item.videoRenderer.title.runs.map(r => r.text).join(''),
                });
              }
            }
          }
          resolve(videos.slice(0, 12));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

ipcMain.handle('youtube-search', async (_, query) => {
  try { return await youtubeSearch(query); }
  catch (e) { console.error('YouTube search error:', e.message); return []; }
});

// IPC: Save session to file
ipcMain.handle('save-session', async (_, data) => {
  const result = await dialog.showSaveDialog(dmWindow, {
    title: 'Session speichern',
    defaultPath: 'session.dnd',
    filters: [{ name: 'DND Session', extensions: ['dnd'] }],
  });
  if (result.canceled || !result.filePath) return { success: false };
  try {
    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8');
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// IPC: Load session from file
ipcMain.handle('load-session', async () => {
  const result = await dialog.showOpenDialog(dmWindow, {
    title: 'Session laden',
    filters: [{ name: 'DND Session', extensions: ['dnd'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
});

// Music: sichtbares Fenster off-screen (show:false blockiert YouTube-Autoplay via visibilityState)
let musicWindow = null;
let currentMusicVolume = 0.25;
let volumeRetryTimer = null;
let volumeGeneration = 0;

function getMusicWindow() {
  if (musicWindow && !musicWindow.isDestroyed()) return musicWindow;
  const primary = screen.getPrimaryDisplay().bounds;
  musicWindow = new BrowserWindow({
    show: true,
    frame: false,
    width: 480,
    height: 270,
    x: primary.x + primary.width + 10,
    y: primary.y,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      partition: 'music',
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  musicWindow.setOpacity(0);
  musicWindow.on('closed', () => { musicWindow = null; });
  return musicWindow;
}

function applyMusicVolume(volume) {
  if (volumeRetryTimer) { clearTimeout(volumeRetryTimer); volumeRetryTimer = null; }
  if (!musicWindow || musicWindow.isDestroyed()) return;

  const gen = ++volumeGeneration;
  // Retry for 3 s even after the video element is found: YouTube's player JS
  // can reinitialise and reset volume to 1.0 shortly after page load.
  const deadline = Date.now() + 3000;

  function attempt() {
    if (gen !== volumeGeneration) return;
    if (!musicWindow || musicWindow.isDestroyed()) return;
    musicWindow.webContents.executeJavaScript(
      `(function(){ var v = document.querySelector('video'); if (v) v.volume = ${volume}; return !!v; })()`
    ).then(() => {
      if (gen !== volumeGeneration) return;
      if (Date.now() < deadline) volumeRetryTimer = setTimeout(attempt, 300);
    }).catch(() => {});
  }
  attempt();
}

ipcMain.on('music-play', (_, { videoId, volume }) => {
  currentMusicVolume = volume;
  if (volumeRetryTimer) { clearTimeout(volumeRetryTimer); volumeRetryTimer = null; }
  const win = getMusicWindow();
  win.loadURL(
    `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&origin=https://www.youtube-nocookie.com`,
    { httpReferrer: 'https://www.youtube-nocookie.com/' }
  );
  win.webContents.once('did-finish-load', () => applyMusicVolume(currentMusicVolume));
});

ipcMain.on('music-stop', () => {
  if (volumeRetryTimer) { clearTimeout(volumeRetryTimer); volumeRetryTimer = null; }
  if (musicWindow && !musicWindow.isDestroyed()) musicWindow.loadURL('about:blank');
});

ipcMain.on('music-volume', (_, { volume }) => {
  currentMusicVolume = volume;
  applyMusicVolume(volume);
});

// IPC: Token sync from DM -> forward to player
ipcMain.on('tokens-sync', (event, tokens) => {
  if (playerWindow) playerWindow.webContents.send('tokens-sync', tokens);
});

// IPC: Grid state update from DM -> forward to player
ipcMain.on('grid-update', (event, data) => {
  if (playerWindow) playerWindow.webContents.send('grid-update', data);
});

// ===== Remote server (WebSocket + localtunnel) =====
const REMOTE_PORT = 3456;
const remoteSessions = new Map(); // sessionId -> { clients: Map<ws, {playerId}>, lastState: {} }
const mediaRegistry = new Map();  // token -> absoluteFilePath
let httpServer = null;
let wss = null;
let currentTunnel = null;

function generateSessionCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function ensureRemoteServerRunning() {
  if (httpServer) return;
  const webRoot = path.join(__dirname, 'player-web');

  const videoMimes = { '.mp4': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.mov': 'video/quicktime' };

  httpServer = http.createServer((req, res) => {
    let urlPath = (req.url || '/').split('?')[0];

    // Serve registered media files with HTTP range support (needed for video seeking)
    if (urlPath.startsWith('/media/')) {
      const token = urlPath.slice('/media/'.length);
      const mediaPath = mediaRegistry.get(token);
      if (!mediaPath) { res.writeHead(404); res.end('Not found'); return; }
      const contentType = videoMimes[path.extname(mediaPath).toLowerCase()] || 'video/mp4';
      try {
        const stat = fs.statSync(mediaPath);
        const fileSize = stat.size;
        const range = req.headers.range;
        if (range) {
          const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
          const start = parseInt(startStr, 10);
          const end = endStr ? Math.min(parseInt(endStr, 10), fileSize - 1) : fileSize - 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': contentType,
          });
          fs.createReadStream(mediaPath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': contentType, 'Accept-Ranges': 'bytes' });
          fs.createReadStream(mediaPath).pipe(res);
        }
      } catch { res.writeHead(404); res.end('Not found'); }
      return;
    }

    if (urlPath === '/' || urlPath === '') urlPath = '/index.html';
    const safePath = path.normalize(urlPath).replace(/^[/\\]+/, '');
    const filePath = path.resolve(webRoot, safePath);
    // Path traversal guard
    if (!filePath.startsWith(webRoot + path.sep) && filePath !== webRoot) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const mimes = {
        '.html': 'text/html; charset=utf-8',
        '.js':   'application/javascript; charset=utf-8',
        '.css':  'text/css; charset=utf-8',
      };
      res.writeHead(200, { 'Content-Type': mimes[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });

  wss = new WebSocket.Server({ server: httpServer });

  wss.on('connection', (ws, req) => {
    const url      = new URL(req.url || '/', 'http://localhost');
    const sessionId = url.searchParams.get('session');
    const playerId  = url.searchParams.get('player') || null;

    const session = remoteSessions.get(sessionId);
    if (!session) { ws.close(4000, 'Session not found'); return; }

    session.clients.set(ws, { playerId });

    // Send cached state to newly connected player
    const s = session.lastState;
    try {
      if (s.map)    ws.send(JSON.stringify(s.map));
      if (s.fog)    ws.send(JSON.stringify(s.fog));
      if (s.grid)   ws.send(JSON.stringify(s.grid));
      if (s.tokens) ws.send(JSON.stringify(s.tokens));
      if (s.pins && s.pins.length > 0) ws.send(JSON.stringify({ type: 'pins', pins: s.pins }));
    } catch {}

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'token-move' && playerId) {
          // Forward to DM
          if (dmWindow) dmWindow.webContents.send('remote-token-moved', {
            tokenId: msg.tokenId, tokenX: msg.tokenX, tokenY: msg.tokenY,
          });
          // Broadcast to other players in the same session
          for (const [client] of session.clients) {
            if (client !== ws && client.readyState === 1) client.send(JSON.stringify(msg));
          }
        }
        if (msg.type === 'player-ping') {
          // Forward to DM and broadcast to other players
          if (dmWindow) dmWindow.webContents.send('remote-player-ping', { playerId, ...msg });
          for (const [client] of session.clients) {
            if (client !== ws && client.readyState === 1) client.send(JSON.stringify(msg));
          }
        }
        if (msg.type === 'place-pin') {
          if (!session.lastState.pins) session.lastState.pins = [];
          const pin = msg.pin;
          session.lastState.pins.push(pin);
          if (dmWindow) dmWindow.webContents.send('remote-pin-event', { action: 'place', pin });
          for (const [client] of session.clients) {
            if (client !== ws && client.readyState === 1) client.send(JSON.stringify({ type: 'place-pin', pin }));
          }
        }
        if (msg.type === 'remove-pin') {
          if (session.lastState.pins) session.lastState.pins = session.lastState.pins.filter(p => p.id !== msg.pinId);
          if (dmWindow) dmWindow.webContents.send('remote-pin-event', { action: 'remove', pinId: msg.pinId });
          for (const [client] of session.clients) {
            if (client !== ws && client.readyState === 1) client.send(JSON.stringify(msg));
          }
        }
      } catch {}
    });

    ws.on('close', () => session.clients.delete(ws));
    ws.on('error', () => session.clients.delete(ws));
  });

  httpServer.listen(REMOTE_PORT);
}

function remoteIpcPush(sessionId, msg) {
  const session = remoteSessions.get(sessionId);
  if (!session) return;
  const str = JSON.stringify(msg);
  for (const [client] of session.clients) {
    if (client.readyState === 1) client.send(str);
  }
}

ipcMain.handle('remote-start', async () => {
  ensureRemoteServerRunning();
  const sessionId = generateSessionCode();
  remoteSessions.set(sessionId, { clients: new Map(), lastState: { map: null, fog: null, grid: null, tokens: null, pins: [] } });
  if (currentTunnel) { try { currentTunnel.close(); } catch {} currentTunnel = null; }
  try {
    const localtunnel = require('localtunnel');
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('Tunnel timeout (15s)')), 15000));
    currentTunnel = await Promise.race([localtunnel({ port: REMOTE_PORT }), timeout]);
    currentTunnel.on('error', () => {});
    return { sessionId, url: currentTunnel.url };
  } catch (e) {
    console.error('[Tunnel] Failed:', e.message);
    return { sessionId, url: `http://localhost:${REMOTE_PORT}` };
  }
});

ipcMain.handle('remote-end', async (_, sessionId) => {
  const session = remoteSessions.get(sessionId);
  if (session) {
    for (const [client] of session.clients) { try { client.close(4001, 'Session ended'); } catch {} }
    remoteSessions.delete(sessionId);
  }
  if (currentTunnel) { try { currentTunnel.close(); } catch {} currentTunnel = null; }
  mediaRegistry.clear();
});

ipcMain.handle('remote-register-media', (_, filePath) => {
  for (const [token, fp] of mediaRegistry) {
    if (fp === filePath) return `/media/${token}`;
  }
  const token = crypto.randomBytes(8).toString('hex');
  mediaRegistry.set(token, filePath);
  return `/media/${token}`;
});

ipcMain.on('remote-push-map', (_, { sessionId, imageData, videoUrl, name }) => {
  const session = remoteSessions.get(sessionId);
  if (session) {
    session.lastState.map = videoUrl
      ? { type: 'map', videoUrl, name }
      : { type: 'map', imageData, name };
    remoteIpcPush(sessionId, session.lastState.map);
  }
});

ipcMain.on('remote-push-fog', (_, { sessionId, dataUrl, width, height }) => {
  const session = remoteSessions.get(sessionId);
  if (session) {
    session.lastState.fog = { type: 'fog', dataUrl, width, height };
    remoteIpcPush(sessionId, session.lastState.fog);
  }
});

ipcMain.on('remote-push-grid', (_, data) => {
  const session = remoteSessions.get(data.sessionId);
  if (session) {
    const { sessionId, ...rest } = data;
    session.lastState.grid = { type: 'grid', ...rest };
    remoteIpcPush(sessionId, session.lastState.grid);
  }
});

ipcMain.on('remote-push-tokens', (_, { sessionId, tokens }) => {
  const session = remoteSessions.get(sessionId);
  if (session) {
    session.lastState.tokens = { type: 'tokens', tokens };
    remoteIpcPush(sessionId, session.lastState.tokens);
  }
});

ipcMain.on('remote-push-volume', (_, { sessionId, value, muted }) => {
  remoteIpcPush(sessionId, { type: 'volume', value, muted });
});

// DM → local player: located ping with image coords
ipcMain.on('ping-location', (_, data) => {
  if (playerWindow) playerWindow.webContents.send('ping-location', data);
});

// DM → remote players: located ping with image coords
ipcMain.on('remote-push-ping', (_, { sessionId, imgX, imgY, color }) => {
  remoteIpcPush(sessionId, { type: 'ping', imgX, imgY, color });
});

// IPC: DM view sync (zoom + pan) -> forward to local player
ipcMain.on('view-sync', (_, data) => {
  if (playerWindow) playerWindow.webContents.send('view-sync', data);
});

// DM removes a pin → update cached state + broadcast to remote players
ipcMain.on('remote-push-pin-remove', (_, { sessionId, pinId }) => {
  const session = remoteSessions.get(sessionId);
  if (!session) return;
  if (session.lastState.pins) session.lastState.pins = session.lastState.pins.filter(p => p.id !== pinId);
  remoteIpcPush(sessionId, { type: 'remove-pin', pinId });
});
