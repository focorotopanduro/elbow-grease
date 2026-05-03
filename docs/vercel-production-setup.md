# Vercel Primary Production Setup

This is the recommended production architecture for the current codebase:

```text
GitHub repository
  -> merge to main
  -> Vercel production deploy
  -> Vercel Functions handle leads, events, CSP reports, health, and cron
  -> Hostinger keeps domain/DNS/email or a static fallback package
```

Vercel should be the live web host when the backend matters. Hostinger should remain in the stack for DNS, email, and a verified static backup package.

## Why this is the best fit

- The site already includes Vercel Functions in `api/`.
- `/api/leads` can validate, rate-limit, deduplicate, email, store, and route leads.
- `/api/events` gives first-party funnel events without third-party trackers.
- `/api/csp-report` receives browser security reports from the CSP.
- `/api/health` gives uptime monitors a cheap status probe.
- `vercel.json` schedules `/api/cron/purge-leads` so stale lead data is purged after 90 days.
- Hostinger static hosting cannot run these TypeScript API functions. It is still useful as DNS/email and static backup.

## GitHub setup

1. Create a private GitHub repository for this project.
2. Push the source to `main`.
3. In GitHub, enable branch protection on `main`.
4. Require the `Vercel Production Gate` workflow before merges.
5. Keep direct pushes to `main` limited to trusted operators.

The gate runs:

```bash
npm run release:vercel
```

That command runs a production dependency audit, lint, security audit, tests, NAP audit, build, and Vercel deployment audit.

## Vercel project setup

1. In Vercel, import the GitHub repository.
2. Set the production branch to `main`.
3. Use the default Vite build settings unless Vercel fails to detect them:
   - Install command: `npm ci`
   - Build command: `npm run build`
   - Output directory: `dist`
4. Add the production domain:
   - Preferred canonical host: `www.beitbuilding.com`
   - Redirect/apex support: `beitbuilding.com`
5. Add environment variables to the Production environment first, then Preview if needed.

## Required production environment variables

Set these in Vercel Project Settings -> Environment Variables:

| Name | Type | Purpose |
|---|---|---|
| `VITE_WEB3FORMS_KEY` | Secret | Static fallback form delivery |
| `VITE_BUSINESS_PHONE` | Plain variable | Public phone links and schema |
| `VITE_BUSINESS_EMAIL` | Plain variable | Public email links and schema |
| `VITE_BUSINESS_WHATSAPP` | Plain variable | Public WhatsApp link |
| `LEAD_NOTIFY_TO` | Plain or secret | Inbox for operations lead notifications |
| `EMAIL_FROM` | Plain variable | Verified sender address for lead emails |
| `RESEND_API_KEY` | Secret | Recommended email provider |
| `KV_REST_API_URL` | Secret | Vercel KV / Upstash REST URL |
| `KV_REST_API_TOKEN` | Secret | Vercel KV / Upstash REST token |
| `CRON_SECRET` | Secret | Authenticates `/api/cron/*` jobs |

Optional:

| Name | Purpose |
|---|---|
| `VITE_ZOOM_URL` | Shows Zoom as a contact route once the business URL is ready |
| `LEAD_NOTIFY_CC` | Backup inboxes |
| `SENDGRID_API_KEY` | Email fallback |
| `MAILCHANNELS_API_KEY` | Email fallback |
| `EMAIL_WEBHOOK_URL` | Zapier/Make/n8n/custom fallback |
| `SLACK_LEADS_WEBHOOK` | Team alert channel |
| `DISCORD_LEADS_WEBHOOK` | Team alert channel |
| `ADDITIONAL_ALLOWED_ORIGINS` | Exact staging origins only, comma-separated |

Never place real secrets in `.env.example`, README files, screenshots, or client-side `VITE_` variables unless the value is intentionally public.

## Hostinger role

Use Hostinger for:

- Domain registration or DNS if that is where the domain already lives.
- Business email hosting.
- Static fallback release package from `npm run release:hostinger`.

Do not make Hostinger the primary runtime if you need Vercel APIs, KV, cron, health checks, or CSP reporting. The Hostinger `.htaccess` intentionally returns 404 for `/api/*` so the public static package never pretends to run the backend.

## DNS shape

Use one of these patterns:

### Hostinger DNS, Vercel website

Keep DNS in Hostinger, then point the website records to Vercel using the DNS records Vercel gives you in the domain setup screen. Keep Hostinger email DNS records in place.

This is the recommended route when Hostinger already manages email.

### Vercel DNS, Hostinger email

Move nameservers to Vercel, then recreate Hostinger email MX/SPF/DKIM/DMARC records in Vercel DNS.

This is cleaner for the web app but easier to misconfigure for email. Use only if you are comfortable editing DNS.

## After first production deploy

1. Open `https://www.beitbuilding.com/api/health`.
2. Confirm `ok: true`.
3. Confirm `deps.kv` is `up` or intentionally `disabled`.
4. Confirm `deps.email.status` is `configured`.
5. Submit one real test lead from the live site.
6. Confirm the operations inbox receives it.
7. Confirm the customer acknowledgement email sends when email is provided.
8. Check Vercel Function logs for `/api/leads`, `/api/events`, and `/api/csp-report`.
9. Confirm the daily purge cron appears in Vercel Cron Jobs.
10. Keep the newest Hostinger fallback zip from `release/beitbuilding-hostinger-upload.zip`.

## Current security posture

- No broad `*.vercel.app` API trust. Preview origins must be exact.
- CSP blocks framing, object/embed payloads, inline event handlers, and undeclared external resources.
- CSP reports flow to `/api/csp-report`.
- Lead intake enforces JSON content type, size limits, origin checks, honeypots, validation, deduplication, and distributed rate limits.
- Secrets are compared in constant time.
- Lead records expire after 90 days through KV TTL plus a cron safety net.
- `.vercelignore` excludes local screenshots, releases, logs, and env files from deploy uploads.

## Release commands

```bash
npm run release:vercel
npm run release:hostinger
```

Use `release:vercel` for the primary production path. Use `release:hostinger` when creating the static fallback package.
