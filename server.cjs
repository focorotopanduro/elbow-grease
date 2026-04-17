/**
 * ELBOW GREASE — Standalone server
 * Serves the built app and opens the browser automatically.
 * This file gets compiled into a single .exe via pkg.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 5173;

// MIME types
const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff': 'font/woff',
  '.woff2':'font/woff2',
  '.wasm': 'application/wasm',
};

// Resolve dist directory (works both in dev and pkg snapshot)
let distDir;
if (process.pkg) {
  // Running as compiled exe — assets are in snapshot
  distDir = path.join(path.dirname(process.execPath), 'dist');
} else {
  distDir = path.join(__dirname, 'dist');
}

// Verify dist exists
if (!fs.existsSync(distDir)) {
  console.error('ERROR: dist/ folder not found at', distDir);
  console.error('Run "npx vite build" first.');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  let url = req.url || '/';

  // Strip query strings
  url = url.split('?')[0];

  // Default to index.html
  if (url === '/') url = '/index.html';

  const filePath = path.join(distDir, url);

  // Security: prevent directory traversal
  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback: serve index.html for any missing route
      fs.readFile(path.join(distDir, 'index.html'), (err2, indexData) => {
        if (err2) {
          res.writeHead(404);
          res.end('Not Found');
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(indexData);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';

    // Cache static assets aggressively
    const cacheControl = ext === '.html'
      ? 'no-cache'
      : 'public, max-age=31536000, immutable';

    res.writeHead(200, {
      'Content-Type': mime,
      'Cache-Control': cacheControl,
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log('');
  console.log('  ===================================================');
  console.log('       ELBOW GREASE — Plumbing CAD v0.1.0');
  console.log('       "Plum-in\', the Estimator App for Your Business"');
  console.log('  ===================================================');
  console.log('');
  console.log(`  Running at: ${url}`);
  console.log('  Close this window to stop.');
  console.log('');

  // Open browser (Edge on Windows)
  if (process.platform === 'win32') {
    exec(`start msedge ${url}`, (err) => {
      if (err) exec(`start ${url}`); // fallback to default browser
    });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Close other instances first.`);
    process.exit(1);
  }
  console.error('Server error:', err);
});
