'use strict';

// ===== i18n shortcut =====
function t(key, ...args) { return window.FREETT_I18N ? window.FREETT_I18N.t(key, ...args) : key; }

// ===== Remote Mode =====
let syncMode = 'local'; // 'local' | 'remote'
let currentSessionId = null;
let tunnelUrl = null;

// Compress a loaded HTMLImageElement to a JPEG data URL for remote transfer.
// Scales down to max 2048px on the longest side.
function compressImageForRemote(imgEl) {
  if (!imgEl) return null;
  const MAX  = 2048;
  const srcW = imgEl.naturalWidth  || imgEl.videoWidth  || 1;
  const srcH = imgEl.naturalHeight || imgEl.videoHeight || 1;
  const scale = Math.min(1, MAX / Math.max(srcW, srcH));
  const cvs   = document.createElement('canvas');
  cvs.width   = Math.round(srcW * scale);
  cvs.height  = Math.round(srcH * scale);
  cvs.getContext('2d').drawImage(imgEl, 0, 0, cvs.width, cvs.height);
  return cvs.toDataURL('image/jpeg', 0.85);
}

// Export a token's image as a small PNG data URL (max 256 px) for remote transfer.
function getTokenDataUrl(c) {
  if (!c.tokenImg) return null;
  const MAX  = 256;
  const srcW = c.tokenImg.naturalWidth  || 1;
  const srcH = c.tokenImg.naturalHeight || 1;
  const scale = Math.min(1, MAX / Math.max(srcW, srcH));
  const cvs   = document.createElement('canvas');
  cvs.width   = Math.round(srcW * scale);
  cvs.height  = Math.round(srcH * scale);
  cvs.getContext('2d').drawImage(c.tokenImg, 0, 0, cvs.width, cvs.height);
  return cvs.toDataURL('image/png');
}

// ===== Image/Video Deck =====
let slotIdCounter = 0;
const deck = []; // { id, filePath, image|video, isVideo, fogCanvas, fogCtx, name }
let activeSlotId = null;
let animFrameId = null;

function getActiveSlot() {
  return deck.find(s => s.id === activeSlotId) ?? null;
}

// ===== State =====
const state = {
  tool: 'reveal',
  brushSize: 60,
  isPainting: false,
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  isPanning: false,
  panStartX: 0,
  panStartY: 0,
  isRuling: false,
  rulerStartX: null,
  rulerStartY: null,
  rulerCurrentX: null,
  rulerCurrentY: null,
  prevTool: 'reveal',
  isGridAligning: false,
  gridAlignStartX: 0,
  gridAlignStartY: 0,
  gridAlignBaseX: 0,
  gridAlignBaseY: 0,
};

// ===== Elements =====
const canvasImage  = document.getElementById('canvas-image');
const canvasGrid   = document.getElementById('canvas-grid');
const canvasFog    = document.getElementById('canvas-fog');
const canvasTokens = document.getElementById('canvas-tokens');
const canvasPing   = document.getElementById('canvas-ping');
const canvasCursor = document.getElementById('canvas-cursor');
const ctxImage     = canvasImage.getContext('2d');
const ctxGrid      = canvasGrid.getContext('2d');
const ctxFog       = canvasFog.getContext('2d');
const ctxTokens    = canvasTokens.getContext('2d');
const ctxPing      = canvasPing.getContext('2d');
const ctxCursor    = canvasCursor.getContext('2d');

const dropZone     = document.getElementById('drop-zone');
const container    = document.getElementById('canvas-container');
const brushSlider  = document.getElementById('brush-size');
const brushValSpan = document.getElementById('brush-size-val');
const statusText   = document.getElementById('status-text');
const deckList     = document.getElementById('deck-list');
const volumeControl = document.getElementById('volume-control');
const volumeSlider  = document.getElementById('volume-slider');
const volumeIcon    = document.getElementById('volume-icon');

const musicSearchInput = document.getElementById('music-search-input');
const musicSearchBtn   = document.getElementById('music-search-btn');
const musicResultsEl   = document.getElementById('music-results');
const musicNowPlaying  = document.getElementById('music-now-playing');
const musicNowTitle    = document.getElementById('music-now-title');
const musicStopBtn     = document.getElementById('music-stop-btn');

let isMuted = false;
let volumeBeforeMute = 50;

function sliderToVolume(sliderVal) {
  return (sliderVal / 100) ** 2;
}

function sendVolume() {
  const vol = isMuted ? 0 : sliderToVolume(volumeSlider.value);
  window.electronAPI.sendVolumeChange({ volume: vol, muted: isMuted });
  window.electronAPI.sendMusicVolume({ volume: vol });
  if (syncMode === 'remote') {
    window.electronAPI.remotePushVolume({ sessionId: currentSessionId, value: vol, muted: isMuted });
  }
}

function updateVolumeIcon() {
  const vol = isMuted ? 0 : sliderToVolume(volumeSlider.value);
  volumeIcon.innerHTML = isMuted || vol === 0 ? '&#x1F507;' : vol < 0.25 ? '&#x1F509;' : '&#x1F50A;';
  volumeIcon.title = isMuted ? t('unmute') : t('mute');
}

volumeIcon.addEventListener('click', () => {
  if (isMuted) {
    isMuted = false;
    volumeSlider.value = volumeBeforeMute;
  } else {
    volumeBeforeMute = volumeSlider.value;
    isMuted = true;
  }
  updateVolumeIcon();
  sendVolume();
});

volumeSlider.addEventListener('input', () => {
  if (isMuted && volumeSlider.value > 0) isMuted = false;
  updateVolumeIcon();
  sendVolume();
  const slot = getActiveSlot();
  if (slot) slot.volume = parseInt(volumeSlider.value, 10);
});

// Player signals that video started playing -> re-send current volume to confirm correct level
window.electronAPI.onVideoReady(() => {
  sendVolume();
});

// ===== Music =====
function playMusicForSlot(slot) {
  if (slot?.musicVideoId) {
    window.electronAPI.sendMusicPlay({
      videoId: slot.musicVideoId,
      volume: isMuted ? 0 : sliderToVolume(volumeSlider.value),
    });
  } else {
    window.electronAPI.sendMusicStop();
  }
  updateMusicNowPlaying();
}

function updateMusicNowPlaying() {
  const slot = getActiveSlot();
  if (slot?.musicVideoId) {
    musicNowPlaying.style.display = 'flex';
    musicNowTitle.textContent = slot.musicTitle;
  } else {
    musicNowPlaying.style.display = 'none';
  }
}

async function performMusicSearch() {
  const query = musicSearchInput.value.trim();
  if (!query) return;
  musicResultsEl.innerHTML = `<div class="music-status">${t('music.searching')}</div>`;
  const results = await window.electronAPI.youtubeSearch(query);
  musicResultsEl.innerHTML = '';
  if (!results.length) {
    musicResultsEl.innerHTML = `<div class="music-status">${t('music.no_results')}</div>`;
    return;
  }
  for (const { id, title } of results) {
    const item = document.createElement('div');
    item.className = 'music-result-item';
    item.textContent = title;
    item.title = title;
    item.addEventListener('click', () => selectMusic(id, title));
    musicResultsEl.appendChild(item);
  }
}

function selectMusic(videoId, title) {
  const slot = getActiveSlot();
  if (!slot) return;
  slot.musicVideoId = videoId;
  slot.musicTitle = title;
  window.electronAPI.sendMusicPlay({
    videoId,
    volume: isMuted ? 0 : sliderToVolume(volumeSlider.value),
  });
  updateMusicNowPlaying();
  rebuildDeckUI();
}

musicSearchBtn.addEventListener('click', performMusicSearch);
musicSearchInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') performMusicSearch();
});
musicStopBtn.addEventListener('click', () => {
  const slot = getActiveSlot();
  if (slot) { slot.musicVideoId = null; slot.musicTitle = null; }
  window.electronAPI.sendMusicStop();
  updateMusicNowPlaying();
  rebuildDeckUI();
});

// ===== Resize canvases =====
function resizeCanvases() {
  const w = container.clientWidth;
  const h = container.clientHeight;
  [canvasImage, canvasGrid, canvasFog, canvasTokens, canvasPing, canvasCursor].forEach(c => {
    c.width  = w;
    c.height = h;
  });
  const slot = getActiveSlot();
  if (slot) renderAll(slot);
}

window.addEventListener('resize', resizeCanvases);
resizeCanvases();

// ===== Media helpers =====
function getSlotMedia(slot) {
  return slot.isVideo ? slot.video : slot.image;
}

function getSlotDimensions(slot) {
  if (slot.isVideo) return { w: slot.video.videoWidth, h: slot.video.videoHeight };
  return { w: slot.image.naturalWidth, h: slot.image.naturalHeight };
}

// ===== Video render loop =====
function startVideoLoop() {
  stopVideoLoop();
  function loop() {
    const slot = getActiveSlot();
    if (slot && slot.isVideo) {
      renderAll(slot);
      animFrameId = requestAnimationFrame(loop);
    } else {
      animFrameId = null;
    }
  }
  animFrameId = requestAnimationFrame(loop);
}

