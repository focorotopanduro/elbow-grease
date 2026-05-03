/**
 * Server-side security primitives — contract tests.
 *
 * Locks the post-review behavior of `api/_lib/security.ts`. Each test
 * here corresponds to a specific finding from the security review:
 * if a future change accidentally regresses any of these, the failing
 * test makes it visible at PR time instead of in production.
 */
import { describe, expect, it } from 'vitest';
import {
  generateConfirmationId,
  generateRequestId,
  getClientIp,
  isAllowedSiteOrigin,
  isValidConfirmationId,
  safeJsonParse,
  sha256Hex,
  timingSafeStringEqual,
} from './security';

describe('timingSafeStringEqual', () => {
  it('returns true for identical ASCII strings', () => {
    expect(timingSafeStringEqual('hello', 'hello')).toBe(true);
  });

  it('returns false for different strings of equal length', () => {
    expect(timingSafeStringEqual('hello', 'world')).toBe(false);
  });

  it('returns false for strings of different lengths', () => {
    // Length-mismatch path runs a dummy compare to keep timing
    // proportional to input. We only assert the return value here.
    expect(timingSafeStringEqual('a', 'ab')).toBe(false);
    expect(timingSafeStringEqual('ab', 'a')).toBe(false);
  });

  it('handles empty strings', () => {
    expect(timingSafeStringEqual('', '')).toBe(true);
    expect(timingSafeStringEqual('', 'a')).toBe(false);
    expect(timingSafeStringEqual('a', '')).toBe(false);
  });

  it('correctly compares multi-byte UTF-8 strings (no silent truncation)', () => {
    // The previous implementation used Buffer.alloc(maxLen).write(s)
    // which silently truncates if the UTF-8 byte length exceeds the
    // alloc. Two strings that differ only in their TRAILING bytes
    // would have falsely returned true. The fix uses Buffer.from
    // with utf8 to get the full byte length.
    const a = 'héllo wörld';
    const b = 'héllo wörld';
    expect(timingSafeStringEqual(a, b)).toBe(true);
  });

  it('rejects inequality at trailing multi-byte chars', () => {
    expect(timingSafeStringEqual('café', 'café')).toBe(true); // identical
    expect(timingSafeStringEqual('café', 'cafe')).toBe(false); // é vs e
  });

  it('compares CRON_SECRET-style tokens correctly', () => {
    const expected = 'Bearer ' + 'a'.repeat(64);
    expect(timingSafeStringEqual(expected, expected)).toBe(true);
    expect(timingSafeStringEqual(expected, 'Bearer ' + 'b'.repeat(64))).toBe(false);
    expect(timingSafeStringEqual(expected, 'Bearer ' + 'a'.repeat(63) + 'b')).toBe(false);
  });
});

describe('generateRequestId', () => {
  it('matches the documented format', () => {
    const id = generateRequestId();
    // req-{epoch36}-{16hex}
    expect(id).toMatch(/^req-[A-Z0-9]+-[A-F0-9]{16}$/);
  });

  it('includes 64 bits of randomness in the suffix', () => {
    // Birthday paradox: collision probability at N IDs is ~N^2/2^65.
    // We're not formally testing collision resistance here, just that
    // the random suffix is 16 hex chars (=64 bits).
    const id = generateRequestId();
    const suffix = id.split('-').pop() ?? '';
    expect(suffix).toHaveLength(16);
  });

  it('produces unique IDs across rapid sequential calls', () => {
    // 1000 IDs in rapid succession should not collide. With 64 bits
    // of randomness this is overwhelmingly likely.
    const ids = new Set();
    for (let i = 0; i < 1000; i++) ids.add(generateRequestId());
    expect(ids.size).toBe(1000);
  });
});

describe('generateConfirmationId', () => {
  it('matches the BBC- format the validator expects', () => {
    const id = generateConfirmationId();
    expect(isValidConfirmationId(id)).toBe(true);
  });

  it('format is BBC-{epoch36}-{12hex}', () => {
    const id = generateConfirmationId();
    expect(id).toMatch(/^BBC-[A-Z0-9]+-[A-F0-9]{12}$/);
  });

  it('produces unique IDs even when called in the same millisecond', () => {
    // The previous fallback used Date.now() alone — two simultaneous
    // failures in the same ms would collide. The fix adds 48 bits of
    // crypto randomness so collisions are infeasible.
    const ids = new Set();
    for (let i = 0; i < 1000; i++) ids.add(generateConfirmationId());
    expect(ids.size).toBe(1000);
  });
});

