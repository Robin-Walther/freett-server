'use strict';

// ===== Elements =====
const canvasImage         = document.getElementById('canvas-image');
const canvasGrid          = document.getElementById('canvas-grid');
const canvasMonsterTokens = document.getElementById('canvas-monster-tokens');
const canvasFog           = document.getElementById('canvas-fog');
const canvasTokens        = document.getElementById('canvas-tokens');
const canvasPing          = document.getElementById('canvas-ping');
const ctxImage            = canvasImage.getContext('2d');
const ctxGrid             = canvasGrid.getContext('2d');
const ctxMonsterTokens    = canvasMonsterTokens.getContext('2d');
const ctxFog              = canvasFog.getContext('2d');
const ctxTokens           = canvasTokens.getContext('2d');
const ctxPing             = canvasPing.getContext('2d');
const waitingScreen  = document.getElementById('waiting-screen');
const container      = document.getElementById('canvas-container');
const fullscreenBtn     = document.getElementById('fullscreen-btn');
const fullscreenExitBtn = document.getElementById('fullscreen-exit-btn');

// ===== Fullscreen toggle =====
let isFullscreen = false;

async function toggleFullscreen() {
  await window.electronAPI.toggleFullscreen();
  isFullscreen = !isFullscreen;
  fullscreenBtn.innerHTML = isFullscreen ? '&#x2715;' : '&#x26F6;';
  fullscreenBtn.title = isFullscreen ? 'Vollbild beenden' : 'Vollbild ein/aus';
  document.getElementById('player-header').classList.toggle('fullscreen-hidden', isFullscreen);
  fullscreenExitBtn.style.display = isFullscreen ? 'flex' : 'none';
  if (state.image) {
    fitImageToView(state.image);
    renderAll();
  }
}

fullscreenBtn.addEventListener('click', toggleFullscreen);
fullscreenExitBtn.addEventListener('click', toggleFullscreen);

// ===== State =====
const state = {
  image: null,   // Image or HTMLVideoElement
  isVideo: false,
  offsetX: 0,
  offsetY: 0,
  scale: 1,
};

let videoAnimFrameId = null;

function startVideoLoop() {
  stopVideoLoop();
  function loop() {
    if (state.isVideo && state.image) {
      renderAll();
      videoAnimFrameId = requestAnimationFrame(loop);
    } else {
      videoAnimFrameId = null;
    }
  }
  videoAnimFrameId = requestAnimationFrame(loop);
}

function stopVideoLoop() {
  if (videoAnimFrameId !== null) {
    cancelAnimationFrame(videoAnimFrameId);
    videoAnimFrameId = null;
  }
}

let fogCanvas = null;
let fogCtx    = null;

let playerTokens = []; // [{id, name, type, tokenPath, tokenX, tokenY, tokenSize, tokenImg}]

let currentVolume = 0.25;
let currentMuted  = false;

// ===== Grid state =====
let gridState = { gridVisible: false, gridSize: null, gridOffsetX: 0, gridOffsetY: 0, gridOpacity: 15 };

function drawGrid() {
  const W = canvasGrid.width;
  const H = canvasGrid.height;
  ctxGrid.clearRect(0, 0, W, H);
  if (!gridState.gridVisible || !gridState.gridSize) return;

  const cellSize = gridState.gridSize * state.scale;
  const rawOffX = gridState.gridOffsetX * state.scale + state.offsetX;
  const rawOffY = gridState.gridOffsetY * state.scale + state.offsetY;
  const offX = ((rawOffX % cellSize) + cellSize) % cellSize;
  const offY = ((rawOffY % cellSize) + cellSize) % cellSize;

  const opacity = (gridState.gridOpacity ?? 15) / 100;
  ctxGrid.beginPath();
  ctxGrid.strokeStyle = `rgba(255,255,255,${opacity})`;
  ctxGrid.lineWidth = 1;
  for (let x = offX; x <= W; x += cellSize) {
    ctxGrid.moveTo(x, 0);
    ctxGrid.lineTo(x, H);
  }
  for (let y = offY; y <= H; y += cellSize) {
    ctxGrid.moveTo(0, y);
    ctxGrid.lineTo(W, y);
  }
  ctxGrid.stroke();
}