function stopVideoLoop() {
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

// ===== Render =====
function renderAll(slot) {
  slot = slot ?? getActiveSlot();
  if (!slot) return;

  const W = canvasImage.width;
  const H = canvasImage.height;
  const { offsetX, offsetY, scale } = state;
  const media = getSlotMedia(slot);

  ctxImage.clearRect(0, 0, W, H);
  ctxImage.save();
  ctxImage.translate(offsetX, offsetY);
  ctxImage.scale(scale, scale);
  ctxImage.drawImage(media, 0, 0);
  ctxImage.restore();

  drawGrid(slot);

  ctxFog.clearRect(0, 0, W, H);
  ctxFog.save();
  ctxFog.translate(offsetX, offsetY);
  ctxFog.scale(scale, scale);
  ctxFog.drawImage(slot.fogCanvas, 0, 0);
  ctxFog.restore();

  drawTokensLayer(slot);
}

// ===== Grid =====
function drawGrid(slot) {
  const W = canvasGrid.width;
  const H = canvasGrid.height;
  ctxGrid.clearRect(0, 0, W, H);
  if (!slot || !slot.gridVisible || !slot.gridSize) return;

  const cellSize = slot.gridSize * state.scale;
  const rawOffX = slot.gridOffsetX * state.scale + state.offsetX;
  const rawOffY = slot.gridOffsetY * state.scale + state.offsetY;
  const offX = ((rawOffX % cellSize) + cellSize) % cellSize;
  const offY = ((rawOffY % cellSize) + cellSize) % cellSize;

  const opacity = (slot.gridOpacity ?? 15) / 100;
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

// ===== Fog helpers =====
function makeFog(w, h) {
  const fc = document.createElement('canvas');
  fc.width  = w;
  fc.height = h;
  const fc_ctx = fc.getContext('2d');
  fc_ctx.fillStyle = '#000000';
  fc_ctx.fillRect(0, 0, w, h);
  return { fogCanvas: fc, fogCtx: fc_ctx };
}

function sendFullFogUpdate() {
  const slot = getActiveSlot();
  if (!slot) return;
  const dataUrl = slot.fogCanvas.toDataURL('image/png');
  window.electronAPI.sendFogReset({ dataUrl, width: slot.fogCanvas.width, height: slot.fogCanvas.height });
  if (syncMode === 'remote') {
    window.electronAPI.remotePushFog({ sessionId: currentSessionId, dataUrl, width: slot.fogCanvas.width, height: slot.fogCanvas.height });
  }
}

function sendFogPatch(cx, cy, radius, mode) {
  window.electronAPI.sendFogUpdate({ cx, cy, radius, mode });
}

function sendGridToPlayer() {
  const slot = getActiveSlot();
  const data = {
    gridVisible: slot?.gridVisible ?? false,
    gridSize: slot?.gridSize ?? null,
    gridOffsetX: slot?.gridOffsetX ?? 0,
    gridOffsetY: slot?.gridOffsetY ?? 0,
    gridOpacity: slot?.gridOpacity ?? 15,
  };
  window.electronAPI.sendGridUpdate(data);
  if (syncMode === 'remote') {
    window.electronAPI.remotePushGrid({ sessionId: currentSessionId, ...data });
  }
}

function syncViewToPlayer() {
  const W = canvasImage.width;
  const H = canvasImage.height;
  window.electronAPI.sendViewSync({
    imgCenterX: (W / 2 - state.offsetX) / state.scale,
    imgCenterY: (H / 2 - state.offsetY) / state.scale,
    scale: state.scale,
  });
}

// Re-push the full current state to a freshly (re)opened local player window,
// since it starts with no map/fog/tokens until the DM had switched slots.
function syncFullStateToLocalPlayer() {
  const slot = getActiveSlot();
  if (!slot) return;
  window.electronAPI.sendImageLoaded(slot.filePath);
  sendFullFogUpdate();
  sendGridToPlayer();
  sendVolume();
  sendTokensSync();
  syncViewToPlayer();
}

window.electronAPI.onPlayerWindowReady(() => {
  syncFullStateToLocalPlayer();
});

// ===== Fog painting =====
function screenToImage(sx, sy) {
  return {
    x: (sx - state.offsetX) / state.scale,
    y: (sy - state.offsetY) / state.scale,
  };
}

function paintFog(screenX, screenY) {
  const slot = getActiveSlot();
  if (!slot) return;

  const { x, y } = screenToImage(screenX, screenY);
  const r = state.brushSize / state.scale;

  if (state.tool === 'reveal') {
    slot.fogCtx.globalCompositeOperation = 'destination-out';
    slot.fogCtx.fillStyle = 'rgba(0,0,0,1)';
  } else {
    slot.fogCtx.globalCompositeOperation = 'source-over';
    slot.fogCtx.fillStyle = '#000000';
  }

  slot.fogCtx.beginPath();
  slot.fogCtx.arc(x, y, r, 0, Math.PI * 2);
  slot.fogCtx.fill();
  slot.fogCtx.globalCompositeOperation = 'source-over';

  renderAll(slot);
  sendFogPatch(x, y, r, state.tool);
}

// ===== Cursor preview =====
function drawCursor(screenX, screenY) {
  const W = canvasCursor.width;
  const H = canvasCursor.height;
  ctxCursor.clearRect(0, 0, W, H);

  if (state.tool === 'ruler' || state.tool === 'calibrate') {
    const s = 10;
    ctxCursor.beginPath();
    ctxCursor.moveTo(screenX - s, screenY);
    ctxCursor.lineTo(screenX + s, screenY);
    ctxCursor.moveTo(screenX, screenY - s);
    ctxCursor.lineTo(screenX, screenY + s);
    ctxCursor.strokeStyle = 'rgba(255,220,50,0.9)';
    ctxCursor.lineWidth = 1.5;
    ctxCursor.stroke();
    return;
  }
  if (state.tool === 'grid-align') {
    return;
  }

  const r = state.brushSize / 2;
  ctxCursor.beginPath();
  ctxCursor.arc(screenX, screenY, r, 0, Math.PI * 2);
  ctxCursor.strokeStyle = state.tool === 'reveal' ? 'rgba(201,168,76,0.8)' : 'rgba(180,60,60,0.8)';
  ctxCursor.lineWidth = 2;
  ctxCursor.setLineDash([4, 4]);
  ctxCursor.stroke();
  ctxCursor.setLineDash([]);
}

function drawRuler(sx1, sy1, sx2, sy2) {
  const W = canvasCursor.width;
  const H = canvasCursor.height;
  ctxCursor.clearRect(0, 0, W, H);

  // Linie
  ctxCursor.beginPath();
  ctxCursor.moveTo(sx1, sy1);
  ctxCursor.lineTo(sx2, sy2);
  ctxCursor.strokeStyle = 'rgba(255,220,50,0.9)';
  ctxCursor.lineWidth = 2;
  ctxCursor.setLineDash([8, 4]);
  ctxCursor.stroke();
  ctxCursor.setLineDash([]);

  // Endpunkte
  ctxCursor.fillStyle = 'rgba(255,220,50,0.9)';
  for (const [px, py] of [[sx1, sy1], [sx2, sy2]]) {
    ctxCursor.beginPath();
    ctxCursor.arc(px, py, 4, 0, Math.PI * 2);
    ctxCursor.fill();
  }

  // Entfernung in Bildkoordinaten
  const ip1 = screenToImage(sx1, sy1);
  const ip2 = screenToImage(sx2, sy2);
  const dist = Math.sqrt((ip2.x - ip1.x) ** 2 + (ip2.y - ip1.y) ** 2);

  const midX = (sx1 + sx2) / 2;
  const midY = (sy1 + sy2) / 2;
  const slot = getActiveSlot();
  let label;
  if (slot?.gridSize) {
    const fields = dist / slot.gridSize;
    const feet = fields * 5;
    label = t('ruler.fields_ft', fields.toFixed(1), feet.toFixed(1));
  } else {
    label = t('ruler.px', Math.round(dist));
  }

  ctxCursor.font = 'bold 13px sans-serif';
  ctxCursor.textAlign = 'center';
  ctxCursor.textBaseline = 'bottom';
  ctxCursor.shadowColor = '#000';
  ctxCursor.shadowBlur = 5;
  ctxCursor.fillStyle = '#fff';
  ctxCursor.fillText(label, midX, midY - 6);
  ctxCursor.shadowBlur = 0;
}

// ===== Fit media to view =====
function fitImageToView(slot) {
  const W = canvasImage.width;
  const H = canvasImage.height;
  const { w, h } = getSlotDimensions(slot);
  const scaleX = W / w;
  const scaleY = H / h;
  state.scale = Math.min(scaleX, scaleY, 1);
  state.offsetX = (W - w * state.scale) / 2;
  state.offsetY = (H - h * state.scale) / 2;
}

// ===== Deck management =====
function addMediaToDeck(filePath) {
  const name = filePath.split(/[\\/]/).pop();
  const src = `file:///${filePath.replace(/\\/g, '/')}`;
  const isVideo = /\.(mp4|webm|ogg|mov)$/i.test(filePath);

  if (isVideo) {
    const video = document.createElement('video');
    video.loop = true;
    video.muted = true;
    video.src = src;
    video.addEventListener('loadeddata', () => {
      const { fogCanvas, fogCtx } = makeFog(video.videoWidth, video.videoHeight);
      const slot = { id: ++slotIdCounter, filePath, video, isVideo: true, fogCanvas, fogCtx, name, musicVideoId: null, musicTitle: null, volume: parseInt(volumeSlider.value, 10), combatants: [], pins: [], gridSize: null, gridOffsetX: 0, gridOffsetY: 0, gridVisible: false, gridOpacity: 15 };
      deck.push(slot);
      for (const gp of globalPlayers) addGlobalPlayerToSlot(gp, slot);
      rebuildDeckUI();
      if (activeSlotId === null) switchToSlot(slot.id);
    });
    video.addEventListener('error', () => {
      statusText.textContent = t('session.map_error') + name;
    });
  } else {
    const img = new Image();
    img.src = src;
    img.onload = () => {
      const { fogCanvas, fogCtx } = makeFog(img.naturalWidth, img.naturalHeight);
      const slot = { id: ++slotIdCounter, filePath, image: img, isVideo: false, fogCanvas, fogCtx, name, musicVideoId: null, musicTitle: null, volume: parseInt(volumeSlider.value, 10), combatants: [], pins: [], gridSize: null, gridOffsetX: 0, gridOffsetY: 0, gridVisible: false, gridOpacity: 15 };
      deck.push(slot);
      for (const gp of globalPlayers) addGlobalPlayerToSlot(gp, slot);
      rebuildDeckUI();
      if (activeSlotId === null) switchToSlot(slot.id);
    };
    img.onerror = () => {
      statusText.textContent = t('session.map_error') + name;
    };
  }
}

function switchToSlot(id) {
  if (id === activeSlotId) return;

  // Pause active video before switching
  const prevSlot = getActiveSlot();
  if (prevSlot && prevSlot.isVideo) prevSlot.video.pause();
  stopVideoLoop();

  activeSlotId = id;
  const slot = deck.find(s => s.id === id);
  fitImageToView(slot);
  dropZone.style.display = 'none';
  statusText.textContent = slot.name;
  renderAll(slot);
  syncViewToPlayer();
  volumeSlider.value = slot.volume ?? 50;
  if (isMuted && volumeSlider.value > 0) isMuted = false;
  updateVolumeIcon();
  sendVolume();
  window.electronAPI.sendImageLoaded(slot.filePath);
  sendFullFogUpdate();
  sendGridToPlayer();
  if (syncMode === 'remote') {
    if (slot.isVideo) {
      window.electronAPI.remoteRegisterMedia(slot.filePath).then(mediaUrl => {
        window.electronAPI.remotePushMap({ sessionId: currentSessionId, videoUrl: mediaUrl, name: slot.name });
      });
    } else {
      const imgData = compressImageForRemote(slot.image);
      if (imgData) window.electronAPI.remotePushMap({ sessionId: currentSessionId, imageData: imgData, name: slot.name });
    }
  }
  rebuildDeckUI();
  rebuildCombatUI();
  playMusicForSlot(slot);
  updateRulerStatus();
  updateGridPanel();

  if (slot.isVideo) {
    slot.video.play();
    startVideoLoop();
  }

  sendTokensSync();
}

function removeFromDeck(id) {
  const idx = deck.findIndex(s => s.id === id);
  if (idx === -1) return;
  const slot = deck[idx];
  if (slot.isVideo) slot.video.pause();
  deck.splice(idx, 1);
  if (activeSlotId === id) {
    if (deck.length > 0) {
      switchToSlot(deck[Math.min(idx, deck.length - 1)].id);
    } else {
      activeSlotId = null;
      ctxImage.clearRect(0, 0, canvasImage.width, canvasImage.height);
      ctxGrid.clearRect(0, 0, canvasGrid.width, canvasGrid.height);
      ctxFog.clearRect(0, 0, canvasFog.width, canvasFog.height);
      dropZone.style.display = 'flex';
      statusText.textContent = t('status.no_image');
      window.electronAPI.sendMusicStop();
      updateMusicNowPlaying();
      rebuildCombatUI();
      updateGridPanel();
    }
  }
  rebuildDeckUI();
}

function rebuildDeckUI() {
  deckList.innerHTML = '';
  deck.forEach(slot => {
    const item = document.createElement('div');
    item.className = 'deck-item' + (slot.id === activeSlotId ? ' active' : '');
    item.title = slot.name;

    const label = document.createElement('span');
    label.className = 'deck-item-name';
    label.textContent = slot.name;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'deck-item-remove';
    removeBtn.textContent = '×';
    removeBtn.title = t('combat.remove.title');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromDeck(slot.id);
    });

    item.appendChild(label);
    if (slot.musicTitle) {
      const musicNote = document.createElement('span');
      musicNote.className = 'deck-item-music';
      musicNote.textContent = '♫';
      musicNote.title = slot.musicTitle;
      item.appendChild(musicNote);
    }
    item.appendChild(removeBtn);
    item.addEventListener('click', () => switchToSlot(slot.id));
    deckList.appendChild(item);
  });
}

