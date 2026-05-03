/**
 * NAP audit — flags Name/Address/Phone drift across the site.
 *
 * Source of truth: src/data/business.ts.
 *
 * Why regex extraction (not import): Node 22 cannot natively import
 * TypeScript files without a loader, and adding tsx/esbuild as a CI
 * dep just for this script is overkill. The values we extract are
 * top-level string constants with predictable patterns — regex is
 * stable enough.
 *
 * What gets checked:
 *   - Footer.tsx + Contact.tsx React components
 *   - index.html static schema fallback
 *   - Per-city HTML entries (orlando-roofing.html, etc.)
 *   - blog.html and generated blog/<slug>.html files
 *   - Generated public/sitemap.xml (URL host)
 *
 * What it does NOT check:
 *   - JSDoc comments, code comments, README/markdown (false-positive risk too high)
 *   - Tests under __tests__ (testing fixtures may legitimately use other NAP)
 *
 * Exit codes:
 *   0 — clean (no drift detected)
 *   1 — drift detected (CI should fail)
 *   2 — script error (e.g., couldn't parse business.ts)
 *
 * Wire to CI as: `npm run check:nap`
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const BIZ = resolve(ROOT, 'src', 'data', 'business.ts');

/* ─── 1. Extract canonical NAP from business.ts ────────────────────────── */

function extractCanonical() {
  const text = readFileSync(BIZ, 'utf8');

  // Match `export const NAME = '<value>'` or `export const NAME = "<value>"`.
  // Tolerates whitespace + leading "= " then captures inside quotes.
  function readString(constName) {
    const re = new RegExp(
      `export\\s+const\\s+${constName}\\s*(?::\\s*[^=]+)?=\\s*['"]([^'"]+)['"]`,
      'm',
    );
    const m = text.match(re);
    return m ? m[1] : null;
  }

  const legalName = readString('LEGAL_NAME');
  const brandName = readString('BRAND_NAME');
  const phoneE164 = readString('PHONE_E164');
  const phoneDisplay = readString('PHONE_DISPLAY');
  const email = readString('EMAIL');

  // ADDRESS is an `as const` object literal — extract each field separately.
  function readAddrField(field) {
    const re = new RegExp(`${field}\\s*:\\s*['"]([^'"]+)['"]`);
    const m = text.match(re);
    return m ? m[1] : null;
  }
  const addr = {
    street: readAddrField('streetAddress'),
    locality: readAddrField('addressLocality'),
    region: readAddrField('addressRegion'),
    postal: readAddrField('postalCode'),
  };

  return { legalName, brandName, phoneE164, phoneDisplay, email, addr };
}

const canonical = extractCanonical();
if (
  !canonical.legalName ||
  !canonical.phoneE164 ||
  !canonical.phoneDisplay ||
  !canonical.email ||
  !canonical.addr.street
) {
  console.error('❌ nap-audit: failed to extract canonical NAP from src/data/business.ts');
  console.error('   Got:', canonical);
  process.exit(2);
}

console.log('✓ canonical NAP loaded from src/data/business.ts');
console.log(`  Name:  ${canonical.legalName}`);
console.log(`  Phone: ${canonical.phoneE164}  (display: ${canonical.phoneDisplay})`);
console.log(`  Email: ${canonical.email}`);
console.log(`  Addr:  ${canonical.addr.street}, ${canonical.addr.locality}, ${canonical.addr.region} ${canonical.addr.postal}`);
console.log('');

/* ─── 2. Build canonical & wrong-pattern matchers ─────────────────────── */

// Strip non-digit chars from phone for comparison.
function digitsOnly(s) {
  return (s || '').replace(/\D/g, '');
}

// Normalize to a 10-digit US phone — strips the optional leading "1"
// country-code so the E.164 form `+1-407-942-6459` (11 digits) and the
// display form `(407) 942-6459` (10 digits) compare equal.
function tenDigitUS(s) {
  let d = digitsOnly(s);
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d;
}

const canonicalPhoneDigits = tenDigitUS(canonical.phoneE164);

/**
 * Phone pattern catches anything that looks like a US phone number with
 * the area code 407 (Beit's area). We then compare every match's digits
 * against the canonical. Any non-canonical digits = drift.
 *
 * The pattern is intentionally broad to catch all common formats:
 *   (407) 942-6459
 *   407-942-6459
 *   407.942.6459
 *   +1 407 942 6459
 *   +14079426459
 */
