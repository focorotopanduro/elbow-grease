import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve } from 'node:path';

const ROOT = resolve(process.cwd(), 'dist');
const PUBLIC_ORIGIN = 'https://www.beitbuilding.com';

const REQUIRED_HTML = [
  'index.html',
  'orlando-roofing.html',
  'winter-park-roofing.html',
  'oviedo-roofing.html',
  'oviedo-storm-damage.html',
];

const REQUIRED_FILES = [
  '.htaccess',
  '.well-known/security.txt',
  'manifest.webmanifest',
  'robots.txt',
  'sitemap.xml',
  'sw.js',
];

const TEXT_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.svg',
  '.txt',
  '.webmanifest',
  '.xml',
  '',
]);

const FILE_BUDGETS = [
  { match: /^assets\/.*\.js$/i, maxBytes: 300 * 1024, label: 'compiled JS chunk' },
  { match: /^assets\/.*\.css$/i, maxBytes: 150 * 1024, label: 'compiled CSS chunk' },
  { match: /^videos\/hero\.mp4$/i, maxBytes: 12 * 1024 * 1024, label: 'hero video' },
  { match: /^.*\.html$/i, maxBytes: 20 * 1024, label: 'HTML entry' },
];

const FORBIDDEN_TEXT = [
  { pattern: /\bStormroof\b/i, label: 'old Stormroof module label' },
  { pattern: /\bBuild Manager\b/i, label: 'old Build Manager module label' },
  { pattern: /\(?\d{3}\)?[\s.-]*555[\s.-]*\d{4}/, label: 'fake 555 phone number' },
  { pattern: /\bLorem ipsum\b/i, label: 'lorem ipsum placeholder copy' },
  { pattern: /\bREPLACE_ME\b|\bYOUR_API_KEY\b|\bYOUR_[A-Z0-9_]+\b/i, label: 'template placeholder token' },
  { pattern: /debugger\s*;/, label: 'debugger statement' },
  { pattern: /sourceMappingURL=/, label: 'source map reference' },
];

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(abs));
    else files.push(abs);
  }
  return files;
}

function rel(abs) {
  return relative(ROOT, abs).replace(/\\/g, '/');
}

function stripHashAndSearch(pathname) {
  return pathname.split('#')[0].split('?')[0];
}

function candidatePaths(pathname) {
  const clean = stripHashAndSearch(pathname);
  if (!clean || clean === '/') return [join(ROOT, 'index.html')];
  const withoutSlash = clean.replace(/^\/+/, '');
  return [
    join(ROOT, withoutSlash),
    join(ROOT, `${withoutSlash}.html`),
    join(ROOT, withoutSlash, 'index.html'),
  ];
}

function hasDistTarget(pathname) {
  return candidatePaths(pathname).some((candidate) => existsSync(candidate));
}

function collectHtmlRefs(html, sourceFile) {
  const refs = [];
  const baseUrl = `${PUBLIC_ORIGIN}/${basename(sourceFile)}`;
  for (const match of html.matchAll(/\s(?:href|src|poster)=["']([^"']+)["']/gi)) {
    const raw = match[1]?.trim();
    if (!raw || raw.startsWith('#')) continue;
    if (/^(tel|mailto|sms|whatsapp|javascript):/i.test(raw)) continue;
    let parsed;
    try {
      parsed = new URL(raw, baseUrl);
    } catch {
      fail(`${rel(sourceFile)} has an invalid URL reference: ${raw}`);
      continue;
    }
    if (parsed.origin !== PUBLIC_ORIGIN) continue;
    refs.push(parsed.pathname);
  }
  return refs;
}

function auditHtml(abs, content) {
  const name = rel(abs);
  if (!/<title>[^<]{8,}<\/title>/i.test(content)) {
    fail(`${name} is missing a useful <title>.`);
  }
  if (!/<meta\s+name=["']description["']\s+content=["'][^"']{40,}["']/i.test(content)) {
    fail(`${name} is missing a useful meta description.`);
  }
  const canonical = content.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1];
  if (!canonical) {
    fail(`${name} is missing a canonical URL.`);
  } else if (!canonical.startsWith(PUBLIC_ORIGIN)) {
    fail(`${name} canonical points outside ${PUBLIC_ORIGIN}: ${canonical}`);
  }

  for (const pathname of collectHtmlRefs(content, abs)) {
    if (!hasDistTarget(pathname)) {
      fail(`${name} references missing same-origin target: ${pathname}`);
    }
  }
}

