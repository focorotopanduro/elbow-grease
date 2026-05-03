/**
 * Lead notification template — contract tests.
 *
 * These tests lock the externally-visible properties of the email
 * template that operations relies on:
 *   - Subject formatting (URGENT prefix when call-first priority)
 *   - HTML body contains all customer/project/operations data
 *   - HTML body escapes user-supplied data (no XSS via name/message)
 *   - Plain-text body is parseable by basic mail clients
 *   - tel:/mailto: links use stripped-digit-only / encoded forms
 */
import { describe, expect, it } from 'vitest';
import {
  buildLeadEmailHtml,
  buildLeadEmailSubject,
  buildLeadEmailText,
  type LeadEmailPayload,
} from './leadEmail';

const baseLead: LeadEmailPayload = {
  confirmationId: 'BBC-TEST-1234',
  ts: '2026-05-02T15:00:00.000Z',
  name: 'Maria Vasquez',
  phone: '(407) 555-0123',
  email: 'maria@example.com',
  zip: '32817',
  location: 'Audubon Park, Orlando',
  clientType: 'Storm / weather event',
  preferredContact: 'WhatsApp',
  service: 'Roof repair or storm damage',
  message: 'Hurricane Nicole damaged the back slope. Photos available.',
  source: 'website_contact_form',
  pageUrl: 'https://www.beitbuilding.com/',
  route: {
    label: 'Storm path',
    priority: 'call-first',
    intent: 'active_leak',
    contingency: 'Tarp + photo set',
    proof: 'Storm imagery, prior tarp work',
  },
  operations: {
    bucket: 'storm',
    urgency: 'Within 6 hours',
    recommendedFollowUp: 'Call first. Confirm active leak, water entry, tarp need.',
  },
};

describe('buildLeadEmailSubject', () => {
  it('prefixes [BBC ❗ CALL FIRST] for call-first priority', () => {
    expect(buildLeadEmailSubject(baseLead)).toContain('[BBC ❗ CALL FIRST]');
  });

  it('prefixes [BBC] for non-urgent priorities', () => {
    const lead = { ...baseLead, route: { ...baseLead.route!, priority: 'estimate-first' } };
    const subject = buildLeadEmailSubject(lead);
    expect(subject.startsWith('[BBC]')).toBe(true);
    expect(subject).not.toContain('CALL FIRST');
  });

  it('shortens the customer name to first + last initial', () => {
    expect(buildLeadEmailSubject(baseLead)).toContain('Maria V.');
  });

  it('caps at 120 characters even with extreme inputs', () => {
    const lead = {
      ...baseLead,
      name: 'A'.repeat(80),
      service: 'B'.repeat(80),
      location: 'C'.repeat(80),
    };
    expect(buildLeadEmailSubject(lead).length).toBeLessThanOrEqual(120);
  });
});

describe('buildLeadEmailText', () => {
  const text = buildLeadEmailText(baseLead);

  it('includes the customer name + phone', () => {
    expect(text).toContain('Maria Vasquez');
    expect(text).toContain('(407) 555-0123');
    expect(text).toContain('Storm / weather event');
    expect(text).toContain('WhatsApp');
  });

  it('includes a digit-only tap-to-dial link', () => {
    expect(text).toContain('tel:4075550123');
  });

  it('includes a maps URL when location is supplied', () => {
    expect(text).toContain('https://maps.google.com/?q=Audubon%20Park%2C%20Orlando');
  });

  it('includes the urgency banner for the priority', () => {
    expect(text).toContain('CALL FIRST');
  });

  it('falls back to "(none provided)" when message is empty', () => {
    const text2 = buildLeadEmailText({ ...baseLead, message: '' });
    expect(text2).toContain('(none provided)');
  });

  it('renders the operations metadata block', () => {
    expect(text).toContain('storm');
    expect(text).toContain('Within 6 hours');
  });
});

describe('buildLeadEmailHtml', () => {
  const html = buildLeadEmailHtml(baseLead);

  it('escapes HTML in the customer name', () => {
    const xssLead = { ...baseLead, name: '<script>alert(1)</script>Mom' };
    const xssHtml = buildLeadEmailHtml(xssLead);
    expect(xssHtml).not.toContain('<script>alert(1)</script>');
    expect(xssHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes HTML in the message body', () => {
    const xssLead = {
      ...baseLead,
      message: '<img src=x onerror="alert(1)">Hurricane damage.',
    };
    const xssHtml = buildLeadEmailHtml(xssLead);
    expect(xssHtml).not.toMatch(/<img src=x onerror="alert\(1\)">/);
    expect(xssHtml).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
  });

  it('renders the doctype + viewport meta', () => {
    expect(html).toContain('<!DOCTYPE');
    expect(html).toContain('width=device-width');
  });

  it('renders the brand wordmark', () => {
    expect(html).toContain('Beit&nbsp;Building');
  });

  it('renders the urgency banner with the call-first label', () => {
    expect(html).toContain('CALL FIRST');
  });

  it('renders the selected client type and preferred follow-up channel', () => {
    expect(html).toContain('Storm / weather event');
    expect(html).toContain('Preferred contact');
    expect(html).toContain('WhatsApp');
  });

  it('includes a tel: CTA button with digit-only number', () => {
    expect(html).toContain('href="tel:4075550123"');
  });

  it('includes a mailto: reply CTA prefilled with the customer email', () => {
    expect(html).toContain('href="mailto:maria@example.com');
  });

  it('omits the email row when the lead has no email', () => {
    const noEmailLead = { ...baseLead, email: undefined };
    const html2 = buildLeadEmailHtml(noEmailLead);
    // The mailto: button should also be omitted
    expect(html2).not.toContain('href="mailto:');
  });

  it('renders the operations panel when operations data is present', () => {
    expect(html).toContain('storm'); // bucket
    expect(html).toContain('Within 6 hours'); // urgency
  });

  it('omits the operations panel when operations is undefined', () => {
    const noOps = { ...baseLead, operations: undefined };
    const html2 = buildLeadEmailHtml(noOps);
    expect(html2).not.toContain('Operations');
  });
});