// ===== Resize =====
function resizeCanvases() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  [canvasImage, canvasGrid, canvasMonsterTokens, canvasFog, canvasTokens, canvasPing].forEach(c => {
    c.width  = w;
    c.height = h;
  });
  if (state.image) {
    fitImageToView(state.image);
    renderAll();
  }
}

window.addEventListener('resize', resizeCanvases);
resizeCanvases();

// ===== Render =====
function renderAll() {
  if (!state.image) return;

  const W = canvasImage.width;
  const H = canvasImage.height;
  const { offsetX, offsetY, scale, image } = state;

  // Draw image
  ctxImage.clearRect(0, 0, W, H);
  ctxImage.save();
  ctxImage.translate(offsetX, offsetY);
  ctxImage.scale(scale, scale);
  ctxImage.drawImage(image, 0, 0);
  ctxImage.restore();

  // Draw grid
  drawGrid();

  // Draw fog (solid black)
  ctxFog.clearRect(0, 0, W, H);
  if (fogCanvas) {
    ctxFog.save();
    ctxFog.translate(offsetX, offsetY);
    ctxFog.scale(scale, scale);
    ctxFog.drawImage(fogCanvas, 0, 0);
    ctxFog.restore();
  }

  // Draw tokens (above fog)
  drawPlayerTokens();
}

