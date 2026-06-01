'use strict';

(function () {

// i18n shortcut — i18n.js must be loaded before player.js
function t(key, ...args) { return window.FREETT_I18N ? window.FREETT_I18N.t(key, ...args) : key; }


// === URL params ===
const params  = new URLSearchParams(location.search);
const SESSION = params.get('session');
const MY_ID   = params.get('player') || null;

// === DOM ===
const canvasImage         = document.getElementById('canvas-image');
const canvasGrid          = document.getElementById('canvas-grid');
const canvasMonsterTokens = document.getElementById('canvas-monster-tokens');
const canvasFog           = document.getElementById('canvas-fog');
const canvasTokens        = document.getElementById('canvas-tokens');
const canvasRuler         = document.getElementById('canvas-ruler');
const canvasPing          = document.getElementById('canvas-ping');
const canvasEvents        = document.getElementById('canvas-events');

const ctxImage         = canvasImage.getContext('2d');
const ctxGrid          = canvasGrid.getContext('2d');
const ctxMonsterTokens = canvasMonsterTokens.getContext('2d');
const ctxFog           = canvasFog.getContext('2d');
const ctxTokens        = canvasTokens.getContext('2d');
const ctxRuler         = canvasRuler.getContext('2d');
const ctxPing          = canvasPing.getContext('2d');

const waitingScreen = document.getElementById('waiting-screen');
const waitingDetail = document.getElementById('waiting-detail');
const container     = document.getElementById('canvas-container');
const statusEl      = document.getElementById('connection-status');
const rulerBtn      = document.getElementById('ruler-btn');
const pingBtn       = document.getElementById('ping-btn');
const fullscreenBtn = document.getElementById('fullscreen-btn');

// === State ===
const state = {
  image:   null,
  scale:   1,
  offsetX: 0,
  offsetY: 0,
};

let currentVideoEl  = null;
let videoAnimFrame  = null;
let currentVolume   = 1;

function stopVideoLoop() {
  if (videoAnimFrame !== null) { cancelAnimationFrame(videoAnimFrame); videoAnimFrame = null; }
}

function startVideoLoop() {
  stopVideoLoop();
  function loop() {
    if (currentVideoEl) { renderAll(); videoAnimFrame = requestAnimationFrame(loop); }
  }
  videoAnimFrame = requestAnimationFrame(loop);
}

let fogCanvas = null;
let fogCtx    = null;
let gridState = { gridVisible: false, gridSize: null, gridOffsetX: 0, gridOffsetY: 0, gridOpacity: 15 };
let tokens    = [];

// Token drag state
let dragToken = null;
let dragOffX  = 0;
let dragOffY  = 0;

// Pan state
let isPanning   = false;
let panStartX   = 0;
let panStartY   = 0;

// Touch pinch state
let lastTouchDist = null;
let lastTouchMidX = 0;
let lastTouchMidY = 0;

// Ruler state
let rulerMode     = false;
let isRuling      = false;
let rulerStartX   = 0;
let rulerStartY   = 0;
let rulerCurrentX = 0;
let rulerCurrentY = 0;

// Token image cache: id -> { data: dataUrl, img: HTMLImageElement }
const tokenImgCache = new Map();

// Map pins
let pins = []; // { id, playerId, colorHex, imgX, imgY, text }

// Ping circles for player-ping display
let pingCircles = []; // { imgX, imgY, color, startTime }
let pingAnimFrameId = null;

// Derive a deterministic color from a player UUID
function playerColor(uuid) {
  if (!uuid) return '#c9a84c';
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) hash = (hash * 31 + uuid.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

const MY_COLOR = MY_ID ? playerColor(MY_ID) : '#c9a84c';

// === Canvas resize ===
function resizeCanvases() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  [canvasImage, canvasGrid, canvasMonsterTokens, canvasFog, canvasTokens, canvasRuler, canvasPing, canvasEvents].forEach(c => {
    c.width  = w;
    c.height = h;
  });
  const media = currentVideoEl || state.image;
  if (media) { fitImageToView(media); renderAll(); }
}

window.addEventListener('resize', resizeCanvases);
resizeCanvases();

// === Rendering ===
function fitImageToView(media) {
  const W = canvasImage.width;
  const H = canvasImage.height;
  const w = media instanceof HTMLVideoElement ? media.videoWidth  : media.naturalWidth;
  const h = media instanceof HTMLVideoElement ? media.videoHeight : media.naturalHeight;
  const scaleX = W / w;
  const scaleY = H / h;
  state.scale   = Math.min(scaleX, scaleY);
  state.offsetX = (W - w * state.scale) / 2;
  state.offsetY = (H - h * state.scale) / 2;
}

function renderAll() {
  const media = currentVideoEl || state.image;
  if (!media) return;

  const W = canvasImage.width;
  const H = canvasImage.height;
  const { offsetX, offsetY, scale } = state;

  ctxImage.clearRect(0, 0, W, H);
  ctxImage.save();
  ctxImage.translate(offsetX, offsetY);
  ctxImage.scale(scale, scale);
  ctxImage.drawImage(media, 0, 0);
  ctxImage.restore();

  drawGrid();

  ctxFog.clearRect(0, 0, W, H);
  if (fogCanvas) {
    ctxFog.save();
    ctxFog.translate(offsetX, offsetY);
    ctxFog.scale(scale, scale);
    ctxFog.drawImage(fogCanvas, 0, 0);
    ctxFog.restore();
  }

  drawTokens();
}

function drawGrid() {
  const W = canvasGrid.width;
  const H = canvasGrid.height;
  ctxGrid.clearRect(0, 0, W, H);
  if (!gridState.gridVisible || !gridState.gridSize) return;

  const cellSize = gridState.gridSize * state.scale;
  const rawOffX  = gridState.gridOffsetX * state.scale + state.offsetX;
  const rawOffY  = gridState.gridOffsetY * state.scale + state.offsetY;
  const offX     = ((rawOffX % cellSize) + cellSize) % cellSize;
  const offY     = ((rawOffY % cellSize) + cellSize) % cellSize;
  const opacity  = (gridState.gridOpacity ?? 15) / 100;

  ctxGrid.beginPath();
  ctxGrid.strokeStyle = `rgba(255,255,255,${opacity})`;
  ctxGrid.lineWidth = 1;
  for (let x = offX; x <= W; x += cellSize) { ctxGrid.moveTo(x, 0); ctxGrid.lineTo(x, H); }
  for (let y = offY; y <= H; y += cellSize) { ctxGrid.moveTo(0, y); ctxGrid.lineTo(W, y); }
  ctxGrid.stroke();
}

function drawTokens() {
  ctxTokens.clearRect(0, 0, canvasTokens.width, canvasTokens.height);
  ctxMonsterTokens.clearRect(0, 0, canvasMonsterTokens.width, canvasMonsterTokens.height);

  for (const t of tokens) {
    if (t.tokenX == null || t.tokenY == null) continue;
    const isOwn = MY_ID && t.controllerId === MY_ID;
    const ctx   = t.type === 'monster' ? ctxMonsterTokens : ctxTokens;
    const cx    = t.tokenX * state.scale + state.offsetX;
    const cy    = t.tokenY * state.scale + state.offsetY;
    const r     = (t.tokenSize || 40) * state.scale;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    if (t.tokenImg) {
      ctx.drawImage(t.tokenImg, cx - r, cy - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = t.type === 'monster' ? '#5a1010' : '#101a4a';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.font = `${Math.max(12, r)}px sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(t.type === 'monster' ? '\u{1F480}' : '\u{1F9D9}', cx, cy);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = isOwn ? '#c9a84c' : (t.type === 'monster' ? '#e08888' : '#88a8e8');
    ctx.lineWidth   = isOwn ? 3 : 2;
    ctx.stroke();

    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur  = 4;
    ctx.fillText(t.name, cx, cy + r + 3);
    ctx.shadowBlur = 0;
  }

  // Draw pins
  for (const pin of pins) {
    const cx = pin.imgX * state.scale + state.offsetX;
    const cy = pin.imgY * state.scale + state.offsetY;
    ctxTokens.beginPath();
    ctxTokens.arc(cx, cy, 9, 0, Math.PI * 2);
    ctxTokens.fillStyle = pin.colorHex;
    ctxTokens.fill();
    ctxTokens.strokeStyle = '#ffffff';
    ctxTokens.lineWidth = 2;
    ctxTokens.stroke();
    ctxTokens.font = '10px sans-serif';
    ctxTokens.fillStyle = '#fff';
    ctxTokens.textAlign = 'center';
    ctxTokens.textBaseline = 'middle';
    ctxTokens.fillText('📌', cx, cy);
    if (pin.text) {
      ctxTokens.font = 'bold 11px sans-serif';
      ctxTokens.fillStyle = '#ffffff';
      ctxTokens.textAlign = 'center';
      ctxTokens.textBaseline = 'bottom';
      ctxTokens.shadowColor = '#000';
      ctxTokens.shadowBlur = 3;
      ctxTokens.fillText(pin.text, cx, cy - 11);
      ctxTokens.shadowBlur = 0;
    }
  }
}

// === Ping animations ===
function addPingCircle(imgX, imgY, color) {
  pingCircles.push({ imgX, imgY, color, startTime: Date.now() });
  if (!pingAnimFrameId) animatePings();
}

function animatePings() {
  const now = Date.now();
  const DURATION = 2500;
  pingCircles = pingCircles.filter(p => now - p.startTime < DURATION);
  ctxPing.clearRect(0, 0, canvasPing.width, canvasPing.height);

  for (const p of pingCircles) {
    const t  = (now - p.startTime) / DURATION;
    const cx = p.imgX * state.scale + state.offsetX;
    const cy = p.imgY * state.scale + state.offsetY;
    const r  = t * 120;
    ctxPing.beginPath();
    ctxPing.arc(cx, cy, r, 0, Math.PI * 2);
    ctxPing.strokeStyle = p.color;
    ctxPing.lineWidth = 5;
    ctxPing.globalAlpha = 1 - t;
    ctxPing.stroke();
    ctxPing.globalAlpha = 1;
  }

  if (pingCircles.length > 0) {
    pingAnimFrameId = requestAnimationFrame(animatePings);
  } else {
    pingAnimFrameId = null;
    ctxPing.clearRect(0, 0, canvasPing.width, canvasPing.height);
  }
}

// === Pin hit testing ===
function getPinAtScreen(sx, sy) {
  for (const pin of pins) {
    const cx = pin.imgX * state.scale + state.offsetX;
    const cy = pin.imgY * state.scale + state.offsetY;
    const dx = sx - cx;
    const dy = sy - cy;
    if (dx * dx + dy * dy <= 81) return pin;
  }
  return null;
}

// === Ruler ===
function drawRulerLine(sx1, sy1, sx2, sy2) {
  ctxRuler.clearRect(0, 0, canvasRuler.width, canvasRuler.height);

  ctxRuler.beginPath();
  ctxRuler.moveTo(sx1, sy1);
  ctxRuler.lineTo(sx2, sy2);
  ctxRuler.strokeStyle = 'rgba(255,220,50,0.9)';
  ctxRuler.lineWidth = 2;
  ctxRuler.setLineDash([8, 4]);
  ctxRuler.stroke();
  ctxRuler.setLineDash([]);

  ctxRuler.fillStyle = 'rgba(255,220,50,0.9)';
  for (const [px, py] of [[sx1, sy1], [sx2, sy2]]) {
    ctxRuler.beginPath();
    ctxRuler.arc(px, py, 4, 0, Math.PI * 2);
    ctxRuler.fill();
  }

  const ip1 = screenToImage(sx1, sy1);
  const ip2 = screenToImage(sx2, sy2);
  const dist = Math.sqrt((ip2.x - ip1.x) ** 2 + (ip2.y - ip1.y) ** 2);
  let label;
  if (gridState.gridSize) {
    const fields = dist / gridState.gridSize;
    const feet   = fields * 5;
    label = t('ruler.fields_ft', fields.toFixed(1), feet.toFixed(1));
  } else {
    label = t('ruler.px', Math.round(dist));
  }

  const midX = (sx1 + sx2) / 2;
  const midY = (sy1 + sy2) / 2;
  ctxRuler.font = 'bold 13px sans-serif';
  ctxRuler.textAlign = 'center';
  ctxRuler.textBaseline = 'bottom';
  ctxRuler.shadowColor = '#000';
  ctxRuler.shadowBlur = 5;
  ctxRuler.fillStyle = '#fff';
  ctxRuler.fillText(label, midX, midY - 6);
  ctxRuler.shadowBlur = 0;
}

function clearRulerLine() {
  ctxRuler.clearRect(0, 0, canvasRuler.width, canvasRuler.height);
}

function toggleRuler() {
  rulerMode = !rulerMode;
  rulerBtn.classList.toggle('active', rulerMode);
  canvasEvents.style.cursor = rulerMode ? 'crosshair' : '';
  if (!rulerMode) { isRuling = false; clearRulerLine(); }
}

rulerBtn.addEventListener('click', toggleRuler);

// Ping button: send player-ping at center of current view
pingBtn.addEventListener('click', () => {
  if (!state.image || !ws || ws.readyState !== WebSocket.OPEN) return;
  const imgPos = screenToImage(canvasEvents.width / 2, canvasEvents.height / 2);
  addPingCircle(imgPos.x, imgPos.y, MY_COLOR);
  ws.send(JSON.stringify({ type: 'player-ping', playerId: MY_ID, imgX: imgPos.x, imgY: imgPos.y, color: MY_COLOR }));
});

// === WebSocket ===
let ws = null;
let reconnectTimer = null;

function connect() {
  if (!SESSION) {
    waitingDetail.textContent = t('player.no_session');
    statusEl.textContent = t('player.conn_error');
    statusEl.className = 'connection-status error';
    return;
  }

  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}${location.search}`);

  ws.onopen = () => {
    statusEl.textContent = t('player.connected');
    statusEl.className = 'connection-status connected';
    if (!state.image) waitingDetail.textContent = t('player.waiting_map');
  };

  ws.onmessage = (event) => {
    try { handleMessage(JSON.parse(event.data)); } catch {}
  };

  ws.onclose = (event) => {
    ws = null;
    statusEl.textContent = t('player.disconnected');
    statusEl.className = 'connection-status error';
    if (event.code === 4000) {
      waitingDetail.textContent = t('player.session_not_found');
      waitingScreen.style.display = '';
    } else if (event.code === 4001) {
      waitingDetail.textContent = t('player.session_ended');
      waitingScreen.style.display = '';
    } else {
      // Auto-reconnect
      waitingDetail.textContent = t('player.reconnecting');
      reconnectTimer = setTimeout(connect, 3000);
    }
  };

  ws.onerror = () => {
    statusEl.textContent = t('player.conn_error');
    statusEl.className = 'connection-status error';
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'map':
      if (msg.videoUrl) loadVideoMap(msg.videoUrl);
      else loadMapFromData(msg.imageData);
      break;
    case 'fog':
      applyFog(msg.dataUrl, msg.width, msg.height);
      break;
    case 'grid':
      gridState = {
        gridVisible: msg.gridVisible,
        gridSize:    msg.gridSize,
        gridOffsetX: msg.gridOffsetX,
        gridOffsetY: msg.gridOffsetY,
        gridOpacity: msg.gridOpacity ?? 15,
      };
      if (state.image) renderAll();
      break;
    case 'tokens':
      applyTokens(msg.tokens || []);
      break;
    case 'token-move': {
      const tok = tokens.find(t => t.id === msg.tokenId);
      if (tok) { tok.tokenX = msg.tokenX; tok.tokenY = msg.tokenY; renderAll(); }
      break;
    }
    case 'ping':
      // DM ping → show ring at the pinged map location
      addPingCircle(msg.imgX, msg.imgY, msg.color || '#c9a84c');
      break;
    case 'player-ping':
      // Another player pinged a location
      if (msg.playerId !== MY_ID) {
        addPingCircle(msg.imgX, msg.imgY, msg.color);
      }
      break;
    case 'volume':
      currentVolume = msg.muted ? 0 : (msg.value ?? 1);
      if (currentVideoEl) currentVideoEl.volume = currentVolume;
      break;
    case 'pins':
      pins = msg.pins || [];
      renderAll();
      break;
    case 'place-pin':
      if (msg.pin && !pins.find(p => p.id === msg.pin.id)) {
        pins.push(msg.pin);
        renderAll();
      }
      break;
    case 'remove-pin':
      pins = pins.filter(p => p.id !== msg.pinId);
      renderAll();
      break;
  }
}

// === Map / Fog / Token loading ===
function loadMapFromData(imageData) {
  stopVideoLoop();
  pins = [];
  if (currentVideoEl) { currentVideoEl.pause(); currentVideoEl.src = ''; currentVideoEl = null; }
  const img = new Image();
  img.onload = () => {
    state.image = img;
    fitImageToView(img);
    waitingScreen.style.display = 'none';
    renderAll();
  };
  img.onerror = () => { waitingDetail.textContent = t('player.map_error'); };
  img.src = imageData;
}

function loadVideoMap(url) {
  stopVideoLoop();
  if (currentVideoEl) { currentVideoEl.pause(); currentVideoEl.src = ''; currentVideoEl = null; }
  state.image = null;

  const video = document.createElement('video');
  video.loop   = true;
  video.muted  = false;
  video.volume = currentVolume;
  video.src    = url;

  video.addEventListener('loadedmetadata', () => {
    currentVideoEl = video;
    fitImageToView(video);
    waitingScreen.style.display = 'none';
    video.play().catch(() => {
      // Browser blocked unmuted autoplay – retry muted
      video.muted = true;
      video.play().catch(() => {});
    });
    startVideoLoop();
  }, { once: true });

  video.addEventListener('error', () => {
    waitingDetail.textContent = t('player.video_error');
  }, { once: true });
}

function applyFog(dataUrl, width, height) {
  const img = new Image();
  img.onload = () => {
    if (!fogCanvas || fogCanvas.width !== width || fogCanvas.height !== height) {
      fogCanvas = document.createElement('canvas');
      fogCanvas.width  = width;
      fogCanvas.height = height;
      fogCtx = fogCanvas.getContext('2d');
    }
    fogCtx.clearRect(0, 0, width, height);
    fogCtx.drawImage(img, 0, 0);
    renderAll();
  };
  img.src = dataUrl;
}

function applyTokens(raw) {
  const newTokens = raw.map(t => {
    const cached = tokenImgCache.get(t.id);
    return {
      ...t,
      tokenImg: (cached && cached.data === t.tokenData) ? cached.img : null,
    };
  });

  // If a drag is in progress, update dragToken to the new array object and keep drag position
  if (dragToken) {
    const updated = newTokens.find(t => t.id === dragToken.id);
    if (updated) {
      updated.tokenX = dragToken.tokenX;
      updated.tokenY = dragToken.tokenY;
      dragToken = updated;
    }
  }

  for (const t of newTokens) {
    if (!t.tokenImg && t.tokenData) {
      const img = new Image();
      img.onload = () => {
        tokenImgCache.set(t.id, { data: t.tokenData, img });
        const tok = tokens.find(x => x.id === t.id);
        if (tok) { tok.tokenImg = img; renderAll(); }
      };
      img.src = t.tokenData;
    }
  }

  tokens = newTokens;
  renderAll();
}

// === Token dragging ===
function imageToScreen(ix, iy) {
  return { x: ix * state.scale + state.offsetX, y: iy * state.scale + state.offsetY };
}

function screenToImage(sx, sy) {
  return { x: (sx - state.offsetX) / state.scale, y: (sy - state.offsetY) / state.scale };
}

function getOwnTokenAtScreen(sx, sy) {
  if (!MY_ID) return null;
  for (const t of tokens) {
    if (t.controllerId !== MY_ID) continue;
    if (t.tokenX == null || t.tokenY == null) continue;
    const sc = imageToScreen(t.tokenX, t.tokenY);
    const r  = (t.tokenSize || 40) * state.scale;
    const dx = sx - sc.x;
    const dy = sy - sc.y;
    if (dx * dx + dy * dy <= r * r) return t;
  }
  return null;
}

function onPointerDown(sx, sy, shiftKey, ctrlKey) {
  if (rulerMode) {
    isRuling    = true;
    rulerStartX = sx;
    rulerStartY = sy;
    rulerCurrentX = sx;
    rulerCurrentY = sy;
    return;
  }
  // Shift+click: player ping at location
  if (shiftKey && state.image) {
    const imgPos = screenToImage(sx, sy);
    addPingCircle(imgPos.x, imgPos.y, MY_COLOR);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'player-ping', playerId: MY_ID, imgX: imgPos.x, imgY: imgPos.y, color: MY_COLOR }));
    }
    return;
  }
  if (!MY_ID || (!state.image && !currentVideoEl)) return;
  const t = getOwnTokenAtScreen(sx, sy);
  if (!t) return;
  dragToken = t;
  const sc  = imageToScreen(t.tokenX, t.tokenY);
  dragOffX  = sx - sc.x;
  dragOffY  = sy - sc.y;
  canvasEvents.style.cursor = 'grabbing';
}

