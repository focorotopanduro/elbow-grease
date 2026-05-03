#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const PUBLIC = resolve(ROOT, 'public');
const MAX_DIST_BYTES = 45 * 1024 * 1024;

const requiredDistFiles = [
  '.htaccess',
  'index.html',
  'orlando-roofing.html',
  'winter-park-roofing.html',
  'oviedo-roofing.html',
  'oviedo-storm-damage.html',
  'privacy.html',
  'terms.html',
  'accessibility.html',
  'robots.txt',
  'sitemap.xml',
  'sw.js',
  'manifest.webmanifest',
  '.well-known/security.txt',
  'logo-mark.png',
  'logo-mark.webp',
  'logo-mark@1x.png',
  'logo-mark@2x.png',
  'videos/hero.mp4',
];

const requiredRoutes = [
  'https://www.beitbuilding.com/',
  'https://www.beitbuilding.com/orlando-roofing',
  'https://www.beitbuilding.com/winter-park-roofing',
  'https://www.beitbuilding.com/oviedo-roofing',
  'https://www.beitbuilding.com/oviedo-storm-damage',
];

const forbiddenPublicPattern = /\.(?:bak|psd|ai|sketch|fig|zip|rar|7z)$/i;
const forbiddenDistPattern = /\.(?:bak|psd|ai|sketch|fig|zip|rar|7z|map)$/i;

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function rel(base, path) {
  return relative(base, path).replace(/\\/g, '/');
}

function fileText(path) {
  return readFileSync(path, 'utf8');
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

if (!existsSync(DIST)) {
  fail('dist/ is missing. Run npm.cmd run build first.');
} else {
  for (const file of requiredDistFiles) {
    if (!existsSync(resolve(DIST, file))) fail(`dist/${file} is missing.`);
  }

  const distFiles = walk(DIST);
  const distBytes = distFiles.reduce((sum, file) => sum + statSync(file).size, 0);
  if (distBytes > MAX_DIST_BYTES) {
    fail(`dist/ is ${formatBytes(distBytes)}, above the ${formatBytes(MAX_DIST_BYTES)} release budget.`);
  }

  const forbiddenDist = distFiles
    .map((file) => rel(DIST, file))
    .filter((file) =>
      forbiddenDistPattern.test(file) ||
      /(?:^|\/)(?:README\.md|\.gitkeep)$/i.test(file)
    );
  if (forbiddenDist.length) {
    fail(`dist/ contains non-public source artifacts: ${forbiddenDist.join(', ')}`);
  }

  const unexpectedHtml = ['blog.html', 'hurricane-uplift.html']
    .filter((file) => existsSync(resolve(DIST, file)));
  if (unexpectedHtml.length) {
    fail(`dist/ contains deferred pages: ${unexpectedHtml.join(', ')}`);
  }

  const htaccessPath = resolve(DIST, '.htaccess');
  if (existsSync(htaccessPath)) {
    const htaccess = fileText(htaccessPath);
    if (!/RewriteRule\s+\^api\/\s+-\s+\[R=404,L\]/.test(htaccess)) {
      fail('.htaccess must return a real 404 for /api/* on static Hostinger hosting.');
    }
    if (!/RewriteCond\s+%\{REQUEST_FILENAME\}\.html\s+-f/.test(htaccess)) {
      fail('.htaccess is missing clean URL .html resolution.');
    }
    if (!htaccess.includes('https://api.web3forms.com')) {
      fail('.htaccess CSP must allow Web3Forms for static Hostinger lead fallback.');
    }
    for (const requiredHeader of [
      'Strict-Transport-Security',
      'X-Content-Type-Options',
      'X-Frame-Options',
      'X-XSS-Protection',
      'X-Permitted-Cross-Domain-Policies',
      'Referrer-Policy',
      'Permissions-Policy',
      'Cross-Origin-Opener-Policy',
      'Cross-Origin-Resource-Policy',
      'Content-Security-Policy',
    ]) {
      if (!htaccess.includes(requiredHeader)) fail(`.htaccess missing ${requiredHeader}.`);
    }
  }

  const sitemapPath = resolve(DIST, 'sitemap.xml');
  if (existsSync(sitemapPath)) {
    const sitemap = fileText(sitemapPath);
    for (const route of requiredRoutes) {
      if (!sitemap.includes(`<loc>${route}</loc>`)) fail(`sitemap.xml missing ${route}`);
    }
    if (/blog|hurricane-uplift/i.test(sitemap)) {
      fail('sitemap.xml contains deferred blog or hurricane-uplift routes.');
    }
  }

  const robotsPath = resolve(DIST, 'robots.txt');
  if (existsSync(robotsPath)) {
    const robots = fileText(robotsPath);
    if (!/^Disallow:\s*\/api\/$/m.test(robots)) warn('robots.txt does not explicitly disallow /api/.');
    if (!/^Sitemap:\s*https:\/\/www\.beitbuilding\.com\/sitemap\.xml$/m.test(robots)) {
      fail('robots.txt has the wrong sitemap URL.');
    }
  }

  const htmlFiles = distFiles.filter((file) => extname(file).toLowerCase() === '.html');
  for (const file of htmlFiles) {
    const text = fileText(file);
    if (/localhost|127\.0\.0\.1/i.test(text)) fail(`${rel(DIST, file)} contains a local URL.`);
  }

  const largest = distFiles
    .map((file) => ({ file: rel(DIST, file), size: statSync(file).size }))
    .sort((a, b) => b.size - a.size)
    .slice(0, 5);
  console.log(`release check: dist size ${formatBytes(distBytes)} across ${distFiles.length} files.`);
  console.log('release check: largest files:');
  for (const item of largest) console.log(`  - ${item.file}: ${formatBytes(item.size)}`);
}

if (existsSync(PUBLIC)) {
  const forbiddenPublic = walk(PUBLIC)
    .map((file) => rel(PUBLIC, file))
    .filter((file) => forbiddenPublicPattern.test(file));
  if (forbiddenPublic.length) {
    fail(`public/ contains source artifacts that would be copied to dist/: ${forbiddenPublic.join(', ')}`);
  }
}

for (const message of warnings) console.warn(`warning: ${message}`);
if (failures.length) {
  console.error('release check failed:');
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log('release check passed.');
