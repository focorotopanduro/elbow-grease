# Google Search Console + Bing Webmaster Tools — Setup Playbook

Free Google + Microsoft surfaces that show how each search engine sees your site. Submit the sitemap, monitor indexing, watch Core Web Vitals, and get manual-action alerts. This is foundational SEO operations — not optional.

**Time:** ~30 minutes for both setups, then 15 min/week ongoing review.

---

## Why this matters

Without GSC/BWT, you're flying blind:
- Pages can be excluded from Google's index without you knowing
- A penalty (manual action) can hit your domain silently
- Core Web Vitals regressions don't surface until rankings drop
- Search-query data (which keywords drive your impressions) is invisible

GSC alone is the difference between "I think we rank for X" and "we rank #4 for X with 2,400 impressions/month and 12% CTR."

---

## Part 1 — Google Search Console

### Step 1: Property creation

1. Go to [search.google.com/search-console](https://search.google.com/search-console).
2. Sign in with the Gmail you'll use to manage SEO ops. Recommendation: same `beitbuilding@gmail.com` account that owns the GBP listing (Phase 12) — keeps SEO-side credentials concentrated.
3. Click **Add property** → choose **Domain** (preferred over URL prefix). Enter `beitbuilding.com` (no `https://`, no `www`).
4. Google asks for **DNS TXT verification**. Copy the TXT record they show you. It looks like:
   ```
   google-site-verification=abc123def456...
   ```

### Step 2: DNS verification

1. Log into your DNS provider (Vercel handles DNS for `beitbuilding.com` if it's hosted there; otherwise Cloudflare / Namecheap / Squarespace / etc).
2. Add a new TXT record:
   - **Name / Host:** `@` (root) or leave blank — varies by provider
   - **Value:** the full `google-site-verification=...` string Google gave you
   - **TTL:** default (300 or 3600 seconds)
3. Save. Wait 5-15 minutes for DNS propagation.
4. Back in GSC, click **Verify**. If it fails, wait another 10 minutes and retry.

### Step 3: Submit the sitemap

1. In GSC sidebar → **Indexing → Sitemaps**.
2. Add new sitemap. URL: `sitemap.xml` (the path; GSC will prefix with `https://www.beitbuilding.com/`).
3. Click **Submit**.
4. Within 24 hours, GSC will report **Status: Success** and show the routes it discovered (should be 19 with the current sitemap).

### Step 4: Configure email alerts

1. GSC sidebar → **Settings → Email preferences**.
2. Enable:
   - Manual actions (penalty notifications)
   - Indexing issues (when pages get dropped from the index)
   - Coverage report (weekly summary)
   - Core Web Vitals (when p75 crosses thresholds)
3. Save. Alerts go to the verified Gmail.

### Step 5: Request priority indexing

For new high-value pages (Phase-7 city pages, Phase-10 flagship blog post):

1. GSC sidebar → **URL Inspection**.
2. Paste the URL (e.g., `https://www.beitbuilding.com/orlando-roofing`).
3. Click **Request indexing**.
4. Repeat for the 3 other city pages + each flagship blog post.

This doesn't guarantee fast indexing but consistently moves new pages from "discovered" to "indexed" 1-2 weeks faster than passive crawling.

### Step 6: Weekly review cadence

Set a recurring 15-minute calendar block. Each week:

1. **Performance → Search results**. Check impressions, clicks, average position. Look for:
   - Sudden drops > 30% on any major query
   - New top queries (clue for new content angles)
   - CTR < 2% on top-10 ranking queries (means the title/description isn't compelling — rewrite)
2. **Indexing → Pages**. Check the "Why pages aren't indexed" report. Fix anything in `Excluded` that should be indexed.
3. **Core Web Vitals**. If any URL group goes "Poor" or "Needs improvement," check the `docs/performance-baseline.md` regression baseline.
4. **Manual actions** + **Security issues**. Should always be empty. If anything appears, treat as P0.

---

## Part 2 — Bing Webmaster Tools

Bing powers ~6-10% of US searches plus DuckDuckGo + Yahoo. Free, simple, lower-effort than GSC because you can import directly from GSC once both are set up.

### Step 1: Create the property

1. Go to [bing.com/webmasters](https://www.bing.com/webmasters/).
2. Sign in with a Microsoft account (or create one).
3. Click **Import from Google Search Console** if available — Bing pulls properties + sitemap status straight from GSC. ~30 seconds and you're done.
4. If import isn't available, manually add `https://www.beitbuilding.com` and verify via DNS TXT (same flow as GSC, separate verification record).

### Step 2: Submit the sitemap

If you imported from GSC, the sitemap is already submitted. Otherwise:

1. **Sitemaps** in the sidebar.
2. Submit `https://www.beitbuilding.com/sitemap.xml`.

### Step 3: Configure alerts

1. **Site Settings** in BWT.
2. Enable email alerts on: Crawl errors, Manual actions, Sitemap issues.

### Step 4: IndexNow

Bing's IndexNow is a faster crawl protocol than the standard "wait for the spider." Worth enabling:

1. **Configure My Site → IndexNow**.
2. Generate the API key.
3. Drop the key as `<key>.txt` at `public/<key>.txt` so Bing can verify ownership.
4. Add a small build hook that pings IndexNow with new URLs. (Optional — manual submission via BWT is enough for low-velocity content.)

---

## Part 3 — What to monitor weekly

### Healthy state

- GSC sitemap status: **Success** with 19+ URLs
- GSC pages indexed: ~all live URLs (the 4 city pages + 9 blog routes + home + legal)
- GSC manual actions: **None** (always)
- GSC Core Web Vitals → Mobile: most URLs **Good**, none **Poor**
- BWT crawl errors: 0-5 (occasional 404s from inbound links are normal)

### Warning state — investigate within 48h

- Sudden 30%+ drop in impressions or clicks on any major page
- 2+ pages moved from `Indexed` to `Excluded` in the same week
- `Crawled - currently not indexed` count growing
- Any URL group flipped to `Poor` Core Web Vitals
- Any inbound spam links surfacing in BWT

### Alarm state — P0 response

- Manual action notification (read the report carefully; address the violation; submit reconsideration request)
- Security issue notification (compromised site? hacked content? Lock down immediately)
- 60%+ drop in impressions overnight (algorithm update; check Search Engine Roundtable for ongoing updates)

---

## Step-by-step for first-time setup

If you haven't done any of this before:

1. **Today**: GSC property + DNS TXT verification + sitemap submission (~20 min)
2. **Today (continued)**: BWT property via GSC import + sitemap (~5 min)
3. **Today (continued)**: Email alerts configured on both
4. **Tomorrow**: Confirm both report sitemap **Success** + show URLs discovered
5. **This week**: Set up the weekly 15-min calendar block
6. **In ~2 weeks**: First search-query data starts populating in GSC. Look for unexpected wins.

After 30 days you'll have meaningful trend data. After 90 days you can start optimising specific pages based on observed CTR patterns.
