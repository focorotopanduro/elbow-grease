# Operations Runbook — beitbuilding.com

This is the single document to reach for when something on the website
needs attention. Three sections: pre-launch checklist, live monitoring,
incident response. If you only read one section, read **§2 Live
Monitoring** — those four checks confirm the lead pipeline is healthy.

---

## §1 Pre-launch checklist

Walk top-to-bottom once before pointing DNS at the production
deployment. Each item has a verification command or URL so you can
prove it's done, not just check a box.

### 1.1 Vercel project

- [ ] Project deployed to Vercel and the production URL responds 200
      at `/` and `/api/health`.
- [ ] Custom domain (`beitbuilding.com` + `www.beitbuilding.com`)
      attached and SSL certs issued (visible green padlock).
- [ ] `vercel.json` `crons` section is enabled (Vercel Pro required
      for cron jobs). Confirm in Vercel UI → Project → Cron Jobs.

### 1.2 Storage (Vercel KV)

- [ ] In Vercel → Storage → **Create Database** → KV.
- [ ] After provisioning, env vars `KV_REST_API_URL` +
      `KV_REST_API_TOKEN` are auto-injected. Confirm in
      Project → Settings → Environment Variables.
- [ ] Hit `https://www.beitbuilding.com/api/health` → response should
      include `"deps": { "kv": "up" }`. If `"down"`, KV is
      misconfigured; see §3.1.

### 1.3 Email transport (Resend recommended)

- [ ] Resend account created at resend.com (no credit card for
      free 100/day tier).
- [ ] Domain `beitbuilding.com` added in Resend → Domains. Three DNS
      TXT records (DKIM × 2, SPF × 1) pasted into the DNS provider.
- [ ] **Verify** clicked in Resend → Domains; status reads "Verified".
      If not, propagation can take up to 1 hour.
- [ ] Vercel env vars set:
  - `RESEND_API_KEY` = `re_...` from Resend (Production + Preview)
  - `LEAD_NOTIFY_TO` = `sandravasquezcgc@gmail.com`
  - `EMAIL_FROM` = `Beit Building Leads <leads@beitbuilding.com>`
  - Optional: `LEAD_NOTIFY_CC` for backup operator
- [ ] Hit `/api/health` → response includes `"email": { "status":
      "configured", "provider": "resend", "recipient": "s***@***il.com" }`.
- [ ] **End-to-end test** — submit the curl in §1.7 and confirm
      `sandravasquezcgc@gmail.com` receives the rich HTML email
      within 10 seconds.

### 1.4 Webhook destinations (optional)

- [ ] Slack incoming-webhook URL → set as `SLACK_LEADS_WEBHOOK`
      env var. See `docs/lead-routing.md` for setup.
- [ ] Discord webhook URL → set as `DISCORD_LEADS_WEBHOOK` env var.

### 1.5 Cron secret

- [ ] `CRON_SECRET` = a strong random value (`openssl rand -hex 32`)
      set in Vercel env vars. Used by `/api/cron/purge-leads` to
      authenticate Vercel-Cron-triggered runs. Without it the cron
      fails closed (refuses to run).

### 1.6 Front-end env

- [ ] `VITE_WEB3FORMS_KEY` set if you want Web3Forms as a redundant
      backup destination. Optional — `/api/leads` is the primary path.
- [ ] `VITE_BUSINESS_PHONE`, `VITE_BUSINESS_EMAIL`, `VITE_BUSINESS_WHATSAPP`
      override the defaults if you need different values per deployment.

### 1.7 End-to-end smoke test

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
    "message": "Smoke test — please ignore.",
    "source": "smoke_test",
    "page": "/",
    "url": "https://www.beitbuilding.com/",
    "ts": "'"$(date -u +%FT%TZ)"'",
    "route": {
      "id": "storm",
      "label": "Storm path",
      "priority": "call-first",
      "intent": "active_leak",
      "contingency": "Tarp + photo set",
      "proof": "Storm imagery"
    }
  }'
```

**Expected outcome:**

1. `202 {"ok":true,"confirmationId":"BBC-...","queued":true}` HTTP
   response.
2. Within 10 seconds, two emails:
   - **Operations email** to `sandravasquezcgc@gmail.com` — red
     "CALL FIRST" banner because we set `priority: call-first`.
   - **Customer ACK** to `test@example.com` — warm greeting, receipt,
     license verification block.
3. Vercel function logs show `[lead]`, `[lead-email]`,
   `[customer-ack]` JSON lines all `ok:true`.

If any of those fails, see **§3 Incident Response**.

---

## §2 Live monitoring

These four checks tell you the system is healthy. Run them weekly
during peak season, monthly otherwise. Or wire UptimeRobot /
BetterStack / Pingdom to ping `/api/health` every 60 seconds.

### 2.1 Health endpoint

```bash
curl -s https://www.beitbuilding.com/api/health | jq .
```

**Healthy response:**

```json
{
  "ok": true,
  "version": "abc12345",
  "uptimeMs": 12345,
  "region": "iad1",
  "ts": "2026-05-02T15:00:00.000Z",
  "deps": {
    "kv": "up",
    "email": {
      "status": "configured",
      "provider": "resend",
      "recipient": "s***@***il.com"
    }
  }
}
```

| Field | Healthy | Action if not |
|---|---|---|
| `ok` | `true` | If `false`, look at `deps` to find the cause. KV `down` returns 503. |
| `deps.kv` | `up` | `disabled` is OK in dev. `down` → check Vercel KV dashboard, restart if connection pool exhausted. |
| `deps.email.status` | `configured` | `disabled` means no provider env var set — leads still flow but no email. Set `RESEND_API_KEY`. |
| `deps.email.recipient` | `s***@***il.com` | Mom's masked address. If different, `LEAD_NOTIFY_TO` was changed — confirm intentional. |

### 2.2 Lead-purge cron is firing

Vercel Cron runs `/api/cron/purge-leads` daily at 05:00 UTC. Confirm
it's running:

```bash
# Vercel CLI required. Log retention is 30 days on the free tier.
vercel logs --prod | grep '\[purge-leads\]'
```

You should see a JSON line every day with `purgedCount`,
`retentionDays: 90`, and `durationMs`.

**If silent for 48 hours:** the cron is paused or failing.
- Check Vercel → Project → Cron Jobs UI.
- Confirm `CRON_SECRET` env var is set (the cron fails closed without it).
- Manually trigger via `curl -H "Authorization: Bearer $CRON_SECRET"
  https://www.beitbuilding.com/api/cron/purge-leads`.

