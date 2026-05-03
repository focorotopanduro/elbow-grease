/**
 * Server-side email transport — contract tests.
 *
 * Tests the parts that are reachable without a real provider key:
 *   - escapeHtml() correctness
 *   - resolveLeadRecipients() env-fallback behavior
 *   - sendEmail() returns the no_provider state when nothing configured
 *
 * The actual provider HTTP calls are not exercised here — they require
 * live API keys and would make the test suite flaky / expensive. The
 * provider integration is covered by manual `curl` smoke tests after
 * deploy (see docs/lead-routing.md "Test the email path").
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_OPERATIONS_EMAIL,
  escapeHtml,
  resolveLeadRecipients,
  sendEmail,
} from './email';

const PROVIDER_KEYS = [
  'RESEND_API_KEY',
  'SENDGRID_API_KEY',
  'MAILCHANNELS_API_KEY',
  'EMAIL_WEBHOOK_URL',
] as const;

const RECIPIENT_KEYS = ['LEAD_NOTIFY_TO', 'LEAD_NOTIFY_CC'] as const;

let savedEnv: Partial<Record<string, string | undefined>>;

beforeEach(() => {
  savedEnv = {};
  for (const k of [...PROVIDER_KEYS, ...RECIPIENT_KEYS]) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('escapeHtml', () => {
  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
    expect(escapeHtml(`Don't & "do" this`)).toBe(
      'Don&#39;t &amp; &quot;do&quot; this',
    );
  });

  it('passes through plain ASCII unchanged', () => {
    expect(escapeHtml('Plain text 123')).toBe('Plain text 123');
  });

  it('coerces non-string input to string before escaping', () => {
    // @ts-expect-error — explicit non-string to verify coercion safety
    expect(escapeHtml(123)).toBe('123');
  });
});

describe('resolveLeadRecipients', () => {
  it('falls back to the default operations email when env unset', () => {
    const { to, cc } = resolveLeadRecipients();
    expect(to).toEqual([DEFAULT_OPERATIONS_EMAIL]);
    expect(cc).toEqual([]);
  });

  it('uses LEAD_NOTIFY_TO env when configured', () => {
    process.env.LEAD_NOTIFY_TO = 'ops@example.com';
    const { to } = resolveLeadRecipients();
    expect(to).toEqual(['ops@example.com']);
  });

  it('parses comma-separated LEAD_NOTIFY_TO into multiple recipients', () => {
    process.env.LEAD_NOTIFY_TO = 'a@example.com, b@example.com,c@example.com';
    const { to } = resolveLeadRecipients();
    expect(to).toEqual([
      'a@example.com',
      'b@example.com',
      'c@example.com',
    ]);
  });

  it('parses LEAD_NOTIFY_CC into the cc array', () => {
    process.env.LEAD_NOTIFY_CC = 'backup@example.com,team@example.com';
    const { cc } = resolveLeadRecipients();
    expect(cc).toEqual(['backup@example.com', 'team@example.com']);
  });

  it('drops invalid email addresses silently (defense in depth)', () => {
    process.env.LEAD_NOTIFY_TO = 'good@example.com,not-an-email,evil@x.com\nBcc:hijack@y.com';
    const { to } = resolveLeadRecipients();
    expect(to).toEqual(['good@example.com']);
  });

  it('caller-supplied addresses override env', () => {
    process.env.LEAD_NOTIFY_TO = 'env@example.com';
    const { to } = resolveLeadRecipients('caller@example.com');
    expect(to).toEqual(['caller@example.com']);
  });
});

describe('sendEmail with no providers configured', () => {
  it('returns ok:false with no_provider_configured reason', async () => {
    const result = await sendEmail({
      to: 'test@example.com',
      subject: 'hi',
      text: 'plain',
      html: '<p>html</p>',
    });
    expect(result).toEqual({
      ok: false,
      provider: null,
      reason: 'no_provider_configured',
    });
  });
});

describe('default operations recipient', () => {
  it('matches the documented mom-email fallback', () => {
    expect(DEFAULT_OPERATIONS_EMAIL).toBe('sandravasquezcgc@gmail.com');
  });
});
