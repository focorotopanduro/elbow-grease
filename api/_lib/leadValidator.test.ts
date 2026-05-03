/**
 * Pure-function lead-payload validator — contract tests.
 *
 * These lock the wire contract /api/leads validates against. Every
 * branch a hostile client can hit is covered: honeypot trips,
 * malformed phones, header-injection in email, oversized fields,
 * locale fallback, route priority allowlist.
 */
import { describe, expect, it } from 'vitest';
import {
  EMAIL_RE,
  parseAcceptLanguage,
  sanitize,
  validateLead,
  validateLocale,
  validateOperations,
  validateRoute,
  type LeadInput,
} from './leadValidator';

const baseGoodLead: LeadInput = {
  name: 'Maria Vasquez',
  phone: '4079555010',
  email: 'maria@example.com',
  zip: '32817',
  location: 'Audubon Park, Orlando',
  clientType: 'Homeowner',
  preferredContact: 'WhatsApp',
  service: 'Roof repair or storm damage',
  message: 'Hurricane damage on the back slope.',
  source: 'website_contact_form',
  page: '/',
  url: 'https://www.beitbuilding.com/',
  ts: '2026-05-02T15:00:00.000Z',
};

const VALIDATE_OPTS = {
  generateConfirmationId: () => 'BBC-GEN-12345',
  isValidConfirmationId: (id: unknown): id is string =>
    typeof id === 'string' && /^BBC-[A-Z0-9-]{4,40}$/.test(id),
};

describe('sanitize', () => {
  it('strips CR, LF, U+2028, U+2029', () => {
    const dirty = 'a\rb\nc d e';
    expect(sanitize(dirty, 100)).toBe('a b c d e');
  });

  it('strips C0 control chars and DEL', () => {
    expect(sanitize('a\x00b\x07c\x7fd', 100)).toBe('abcd');
  });

  it('caps to max length', () => {
    expect(sanitize('a'.repeat(50), 10)).toBe('aaaaaaaaaa');
  });

  it('trims whitespace at the edges', () => {
    expect(sanitize('   hello   ', 100)).toBe('hello');
  });
});

