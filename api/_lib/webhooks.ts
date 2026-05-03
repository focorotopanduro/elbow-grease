/**
 * Webhook helpers — Tier 8 lead-routing.
 *
 * Each function is OPT-IN via environment variables. If the relevant
 * env var isn't set, the function silently no-ops (returns null).
 * This means lead-handling endpoints can call them unconditionally
 * without breaking the funnel when destinations aren't configured.
 *
 * PRIVACY POSTURE:
 *   - Lead data (name + phone) DOES go to these destinations — that's
 *     the entire point. The user is calling Beit to get a quote; their
 *     contact info reaches the team.
 *   - The webhook calls happen FROM the Vercel function (server-side),
 *     so the lead's IP is NEVER forwarded. Slack/Discord see the
 *     payload but not the visitor's network identity.
 *   - 5-second timeout per call — never let a slow webhook block lead
 *     intake. Failures are logged but don't bubble up to the user.
 *
 * SUPPORTED DESTINATIONS:
 *   - sendSlack(): formats a Block Kit message for SLACK_LEADS_WEBHOOK
 *   - sendDiscord(): formats an embed for DISCORD_LEADS_WEBHOOK
 *   - SMS / Twilio: NOT implemented — see docs/lead-routing.md for the
 *     setup walkthrough. Requires Twilio account + per-message billing.
 */

import { logger } from './logger';

const log = logger('api/_lib/webhooks');

const TIMEOUT_MS = 5000;

/** Common lead shape across all webhook destinations. */
export interface LeadPayload {
  /** Customer-facing confirmation id ("BBC-XXXX-XXXX"). */
  confirmationId: string;
  /** Customer's name as entered. */
  name: string;
  /** Phone number — display-formatted. */
  phone: string;
  /** Email when available; '' for forms that don't collect it. */
  email?: string;
  /** ZIP / postal code. */
  zip?: string;
  /** Property location / city — free-text. */
  location?: string;
  /** Customer segment chosen on the contact form. */
  clientType?: string;
  /** Visitor's preferred follow-up channel. */
  preferredContact?: string;
  /** Service category selected on the form. */
  service?: string;
  /** Free-text message field. */
  message?: string;
  /** Origin context — usually a path or surface label. */
  source?: string;
  /** ISO timestamp the lead was received. */
  ts: string;
}

/* ─── Internal: timeout-bounded fetch ──────────────────────────────── */

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ─── Slack (Block Kit) ─────────────────────────────────────────────── */

/**
 * Forward a lead to Slack via incoming-webhook URL. Set env var
 * `SLACK_LEADS_WEBHOOK` to enable. Format uses Block Kit so the
 * message renders cleanly in Slack with formatted fields and a
 * tap-to-call link on mobile.
 *
 * Webhook setup: create an Incoming Webhook integration in Slack
 * (workspace → Apps → Incoming Webhooks), pick the channel, copy
 * the URL into Vercel's env vars as SLACK_LEADS_WEBHOOK.
 */
export async function sendSlack(lead: LeadPayload): Promise<boolean | null> {
  const webhookUrl = process.env.SLACK_LEADS_WEBHOOK;
  if (!webhookUrl) return null; // not configured — silent no-op

  const lines: string[] = [
    `*New lead — ${escapeSlack(lead.name)}*`,
    `:telephone_receiver: <tel:${lead.phone.replace(/\D/g, '')}|${escapeSlack(lead.phone)}>`,
  ];
  if (lead.email) lines.push(`:email: ${escapeSlack(lead.email)}`);
  if (lead.location) lines.push(`:round_pushpin: ${escapeSlack(lead.location)}`);
  if (lead.zip) lines.push(`ZIP: ${escapeSlack(lead.zip)}`);
  if (lead.clientType) lines.push(`Client: ${escapeSlack(lead.clientType)}`);
  if (lead.preferredContact) lines.push(`Preferred contact: ${escapeSlack(lead.preferredContact)}`);
  if (lead.service) lines.push(`Service: ${escapeSlack(lead.service)}`);
  if (lead.message) {
    const truncated = lead.message.slice(0, 600);
    lines.push(`> ${escapeSlack(truncated)}${lead.message.length > 600 ? '…' : ''}`);
  }
  lines.push(`Confirmation: \`${escapeSlack(lead.confirmationId)}\` · ${escapeSlack(lead.ts)}`);
  if (lead.source) lines.push(`Source: ${escapeSlack(lead.source)}`);

  const payload = {
    text: `New lead from ${lead.name}`, // fallback for notifications
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.join('\n') },
      },
    ],
  };

  try {
    const resp = await fetchWithTimeout(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      log.warn('slack webhook rejected', { status: resp.status });
      return false;
    }
    return true;
  } catch (err) {
    log.warn('slack webhook failed', {
      err: err instanceof Error ? err.message : 'unknown',
    });
    return false;
  }
}

