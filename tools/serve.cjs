#!/usr/bin/env node
/* =====================================================================
   A tiny static file server, so the site can be opened over http:// instead
   of file:// (Supabase auth, invitation links and the service worker all need
   a real origin; file:// blocks them).

     node tools/serve.cjs            # http://localhost:5173
     node tools/serve.cjs 8080       # pick the port yourself

   It serves the project folder only, refuses to climb out of it, and never
   caches, so editing a file and refreshing always shows the new version.
   ===================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.argv[2] || process.env.PORT || 5173);
// host — 2nd argument (or HOST env). Defaults to 127.0.0.1 (localhost only);
// pass 0.0.0.0 to also serve the home network, e.g. for previewing on a phone:
//   node tools/serve.cjs 5173 0.0.0.0
const host = String(process.argv[3] || process.env.HOST || '127.0.0.1');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(root, path.normalize(rel).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(root)) { res.writeHead(403).end('Forbidden'); return; }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Service-Worker-Allowed': '/'
    });
    res.end(buf);
  });
});

server.listen(port, () => {
  const shown = host === '0.0.0.0' ? 'localhost (and your LAN IP)' : host;
  console.log('Family Tree served at http://' + shown + ':' + port + '/');
  console.log('(Ctrl+C to stop)');
});
