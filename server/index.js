'use strict';

const express = require('express');
const http = require('http');
const path = require('path');

const { requireDmAuth } = require('./auth');
const { attachWebSocketServer } = require('./ws');
const { table } = require('./state');

const authRoutes = require('./routes/auth');
const mediaRoutes = require('./routes/media');
const sessionRoutes = require('./routes/sessions');
const youtubeRoutes = require('./routes/youtube');
const tableRoutes = require('./routes/table');

const PORT = parseInt(process.env.PORT, 10) || 3456;

if (!process.env.DM_PASSWORD) {
  console.error('DM_PASSWORD is not set. Set it as an environment variable before starting the server (see README.md).');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // so req.secure reflects nginx's X-Forwarded-Proto

const DM_WEB = path.join(__dirname, '..', 'dm-web');
const PLAYER_WEB = path.join(__dirname, '..', 'player-web');

// --- Public routes ---
app.get('/login.html', (req, res) => res.sendFile(path.join(DM_WEB, 'login.html')));
app.use(authRoutes);   // /api/login, /api/logout, /api/me
app.use(mediaRoutes);  // GET /media/:token is public; POST /api/media guards itself
app.use('/play', express.static(PLAYER_WEB, { index: 'index.html' }));

// --- DM-only routes ---
app.use(sessionRoutes); // guards itself
app.use(youtubeRoutes); // guards itself
app.use(tableRoutes);   // guards itself
app.use('/', requireDmAuth, express.static(DM_WEB, { index: 'dm-screen.html' }));

const server = http.createServer(app);
attachWebSocketServer(server);

server.listen(PORT, () => {
  console.log(`FreeTT Server listening on :${PORT}`);
  console.log(`Table join code: ${table.sessionCode}`);
});
