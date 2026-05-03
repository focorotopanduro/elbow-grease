/**
 * Lead notification email — composes the rich HTML + plain-text bodies
 * sent to the operations contact (mom / sandravasquezcgc@gmail.com by
 * default) every time a new lead lands at /api/leads.
 *
 * Design goals:
 *   - Read at a glance on a phone screen (priority badge top-of-fold,
 *     name + phone next, everything else below).
 *   - One-tap action buttons that work in Gmail / Apple Mail / Outlook:
 *     "Call now" (tel:), "Reply via email" (mailto:), "Open in Maps".
 *   - Bilingual-aware: route badges + headings stay short so they don't
 *     wrap awkwardly when localization is added later.
 *   - Brand-consistent: gold (#d4af37) + ink (#0a0908) + warm cream
 *     (#f5f0e6) — same palette the marketing site uses.
 *   - Plain-text fallback that's actually useful (every action link
 *     available, fields legible, no markdown noise).
 *
 * SECURITY:
 *   - Every dynamic value is escaped via escapeHtml() from email.ts
 *     before insertion. The template never interpolates raw input.
 *   - Tel: links have non-digit characters stripped to a numeric-only
 *     dial string so a crafted phone field can't smuggle URI params.
 *   - Mailto: links use encodeURIComponent on the subject + body.
 *   - All ANCHOR href values are constructed from already-validated
 *     input + a fixed scheme (tel:/mailto:/https://); no attacker-
 *     controlled URL construction reaches the template.
 *
 * MAINTENANCE:
 *   - The HTML uses inline styles ONLY (no <style> blocks, no external
 *     CSS) because Gmail / Outlook strip <style> tags and CSS-in-head.
 *     Inline is the universally supported lowest common denominator.
 *   - Width is capped at 600px which is the de-facto email standard
 *     (responsive on mobile, doesn't sprawl on desktop).
 *   - Tested in Gmail (web + iOS app), Apple Mail, Outlook 365 (web
 *     + macOS), and Yahoo. Render checks via Litmus when changing.
 */

import { escapeHtml } from './email';

/* ─── Lead shape (extends api/_lib/webhooks LeadPayload) ──────────── */

export interface LeadEmailPayload {
  /** Customer-facing confirmation id ("BBC-XXXX-XXXX"). */
  confirmationId: string;
  /** ISO 8601 timestamp the lead was received. */
  ts: string;
  /** Customer name, sanitized. */
  name: string;
  /** Phone number, display-formatted. */
  phone: string;
  /** Customer email, validated (or empty when not collected). */
  email?: string;
  /** ZIP / postal code. */
  zip?: string;
  /** Property location / city free-text. */
  location?: string;
  /** Customer segment chosen on the contact form. */
  clientType?: string;
  /** Visitor's preferred follow-up channel. */
  preferredContact?: string;
  /** Service category. */
  service?: string;
  /** Free-text project notes. */
  message?: string;
  /** Origin context — surface label or path. */
  source?: string;
  /** Origin page URL (when known). */
  pageUrl?: string;
  /** Smart-path routing details, when client picked one. */
  route?: {
    label: string;
    priority: string;
    intent: string;
    contingency: string;
    proof: string;
  } | null;
  /** Operations metadata calculated from the route + service. */
  operations?: {
    bucket: string;
    urgency: string;
    recommendedFollowUp: string;
  };
}

/* ─── Priority palette ──────────────────────────────────────────────── */

interface UrgencyTheme {
  /** Banner label. Short — fits in a single 600px-wide row. */
  label: string;
  /** Background color. */
  bg: string;
  /** Foreground color. */
  fg: string;
  /** Plain-text equivalent for the text body. */
  textLabel: string;
}

function urgencyThemeFor(priority?: string): UrgencyTheme {
  switch (priority) {
    case 'call-first':
      return {
        label: 'CALL FIRST · ACTIVE LEAK / STORM',
        bg: '#9a1d1d',
        fg: '#fff5f1',
        textLabel: '!!! CALL FIRST — ACTIVE LEAK / STORM !!!',
      };
    case 'work-order':
      return {
        label: 'WORK ORDER · MULTIPLE PROPERTIES',
        bg: '#1d4a9a',
        fg: '#f1f5ff',
        textLabel: '** WORK ORDER — MULTIPLE PROPERTIES **',
      };
    case 'scope-first':
      return {
        label: 'SCOPE REVIEW · DEPENDENCIES TO CONFIRM',
        bg: '#5a3a1a',
        fg: '#fff8ee',
        textLabel: '** SCOPE REVIEW — DEPENDENCIES TO CONFIRM **',
      };
    case 'estimate-first':
    default:
      return {
        label: 'ESTIMATE REQUEST · STANDARD FOLLOW-UP',
        bg: '#0a0908',
        fg: '#d4af37',
        textLabel: '~ ESTIMATE REQUEST — STANDARD FOLLOW-UP ~',
      };
  }
}

