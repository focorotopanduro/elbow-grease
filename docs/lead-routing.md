# Lead Routing — Multi-Destination Forwarding

## Current contact form path

The public contact form now creates one normalized `LeadIntake` record in `src/lib/leadIntake.ts` before it sends anything. That record carries the visitor details, client type, preferred follow-up channel, service choice, page URL, selected client path, office bucket, urgency, and recommended follow-up.

Current destinations:

| Destination | Env var | Behavior |
| --- | --- | --- |
| Web3Forms email | `VITE_WEB3FORMS_KEY` | Primary production email path. |
| Optional JSON mirror | `VITE_LEAD_ENDPOINT` | Sends the same `LeadIntake` payload to a backend, CRM bridge, or local office collector. |
| Optional local token | `VITE_LEAD_ENDPOINT_TOKEN` | Adds `X-Lead-Inbox-Token`; use only for local/private testing because Vite env vars are public in the browser bundle. |
| Mailto fallback | `VITE_BUSINESS_EMAIL` | Opens a prefilled email when no live endpoint is configured. |
| Optional Zoom link | `VITE_ZOOM_URL` | Shows a live Zoom/business-planning link only after the production URL is configured. Until then, "Zoom" remains a recorded follow-up preference, not a dead public link. |

Visitor choice routing:

- `customerType` distinguishes homeowner, business/property manager, and storm/weather-event leads. Selecting one also updates the smart-path route so downstream copy, urgency, and follow-up metadata stay aligned.
- `preferredContact` records whether the visitor wants call, WhatsApp, Zoom, or email follow-up. This field travels through Web3Forms, `/api/leads`, the local CSV archive, operations email, Slack, and Discord.
- WhatsApp is a live front-end channel via `VITE_BUSINESS_WHATSAPP`; Zoom is intentionally hidden as a live link until `VITE_ZOOM_URL` is set.

Local office collector:

```bash
npm run lead:inbox
```

Then point a local/dev build at:

```bash
VITE_LEAD_ENDPOINT=http://127.0.0.1:8787/lead-intake
```

The collector writes two files at once:

- `lead-inbox/leads.ndjson` for a permanent append-only archive
- `lead-inbox/leads.csv` for spreadsheet review and cross-checking on the office laptop

It also exposes downloads while it is running:

- `http://127.0.0.1:8787/leads.csv`
- `http://127.0.0.1:8787/leads.ndjson`

Production note: an HTTPS public website cannot safely write directly to a private laptop file. For live production, use an HTTPS backend/CRM endpoint as `VITE_LEAD_ENDPOINT`, or run the collector behind a properly secured tunnel. The local collector is intentionally dependency-free so it can be used as a simple office-machine bridge during setup.

## Existing `/api/leads` route

The Beit Building website forwards every new lead from `/api/leads` to multiple destinations, each opt-in via environment variables. Missing env var = silent no-op for that destination. The form submission ALWAYS succeeds even if every destination is offline (lead is in KV + Vercel logs).

The desktop Contact form posts to `/api/leads` automatically alongside Web3Forms (parallel fan-out). The first destination that returns success becomes the user-visible "submitted" status, but ALL configured destinations still attempt — meaning the operations contact gets the rich HTML email even if Web3Forms is down, and Slack still pings even when KV is down.

## Active destinations