// ===== Mouse events =====
canvasImage.addEventListener('mousedown', (e) => {
  if (!getActiveSlot()) return;
  if (e.button === 2) {
    // Right-click: check for pin first, then token context menu, then pan
    const pinHit = getPinAtScreen(e.offsetX, e.offsetY);
    if (pinHit) {
      removePinFromDM(pinHit.id);
      return;
    }
    const tokenHit = getTokenAtScreen(e.offsetX, e.offsetY);
    if (tokenHit) {
      showTokenContextMenu(tokenHit, e.clientX, e.clientY);
      return;
    }
    state.isPanning = true;
    state.panStartX = e.clientX - state.offsetX;
    state.panStartY = e.clientY - state.offsetY;
    return;
  }
  if (e.button === 1) {
    state.isPanning = true;
    state.panStartX = e.clientX - state.offsetX;
    state.panStartY = e.clientY - state.offsetY;
    return;
  }
  // Shift+left-click: DM ping at this map location
  if (e.button === 0 && e.shiftKey) {
    const slot = getActiveSlot();
    if (slot) {
      const imgPos = screenToImage(e.offsetX, e.offsetY);
      sendDMPing(imgPos.x, imgPos.y);
    }
    return;
  }
  if (state.tool === 'grid-align') {
    const slot = getActiveSlot();
    if (slot) {
      state.isGridAligning = true;
      state.gridAlignStartX = e.offsetX;
      state.gridAlignStartY = e.offsetY;
      state.gridAlignBaseX = slot.gridOffsetX;
      state.gridAlignBaseY = slot.gridOffsetY;
      canvasImage.style.cursor = 'grabbing';
    }
    return;
  }
  // Left-click: check for token hit first
  const tokenHit = getTokenAtScreen(e.offsetX, e.offsetY);
  if (tokenHit && state.tool !== 'ruler' && state.tool !== 'calibrate') {
    tokenDragState = { combatant: tokenHit };
    canvasImage.style.cursor = 'grabbing';
    return;
  }
  if (state.tool === 'ruler' || state.tool === 'calibrate') {
    state.isRuling = true;
    state.rulerStartX = e.offsetX;
    state.rulerStartY = e.offsetY;
    state.rulerCurrentX = e.offsetX;
    state.rulerCurrentY = e.offsetY;
    return;
  }
  state.isPainting = true;
  paintFog(e.offsetX, e.offsetY);
});

canvasImage.addEventListener('mousemove', (e) => {
  if (tokenDragState) {
    const imgPos = screenToImage(e.offsetX, e.offsetY);
    tokenDragState.combatant.tokenX = imgPos.x;
    tokenDragState.combatant.tokenY = imgPos.y;
    renderAll();
    return;
  }
  if (state.isGridAligning) {
    const slot = getActiveSlot();
    if (slot) {
      slot.gridOffsetX = state.gridAlignBaseX + (e.offsetX - state.gridAlignStartX) / state.scale;
      slot.gridOffsetY = state.gridAlignBaseY + (e.offsetY - state.gridAlignStartY) / state.scale;
      renderAll(slot);
      updateGridPanel();
      sendGridToPlayer();
    }
    return;
  }
  if (state.isRuling) {
    state.rulerCurrentX = e.offsetX;
    state.rulerCurrentY = e.offsetY;
    drawRuler(state.rulerStartX, state.rulerStartY, e.offsetX, e.offsetY);
    if (state.isPanning) {
      state.offsetX = e.clientX - state.panStartX;
      state.offsetY = e.clientY - state.panStartY;
      renderAll();
      syncViewToPlayer();
    }
    return;
  }
  if (state.isPainting) paintFog(e.offsetX, e.offsetY);
  if (state.isPanning) {
    state.offsetX = e.clientX - state.panStartX;
    state.offsetY = e.clientY - state.panStartY;
    renderAll();
    syncViewToPlayer();
  }
  const tokenHit = getTokenAtScreen(e.offsetX, e.offsetY);
  if (tokenHit && state.tool !== 'ruler' && state.tool !== 'calibrate') {
    ctxCursor.clearRect(0, 0, canvasCursor.width, canvasCursor.height);
    canvasImage.style.cursor = 'grab';
  } else if (state.tool === 'grid-align') {
    ctxCursor.clearRect(0, 0, canvasCursor.width, canvasCursor.height);
    canvasImage.style.cursor = 'move';
  } else {
    canvasImage.style.cursor = '';
    drawCursor(e.offsetX, e.offsetY);
  }
});

canvasImage.addEventListener('mouseup', () => {
  if (tokenDragState) {
    tokenDragState = null;
    canvasImage.style.cursor = '';
    sendTokensSync();
    rebuildCombatUI();
    return;
  }
  if (state.isGridAligning) {
    state.isGridAligning = false;
    canvasImage.style.cursor = 'move';
    return;
  }
  if (state.isRuling) {
    if (state.tool === 'calibrate') {
      const ip1 = screenToImage(state.rulerStartX, state.rulerStartY);
      const ip2 = screenToImage(state.rulerCurrentX ?? state.rulerStartX, state.rulerCurrentY ?? state.rulerStartY);
      const dist = Math.round(Math.sqrt((ip2.x - ip1.x) ** 2 + (ip2.y - ip1.y) ** 2));
      state.isRuling = false;
      state.rulerStartX = null;
      state.rulerStartY = null;
      showCalibrateOverlay(dist);
      return;
    }
    state.isRuling = false;
    state.rulerStartX = null;
    state.rulerStartY = null;
    state.rulerCurrentX = null;
    state.rulerCurrentY = null;
    ctxCursor.clearRect(0, 0, canvasCursor.width, canvasCursor.height);
    return;
  }
  state.isPainting = false;
  state.isPanning = false;
  if (getActiveSlot()) sendFullFogUpdate();
});

canvasImage.addEventListener('mouseleave', () => {
  ctxCursor.clearRect(0, 0, canvasCursor.width, canvasCursor.height);
  state.isPainting = false;
  state.isPanning = false;
  state.isRuling = false;
  state.isGridAligning = false;
  state.rulerStartX = null;
  state.rulerStartY = null;
  state.rulerCurrentX = null;
  state.rulerCurrentY = null;
  if (tokenDragState) {
    tokenDragState = null;
    canvasImage.style.cursor = '';
    sendTokensSync();
    rebuildCombatUI();
  }
});

canvasImage.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });

canvasImage.addEventListener('wheel', (e) => {
  if (!getActiveSlot()) return;
  e.preventDefault();

  const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
  const mouseX = e.offsetX;
  const mouseY = e.offsetY;

  state.offsetX = mouseX - (mouseX - state.offsetX) * zoomFactor;
  state.offsetY = mouseY - (mouseY - state.offsetY) * zoomFactor;
  state.scale   = Math.min(Math.max(state.scale * zoomFactor, 0.05), 10);

  renderAll();
  syncViewToPlayer();
}, { passive: false });

// ===== Toolbar =====
document.getElementById('btn-deck-add').addEventListener('click', async () => {
  const filePaths = await window.electronAPI.openFileDialog();
  if (filePaths) filePaths.forEach(addMediaToDeck);
});

document.getElementById('btn-load-drop').addEventListener('click', async () => {
  const filePaths = await window.electronAPI.openFileDialog();
  if (filePaths) filePaths.forEach(addMediaToDeck);
});

document.querySelectorAll('.btn-tool').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.tool = btn.dataset.tool;
    if (state.tool !== 'grid-align') {
      deactivateGridAlign();
    }
    updateRulerStatus();
  });
});

brushSlider.addEventListener('input', () => {
  state.brushSize = parseInt(brushSlider.value, 10);
  brushValSpan.textContent = brushSlider.value;
});

document.getElementById('btn-reveal-all').addEventListener('click', () => {
  const slot = getActiveSlot();
  if (!slot) return;
  slot.fogCtx.clearRect(0, 0, slot.fogCanvas.width, slot.fogCanvas.height);
  renderAll(slot);
  sendFullFogUpdate();
});

document.getElementById('btn-hide-all').addEventListener('click', () => {
  const slot = getActiveSlot();
  if (!slot) return;
  slot.fogCtx.globalCompositeOperation = 'source-over';
  slot.fogCtx.fillStyle = '#000000';
  slot.fogCtx.fillRect(0, 0, slot.fogCanvas.width, slot.fogCanvas.height);
  renderAll(slot);
  sendFullFogUpdate();
});