/* ─── Subject line ──────────────────────────────────────────────────── */

/**
 * Build the Subject line. Format optimized for Gmail's notification
 * preview where only ~60 chars show on Android lockscreen / Apple Watch:
 *
 *   [BBC] Storm Damage · Maria V. · 32817
 *   [BBC ❗ CALL FIRST] Maria V. · 4079... · Storm Damage
 *
 * The bracketed prefix signals "this is a lead notification" so a
 * filter rule (`subject:[BBC]`) catches them all.
 *
 * Stripping CR/LF + capping length is the email-transport's job
 * (stripHeaderInjection in email.ts), so this function focuses on
 * readability.
 */
export function buildLeadEmailSubject(lead: LeadEmailPayload): string {
  const priority = lead.route?.priority;
  const urgent = priority === 'call-first';
  const tag = urgent ? '[BBC ❗ CALL FIRST]' : '[BBC]';
  const route = lead.route?.label ?? lead.service ?? 'New lead';
  // Use first name + last initial to keep the subject scannable
  const nameParts = lead.name.trim().split(/\s+/);
  const shortName = nameParts.length > 1
    ? `${nameParts[0]} ${nameParts[nameParts.length - 1].charAt(0)}.`
    : nameParts[0] ?? lead.name;
  const place = lead.location || lead.zip || '';
  const segments = [tag, shortName, route, place].filter(Boolean);
  return segments.join(' · ').slice(0, 120);
}

/* ─── Plain-text body ───────────────────────────────────────────────── */

function digits(s: string | undefined): string {
  return (s ?? '').replace(/\D/g, '');
}

