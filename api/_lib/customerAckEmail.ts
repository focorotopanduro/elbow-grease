/**
 * Customer-facing acknowledgement email — sent to the lead's email
 * address (when provided) immediately after their request lands at
 * /api/leads. This is the "we got your request, here's what happens
 * next" email that mature lead-gen sites send to reduce phantom-resubmit
 * rate and reinforce trust.
 *
 * Bilingual: renders in English (default) or Spanish based on the
 * `locale` field of the payload. /api/leads picks the locale from the
 * client-supplied `locale` field on the JSON body, falling back to the
 * `Accept-Language` header. The Spanish copy is for the substantial
 * Florida Spanish-speaking customer base; the brand chrome stays
 * identical so a customer who toggles their browser language doesn't
 * feel like they got a different (less-trusted) email.
 *
 * Design goals (different from the operations email):
 *   - WARM, not transactional. The customer is making a stressed
 *     decision (storm damage, deadline, contractor doesn't return calls);
 *     this email should feel like a person, not a robot.
 *   - SET EXPECTATIONS. Tell the customer when they'll be called.
 *   - TRUST ANCHOR. Show the DBPR licenses + license verification URL.
 *     A hesitant customer should be able to verify legitimacy in one
 *     click before the call comes.
 *   - ONE PRIMARY CTA. "Reply with photos" — gives the customer a
 *     proactive next step that pre-loads value into the eventual call.
 *   - RECEIPT. Confirmation ID prominently displayed; same one shown
 *     on the success card on the site so the customer can match them.
 *
 * SECURITY:
 *   - Same escapeHtml + recipient validation flow as the ops email.
 *   - From: address must be at a verified domain.
 *   - Subject + custom headers stripped of CR/LF before send.
 *   - We deliberately DO NOT include any data the customer didn't
 *     submit — no IP, no user-agent, no analytics IDs.
 */

import { escapeHtml } from './email';

export type CustomerAckLocale = 'en' | 'es';

export interface CustomerAckPayload {
  /** Customer's name as entered (sanitized). */
  name: string;
  /** Customer's email — MUST be present (caller's job to skip if not). */
  email: string;
  /** Confirmation ID. Same one stored in KV + shown on the site. */
  confirmationId: string;
  /** ISO timestamp the lead was received. */
  ts: string;
  /** Service category from the form. */
  service?: string;
  /** Free-text project notes. */
  message?: string;
  /** Property location (the user's free-text city/area). */
  location?: string;
  /** Smart-path priority — drives the call-window text. */
  priority?: 'call-first' | 'estimate-first' | 'scope-first' | 'work-order';
  /** Pre-computed call-window text from the front-end. When present,
   *  used verbatim — keeps the email perfectly consistent with what the
   *  success card showed. Already in the customer's locale (front-end
   *  already localized it). */
  callWindow?: string;
  /** Email body language. Default `'en'`. Set `'es'` to render the
   *  Spanish version. /api/leads chooses based on the request body or
   *  Accept-Language header. */
  locale?: CustomerAckLocale;
}

/* ─── String catalog ──────────────────────────────────────────────── */

interface AckStrings {
  htmlLang: string;
  inboxKicker: string;
  receiptLabel: string;
  greetingTitle: (firstName: string) => string;
  ackBody: (callWindow: string, phoneLink: string, phoneText: string) => string;
  yourRequestHeading: string;
  rowConfirmation: string;
  rowReceived: string;
  rowService: string;
  rowLocation: string;
  notesHeading: string;
  whatNextHeading: string;
  steps: (callWindow: string) => string[];
  replyTitle: string;
  replyBody: string;
  verifyHeading: string;
  verifyIntro: string;
  licenseRoof: string;
  licenseGc: string;
  verifyCta: string;
  receivedBecause: (confirmationId: string) => string;
  subject: (firstName: string, confirmationId: string) => string;
  preheader: (confirmationId: string, callWindow: string) => string;
  defaultCallWindow: (
    priority?: CustomerAckPayload['priority'],
  ) => string;
  textHi: (firstName: string) => string;
  textIntro: (callWindow: string) => string;
  textRequestHeading: string;
  textConfirmation: string;
  textReceived: string;
  textService: string;
  textLocation: string;
  textWhatNextHeading: string;
  textStep1: string;
  textStep2: (callWindow: string) => string;
  textStep3: string;
  textReplyWithMessage: string;
  textReplyNoMessage: string;
  textCallSooner: string;
  textVerifyHeading: string;
  textLicenseRoof: string;
  textLicenseGc: string;
  textVerifyUrl: string;
  textCloser: (confirmationId: string) => string;
}