function onPointerMove(sx, sy) {
  if (isRuling) {
    rulerCurrentX = sx;
    rulerCurrentY = sy;
    drawRulerLine(rulerStartX, rulerStartY, rulerCurrentX, rulerCurrentY);
    return;
  }
  if (dragToken) {
    const imgPos = screenToImage(sx - dragOffX, sy - dragOffY);
    dragToken.tokenX = imgPos.x;
    dragToken.tokenY = imgPos.y;
    renderAll();
    return;
  }
  if (!MY_ID) return;
  canvasEvents.style.cursor = rulerMode ? 'crosshair' : (getOwnTokenAtScreen(sx, sy) ? 'grab' : '');
}

function onPointerUp() {
  if (isRuling) {
    isRuling = false;
    clearRulerLine();
    return;
  }
  if (!dragToken) return;
  const t = dragToken;
  dragToken = null;
  canvasEvents.style.cursor = rulerMode ? 'crosshair' : '';

  if (ws && ws.readyState === WebSocket.OPEN && t.tokenX != null && t.tokenY != null) {
    ws.send(JSON.stringify({
      type:    'token-move',
      tokenId: t.id,
      tokenX:  t.tokenX,
      tokenY:  t.tokenY,
    }));
  }
}

// Mouse events — use document-level tracking during drag so fast mouse moves outside
// the canvas don't prematurely end the drag
function onDocMouseMove(e) {
  const rect = canvasEvents.getBoundingClientRect();
  onPointerMove(e.clientX - rect.left, e.clientY - rect.top);
}
function onDocMouseUp() {
  document.removeEventListener('mousemove', onDocMouseMove);
  document.removeEventListener('mouseup',   onDocMouseUp);
  onPointerUp();
}