| Destination | Env var | Setup | Cost |
| --- | --- | --- | --- |
| **Server email (Resend)** | `RESEND_API_KEY` (+ `LEAD_NOTIFY_TO`) | Below ↓ | Free 100/day, $20/mo for 50k |
| Server email (SendGrid alt) | `SENDGRID_API_KEY` | Below ↓ | Free 100/day |
| Server email (MailChannels alt) | `MAILCHANNELS_API_KEY` | Below ↓ | Variable |
| Server email (webhook fallback) | `EMAIL_WEBHOOK_URL` | Below ↓ | Free (depends on receiver) |
| Vercel KV (storage) | `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Built-in | ~$10/mo |
| Vercel logs (operational) | (none) | Always on | Free |
| Web3Forms email | (front-end env: `VITE_WEB3FORMS_KEY`) | Sign up at web3forms.com | Free 250/mo |
| Slack | `SLACK_LEADS_WEBHOOK` | Below | Free |
| Discord | `DISCORD_LEADS_WEBHOOK` | Below | Free |
| Twilio SMS | (not yet implemented — see below) | — | ~$0.0079/SMS |

---

## Server-side email — Resend (recommended primary)

Sends a rich HTML notification to the operations contact every time `/api/leads` accepts a lead. This is the path that delivers the production-quality email to **mom's inbox** (sandravasquezcgc@gmail.com by default).

### Setup (≈10 minutes)

1. **Sign up** at [resend.com](https://resend.com/) — no credit card for the free 100/day tier.
2. **Add the domain** `beitbuilding.com` (Domains → Add Domain). Resend shows three DNS TXT records (DKIM × 2, SPF × 1).
3. **Add those TXT records** in your DNS provider (Vercel DNS / Cloudflare / Namecheap). Wait 5–60 minutes for propagation, click **Verify** in Resend.
4. **Generate an API key** (API Keys → Create API Key, restricted to "Sending access").
5. **In Vercel:** Project → Settings → Environment Variables. Add:
   - `RESEND_API_KEY` = the key from step 4 (Production + Preview)
   - `LEAD_NOTIFY_TO` = `sandravasquezcgc@gmail.com`
   - `EMAIL_FROM` = `Beit Building Leads <leads@beitbuilding.com>` (or whatever local-part you prefer at the verified domain)
   - Optional: `LEAD_NOTIFY_CC` = a backup operator or shared inbox during onboarding
6. **Redeploy.** Submit the test curl below to see the email land.

### Recipient resolution priority

When `/api/leads` calls `resolveLeadRecipients()` in `api/_lib/email.ts`, the recipient is chosen as:

1. Caller-supplied `to` (currently never overridden — reserved for future per-route routing)
2. `LEAD_NOTIFY_TO` env var (comma-separated supported)
3. `DEFAULT_OPERATIONS_EMAIL` constant (`sandravasquezcgc@gmail.com`)

`LEAD_NOTIFY_CC` always merges in if present.

### Email contents

The HTML email includes (in this order):

1. **Brand header** — Beit Building wordmark on charcoal + gold.
2. **Urgency banner** — color-coded based on the smart-path priority:
   - `call-first` → red banner ("CALL FIRST · ACTIVE LEAK / STORM")
   - `work-order` → blue banner ("WORK ORDER · MULTIPLE PROPERTIES")
   - `scope-first` → bronze banner ("SCOPE REVIEW · DEPENDENCIES TO CONFIRM")
   - `estimate-first` (default) → black/gold ("ESTIMATE REQUEST · STANDARD FOLLOW-UP")
3. **Hero summary** — name + service + location, big and scannable.
4. **CTA buttons** — tap-to-call, reply-by-email (with prefilled subject + body), open-in-Maps.
5. **Contact panel** — name, phone (with tel: link), email (with mailto:), location (with maps link), ZIP.
6. **Project panel** — service, route label/priority/intent/contingency/proof when smart-path was active.
7. **Customer notes** — the free-text message field, with the brand-gold left border.
8. **Operations panel** — bucket, urgency, recommended follow-up.
9. **Origin panel** — source surface, page URL, confirmation ID, timestamp (in America/New_York timezone).
10. **Footer** — DBPR licenses, address, retention notice.

The plain-text body mirrors the same data with terminal-friendly formatting (tap-to-dial `tel:` links, https://maps.google.com URLs).

### Test the email path

```bash
curl -X POST https://www.beitbuilding.com/api/leads \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://www.beitbuilding.com' \
  -d '{
    "name": "Test Lead",
    "phone": "4079426459",
    "email": "test@example.com",
    "location": "Audubon Park, Orlando",
    "service": "Roof repair or storm damage",
    "message": "Hurricane damage on the back slope. Photos available.",
    "source": "curl_test",
    "page": "/",
    "url": "https://www.beitbuilding.com/",
    "ts": "'$(date -u +%FT%TZ)'",
    "route": {
      "id": "storm",
      "label": "Storm path",
      "priority": "call-first",
      "intent": "active_leak",
      "contingency": "Tarp + photo set",
      "proof": "Storm imagery, prior tarp work"
    }
  }'
```

Check `LEAD_NOTIFY_TO` inbox within ~10 seconds. If nothing arrives, look in Vercel logs for the `[lead-email]` line — it logs the provider, success status, and last reason on failure.

### Switching providers without redeploy

The transport tries providers in priority order: Resend → SendGrid → MailChannels → webhook fallback. Set the API key for whichever you want; rotate by clearing the old env var and setting the new one. The next request picks up the change without a redeploy (env is read per-call).

---

## Slack — incoming webhook

Receive a Block Kit message in your team's Slack channel for every new lead.

### Setup

1. In Slack: workspace admin → **Apps** → search "Incoming Webhooks" → **Add to Slack**.
2. Pick the channel (`#leads` is conventional).
3. Slack provides a webhook URL like `https://hooks.slack.com/services/T.../B.../xxxx`.
4. In Vercel: project settings → Environment Variables → add `SLACK_LEADS_WEBHOOK` with the URL value. Mark it as Production + Preview + Development as needed.
5. Redeploy. Next form submission lands in Slack within a few seconds.

### Message format

The webhook posts a Block Kit message like:

```
*New lead — Maria Vasquez*
:telephone_receiver: <tel:4079426459|(407) 942-6459>
:email: maria@example.com
:round_pushpin: Audubon Park, Orlando
ZIP: 32817
Service: Roofing — Storm Damage
> "Hurricane Nicole damage to my back slope. Need an inspection ASAP."
Confirmation: `BBC-LZ4G7K-A8X2` · 2026-04-28T16:42:00Z
Source: contact_form
```