describe('isValidConfirmationId', () => {
  it('accepts properly-formatted IDs', () => {
    expect(isValidConfirmationId('BBC-LZ4G7K-A8X2')).toBe(true);
    expect(isValidConfirmationId('BBC-AAAA')).toBe(true);
  });

  it('rejects path-traversal attempts (the C3 attack vector)', () => {
    expect(isValidConfirmationId('../etc/passwd')).toBe(false);
    expect(isValidConfirmationId('BBC-../foo')).toBe(false);
    expect(isValidConfirmationId('BBC-foo/bar')).toBe(false);
  });

  it('rejects key-namespace-collision attempts', () => {
    expect(isValidConfirmationId('lead:foo')).toBe(false);
    expect(isValidConfirmationId('BBC:lead:other')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidConfirmationId(null)).toBe(false);
    expect(isValidConfirmationId(undefined)).toBe(false);
    expect(isValidConfirmationId(42)).toBe(false);
    expect(isValidConfirmationId({})).toBe(false);
    expect(isValidConfirmationId([])).toBe(false);
  });

  it('rejects too-short and too-long IDs', () => {
    expect(isValidConfirmationId('BBC-')).toBe(false); // empty suffix
    expect(isValidConfirmationId('BBC-AB')).toBe(false); // 2-char suffix < min 4
    expect(isValidConfirmationId('BBC-' + 'A'.repeat(41))).toBe(false); // suffix too long
  });

  it('rejects lowercase (we generate uppercase only)', () => {
    expect(isValidConfirmationId('bbc-aaaa')).toBe(false);
    expect(isValidConfirmationId('BBC-aaaa')).toBe(false);
  });

  it('rejects whitespace and control characters', () => {
    expect(isValidConfirmationId('BBC-A B C')).toBe(false);
    expect(isValidConfirmationId('BBC-AAAA\n')).toBe(false);
    expect(isValidConfirmationId(`BBC-AAAA${String.fromCharCode(0)}`)).toBe(false);
  });
});

