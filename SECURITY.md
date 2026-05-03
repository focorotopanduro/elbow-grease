# Security — Beit Building Contractors LLC website

This document is the operational security playbook for the
`beitbuilding.com` website. It covers how the codebase is hardened,
what to do when something goes wrong, and the account-level practices
that keep visitor data safe.

**Last reviewed:** 2026-05-03
**Owner:** Beit Building Contractors LLC

---

## TL;DR — what's protected and how

| Surface | Protection |
|---|---|
| Cross-site scripting (XSS) | Strict CSP header + meta (allows only same-origin scripts; no Google, no Meta) |
| Clickjacking | `X-Frame-Options: DENY` + `frame-ancestors 'none'` |
| Email header injection (mailto:) | Every form field run through `stripCRLF` + `stripControlChars` before encoding |
| MITM / downgrade | HSTS preload (2-year), `upgrade-insecure-requests` |
| Bot / spam form fills | Honeypot field + plausibility validators (rejects 555-555-5555, all-same-digit, NANP-invalid) |
| Browser fingerprinting | Permissions Policy denies camera, mic, geolocation, sensors |
| MIME sniffing | `X-Content-Type-Options: nosniff` |
| Referrer leakage | `strict-origin-when-cross-origin` |
| Spectre-class side-channels | COOP + CORP `same-origin` |
| Lost lead from network failure | Pending-queue with auto-retry on `online` event (client-side) |
| Stale chunk after deploy | Auto-reload once via session sentinel |
| Persistent visitor profiling | Removed entirely. Per-tab `session_id` only, dies with the tab |
| Third-party tracking | Zero. No Google Analytics, no Meta Pixel, no anything |
| Lead PII at rest | Auto-purge after 90 days via Vercel Cron |
| API abuse (distributed) | KV-backed rate limiter — works across N Vercel instances. Per-IP (10/min leads, 60/5s events) + per-phone-hash (3/24h on leads). |
| Duplicate / replay submissions | SHA-256 fingerprint of `{ip + name + phone + zip}` cached in KV with 60s TTL. Identical resubmits return success-shape silently (so attackers can't probe). |
| Prototype pollution via JSON | `safeJsonParse` in `api/_lib/security.ts` strips `__proto__` / `constructor` / `prototype` keys at every nesting level. |
| Content-type confusion (CSRF-via-form) | API endpoints reject anything that isn't `application/json` (CSRF-via-form attempts use `text/plain` or `x-www-form-urlencoded`). |
| Timing attack on CRON_SECRET | `timingSafeStringEqual` (crypto.timingSafeEqual) instead of `===`. |
| Log injection | All structured-log values stripped of control chars + capped at 1 KB. PII never logged in raw form (phone hashes only, never plaintext). |
| Log poisoning via crafted IP header | `getClientIp` validates IPv4/IPv6 format; anything else logged as 'unknown'. |
| Body-size DoS | Vercel `bodyParser.sizeLimit: '4kb'` (leads) / '8kb' (events) + secondary header check. |
| CSP violations (early-warning) | `/api/csp-report` endpoint receives browser violation reports → structured log → spike alerts you to a bad deploy or injected tracker. |
| Security header drift | `npm run audit:security` fails releases if Hostinger/Vercel lose HSTS, CSP, frame blocking, MIME sniffing defense, referrer policy, permissions policy, COOP/CORP, or cross-domain policy denial. |
| Vulnerability disclosure | `/.well-known/security.txt` is published with contact, canonical URL, expiry, and EN/ES language preference so researchers know where to report issues. |
| Cross-origin API abuse | `/api/leads` and `/api/events` use exact origin allowlisting. Production origins are fixed; preview deploys are accepted only when their exact Vercel URL is present in runtime env, not by trusting all `*.vercel.app`. |
| Health-probe DoS | `/api/health` KV check is cached for 30s so monitor polling at 60s interval doesn't hammer Redis. |
| Email header injection (server) | `api/_lib/email.ts` validates every recipient against `EMAIL_RE` before send AND strips CR/LF/U+2028/U+2029 from subject + custom-header values. Attacker setting `email: "evil@x.com\nBcc: leak@…"` is rejected at the validate step. |
| Lead-route injection | `validateRoute` in `api/leads.ts` only accepts known `priority` values (`call-first` / `estimate-first` / `scope-first` / `work-order`) — anything else collapses to `estimate-first`. Stops a crafted `route.priority: '<script>'` from reaching the email body even though the template escapes it. |
| Reserved/junk phone numbers | `validate()` rejects all-same-digit (5555555555), and area-code/exchange first digit must be 2-9 per NANP rules. Plus the existing per-phone-hash 24h limit. |
| Email PII in logs | `[lead]` log line is now redacted: only `confirmationId`, `service`, route metadata, and `hasEmail` / `hasMessage` booleans are logged. The plaintext name / email / phone / message body never enter Vercel's log retention. The `[lead-email]` log line records provider success, never the body. |
| Customer-ACK email harassment | Per-recipient ACK rate limit: 3 ACK emails per 24 hours per `sha256(email)` hash (`api/leads.ts ACK_LIMIT_*`). Defends against the vector where an attacker rotates IPs but submits the same target email repeatedly — the lead itself still flows to ops, only the ACK to the target is suppressed. |
| Email transport runaway timeout | Per-provider 4s timeout AND a global 7s budget cap in `api/_lib/email.ts`. If the first provider's failure burns the budget, the chain short-circuits rather than letting a 4-provider × 4s sequential failover hit Vercel's 10s function ceiling and return a 502 to the user. |

---

## Traffic-scale threat model (≥10k visits/day)

The defenses above are designed for the realistic 100-1,000/day baseline
of a Florida roofing contractor's marketing site. When traffic scales —
viral Facebook ad, news mention, peak hurricane season — three failure
modes emerge that require additional hardening:

### Failure mode 1: Distributed rate-limit bypass

**Risk:** the previous in-memory rate limiter ran on each Vercel
serverless instance independently. Under load, Vercel spins up N
parallel instances; each had its own counter. An attacker hitting the
endpoint in parallel could get N × the documented limit.

**Defense (shipped):** all rate limits now route through Vercel KV
(Upstash Redis) via `api/_lib/rateLimit.ts`. INCR + EXPIRE are atomic
across all instances. The 10/min per-IP cap on `/api/leads` is now
truly 10/min, period.

**What you still need:** Cloudflare or Vercel WAF in front of the
origin if you ever take a sustained DDoS. Application rate limits
protect data; WAF protects the origin from being saturated. Vercel
Pro includes basic DDoS protection — verify it's enabled.

### Failure mode 2: TCPA-violation call flooding

**Risk:** an attacker rotates IPs (cheap, ~$5/k from a residential
proxy provider) but submits the same target phone repeatedly to weaponize
your call-back as a TCPA-violation campaign against a competitor or
private individual. Per-IP rate limiting alone doesn't catch this.

**Defense (shipped):** second-order rate limit on the SHA-256 hash of
the phone number — 3 submissions per 24 hours per phone, regardless
of source IP. The hash means the rate-limit key in KV doesn't expose
plaintext numbers.

**What you still need:** if your call team reports a phone "flood"
(same number being called multiple times despite our limit), that
indicates a CRM-side bug, not a client-side breach. Check your CRM
deduplication settings.

### Failure mode 3: Cost explosion from bot traffic

**Risk:** every bot POST to `/api/events` writes to KV. At 100k
malicious requests/day, that's a real Upstash bill + log-storage cost.

**Defense (shipped):** `/api/events` rate limit is 60/5s per IP via
distributed KV. Failed submissions return 204 (not 429) so beacon
clients don't retry, capping the actual write volume.

**What you still need:** monitor your Vercel + Upstash bills weekly
during high-traffic campaigns. Set Upstash usage alerts. If the bill
spikes inexplicably, check `[event]` log volume for an outlier IP.

---

## Account-level security (do these before everything else)

The site itself is hardened, but the biggest realistic compromise
vector is **someone phishing or SIM-swapping a credential to a
business account that controls the site or the data**. The fix is
2FA + boring discipline, not more code.

### Use the right kind of 2FA

| Method | Use? | Why |
|---|---|---|
| **Hardware security key** (YubiKey, ~$50) | YES — top 3 accounts | Phishing-proof, can't be SIM-swapped |
| **Authenticator app** (Google Authenticator, 1Password, Authy) | YES — everything else | No SIM-swap surface, works offline, free |
| **SMS 2FA** | **AVOID** | SIM-swap attacks bypass it; leading cause of "secured" account compromise |

If a service ONLY offers SMS 2FA (some banks): use it AND set up a
**port-out PIN with your phone carrier** (5-min call to AT&T / Verizon
/ T-Mobile, free) so an attacker can't transfer your number to their
device.

### Priority order for enabling 2FA

Do these top-down. Stop after #5 if you must; rest can wait a week.

1. **Email account** (Gmail / Workspace / Outlook) — master key for
   everything else. Hardware key recommended.
2. **Domain registrar** (where `beitbuilding.com` is registered) —
   losing domain = losing the business. Hardware key recommended.
3. **Vercel** — controls deploys + lead intake. Authenticator app.
4. **GitHub** — controls source code + deploy pipeline. Authenticator
   app or hardware key.
5. **Bank + business credit card** — money. Authenticator app preferred.
6. **Facebook Business Manager / Ad account** — ad-budget hijacking risk.
7. **CRM** (Jobber / HubSpot / etc., if used) — client list.
8. **DBPR portal** — license records.
9. **Insurance + payments** (Stripe, Square, QuickBooks, workers comp).
10. **Google Business Profile / Yelp / review sites** — reputation.

### Recovery codes

Every service shows 8-10 one-time recovery codes when you enable 2FA.
**Save them.** Two storage options that aren't terrible:

- A password manager (1Password, Bitwarden) — encrypted, accessible
  from anywhere with master password.
- Printed and stored in a physical safe — offline, can't be hacked,
  fine for a small business.

**Do NOT** save recovery codes in plain text on the same device that
holds the 2FA app. If the device is stolen / lost, both factors go
together.

### Annual review (calendar reminder)

Once a year, ideally during slow season:

- [ ] Audit who has access to each account. Remove ex-employees, ex-contractors.
- [ ] Rotate API keys for any external services (Vercel deploy hooks, Resend, Slack webhooks).
- [ ] Review the lead-purge logs (`/api/cron/purge-leads`) — confirm old leads ARE getting deleted.
- [ ] Update this `SECURITY.md` with anything that's changed.
- [ ] Verify 2FA is still enabled on each account.

---

## Architectural security highlights (already shipped)

These are baked into the codebase. Future PRs that violate them should
be rejected at code review.

### First-party only — no third-party trackers

`src/lib/analytics.ts` has a 30-line policy header explicitly forbidding
Google Analytics, Meta Pixel, TikTok Pixel, LinkedIn Insight, Hotjar,
FullStory, etc. The Content-Security-Policy header (in `vercel.json`)
enforces this at the browser level — any attempt to load those domains
is BLOCKED until someone explicitly loosens the policy. That triggers
a code-review conversation by design.

**Why:** Beit Building doesn't need a third-party tracking pixel on
every visitor to operate a lead-gen service. The ad platforms (Facebook,
Google) already know who clicked their own ads via their own attribution.
Our first-party `/api/events` beacon gives us funnel insight without
giving anyone else a profile-building hook.

### No persistent visitor identity

`src/lib/session.ts` exposes only a per-tab `sessionId` that lives in
`sessionStorage`. The previous `getVisitorId()` (persistent localStorage
identifier) was deleted. Cross-session attribution isn't possible by
design — and the data therefore can't be subpoenaed, breached, sold,
or abused, because it doesn't exist.

### DNT + GPC respect

`src/lib/analytics.ts` checks `navigator.doNotTrack` and
`navigator.globalPrivacyControl` at module load. If either is set,
EVERY analytics call becomes a hard no-op for the entire session. The
user said no; we say nothing.

### PII never enters analytics payloads

The form-submit event includes only the random `confirmation_id` (a
receipt with no embedded data), never the actual name / phone / ZIP.
Lead data goes to `/api/leads` only — analytics gets a sanitized
acknowledgment.

### IP addresses never logged

`/api/leads` and `/api/events` both see the client IP at the Vercel
edge for rate-limiting purposes. Neither writes the IP to a log line,
forwards it to email/CRM, or stores it anywhere persistent.

### Lead data auto-purges after 90 days

Two layers of retention enforcement:

1. **Per-record TTL.** Every lead written via `/api/leads` carries a
   90-day TTL on its Vercel KV record. Redis evicts the record
   automatically when it expires — no cron needed for the happy path.
2. **Daily cron safety net.** `api/cron/purge-leads.ts` runs daily at
   05:00 UTC, scans the `leads:by-time` sorted index for any IDs
   older than the cutoff, and deletes both the lead doc + the index
   entry. Catches any record where TTL setup ever fails (e.g. a
   future code change that forgets to set EX on the write).

#### Vercel KV setup (one-time)

1. In Vercel project → **Storage** → **Create Database** → **KV**.
   Vercel auto-creates an Upstash Redis database in your nearest region
   and injects two env vars into your serverless functions:
   `KV_REST_API_URL` and `KV_REST_API_TOKEN`.
2. Redeploy. The next `/api/leads` POST starts persisting to KV.
3. Verify by hitting `/api/health` after a test submission, then
   inspecting the Vercel KV dashboard — you should see `lead:BBC-...`
   keys + the `leads:by-time` sorted set populating.

If you skip the setup, the API gracefully degrades — leads still log
to stdout + the mailto: handoff still works, but no persistent
history. A single warning log line on cold-start tells you KV is
disabled (look for `[kv] KV_REST_API_URL not configured`).

### Form data never persists past a successful submit

`useFormPersistence` clears the localStorage draft on submit success.
A user who submits, closes the browser, and comes back has no draft
of their previously-typed data sitting on disk.

---

## Data retention

| Data | Retained | Why |
|---|---|---|
| Lead records (name + phone + ZIP) | **90 days max** | Long enough to call back + follow up, short enough to limit breach blast radius. Auto-purged by `/api/cron/purge-leads`. |
| Analytics events (anonymous) | **30 days** | Vercel function log default. Funnel analysis only needs short-term data; long-term trends should be aggregated separately. |
| Form draft (client-side) | **24 hours** | TTL in `useFormPersistence`. Cleared on submit success. |
| Pending lead queue (client-side) | **7 days** | TTL in `pendingLead.ts`. Auto-retries during this window. |
| Session ID | **Tab lifetime + 30 min idle** | sessionStorage, never persisted. |

**The data we don't collect can never be lost.** Removing the
persistent visitor_id, IP collection, and per-field telemetry is
the strongest privacy defense in the codebase.

---

## Incident response checklist

If you suspect a compromise — credential phished, suspicious account
activity, breach notification from a vendor, anything — work through
this list in order. Don't skip steps even if you think you know what's
wrong.

### Immediate (within 1 hour)

- [ ] **Change the password** on the suspected account.
- [ ] **Verify 2FA is still enabled** on that account; re-enable if not.
- [ ] **Revoke active sessions** on the account (most services have a
      "sign out everywhere" button under Security settings).
- [ ] **Check recent activity logs** on the account (last 7 days). Note
      any unfamiliar IPs / devices / login times.
- [ ] **Rotate any API keys / tokens** the compromised account has access
      to (Vercel deploy hooks, Resend API key, Slack webhook URLs).
- [ ] If the compromised account is **email**: change passwords on every
      account that uses that email for password reset (basically all of them).

### Same day

- [ ] **Pull the Vercel logs** for the suspect timeframe — look for
      unusual /api/leads or /api/events activity, deploy events from
      unfamiliar IPs.
- [ ] **Check the GitHub repo for unauthorized commits** (Insights >
      Network or `git log --since="48 hours ago"`).
- [ ] **Verify the live site** matches the latest commit. View source +
      check for injected scripts that aren't in the CSP whitelist.
- [ ] **Check the lead inbox / CRM** for entries that don't match the
      `/api/leads` log (sign of direct injection).

### Within 72 hours

- [ ] **If lead data was exposed:** Florida Information Protection Act
      requires notification of affected residents within 30 days
      (sometimes faster depending on data type). Phone + name + ZIP
      may not trigger the strict definition of "personal information"
      under FIPA, but consult a lawyer to be sure.
- [ ] **Document the incident** — what was compromised, when, how,
      what was done about it. Keep this even if it turned out to be
      nothing — pattern-matching across multiple "small" incidents
      reveals targeted campaigns.
- [ ] **Notify any affected vendors** if their integration was the
      vector (Resend, Stripe, etc.) — they may have logs that help.

### Post-mortem (within 1 week)

- [ ] **Why did this happen?** Phishing email opened? Reused password?
      Vendor breach? Lost device?
- [ ] **What change prevents the same vector next time?** A new training
      reminder? A different password manager? A new vendor?
- [ ] **Update this `SECURITY.md`** with the new lesson.

---

## Reporting a vulnerability

If you've found a security issue with this site, please:

- **Email:** `contact@beitbuilding.com` with subject prefix `[SECURITY]`
- **Don't:** post in a public GitHub issue, social media, or PR description
- **Expected response:** acknowledgment within 5 business days

Include enough detail to reproduce — URL, steps, any HTTP requests /
responses involved. We're a small contractor; we don't have a bug-bounty
program, but we appreciate disclosure and will credit you in the fix
commit if you'd like.

---

## What this codebase is NOT

To set expectations:

- **Not PCI-compliant.** We don't process credit cards on the site. If
  you ever add payment, that's a much larger compliance lift.
- **Not HIPAA-compliant.** We don't collect or process health information.
- **Not a SOC 2 audit subject.** Vercel itself is SOC 2 + ISO 27001;
  we inherit those controls for hosting, not for our own processes.
- **Not GDPR-certified.** We don't intentionally market to EU residents.
  The privacy posture (DNT respect, no cross-site tracking, minimum data
  collection) does most of what GDPR requires anyway, but full compliance
  for EU traffic would need a DPA + cookie consent banner.

If business needs ever push us into one of these regimes, it's a
materially different security posture and SECURITY.md gets a major
revision.

---

## Useful links

- **CSP cheatsheet:** <https://content-security-policy.com/>
- **Verizon DBIR** (annual breach stats): <https://www.verizon.com/business/resources/reports/dbir/>
- **FL Information Protection Act (FIPA) text:**
  <https://www.flsenate.gov/Laws/Statutes/2014/501.171>
- **TCPA + DNC compliance** (for the call-back component):
  <https://www.fcc.gov/document/tcpa-rules-and-regulations>
