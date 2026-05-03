/**
 * Customer-facing acknowledgement template — contract tests.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCustomerAckHtml,
  buildCustomerAckSubject,
  buildCustomerAckText,
  type CustomerAckPayload,
} from './customerAckEmail';

const baseAck: CustomerAckPayload = {
  name: 'Maria Vasquez',
  email: 'maria@example.com',
  confirmationId: 'BBC-TEST-1234',
  ts: '2026-05-02T15:00:00.000Z',
  service: 'Roof repair or storm damage',
  message: 'Hurricane damaged the back slope. Photos available.',
  location: 'Audubon Park, Orlando',
  priority: 'call-first',
};

describe('buildCustomerAckSubject', () => {
  it('opens with the customer first name for warmth', () => {
    expect(buildCustomerAckSubject(baseAck).startsWith('Maria,')).toBe(true);
  });

  it('includes the confirmation id', () => {
    expect(buildCustomerAckSubject(baseAck)).toContain('BBC-TEST-1234');
  });

  it('falls back to "there" when no name was captured', () => {
    const subject = buildCustomerAckSubject({ ...baseAck, name: '   ' });
    expect(subject.startsWith('there,')).toBe(true);
  });
});

describe('buildCustomerAckText', () => {
  const text = buildCustomerAckText(baseAck);

  it('uses a warm first-name greeting', () => {
    expect(text).toContain('Hi Maria,');
  });

  it('includes the confirmation id and service', () => {
    expect(text).toContain('BBC-TEST-1234');
    expect(text).toContain('Roof repair or storm damage');
  });

  it('includes the call-window text scaled to call-first priority', () => {
    expect(text.toLowerCase()).toContain('within the next hour');
  });

  it('includes the DBPR license verification URL', () => {
    expect(text).toContain('https://www.myfloridalicense.com/wl11.asp');
  });

  it('includes both license numbers', () => {
    expect(text).toContain('CCC1337413');
    expect(text).toContain('CGC1534077');
  });

  it('uses caller-supplied callWindow when present (avoids drift)', () => {
    const text2 = buildCustomerAckText({
      ...baseAck,
      callWindow: 'today before 6 PM ET',
    });
    expect(text2).toContain('today before 6 PM ET');
  });

  it('switches the reply-trigger language when no message was provided', () => {
    const text2 = buildCustomerAckText({ ...baseAck, message: '' });
    // Falls into the "Reply with photos…" generic copy
    expect(text2).toContain('Reply to this email any time with photos');
  });
});

describe('buildCustomerAckHtml', () => {
  const html = buildCustomerAckHtml(baseAck);

  it('escapes user input in the message body (XSS guard)', () => {
    const xssAck = {
      ...baseAck,
      message: '<script>alert(1)</script> Hurricane damage',
    };
    const xssHtml = buildCustomerAckHtml(xssAck);
    expect(xssHtml).not.toContain('<script>alert(1)</script>');
    expect(xssHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes user input in the customer name', () => {
    const xssAck = { ...baseAck, name: '<img onerror="alert(1)" src=x>' };
    const xssHtml = buildCustomerAckHtml(xssAck);
    expect(xssHtml).not.toMatch(/<img onerror="alert\(1\)" src=x>/);
  });

  it('renders the office phone tel: link', () => {
    expect(html).toContain('tel:4079426459');
  });

  it('renders the brand wordmark', () => {
    expect(html).toContain('Beit&nbsp;Building');
  });

  it('renders the receipt rows with confirmation id', () => {
    expect(html).toContain('BBC-TEST-1234');
  });

  it('includes the verify-license CTA', () => {
    expect(html).toContain('https://www.myfloridalicense.com/wl11.asp');
  });

  it('omits the message panel when no message was provided', () => {
    const html2 = buildCustomerAckHtml({ ...baseAck, message: '' });
    expect(html2).not.toContain('Notes you sent us');
  });

  it('uses a different call-window for estimate-first priority', () => {
    const estimate = buildCustomerAckHtml({ ...baseAck, priority: 'estimate-first' });
    expect(estimate).toContain('within one business day');
  });
});

describe('Spanish (es) localization', () => {
  const esBase = { ...baseAck, locale: 'es' as const };

  it('subject opens with Spanish "recibimos tu solicitud"', () => {
    expect(buildCustomerAckSubject(esBase)).toContain(
      'recibimos tu solicitud de estimado',
    );
  });

  it('plain-text opens with "Hola Maria,"', () => {
    expect(buildCustomerAckText(esBase)).toContain('Hola Maria,');
  });

  it('HTML body lang attribute is es', () => {
    expect(buildCustomerAckHtml(esBase)).toContain('<html lang="es"');
  });

  it('renders the Spanish call-window for call-first priority', () => {
    expect(buildCustomerAckText(esBase)).toContain(
      'dentro de la próxima hora durante horario de oficina',
    );
  });

  it('renders the Spanish license labels in HTML', () => {
    const html = buildCustomerAckHtml(esBase);
    expect(html).toContain('Contratista Certificado de Techos');
    expect(html).toContain('Contratista Certificado General');
  });

  it('renders the Spanish verify CTA', () => {
    const html = buildCustomerAckHtml(esBase);
    expect(html).toContain('Verificar en myfloridalicense.com');
  });

  it('uses Spanish fallback name when name is whitespace', () => {
    const subject = buildCustomerAckSubject({ ...esBase, name: '   ' });
    expect(subject.startsWith('amigo,')).toBe(true);
  });

  it('preserves XSS escapes in Spanish locale', () => {
    const xss = buildCustomerAckHtml({
      ...esBase,
      name: '<script>alert(1)</script>',
    });
    expect(xss).not.toContain('<script>alert(1)</script>');
  });
});