describe('EMAIL_RE', () => {
  it('matches typical addresses', () => {
    expect(EMAIL_RE.test('a@b.co')).toBe(true);
    expect(EMAIL_RE.test('first.last+tag@sub.example.com')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    expect(EMAIL_RE.test('no-at-sign')).toBe(false);
    expect(EMAIL_RE.test('@no-local')).toBe(false);
    expect(EMAIL_RE.test('no-tld@x')).toBe(false);
    expect(EMAIL_RE.test('whitespace @x.co')).toBe(false);
  });
});

describe('validateLocale', () => {
  it('accepts es / es-US / es-MX as Spanish', () => {
    expect(validateLocale('es')).toBe('es');
    expect(validateLocale('es-US')).toBe('es');
    expect(validateLocale('es-MX')).toBe('es');
  });

  it('rejects everything else as English', () => {
    expect(validateLocale('en')).toBe('en');
    expect(validateLocale('fr')).toBe('en');
    expect(validateLocale(undefined)).toBe('en');
    expect(validateLocale(null)).toBe('en');
    expect(validateLocale(42)).toBe('en');
    expect(validateLocale({ es: true })).toBe('en');
  });
});

describe('parseAcceptLanguage', () => {
  it('returns en for missing/empty headers', () => {
    expect(parseAcceptLanguage(undefined)).toBe('en');
    expect(parseAcceptLanguage(null)).toBe('en');
    expect(parseAcceptLanguage('')).toBe('en');
  });

  it('returns es when Spanish is the only language', () => {
    expect(parseAcceptLanguage('es-US')).toBe('es');
    expect(parseAcceptLanguage('es')).toBe('es');
  });

  it('returns es when Spanish has the highest q-value', () => {
    expect(parseAcceptLanguage('en;q=0.5, es;q=0.9')).toBe('es');
    expect(parseAcceptLanguage('es-MX;q=1.0, en-US;q=0.3')).toBe('es');
  });

  it('returns en when English wins on q-value', () => {
    expect(parseAcceptLanguage('en;q=0.9, es;q=0.5')).toBe('en');
  });

  it('handles malformed q-values gracefully', () => {
    // Malformed q-value → caller's default q=1 wins; en stays bestLang
    expect(parseAcceptLanguage('en;q=garbage, es;q=0.8')).toBe('en');
    // Spanish-only header → es
    expect(parseAcceptLanguage('es')).toBe('es');
  });

  it('caps at 16 sub-tags so a giant header is bounded', () => {
    const tags = Array.from({ length: 100 }, () => 'en').join(',');
    expect(parseAcceptLanguage(tags)).toBe('en');
  });
});

describe('validateRoute', () => {
  it('returns null for non-objects', () => {
    expect(validateRoute(null)).toBe(null);
    expect(validateRoute('string')).toBe(null);
    expect(validateRoute(42)).toBe(null);
    expect(validateRoute(undefined)).toBe(null);
  });

  it('returns null when id or label missing', () => {
    expect(validateRoute({ id: 'x' })).toBe(null);
    expect(validateRoute({ label: 'y' })).toBe(null);
    expect(validateRoute({})).toBe(null);
  });

  it('passes through valid route data', () => {
    const route = validateRoute({
      id: 'storm',
      label: 'Storm path',
      priority: 'call-first',
      intent: 'active_leak',
      contingency: 'Tarp + photo set',
      proof: 'Storm imagery',
    });
    expect(route).toEqual({
      id: 'storm',
      label: 'Storm path',
      priority: 'call-first',
      intent: 'active_leak',
      contingency: 'Tarp + photo set',
      proof: 'Storm imagery',
    });
  });

  it('coerces unknown priority to estimate-first (allowlist)', () => {
    const route = validateRoute({
      id: 'x',
      label: 'y',
      priority: '<script>alert(1)</script>',
    });
    expect(route?.priority).toBe('estimate-first');
  });

  it('drops the entire route when id or label exceed length cap', () => {
    // Oversized id (100 chars > 60 cap) → isStr fails → route returns null
    expect(
      validateRoute({ id: 'a'.repeat(100), label: 'short label' }),
    ).toBe(null);
    expect(
      validateRoute({ id: 'short', label: 'b'.repeat(200) }),
    ).toBe(null);
  });

  it('caps optional fields (intent/contingency/proof) when provided overlong', () => {
    // intent/contingency/proof have isStr-with-default-fallback behavior:
    // overlong → falls back to default ('unspecified' / '')
    const route = validateRoute({
      id: 'storm',
      label: 'Storm path',
      intent: 'X'.repeat(200),
      contingency: 'Y'.repeat(500),
      proof: 'Z'.repeat(500),
    });
    expect(route?.intent).toBe('unspecified');
    expect(route?.contingency).toBe('');
    expect(route?.proof).toBe('');
  });
});

describe('validateOperations', () => {
  it('returns null for non-objects', () => {
    expect(validateOperations(null)).toBe(null);
    expect(validateOperations('foo')).toBe(null);
  });

  it('falls back to defaults for missing fields', () => {
    const ops = validateOperations({});
    expect(ops?.bucket).toBe('general');
    expect(ops?.urgency).toContain('Standard');
    expect(ops?.recommendedFollowUp).toContain('estimate follow-up');
  });

  it('passes through valid fields', () => {
    const ops = validateOperations({
      bucket: 'storm',
      urgency: 'Within 6 hours',
      recommendedFollowUp: 'Call first.',
    });
    expect(ops).toEqual({
      bucket: 'storm',
      urgency: 'Within 6 hours',
      recommendedFollowUp: 'Call first.',
    });
  });
});

describe('validateLead — happy path', () => {
  it('accepts a full desktop-form payload', () => {
    const result = validateLead(baseGoodLead, VALIDATE_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.name).toBe('Maria Vasquez');
    expect(result.data.phone).toBe('4079555010');
    expect(result.data.email).toBe('maria@example.com');
    expect(result.data.zip).toBe('32817');
    expect(result.data.clientType).toBe('Homeowner');
    expect(result.data.preferredContact).toBe('WhatsApp');
    expect(result.data.locale).toBe('en');
  });

  it('accepts a mobile-sim payload (zip required, no email)', () => {
    const minimal: LeadInput = {
      name: 'Test User',
      phone: '4079555010',
      zip: '32817',
    };
    const result = validateLead(minimal, VALIDATE_OPTS);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.email).toBe('');
    expect(result.data.location).toBe('');
  });

  it('passes through Spanish locale', () => {
    const result = validateLead(
      { ...baseGoodLead, locale: 'es' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.locale).toBe('es');
  });

  it('uses generated confirmation id when client supplies invalid one', () => {
    const result = validateLead(
      { ...baseGoodLead, confirmationId: '../../etc/passwd' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.confirmationId).toBe('BBC-GEN-12345');
  });

  it('honors a well-formed client confirmation id', () => {
    const result = validateLead(
      { ...baseGoodLead, confirmationId: 'BBC-VALID-1234' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.confirmationId).toBe('BBC-VALID-1234');
  });

  it('lowercases the email for storage consistency', () => {
    const result = validateLead(
      { ...baseGoodLead, email: 'MIXED.Case@Example.COM' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.email).toBe('mixed.case@example.com');
  });
});

describe('validateLead — honeypots', () => {
  it('rejects when website honeypot is filled', () => {
    const result = validateLead(
      { ...baseGoodLead, website: 'http://spam.example.com' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('honeypot');
  });

  it('rejects when botcheck honeypot is filled', () => {
    const result = validateLead(
      { ...baseGoodLead, botcheck: 'caught' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('honeypot');
  });

  it('accepts empty-string honeypots (the legitimate flow)', () => {
    const result = validateLead(
      { ...baseGoodLead, website: '', botcheck: '' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(true);
  });
});

describe('validateLead — phone validation', () => {
  it('rejects too-short phone', () => {
    const result = validateLead(
      { ...baseGoodLead, phone: '407' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_phone');
  });

  it('rejects 0000000000 (NANP area code starts with 0)', () => {
    const result = validateLead(
      { ...baseGoodLead, phone: '0000000000' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_phone_format');
  });

  it('rejects 1234567890 (NANP exchange starts with 4? area starts with 1)', () => {
    const result = validateLead(
      { ...baseGoodLead, phone: '1234567890' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_phone_format');
  });

  it('rejects 5555555555 (all-same-digit pattern)', () => {
    const result = validateLead(
      { ...baseGoodLead, phone: '5555555555' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_phone_format');
  });

  it('accepts a real-looking Florida 407 number', () => {
    const result = validateLead(
      { ...baseGoodLead, phone: '4079426459' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(true);
  });
});

describe('validateLead — email validation', () => {
  it('rejects missing @', () => {
    const result = validateLead(
      { ...baseGoodLead, email: 'no-at-sign.com' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_email');
  });

  it('rejects email-with-CRLF (header injection)', () => {
    const result = validateLead(
      { ...baseGoodLead, email: 'evil@x.com\nBcc: hijack@y.com' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_email');
  });

  it('treats empty email as not-collected (mobile-sim flow)', () => {
    const result = validateLead(
      { ...baseGoodLead, email: '' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.email).toBe('');
  });
});

describe('validateLead — name validation', () => {
  it('rejects single-character names', () => {
    const result = validateLead(
      { ...baseGoodLead, name: 'X' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_name');
  });

  it('rejects missing name', () => {
    const lead = { ...baseGoodLead };
    delete lead.name;
    const result = validateLead(lead, VALIDATE_OPTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_name');
  });

  it('rejects overlong names (length cap is rejection, not truncation)', () => {
    const result = validateLead(
      { ...baseGoodLead, name: 'A'.repeat(500) },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_name');
  });

  it('accepts a name exactly at the 80-char cap', () => {
    const result = validateLead(
      { ...baseGoodLead, name: 'A'.repeat(80) },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.name.length).toBe(80);
  });
});

describe('validateLead — zip validation', () => {
  it('rejects 4-digit zip', () => {
    const result = validateLead(
      { ...baseGoodLead, zip: '3281' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(false);
    // Could be 'invalid_zip' (length check) — both are valid
    if (!result.ok) expect(['invalid_zip', 'invalid_zip_format']).toContain(result.reason);
  });

  it('rejects letters in zip', () => {
    const result = validateLead(
      { ...baseGoodLead, zip: '3281Z' },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid_zip_format');
  });

  it('treats null/undefined/empty zip as not-collected', () => {
    const result = validateLead(
      { ...baseGoodLead, zip: undefined },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(true);
  });
});

describe('validateLead — message length', () => {
  it('drops the message field silently when over the 4000-char cap', () => {
    // Oversized message → isStr fails → defaults to '' rather than
    // rejecting the whole submission. Justified: a customer who
    // accidentally pasted a long block doesn't lose the lead.
    const result = validateLead(
      { ...baseGoodLead, message: 'X'.repeat(8000) },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.message).toBe('');
  });

  it('accepts a message exactly at the 4000-char cap', () => {
    const result = validateLead(
      { ...baseGoodLead, message: 'X'.repeat(4000) },
      VALIDATE_OPTS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.message.length).toBe(4000);
  });
});
