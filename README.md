# FreeTT Server

**FreeTT Server** is a self-hosted, browser-based Virtual Tabletop (VTT) for DnD. It is a server fork of [FreeTT](https://github.com/Robin-Walther/FreeTT) (the Electron desktop app): instead of two desktop windows synced over Electron IPC, a single Node process serves both the DM screen and the player screen as regular web pages, kept in sync over WebSocket. Run it on your own server (e.g. an Ubuntu box) and everyone — DM included — just opens a browser tab.

This is a v1, single-DM build: one running server process = one table/campaign. No multi-tenant accounts.

---

## Features

Same feature set as FreeTT desktop: Fog of War, token management with drag/resize, initiative/combat tracker, ruler tool, map pins, ping system, YouTube-backed background music, multi-language UI (DE/EN/FR/IT). Maps and tokens are uploaded through the browser and stored on the server instead of being referenced by a local file path.

---

## Requirements

- Node.js 18+
- A `DM_PASSWORD` — the only credential; there is no user/account system

---

## Running locally

```bash
npm install
DM_PASSWORD=changeme npm start
```

(PowerShell: `$env:DM_PASSWORD="changeme"; npm start`)

Then open `http://localhost:3456`, log in with the password, and start playing. The console prints the current player join code on startup; the DM screen's 🔗 panel shows shareable player links (`http://<host>/play/?session=<code>&player=<uuid>`).

Environment variables:

| Variable                | Required | Default | Purpose                                                    |
|--------------------------|----------|---------|-------------------------------------------------------------|
| `DM_PASSWORD`             | yes      | —       | Password to log in as DM                                    |
| `PORT`                    | no       | `3456`  | HTTP/WebSocket port                                          |
| `YOUTUBE_INNERTUBE_KEY`   | no       | —       | Enables the in-app YouTube music search. Without it, search returns no results (everything else still works). This is **not a private credential** — it's YouTube's own public web-client key, the same one `youtube.com` embeds in every page load (view-source on any YouTube page and search for `INNERTUBE_API_KEY` to find the current value). Deliberately not hardcoded or pasted here so it doesn't read as a leaked secret to scanners. |

---

## Deploying on Ubuntu

1. Copy the repo to the server (e.g. `/opt/freett-server`), then `npm install --omit=dev`.
2. Create `/etc/freett-server/env`:
   ```
   DM_PASSWORD=<a long random string>
   PORT=3456
   YOUTUBE_INNERTUBE_KEY=<optional, see below>
   ```
3. Create a systemd unit `/etc/systemd/system/freett-server.service`:
   ```ini
   [Unit]
   Description=FreeTT Server
   After=network.target

   [Service]
   Type=simple
   WorkingDirectory=/opt/freett-server
   EnvironmentFile=/etc/freett-server/env
   ExecStart=/usr/bin/node server/index.js
   Restart=on-failure
   User=freett

   [Install]
   WantedBy=multi-user.target
   ```
   Then `systemctl enable --now freett-server`.
4. Put nginx in front for TLS (Let's Encrypt/certbot) and make sure WebSocket upgrades are proxied:
   ```nginx
   location / {
       proxy_pass http://127.0.0.1:3456;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection "upgrade";
       proxy_set_header Host $host;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```
   This is required — the browser upgrades to `wss://` automatically once the page is served over HTTPS.
5. `data/uploads/` and `data/sessions/` hold uploaded media and saved campaigns; keep them on persistent storage and back them up. There's no cleanup/quota logic yet, so uploaded media accumulates — clear `data/uploads/` manually if disk space gets tight (this will break any saved session that still references those files).

---

## Known limitations (v1)

- **Single DM / single table** — no multi-tenant accounts. A second login with the same password takes over the same live table.
- **No player authentication** — anyone with the join link/code can connect and control any unclaimed token, same model as the original app's remote mode.
- **Background music autoplay** relies on the browser's own autoplay policy (a user click starts it, same as any web app). If a browser blocks it anyway, a "🔊 Enable Audio" button appears as a manual fallback.
- **No upload cleanup** — deleting `data/uploads/` breaks any saved session still referencing those files.

---

## Project structure

```
freett-server/
├── server/            # Node/Express backend: auth, WebSocket relay, media upload, session persistence
├── dm-web/             # DM browser client (adapted from the desktop app's dm-screen.js)
├── player-web/         # Player browser client (shared with the desktop app's remote mode)
└── data/               # uploads/ + sessions/ (gitignored, created at runtime)
```

---

## License

MIT — free to use, modify, and distribute.