const STRINGS_EN: AckStrings = {
  htmlLang: 'en',
  inboxKicker: 'We received your request',
  receiptLabel: 'Estimate&nbsp;Receipt',
  greetingTitle: (firstName) =>
    `Hi ${firstName} — thank&nbsp;you for reaching out.`,
  ackBody: (callWindow, phoneLink, phoneText) =>
    `A team member will call you <strong>${callWindow}</strong>. If you need us sooner, the office line is <a href="${phoneLink}" style="color:#0a0908;border-bottom:1px solid #d4af37;text-decoration:none;">${phoneText}</a> during business hours.`,
  yourRequestHeading: 'Your request',
  rowConfirmation: 'Confirmation',
  rowReceived: 'Received',
  rowService: 'Service',
  rowLocation: 'Location',
  notesHeading: 'Notes you sent us',
  whatNextHeading: 'What happens next',
  steps: (callWindow) => [
    'We review your request, the property location, and the service type.',
    `We call you at the number you provided <strong>${callWindow}</strong>.`,
    'We schedule a free on-site or photo-based estimate based on what you need.',
  ],
  replyTitle: 'Reply with photos or context',
  replyBody:
    'Replying to this email lands directly with our team. Photos of the damage, your insurance claim number, a deadline, or any access notes — all of it makes the call shorter and the estimate sharper.',
  verifyHeading: 'Verify our licenses',
  verifyIntro:
    'Florida DBPR &mdash; we encourage every customer to verify.',
  licenseRoof: 'Certified Roofing Contractor',
  licenseGc: 'Certified General Contractor',
  verifyCta: 'Verify on myfloridalicense.com →',
  receivedBecause: (confirmationId) =>
    `You are receiving this because you submitted an estimate request at beitbuilding.com (Confirmation ${confirmationId}). If that wasn&rsquo;t you, you can safely ignore this email &mdash; no further messages will come unless you reach out again.`,
  subject: (firstName, confirmationId) =>
    `${firstName}, we received your Beit Building estimate request (${confirmationId})`,
  preheader: (confirmationId, callWindow) =>
    `We received your request — confirmation ${confirmationId}. We'll call you ${callWindow}.`,
  defaultCallWindow: (priority) => {
    switch (priority) {
      case 'call-first':
        return 'within the next hour during business hours';
      case 'work-order':
        return 'today during business hours';
      case 'scope-first':
      case 'estimate-first':
      default:
        return 'within one business day';
    }
  },
  textHi: (firstName) => `Hi ${firstName},`,
  textIntro: (callWindow) =>
    `Thanks for reaching out to Beit Building Contractors. We received your estimate request and a team member will call you ${callWindow}.`,
  textRequestHeading: '── Your request ──',
  textConfirmation: 'Confirmation:  ',
  textReceived:     'Received:      ',
  textService:      'Service:       ',
  textLocation:     'Location:      ',
  textWhatNextHeading: 'What happens next:',
  textStep1: '  1. We review your request, the property location, and the service type.',
  textStep2: (callWindow) => `  2. We call the number you provided ${callWindow}.`,
  textStep3: '  3. We schedule a free on-site or photo-based estimate based on what you need.',
  textReplyWithMessage:
    "If anything changed since you wrote in (new photos, an updated insurance claim number, a deadline, or a new question), reply to this email — we'll see it before the call.",
  textReplyNoMessage:
    'Reply to this email any time with photos, the insurance claim number, or anything that helps us get the right team there. The reply lands directly with our team.',
  textCallSooner:
    'If you need us sooner, call (407) 942-6459 — we answer during business hours.',
  textVerifyHeading: '── Verify our licenses ──',
  textLicenseRoof: 'Florida DBPR Certified Roofing Contractor: CCC1337413',
  textLicenseGc: 'Florida DBPR Certified General Contractor: CGC1534077',
  textVerifyUrl: 'Verify either license at: https://www.myfloridalicense.com/wl11.asp',
  textCloser: (confirmationId) =>
    `This is an acknowledgement of confirmation ${confirmationId}. If you didn't request an estimate, you can safely ignore this email — no further messages will come unless you reach out again.`,
};

