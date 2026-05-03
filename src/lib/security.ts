/**
 * Security helpers — input sanitization + safe encoding for
 * outbound payloads.
 *
 * The site never executes user-provided strings (no `dangerouslySet
 * InnerHTML` reaches a user value, no `eval`, no `new Function`),
 * so the threat model is narrower than a typical web app:
 *
 *   1. **Email header injection** via mailto: — if a user types CR/LF
 *      into the name field, the resulting mailto: URI could break out
 *      of the body and inject To:/Cc: headers. STRIP all CR/LF before
 *      building the URI.
 *   2. **Open-redirect** — never use user-provided strings as href
 *      destinations.
 *   3. **PII exposure in localStorage** — sensible TTL + scrub on
 *      successful submission (already done by useFormPersistence's
 *      `clear()` and the consumer calls it on success).
 *   4. **XSS via JSON-LD** — JSON.stringify safely escapes `<` and `>`
 *      sequences in `dangerouslySetInnerHTML` BUT only if the input
 *      is sanitized of `</script>`. The JSON-LD content is hand-
 *      authored static data so this is moot, but the `safeJsonLd`
 *      helper guarantees safety if it ever moves to dynamic data.
 *
 * Threat model NOT covered (server-side concerns):
 *   - SQL injection (no DB on the client)
 *   - CSRF (no auth tokens on the client)
 *   - HTTPS enforcement (server header)
 *   - DDoS (rate-limit at edge / CDN)
 */

/**
 * Pre-built regex matching every line-terminator a mail client might
 * honor: CR, LF, the Unicode line-separator (U+2028), and Unicode
 * paragraph-separator (U+2029). Built via the RegExp constructor with
 * \u escape sequences so the SOURCE FILE itself doesn't contain those
 * literal codepoints (which would confuse parsers + tooling). Cached
 * at module load.
 */
const LINE_TERMINATORS_REGEX = new RegExp('[\\r\\n\\u2028\\u2029]+', 'g');

/** Strip ALL line-terminator characters from a string. Critical for
 *  mailto: building since any line-break in the body/subject can
 *  inject SMTP headers (To, Cc, Bcc) — a known mailto: attack vector.
 *  Covers CR (\r), LF (\n), AND the Unicode line-separator code-
 *  points U+2028 and U+2029 (which some mail clients also honor as
 *  line breaks even though they're not the canonical SMTP CRLF). */
export function stripCRLF(s: string): string {
  return s.replace(LINE_TERMINATORS_REGEX, ' ');
}

/** Sanitize a value before placing it in a mailto: URI. Strips CR/LF,
 *  trims whitespace, and caps length defensively. The encode-URI step
 *  happens at the call site (so we don't double-encode if the caller
 *  does it themselves). */
export function sanitizeForMailto(s: string, maxLen = 200): string {
  return stripCRLF(s).trim().slice(0, maxLen);
}

/** Safely embed JSON-LD inside a `dangerouslySetInnerHTML`. The only
 *  concrete attack vector is a `</script>` substring inside a JSON
 *  string value breaking out of the script tag. We escape the closing
 *  bracket sequence so it can't terminate the script. */
export function safeJsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/<\/(script)/gi, '<\\/$1');
}

/** Reject obviously-broken phone numbers (too short / repeated digit
 *  pattern / area code 000 / etc) BEFORE we attempt delivery. Returns
 *  true if the digit string is plausible.
 *
 *  This isn't a real phone-number-validity check (would require a paid
 *  service like Twilio Lookup) — it's a cheap pre-flight that catches
 *  "555-555-5555" placeholder spam without bothering the backend. */
export function isPlausiblePhone(digits: string): boolean {
  if (digits.length !== 10) return false;
  // First digit can't be 0 or 1 (NANP rule)
  if (digits[0] === '0' || digits[0] === '1') return false;
  // Area code can't be 000 / 911 (placeholders + special)
  const areaCode = digits.slice(0, 3);
  if (areaCode === '000' || areaCode === '911') return false;
  // 555 area code is technically reserved + commonly used in fiction —
  // we allow it because real users sometimes mistype it for valid Florida
  // codes; the backend can reject if needed.
  // Reject all-same-digit (e.g. 4444444444)
  if (/^(\d)\1{9}$/.test(digits)) return false;
  return true;
}

/** Reject obviously-broken ZIPs. 5 digits, not all-zero, not all-same. */
export function isPlausibleZip(zip: string): boolean {
  if (!/^\d{5}$/.test(zip)) return false;
  if (zip === '00000') return false;
  if (/^(\d)\1{4}$/.test(zip)) return false;
  return true;
}

/** Strip control characters from any free-form input before storage
 *  or transmission. Catches null bytes, escape sequences, etc.
 *  Built via RegExp constructor for the same source-cleanliness
 *  reason as LINE_TERMINATORS_REGEX above. */
const CONTROL_CHARS_REGEX = new RegExp(
  '[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]',
  'g'
);
export function stripControlChars(s: string): string {
  return s.replace(CONTROL_CHARS_REGEX, '');
}
