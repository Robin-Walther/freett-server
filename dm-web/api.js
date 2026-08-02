'use strict';

// Browser-native replacement for the old Electron preload.js bridge. Exposes the
// same `window.electronAPI` surface so dm-screen.js's business logic barely changes —
// only the transport (fetch/WebSocket instead of ipcRenderer) is different.
(function () {

const ALLOWED_RE = /\.(jpe?g|png|webp|gif|mp4|webm|ogg|mov)$/i;

// ===== WebSocket to the server's DM relay =====
let ws = null;
let wsReconnectTimer = null;
const listeners = { tokenMoved: null, playerPing: null, pinEvent: null };

function connectWs() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/ws/dm`);

  ws.onmessage = (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    switch (msg.type) {
      case 'token-move':
        listeners.tokenMoved?.({ tokenId: msg.tokenId, tokenX: msg.tokenX, tokenY: msg.tokenY });
        break;
      case 'player-ping':
        listeners.playerPing?.({ playerId: msg.playerId, imgX: msg.imgX, imgY: msg.imgY, color: msg.color });
        break;
      case 'place-pin':
        listeners.pinEvent?.({ action: 'place', pin: msg.pin });
        break;
      case 'remove-pin':
        listeners.pinEvent?.({ action: 'remove', pinId: msg.pinId });
        break;
    }
  };
  ws.onclose = () => {
    ws = null;
    if (wsReconnectTimer) clearTimeout(wsReconnectTimer);
    wsReconnectTimer = setTimeout(connectWs, 2000);
  };
  ws.onerror = () => { try { ws.close(); } catch { /* already closing */ } };
}
connectWs();

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ===== Media upload =====
function uploadFiles(fileList) {
  const files = Array.from(fileList).filter(f => ALLOWED_RE.test(f.name));
  if (files.length === 0) return Promise.resolve([]);
  const form = new FormData();
  for (const f of files) form.append('files', f);
  return fetch('/api/media', { method: 'POST', body: form })
    .then(r => (r.ok ? r.json() : Promise.reject(new Error('upload failed'))));
}

function openFileDialog({ accept = 'image/*,video/*', multiple = true } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    input.addEventListener('change', () => {
      const files = input.files;
      document.body.removeChild(input);
      if (!files || files.length === 0) { resolve(null); return; }
      uploadFiles(files).then(resolve).catch(() => resolve(null));
    }, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

// ===== Background music (YouTube IFrame Player API) =====
// Replaces the Electron hidden-BrowserWindow autoplay-policy bypass: play()/stop()/
// setVolume() are always called from a click handler, which counts as the user
// gesture Chromium's autoplay policy requires. The "Ton aktivieren" button is a
// manual fallback in case a given browser still blocks it.
const Music = (function () {
  let player = null;
  let apiReady = !!(window.YT && window.YT.Player);
  let pendingVideoId = null;
  let pendingVolume = 1;

  function loadApi() {
    if (apiReady || document.getElementById('yt-iframe-api')) return;
    const tag = document.createElement('script');
    tag.id = 'yt-iframe-api';
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => {
      apiReady = true;
      if (pendingVideoId) play(pendingVideoId, pendingVolume);
    };
  }

  function ensurePlayer(videoId, volume) {
    const mount = document.getElementById('music-audio-mount');
    if (!mount) return null;
    const div = document.createElement('div');
    mount.appendChild(div);
    player = new YT.Player(div, {
      height: '1',
      width: '1',
      videoId,
      playerVars: { autoplay: 1, controls: 0, disablekb: 1 },
      events: {
        onReady: (e) => { e.target.setVolume(Math.round(volume * 100)); e.target.playVideo(); },
      },
    });
    return player;
  }

  function showEnableButton() {
    const btn = document.getElementById('btn-enable-audio');
    if (btn) btn.style.display = '';
  }

  function play(videoId, volume) {
    pendingVideoId = videoId;
    pendingVolume = volume;
    loadApi();
    showEnableButton();
    if (!apiReady) return; // onYouTubeIframeAPIReady retries once loaded
    if (!player) { ensurePlayer(videoId, volume); return; }
    player.loadVideoById(videoId);
    player.setVolume(Math.round(volume * 100));
  }

  function stop() {
    pendingVideoId = null;
    if (player) player.stopVideo();
    const btn = document.getElementById('btn-enable-audio');
    if (btn) btn.style.display = 'none';
  }

  function setVolume(volume) {
    if (player) player.setVolume(Math.round(volume * 100));
  }

  function resume() {
    if (player) player.playVideo();
  }

  return { play, stop, setVolume, resume };
})();

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('btn-enable-audio');
  if (btn) btn.addEventListener('click', () => { Music.resume(); btn.style.display = 'none'; });
});
if (document.readyState !== 'loading') {
  const btn = document.getElementById('btn-enable-audio');
  if (btn) btn.addEventListener('click', () => { Music.resume(); btn.style.display = 'none'; });
}

// ===== Public API =====
window.electronAPI = {
  // Media
  openFileDialog,
  uploadFiles,

  // Push state (DM -> players)
  pushMap:    (data) => send({ type: 'map', ...data }),
  pushFog:    (data) => send({ type: 'fog', ...data }),
  pushGrid:   (data) => send({ type: 'grid', ...data }),
  pushTokens: (tokens) => send({ type: 'tokens', tokens }),
  pushView:   (data) => send({ type: 'view', ...data }),
  pushVolume: (data) => send({ type: 'volume', value: data.volume, muted: data.muted }),
  pushPing:   (data) => send({ type: 'ping', ...data }),
  pushPins:      (pins) => send({ type: 'pins', pins }),
  pushPin:       (pin) => send({ type: 'place-pin', pin }),
  pushPinRemove: (pinId) => send({ type: 'remove-pin', pinId }),

  // Listen (players -> DM)
  onRemoteTokenMoved: (cb) => { listeners.tokenMoved = cb; },
  onRemotePlayerPing:  (cb) => { listeners.playerPing = cb; },
  onRemotePinEvent:    (cb) => { listeners.pinEvent = cb; },

  // Session persistence
  saveSession: (data, name) => fetch(`/api/session${name ? `?name=${encodeURIComponent(name)}` : ''}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  }).then(r => r.json()).catch(e => ({ success: false, error: e.message })),
  loadSession: (name) => fetch(`/api/session${name ? `?name=${encodeURIComponent(name)}` : ''}`)
    .then(r => (r.ok ? r.json() : null)).catch(() => null),
  listSessions: () => fetch('/api/sessions').then(r => r.json()).catch(() => []),

  // YouTube search (server-side proxy)
  youtubeSearch: (query) => fetch(`/api/youtube-search?q=${encodeURIComponent(query)}`)
    .then(r => r.json()).catch(() => []),

  // Music
  musicPlay:      (videoId, volume) => Music.play(videoId, volume),
  musicStop:      () => Music.stop(),
  musicSetVolume: (volume) => Music.setVolume(volume),

  // Table (join code) + auth
  getTable:        () => fetch('/api/table').then(r => r.json()).catch(() => null),
  regenerateTable: () => fetch('/api/table/regenerate', { method: 'POST' }).then(r => r.json()),
  logout:          () => fetch('/api/logout', { method: 'POST' }).then(() => { location.href = '/login.html'; }),
};

})();
