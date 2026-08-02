'use strict';

const https = require('https');
const express = require('express');
const { requireDmAuth } = require('../auth');

const router = express.Router();

// YouTube's internal "innertube" search API. Needs YOUTUBE_INNERTUBE_KEY set to
// YouTube's own public web-client key (see README.md) — not a private credential
// of this project, just kept out of source so it doesn't read as a hardcoded secret.
function youtubeSearch(query) {
  const apiKey = process.env.YOUTUBE_INNERTUBE_KEY;
  if (!apiKey) return Promise.reject(new Error('YOUTUBE_INNERTUBE_KEY is not set'));

  const body = JSON.stringify({
    context: { client: { clientName: 'WEB', clientVersion: '2.20210721.00.00' } },
    query,
  });
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.youtube.com',
      path: `/youtubei/v1/search?key=${encodeURIComponent(apiKey)}`,
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