function onDocMouseMovePan(e) {
  if (!isPanning) return;
  state.offsetX = e.clientX - panStartX;
  state.offsetY = e.clientY - panStartY;
  renderAll();
}
function onDocMouseUpPan() {
  isPanning = false;
  document.removeEventListener('mousemove', onDocMouseMovePan);
  document.removeEventListener('mouseup',   onDocMouseUpPan);
}

canvasEvents.addEventListener('mousedown', e => {
  e.preventDefault();
  if (e.button === 1 || e.button === 2) {
    isPanning = true;
    panStartX = e.clientX - state.offsetX;
    panStartY = e.clientY - state.offsetY;
    document.addEventListener('mousemove', onDocMouseMovePan);
    document.addEventListener('mouseup',   onDocMouseUpPan);
    return;
  }
  onPointerDown(e.offsetX, e.offsetY, e.shiftKey, false);
  if (dragToken) {
    document.addEventListener('mousemove', onDocMouseMove);
    document.addEventListener('mouseup',   onDocMouseUp);
  }
});
canvasEvents.addEventListener('mousemove', e => { if (!dragToken && !isPanning) onPointerMove(e.offsetX, e.offsetY); });
canvasEvents.addEventListener('mouseup',   () => { if (!dragToken && !isPanning) onPointerUp(); });
canvasEvents.addEventListener('contextmenu', e => e.preventDefault());

