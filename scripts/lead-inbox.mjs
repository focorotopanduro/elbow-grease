#!/usr/bin/env node
import { createServer } from 'node:http';
import { mkdir, appendFile, access, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const PORT = Number(process.env.PORT || process.env.LEAD_INBOX_PORT || 8787);
const OUT_DIR = resolve(process.env.LEAD_INBOX_DIR || 'lead-inbox');
const TOKEN = process.env.LEAD_INBOX_TOKEN || '';
const ORIGINS = (process.env.LEAD_INBOX_ORIGINS || 'http://127.0.0.1:4177,http://localhost:4177')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const MAX_BODY_BYTES = 1_000_000;

const CSV_HEADER = [
  'id',
  'createdAt',
  'name',
  'email',
  'phone',
  'clientType',
  'preferredContact',
  'location',
  'service',
  'route',
  'priority',
  'bucket',
  'recommendedFollowUp',
  'message',
  'page',
];

function corsOrigin(requestOrigin) {
  if (!requestOrigin) return ORIGINS[0] ?? '*';
  return ORIGINS.includes(requestOrigin) ? requestOrigin : '';
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(JSON.stringify(body));
}

function hasValidToken(req) {
  return !TOKEN || req.headers['x-lead-inbox-token'] === TOKEN;
}

function csvEscape(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsvRow(lead) {
  return [
    lead.id,
    lead.createdAt,
    lead.customer?.name,
    lead.customer?.email,
    lead.customer?.phone,
    lead.customer?.type,
    lead.customer?.preferredContact,
    lead.property?.location,
    lead.project?.service,
    lead.route?.label,
    lead.route?.priority,
    lead.operations?.bucket,
    lead.operations?.recommendedFollowUp,
    lead.project?.message,
    lead.page?.href,
  ].map(csvEscape).join(',');
}

async function ensureCsv(path) {
  try {
    await access(path);
  } catch {
    await writeFile(path, `${CSV_HEADER.join(',')}\n`, 'utf8');
  }
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('payload_too_large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function isLead(value) {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.createdAt === 'string' &&
    typeof value.customer?.name === 'string' &&
    typeof value.customer?.email === 'string' &&
    typeof value.customer?.phone === 'string' &&
    typeof value.project?.service === 'string',
  );
}

const server = createServer(async (req, res) => {
  const origin = corsOrigin(req.headers.origin);
  const corsHeaders = origin
    ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,X-Lead-Inbox-Token',
    }
    : {};

  if (req.method === 'OPTIONS') {
    res.writeHead(origin ? 204 : 403, corsHeaders);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    send(res, 200, { ok: true, outDir: OUT_DIR }, corsHeaders);
    return;
  }

  if (req.method === 'GET' && (req.url === '/leads.csv' || req.url === '/leads.ndjson')) {
    if (!hasValidToken(req)) {
      send(res, 401, { ok: false, reason: 'bad_token' }, corsHeaders);
      return;
    }

    await mkdir(OUT_DIR, { recursive: true });
    const isCsv = req.url === '/leads.csv';
    const fileName = isCsv ? 'leads.csv' : 'leads.ndjson';
    const filePath = join(OUT_DIR, fileName);
    if (isCsv) await ensureCsv(filePath);
    else {
      try {
        await access(filePath);
      } catch {
        await writeFile(filePath, '', 'utf8');
      }
    }

    const content = await readFile(filePath);
    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type': isCsv ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    res.end(content);
    return;
  }

  if (req.method !== 'POST' || req.url !== '/lead-intake') {
    send(res, 404, { ok: false, reason: 'not_found' }, corsHeaders);
    return;
  }

  if (!origin) {
    send(res, 403, { ok: false, reason: 'origin_not_allowed' }, corsHeaders);
    return;
  }

  if (!hasValidToken(req)) {
    send(res, 401, { ok: false, reason: 'bad_token' }, corsHeaders);
    return;
  }

  try {
    const lead = await readJson(req);
    if (!isLead(lead)) {
      send(res, 400, { ok: false, reason: 'invalid_lead_payload' }, corsHeaders);
      return;
    }

    await mkdir(OUT_DIR, { recursive: true });
    const ndjsonPath = join(OUT_DIR, 'leads.ndjson');
    const csvPath = join(OUT_DIR, 'leads.csv');
    await ensureCsv(csvPath);
    await Promise.all([
      appendFile(ndjsonPath, `${JSON.stringify(lead)}\n`, 'utf8'),
      appendFile(csvPath, `${toCsvRow(lead)}\n`, 'utf8'),
    ]);

    send(res, 200, {
      ok: true,
      id: lead.id,
      files: {
        ndjson: ndjsonPath,
        csv: csvPath,
      },
    }, corsHeaders);
  } catch (error) {
    send(res, 500, {
      ok: false,
      reason: error instanceof Error ? error.message : 'write_failed',
    }, corsHeaders);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Lead inbox listening at http://127.0.0.1:${PORT}/lead-intake`);
  console.log(`Writing files under ${OUT_DIR}`);
  console.log(`CSV export available at http://127.0.0.1:${PORT}/leads.csv`);
});