function auditWebManifest(abs, content) {
  try {
    const manifest = JSON.parse(content);
    for (const icon of manifest.icons ?? []) {
      if (icon?.src && !hasDistTarget(new URL(icon.src, `${PUBLIC_ORIGIN}/manifest.webmanifest`).pathname)) {
        fail(`${rel(abs)} references missing icon: ${icon.src}`);
      }
    }
  } catch (err) {
    fail(`${rel(abs)} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function auditSitemap(abs, content) {
  for (const match of content.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
    let parsed;
    try {
      parsed = new URL(match[1]);
    } catch {
      fail(`${rel(abs)} has invalid <loc>: ${match[1]}`);
      continue;
    }
    if (parsed.origin !== PUBLIC_ORIGIN) {
      fail(`${rel(abs)} has non-canonical origin: ${match[1]}`);
    }
    if (!hasDistTarget(parsed.pathname)) {
      fail(`${rel(abs)} references route without dist target: ${parsed.pathname}`);
    }
  }
}

function auditSecurityTxt(abs, content) {
  if (!/^Contact:\s*mailto:beitbuilding@gmail\.com$/m.test(content)) {
    fail(`${rel(abs)} missing expected Contact.`);
  }
  if (!/^Canonical:\s*https:\/\/www\.beitbuilding\.com\/\.well-known\/security\.txt$/m.test(content)) {
    fail(`${rel(abs)} missing canonical URL.`);
  }
  const expiresRaw = content.match(/^Expires:\s*(.+)$/m)?.[1];
  if (!expiresRaw) {
    fail(`${rel(abs)} missing Expires.`);
    return;
  }
  const expires = Date.parse(expiresRaw);
  if (!Number.isFinite(expires)) {
    fail(`${rel(abs)} has invalid Expires: ${expiresRaw}`);
  } else if (expires <= Date.now()) {
    fail(`${rel(abs)} is expired.`);
  }
}

if (!existsSync(ROOT)) {
  fail('dist/ does not exist. Run npm run build first.');
} else {
  for (const htmlFile of REQUIRED_HTML) {
    if (!existsSync(join(ROOT, htmlFile))) fail(`missing required HTML entry: ${htmlFile}`);
  }
  for (const file of REQUIRED_FILES) {
    if (!existsSync(join(ROOT, file))) fail(`missing required release file: ${file}`);
  }

  const files = walk(ROOT);
  for (const abs of files) {
    const name = rel(abs);
    const stat = statSync(abs);

    if (/\.(bak|psd|map)$/i.test(name)) {
      fail(`source or debug artifact leaked into dist: ${name}`);
    }

    for (const budget of FILE_BUDGETS) {
      if (budget.match.test(name) && stat.size > budget.maxBytes) {
        fail(`${budget.label} exceeds budget: ${name} is ${stat.size} bytes, max ${budget.maxBytes}`);
      }
    }

    if (!TEXT_EXTENSIONS.has(extname(name).toLowerCase())) continue;

    const content = readFileSync(abs, 'utf8');
    for (const forbidden of FORBIDDEN_TEXT) {
      if (forbidden.pattern.test(content)) {
        fail(`${name} contains ${forbidden.label}.`);
      }
    }

    if (extname(name).toLowerCase() === '.html') auditHtml(abs, content);
    if (name === 'manifest.webmanifest') auditWebManifest(abs, content);
    if (name === 'sitemap.xml') auditSitemap(abs, content);
    if (name === '.well-known/security.txt') auditSecurityTxt(abs, content);
    if (name === 'robots.txt' && !/Sitemap:\s*https:\/\/www\.beitbuilding\.com\/sitemap\.xml/i.test(content)) {
      fail('robots.txt is missing the canonical sitemap directive.');
    }
  }

  if (files.length < 20) {
    warn(`dist/ only has ${files.length} files; check whether assets were omitted.`);
  }
}

if (warnings.length) {
  for (const message of warnings) console.warn(`static audit warning: ${message}`);
}

if (failures.length) {
  console.error('static release audit failed:');
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log('static release audit passed.');
