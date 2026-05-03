/**
 * Pure-function lead-payload validators — extracted from `/api/leads`
 * so they can be unit-tested without mocking `@vercel/node`.
 *
 * Every export here is referentially transparent (same input → same
 * output, no side effects, no env reads). The handler in `/api/leads`
 * composes them into the full request flow; the test suite exercises
 * each in isolation.
 *
 * Three concerns covered:
 *   1. String hygiene  — sanitize, stripCRLF, stripCtrl, isStr
 *   2. Field validation — validateRoute, validateOperations,
 *                         validateLocale, parseAcceptLanguage
 *   3. Composite        — validateLead (the full /api/leads contract)
 */

/* ─── Regex patterns ─────────────────────────────────────────────── */

/** Match CR, LF, U+2028 (line separator), U+2029 (paragraph separator)
 *  — all four codepoints some mail clients honor as line breaks.
 *  Built via RegExp constructor with \u escapes so the source file
 *  stays free of literal line-terminator codepoints (which would
 *  confuse parsers and look like accidental whitespace in diffs). */
export const LINE_TERMINATORS_REGEX = new RegExp('[\\r\\n\\u2028\\u2029]+', 'g');

/** C0 control chars (excluding tab/LF/CR which we handle elsewhere)
 *  + DEL. Strips null bytes + escape sequences that could otherwise
 *  poison logs or downstream pipelines. */
export const CONTROL_CHARS_REGEX = new RegExp(
  '[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]',
  'g',
);

/** Strict-light email regex, mirrors `src/sections/Contact.tsx EMAIL_RE`. */
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_ROUTE_PRIORITIES = new Set([
  'call-first',
  'estimate-first',
  'scope-first',
  'work-order',
]);

/* ─── Type contracts ─────────────────────────────────────────────── */

export interface LeadRouteInput {
  id?: unknown;
  label?: unknown;
  priority?: unknown;
  intent?: unknown;
  contingency?: unknown;
  proof?: unknown;
}

export interface LeadOperationsInput {
  bucket?: unknown;
  urgency?: unknown;
  recommendedFollowUp?: unknown;
}

export interface LeadInput {
  name?: unknown;
  phone?: unknown;
  email?: unknown;
  zip?: unknown;
  location?: unknown;
  clientType?: unknown;
  preferredContact?: unknown;
  service?: unknown;
  message?: unknown;
  route?: unknown;
  operations?: unknown;
  confirmationId?: unknown;
  source?: unknown;
  page?: unknown;
  url?: unknown;
  ts?: unknown;
  locale?: unknown;
  /** Honeypots — must be empty/missing. */
  website?: unknown;
  botcheck?: unknown;
}

export interface LeadValidated {
  name: string;
  phone: string;
  email: string;
  zip: string;
  location: string;
  clientType: string;
  preferredContact: string;
  service: string;
  message: string;
  confirmationId: string;
  source: string;
  page: string;
  url: string;
  ts: string;
  locale: 'en' | 'es';
  route: {
    id: string;
    label: string;
    priority: string;
    intent: string;
    contingency: string;
    proof: string;
  } | null;
  operations: {
    bucket: string;
    urgency: string;
    recommendedFollowUp: string;
  } | null;
}

/* ─── String hygiene ─────────────────────────────────────────────── */

export function stripCRLF(s: string): string {
  return s.replace(LINE_TERMINATORS_REGEX, ' ');
}

export function stripCtrl(s: string): string {
  return s.replace(CONTROL_CHARS_REGEX, '');
}

export function sanitize(s: string, max: number): string {
  return stripCtrl(stripCRLF(s)).trim().slice(0, max);
}

export function isStr(v: unknown, max: number, min = 1): v is string {
  return typeof v === 'string' && v.length >= min && v.length <= max;
}

/* ─── Sub-validators ─────────────────────────────────────────────── */

export function validateLocale(input: unknown): LeadValidated['locale'] {
  if (input === 'es' || input === 'es-US' || input === 'es-MX') return 'es';
  return 'en';
}

/**
 * Parse Accept-Language to a supported locale. Picks 'es' if Spanish
 * is the highest-priority language (q-value comparison); otherwise 'en'.
 * Treats malformed headers as 'en' silently. Caps at 16 sub-tags so a
 * giant Accept-Language can't DoS the parser.
 */
export function parseAcceptLanguage(
  header: string | undefined | null,
): LeadValidated['locale'] {
  if (!header || typeof header !== 'string') return 'en';
  const items = header.split(',').slice(0, 16);
  let bestLang = 'en';
  let bestQ = -1;
  for (const item of items) {
    const [tag, ...params] = item.trim().split(';');
    if (!tag) continue;
    const cleanTag = tag.trim().toLowerCase();
    let q = 1;
    for (const p of params) {
      const m = p.trim().match(/^q=(\d*\.?\d+)$/);
      if (m) {
        const parsed = Number(m[1]);
        if (Number.isFinite(parsed)) q = parsed;
      }
    }
    if (q > bestQ) {
      bestQ = q;
      bestLang = cleanTag;
    }
  }
  return bestLang.startsWith('es') ? 'es' : 'en';
}

