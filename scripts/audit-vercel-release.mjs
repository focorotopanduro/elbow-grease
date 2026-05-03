#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(process.cwd());
const VERCEL = resolve(ROOT, 'vercel.json');
const VERCELIGNORE = resolve(ROOT, '.vercelignore');
const ENV_EXAMPLE = resolve(ROOT, '.env.example');
const README = resolve(ROOT, 'README.md');

const requiredApiFiles = [
  'api/leads.ts',
  'api/events.ts',
  'api/csp-report.ts',
  'api/health.ts',
  'api/cron/purge-leads.ts',
  'api/_lib/security.ts',
  'api/_lib/rateLimit.ts',
  'api/_lib/kv.ts',
  'api/_lib/email.ts',
  'api/_lib/webhooks.ts',
];

const requiredEnvNames = [
  'VITE_WEB3FORMS_KEY',
  'VITE_BUSINESS_PHONE',
  'VITE_BUSINESS_EMAIL',
  'VITE_BUSINESS_WHATSAPP',
  'VITE_ZOOM_URL',
  'ADDITIONAL_ALLOWED_ORIGINS',
  'LEAD_NOTIFY_TO',
  'LEAD_NOTIFY_CC',
  'EMAIL_FROM',
  'RESEND_API_KEY',
  'SENDGRID_API_KEY',
  'MAILCHANNELS_API_KEY',
  'EMAIL_WEBHOOK_URL',
  'SLACK_LEADS_WEBHOOK',
  'DISCORD_LEADS_WEBHOOK',
  'KV_REST_API_URL',
  'KV_REST_API_TOKEN',
  'CRON_SECRET',
];

const requiredIgnoreEntries = [
  'node_modules',
  'dist',
  'release',
  'audit-shots',
  'source-assets',
  '.env',
  '.env.*',
  'codex-*.png',
  'iter-*.png',
  'marble-*.png',
  'polish-*.png',
  'prod-audit-*.png',
  'ui-*.png',
  'ux-*.png',
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function read(path) {
  return readFileSync(path, 'utf8');
}

function normalizeIgnoreLine(line) {
  return line.trim().replace(/^\//, '').replace(/\/$/, '');
}

function assertFile(path) {
  if (!existsSync(resolve(ROOT, path))) fail(`${path} is missing.`);
}

for (const file of requiredApiFiles) assertFile(file);

if (!existsSync(VERCEL)) {
  fail('vercel.json is missing.');
} else {
  const config = JSON.parse(read(VERCEL));
  const catchAll = config.headers?.find((entry) => entry.source === '/(.*)');
  const headers = catchAll?.headers ?? [];
  const headerValue = (key) => headers.find((header) => header.key === key)?.value ?? '';
  const csp = headerValue('Content-Security-Policy');

  for (const key of [
    'Strict-Transport-Security',
    'Content-Security-Policy',
    'Reporting-Endpoints',
    'X-Frame-Options',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'Cross-Origin-Opener-Policy',
    'Cross-Origin-Resource-Policy',
  ]) {
    if (!headerValue(key)) fail(`vercel.json catch-all headers missing ${key}.`);
  }

  if (!csp.includes("frame-ancestors 'none'")) fail('Vercel CSP must forbid framing.');
  if (!csp.includes("object-src 'none'")) fail('Vercel CSP must forbid object/embed payloads.');
  if (!csp.includes("script-src-attr 'none'")) fail('Vercel CSP must forbid inline event handlers.');
  if (!csp.includes('report-uri /api/csp-report')) fail('Vercel CSP must report violations to /api/csp-report.');
  if (!csp.includes('report-to csp-endpoint')) fail('Vercel CSP must include report-to csp-endpoint.');
  if (!headerValue('Reporting-Endpoints').includes('/api/csp-report')) {
    fail('Vercel Reporting-Endpoints must point to /api/csp-report.');
  }

  const purgeCron = config.crons?.find((cron) => cron.path === '/api/cron/purge-leads');
  if (!purgeCron) fail('vercel.json must schedule /api/cron/purge-leads.');
  else if (purgeCron.schedule !== '0 5 * * *') {
    fail(`purge-leads cron schedule changed unexpectedly: ${purgeCron.schedule}`);
  }
}

if (!existsSync(VERCELIGNORE)) {
  fail('.vercelignore is missing.');
} else {
  const ignoreLines = new Set(
    read(VERCELIGNORE)
      .split(/\r?\n/)
      .map(normalizeIgnoreLine)
      .filter((line) => line && !line.startsWith('#'))
  );
  for (const entry of requiredIgnoreEntries) {
    if (!ignoreLines.has(normalizeIgnoreLine(entry))) {
      fail(`.vercelignore missing ${entry}.`);
    }
  }
}

if (!existsSync(ENV_EXAMPLE)) {
  fail('.env.example is missing.');
} else {
  const envExample = read(ENV_EXAMPLE);
  for (const name of requiredEnvNames) {
    if (!new RegExp(`^${name}=`, 'm').test(envExample)) {
      fail(`.env.example missing ${name}.`);
    }
  }
}

if (!existsSync(README)) {
  fail('README.md is missing.');
} else {
  const readme = read(README);
  for (const phrase of [
    'Vercel serverless API functions',
    'Hostinger static release',
    'GitHub release automation',
    '/api/leads',
    '/api/health',
  ]) {
    if (!readme.includes(phrase)) fail(`README.md missing architecture phrase: ${phrase}`);
  }
}

if (failures.length) {
  console.error('vercel release audit failed:');
  for (const message of failures) console.error(`  - ${message}`);
  process.exit(1);
}

console.log('vercel release audit passed.');