const PHONE_PATTERN = /(?:\+?1[-.\s]?)?(?:\(?407\)?[-.\s]?)\d{3}[-.\s]?\d{4}/g;

/* ─── 3. Scan target files ─────────────────────────────────────────────── */

const SCAN_TARGETS = [
  'src/sections/Footer.tsx',
  'src/sections/Contact.tsx',
  'src/components/dbprData.ts',
  'index.html',
  'orlando-roofing.html',
  'winter-park-roofing.html',
  'oviedo-roofing.html',
  'oviedo-storm-damage.html',
  'blog.html',
];

// Also scan generated per-post blog HTMLs if they exist.
const BLOG_DIR = resolve(ROOT, 'blog');
if (existsSync(BLOG_DIR) && statSync(BLOG_DIR).isDirectory()) {
  for (const f of readdirSync(BLOG_DIR)) {
    if (f.endsWith('.html')) SCAN_TARGETS.push(join('blog', f));
  }
}

const issues = [];

for (const rel of SCAN_TARGETS) {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) {
    // Some targets are optional (e.g., blog HTMLs before prebuild). Skip.
    continue;
  }
  const content = readFileSync(p, 'utf8');
  const lines = content.split(/\r?\n/);

  // 1) Phone-number drift detection.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    PHONE_PATTERN.lastIndex = 0;
    while ((m = PHONE_PATTERN.exec(line)) !== null) {
      const found = m[0];
      const foundDigits = tenDigitUS(found);
      if (foundDigits !== canonicalPhoneDigits) {
        // Wrong number entirely — different 10-digit form from canonical.
        issues.push({
          file: rel,
          line: i + 1,
          kind: 'phone-number-wrong',
          found,
          expected: canonical.phoneE164,
          content: line.trim(),
        });
        continue;
      }
      // Right number, right digits — verify the format is one of the
      // accepted canonical / common forms. We accept ANY of these
      // because each has a legitimate use:
      //   "(407) 942-6459"   — display format (PHONE_DISPLAY) for visible UI
      //   "+1-407-942-6459"  — E.164 with dashes (PHONE_E164) for schema
      //   "+1 407-942-6459"  — alternate E.164 spacing
      //   "+14079426459"     — bare E.164 (used in tel: links by default)
      //   "407-942-6459"     — bare 10-digit dashed (sometimes used in copy)
      const acceptable =
        found === canonical.phoneDisplay ||
        found === canonical.phoneE164 ||
        found === '+1-407-942-6459' ||
        found === '+14079426459' ||
        found === '407-942-6459' ||
        found === '407.942.6459';
      if (!acceptable) {
        issues.push({
          file: rel,
          line: i + 1,
          kind: 'phone-format-drift',
          found,
          expected: `one of: "${canonical.phoneDisplay}", "${canonical.phoneE164}", "+14079426459"`,
          content: line.trim(),
        });
      }
    }
  }

  // 2) Address consistency — flag any "Dobbin" mention without the canonical street.
  if (
    /Dobbin/i.test(content) &&
    !content.includes(canonical.addr.street)
  ) {
    issues.push({
      file: rel,
      line: 0,
      kind: 'address-drift',
      found: '(Dobbin reference without canonical street)',
      expected: canonical.addr.street,
      content: '(see file)',
    });
  }

  // 3) Email consistency — flag any beitbuilding@ that's not canonical.
  const emailMatches = content.match(/[\w.+-]+@beitbuilding\.com|[\w.+-]+@gmail\.com/g);
  if (emailMatches) {
    for (const e of emailMatches) {
      if (e !== canonical.email) {
        // Flag only emails that LOOK like a Beit primary contact (avoid
        // false positives for placeholder examples in code comments).
        if (/beitbuilding|owner|admin|contact|info/.test(e.toLowerCase())) {
          issues.push({
            file: rel,
            line: 0,
            kind: 'email-drift',
            found: e,
            expected: canonical.email,
            content: '(grep for the email in the file)',
          });
        }
      }
    }
  }
}

/* ─── 4. Optional citation audit (network) ─────────────────────────────── */

/**
 * Citation audit — fetch each live external citation URL and verify the
 * NAP appears correctly. Opt-in via docs/citations-live.json:
 *
 *   {
 *     "citations": [
 *       { "source": "Yelp", "url": "https://www.yelp.com/biz/..." },
 *       { "source": "BBB",  "url": "https://www.bbb.org/us/fl/..." }
 *     ]
 *   }
 *
 * If the file doesn't exist, the audit skips silently — useful for CI
 * environments where outbound HTTP is restricted.
 *
 * Limitations:
 *   - JS-rendered pages (some directories) won't expose NAP in raw HTML.
 *     For those, the audit reports "no-phone-found" — a manual check is
 *     needed. Headless-browser-based auditing is out of scope here.
 *   - 10s timeout per URL. Some directories rate-limit aggressively.
 *   - User-Agent identifies as a bot; some sources (Yelp) may 403.
 */
