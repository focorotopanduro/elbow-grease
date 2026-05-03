#!/usr/bin/env node
/**
 * verify-licenses.mjs — DBPR verification (CURRENTLY NON-FUNCTIONAL).
 *
 * STATUS: blocked by Cloudflare Bot Management (the `__cf_bm` cookie
 * issued on every request to myfloridalicense.com). Our Node fetch calls
 * are silently fingerprinted as bots; DBPR returns the
 * "request cannot be processed at this time" page regardless of
 * how many real-browser headers + form fields we send.
 *
 * Failed approaches tried:
 *   - Cookie-jar with full session priming (GET mode=1 → POST mode=2)
 *   - All 32 form fields mirrored from the live page
 *   - Realistic Chrome User-Agent + Origin + Referer headers
 *   - Visiting homepage first to seed __cf_bm
 *
 * Realistic paths to make this work in the future:
 *   1. Headless browser (Puppeteer/Playwright) with stealth plugins —
 *      heavy dep, may still hit CF challenges, fragile
 *   2. Authorized DBPR data feed (write to dbpr.licensees@myflorida.com
 *      to ask for an API or scheduled data pull)
 *   3. Run from a residential IP where CF is more permissive (still
 *      gambling against their bot detection)
 *
 * For now: the LICENSES array in src/components/dbprData.ts holds the
 * verified data manually, with a LAST_VERIFIED date the site owner
 * updates whenever they re-confirm the license records on DBPR. This is
 * 100% honest — the data is observed from official DBPR records (the
 * screenshots Sandra walked through during setup), and visitors can still
 * click "Verify on DBPR" to see the live record themselves.
 *
 * To re-enable this script: solve the Cloudflare problem above, then
 * uncomment the implementation block below + wire it into "prebuild"
 * in package.json.
 */
console.log('verify-licenses.mjs is currently non-functional — DBPR is behind Cloudflare bot detection.');
console.log('Verified license data is hand-maintained in src/components/dbprData.ts.');
console.log('See the file header for the full status + future-fix paths.');
process.exit(0);

/* eslint-disable */
// === Original implementation kept for future reference ====================
// (commented out — DBPR/Cloudflare currently rejects all requests)

import { writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_PATH = join(ROOT, 'src', 'data', 'dbpr-cache.json');

// Source-of-truth license numbers (must match dbprData.ts LICENSES array)
const LICENSE_NUMBERS = ['CCC1337413', 'CGC1534077'];

// DBPR's wl11.asp flow:
//   mode=1&search=LicNbr  → form with the LicNbr text input + dropdowns
//   mode=2 (POST target)  → search-results page (consumes the form fields)
const FORM_URL   = 'https://www.myfloridalicense.com/wl11.asp?mode=1&search=LicNbr';
const ACTION_URL = 'https://www.myfloridalicense.com/wl11.asp?mode=2&search=LicNbr&SID=&brd=&typ=';

const UA = 'Mozilla/5.0 (compatible; Beit-Building-Trust-Verifier/1.0; +https://beitbuilding.com)';

// All form fields the live DBPR mode=1 form ships, with their default values.
// Empty values are intentional — they're empty in the live form.
const FORM_FIELDS = {
  // Hidden fields
  hSID:             '',
  hSearchType:      'LicNbr',
  hLastName:        '',
  hFirstName:       '',
  hMiddleName:      '',
  hOrgName:         '',
  hSearchOpt:       '',
  hSearchOpt2:      '',
  hSearchAltName:   '',
  hSearchPartName:  '',
  hSearchFuzzy:     '',
  hDivision:        'ALL',
  hBoard:           '',
  hLicenseType:     '',
  hSpecQual:        '',
  hAddrType:        '',
  hCity:            '',
  hCounty:          '',
  hState:           '',
  hLicNbr:          '',
  hCurrPage:        '',
  hTotalPages:      '',
  hTotalRecords:    '',
  hBoardType:       '',
  hLicTyp:          '',
  hSearchHistoric:  '',
  hRecsPerPage:     '',
  // Visible fields (Board / LicenseType / SpecQual stay blank for a license-
  // number-only search; SearchHistoric included so historic licenses also match)
  Board:            '',
  LicenseType:      '',
  SpecQual:         '',
  SearchHistoric:   'Yes',
  Search1:          'Search',
};

/* ─── Minimal cookie jar ────────────────────────────────────────────── */
class CookieJar {
  constructor() { this.cookies = new Map(); }

  storeFromResponse(resp) {
    // Node's undici fetch supports getSetCookie (fetch-spec compliant)
    const setCookie = typeof resp.headers.getSetCookie === 'function'
      ? resp.headers.getSetCookie()
      : (resp.headers.raw?.()['set-cookie'] ?? []);
    for (const header of setCookie) {
      const [pair] = header.split(';');
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const name  = pair.slice(0, eq).trim();
        const value = pair.slice(eq + 1).trim();
        this.cookies.set(name, value);
      }
    }
  }

  toHeader() {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }
}

/* ─── HTML parsing ───────────────────────────────────────────────────── */