const STRINGS_ES: AckStrings = {
  htmlLang: 'es',
  inboxKicker: 'Recibimos tu solicitud',
  receiptLabel: 'Recibo&nbsp;de&nbsp;Estimado',
  greetingTitle: (firstName) =>
    `Hola ${firstName} — gracias por escribirnos.`,
  ackBody: (callWindow, phoneLink, phoneText) =>
    `Un miembro de nuestro equipo te llamará <strong>${callWindow}</strong>. Si nos necesitas antes, la línea de la oficina es <a href="${phoneLink}" style="color:#0a0908;border-bottom:1px solid #d4af37;text-decoration:none;">${phoneText}</a> durante horario de oficina.`,
  yourRequestHeading: 'Tu solicitud',
  rowConfirmation: 'Confirmación',
  rowReceived: 'Recibido',
  rowService: 'Servicio',
  rowLocation: 'Ubicación',
  notesHeading: 'Notas que nos enviaste',
  whatNextHeading: 'Qué pasa ahora',
  steps: (callWindow) => [
    'Revisamos tu solicitud, la ubicación y el tipo de servicio.',
    `Te llamamos al número que nos dejaste <strong>${callWindow}</strong>.`,
    'Programamos un estimado gratis (en sitio o por fotos) según tu necesidad.',
  ],
  replyTitle: 'Responde con fotos o contexto',
  replyBody:
    'Cuando respondes a este correo, llega directo a nuestro equipo. Fotos del daño, número de reclamo del seguro, una fecha límite o notas de acceso — todo eso hace la llamada más corta y el estimado más exacto.',
  verifyHeading: 'Verifica nuestras licencias',
  verifyIntro:
    'Florida DBPR &mdash; te invitamos a verificar antes de la llamada.',
  licenseRoof: 'Contratista Certificado de Techos',
  licenseGc: 'Contratista Certificado General',
  verifyCta: 'Verificar en myfloridalicense.com →',
  receivedBecause: (confirmationId) =>
    `Recibes este correo porque enviaste una solicitud de estimado en beitbuilding.com (Confirmación ${confirmationId}). Si no fuiste tú, puedes ignorar este correo con tranquilidad &mdash; no recibirás más mensajes a menos que nos vuelvas a contactar.`,
  subject: (firstName, confirmationId) =>
    `${firstName}, recibimos tu solicitud de estimado en Beit Building (${confirmationId})`,
  preheader: (confirmationId, callWindow) =>
    `Recibimos tu solicitud — confirmación ${confirmationId}. Te llamaremos ${callWindow}.`,
  defaultCallWindow: (priority) => {
    switch (priority) {
      case 'call-first':
        return 'dentro de la próxima hora durante horario de oficina';
      case 'work-order':
        return 'hoy durante horario de oficina';
      case 'scope-first':
      case 'estimate-first':
      default:
        return 'dentro de un día hábil';
    }
  },
  textHi: (firstName) => `Hola ${firstName},`,
  textIntro: (callWindow) =>
    `Gracias por contactar a Beit Building Contractors. Recibimos tu solicitud de estimado y un miembro de nuestro equipo te llamará ${callWindow}.`,
  textRequestHeading: '── Tu solicitud ──',
  textConfirmation: 'Confirmación: ',
  textReceived:     'Recibido:     ',
  textService:      'Servicio:     ',
  textLocation:     'Ubicación:    ',
  textWhatNextHeading: 'Qué pasa ahora:',
  textStep1: '  1. Revisamos tu solicitud, la ubicación y el tipo de servicio.',
  textStep2: (callWindow) => `  2. Te llamamos al número que nos dejaste ${callWindow}.`,
  textStep3: '  3. Programamos un estimado gratis según lo que necesites.',
  textReplyWithMessage:
    'Si algo cambió desde que escribiste (fotos nuevas, número de reclamo actualizado, una fecha límite, una pregunta nueva), responde a este correo — lo veremos antes de la llamada.',
  textReplyNoMessage:
    'Responde a este correo cuando quieras con fotos, el número del reclamo del seguro, o cualquier información que nos ayude a llevar el equipo correcto. La respuesta llega directo a nuestro equipo.',
  textCallSooner:
    'Si nos necesitas antes, llama al (407) 942-6459 — atendemos durante horario de oficina.',
  textVerifyHeading: '── Verifica nuestras licencias ──',
  textLicenseRoof: 'Florida DBPR Contratista Certificado de Techos: CCC1337413',
  textLicenseGc: 'Florida DBPR Contratista Certificado General: CGC1534077',
  textVerifyUrl: 'Verifica cualquier licencia en: https://www.myfloridalicense.com/wl11.asp',
  textCloser: (confirmationId) =>
    `Este es el acuse de recibo de la confirmación ${confirmationId}. Si no solicitaste un estimado, puedes ignorar este correo — no recibirás más mensajes a menos que nos vuelvas a contactar.`,
};

