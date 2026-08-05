'use strict';

const https = require('https');
const express = require('express');
const { requireDmAuth } = require('../auth');

const router = express.Router();

// YouTube's internal "innertube" search API — no API key needed beyond the public
// web-client key below. This is YouTube's own public key, embedded in every
// youtube.com page load; it is not a private credential of this project (see
// README.md). Ported as-is from the original Electron main process.
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

router.get('/api/youtube-search', requireDmAuth, async (req, res) => {
  try {
    res.json(await youtubeSearch(String(req.query.q || '')));
  } catch (e) {
    console.error('YouTube search error:', e.message);
    res.json([]);
  }
});

module.exports = router;