// ===== Drag & Drop =====
container.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer.types.includes('application/dnd-combat-token')) {
    e.dataTransfer.dropEffect = 'copy';
  } else {
    dropZone.classList.add('drag-over');
  }
});

container.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});

container.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');

  // Check for token drop from combat list
  const tokenId = e.dataTransfer.getData('application/dnd-combat-token');
  if (tokenId) {
    const slot = getActiveSlot();
    if (!slot) return;
    const c = slot.combatants.find(x => x.id === parseInt(tokenId, 10));
    if (c) {
      const imgPos = screenToImage(e.offsetX, e.offsetY);
      c.tokenX = imgPos.x;
      c.tokenY = imgPos.y;
      if (!c.tokenSize) c.tokenSize = 40;
      renderAll(slot);
      rebuildCombatUI();
      sendTokensSync();
    }
    return;
  }

  Array.from(e.dataTransfer.files)
    .filter(f => /\.(jpe?g|png|webp|gif|mp4|webm|ogg|mov)$/i.test(f.name))
    .forEach(f => addMediaToDeck(f.path));
});

// ===== Token Context Menu =====
let ctxMenuToken = null;

function showTokenContextMenu(token, clientX, clientY) {
  ctxMenuToken = token;
  const menu = document.getElementById('token-ctx-menu');
  document.getElementById('token-ctx-name').textContent = token.name;
  document.getElementById('token-ctx-size-val').textContent = token.tokenSize || 40;
  menu.style.display = '';
  // Keep menu within viewport
  const menuW = 160, menuH = 140;
  const left = Math.min(clientX, window.innerWidth - menuW - 8);
  const top  = Math.min(clientY, window.innerHeight - menuH - 8);
  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';
}

function closeTokenContextMenu() {
  document.getElementById('token-ctx-menu').style.display = 'none';
  ctxMenuToken = null;
}

function applyTokenSize(size) {
  if (!ctxMenuToken) return;
  ctxMenuToken.tokenSize = Math.max(10, size);
  document.getElementById('token-ctx-size-val').textContent = ctxMenuToken.tokenSize;
  renderAll();
  rebuildCombatUI();
  sendTokensSync();
}

document.getElementById('token-ctx-size-minus').addEventListener('click', () => {
  if (ctxMenuToken) applyTokenSize((ctxMenuToken.tokenSize || 40) - 5);
});
document.getElementById('token-ctx-size-plus').addEventListener('click', () => {
  if (ctxMenuToken) applyTokenSize((ctxMenuToken.tokenSize || 40) + 5);
});
document.querySelectorAll('.ctx-preset-btn').forEach(btn => {
  btn.addEventListener('click', () => applyTokenSize(parseInt(btn.dataset.size, 10)));
});
document.getElementById('token-ctx-remove').addEventListener('click', () => {
  if (ctxMenuToken) {
    ctxMenuToken.tokenX = null;
    ctxMenuToken.tokenY = null;
    closeTokenContextMenu();
    renderAll();
    rebuildCombatUI();
    sendTokensSync();
  }
});
document.getElementById('token-ctx-close').addEventListener('click', closeTokenContextMenu);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeTokenContextMenu();
});

// ===== Token System =====
let tokenDragState = null; // { combatant } when dragging a placed token on the canvas

function imageToScreen(ix, iy) {
  return {
    x: ix * state.scale + state.offsetX,
    y: iy * state.scale + state.offsetY,
  };
}

function getTokenAtScreen(sx, sy) {
  const slot = getActiveSlot();
  if (!slot) return null;
  for (const c of slot.combatants) {
    if (c.tokenX == null || c.tokenY == null) continue;
    const sc = imageToScreen(c.tokenX, c.tokenY);
    const r = (c.tokenSize || 40) * state.scale;
    const dx = sx - sc.x;
    const dy = sy - sc.y;
    if (dx * dx + dy * dy <= r * r) return c;
  }
  return null;
}

function drawTokensLayer(slot) {
  const W = canvasTokens.width;
  const H = canvasTokens.height;
  ctxTokens.clearRect(0, 0, W, H);
  if (!slot) return;

  for (const c of slot.combatants) {
    if (c.tokenX == null || c.tokenY == null) continue;
    const sc = imageToScreen(c.tokenX, c.tokenY);
    const r = (c.tokenSize || 40) * state.scale;

    // Clipped token image
    ctxTokens.save();
    ctxTokens.beginPath();
    ctxTokens.arc(sc.x, sc.y, r, 0, Math.PI * 2);
    ctxTokens.clip();
    if (c.tokenImg) {
      ctxTokens.drawImage(c.tokenImg, sc.x - r, sc.y - r, r * 2, r * 2);
    } else {
      ctxTokens.fillStyle = c.type === 'monster' ? '#5a1010' : '#101a4a';
      ctxTokens.fillRect(sc.x - r, sc.y - r, r * 2, r * 2);
      ctxTokens.font = `${Math.max(12, r)}px sans-serif`;
      ctxTokens.fillStyle = 'rgba(255,255,255,0.7)';
      ctxTokens.textAlign = 'center';
      ctxTokens.textBaseline = 'middle';
      ctxTokens.fillText(c.type === 'monster' ? '💀' : '🧙', sc.x, sc.y);
    }
    ctxTokens.restore();

    // Border ring
    ctxTokens.beginPath();
    ctxTokens.arc(sc.x, sc.y, r, 0, Math.PI * 2);
    ctxTokens.strokeStyle = c.type === 'monster' ? '#e08888' : '#88a8e8';
    ctxTokens.lineWidth = 2;
    ctxTokens.stroke();

    // Name label below token
    ctxTokens.font = 'bold 12px sans-serif';
    ctxTokens.fillStyle = '#ffffff';
    ctxTokens.textAlign = 'center';
    ctxTokens.textBaseline = 'top';
    ctxTokens.shadowColor = '#000000';
    ctxTokens.shadowBlur = 4;
    ctxTokens.fillText(c.name, sc.x, sc.y + r + 3);
    ctxTokens.shadowBlur = 0;
  }

  // Draw map pins
  if (slot.pins) {
    for (const pin of slot.pins) {
      const sc = imageToScreen(pin.imgX, pin.imgY);
      // Pin circle
      ctxTokens.beginPath();
      ctxTokens.arc(sc.x, sc.y, 9, 0, Math.PI * 2);
      ctxTokens.fillStyle = pin.colorHex;
      ctxTokens.fill();
      ctxTokens.strokeStyle = '#ffffff';
      ctxTokens.lineWidth = 2;
      ctxTokens.stroke();
      // Pin icon
      ctxTokens.font = '10px sans-serif';
      ctxTokens.fillStyle = '#fff';
      ctxTokens.textAlign = 'center';
      ctxTokens.textBaseline = 'middle';
      ctxTokens.fillText('📌', sc.x, sc.y);
      // Pin label above
      if (pin.text) {
        ctxTokens.font = 'bold 11px sans-serif';
        ctxTokens.fillStyle = '#ffffff';
        ctxTokens.textAlign = 'center';
        ctxTokens.textBaseline = 'bottom';
        ctxTokens.shadowColor = '#000';
        ctxTokens.shadowBlur = 3;
        ctxTokens.fillText(pin.text, sc.x, sc.y - 11);
        ctxTokens.shadowBlur = 0;
      }
    }
  }
}

// ===== Ping Animations =====
let pingCircles = []; // { imgX, imgY, color, startTime }
let pingAnimFrameId = null;

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
    const t = (now - p.startTime) / DURATION; // 0..1
    const sc = imageToScreen(p.imgX, p.imgY);
    const maxR = 120;
    const r = t * maxR;
    const alpha = 1 - t;
    ctxPing.beginPath();
    ctxPing.arc(sc.x, sc.y, r, 0, Math.PI * 2);
    ctxPing.strokeStyle = p.color;
    ctxPing.lineWidth = 5;
    ctxPing.globalAlpha = alpha;
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

// ===== Pin helpers =====
function getPinAtScreen(sx, sy) {
  const slot = getActiveSlot();
  if (!slot || !slot.pins) return null;
  for (const pin of slot.pins) {
    const sc = imageToScreen(pin.imgX, pin.imgY);
    const dx = sx - sc.x;
    const dy = sy - sc.y;
    if (dx * dx + dy * dy <= 81) return pin; // 9px radius
  }
  return null;
}

function removePinFromDM(pinId) {
  const slot = getActiveSlot();
  if (!slot || !slot.pins) return;
  slot.pins = slot.pins.filter(p => p.id !== pinId);
  renderAll();
  if (syncMode === 'remote' && currentSessionId) {
    window.electronAPI.remotePushPinRemove({ sessionId: currentSessionId, pinId });
  }
}

// DM receives pin events from remote players
window.electronAPI.onRemotePinEvent(({ action, pin, pinId }) => {
  if (syncMode !== 'remote') return;
  const slot = getActiveSlot();
  if (!slot) return;
  if (!slot.pins) slot.pins = [];
  if (action === 'place') {
    slot.pins.push(pin);
  } else if (action === 'remove') {
    slot.pins = slot.pins.filter(p => p.id !== pinId);
  }
  renderAll();
});

// DM receives player-ping from remote player
window.electronAPI.onRemotePlayerPing(({ playerId, imgX, imgY, color }) => {
  if (syncMode !== 'remote') return;
  addPingCircle(imgX, imgY, color);
});

function sendTokensSync() {
  const slot = getActiveSlot();

  // Local IPC: player-screen.js uses tokenPath for file:// image loading
  const localTokens = !slot ? [] : slot.combatants
    .filter(c => c.tokenX != null && c.tokenY != null && c.tokenPath)
    .map(c => {
      const gp = c.globalPlayerId ? globalPlayers.find(p => p.id === c.globalPlayerId) : null;
      return {
        id: c.id, name: c.name, type: c.type,
        tokenPath: c.tokenPath,
        tokenX: c.tokenX, tokenY: c.tokenY,
        tokenSize: c.tokenSize || 40,
        controllerId: gp?.uuid ?? null,
      };
    });
  window.electronAPI.sendTokensSync(localTokens);

  if (syncMode === 'remote') {
    // Remote: embed compressed token images as data URLs (no Storage needed)
    const remoteTokens = !slot ? [] : slot.combatants
      .filter(c => c.tokenX != null && c.tokenY != null)
      .map(c => {
        const gp = c.globalPlayerId ? globalPlayers.find(p => p.id === c.globalPlayerId) : null;
        return {
          id: c.id, name: c.name, type: c.type,
          tokenData: getTokenDataUrl(c),
          tokenX: c.tokenX, tokenY: c.tokenY,
          tokenSize: c.tokenSize || 40,
          controllerId: gp?.uuid ?? null,
        };
      });
    window.electronAPI.remotePushTokens({ sessionId: currentSessionId, tokens: remoteTokens });
  }
}