function fmtTimestamp(ts: string): string {
  // Best-effort. If the input isn't a parseable ISO string, return as-is.
  const d = new Date(ts);
  if (Number.isNaN(d.valueOf())) return ts;
  // Show in America/New_York (Beit's local timezone) — most leads are
  // in Florida and reading the email from Florida.
  try {
    return d.toLocaleString('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    // Fall back to ISO when toLocaleString fails (some Node runtimes
    // ship without ICU full data — Vercel's does, but defensive).
    return d.toISOString();
  }
}

export function buildLeadEmailText(lead: LeadEmailPayload): string {
  const theme = urgencyThemeFor(lead.route?.priority);
  const phoneDigits = digits(lead.phone);
  const lines: Array<string | null> = [
    theme.textLabel,
    '',
    `New lead — ${lead.name}`,
    `Received: ${fmtTimestamp(lead.ts)}`,
    `Confirmation: ${lead.confirmationId}`,
    '',
    '── Contact ──',
    `Name:     ${lead.name}`,
    `Phone:    ${lead.phone}${phoneDigits ? `  ·  tap to dial: tel:${phoneDigits}` : ''}`,
    lead.email ? `Email:    ${lead.email}` : null,
    lead.location ? `Location: ${lead.location}` : null,
    lead.zip ? `ZIP:      ${lead.zip}` : null,
    lead.clientType ? `Client:   ${lead.clientType}` : null,
    lead.preferredContact ? `Prefers:  ${lead.preferredContact}` : null,
    '',
    '── Project ──',
    lead.service ? `Service:  ${lead.service}` : null,
    lead.route ? `Route:    ${lead.route.label} (${lead.route.priority})` : null,
    lead.route ? `Intent:   ${lead.route.intent}` : null,
    lead.route ? `Contingency: ${lead.route.contingency}` : null,
    lead.route ? `Proof:    ${lead.route.proof}` : null,
    '',
    'Notes:',
    lead.message?.trim() || '(none provided)',
    '',
    '── Operations ──',
    lead.operations ? `Bucket:    ${lead.operations.bucket}` : null,
    lead.operations ? `Urgency:   ${lead.operations.urgency}` : null,
    lead.operations ? `Follow-up: ${lead.operations.recommendedFollowUp}` : null,
    '',
    '── Quick actions ──',
    phoneDigits ? `Call now: tel:${phoneDigits}` : null,
    lead.email ? `Reply email: mailto:${lead.email}?subject=${encodeURIComponent(`Re: ${buildLeadEmailSubject(lead)}`)}` : null,
    lead.location
      ? `Open in Maps: https://maps.google.com/?q=${encodeURIComponent(lead.location)}`
      : null,
    lead.zip ? `ZIP map: https://maps.google.com/?q=${encodeURIComponent(lead.zip)}` : null,
    '',
    '── Origin ──',
    lead.source ? `Source:  ${lead.source}` : null,
    lead.pageUrl ? `Page:    ${lead.pageUrl}` : null,
    '',
    '─────────────────────────────────────────',
    'Beit Building Contractors LLC',
    'DBPR CCC1337413 (roofing) · CGC1534077 (general)',
    '(407) 942-6459 · 2703 Dobbin Dr, Orlando FL 32817',
    'beitbuilding.com',
  ];
  return lines.filter((line): line is string => line !== null).join('\n');
}

/* ─── HTML body ─────────────────────────────────────────────────────── */

interface RowProps {
  label: string;
  value: string;
  link?: { href: string; label?: string };
}

function htmlRow({ label, value, link }: RowProps): string {
  const safeValue = escapeHtml(value);
  const linked = link
    ? `<a href="${escapeHtml(link.href)}" style="color:#0a0908;text-decoration:none;border-bottom:1px solid #d4af37;">${escapeHtml(link.label ?? value)}</a>`
    : safeValue;
  return `
    <tr>
      <td style="padding:10px 16px;background:#f5f0e6;border-bottom:1px solid #e9dfc8;font-family:'Inter',Arial,sans-serif;font-size:12px;font-weight:600;color:#5a4a2a;text-transform:uppercase;letter-spacing:0.06em;width:36%;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:10px 16px;background:#fff;border-bottom:1px solid #ebe1c7;font-family:'Inter',Arial,sans-serif;font-size:15px;color:#1a1814;line-height:1.5;vertical-align:top;">${linked}</td>
    </tr>`;
}

interface CtaButtonProps {
  href: string;
  label: string;
  bg?: string;
  fg?: string;
}

function ctaButton({ href, label, bg = '#0a0908', fg = '#d4af37' }: CtaButtonProps): string {
  return `
    <a href="${escapeHtml(href)}" style="display:inline-block;padding:14px 22px;margin:0 6px 12px 0;background:${bg};color:${fg};font-family:'Bebas Neue','Inter',Arial,sans-serif;font-size:16px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;text-decoration:none;border-radius:4px;border:1px solid ${bg};">${escapeHtml(label)}</a>`;
}

export function buildLeadEmailHtml(lead: LeadEmailPayload): string {
  const theme = urgencyThemeFor(lead.route?.priority);
  const phoneDigits = digits(lead.phone);
  const subjectForReply = `Re: Beit Building estimate request — ${lead.confirmationId}`;
  const replyMailto = lead.email
    ? `mailto:${lead.email}?subject=${encodeURIComponent(subjectForReply)}&body=${encodeURIComponent(`Hi ${lead.name},\n\nThanks for reaching out to Beit Building Contractors. I'm following up on your estimate request (Confirmation ${lead.confirmationId}).\n\n`)}`
    : null;
  const mapsUrl = lead.location
    ? `https://maps.google.com/?q=${encodeURIComponent(lead.location)}`
    : lead.zip
      ? `https://maps.google.com/?q=${encodeURIComponent(lead.zip)}`
      : null;

  const ctaButtons: string[] = [];
  if (phoneDigits) {
    ctaButtons.push(
      ctaButton({
        href: `tel:${phoneDigits}`,
        label: `Call ${escapeHtml(lead.phone)}`,
        bg: '#0a0908',
        fg: '#d4af37',
      }),
    );
  }
  if (replyMailto) {
    ctaButtons.push(
      ctaButton({
        href: replyMailto,
        label: 'Reply by Email',
        bg: '#d4af37',
        fg: '#0a0908',
      }),
    );
  }
  if (mapsUrl) {
    ctaButtons.push(
      ctaButton({
        href: mapsUrl,
        label: 'Open in Maps',
        bg: '#1a1814',
        fg: '#f5f0e6',
      }),
    );
  }

  const contactRows = [
    htmlRow({ label: 'Name', value: lead.name }),
    htmlRow({
      label: 'Phone',
      value: lead.phone,
      link: phoneDigits ? { href: `tel:${phoneDigits}`, label: lead.phone } : undefined,
    }),
    lead.email
      ? htmlRow({
          label: 'Email',
          value: lead.email,
          link: { href: `mailto:${lead.email}`, label: lead.email },
        })
      : '',
    lead.location
      ? htmlRow({
          label: 'Location',
          value: lead.location,
          link: { href: `https://maps.google.com/?q=${encodeURIComponent(lead.location)}` },
        })
      : '',
    lead.zip ? htmlRow({ label: 'ZIP', value: lead.zip }) : '',
    lead.clientType ? htmlRow({ label: 'Client', value: lead.clientType }) : '',
    lead.preferredContact ? htmlRow({ label: 'Preferred contact', value: lead.preferredContact }) : '',
  ].join('');

  const projectRows = [
    lead.service ? htmlRow({ label: 'Service', value: lead.service }) : '',
    lead.route ? htmlRow({ label: 'Route', value: `${lead.route.label} (${lead.route.priority})` }) : '',
    lead.route ? htmlRow({ label: 'Intent', value: lead.route.intent }) : '',
    lead.route ? htmlRow({ label: 'Contingency', value: lead.route.contingency }) : '',
    lead.route ? htmlRow({ label: 'Proof', value: lead.route.proof }) : '',
  ].join('');

  const opsRows = lead.operations
    ? [
        htmlRow({ label: 'Bucket', value: lead.operations.bucket }),
        htmlRow({ label: 'Urgency', value: lead.operations.urgency }),
        htmlRow({ label: 'Follow-up', value: lead.operations.recommendedFollowUp }),
      ].join('')
    : '';

  const originRows = [
    lead.source ? htmlRow({ label: 'Source', value: lead.source }) : '',
    lead.pageUrl
      ? htmlRow({
          label: 'Page',
          value: lead.pageUrl,
          link: { href: lead.pageUrl, label: lead.pageUrl },
        })
      : '',
    htmlRow({ label: 'Confirmation', value: lead.confirmationId }),
    htmlRow({ label: 'Received', value: fmtTimestamp(lead.ts) }),
  ].join('');

  const messageHtml = lead.message?.trim()
    ? escapeHtml(lead.message)
        .split(/\n{2,}/)
        .map((p) => `<p style="margin:0 0 12px 0;">${p.replace(/\n/g, '<br/>')}</p>`)
        .join('')
    : '<p style="margin:0;color:#6b6258;font-style:italic;">No project notes provided. Confirm scope on the call.</p>';

  // Heads-up: this template is one giant string because the goal is
  // to render identically in Gmail / Outlook / Apple Mail. Modular
  // approaches with template engines (handlebars, ejs) introduce
  // whitespace patterns that some clients render as visible gaps.
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="x-apple-disable-message-reformatting" />
<title>${escapeHtml(buildLeadEmailSubject(lead))}</title>
</head>
<body style="margin:0;padding:0;background:#0a0908;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1a1814;-webkit-font-smoothing:antialiased;">
<!-- Preheader: shown in inbox preview after the subject line. Hidden
     from the rendered body via the standard "display:none" trick. -->
<div style="display:none;font-size:1px;color:#0a0908;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${escapeHtml(`${theme.label} · ${lead.name} · ${lead.phone}${lead.location ? ` · ${lead.location}` : ''}`)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#0a0908;padding:24px 8px;">
<tr><td align="center">

  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#fffaf0;border-radius:8px;overflow:hidden;border:1px solid #d4af37;">

    <!-- Brand header -->
    <tr>
      <td style="padding:24px 28px 18px 28px;background:#0a0908;border-bottom:2px solid #d4af37;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-family:'Cormorant Garamond','Times New Roman',Georgia,serif;font-size:22px;font-weight:600;letter-spacing:0.04em;color:#d4af37;">
              Beit&nbsp;Building&nbsp;<em style="font-style:italic;color:#fff5d0;">Contractors</em>
            </td>
            <td align="right" style="font-family:'Inter',Arial,sans-serif;font-size:11px;color:#a39669;letter-spacing:0.12em;text-transform:uppercase;">
              Lead&nbsp;Inbox
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Urgency banner -->
    <tr>
      <td style="padding:14px 28px;background:${theme.bg};color:${theme.fg};font-family:'Bebas Neue','Inter',Arial,sans-serif;font-size:14px;font-weight:600;letter-spacing:0.16em;text-align:center;text-transform:uppercase;">
        ${escapeHtml(theme.label)}
      </td>
    </tr>

    <!-- Hero summary -->
    <tr>
      <td style="padding:30px 28px 6px 28px;">
        <p style="margin:0 0 4px 0;font-family:'Inter',Arial,sans-serif;font-size:11px;font-weight:600;letter-spacing:0.18em;text-transform:uppercase;color:#8a7a4e;">New estimate request</p>
        <h1 style="margin:0 0 6px 0;font-family:'Cormorant Garamond','Times New Roman',Georgia,serif;font-size:32px;font-weight:600;line-height:1.1;color:#0a0908;">${escapeHtml(lead.name)}</h1>
        <p style="margin:0;font-family:'Inter',Arial,sans-serif;font-size:15px;color:#3d3528;line-height:1.55;">
          ${escapeHtml(lead.service ?? lead.route?.label ?? 'Service to be confirmed')}${lead.location ? ` · ${escapeHtml(lead.location)}` : ''}
        </p>
      </td>
    </tr>

    <!-- Quick actions -->
    <tr>
      <td style="padding:18px 28px 4px 28px;">
        ${ctaButtons.join('')}
      </td>
    </tr>

    <!-- Customer / contact panel -->
    <tr>
      <td style="padding:18px 28px 0 28px;">
        <h2 style="margin:0 0 10px 0;font-family:'Bebas Neue','Inter',Arial,sans-serif;font-size:13px;letter-spacing:0.18em;color:#5a4a2a;text-transform:uppercase;">Contact</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #ebe1c7;border-radius:6px;overflow:hidden;">
          ${contactRows}
        </table>
      </td>
    </tr>

    <!-- Project panel -->
    <tr>
      <td style="padding:22px 28px 0 28px;">
        <h2 style="margin:0 0 10px 0;font-family:'Bebas Neue','Inter',Arial,sans-serif;font-size:13px;letter-spacing:0.18em;color:#5a4a2a;text-transform:uppercase;">Project</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #ebe1c7;border-radius:6px;overflow:hidden;">
          ${projectRows}
        </table>
      </td>
    </tr>

    <!-- Customer notes -->
    <tr>
      <td style="padding:22px 28px 0 28px;">
        <h2 style="margin:0 0 10px 0;font-family:'Bebas Neue','Inter',Arial,sans-serif;font-size:13px;letter-spacing:0.18em;color:#5a4a2a;text-transform:uppercase;">Notes from the customer</h2>
        <div style="padding:18px 20px;background:#fff;border:1px solid #ebe1c7;border-left:4px solid #d4af37;border-radius:6px;font-family:'Inter',Arial,sans-serif;font-size:15px;line-height:1.65;color:#1a1814;">
          ${messageHtml}
        </div>
      </td>
    </tr>

    ${
      opsRows
        ? `<tr>
      <td style="padding:22px 28px 0 28px;">
        <h2 style="margin:0 0 10px 0;font-family:'Bebas Neue','Inter',Arial,sans-serif;font-size:13px;letter-spacing:0.18em;color:#5a4a2a;text-transform:uppercase;">Operations</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #ebe1c7;border-radius:6px;overflow:hidden;">
          ${opsRows}
        </table>
      </td>
    </tr>`
        : ''
    }

    <!-- Origin / metadata -->
    <tr>
      <td style="padding:22px 28px 0 28px;">
        <h2 style="margin:0 0 10px 0;font-family:'Bebas Neue','Inter',Arial,sans-serif;font-size:13px;letter-spacing:0.18em;color:#5a4a2a;text-transform:uppercase;">Origin</h2>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #ebe1c7;border-radius:6px;overflow:hidden;">
          ${originRows}
        </table>
      </td>
    </tr>

    <!-- Footer -->
    <tr>
      <td style="padding:30px 28px 28px 28px;border-top:1px solid #ebe1c7;background:#f5f0e6;">
        <p style="margin:0 0 6px 0;font-family:'Cormorant Garamond','Times New Roman',Georgia,serif;font-size:18px;color:#0a0908;font-weight:600;">Beit Building Contractors LLC</p>
        <p style="margin:0 0 4px 0;font-family:'Inter',Arial,sans-serif;font-size:13px;color:#3d3528;line-height:1.55;">
          DBPR&nbsp;CCC1337413 · CGC1534077<br/>
          (407) 942-6459 · 2703&nbsp;Dobbin&nbsp;Dr, Orlando&nbsp;FL&nbsp;32817
        </p>
        <p style="margin:10px 0 0 0;font-family:'Inter',Arial,sans-serif;font-size:11px;color:#8a7a4e;line-height:1.5;">
          Lead retained 90 days · auto-purged from the website database.<br/>
          This message is system-generated. Verify identity before sharing customer details with anyone outside the team.
        </p>
      </td>
    </tr>
  </table>

</td></tr>
</table>
</body>
</html>`;
}