export function validateRoute(input: unknown): LeadValidated['route'] {
  if (!input || typeof input !== 'object') return null;
  const r = input as LeadRouteInput;
  if (!isStr(r.id, 60) || !isStr(r.label, 120)) return null;
  const priorityRaw = isStr(r.priority, 40) ? sanitize(r.priority, 40) : '';
  const priority = VALID_ROUTE_PRIORITIES.has(priorityRaw) ? priorityRaw : 'estimate-first';
  return {
    id: sanitize(r.id, 60),
    label: sanitize(r.label, 120),
    priority,
    intent: isStr(r.intent, 80) ? sanitize(r.intent, 80) : 'unspecified',
    contingency: isStr(r.contingency, 280) ? sanitize(r.contingency, 280) : '',
    proof: isStr(r.proof, 280) ? sanitize(r.proof, 280) : '',
  };
}

export function validateOperations(input: unknown): LeadValidated['operations'] {
  if (!input || typeof input !== 'object') return null;
  const o = input as LeadOperationsInput;
  return {
    bucket: isStr(o.bucket, 40) ? sanitize(o.bucket, 40) : 'general',
    urgency: isStr(o.urgency, 120) ? sanitize(o.urgency, 120) : 'Standard estimate follow-up',
    recommendedFollowUp: isStr(o.recommendedFollowUp, 280)
      ? sanitize(o.recommendedFollowUp, 280)
      : 'Prepare estimate follow-up. Confirm property access, timing, material needs, and photos.',
  };
}

/* ─── Composite ──────────────────────────────────────────────────── */

export type ValidateLeadResult =
  | { ok: true; data: LeadValidated }
  | { ok: false; reason: string };

export interface ValidateLeadOptions {
  /** Generator for the server-side fallback confirmation ID. Injected
   *  so tests can stub it; production passes the crypto-backed
   *  `generateConfirmationId` from `security.ts`. */
  generateConfirmationId: () => string;
  /** Strict format check for client-supplied confirmation IDs. */
  isValidConfirmationId: (id: unknown) => id is string;
}

export function validateLead(
  input: LeadInput,
  opts: ValidateLeadOptions,
): ValidateLeadResult {
  // Honeypots — `website` (mobile sim) + `botcheck` (desktop form).
  if (input.website && String(input.website).trim().length > 0) {
    return { ok: false, reason: 'honeypot' };
  }
  if (input.botcheck && String(input.botcheck).trim().length > 0) {
    return { ok: false, reason: 'honeypot' };
  }
  if (!isStr(input.name, 80, 2)) return { ok: false, reason: 'invalid_name' };
  if (!isStr(input.phone, 20, 10)) return { ok: false, reason: 'invalid_phone' };

  const phoneDigits = input.phone.replace(/\D/g, '');
  if (phoneDigits.length !== 10) return { ok: false, reason: 'invalid_phone_format' };

  // NANP: area code + central-office prefix first digit must be 2-9
  const areaCode = phoneDigits.slice(0, 3);
  const exchange = phoneDigits.slice(3, 6);
  if (!/^[2-9]\d{2}$/.test(areaCode) || !/^[2-9]\d{2}$/.test(exchange)) {
    return { ok: false, reason: 'invalid_phone_format' };
  }
  // Reject all-same-digit patterns
  if (/^(\d)\1{9}$/.test(phoneDigits)) {
    return { ok: false, reason: 'invalid_phone_format' };
  }

  let zip = '';
  if (input.zip !== undefined && input.zip !== '' && input.zip !== null) {
    if (!isStr(input.zip, 10, 5)) return { ok: false, reason: 'invalid_zip' };
    if (!/^\d{5}$/.test(input.zip)) return { ok: false, reason: 'invalid_zip_format' };
    zip = sanitize(input.zip, 10);
  }

  let email = '';
  if (input.email !== undefined && input.email !== '' && input.email !== null) {
    if (!isStr(input.email, 320, 5)) return { ok: false, reason: 'invalid_email' };
    const cleaned = sanitize(input.email, 320).toLowerCase();
    if (!EMAIL_RE.test(cleaned)) return { ok: false, reason: 'invalid_email' };
    email = cleaned;
  }

  const location = isStr(input.location, 200) ? sanitize(input.location, 200) : '';
  const clientType = isStr(input.clientType, 80) ? sanitize(input.clientType, 80) : '';
  const preferredContact = isStr(input.preferredContact, 80) ? sanitize(input.preferredContact, 80) : '';
  const service = isStr(input.service, 80) ? sanitize(input.service, 80) : '';
  const message = isStr(input.message, 4000) ? sanitize(input.message, 4000) : '';

  return {
    ok: true,
    data: {
      name: sanitize(input.name, 80),
      phone: sanitize(input.phone, 20),
      email,
      zip,
      location,
      clientType,
      preferredContact,
      service,
      message,
      confirmationId: opts.isValidConfirmationId(input.confirmationId)
        ? input.confirmationId
        : opts.generateConfirmationId(),
      source: isStr(input.source, 40) ? sanitize(input.source, 40) : 'unknown',
      page: isStr(input.page, 80) ? sanitize(input.page, 80) : 'unknown',
      url: isStr(input.url, 400) ? sanitize(input.url, 400) : 'unknown',
      ts: isStr(input.ts, 40) ? sanitize(input.ts, 40) : new Date().toISOString(),
      locale: validateLocale(input.locale),
      route: validateRoute(input.route),
      operations: validateOperations(input.operations),
    },
  };
}