// ===== Copy Combatant to Scene =====
let activeCopyMenu = null;

function closeCopyMenu() {
  if (activeCopyMenu) {
    activeCopyMenu.remove();
    activeCopyMenu = null;
    document.removeEventListener('click', closeCopyMenuOnOutside, true);
  }
}

function closeCopyMenuOnOutside(e) {
  if (activeCopyMenu && !activeCopyMenu.contains(e.target)) {
    closeCopyMenu();
  }
}

function copyCombatantToSlot(combatant, targetSlot) {
  const copy = {
    id: ++combatIdCounter,
    name: combatant.name,
    type: combatant.type,
    hp: combatant.hp,
    maxHp: combatant.maxHp,
    tokenPath: combatant.tokenPath ?? null,
    tokenImg: null,
    tokenX: null,
    tokenY: null,
    tokenSize: combatant.tokenSize ?? 40,
    status: combatant.status ?? '',
    globalPlayerId: combatant.globalPlayerId ?? null,
  };
  if (copy.tokenPath) {
    const img = new Image();
    img.src = `file:///${copy.tokenPath.replace(/\\/g, '/')}`;
    img.onload = () => { copy.tokenImg = img; if (targetSlot.id === activeSlotId) { rebuildCombatUI(); renderAll(targetSlot); } };
  }
  targetSlot.combatants.push(copy);
  if (targetSlot.id === activeSlotId) rebuildCombatUI();
}

function showCopyMenu(combatant, buttonEl) {
  closeCopyMenu();

  const otherSlots = deck.filter(s => s.id !== activeSlotId);
  const menu = document.createElement('div');
  menu.className = 'copy-scene-menu';

  const header = document.createElement('div');
  header.className = 'copy-scene-menu-header';
  header.textContent = t('combat.copy.header');
  menu.appendChild(header);

  if (otherSlots.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'copy-scene-menu-empty';
    empty.textContent = t('combat.copy.no_scenes');
    menu.appendChild(empty);
  } else {
    for (const slot of otherSlots) {
      const item = document.createElement('div');
      item.className = 'copy-scene-menu-item';
      item.textContent = slot.name;
      item.title = slot.name;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        copyCombatantToSlot(combatant, slot);
        closeCopyMenu();
      });
      menu.appendChild(item);
    }
  }

  document.body.appendChild(menu);
  activeCopyMenu = menu;

  const rect = buttonEl.getBoundingClientRect();
  const menuW = 160;
  let left = rect.right + 4;
  if (left + menuW > window.innerWidth) left = rect.left - menuW - 4;
  menu.style.left = `${left}px`;
  menu.style.top = `${rect.top}px`;

  setTimeout(() => document.addEventListener('click', closeCopyMenuOnOutside, true), 0);
}

async function openTokenDialog(combatant) {
  const filePaths = await window.electronAPI.openFileDialog();
  if (!filePaths || filePaths.length === 0) return;
  const fp = filePaths.find(f => /\.(jpe?g|png|webp|gif)$/i.test(f));
  if (!fp) return;
  const img = new Image();
  img.src = `file:///${fp.replace(/\\/g, '/')}`;
  img.onload = () => {
    combatant.tokenPath = fp;
    combatant.tokenImg = img;
    rebuildCombatUI();
    renderAll();
  };
}

// ===== Combat Tracker =====
let combatAddType = null;
let combatDragSrcIdx = -1;
let combatDragFromHandle = false;
let combatIdCounter = 0;

const combatList     = document.getElementById('combat-list');
const combatAddOverlay   = document.getElementById('combat-add-overlay');
const combatAddName      = document.getElementById('combat-add-name');
const combatAddHpFields  = document.getElementById('combat-add-hp-fields');
const combatAddMaxHp     = document.getElementById('combat-add-maxhp');
const combatAddTypeLabel = document.getElementById('combat-add-type-label');

function rebuildCombatUI() {
  combatList.innerHTML = '';
  const slot = getActiveSlot();
  if (!slot) return;

  slot.combatants.forEach((c, idx) => {
    const item = document.createElement('div');
    item.className = 'combat-item ' + (c.type === 'monster' ? 'combat-monster' : 'combat-player');
    item.draggable = true;

    // --- Top row ---
    const top = document.createElement('div');
    top.className = 'combat-item-top';

    const handle = document.createElement('span');
    handle.className = 'combat-drag-handle';
    handle.textContent = '⠿';
    handle.title = t('combat.drag.title');
    handle.addEventListener('mousedown', () => { combatDragFromHandle = true; });
    handle.addEventListener('mouseleave', () => { combatDragFromHandle = false; });

    const icon = document.createElement('span');
    icon.className = 'combat-type-icon';
    icon.textContent = c.type === 'monster' ? '💀' : '🧙';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'combat-item-name';
    nameSpan.textContent = c.name;
    nameSpan.title = c.name;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'combat-item-copy';
    copyBtn.textContent = '⧉';
    copyBtn.title = t('combat.copy.title');
    copyBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      showCopyMenu(c, copyBtn);
    });

    const removeBtn = document.createElement('button');
    removeBtn.className = 'combat-item-remove';
    removeBtn.textContent = '×';
    removeBtn.title = t('combat.remove.title');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      slot.combatants.splice(idx, 1);
      rebuildCombatUI();
      sendTokensSync();
    });

    // Token slot: empty button to load image, or thumbnail to drag onto canvas
    const tokenSlot = document.createElement('span');
    tokenSlot.className = 'combat-token-slot';

    if (c.tokenImg) {
      const thumb = document.createElement('img');
      thumb.className = 'combat-token-img' + (c.tokenX != null ? ' token-on-map' : '');
      thumb.src = `file:///${c.tokenPath.replace(/\\/g, '/')}`;
      thumb.draggable = true;
      thumb.title = c.tokenX != null
        ? t('combat.token.title.placed')
        : t('combat.token.title.unplaced');
      thumb.addEventListener('dragstart', (ev) => {
        ev.stopPropagation();
        ev.dataTransfer.setData('application/dnd-combat-token', c.id.toString());
        ev.dataTransfer.effectAllowed = 'copy';
      });
      thumb.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openTokenDialog(c);
      });
      tokenSlot.appendChild(thumb);
    } else {
      const tokenBtn = document.createElement('button');
      tokenBtn.className = 'combat-token-empty';
      tokenBtn.textContent = '🖼';
      tokenBtn.title = t('btn.load_token.title');
      tokenBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openTokenDialog(c);
      });
      tokenSlot.appendChild(tokenBtn);
    }

    top.append(handle, tokenSlot, icon, nameSpan, copyBtn, removeBtn);
    item.appendChild(top);

    // --- HP row (monsters only) ---
    if (c.type === 'monster') {
      const hpRow = document.createElement('div');
      hpRow.className = 'combat-item-hp';

      const hpIcon = document.createElement('span');
      hpIcon.className = 'combat-hp-icon';
      hpIcon.textContent = '♥';

      const minusBtn = document.createElement('button');
      minusBtn.className = 'combat-hp-btn';
      minusBtn.textContent = '−';
      minusBtn.title = t('combat.hp.damage.title');

      const hpInput = document.createElement('input');
      hpInput.type = 'number';
      hpInput.className = 'combat-hp-input' + (c.hp === 0 ? ' hp-dead' : '');
      hpInput.value = c.hp;
      hpInput.min = 0;
      hpInput.max = c.maxHp;
      hpInput.title = t('combat.hp.current.title');

      const sep = document.createElement('span');
      sep.className = 'combat-hp-sep';
      sep.textContent = '/';

      const maxHpSpan = document.createElement('span');
      maxHpSpan.className = 'combat-maxhp';
      maxHpSpan.textContent = c.maxHp;

      const plusBtn = document.createElement('button');
      plusBtn.className = 'combat-hp-btn';
      plusBtn.textContent = '+';
      plusBtn.title = t('combat.hp.heal.title');

      hpInput.addEventListener('change', () => {
        c.hp = Math.max(0, Math.min(c.maxHp, parseInt(hpInput.value, 10) || 0));
        hpInput.value = c.hp;
        hpInput.classList.toggle('hp-dead', c.hp === 0);
      });
      minusBtn.addEventListener('click', () => {
        c.hp = Math.max(0, c.hp - 1);
        hpInput.value = c.hp;
        hpInput.classList.toggle('hp-dead', c.hp === 0);
      });
      plusBtn.addEventListener('click', () => {
        c.hp = Math.min(c.maxHp, c.hp + 1);
        hpInput.value = c.hp;
        hpInput.classList.toggle('hp-dead', c.hp === 0);
      });

      hpRow.append(hpIcon, minusBtn, hpInput, sep, maxHpSpan, plusBtn);
      item.appendChild(hpRow);
    }

    // --- Status row (all combatants) ---
    const statusRow = document.createElement('div');
    statusRow.className = 'combat-item-status';
    const statusInput = document.createElement('input');
    statusInput.type = 'text';
    statusInput.className = 'combat-status-input';
    statusInput.placeholder = t('combat.status.placeholder');
    statusInput.value = c.status || '';
    statusInput.addEventListener('input', () => { c.status = statusInput.value; });
    statusRow.appendChild(statusInput);
    item.appendChild(statusRow);

    // --- Drag & Drop (only from handle) ---
    item.addEventListener('dragstart', (e) => {
      if (!combatDragFromHandle) {
        e.preventDefault();
        return;
      }
      combatDragSrcIdx = idx;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => item.classList.add('dragging'), 0);
    });
    item.addEventListener('dragend', () => {
      combatDragSrcIdx = -1;
      combatDragFromHandle = false;
      item.classList.remove('dragging');
      combatList.querySelectorAll('.combat-item').forEach(i => i.classList.remove('drag-over'));
    });
    item.addEventListener('dragover', (e) => {
      if (combatDragSrcIdx === -1) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      combatList.querySelectorAll('.combat-item').forEach(i => i.classList.remove('drag-over'));
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', (e) => {
      if (!item.contains(e.relatedTarget)) item.classList.remove('drag-over');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      if (combatDragSrcIdx === -1 || combatDragSrcIdx === idx) return;
      const moved = slot.combatants.splice(combatDragSrcIdx, 1)[0];
      const insertIdx = combatDragSrcIdx < idx ? idx - 1 : idx;
      slot.combatants.splice(insertIdx, 0, moved);
      combatDragSrcIdx = -1;
      rebuildCombatUI();
    });

    combatList.appendChild(item);
  });
}

