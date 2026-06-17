const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // DM: open native file dialog
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),

  // DM -> Main: image was loaded
  sendImageLoaded: (filePath) => ipcRenderer.send('image-loaded', filePath),

  // DM -> Main: fog of war update
  sendFogUpdate: (fogData) => ipcRenderer.send('fog-update', fogData),

  // DM -> Main: full fog reset
  sendFogReset: (data) => ipcRenderer.send('fog-reset', data),

  // Player: listen for image loaded event
  onImageLoaded: (callback) => ipcRenderer.on('image-loaded', (_, filePath) => callback(filePath)),

  // Player: listen for fog updates
  onFogUpdate: (callback) => ipcRenderer.on('fog-update', (_, fogData) => callback(fogData)),

  // Player: listen for fog reset
  onFogReset: (callback) => ipcRenderer.on('fog-reset', (_, data) => callback(data)),

  // DM -> Main: volume/mute change
  sendVolumeChange: (data) => ipcRenderer.send('volume-change', data),

  // Player: listen for volume/mute changes from DM
  onVolumeChange: (callback) => ipcRenderer.on('volume-change', (_, data) => callback(data)),

  // Player -> Main: video is ready and playing
  sendVideoReady: () => ipcRenderer.send('video-ready'),

  // DM: listen for video-ready signal from player
  onVideoReady: (callback) => ipcRenderer.on('video-ready', (_, data) => callback(data)),

  // Player: toggle native window fullscreen
  toggleFullscreen: () => ipcRenderer.invoke('toggle-player-fullscreen'),

  // DM -> Main: music commands
  sendMusicPlay: (data) => ipcRenderer.send('music-play', data),
  sendMusicStop: () => ipcRenderer.send('music-stop'),
  sendMusicVolume: (data) => ipcRenderer.send('music-volume', data),

  // DM: search YouTube (runs in main process via Node.js https)
  youtubeSearch: (query) => ipcRenderer.invoke('youtube-search', query),

  // DM: save session to file
  saveSession: (data) => ipcRenderer.invoke('save-session', data),

  // DM: load session from file
  loadSession: () => ipcRenderer.invoke('load-session'),

  // DM -> Main: sync placed tokens to player
  sendTokensSync: (tokens) => ipcRenderer.send('tokens-sync', tokens),

  // Player: listen for token sync
  onTokensSync: (callback) => ipcRenderer.on('tokens-sync', (_, tokens) => callback(tokens)),

  // DM -> Main: grid state update
  sendGridUpdate: (data) => ipcRenderer.send('grid-update', data),

  // Player: listen for grid state updates
  onGridUpdate: (callback) => ipcRenderer.on('grid-update', (_, data) => callback(data)),

  // DM: close/reopen local player window when toggling remote mode
  closePlayerWindow:  () => ipcRenderer.send('close-player-window'),
  reopenPlayerWindow: () => ipcRenderer.send('reopen-player-window'),

  // DM: listen for the reopened local player window finishing its initial load
  onPlayerWindowReady: (callback) => ipcRenderer.on('player-window-ready', () => callback()),

  // Remote mode
  remoteStart: () => ipcRenderer.invoke('remote-start'),
  remoteEnd: (sessionId) => ipcRenderer.invoke('remote-end', sessionId),
  remoteRegisterMedia: (filePath) => ipcRenderer.invoke('remote-register-media', filePath),
  remotePushMap: (data) => ipcRenderer.send('remote-push-map', data),
  remotePushFog: (data) => ipcRenderer.send('remote-push-fog', data),
  remotePushGrid: (data) => ipcRenderer.send('remote-push-grid', data),
  remotePushTokens: (data) => ipcRenderer.send('remote-push-tokens', data),
  remotePushVolume: (data) => ipcRenderer.send('remote-push-volume', data),
  onRemoteTokenMoved: (callback) => ipcRenderer.on('remote-token-moved', (_, data) => callback(data)),

  // DM: send a located ping (imgX, imgY, color) to local player window
  sendPingLocation: (data) => ipcRenderer.send('ping-location', data),

  // Player (local): listen for located ping from DM
  onPingLocation: (callback) => ipcRenderer.on('ping-location', (_, data) => callback(data)),

  // DM: push located ping to remote players via WebSocket
  remotePushPing: (data) => ipcRenderer.send('remote-push-ping', data),

  // DM: listen for player-ping events from remote players
  onRemotePlayerPing: (callback) => ipcRenderer.on('remote-player-ping', (_, data) => callback(data)),

  // DM: push a pin removal to remote players
  remotePushPinRemove: (data) => ipcRenderer.send('remote-push-pin-remove', data),

  // DM: listen for pin place/remove events from remote players
  onRemotePinEvent: (callback) => ipcRenderer.on('remote-pin-event', (_, data) => callback(data)),

  // DM -> Main: sync view (zoom + pan) to local player
  sendViewSync: (data) => ipcRenderer.send('view-sync', data),

  // Player (local): listen for view sync from DM
  onViewSync: (callback) => ipcRenderer.on('view-sync', (_, data) => callback(data)),

});