canvasEvents.addEventListener('wheel', (e) => {
  if (!state.image && !currentVideoEl) return;
  e.preventDefault();
  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
  state.offsetX = e.offsetX - (e.offsetX - state.offsetX) * zoomFactor;
  state.offsetY = e.offsetY - (e.offsetY - state.offsetY) * zoomFactor;
  state.scale   = Math.min(Math.max(state.scale * zoomFactor, 0.05), 10);
  renderAll();
}, { passive: false });

// Ctrl+click: place a map pin
canvasEvents.addEventListener('click', (e) => {
  if (!(e.ctrlKey || e.metaKey)) {
    // Plain click: remove own pin if one was hit (only if not dragging)
    if (!dragToken) {
      const pin = getPinAtScreen(e.offsetX, e.offsetY);
      if (pin && pin.playerId === MY_ID) {
        pins = pins.filter(p => p.id !== pin.id);
        renderAll();
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'remove-pin', pinId: pin.id }));
        }
      }
    }
    return;
  }
  if (!state.image) return;
  const imgPos = screenToImage(e.offsetX, e.offsetY);
  const text = prompt(t('prompt.comment'));
  if (text !== null) {
    const pin = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      playerId: MY_ID,
      colorHex: MY_COLOR,
      imgX: imgPos.x,
      imgY: imgPos.y,
      text: text.trim(),
    };
    pins.push(pin);
    renderAll();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'place-pin', pin }));
    }
  }
});