function openCombatAddOverlay(type) {
  combatAddType = type;
  combatAddTypeLabel.textContent = type === 'monster' ? t('combat.add.monster') : t('combat.add.player');
  combatAddHpFields.style.display = type === 'monster' ? 'flex' : 'none';
  combatAddName.value = '';
  combatAddMaxHp.value = '10';
  combatAddOverlay.style.display = 'flex';
  setTimeout(() => combatAddName.focus(), 0);
}

function closeCombatAddOverlay() {
  combatAddOverlay.style.display = 'none';
  combatAddType = null;
}

function confirmAddCombatant() {
  const name = combatAddName.value.trim();
  if (!name) { combatAddName.focus(); return; }
  const slot = getActiveSlot();
  if (!slot) { closeCombatAddOverlay(); return; }
  const maxHp = combatAddType === 'monster' ? Math.max(1, parseInt(combatAddMaxHp.value, 10) || 1) : null;
  slot.combatants.push({ id: ++combatIdCounter, name, type: combatAddType, hp: maxHp, maxHp, tokenPath: null, tokenImg: null, tokenX: null, tokenY: null, tokenSize: 40, status: '' });
  closeCombatAddOverlay();
  rebuildCombatUI();
}

document.getElementById('btn-add-monster').addEventListener('click', () => {
  if (!getActiveSlot()) return;
  openCombatAddOverlay('monster');
});
document.getElementById('btn-add-player').addEventListener('click', () => {
  if (!getActiveSlot()) return;
  openCombatAddOverlay('player');
});
document.getElementById('combat-add-confirm').addEventListener('click', confirmAddCombatant);
document.getElementById('combat-add-cancel').addEventListener('click', closeCombatAddOverlay);
combatAddName.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmAddCombatant();
  if (e.key === 'Escape') closeCombatAddOverlay();
});
combatAddMaxHp.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmAddCombatant();
  if (e.key === 'Escape') closeCombatAddOverlay();
});

// ===== Session Speichern / Laden =====
async function saveSession() {
  const activeIndex = deck.findIndex(s => s.id === activeSlotId);
  const slots = await Promise.all(deck.map(slot => {
    return new Promise(resolve => {
      resolve({
        filePath: slot.filePath,
        name: slot.name,
        isVideo: slot.isVideo,
        volume: slot.volume ?? 50,
        musicVideoId: slot.musicVideoId ?? null,
        musicTitle: slot.musicTitle ?? null,
        fogDataUrl: slot.fogCanvas.toDataURL('image/png'),
        fogWidth: slot.fogCanvas.width,
        fogHeight: slot.fogCanvas.height,
        gridSize: slot.gridSize ?? null,
        gridOffsetX: slot.gridOffsetX ?? 0,
        gridOffsetY: slot.gridOffsetY ?? 0,
        gridVisible: slot.gridVisible ?? false,
        gridOpacity: slot.gridOpacity ?? 15,
        combatants: slot.combatants.map(c => ({
          id: c.id, name: c.name, type: c.type, hp: c.hp, maxHp: c.maxHp,
          tokenPath: c.tokenPath ?? null,
          tokenX: c.tokenX ?? null,
          tokenY: c.tokenY ?? null,
          tokenSize: c.tokenSize ?? 40,
          status: c.status ?? '',
          globalPlayerId: c.globalPlayerId ?? null,
        })),
        pins: (slot.pins ?? []).map(p => ({ ...p })),
      });
    });
  }));

  const data = {
    version: 2,
    savedAt: new Date().toISOString(),
    activeSlotIndex: activeIndex,
    globalPlayers: globalPlayers.map(gp => ({ id: gp.id, name: gp.name, tokenPath: gp.tokenPath ?? null, uuid: gp.uuid ?? null })),
    deck: slots,
  };
  const result = await window.electronAPI.saveSession(data);
  if (result?.success) {
    statusText.textContent = t('session.saved');
    setTimeout(() => { statusText.textContent = getActiveSlot()?.name ?? t('status.no_image'); }, 2000);
  }
}

function clearDeck() {
  deck.forEach(slot => { if (slot.isVideo) slot.video.pause(); });
  deck.length = 0;
  activeSlotId = null;
  slotIdCounter = 0;
  stopVideoLoop();
  ctxImage.clearRect(0, 0, canvasImage.width, canvasImage.height);
  ctxGrid.clearRect(0, 0, canvasGrid.width, canvasGrid.height);
  ctxFog.clearRect(0, 0, canvasFog.width, canvasFog.height);
  dropZone.style.display = 'flex';
  statusText.textContent = t('status.no_image');
  window.electronAPI.sendMusicStop();
  updateMusicNowPlaying();
  rebuildDeckUI();
  rebuildCombatUI();
}

function restoreFog(slot, fogDataUrl, fogWidth, fogHeight) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      slot.fogCtx.clearRect(0, 0, slot.fogCanvas.width, slot.fogCanvas.height);
      slot.fogCtx.drawImage(img, 0, 0);
      resolve();
    };
    img.onerror = () => resolve();
    img.src = fogDataUrl;
  });
}

function addSessionSlot(savedSlot, onReady) {
  const { filePath, name, isVideo, volume, musicVideoId, musicTitle, fogDataUrl, fogWidth, fogHeight, combatants } = savedSlot;
  const src = `file:///${filePath.replace(/\\/g, '/')}`;

  function finalize(slot) {
    slot.musicVideoId = musicVideoId;
    slot.musicTitle = musicTitle;
    slot.volume = volume;
    slot.gridSize = savedSlot.gridSize ?? null;
    slot.gridOffsetX = savedSlot.gridOffsetX ?? 0;
    slot.gridOffsetY = savedSlot.gridOffsetY ?? 0;
    slot.gridVisible = savedSlot.gridVisible ?? false;
    slot.gridOpacity = savedSlot.gridOpacity ?? 15;
    slot.combatants = (combatants ?? []).map(c => ({
      ...c,
      tokenImg: null,
      tokenSize: c.tokenSize ?? 40,
      status: c.status ?? '',
    }));
    slot.pins = (savedSlot.pins ?? []);
    if (slot.combatants.length > 0) {
      const maxId = Math.max(...slot.combatants.map(c => c.id ?? 0));
      if (maxId >= combatIdCounter) combatIdCounter = maxId + 1;
    }
    // Restore token images asynchronously
    for (const c of slot.combatants) {
      if (c.tokenPath) {
        const img = new Image();
        img.src = `file:///${c.tokenPath.replace(/\\/g, '/')}`;
        img.onload = () => { c.tokenImg = img; rebuildCombatUI(); renderAll(slot); };
      }
    }
    restoreFog(slot, fogDataUrl, fogWidth, fogHeight).then(() => {
      rebuildDeckUI();
      onReady(slot);
    });
  }

  if (isVideo) {
    const video = document.createElement('video');
    video.loop = true;
    video.muted = true;
    video.src = src;
    video.addEventListener('loadeddata', () => {
      const { fogCanvas, fogCtx } = makeFog(video.videoWidth || fogWidth, video.videoHeight || fogHeight);
      const slot = { id: ++slotIdCounter, filePath, video, isVideo: true, fogCanvas, fogCtx, name, musicVideoId: null, musicTitle: null, volume, combatants: [], gridSize: null, gridOffsetX: 0, gridOffsetY: 0, gridVisible: false };
      deck.push(slot);
      finalize(slot);
    }, { once: true });
    video.addEventListener('error', () => onReady(null), { once: true });
  } else {
    const img = new Image();
    img.src = src;
    img.onload = () => {
      const { fogCanvas, fogCtx } = makeFog(img.naturalWidth || fogWidth, img.naturalHeight || fogHeight);
      const slot = { id: ++slotIdCounter, filePath, image: img, isVideo: false, fogCanvas, fogCtx, name, musicVideoId: null, musicTitle: null, volume, combatants: [], gridSize: null, gridOffsetX: 0, gridOffsetY: 0, gridVisible: false };
      deck.push(slot);
      finalize(slot);
    };
    img.onerror = () => onReady(null);
  }
}

async function loadSession() {
  const data = await window.electronAPI.loadSession();
  if (!data || !Array.isArray(data.deck) || data.deck.length === 0) return;

  clearDeck();

  // Restore global players
  globalPlayers.length = 0;
  globalPlayerIdCounter = 0;
  if (Array.isArray(data.globalPlayers) && data.globalPlayers.length > 0) {
    for (const saved of data.globalPlayers) {
      const gp = { id: saved.id, name: saved.name, tokenPath: saved.tokenPath ?? null, tokenImg: null, uuid: saved.uuid ?? crypto.randomUUID() };
      globalPlayers.push(gp);
      if (gp.tokenPath) {
        const img = new Image();
        img.src = `file:///${gp.tokenPath.replace(/\\/g, '/')}`;
        img.onload = () => { gp.tokenImg = img; rebuildPlayersUI(); };
      }
    }
    globalPlayerIdCounter = Math.max(...globalPlayers.map(gp => gp.id));
    rebuildPlayersUI();
  }

  let loaded = 0;
  const total = data.deck.length;
  const slotsByIndex = new Array(total).fill(null);

  data.deck.forEach((savedSlot, i) => {
    addSessionSlot(savedSlot, (slot) => {
      slotsByIndex[i] = slot;
      loaded++;
      if (loaded === total) {
        const targetIndex = data.activeSlotIndex ?? 0;
        const targetSlot = slotsByIndex[targetIndex] ?? slotsByIndex.find(s => s !== null);
        if (targetSlot) switchToSlot(targetSlot.id);
      }
    });
  });
}

document.getElementById('btn-save-session').addEventListener('click', saveSession);
document.getElementById('btn-load-session').addEventListener('click', loadSession);

