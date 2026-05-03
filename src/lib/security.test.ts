/**
 * Security helpers — contract tests.
 *
 * These tests lock the SECURITY behavior, not just functional correctness.
 * If anyone changes the regex patterns or removes a sanitization step,
 * these fail and the reviewer is forced to surface why. The mailto:
 * header-injection vector in particular is the kind of bug that's
 * trivial to reintroduce by accident.
 */
import { describe, it, expect } from 'vitest';
import {
  isPlausiblePhone,
  isPlausibleZip,
  safeJsonLd,
  sanitizeForMailto,
  stripCRLF,
  stripControlChars,
} from './security';

describe('stripCRLF', () => {
  it('strips CR and LF', () => {
    expect(stripCRLF('hello\r\nworld')).toBe('hello world');
  });

  it('strips Unicode line separator U+2028', () => {
    // U+2028 = LINE SEPARATOR — recognized as a line break by some
    // mail clients even though it's not the canonical SMTP CRLF.
    // Constructed via String.fromCharCode so the source file stays
    // free of literal control codepoints.
    const lineSep = String.fromCharCode(0x2028);
    expect(stripCRLF(`hello${lineSep}world`)).toBe('hello world');
  });

  it('strips Unicode paragraph separator U+2029', () => {
    const paraSep = String.fromCharCode(0x2029);
    expect(stripCRLF(`hello${paraSep}world`)).toBe('hello world');
  });

  it('collapses multiple consecutive line terminators into one space', () => {
    expect(stripCRLF('a\r\n\r\nb')).toBe('a b');
  });

  it('leaves single-line text untouched', () => {
    expect(stripCRLF('Sandra Martinez')).toBe('Sandra Martinez');
  });
});

describe('sanitizeForMailto', () => {
  it('strips line breaks, trims, and caps length', () => {
    const malicious = '  Sandra\r\nBcc: attacker@evil.com  ';
    const result = sanitizeForMailto(malicious, 80);
    expect(result).not.toContain('\r');
    expect(result).not.toContain('\n');
    expect(result).toBe('Sandra Bcc: attacker@evil.com');
  });

  it('caps length defensively', () => {
    const long = 'a'.repeat(500);
    expect(sanitizeForMailto(long, 80)).toHaveLength(80);
  });

  it('handles empty input', () => {
    expect(sanitizeForMailto('', 80)).toBe('');
  });

  it('strips control chars when piped through stripControlChars first', () => {
    const withNull = `Sandra${String.fromCharCode(0)}Martinez`;
    expect(stripControlChars(withNull)).toBe('SandraMartinez');
  });
});

describe('safeJsonLd', () => {
  it('escapes </script in string values', () => {
    const obj = { name: 'evil </script><script>alert(1)</script>' };
    const result = safeJsonLd(obj);
    expect(result).not.toContain('</script>');
    expect(result).toContain('<\\/script>');
  });

  it('preserves JSON validity after escaping', () => {
    const obj = { evil: 'a </script> b' };
    const result = safeJsonLd(obj);
    // The escaped output still parses — JSON.parse honors the
    // backslash-slash sequence as a regular forward slash.
    expect(JSON.parse(result)).toEqual(obj);
  });

  it('handles deeply nested objects', () => {
    const obj = { a: { b: [{ c: 'safe' }] } };
    expect(JSON.parse(safeJsonLd(obj))).toEqual(obj);
  });
});

describe('isPlausiblePhone', () => {
  it('accepts valid 10-digit US phone numbers', () => {
    expect(isPlausiblePhone('4075550101')).toBe(true);
    expect(isPlausiblePhone('2125551234')).toBe(true);
    expect(isPlausiblePhone('9095559876')).toBe(true);
  });

  it('rejects wrong length', () => {
    expect(isPlausiblePhone('407555010')).toBe(false);
    expect(isPlausiblePhone('40755501010')).toBe(false);
    expect(isPlausiblePhone('')).toBe(false);
  });

  it('rejects 0/1 leading digit (NANP rule)', () => {
    expect(isPlausiblePhone('0075550101')).toBe(false);
    expect(isPlausiblePhone('1075550101')).toBe(false);
  });

  it('rejects 000 / 911 area codes', () => {
    expect(isPlausiblePhone('0005550101')).toBe(false);
    expect(isPlausiblePhone('9115550101')).toBe(false);
  });

  it('rejects all-same-digit', () => {
    expect(isPlausiblePhone('4444444444')).toBe(false);
    expect(isPlausiblePhone('9999999999')).toBe(false);
  });
});

describe('isPlausibleZip', () => {
  it('accepts valid 5-digit ZIPs', () => {
    expect(isPlausibleZip('32817')).toBe(true);
    expect(isPlausibleZip('10001')).toBe(true);
  });

  it('rejects wrong length', () => {
    expect(isPlausibleZip('3281')).toBe(false);
    expect(isPlausibleZip('328170')).toBe(false);
  });

  it('rejects non-digit characters', () => {
    expect(isPlausibleZip('3281a')).toBe(false);
    expect(isPlausibleZip('32-17')).toBe(false);
  });

  it('rejects 00000', () => {
    expect(isPlausibleZip('00000')).toBe(false);
  });

  it('rejects all-same-digit', () => {
    expect(isPlausibleZip('11111')).toBe(false);
    expect(isPlausibleZip('99999')).toBe(false);
  });
});

describe('stripControlChars', () => {
  it('strips null bytes', () => {
    expect(stripControlChars(`Sandra${String.fromCharCode(0)}Martinez`)).toBe('SandraMartinez');
  });

  it('strips DEL (\\x7F)', () => {
    expect(stripControlChars(`a${String.fromCharCode(0x7f)}b`)).toBe('ab');
  });

  it('preserves printable characters', () => {
    expect(stripControlChars('Sandra Martinez (407) 555-0101')).toBe(
      'Sandra Martinez (407) 555-0101'
    );
  });
});