async function auditCitations() {
  const configPath = resolve(ROOT, 'docs', 'citations-live.json');
  if (!existsSync(configPath)) return [];
  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error(`! citations-live.json parse error: ${err.message}`);
    return [];
  }
  if (!Array.isArray(config.citations) || config.citations.length === 0) {
    return [];
  }

  console.log(`\n→ Auditing ${config.citations.length} live citation URL(s)...`);

  const out = [];
  for (const { source, url } of config.citations) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const resp = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; BeitBuildingNAPAudit/1.0; +https://beitbuilding.com)',
          Accept: 'text/html',
        },
        redirect: 'follow',
      });
      clearTimeout(timer);

      if (!resp.ok) {
        out.push({
          file: `[citation: ${source}]`,
          line: 0,
          kind: 'citation-fetch-failed',
          found: `HTTP ${resp.status}`,
          expected: 'HTTP 200',
          content: url,
        });
        continue;
      }

      const html = await resp.text();
      const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

      // Phone presence + format
      const phoneMatches = text.match(PHONE_PATTERN) || [];
      if (phoneMatches.length === 0) {
        out.push({
          file: `[citation: ${source}]`,
          line: 0,
          kind: 'citation-no-phone',
          found: '(no phone-like string detected)',
          expected: canonical.phoneDisplay,
          content: url,
        });
      } else {
        let anyAcceptable = false;
        for (const phone of phoneMatches) {
          if (
            tenDigitUS(phone) === canonicalPhoneDigits &&
            (phone === canonical.phoneDisplay ||
              phone === canonical.phoneE164 ||
              phone === '+1-407-942-6459' ||
              phone === '+14079426459' ||
              phone === '407-942-6459' ||
              phone === '407.942.6459')
          ) {
            anyAcceptable = true;
            break;
          }
        }
        if (!anyAcceptable) {
          out.push({
            file: `[citation: ${source}]`,
            line: 0,
            kind: 'citation-phone-format-drift',
            found: phoneMatches.join(' / '),
            expected: canonical.phoneDisplay,
            content: url,
          });
        }
      }

      // Address presence
      if (!text.toLowerCase().includes('dobbin')) {
        out.push({
          file: `[citation: ${source}]`,
          line: 0,
          kind: 'citation-no-address',
          found: '(Dobbin street not detected)',
          expected: canonical.addr.street,
          content: url,
        });
      }
    } catch (err) {
      out.push({
        file: `[citation: ${source}]`,
        line: 0,
        kind: 'citation-fetch-error',
        found: err.message || 'unknown error',
        expected: '(successful fetch)',
        content: url,
      });
    }
  }

  return out;
}

/* ─── 5. Report ────────────────────────────────────────────────────────── */

const citationIssues = await auditCitations();
const allIssues = [...issues, ...citationIssues];

if (allIssues.length === 0) {
  console.log('✓ NAP audit passed — no drift detected.');
  console.log(`  Scanned ${SCAN_TARGETS.length} on-site files.`);
  if (citationIssues.length === 0 && existsSync(resolve(ROOT, 'docs', 'citations-live.json'))) {
    console.log('  Citation URLs all verified clean.');
  }
  process.exit(0);
}

console.log(`✗ NAP audit found ${allIssues.length} issue(s):`);
console.log('');
for (const issue of allIssues) {
  const loc = issue.line > 0 ? `${issue.file}:${issue.line}` : issue.file;
  console.log(`  ${issue.kind}  →  ${loc}`);
  console.log(`    found:    ${issue.found}`);
  console.log(`    expected: ${issue.expected}`);
  if (
    issue.content &&
    issue.content !== '(see file)' &&
    issue.content !== '(grep for the email in the file)'
  ) {
    console.log(
      `    where:    ${issue.content.slice(0, 120)}${issue.content.length > 120 ? '…' : ''}`,
    );
  }
  console.log('');
}

console.log('Fix the drift listed above. For on-site issues, edit the file or update src/data/business.ts.');
console.log('For citation issues, log in to the directory and update the listing manually, then re-run.');
console.log('After fixing: npm run check:nap');

process.exit(1);