// ===== Ruler Status =====
function updateRulerStatus() {
  const rulerStatusEl = document.getElementById('ruler-status');
  const rulerStatusText = document.getElementById('ruler-status-text');
  const recalibBtn = document.getElementById('btn-recalibrate');
  const isRulerActive = state.tool === 'ruler' || state.tool === 'calibrate';
  rulerStatusEl.style.display = isRulerActive ? 'flex' : 'none';
  if (!isRulerActive) return;
  const slot = getActiveSlot();
  if (slot?.gridSize) {
    rulerStatusText.textContent = `${t('ruler.calibrated')} ${Math.round(slot.gridSize)} ${t('ruler.calibrated.px')}`;
    rulerStatusText.className = 'ruler-status-calibrated';
    recalibBtn.textContent = t('btn.recalibrate2');
  } else {
    rulerStatusText.textContent = t('ruler.uncalibrated');
    rulerStatusText.className = 'ruler-status-uncalibrated';
    recalibBtn.textContent = t('btn.calibrate');
  }
}

document.getElementById('btn-recalibrate').addEventListener('click', startCalibration);

// ===== Calibration =====
function startCalibration() {
  state.prevTool = state.tool === 'calibrate' ? (state.prevTool || 'ruler') : state.tool;
  state.tool = 'calibrate';
  document.querySelectorAll('.btn-tool').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === 'ruler');
  });
  updateRulerStatus();
}

function showCalibrateOverlay(pixelDist) {
  document.getElementById('calibrate-px').textContent = pixelDist;
  document.getElementById('calibrate-fields').value = 10;
  document.getElementById('calibrate-overlay').style.display = 'flex';
  setTimeout(() => document.getElementById('calibrate-fields').focus(), 0);
}

function closeCalibrateOverlay() {
  document.getElementById('calibrate-overlay').style.display = 'none';
  ctxCursor.clearRect(0, 0, canvasCursor.width, canvasCursor.height);
  state.tool = 'ruler';
  document.querySelectorAll('.btn-tool').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === 'ruler');
  });
  updateRulerStatus();
}

document.getElementById('calibrate-confirm').addEventListener('click', () => {
  const slot = getActiveSlot();
  const fields = Math.max(1, parseFloat(document.getElementById('calibrate-fields').value) || 1);
  const pixels = parseFloat(document.getElementById('calibrate-px').textContent);
  if (slot && pixels > 0) {
    slot.gridSize = pixels / fields;
    updateGridPanel();
    renderAll(slot);
    sendGridToPlayer();
  }
  closeCalibrateOverlay();
});

document.getElementById('calibrate-cancel').addEventListener('click', closeCalibrateOverlay);

document.getElementById('calibrate-fields').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('calibrate-confirm').click();
  if (e.key === 'Escape') closeCalibrateOverlay();
});

// ===== Grid Panel =====
function updateGridPanel() {
  const slot = getActiveSlot();
  document.getElementById('grid-visible-cb').checked = slot?.gridVisible ?? false;
  document.getElementById('grid-size-input').value = slot?.gridSize ? Math.round(slot.gridSize) : '';
  document.getElementById('grid-offset-x-input').value = Math.round(slot?.gridOffsetX ?? 0);
  document.getElementById('grid-offset-y-input').value = Math.round(slot?.gridOffsetY ?? 0);
  document.getElementById('grid-opacity-slider').value = slot?.gridOpacity ?? 15;
}

// Grid panel collapse toggle
(function() {
  const header = document.getElementById('grid-header');
  const controls = document.getElementById('grid-controls');
  const btn = document.getElementById('grid-toggle-btn');
  let collapsed = false;
  header.addEventListener('click', () => {
    collapsed = !collapsed;
    controls.classList.toggle('collapsed', collapsed);
    btn.classList.toggle('collapsed', collapsed);
  });
})();

function deactivateGridAlign() {
  if (state.tool === 'grid-align') {
    state.tool = state.prevTool || 'reveal';
  }
  document.getElementById('btn-grid-align').classList.remove('active');
  document.getElementById('btn-grid-align').textContent = t('btn.grid_align');
  canvasImage.style.cursor = '';
}

document.getElementById('grid-visible-cb').addEventListener('change', (e) => {
  const slot = getActiveSlot();
  if (!slot) return;
  slot.gridVisible = e.target.checked;
  renderAll(slot);
  sendGridToPlayer();
});

document.getElementById('grid-size-input').addEventListener('change', (e) => {
  const slot = getActiveSlot();
  if (!slot) return;
  const val = parseFloat(e.target.value);
  slot.gridSize = val > 0 ? val : null;
  if (!val || val <= 0) e.target.value = '';
  updateRulerStatus();
  renderAll(slot);
  sendGridToPlayer();
});

document.getElementById('grid-offset-x-input').addEventListener('change', (e) => {
  const slot = getActiveSlot();
  if (!slot) return;
  slot.gridOffsetX = parseFloat(e.target.value) || 0;
  renderAll(slot);
  sendGridToPlayer();
});

document.getElementById('grid-offset-y-input').addEventListener('change', (e) => {
  const slot = getActiveSlot();
  if (!slot) return;
  slot.gridOffsetY = parseFloat(e.target.value) || 0;
  renderAll(slot);
  sendGridToPlayer();
});

document.getElementById('grid-opacity-slider').addEventListener('input', (e) => {
  const slot = getActiveSlot();
  if (!slot) return;
  slot.gridOpacity = parseInt(e.target.value, 10);
  renderAll(slot);
  sendGridToPlayer();
});

function nudgeGrid(dx, dy) {
  const slot = getActiveSlot();
  if (!slot) return;
  slot.gridOffsetX = (slot.gridOffsetX ?? 0) + dx;
  slot.gridOffsetY = (slot.gridOffsetY ?? 0) + dy;
  updateGridPanel();
  renderAll(slot);
  sendGridToPlayer();
}

document.getElementById('grid-nudge-left').addEventListener('click', () => nudgeGrid(-1, 0));
document.getElementById('grid-nudge-right').addEventListener('click', () => nudgeGrid(1, 0));
document.getElementById('grid-nudge-up').addEventListener('click', () => nudgeGrid(0, -1));
document.getElementById('grid-nudge-down').addEventListener('click', () => nudgeGrid(0, 1));

document.getElementById('btn-calibrate').addEventListener('click', () => {
  startCalibration();
});

document.getElementById('btn-grid-align').addEventListener('click', () => {
  if (state.tool === 'grid-align') {
    deactivateGridAlign();
  } else {
    state.prevTool = state.tool;
    state.tool = 'grid-align';
    document.getElementById('btn-grid-align').classList.add('active');
    document.getElementById('btn-grid-align').textContent = t('btn.grid_align.done');
    canvasImage.style.cursor = 'move';
    document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active'));
    updateRulerStatus();
  }
});

// ===== Global Players =====
const globalPlayers = [];
let globalPlayerIdCounter = 0;

function addGlobalPlayerToSlot(gp, slot) {
  if (slot.combatants.find(c => c.globalPlayerId === gp.id)) return;
  slot.combatants.push({
    id: ++combatIdCounter,
    name: gp.name,
    type: 'player',
    hp: null,
    maxHp: null,
    tokenPath: gp.tokenPath,
    tokenImg: gp.tokenImg,
    tokenX: null,
    tokenY: null,
    tokenSize: 40,
    globalPlayerId: gp.id,
  });
}

function addGlobalPlayer(name) {
  if (!name) return;
  const gp = { id: ++globalPlayerIdCounter, name, tokenPath: null, tokenImg: null, uuid: crypto.randomUUID() };
  globalPlayers.push(gp);
  for (const slot of deck) addGlobalPlayerToSlot(gp, slot);
  rebuildPlayersUI();
  rebuildCombatUI();
}

function removeGlobalPlayer(gpId) {
  const idx = globalPlayers.findIndex(gp => gp.id === gpId);
  if (idx === -1) return;
  globalPlayers.splice(idx, 1);
  for (const slot of deck) {
    const ci = slot.combatants.findIndex(c => c.globalPlayerId === gpId);
    if (ci !== -1) slot.combatants.splice(ci, 1);
  }
  rebuildPlayersUI();
  rebuildCombatUI();
  renderAll();
  sendTokensSync();
}

function updateGlobalPlayerToken(gpId, tokenPath, tokenImg) {
  const gp = globalPlayers.find(p => p.id === gpId);
  if (!gp) return;
  gp.tokenPath = tokenPath;
  gp.tokenImg = tokenImg;
  for (const slot of deck) {
    const c = slot.combatants.find(c => c.globalPlayerId === gpId);
    if (c) { c.tokenPath = tokenPath; c.tokenImg = tokenImg; }
  }
  rebuildPlayersUI();
  rebuildCombatUI();
  renderAll();
  sendTokensSync();
}

async function openGlobalPlayerTokenDialog(gp) {
  const filePaths = await window.electronAPI.openFileDialog();
  if (!filePaths || filePaths.length === 0) return;
  const fp = filePaths.find(f => /\.(jpe?g|png|webp|gif)$/i.test(f));
  if (!fp) return;
  const img = new Image();
  img.src = `file:///${fp.replace(/\\/g, '/')}`;
  img.onload = () => updateGlobalPlayerToken(gp.id, fp, img);
}

function rebuildPlayersUI() {
  const list = document.getElementById('players-list');
  list.innerHTML = '';
  for (const gp of globalPlayers) {
    const item = document.createElement('div');
    item.className = 'player-global-item';

    const tokenSlot = document.createElement('span');
    tokenSlot.className = 'combat-token-slot';
    if (gp.tokenImg) {
      const thumb = document.createElement('img');
      thumb.className = 'combat-token-img';
      thumb.src = `file:///${gp.tokenPath.replace(/\\/g, '/')}`;
      thumb.draggable = false;
      thumb.title = t('player.token.title');
      thumb.addEventListener('click', () => openGlobalPlayerTokenDialog(gp));
      tokenSlot.appendChild(thumb);
    } else {
      const btn = document.createElement('button');
      btn.className = 'combat-token-empty';
      btn.textContent = '🖼';
      btn.title = t('btn.load_token.title');
      btn.addEventListener('click', () => openGlobalPlayerTokenDialog(gp));
      tokenSlot.appendChild(btn);
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'player-global-name';
    nameSpan.textContent = gp.name;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'combat-item-remove';
    removeBtn.textContent = '×';
    removeBtn.title = t('player.remove.title');
    removeBtn.addEventListener('click', () => removeGlobalPlayer(gp.id));

    item.append(tokenSlot, nameSpan);
    const slot = getActiveSlot();
    if (slot && !slot.combatants.find(c => c.globalPlayerId === gp.id)) {
      const readdBtn = document.createElement('button');
      readdBtn.className = 'btn btn-secondary player-readd-btn';
      readdBtn.textContent = '+';
      readdBtn.title = t('player.readd.title');
      readdBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        addGlobalPlayerToSlot(gp, slot);
        rebuildPlayersUI();
        rebuildCombatUI();
        sendTokensSync();
      });
      item.appendChild(readdBtn);
    }
    if (syncMode === 'remote' && currentSessionId && gp.uuid) {
      const linkBtn = document.createElement('button');
      linkBtn.className = 'btn btn-secondary player-link-btn';
      linkBtn.textContent = '🔗';
      linkBtn.title = t('player.copy_link.title');
      linkBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const link = `${tunnelUrl || ''}?session=${currentSessionId}&player=${gp.uuid}`;
        navigator.clipboard.writeText(link)
          .then(() => { linkBtn.textContent = '✓'; setTimeout(() => { linkBtn.textContent = '🔗'; }, 2000); })
          .catch(console.error);
      });
      item.appendChild(linkBtn);
    }
    item.appendChild(removeBtn);
    list.appendChild(item);
  }
}

