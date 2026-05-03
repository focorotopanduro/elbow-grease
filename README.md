# Beit Building Contractors — Website

Production marketing + lead-capture site for **Beit Building Contractors LLC** (Orlando, FL). React 18 + Vite + TypeScript front-end with Vercel serverless API functions.

> **First time here?** Skip to **[§Where to look first](#where-to-look-first)** below — the codebase is documented across four canonical files, and that section maps each one to a question you might be asking.

---

## Quick reference

| Aspect | Details |
|---|---|
| **Live URL** | https://www.beitbuilding.com |
| **Hosting** | Vercel primary production, Hostinger DNS/email/static fallback ready |
| **Storage** | Vercel KV (Upstash Redis), 90-day TTL on lead records |
| **Lead email recipient** | `sandravasquezcgc@gmail.com` (operations contact) — overridable via `LEAD_NOTIFY_TO` env |
| **Email transport** | Resend (primary) → SendGrid → MailChannels → webhook fallback |
| **Test count** | 328 passing as of release pass (2026-05-03) |
| **Build command** | `npm run build` (target ~1.3s clean build) |
| **Test command** | `npm test` |
| **Preflight command** | `npm run verify:preflight` |
| **Security audit** | `npm run audit:security` |
| **Vercel release gate** | `npm run release:vercel` |
| **Static release audit** | `npm run audit:static` |
| **Hostinger package** | `npm run release:hostinger` |
| **GitHub release automation** | `.github/workflows/vercel-production-gate.yml`, `.github/workflows/release-artifact.yml`, and `.github/workflows/hostinger-manual-deploy.yml` |

---

## Where to look first

Four canonical documents cover the entire codebase — read whichever matches your question.

| If you're asking… | Read this |
|---|---|
| "What did the most recent iteration do, and what's the current state?" | [`CHANGES.md`](./CHANGES.md) — append-only iteration log. Newest entry at the top. Each entry has WHY / WHAT / VERIFY / OPEN ENDS / HANDOFF NOTES. |
| "Is the site safe? What's protected against what?" | [`SECURITY.md`](./SECURITY.md) — TL;DR table of every defense, plus account-level 2FA priorities and the incident-response checklist. |
| "How do I launch this? How do I respond when something breaks?" | [`docs/ops-runbook.md`](./docs/ops-runbook.md) — pre-launch checklist, live monitoring, incident triage. |
| "How does a new lead actually flow from form-submit to mom's inbox?" | [`docs/lead-routing.md`](./docs/lead-routing.md) — destinations, env-var setup walkthroughs (Resend, Slack, Discord), end-to-end test curls. |
| "What env vars do I need to set?" | [`.env.example`](./.env.example) — every variable explained, organized front-end vs server-side. |

When something doesn't match what one of these docs says, **the code is authoritative**. After fixing, update the relevant doc to match — drift between code and docs is the #1 cause of "wait, this isn't what I expected" surprises.

---

For the GitHub -> Vercel -> Hostinger production architecture, read [`docs/vercel-production-setup.md`](./docs/vercel-production-setup.md).

## Architecture at a glance

### Front-end (`src/`)

Single React 18 app served from a Vite multi-page setup. Each city service-area page (`orlando-roofing.html`, `winter-park-roofing.html`, etc.) is its own HTML entry; they all mount the same React runtime via `src/pages/city-mount.tsx`. Home page lives in `index.html` + `src/main.tsx` + `src/App.tsx`.

Key folders:

- `src/sections/` — page sections (Hero, Services, Contact, Footer, etc.)
- `src/pages/` — full-page templates (CityPage, BlogPost, BlogIndex)
- `src/components/` — reusable UI (TrustBadge, MobileLeadCapture, JsonLd, SEO, etc.)
- `src/lib/` — non-UI utilities (`leadIntake.ts`, `analytics.ts`, `callWindow.ts`, etc.)
- `src/data/` — content + schema data (`business.ts`, `faqs.ts`, `clientPaths.ts`, `schemas/`)
- `src/hooks/` — custom React hooks (`useFormPersistence`, `useReveal`, etc.)

### Server-side (`api/`)

Vercel serverless functions. Every endpoint reads its config from environment variables; missing env vars cause the relevant feature to silently no-op rather than fail loud (graceful degradation).

| Endpoint | Purpose |
|---|---|
| `POST /api/leads` | Lead intake — validates, rate-limits, dedups, stores in KV, emails ops, ACKs customer, fans out to webhooks |
| `POST /api/events` | Analytics beacon receiver — first-party only, no third-party trackers |
| `POST /api/csp-report` | CSP violation reports — early warning for bad deploys / injected trackers |
| `GET /api/health` | Uptime probe — KV + email transport status, masked recipient |
| `GET /api/cron/purge-leads` | Daily 90-day retention enforcement (CRON_SECRET-gated) |
| `GET /api/cron/send-review-requests` | Scheduled review-request automation (CRON_SECRET-gated) |

Shared logic lives in `api/_lib/`:

- `email.ts` — vendor-agnostic email transport
- `leadEmail.ts` — operations email template (HTML + plain-text)
- `customerAckEmail.ts` — bilingual EN/ES customer acknowledgement template
- `leadValidator.ts` — pure-function validators with 49 contract tests
- `kv.ts` — Vercel KV adapter (no `@vercel/kv` dependency)
- `rateLimit.ts` — distributed KV-backed rate limiter
- `security.ts` — request IDs, timing-safe comparison, prototype-pollution-safe JSON parse
- `logger.ts` — structured JSON logger
- `webhooks.ts` — Slack + Discord destinations

---

## Local development

```bash
npm install
npm run dev    # Vite dev server on :5173
npm test       # vitest run; --watch for live mode
npm run build  # production bundle
```

## Hostinger static release

Use this when the site is going directly into Hostinger `public_html/` instead of staying fully on Vercel:

```bash
npm run release:hostinger
```

That command builds the site, runs release checks, prepares `release/hostinger-upload/`, creates `release/beitbuilding-hostinger-upload.zip` when zip tooling is available, and writes `release/RELEASE_MANIFEST.json` with file sizes and SHA-256 checksums. Upload the contents of `release/hostinger-upload/` or the contents of the zip into the domain's `public_html/` folder.

The release command includes lint, security audit, tests, the NAP audit, static dist audit, and release verification before packaging. If any public phone/name/address drift, fake contact number, weak security header, broad preview-origin trust, expired security.txt, broken internal dist reference, missing canonical metadata, oversized release chunk, test failure, or lint error appears, the package is not produced.

Hostinger static hosting does not run the Vercel `api/` functions. The included `.htaccess` returns a real 404 for `/api/*` so the contact form falls through to Web3Forms or mailto instead of pretending a backend accepted the lead. Keep Vercel in the stack if you want `/api/leads`, KV archive, Resend emails, Slack/Discord webhooks, or cron jobs.

For a local lead-inbox collector (writes leads to a local NDJSON + CSV file):

```bash
npm run lead:inbox
# then point a local build at:
# VITE_LEAD_ENDPOINT=http://127.0.0.1:8787/lead-intake
```

See `docs/lead-routing.md` "Local office collector" section.

## GitHub release automation

GitHub support is ready. The primary workflow is `.github/workflows/vercel-production-gate.yml`: it runs `npm run release:vercel` on pull requests, pushes to `main`, and manual runs so Vercel production deploys have a matching quality gate. The artifact workflow still builds a downloadable Hostinger fallback package, and the manual deploy workflow uploads `release/hostinger-upload/` to Hostinger when repository secrets are configured and the production deployment is approved.

Read [`docs/github-release-automation.md`](./docs/github-release-automation.md) before connecting credentials.
Read [`docs/vercel-production-setup.md`](./docs/vercel-production-setup.md) before importing the GitHub repository into Vercel.
Use [`docs/hostinger-github-setup-guide.md`](./docs/hostinger-github-setup-guide.md) while creating FTP credentials, destination variables, and GitHub production approvals.

---

## Operating principles

These shape every iteration. Don't undo them without an explicit reason.

- **No third-party trackers.** No Google Analytics, no Meta Pixel, no Hotjar, nothing. The CSP enforces this at the browser level. First-party `/api/events` covers the funnel-analysis use case.
- **Minimum data collection.** We collect name + phone + (optional) email + (optional) ZIP/location + (optional) message. Everything else is derived. IP addresses are used at the edge for rate-limiting and never persisted.
- **90-day retention.** Lead records auto-purge after 90 days via per-record TTL + a daily cron safety net. Three places document this; keep them in sync.
- **Graceful degradation.** Every external dependency (KV, Resend, Slack, Discord) can fail without breaking lead intake. The user always gets a 202 response; missing destinations log and move on.
- **Constant-time secret comparison.** All secret checks (CRON_SECRET, future API keys) use `timingSafeStringEqual`. Never `===`.
- **Defense in depth.** Validation happens at every layer (browser → /api/leads → email transport). The CSP, the X-Frame-Options, the COOP/CORP headers, and the validators all exist independently. Removing any one shouldn't expose the system.

---

## Glossary

| Term | Meaning |
|---|---|
| BBC | "Beit Building Contractors" — used in confirmation IDs (`BBC-XXXX-XXXX`) and email subject prefixes (`[BBC ❗ CALL FIRST]`) |
| DBPR | Florida Department of Business and Professional Regulation; the state body that issues contractor licenses |
| KV | Vercel KV (Upstash Redis), the persistence layer |
| Smart-path | Front-end intent-routing system in `src/data/clientPaths.ts` — picks `call-first` / `estimate-first` / `scope-first` / `work-order` based on visitor signals |
| Mom | Sandra Vasquez, the operations contact who reads every new lead email |

---

## License

This codebase is the property of Beit Building Contractors LLC. All rights reserved. Not open source.