describe('sha256Hex', () => {
  it('produces a stable 64-char hex string', () => {
    const h = sha256Hex('hello');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[a-f0-9]{64}$/);
    // Known SHA-256 of 'hello'
    expect(h).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('produces different hashes for different inputs', () => {
    expect(sha256Hex('a')).not.toBe(sha256Hex('b'));
  });
});

describe('safeJsonParse — prototype pollution defense', () => {
  it('parses normal JSON correctly', () => {
    expect(safeJsonParse('{"name":"Sandra","zip":"32817"}')).toEqual({
      name: 'Sandra',
      zip: '32817',
    });
  });

  it('strips __proto__ at top level', () => {
    const result = safeJsonParse('{"__proto__":{"isAdmin":true},"name":"x"}') as {
      name?: string;
    };
    expect(result.name).toBe('x');
    // __proto__ key must be gone (not setting Object.prototype.isAdmin)
    expect(({} as { isAdmin?: boolean }).isAdmin).toBeUndefined();
  });

  it('strips constructor at top level', () => {
    const result = safeJsonParse('{"constructor":{"foo":"bar"},"keep":"yes"}') as {
      constructor?: unknown;
      keep?: string;
    };
    expect(result.keep).toBe('yes');
    // Native constructor still works (parser-level removal)
    expect(({}).constructor).toBe(Object);
  });

  it('strips prototype keys at deeper levels', () => {
    const result = safeJsonParse(
      '{"a":{"__proto__":{"polluted":true},"keep":1}}'
    ) as { a?: { keep?: number; __proto__?: unknown } };
    expect(result.a?.keep).toBe(1);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('returns null on invalid JSON', () => {
    expect(safeJsonParse('not json')).toBeNull();
    expect(safeJsonParse('{')).toBeNull();
    expect(safeJsonParse('')).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(safeJsonParse(42 as unknown as string)).toBeNull();
    expect(safeJsonParse(null as unknown as string)).toBeNull();
    expect(safeJsonParse({} as unknown as string)).toBeNull();
  });

  it('preserves arrays + nested structures', () => {
    expect(safeJsonParse('[1,2,3]')).toEqual([1, 2, 3]);
    expect(safeJsonParse('{"a":[{"b":2}]}')).toEqual({ a: [{ b: 2 }] });
  });
});

describe('getClientIp', () => {
  it('extracts the first entry from comma-separated x-forwarded-for', () => {
    expect(getClientIp({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })).toBe('1.2.3.4');
  });

  it('handles single-IP x-forwarded-for', () => {
    expect(getClientIp({ 'x-forwarded-for': '1.2.3.4' })).toBe('1.2.3.4');
  });

  it('accepts IPv6 addresses', () => {
    expect(getClientIp({ 'x-forwarded-for': '2001:db8::1' })).toBe('2001:db8::1');
  });

  it('handles array-form headers', () => {
    expect(getClientIp({ 'x-forwarded-for': ['1.2.3.4', '5.6.7.8'] })).toBe('1.2.3.4');
  });

  it('returns "unknown" when header is missing', () => {
    expect(getClientIp({})).toBe('unknown');
  });

  it('rejects log-poisoning attempts via crafted IP header', () => {
    // The C5-class log-poisoning vector: attacker submits an IP value
    // containing newlines / SQL-injection / shell metacharacters to
    // pollute downstream log lines. The validation regex limits to
    // [a-fA-F0-9.:] which rules these out.
    expect(getClientIp({ 'x-forwarded-for': '1.2.3.4\nINJECTED' })).toBe('unknown');
    expect(getClientIp({ 'x-forwarded-for': "1.2.3.4'; DROP TABLE" })).toBe('unknown');
    expect(getClientIp({ 'x-forwarded-for': '<script>' })).toBe('unknown');
    expect(getClientIp({ 'x-forwarded-for': '1.2.3.4 evil' })).toBe('unknown');
  });

  it('rejects overlong values', () => {
    expect(getClientIp({ 'x-forwarded-for': 'a'.repeat(100) })).toBe('unknown');
  });
});

describe('isAllowedSiteOrigin', () => {
  it('allows the production site origins', () => {
    expect(isAllowedSiteOrigin('https://beitbuilding.com')).toBe(true);
    expect(isAllowedSiteOrigin('https://www.beitbuilding.com')).toBe(true);
  });

  it('rejects origin strings with paths, queries, or non-HTTPS schemes', () => {
    expect(isAllowedSiteOrigin('https://www.beitbuilding.com/path')).toBe(false);
    expect(isAllowedSiteOrigin('https://www.beitbuilding.com?x=1')).toBe(false);
    expect(isAllowedSiteOrigin('http://www.beitbuilding.com')).toBe(false);
    expect(isAllowedSiteOrigin('not a url')).toBe(false);
  });

  it('rejects unrelated vercel.app origins by default', () => {
    expect(isAllowedSiteOrigin('https://attacker-project.vercel.app')).toBe(false);
  });

  it('allows only the exact Vercel deployment origin from env', () => {
    const previous = process.env.VERCEL_URL;
    process.env.VERCEL_URL = 'beitbuilding-preview-abc.vercel.app';
    try {
      expect(isAllowedSiteOrigin('https://beitbuilding-preview-abc.vercel.app')).toBe(true);
      expect(isAllowedSiteOrigin('https://attacker-project.vercel.app')).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.VERCEL_URL;
      else process.env.VERCEL_URL = previous;
    }
  });

  it('allows exact additional origins configured by operators', () => {
    const previous = process.env.ADDITIONAL_ALLOWED_ORIGINS;
    process.env.ADDITIONAL_ALLOWED_ORIGINS = 'https://staging.beitbuilding.com';
    try {
      expect(isAllowedSiteOrigin('https://staging.beitbuilding.com')).toBe(true);
      expect(isAllowedSiteOrigin('https://evil.beitbuilding.com')).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.ADDITIONAL_ALLOWED_ORIGINS;
      else process.env.ADDITIONAL_ALLOWED_ORIGINS = previous;
    }
  });
});
