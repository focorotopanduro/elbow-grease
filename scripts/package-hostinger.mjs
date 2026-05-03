#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const RELEASE_DIR = resolve(ROOT, 'release');
const PACKAGE_DIR = resolve(RELEASE_DIR, 'hostinger-upload');
const ZIP_PATH = resolve(RELEASE_DIR, 'beitbuilding-hostinger-upload.zip');
const README_PATH = resolve(RELEASE_DIR, 'HOSTINGER_UPLOAD_README.txt');
const MANIFEST_PATH = resolve(RELEASE_DIR, 'RELEASE_MANIFEST.json');

const PUBLIC_ROUTES = [
  '/',
  '/orlando-roofing',
  '/winter-park-roofing',
  '/oviedo-roofing',
  '/oviedo-storm-damage',
  '/privacy.html',
  '/terms.html',
  '/accessibility.html',
];

function assertInsideRoot(path) {
  const normalizedRoot = `${ROOT.toLowerCase()}\\`;
  const normalizedPath = path.toLowerCase();
  if (normalizedPath !== ROOT.toLowerCase() && !normalizedPath.startsWith(normalizedRoot)) {
    throw new Error(`Refusing to operate outside project root: ${path}`);
  }
}

function psQuote(path) {
  return `'${path.replace(/'/g, "''")}'`;
}

if (!existsSync(DIST)) {
  console.error('dist/ is missing. Run npm.cmd run build first.');
  process.exit(1);
}

assertInsideRoot(RELEASE_DIR);
assertInsideRoot(PACKAGE_DIR);
assertInsideRoot(ZIP_PATH);
assertInsideRoot(README_PATH);
assertInsideRoot(MANIFEST_PATH);

mkdirSync(RELEASE_DIR, { recursive: true });
if (existsSync(PACKAGE_DIR)) rmSync(PACKAGE_DIR, { recursive: true, force: true });
if (existsSync(ZIP_PATH)) rmSync(ZIP_PATH, { force: true });

cpSync(DIST, PACKAGE_DIR, { recursive: true, force: true });

writeFileSync(
  README_PATH,
  [
    'Beit Building Contractors Hostinger upload package',
    '',
    'Upload the CONTENTS of release/hostinger-upload/ into the domain public_html/ folder.',
    'Do not upload the wrapper folder itself unless you want /hostinger-upload/ in the URL.',
    '',
    'Required files at public_html root after upload:',
    '- index.html',
    '- .htaccess',
    '- assets/',
    '- videos/',
    '- robots.txt',
    '- sitemap.xml',
    '',
    'After upload, test:',
    '- https://beitbuilding.com/',
    '- https://beitbuilding.com/orlando-roofing',
    '- https://beitbuilding.com/winter-park-roofing',
    '- https://beitbuilding.com/oviedo-roofing',
    '- https://beitbuilding.com/oviedo-storm-damage',
    '- the contact form fallback path',
    '',
  ].join('\n'),
  'utf8',
);

let zipped = false;
try {
  if (process.platform === 'win32') {
    const command = [
      `$items = Get-ChildItem -Force -LiteralPath ${psQuote(PACKAGE_DIR)};`,
      `Compress-Archive -Path $items.FullName -DestinationPath ${psQuote(ZIP_PATH)} -Force;`,
    ].join(' ');
    execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      stdio: 'pipe',
    });
    zipped = true;
  } else {
    execFileSync('zip', ['-qr', ZIP_PATH, '.'], {
      cwd: PACKAGE_DIR,
      stdio: 'pipe',
    });
    zipped = true;
  }
} catch (error) {
  console.warn('hostinger package: zip creation skipped.');
  console.warn(error instanceof Error ? error.message : String(error));
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function rel(path) {
  return relative(PACKAGE_DIR, path).replace(/\\/g, '/');
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const files = walk(PACKAGE_DIR)
  .map((path) => ({
    path: rel(path),
    bytes: statSync(path).size,
    sha256: sha256(path),
  }))
  .sort((a, b) => a.path.localeCompare(b.path));

const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
const manifest = {
  generatedAt: new Date().toISOString(),
  site: 'Beit Building Contractors LLC',
  targetHost: 'Hostinger public_html static upload',
  uploadDirectory: PACKAGE_DIR,
  zipPath: zipped ? ZIP_PATH : null,
  zipSha256: zipped && existsSync(ZIP_PATH) ? sha256(ZIP_PATH) : null,
  fileCount: files.length,
  totalBytes,
  publicRoutes: PUBLIC_ROUTES,
  requiredRootFiles: [
    '.htaccess',
    'index.html',
    'assets/',
    'videos/',
    'robots.txt',
    'sitemap.xml',
    'sw.js',
    'manifest.webmanifest',
  ],
  largestFiles: [...files].sort((a, b) => b.bytes - a.bytes).slice(0, 8),
  files,
};

writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`hostinger package ready: ${PACKAGE_DIR}`);
console.log(`hostinger instructions: ${README_PATH}`);
console.log(`hostinger manifest: ${MANIFEST_PATH}`);
if (zipped) console.log(`hostinger zip ready: ${ZIP_PATH}`);