/**
 * Strip HTML to plain text for predictable regex matching.
 * Keeps inter-element spaces so words don't run together.
 */
function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' | ')        // table cells use <br> as separator
    .replace(/<\/(td|th|tr|p|div|li)>/gi, ' • ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract structured data from the DBPR search-results HTML. Returns null
 * if no record was found in the response (or the page indicates "no records").
 */
function parseLicenseRecord(html, expectedNumber) {
  const text = htmlToText(html);

  if (/no records found/i.test(text)) {
    return { error: 'NOT_FOUND', message: `DBPR returned no records for ${expectedNumber}` };
  }
  if (!text.toUpperCase().includes(expectedNumber.toUpperCase())) {
    return { error: 'NUMBER_NOT_IN_RESPONSE', message: `License number ${expectedNumber} not present in DBPR response` };
  }

  // License type — the prefix tells us, but we want the human-readable form
  const typeMatch = text.match(/Certified\s+(General|Roofing|Building|Residential|Plumbing|Mechanical|Electrical)\s+Contractor/i);
  const licenseType = typeMatch ? typeMatch[0].replace(/\s+/g, ' ').trim() : null;

  // Status + expiration — DBPR formats as "Current, Active 08/31/2026"
  const statusMatch = text.match(/Current,\s*Active/i);
  const expiresMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);

  // Names — DBPR returns 1+ rows per license (DBA + Primary qualifier)
  // We extract up to two distinct names that aren't generic boilerplate
  const nameCandidates = [];
  const orgMatch = text.match(/([A-Z][A-Z\s&,'.]+\bLLC\b)/);
  if (orgMatch) nameCandidates.push({ kind: 'DBA', value: orgMatch[1].trim() });
  const personMatch = text.match(/\b([A-Z]+),\s+([A-Z][A-Z\s]+)\b/);
  if (personMatch) {
    nameCandidates.push({ kind: 'Primary', value: `${personMatch[1]}, ${personMatch[2].trim()}` });
  }

  // Address — looking for a Florida ZIP after the names
  const addrMatch = text.match(/(\d+\s+[A-Z][A-Z\s.]+(?:DRIVE|DR|STREET|ST|AVENUE|AVE|ROAD|RD|BOULEVARD|BLVD|LANE|LN|COURT|CT|WAY|PL|PLACE)[\s.,A-Z]*FL\s*\d{5})/i);

  return {
    licenseType,
    status: statusMatch ? 'Current, Active' : null,
    expires: expiresMatch ? expiresMatch[1] : null,
    names: nameCandidates,
    address: addrMatch ? addrMatch[1].replace(/\s+/g, ' ').trim() : null,
  };
}

/* ─── DBPR fetch flow ────────────────────────────────────────────────── */

async function fetchOne(licenseNumber, jar) {
  // Step 1: hit the form page so DBPR sets a session cookie
  const formResp = await fetch(FORM_URL, {
    headers: { 'User-Agent': UA, Accept: 'text/html' },
    redirect: 'follow',
  });
  jar.storeFromResponse(formResp);
  await formResp.text(); // drain

  // Step 2: POST the search with all form fields + the license number
  const body = new URLSearchParams({
    LicNbr: licenseNumber,
    ...FORM_FIELDS,
  }).toString();

  const resp = await fetch(ACTION_URL, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: jar.toHeader(),
      Referer: FORM_URL,
      Accept: 'text/html',
    },
    body,
    redirect: 'follow',
  });

  if (!resp.ok) {
    return { error: 'HTTP_ERROR', message: `DBPR returned HTTP ${resp.status}` };
  }
  jar.storeFromResponse(resp);

  const html = await resp.text();
  return parseLicenseRecord(html, licenseNumber);
}

/* ─── Main ───────────────────────────────────────────────────────────── */

async function main() {
  console.log('🔎 Verifying licenses on Florida DBPR…');
  const verifiedAt = new Date().toISOString();
  const records = {};

  for (const num of LICENSE_NUMBERS) {
    process.stdout.write(`   ${num}  … `);
    try {
      const jar = new CookieJar();
      const data = await fetchOne(num, jar);
      records[num] = { number: num, ...data };
      if (data.error) {
        console.log(`✗ ${data.error}`);
      } else {
        console.log(`✓ ${data.status ?? 'parsed'} · expires ${data.expires ?? '?'}`);
      }
    } catch (err) {
      records[num] = { number: num, error: 'FETCH_FAILED', message: err.message };
      console.log(`✗ ${err.message}`);
    }
  }

  const cache = { verifiedAt, records };
  await writeFile(OUT_PATH, JSON.stringify(cache, null, 2) + '\n', 'utf8');
  console.log(`💾 wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error('❌ Verification script crashed:', err);
  // Don't fail the build over a verification miss — write a placeholder cache
  const fallback = {
    verifiedAt: null,
    records: Object.fromEntries(
      LICENSE_NUMBERS.map((n) => [n, { number: n, error: 'SCRIPT_CRASH', message: err.message }]),
    ),
  };
  writeFile(OUT_PATH, JSON.stringify(fallback, null, 2) + '\n', 'utf8')
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
});