// Touch events
function touchCoords(e) {
  const rect  = canvasEvents.getBoundingClientRect();
  const touch = e.touches[0] || e.changedTouches[0];
  return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
}

canvasEvents.addEventListener('touchstart', e => {
  e.preventDefault();
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    lastTouchDist = Math.sqrt(dx * dx + dy * dy);
    return;
  }
  lastTouchDist = null;
  const { x, y } = touchCoords(e);
  onPointerDown(x, y);
}, { passive: false });

canvasEvents.addEventListener('touchmove', e => {
  e.preventDefault();
  if (e.touches.length === 2) {
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (lastTouchDist) {
      const rect = canvasEvents.getBoundingClientRect();
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
      const zoomFactor = dist / lastTouchDist;
      state.offsetX = midX - (midX - state.offsetX) * zoomFactor;
      state.offsetY = midY - (midY - state.offsetY) * zoomFactor;
      state.scale   = Math.min(Math.max(state.scale * zoomFactor, 0.05), 10);
      renderAll();
    }
    lastTouchDist = dist;
    return;
  }
  lastTouchDist = null;
  const { x, y } = touchCoords(e);
  onPointerMove(x, y);
}, { passive: false });

canvasEvents.addEventListener('touchend', e => {
  e.preventDefault();
  lastTouchDist = null;
  onPointerUp();
}, { passive: false });