### 2.3 Email send rate

Spot-check the past week's email log lines:

```bash
vercel logs --prod | grep -E '\[lead-email\]|\[customer-ack\]' | tail -30
```

Each line should show `"ok": true`. Sustained `false` means the
email provider is degraded — see §3.2.

### 2.4 CSP violation rate

Spike in `[csp-report] csp_violation` log lines means a recent deploy
introduced a script/font/image that the CSP doesn't allow, OR a
visitor's browser extension is being blocked. Either way, investigate
within 48 hours so you don't ship a broken CSP into search-engine
crawlers.

```bash
vercel logs --prod | grep csp_violation | head -20
```

---

## §3 Incident response

Three failure modes and what to do about them.

### 3.1 Leads stop arriving

**Symptom:** `sandravasquezcgc@gmail.com` hasn't received a lead
in N hours, but you know visitors are filling the form (e.g. you
test-submitted yourself).

**Triage order:**

1. **Hit `/api/health`.** If `"ok": false`, the lead pipeline is
   degraded at infrastructure level. Common causes:
   - `deps.kv: "down"` → Vercel KV outage. Leads still flow to
     email + webhooks, but storage is missing. Wait for Upstash
     status page recovery.
   - `deps.email.status: "disabled"` → Resend env var was rotated
     and the new key isn't set yet. Re-add `RESEND_API_KEY` in
     Vercel.
2. **Submit the curl smoke test** (§1.7). If `202` returns but no
   email arrives → the issue is in the email transport, not in
   `/api/leads`. Check Resend dashboard → Emails for bounces,
   reputation issues, or rate limits.
3. **Check the redundant destinations:**
   - Web3Forms (if `VITE_WEB3FORMS_KEY` set) — log in to
     web3forms.com, check the inbox.
   - Slack channel (if `SLACK_LEADS_WEBHOOK` set) — leads should
     also be appearing there.
   - If those are also empty, the form itself isn't reaching the
     server — check browser console for CORS / CSP errors.

### 3.2 Email provider degraded

**Symptom:** `[lead-email]` log lines show `ok: false` with
`reason: "resend_5xx"` or similar.

**Triage order:**

1. **Check Resend status page** — [status.resend.com](https://status.resend.com).
2. **If Resend is fine but our key is rejected** (`reason: "resend_401"`),
   the key was rotated or revoked. Generate a new key in Resend, set
   in Vercel, redeploy.
3. **If domain verification fails** (`reason: "resend_403"`), the
   DNS records were removed or the domain was un-verified. Re-paste
   the TXT records and click Verify in Resend.
4. **Failover:** add `SENDGRID_API_KEY` as a fallback. The transport
   tries providers in priority order, so SendGrid catches Resend
   failures automatically.
5. **Last resort:** set `EMAIL_WEBHOOK_URL` to a Make/Zapier endpoint
   that relays via whatever transport you have working (e.g. a Gmail
   account via SMTP). The transport's webhook fallback runs after
   all named providers fail.

### 3.3 Suspected security incident

See **`SECURITY.md` § Incident response checklist** — the canonical
workflow for:

- Suspected credential phishing
- Unauthorized lead access
- Suspicious traffic spikes

That checklist covers the immediate (1-hour), same-day, and 72-hour
response phases.

---

## §4 Useful commands

```bash
# Health snapshot
curl -s https://www.beitbuilding.com/api/health | jq .

# Recent lead activity
vercel logs --prod | grep '\[lead\]' | tail -20

# Recent email activity
vercel logs --prod | grep -E '\[lead-email\]|\[customer-ack\]' | tail -20

# Manually trigger lead purge (replaces the daily cron temporarily)
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://www.beitbuilding.com/api/cron/purge-leads

# Smoke test the full pipeline (English)
# See §1.7 above for the full payload.

# Smoke test the Spanish ACK
curl -X POST https://www.beitbuilding.com/api/leads \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://www.beitbuilding.com' \
  -H 'Accept-Language: es-MX,es;q=0.9,en;q=0.5' \
  -d '{"name":"Maria Test","phone":"4079555010","email":"test@example.com",
       "service":"Roofing","source":"smoke_es","page":"/","url":"https://www.beitbuilding.com/",
       "ts":"2026-05-02T15:00:00Z"}'
```

---

## §5 Documents this runbook depends on

- [`SECURITY.md`](../SECURITY.md) — full security posture, incident
  response checklist, account-level 2FA priorities.
- [`docs/lead-routing.md`](./lead-routing.md) — destination setup
  walkthroughs for Resend, SendGrid, Slack, Discord.
- [`CHANGES.md`](../CHANGES.md) — append-only iteration log.
- [`.env.example`](../.env.example) — all env vars explained,
  organized front-end vs server-side.

When something doesn't match what's in this runbook, check those
four files for the canonical answer, then update this runbook to
match (don't let it drift).