Format definition: `api/_lib/webhooks.ts` `sendSlack()`.

---

## Discord — webhook embed

Receive a Discord embed in your server's channel.

### Setup

1. In Discord: right-click the target channel → **Edit Channel** → **Integrations** → **Webhooks** → **New Webhook**.
2. Pick a name + avatar. Copy the webhook URL.
3. In Vercel: add `DISCORD_LEADS_WEBHOOK` env var.
4. Redeploy.

### Message format

A Discord embed with brand-gold accent color (`#d4af37`), structured fields:

- Phone (with tel: link)
- Email · Location · ZIP (inline)
- Service (full-width)
- Message (truncated to 1024 chars per Discord limit)
- Confirmation · Source (inline)

Format definition: `api/_lib/webhooks.ts` `sendDiscord()`.

---

## Twilio SMS — NOT YET IMPLEMENTED

Real-time SMS notification for new leads. Recommended for storm-damage scenarios where 5-minute response time matters.

### Setup (when ready)

1. Sign up at [twilio.com](https://www.twilio.com/) and create a project.
2. Buy a Florida phone number (~$1/mo).
3. Add env vars to Vercel:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_FROM_NUMBER` — your purchased Twilio number (E.164 format, e.g., `+14079421000`)
   - `TWILIO_TO_NUMBER` — the number that should receive SMS notifications (the owner's personal cell)
4. Add the Twilio Node SDK as a dep:
   ```bash
   npm install twilio
   ```
5. Add a `sendTwilio()` function to `api/_lib/webhooks.ts` (skeleton in code comments — not yet written).
6. Wire into `dispatchLead()` parallel array in `api/_lib/webhooks.ts`.

### Cost projection

- ~$0.0079 per SMS in the US
- Typical lead volume: 1-10/day = ~$0.30-2.40/mo
- Twilio number rental: ~$1/mo
- **Total: ~$2-4/mo**

Worth the cost for storm-damage seasonal lead spikes when 30-second-response time vs 30-minute-response time changes who gets the job.

---

## SendGrid / Resend / SES — alternative email destinations

The Web3Forms email path is the front-end form's default backend. If you want server-side control over email delivery (custom templates, bounce tracking, deliverability rates), wire one of these as an additional destination:

- **Resend** ([resend.com](https://resend.com/)) — modern, $0/mo for 100 emails/day, $20/mo for 50k. The cleanest API.
- **SendGrid** — Twilio-owned, rich features, $0/mo for 100/day.
- **AWS SES** — cheapest at scale ($0.10 per 1k), but more setup.

To wire: add a `sendEmail()` function in `api/_lib/webhooks.ts` mirroring the Slack/Discord pattern, opt-in via `RESEND_API_KEY` (or equivalent). Then use the existing review-request templates in `docs/review-request-templates.md` for transactional sends.

---

## What if all destinations fail?

The lead is still:

1. Stored in Vercel KV (90-day TTL) with the confirmation ID
2. Logged to Vercel runtime logs (`grep '[lead]'` in `vercel logs`)
3. (Front-end form path) Delivered via Web3Forms unless that's also down

You can replay leads from KV after any outage:

```bash
# Pseudo-code; needs a small helper script
node scripts/replay-leads.mjs --since "2026-04-28T00:00:00Z"
```

(This script doesn't exist yet — write it when you actually need to replay. KV's `ZRANGEBYSCORE leads:by-time` returns the IDs in order.)

---

## Verifying webhooks in production

Test setup with a synthetic submission:

```bash
curl -X POST https://www.beitbuilding.com/api/leads \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://www.beitbuilding.com' \
  -d '{
    "name": "Test Lead",
    "phone": "4079426459",
    "zip": "32817",
    "source": "webhook_test",
    "page": "test",
    "url": "https://www.beitbuilding.com/test",
    "ts": "2026-04-28T16:00:00Z"
  }'
```

Confirm:

- 202 response (`{ ok: true, confirmationId, queued: true }`)
- Slack channel receives a message within ~3 seconds
- Discord channel receives an embed within ~3 seconds
- Vercel logs show `[lead]` line + per-destination dispatch outcomes

If any fail, check Vercel function logs for the dispatcher error message.

---

## Privacy + security notes

- The webhooks include the lead's name, phone, and (if collected) email. This is intentional — the entire purpose is for the owner to call them back.
- The lead's IP is **never** forwarded — only used at the Vercel edge for rate limiting.
- Webhook URLs are SECRETS. If a webhook URL leaks, attackers can post arbitrary content to your Slack/Discord channel. Rotate the webhook URL immediately if leaked (regenerate in Slack/Discord settings + update env var in Vercel).
- The `dispatchLead()` function has a 5-second timeout per destination. A slow Slack outage will not delay the lead-intake response (which has its own 10-second function budget).
