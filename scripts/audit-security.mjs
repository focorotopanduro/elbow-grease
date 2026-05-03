import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const HTACCESS = resolve(ROOT, 'public', '.htaccess');
const VERCEL = resolve(ROOT, 'vercel.json');
const SERVER_SECURITY = resolve(ROOT, 'api', '_lib', 'security.ts');
const LEADS = resolve(ROOT, 'api', 'leads.ts');
const EVENTS = resolve(ROOT, 'api', 'events.ts');
const SECURITY_TXT = resolve(ROOT, 'public', '.well-known', 'security.txt');

const REQUIRED_HEADERS = new Map([
  ['Strict-Transport-Security', /max-age=63072000;\s*includeSubDomains;\s*preload/],
  ['X-Content-Type-Options', /^nosniff$/],
  ['X-Frame-Options', /^DENY$/],
  ['X-XSS-Protection', /^0$/],
  ['X-Permitted-Cross-Domain-Policies', /^none$/],
  ['Referrer-Policy', /^strict-origin-when-cross-origin$/],
  ['Permissions-Policy', /camera=\(\).*microphone=\(\).*geolocation=\(\).*payment=\(\)/],
  ['Cross-Origin-Opener-Policy', /^same-origin$/],
  ['Cross-Origin-Resource-Policy', /^same-origin$/],
]);

const REQUIRED_CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  "media-src 'self'",
  "connect-src 'self'",
  "frame-src https://www.google.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' mailto: https://api.web3forms.com",
  "object-src 'none'",
  'upgrade-insecure-requests',
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function headerMapFromHtaccess(text) {
  const headers = new Map();
  const regex = /Header\s+always\s+set\s+([A-Za-z0-9-]+)\s+"([^"]+)"/g;
  for (const match of text.matchAll(regex)) headers.set(match[1], match[2]);
  return headers;
}

function headerMapFromVercel(text) {
  const parsed = JSON.parse(text);
  const catchAll = parsed.headers?.find((entry) => entry.source === '/(.*)');
  const headers = new Map();
  for (const header of catchAll?.headers ?? []) {
    if (header.key && header.value) headers.set(header.key, header.value);
  }
  return headers;
}

function auditHeaders(label, headers, { requireReport = false } = {}) {
  for (const [name, expected] of REQUIRED_HEADERS) {
    const value = headers.get(name);
    if (!value) {
      fail(`${label} missing ${name}.`);
      continue;
    }
    if (!expected.test(value)) fail(`${label} has weak ${name}: ${value}`);
  }

  const csp = headers.get('Content-Security-Policy');
  if (!csp) {
    fail(`${label} missing Content-Security-Policy.`);
  } else {
    for (const directive of REQUIRED_CSP_DIRECTIVES) {
      if (!csp.includes(directive)) fail(`${label} CSP missing directive: ${directive}`);
    }
    if (requireReport && !csp.includes('report-uri /api/csp-report')) {
      fail(`${label} CSP must report to /api/csp-report.`);
    }
  }
}

function auditSecurityTxt() {
  if (!existsSync(SECURITY_TXT)) {
    fail('public/.well-known/security.txt is missing.');
    return;
  }
  const text = read(SECURITY_TXT);
  if (!/^Contact:\s*mailto:beitbuilding@gmail\.com$/m.test(text)) {
    fail('security.txt missing the expected security contact.');
  }
  if (!/^Canonical:\s*https:\/\/www\.beitbuilding\.com\/\.well-known\/security\.txt$/m.test(text)) {
    fail('security.txt missing canonical URL.');
  }
  if (!/^Preferred-Languages:\s*en,\s*es$/m.test(text)) {
    fail('security.txt missing preferred languages.');
  }
  const expiresRaw = text.match(/^Expires:\s*(.+)$/m)?.[1];
  if (!expiresRaw) {
    fail('security.txt missing Expires.');
    return;
  }
  const expires = Date.parse(expiresRaw);
  if (!Number.isFinite(expires)) {
    fail(`security.txt Expires is not parseable: ${expiresRaw}`);
    return;
  }
  const now = Date.now();
  const days = (expires - now) / (24 * 60 * 60 * 1000);
  if (days <= 30) fail('security.txt expires within 30 days; refresh it before release.');
  if (days > 370) fail('security.txt Expires is too far in the future.');
}

function auditOrigins() {
  const security = read(SERVER_SECURITY);
  if (!security.includes('isAllowedSiteOrigin')) {
    fail('server security helper missing isAllowedSiteOrigin.');
  }
  for (const [label, path] of [['api/leads.ts', LEADS], ['api/events.ts', EVENTS]]) {
    const text = read(path);
    if (/origin\.endsWith\(['"]\.vercel\.app['"]\)/.test(text)) {
      fail(`${label} broadly trusts all *.vercel.app origins.`);
    }
    if (!text.includes('isAllowedSiteOrigin(origin)')) {
      fail(`${label} does not use the strict site-origin allowlist helper.`);
    }
  }
}

if (!existsSync(HTACCESS)) fail('public/.htaccess is missing.');
else auditHeaders('public/.htaccess', headerMapFromHtaccess(read(HTACCESS)));

if (!existsSync(VERCEL)) fail('vercel.json is missing.');
else auditHeaders('vercel.json', headerMapFromVercel(read(VERCEL)), { requireReport: true });

auditSecurityTxt();
auditOrigins();

if (failures.length) {
  console.error('security audit failed:');
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log('security audit passed.');
