# Domain Recovery Runbook

Use this when a previous contractor controls the old Vercel project, but
Beit Building still controls the `beitbuilding.com` domain in Hostinger.

## Current Situation

Hostinger screenshots show the domain is registered/managed in Hostinger,
but the authoritative nameservers are:

```text
ns1.vercel-dns.com
ns2.vercel-dns.com
```

That means DNS records are currently managed in Vercel, likely in the
contractor's Vercel account. Hostinger correctly blocks DNS-record editing
while the domain points at external nameservers.

The recovery move is to route around the contractor:

```text
Owner-controlled local repo
  -> owner-controlled GitHub repo
  -> owner-controlled Vercel project
  -> Hostinger registrar changes DNS away from contractor-controlled Vercel
```

## Do Not Do These

- Do not click random Hostinger "create website" prompts unless choosing
  the emergency static Hostinger route.
- Do not disable domain lock unless transferring the domain away from
  Hostinger.
- Do not remove privacy protection or auto-renewal.
- Do not change nameservers until the new DNS target is ready or the static
  fallback package is ready.
- Do not put real API keys into `.env.example`, GitHub commits, screenshots,
  docs, or client-side `VITE_` variables unless the value is intentionally
  public.

## Route A: Best Production Recovery

This keeps Vercel as the primary runtime for API functions, lead routing,
KV, cron, health checks, and CSP reports.

1. Push this repository to a private GitHub repo owned by Beit Building.
2. Import that GitHub repo into a Vercel account controlled by Beit Building.
3. In Vercel, create the project with:

```text
Install command: npm ci
Build command: npm run build
Output directory: dist
Production branch: main
```

4. Add environment variables in Vercel Production:

```text
VITE_WEB3FORMS_KEY
VITE_BUSINESS_PHONE
VITE_BUSINESS_EMAIL
VITE_BUSINESS_WHATSAPP
VITE_ZOOM_URL
ADDITIONAL_ALLOWED_ORIGINS
LEAD_NOTIFY_TO
LEAD_NOTIFY_CC
EMAIL_FROM
RESEND_API_KEY
SENDGRID_API_KEY
MAILCHANNELS_API_KEY
EMAIL_WEBHOOK_URL
SLACK_LEADS_WEBHOOK
DISCORD_LEADS_WEBHOOK
KV_REST_API_URL
KV_REST_API_TOKEN
CRON_SECRET
```

5. Add these domains to the new Vercel project:

```text
beitbuilding.com
www.beitbuilding.com
```

6. If Vercel asks for domain verification and the current DNS is trapped in
   the contractor's Vercel account, verify by moving DNS control at the
   registrar:

   - In Hostinger, go to Domains -> beitbuilding.com -> DNS / Nameservers.
   - Click Change Nameservers.
   - Choose Hostinger nameservers if using Hostinger DNS, or choose another
     owner-controlled DNS provider.
   - Wait for propagation.
   - Add the DNS records requested by the owner-controlled Vercel project.

7. For Vercel via Hostinger DNS, use the values shown in the Vercel domain
   screen. Common Vercel defaults are:

```text
Type: A
Name: @
Value: 76.76.21.21

Type: CNAME
Name: www
Value: cname.vercel-dns.com or the project-specific Vercel CNAME shown by Vercel
```

8. Preserve email records. If Hostinger email is used, copy its MX, SPF,
   DKIM, and DMARC records into whichever DNS provider is authoritative.

9. After DNS flips, verify:

```text
https://www.beitbuilding.com/
https://www.beitbuilding.com/api/health
https://www.beitbuilding.com/orlando-roofing
https://www.beitbuilding.com/winter-park-roofing
https://www.beitbuilding.com/oviedo-roofing
https://www.beitbuilding.com/oviedo-storm-damage
```

10. Submit one live test lead and confirm the operations inbox receives it.

## Route B: Emergency Static Recovery

Use this if the live site must come back quickly before Vercel is ready.

1. Run:

```bash
npm run release:hostinger
```

2. In Hostinger, switch nameservers back to Hostinger nameservers.
3. Upload the contents of:

```text
C:\BEITBUILDING\website\release\hostinger-upload
```

to the domain's Hostinger `public_html/` folder.

4. This restores the public marketing site, city pages, legal pages, static
   security headers, and Web3Forms/mailto fallback.

Important limitation: Hostinger static hosting does not run Vercel API
functions. `/api/leads`, `/api/events`, `/api/csp-report`, `/api/health`,
KV lead archive, and cron jobs are Vercel-only features.

## Evidence To Preserve

Keep a folder outside the repo with:

- Hostinger screenshots proving domain control.
- Domain overview showing expiration, privacy, lock, and nameservers.
- Contractor refusal messages.
- Contract, invoices, payment proof, and handoff conversations.
- Any Vercel project URLs previously used by the contractor.
- The SHA-256 hash of the owner-controlled Hostinger fallback zip.

## Commands

Primary production gate:

```bash
npm run release:vercel
```

Static fallback package:

```bash
npm run release:hostinger
```

Current first owner-controlled commit:

```text
2d590be Initial owner-controlled production recovery build
```

## Recovery Principle

Do not spend launch-critical time trying to recover the contractor's Vercel
project first. Recover the domain path, deploy owner-controlled source, then
pursue account/legal cleanup after the business website is back under Beit
Building control.