// === Fullscreen ===
fullscreenBtn.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
    fullscreenBtn.innerHTML = '&#x2715;';
  } else {
    document.exitFullscreen().catch(() => {});
    fullscreenBtn.innerHTML = '&#x26F6;';
  }
});

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    fullscreenBtn.innerHTML = '&#x26F6;';
    const media = currentVideoEl || state.image;
    if (media) { fitImageToView(media); renderAll(); }
  }
});

// === Start ===
connect();

// === i18n – Language Switcher + Help Button ===
(function () {
  const I18N = window.FREETT_I18N;
  if (!I18N) return;

  // Sync select to current lang
  const sel = document.getElementById('lang-select-player');
  if (sel) {
    sel.value = I18N.getLang();
    sel.addEventListener('change', () => {
      I18N.setLang(sel.value);
      I18N.applyTranslations();
    });
  }

  // Apply translations to static elements
  I18N.applyTranslations();

  // Help modal
  const helpBtn    = document.getElementById('btn-help-player');
  const helpModal  = document.getElementById('help-modal-player');
  const helpClose  = document.getElementById('help-modal-player-close');
  const helpClose2 = document.getElementById('help-modal-player-close2');
  if (helpBtn && helpModal) {
    helpBtn.addEventListener('click', () => { helpModal.style.display = ''; });
    [helpClose, helpClose2].forEach(btn => btn && btn.addEventListener('click', () => { helpModal.style.display = 'none'; }));
    helpModal.querySelector('.help-modal-backdrop').addEventListener('click', () => { helpModal.style.display = 'none'; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && helpModal.style.display !== 'none') helpModal.style.display = 'none'; });
  }
})();

})();