function stringsFor(locale: CustomerAckLocale | undefined): AckStrings {
  return locale === 'es' ? STRINGS_ES : STRINGS_EN;
}

/* ─── Subject ───────────────────────────────────────────────────────── */

export function buildCustomerAckSubject(payload: CustomerAckPayload): string {
  const s = stringsFor(payload.locale);
  const firstName = payload.name.trim().split(/\s+/)[0] || (payload.locale === 'es' ? 'amigo' : 'there');
  return s.subject(firstName, payload.confirmationId);
}

/* ─── Call-window heuristic (mirrors src/lib/callWindow.ts) ─────────── */

function defaultCallWindow(payload: CustomerAckPayload): string {
  return stringsFor(payload.locale).defaultCallWindow(payload.priority);
}

function fmtReceived(ts: string, locale: CustomerAckLocale | undefined): string {
  const d = new Date(ts);
  if (Number.isNaN(d.valueOf())) return ts;
  // Both en-US and es-US render an America/New_York timestamp in the
  // visitor's expected dialect. Fall back to ISO if the runtime lacks
  // ICU (Vercel ships with full ICU, but this runs in tests too).
  try {
    return d.toLocaleString(locale === 'es' ? 'es-US' : 'en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return d.toISOString();
  }
}

/* ─── Plain-text body ───────────────────────────────────────────────── */

export function buildCustomerAckText(payload: CustomerAckPayload): string {
  const s = stringsFor(payload.locale);
  const callWindow = payload.callWindow || defaultCallWindow(payload);
  const firstName = payload.name.trim().split(/\s+/)[0] || (payload.locale === 'es' ? 'amigo' : 'there');
  const replyTrigger = payload.message?.trim()
    ? s.textReplyWithMessage
    : s.textReplyNoMessage;
  const lines: Array<string | null> = [
    s.textHi(firstName),
    '',
    s.textIntro(callWindow),
    '',
    s.textRequestHeading,
    `${s.textConfirmation}${payload.confirmationId}`,
    `${s.textReceived}${fmtReceived(payload.ts, payload.locale)}`,
    payload.service ? `${s.textService}${payload.service}` : null,
    payload.location ? `${s.textLocation}${payload.location}` : null,
    '',
    s.textWhatNextHeading,
    s.textStep1,
    s.textStep2(callWindow),
    s.textStep3,
    '',
    replyTrigger,
    '',
    s.textCallSooner,
    '',
    s.textVerifyHeading,
    s.textLicenseRoof,
    s.textLicenseGc,
    s.textVerifyUrl,
    '',
    '─────────────────────────────────────────',
    'Beit Building Contractors LLC',
    '2703 Dobbin Dr, Orlando FL 32817',
    '(407) 942-6459 · beitbuilding.com',
    '',
    s.textCloser(payload.confirmationId),
  ];
  return lines.filter((l): l is string => l !== null).join('\n');
}

/* ─── HTML body ─────────────────────────────────────────────────────── */

export function buildCustomerAckHtml(payload: CustomerAckPayload): string {
  const s = stringsFor(payload.locale);
  const firstName = escapeHtml(
    payload.name.trim().split(/\s+/)[0] || (payload.locale === 'es' ? 'amigo' : 'there'),
  );
  const callWindow = escapeHtml(payload.callWindow || defaultCallWindow(payload));
  const safeMessage = payload.message?.trim()
    ? escapeHtml(payload.message)
        .split(/\n{2,}/)
        .map((p) => `<p style="margin:0 0 12px 0;color:#3d3528;line-height:1.65;">${p.replace(/\n/g, '<br/>')}</p>`)
        .join('')
    : '';
  const requestRows: string[] = [];
  requestRows.push(rowHtml(s.rowConfirmation, payload.confirmationId));
  requestRows.push(rowHtml(s.rowReceived, fmtReceived(payload.ts, payload.locale)));
  if (payload.service) requestRows.push(rowHtml(s.rowService, payload.service));
  if (payload.location) requestRows.push(rowHtml(s.rowLocation, payload.location));

  const stepsHtml = s
    .steps(callWindow)
    .map(
      (step, idx) =>
        `<li style="margin-bottom:${idx < 2 ? '6px' : '0'};">${step}</li>`,
    )
    .join('');

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="${s.htmlLang}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<title>${escapeHtml(buildCustomerAckSubject(payload))}</title>
</head>
<body style="margin:0;padding:0;background:#0a0908;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1a1814;-webkit-font-smoothing:antialiased;">
<div style="display:none;font-size:1px;color:#0a0908;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${escapeHtml(s.preheader(payload.confirmationId, callWindow))}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0908;padding:24px 8px;">
<tr><td align="center">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#fffaf0;border-radius:8px;overflow:hidden;border:1px solid #d4af37;">

    <tr>
      <td style="padding:24px 28px 18px 28px;background:#0a0908;border-bottom:2px solid #d4af37;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-family:'Cormorant Garamond','Times New Roman',Georgia,serif;font-size:22px;font-weight:600;letter-spacing:0.04em;color:#d4af37;">
              Beit&nbsp;Building&nbsp;<em style="font-style:italic;color:#fff5d0;">Contractors</em>
            </td>
            <td align="right" style="font-family:'Inter',Arial,sans-serif;font-size:11px;color:#a39669;letter-spacing:0.12em;text-transform:uppercase;">
              ${s.receiptLabel}
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:30px 28px 8px 28px;">
        <p style="margin:0 0 6px 0;font-family:'Inter',Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#8a7a4e;">${escapeHtml(s.inboxKicker)}</p>
        <h1 style="margin:0 0 14px 0;font-family:'Cormorant Garamond','Times New Roman',Georgia,serif;font-size:32px;font-weight:600;line-height:1.15;color:#0a0908;">${s.greetingTitle(firstName)}</h1>
        <p style="margin:0 0 12px 0;font-family:'Inter',Arial,sans-serif;font-size:16px;color:#3d3528;line-height:1.6;">
          ${s.ackBody(callWindow, 'tel:4079426459', '(407)&nbsp;942-6459')}
        </p>
      </td>
    </tr>

    <tr>
      <td style="padding:18px 28px 0 28px;">
        <h2 style="margin:0 0 10px 0;font-family:'Bebas Neue','Inter',Arial,sans-serif;font-size:13px;letter-spacing:0.18em;color:#5a4a2a;text-transform:uppercase;">${escapeHtml(s.yourRequestHeading)}</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #ebe1c7;border-radius:6px;overflow:hidden;">
          ${requestRows.join('')}
        </table>
      </td>
    </tr>

    ${
      safeMessage
        ? `<tr>
      <td style="padding:22px 28px 0 28px;">
        <h2 style="margin:0 0 10px 0;font-family:'Bebas Neue','Inter',Arial,sans-serif;font-size:13px;letter-spacing:0.18em;color:#5a4a2a;text-transform:uppercase;">${escapeHtml(s.notesHeading)}</h2>
        <div style="padding:18px 20px;background:#fff;border:1px solid #ebe1c7;border-left:4px solid #d4af37;border-radius:6px;font-family:'Inter',Arial,sans-serif;font-size:15px;line-height:1.65;color:#1a1814;">
          ${safeMessage}
        </div>
      </td>
    </tr>`
        : ''
    }

    <tr>
      <td style="padding:22px 28px 0 28px;">
        <h2 style="margin:0 0 10px 0;font-family:'Bebas Neue','Inter',Arial,sans-serif;font-size:13px;letter-spacing:0.18em;color:#5a4a2a;text-transform:uppercase;">${escapeHtml(s.whatNextHeading)}</h2>
        <ol style="margin:0;padding-left:22px;font-family:'Inter',Arial,sans-serif;font-size:15px;color:#3d3528;line-height:1.7;">
          ${stepsHtml}
        </ol>
      </td>
    </tr>

    <tr>
      <td style="padding:22px 28px 0 28px;">
        <div style="padding:18px 20px;background:#f8f1dd;border:1px solid #e9dfc8;border-radius:6px;">
          <p style="margin:0 0 8px 0;font-family:'Bebas Neue','Inter',Arial,sans-serif;font-size:13px;color:#5a4a2a;letter-spacing:0.18em;text-transform:uppercase;">${escapeHtml(s.replyTitle)}</p>
          <p style="margin:0;font-family:'Inter',Arial,sans-serif;font-size:14px;color:#3d3528;line-height:1.6;">
            ${escapeHtml(s.replyBody)}
          </p>
        </div>
      </td>
    </tr>

    <tr>
      <td style="padding:22px 28px 0 28px;">
        <h2 style="margin:0 0 10px 0;font-family:'Bebas Neue','Inter',Arial,sans-serif;font-size:13px;letter-spacing:0.18em;color:#5a4a2a;text-transform:uppercase;">${escapeHtml(s.verifyHeading)}</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="padding:12px 16px;background:#fff;border:1px solid #ebe1c7;border-radius:6px;">
              <p style="margin:0 0 6px 0;font-family:'Inter',Arial,sans-serif;font-size:13px;color:#3d3528;font-weight:600;">${s.verifyIntro}</p>
              <p style="margin:0 0 4px 0;font-family:'Inter',Arial,sans-serif;font-size:14px;color:#1a1814;">
                ${escapeHtml(s.licenseRoof)} &middot; <strong>CCC1337413</strong>
              </p>
              <p style="margin:0 0 10px 0;font-family:'Inter',Arial,sans-serif;font-size:14px;color:#1a1814;">
                ${escapeHtml(s.licenseGc)} &middot; <strong>CGC1534077</strong>
              </p>
              <p style="margin:0;font-family:'Inter',Arial,sans-serif;font-size:13px;">
                <a href="https://www.myfloridalicense.com/wl11.asp" style="color:#0a0908;border-bottom:1px solid #d4af37;text-decoration:none;">${escapeHtml(s.verifyCta)}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="padding:30px 28px 28px 28px;border-top:1px solid #ebe1c7;background:#f5f0e6;">
        <p style="margin:0 0 6px 0;font-family:'Cormorant Garamond','Times New Roman',Georgia,serif;font-size:18px;color:#0a0908;font-weight:600;">Beit Building Contractors LLC</p>
        <p style="margin:0 0 4px 0;font-family:'Inter',Arial,sans-serif;font-size:13px;color:#3d3528;line-height:1.55;">
          (407) 942-6459 &middot; <a href="https://www.beitbuilding.com" style="color:#3d3528;border-bottom:1px solid #d4af37;text-decoration:none;">beitbuilding.com</a><br/>
          2703&nbsp;Dobbin&nbsp;Dr, Orlando&nbsp;FL&nbsp;32817
        </p>
        <p style="margin:14px 0 0 0;font-family:'Inter',Arial,sans-serif;font-size:11px;color:#8a7a4e;line-height:1.55;">
          ${s.receivedBecause(escapeHtml(payload.confirmationId))}
        </p>
      </td>
    </tr>
  </table>

</td></tr>
</table>
</body>
</html>`;
}

function rowHtml(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:10px 16px;background:#f5f0e6;border-bottom:1px solid #e9dfc8;font-family:'Inter',Arial,sans-serif;font-size:12px;font-weight:600;color:#5a4a2a;text-transform:uppercase;letter-spacing:0.06em;width:36%;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:10px 16px;background:#fff;border-bottom:1px solid #ebe1c7;font-family:'Inter',Arial,sans-serif;font-size:15px;color:#1a1814;line-height:1.5;vertical-align:top;">${escapeHtml(value)}</td>
    </tr>`;
}