// Players panel collapse toggle
(function() {
  const header = document.getElementById('players-header');
  const controls = document.getElementById('players-controls');
  const btn = document.getElementById('players-toggle-btn');
  let collapsed = false;
  header.addEventListener('click', (e) => {
    if (e.target !== header && e.target !== btn && e.target.parentElement !== header) return;
    collapsed = !collapsed;
    controls.classList.toggle('collapsed', collapsed);
    btn.classList.toggle('collapsed', collapsed);
  });
})();

// Players add-row toggle
(function() {
  const addRowEl = document.getElementById('players-add-row');
  const inputEl = document.getElementById('players-add-input');
  const confirmBtn = document.getElementById('players-add-confirm');
  const cancelBtn = document.getElementById('players-add-cancel');
  const addBtn = document.getElementById('btn-add-global-player');

  function showAddRow() {
    addBtn.style.display = 'none';
    addRowEl.style.display = 'flex';
    inputEl.value = '';
    setTimeout(() => inputEl.focus(), 0);
  }

  function hideAddRow() {
    addRowEl.style.display = 'none';
    addBtn.style.display = '';
  }

  function confirmAdd() {
    const name = inputEl.value.trim();
    if (name) addGlobalPlayer(name);
    hideAddRow();
  }

  addBtn.addEventListener('click', showAddRow);
  confirmBtn.addEventListener('click', confirmAdd);
  cancelBtn.addEventListener('click', hideAddRow);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmAdd();
    if (e.key === 'Escape') hideAddRow();
  });
})();

// ===== Remote Mode =====

function getPlayerLink(playerUuid) {
  return `${tunnelUrl || ''}?session=${currentSessionId}&player=${playerUuid}`;
}

function getSessionLink() {
  return `${tunnelUrl || ''}?session=${currentSessionId}`;
}

function updateRemotePanel() {
  const inactive = document.getElementById('remote-panel-inactive');
  const active   = document.getElementById('remote-panel-active');
  const codeEl   = document.getElementById('remote-session-code');
  const startBtn = document.getElementById('btn-start-remote');
  const toggle   = document.getElementById('remote-mode-toggle');
  const infoBtn  = document.getElementById('btn-remote-info');

  if (syncMode === 'remote' && currentSessionId) {
    inactive.style.display = 'none';
    active.style.display   = '';
    codeEl.textContent     = currentSessionId;
    rebuildRemotePlayerLinks();
    toggle.checked         = true;
    toggle.disabled        = false;
    infoBtn.style.display  = '';
  } else {
    inactive.style.display = '';
    active.style.display   = 'none';
    startBtn.disabled      = false;
    startBtn.textContent   = t('btn.start_remote');
    toggle.checked         = false;
    toggle.disabled        = false;
    infoBtn.style.display  = 'none';
  }

  rebuildPlayersUI();
}

function rebuildRemotePlayerLinks() {
  const container = document.getElementById('remote-player-links');
  if (!container) return;
  container.innerHTML = '';

  if (!currentSessionId) return;

  if (globalPlayers.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'remote-no-players-hint';
    hint.textContent = t('remote.no_players');
    container.appendChild(hint);
    return;
  }

  for (const gp of globalPlayers) {
    const item = document.createElement('div');
    item.className = 'remote-player-link-item';

    const name = document.createElement('span');
    name.className = 'remote-player-link-name';
    name.textContent = gp.name;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn btn-secondary btn-sm remote-player-link-btn';
    copyBtn.title = t('btn.copy_player_link.title');
    copyBtn.textContent = t('btn.copy_player_link');
    copyBtn.addEventListener('click', () => {
      const link = getPlayerLink(gp.uuid);
      navigator.clipboard.writeText(link)
        .then(() => {
          copyBtn.textContent = t('btn.copy_player_link.done');
          setTimeout(() => { copyBtn.textContent = t('btn.copy_player_link'); }, 2000);
        })
        .catch(console.error);
    });

    item.append(name, copyBtn);
    container.appendChild(item);
  }
}

async function startRemoteSession() {
  const btn = document.getElementById('btn-start-remote');
  btn.disabled    = true;
  btn.textContent = t('btn.start_remote.starting');
  try {
    const result = await window.electronAPI.remoteStart();
    currentSessionId = result.sessionId;
    tunnelUrl        = result.url;
    syncMode         = 'remote';

    // Push current state if a map is loaded
    const slot = getActiveSlot();
    if (slot) {
      if (slot.isVideo) {
        const mediaUrl = await window.electronAPI.remoteRegisterMedia(slot.filePath);
        window.electronAPI.remotePushMap({ sessionId: currentSessionId, videoUrl: mediaUrl, name: slot.name });
      } else {
        const imgData = compressImageForRemote(slot.image);
        if (imgData) window.electronAPI.remotePushMap({ sessionId: currentSessionId, imageData: imgData, name: slot.name });
      }
      sendFullFogUpdate();
      sendGridToPlayer();
      sendTokensSync();
      sendVolume();
    }

    updateRemotePanel();
  } catch (e) {
    console.error('[Remote] Start failed:', e);
    alert(t('remote.start_error') + e.message);
    btn.disabled    = false;
    btn.textContent = t('btn.start_remote');
    updateRemotePanel(); // reset toggle on failure
  }
}

async function endRemoteSession() {
  await window.electronAPI.remoteEnd(currentSessionId);
  syncMode         = 'local';
  currentSessionId = null;
  tunnelUrl        = null;
  updateRemotePanel();
}

const DM_PING_COLOR = '#c9a84c';

function sendDMPing(imgX, imgY) {
  addPingCircle(imgX, imgY, DM_PING_COLOR);
  window.electronAPI.sendPingLocation({ imgX, imgY, color: DM_PING_COLOR });
  if (syncMode === 'remote' && currentSessionId) {
    window.electronAPI.remotePushPing({ sessionId: currentSessionId, imgX, imgY, color: DM_PING_COLOR });
  }
}

// Ping button: DM pings at center of current map view
document.getElementById('btn-ping-players').addEventListener('click', () => {
  const slot = getActiveSlot();
  if (!slot) return;
  const centerImg = screenToImage(canvasImage.width / 2, canvasImage.height / 2);
  sendDMPing(centerImg.x, centerImg.y);
});

// Listen for token moves from remote players (registered once at startup)
window.electronAPI.onRemoteTokenMoved(({ tokenId, tokenX, tokenY }) => {
  if (syncMode !== 'remote') return;
  for (const s of deck) {
    const c = s.combatants.find(x => x.id === tokenId);
    if (c) {
      c.tokenX = tokenX;
      c.tokenY = tokenY;
      if (s.id === activeSlotId) { renderAll(); rebuildCombatUI(); }
      sendTokensSync();
      break;
    }
  }
});

// Remote mode toggle slider
document.getElementById('remote-mode-toggle').addEventListener('change', async (e) => {
  const toggle = e.target;
  if (toggle.checked) {
    toggle.disabled = true;
    await startRemoteSession();
    if (syncMode === 'remote') {
      window.electronAPI.closePlayerWindow();
    }
  } else {
    if (syncMode === 'remote') {
      await endRemoteSession();
      window.electronAPI.reopenPlayerWindow();
    }
    document.getElementById('remote-panel').style.display = 'none';
  }
});

// Info button: open/close connection details panel (only visible in remote mode)
document.getElementById('btn-remote-info').addEventListener('click', () => {
  const panel   = document.getElementById('remote-panel');
  const showing = panel.style.display !== 'none';
  panel.style.display = showing ? 'none' : '';
  if (!showing) updateRemotePanel();
});

document.getElementById('remote-panel-close').addEventListener('click', () => {
  document.getElementById('remote-panel').style.display = 'none';
});

document.getElementById('btn-start-remote').addEventListener('click', async () => {
  await startRemoteSession();
  if (syncMode === 'remote') window.electronAPI.closePlayerWindow();
});

document.getElementById('btn-end-remote').addEventListener('click', async () => {
  if (confirm(t('remote.end.confirm'))) {
    await endRemoteSession();
    window.electronAPI.reopenPlayerWindow();
    document.getElementById('remote-panel').style.display = 'none';
  }
});

document.getElementById('btn-copy-session-link').addEventListener('click', () => {
  if (!currentSessionId) return;
  navigator.clipboard.writeText(getSessionLink())
    .then(() => {
      const btn = document.getElementById('btn-copy-session-link');
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = '📋'; }, 2000);
    })
    .catch(console.error);
});

// ===== i18n + Language Switcher + Help Button =====
(function () {
  const I18N = window.FREETT_I18N;
  if (!I18N) return;

  // Set select to current language
  const sel = document.getElementById('lang-select');
  if (sel) {
    sel.value = I18N.getLang();
    sel.addEventListener('change', () => {
      I18N.setLang(sel.value);
      I18N.applyTranslations();
      // Re-render dynamic UI that can't be reached via data-i18n
      updateVolumeIcon();
      updateRulerStatus();
      rebuildDeckUI();
      rebuildCombatUI();
      rebuildPlayersUI();
      updateRemotePanel();
    });
  }

  // Apply static translations from data-i18n attributes
  I18N.applyTranslations();

  // Help button
  const helpBtn  = document.getElementById('btn-help-dm');
  const helpModal = document.getElementById('help-modal');
  const helpClose = document.getElementById('help-modal-close');
  if (helpBtn && helpModal) {
    helpBtn.addEventListener('click', () => { helpModal.style.display = ''; });
    helpClose.addEventListener('click', () => { helpModal.style.display = 'none'; });
    helpModal.querySelector('.help-modal-backdrop').addEventListener('click', () => { helpModal.style.display = 'none'; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && helpModal.style.display !== 'none') helpModal.style.display = 'none'; });
  }
})();