function drawPlayerTokens() {
  const W = canvasTokens.width;
  const H = canvasTokens.height;
  ctxTokens.clearRect(0, 0, W, H);
  ctxMonsterTokens.clearRect(0, 0, W, H);

  for (const t of playerTokens) {
    const ctx = t.type === 'monster' ? ctxMonsterTokens : ctxTokens;
    const cx = t.tokenX * state.scale + state.offsetX;
    const cy = t.tokenY * state.scale + state.offsetY;
    const r  = (t.tokenSize || 40) * state.scale;

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    if (t.tokenImg) {
      ctx.drawImage(t.tokenImg, cx - r, cy - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = t.type === 'monster' ? '#5a1010' : '#101a4a';
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = t.type === 'monster' ? '#e08888' : '#88a8e8';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText(t.name, cx, cy + r + 3);
    ctx.shadowBlur = 0;
  }
}

function fitImageToView(media) {
  const W = canvasImage.width;
  const H = canvasImage.height;
  const w = media.videoWidth ?? media.naturalWidth;
  const h = media.videoHeight ?? media.naturalHeight;
  const scaleX = W / w;
  const scaleY = H / h;
  state.scale = isFullscreen ? Math.min(scaleX, scaleY) : Math.min(scaleX, scaleY, 1);
  state.offsetX = (W - w * state.scale) / 2;
  state.offsetY = (H - h * state.scale) / 2;
}

// ===== IPC Listeners =====

// Image/video loaded by DM
window.electronAPI.onImageLoaded((filePath) => {
  playerTokens = [];
  stopVideoLoop();
  if (state.isVideo && state.image) {
    state.image.pause();
    state.image = null;
  }
  state.isVideo = false;

  const src = `file:///${filePath.replace(/\\/g, '/')}`;
  const isVideo = /\.(mp4|webm|ogg|mov)$/i.test(filePath);

  if (isVideo) {
    const video = document.createElement('video');
    video.loop = true;
    video.muted = true;           // Always start muted so Chromium allows autoplay
    video.volume = currentVolume; // Pre-set for when we unmute on timeupdate

    video.src = src;
    video.addEventListener('loadeddata', () => {
      state.image = video;
      state.isVideo = true;
      fitImageToView(video);
      waitingScreen.style.display = 'none';
      video.play().catch(err => console.warn('[Player] play() rejected:', err));
      startVideoLoop();
    });
    // Signal DM once playback has actually started (currentTime advancing).
    // The DM responds with sendVolume(), which main.js forwards via
    // executeJavaScript({ userGesture: true }) to bypass Chromium's gesture lock.
    video.addEventListener('timeupdate', () => {
      window.electronAPI.sendVideoReady();
    }, { once: true });
  } else {
    const img = new Image();
    img.src = src;
    img.onload = () => {
      state.image = img;
      fitImageToView(img);
      waitingScreen.style.display = 'none';
      renderAll();
    };
  }
});

// Full fog reset (dataURL)
window.electronAPI.onFogReset(({ dataUrl, width, height }) => {
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
});

// Volume control from DM — also called from main.js via executeJavaScript
// with userGesture:true to bypass Chromium's gesture lock on video.muted
window.__playerApplyVolume = function(volume, muted) {
  currentVolume = volume;
  currentMuted  = muted;
  if (state.isVideo && state.image) {
    state.image.volume = volume;
    state.image.muted  = muted;
  }
};

window.electronAPI.onVolumeChange(({ volume, muted }) => {
  window.__playerApplyVolume(volume, muted);
});

// Token sync from DM
window.electronAPI.onTokensSync((tokens) => {
  // Reuse already-loaded images to avoid flicker
  const imgCache = {};
  for (const t of playerTokens) {
    if (t.tokenImg) imgCache[t.tokenPath] = t.tokenImg;
  }
  playerTokens = tokens.map(t => ({ ...t, tokenImg: imgCache[t.tokenPath] || null }));
  for (const t of playerTokens) {
    if (!t.tokenImg && t.tokenPath) {
      const img = new Image();
      img.src = `file:///${t.tokenPath.replace(/\\/g, '/')}`;
      img.onload = () => { t.tokenImg = img; renderAll(); };
    }
  }
  renderAll();
});

// Grid state update from DM
window.electronAPI.onGridUpdate((data) => {
  gridState = data;
  if (state.image) renderAll();
});

// Ping ring animation (same system as DM screen)
let pingCircles = [];
let pingAnimFrameId = null;

function addPingCircle(imgX, imgY, color) {
  pingCircles.push({ imgX, imgY, color, startTime: Date.now() });
  if (!pingAnimFrameId) animatePings();
}

function animatePings() {
  const now = Date.now();
  const DURATION = 2000;
  pingCircles = pingCircles.filter(p => now - p.startTime < DURATION);
  ctxPing.clearRect(0, 0, canvasPing.width, canvasPing.height);
  for (const p of pingCircles) {
    const t  = (now - p.startTime) / DURATION;
    const cx = p.imgX * state.scale + state.offsetX;
    const cy = p.imgY * state.scale + state.offsetY;
    const r  = t * 60;
    ctxPing.beginPath();
    ctxPing.arc(cx, cy, r, 0, Math.PI * 2);
    ctxPing.strokeStyle = p.color;
    ctxPing.lineWidth = 3;
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

// DM ping → show ring at the pinged map location
window.electronAPI.onPingLocation(({ imgX, imgY, color }) => {
  addPingCircle(imgX, imgY, color || '#c9a84c');
});

// View sync from DM (zoom + pan)
window.electronAPI.onViewSync(({ imgCenterX, imgCenterY, scale }) => {
  const W = canvasImage.width;
  const H = canvasImage.height;
  state.scale   = scale;
  state.offsetX = W / 2 - imgCenterX * scale;
  state.offsetY = H / 2 - imgCenterY * scale;
  if (state.image) renderAll();
});

// Incremental fog brush stroke
window.electronAPI.onFogUpdate(({ cx, cy, radius, mode }) => {
  if (!fogCtx) return;

  if (mode === 'reveal') {
    fogCtx.globalCompositeOperation = 'destination-out';
    fogCtx.fillStyle = 'rgba(0,0,0,1)';
  } else {
    fogCtx.globalCompositeOperation = 'source-over';
    fogCtx.fillStyle = '#000000';
  }

  fogCtx.beginPath();
  fogCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  fogCtx.fill();
  fogCtx.globalCompositeOperation = 'source-over';

  renderAll();
});