/** Escape Slack mrkdwn special characters (modest set). */
function escapeSlack(s: string): string {
  return s.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] ?? c));
}

/* ─── Discord (embed) ───────────────────────────────────────────────── */

/**
 * Forward a lead to Discord via webhook URL. Set env var
 * `DISCORD_LEADS_WEBHOOK` to enable. Format uses Discord's embed
 * structure for clean visual presentation in the channel.
 *
 * Webhook setup: in your Discord server → channel settings →
 * Integrations → Webhooks → New Webhook → copy URL.
 */
export async function sendDiscord(lead: LeadPayload): Promise<boolean | null> {
  const webhookUrl = process.env.DISCORD_LEADS_WEBHOOK;
  if (!webhookUrl) return null; // not configured

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: 'Phone', value: `[${lead.phone}](tel:${lead.phone.replace(/\D/g, '')})`, inline: true },
  ];
  if (lead.email) fields.push({ name: 'Email', value: lead.email, inline: true });
  if (lead.location) fields.push({ name: 'Location', value: lead.location, inline: true });
  if (lead.zip) fields.push({ name: 'ZIP', value: lead.zip, inline: true });
  if (lead.clientType) fields.push({ name: 'Client', value: lead.clientType, inline: true });
  if (lead.preferredContact) fields.push({ name: 'Preferred contact', value: lead.preferredContact, inline: true });
  if (lead.service) fields.push({ name: 'Service', value: lead.service, inline: false });
  if (lead.message) {
    const truncated = lead.message.slice(0, 1024); // Discord field limit
    fields.push({ name: 'Message', value: truncated, inline: false });
  }
  fields.push({ name: 'Confirmation', value: `\`${lead.confirmationId}\``, inline: true });
  if (lead.source) fields.push({ name: 'Source', value: lead.source, inline: true });

  const payload = {
    username: 'Beit Building Leads',
    embeds: [
      {
        title: `New lead — ${lead.name}`,
        color: 0xd4af37, // brand gold
        fields,
        timestamp: lead.ts,
      },
    ],
  };

  try {
    const resp = await fetchWithTimeout(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      log.warn('discord webhook rejected', { status: resp.status });
      return false;
    }
    return true;
  } catch (err) {
    log.warn('discord webhook failed', {
      err: err instanceof Error ? err.message : 'unknown',
    });
    return false;
  }
}

/* ─── Public dispatcher ─────────────────────────────────────────────── */

/**
 * Fan out a lead to ALL configured webhook destinations in parallel.
 * Returns a summary of which destinations succeeded vs failed vs were
 * not configured. NEVER throws — webhook failures are logged but never
 * bubble up to the lead-intake response (a slow Slack outage would
 * otherwise reject form submissions).
 */
export async function dispatchLead(lead: LeadPayload): Promise<{
  slack: boolean | null;
  discord: boolean | null;
}> {
  const [slack, discord] = await Promise.all([
    sendSlack(lead),
    sendDiscord(lead),
  ]);
  return { slack, discord };
}
