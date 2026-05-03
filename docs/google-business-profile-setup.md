# Google Business Profile — Setup Playbook

This document is the step-by-step playbook for claiming, verifying, and operating the Beit Building Contractors Google Business Profile (GBP) listing.

**Why GBP matters:** GBP is the single highest-leverage lever for local search visibility in 2026. It controls:

- Whether you appear in the Google Maps "3-pack" for "roofer near me" queries
- The rich-result panel on branded searches (the right-side card)
- Star ratings displayed in search results
- Direct phone-tap and direction CTAs from search
- Photos surfaced in image search

A complete and active GBP listing typically outranks any individual website page for local intent queries. **A neglected listing actively hurts ranking** — Google interprets stale GBPs as low-quality.

---

## Pre-claim checklist

Before you go to google.com/business, confirm the canonical NAP (Name, Address, Phone) you'll enter matches what's already on the website + DBPR + every other directory. Drift is what causes ranking penalties.

The canonical NAP is in `src/data/business.ts` and is exactly:

| Field | Canonical value |
| --- | --- |
| **Name** | Beit Building Contractors LLC |
| **Address** | 2703 Dobbin Dr, Orlando, FL 32817 |
| **Phone (E.164)** | +1 407-942-6459 |
| **Phone (display)** | (407) 942-6459 |
| **Email** | beitbuilding@gmail.com |
| **Website** | https://www.beitbuilding.com |
| **Hours** | Mon-Sat, 7:00 AM - 6:00 PM (Sunday closed) |

Use these exact values throughout the GBP setup. Match capitalisation, spacing, and punctuation. Google compares your GBP listing against your website's schema and footer text — any visible drift weakens your local ranking signal.

> **Run `npm run check:nap` from the project root before you submit anything.** This script flags drift between `src/data/business.ts` and every component / HTML file on the site. Fix any reported drift before you publish your GBP.

---

## Step 1 — Claim the listing

1. Go to [google.com/business](https://www.google.com/business/).
2. Sign in with the Gmail account you want to associate with the listing. Recommendation: use `beitbuilding@gmail.com` so the email matches the website. If a personal Gmail is tied to legacy listings, create a fresh account at `office@beitbuilding.com` and use that for GBP. Document the credentials in 1Password under "GBP — Beit Building Contractors."
3. Click "Manage now" → enter the business name "Beit Building Contractors LLC" exactly as in the canonical NAP.
4. If a listing already exists (Google may have auto-created one from public data sources), click the existing card to claim it. If not, click "Add your business to Google."

---

## Step 2 — Service area vs storefront

When asked "do customers visit you?":

- **Recommendation: select BOTH.** Beit's 2703 Dobbin Dr address is the registered DBPR business address (where licenses are anchored). Listing it as a storefront builds NAP citation strength. But Beit primarily serves customers at THEIR locations, not at the office — so service-area is the operating mode.
- After selecting "yes" for storefront, immediately add the service area (next step).

---

## Step 3 — Set the service area

Add these specific cities (in order of priority, matching the cities currently with dedicated landing pages):

1. Orlando, FL
2. Winter Park, FL
3. Oviedo, FL
4. Kissimmee, FL
5. Sanford, FL
6. Altamonte Springs, FL
7. Maitland, FL
8. Apopka, FL
9. Lake Mary, FL
10. Casselberry, FL

Avoid setting a "20 mile radius around Orlando" — explicit city names are stronger ranking signals. The cap is roughly 20 cities; we use 10 to leave room for expansion without hitting the limit.

---

## Step 4 — Categories

Google allows ONE primary + up to NINE additional. Choose conservatively (over-broad categories dilute ranking).

- **Primary: Roofing Contractor** (the highest-volume search term, matches our DBPR CCC license)
- **Secondary, in priority order:**
  - General Contractor (matches CGC license)
  - Construction Company
  - Painter
  - Deck Builder
  - Siding Contractor

Skip "Handyman," "Home Builder," and "Storm Damage Restoration Service" unless you can dedicate ranking effort to each. Each category dilutes the others.

---

## Step 5 — Phone, hours, website

- **Phone:** (407) 942-6459 — exactly this format. No "+1" prefix in the GBP field; Google displays it without the country code.
- **Hours:**
  - Monday-Saturday: 7:00 AM - 6:00 PM
  - Sunday: Closed
- **Website:** `https://www.beitbuilding.com` (the canonical URL with HTTPS + www)
- **Special hours:** Add holiday closures (Thanksgiving, Christmas, New Year's Day) BEFORE they happen each year. Showing up "Open" when you're actually closed annoys customers and Google penalises mismatch.

---

## Step 6 — Verification (the postcard step)

Google sends a postcard with a 5-digit verification code to the address you submitted. Expected timing: **5-14 business days**.

- The postcard arrives addressed to the business at 2703 Dobbin Dr.
- Once received, log into the GBP dashboard, enter the code.
- If the postcard doesn't arrive within 14 days, request another. Do NOT make changes to the listing while waiting — changes restart the verification clock.
- Some businesses are eligible for video verification (the GBP dashboard offers this if available). It's faster but not guaranteed.

**Until verified, the listing is not visible on Maps and the rich-result card.** Plan around this delay.

---

## Step 7 — Profile completion (after verification)

Once verified, fill in everything. Incomplete profiles rank lower than complete ones.

### Description (750 char max)

Recommended draft:

> Beit Building Contractors is Orlando's local roofing and construction specialist, serving Orange and Seminole counties. We hold two active Florida DBPR licenses — Certified Roofing Contractor CCC1337413 and Certified General Contractor CGC1534077 — and our crew is fully bilingual English/Spanish. Services: roof replacement, repair, storm damage; general construction and renovations; deck and fence installation; interior and exterior painting and siding. Licensed, insured, with free no-obligation inspections and 24/7 storm response. Verify our licenses at myfloridalicense.com.

Limit to about 600 chars to leave headroom for future updates without truncation.

### Services list

Mirror `src/data/business.ts` SERVICES array. Add each as a separate service entry in GBP. For each, add a 1-2 sentence description (Google indexes these for "near me" intent matching):

- **Roof Replacement** — Tile, shingle, metal, and flat-roof systems installed to FBC 7th Edition (2024). Free inspections, full insurance claim support.
- **Roof Repair** — Storm damage, leak diagnosis, flashing repair, vent boot replacement. Same-week scheduling for non-emergency repairs.
- **Storm Damage Roofing** — 24/7 emergency tarping. Insurance claim documentation and carrier mediation.
- **General Construction** — Ground-up builds, additions, kitchens, bathrooms. License CGC1534077.
- **Deck and Fence Installation** — Composite, pressure-treated, cedar. Code-compliant pool fencing per Florida statute Chapter 515.
- **Painting and Siding** — Interior, exterior, James Hardie fiber-cement siding. UV-rated systems for sustained Florida exposure.

### Photos

Minimum 10 photos before going live. Recommended composition:

- 1 logo (the existing logo file at `public/logo.png` works)
- 1 cover photo (1024×575) — best Beit project hero shot, ideally a finished tile-roof Mediterranean or a standing-seam metal install
- 5+ project photos (tile, shingle, metal, deck, paint — variety wins)
- 2 team photos (crew at work, ideally with branded vehicles or shirts)
- 1 license verification screenshot (DBPR portal showing the CCC + CGC active)

Update photos monthly — Google rewards active profiles.

### Attributes

Tick these where they apply:

- Identifies as: Latino-owned (if applicable — owner's choice)
- Identifies as: Women-owned (if applicable)
- Online appointments: Yes (link to `/#contact` form)
- On-site services: Yes
- Free estimates: Yes
- Wheelchair accessible parking lot: ?
- Languages spoken: English, Spanish

---

## Step 8 — Q&A pre-seeding

GBP shows a public "Questions and Answers" section. Pre-seed it with the highest-intent FAQs from `src/data/faqs.ts` so visitors see polished answers immediately:

1. **"Are you licensed?"** — Yes. Two active Florida DBPR licenses: Certified Roofing Contractor CCC1337413 and Certified General Contractor CGC1534077. Verify at myfloridalicense.com.
2. **"Do you offer free estimates?"** — Yes. Free no-obligation inspections in Orlando, Winter Park, Oviedo, and the surrounding service area. Schedule at https://www.beitbuilding.com/#contact.
3. **"Do you handle insurance claims?"** — Yes. Full claim documentation, carrier mediation, and storm-damage emergency response. We document with drone aerial photos, attic moisture readings, and code-compliance scopes that adjusters need.
4. **"What areas do you serve?"** — Greater Orlando, Orange County, and Seminole County. Cities include Orlando, Winter Park, Oviedo, Kissimmee, Sanford, and Altamonte Springs.
5. **"Do you speak Spanish?"** — Yes. Our crew is fully bilingual English/Spanish.
6. **"How fast can you respond after a storm?"** — 24/7 during named-storm events. Tarping crews dispatch within 4-6 hours of call across Orange and Seminole counties.

Phrase these as a customer would ask, then provide the polished answer signed by Beit Building.

---

## Step 9 — Posts cadence

GBP Posts surface like mini blog entries on the listing card. Update **at least once per week** for ranking benefit. Post types:

| Type | Cadence | Content |
| --- | --- | --- |
| **Project completed** | 1-2/week | Photo + 1-paragraph description + neighborhood tag |
| **Tip / educational** | 1/week | Short tip from `src/data/faqs.ts` answers, paraphrased |
| **Special offer** | 1-2/month | Free inspection promo, financing offer (must be specific dates) |
| **Event** | as needed | Hurricane prep day, open house, expo |

Posts expire after 7 days unless they're "events" or "offers" — but their ranking signal persists. Old posts vanish from the listing but stay indexed.

---

## Step 10 — Review request workflow

See `docs/review-request-templates.md` for the email + SMS templates.

Workflow:

1. After every completed job, send the post-job email within 24-48 hours
2. Include the direct review link (Google provides a "Share Review" link in the GBP dashboard — it's `https://g.page/r/<place-id>/review`)
3. Reply to EVERY review (positive AND negative) within 48 hours. Replies signal active management.
4. Never offer compensation for reviews (Google policy + FTC rule)
5. Never review-gate (asking happy customers in person and unhappy customers in private — illegal under FTC's December 2024 rule)
6. Track review responses in a spreadsheet — date received, sentiment, replied yes/no, anything actionable in the feedback

---

## Common pitfalls

**NAP drift.** The fastest way to tank a new GBP is having different NAP on the listing vs. the website vs. BBB vs. Yelp. Run `npm run check:nap` before publishing, and again any time you update an address or phone.

**Category over-selection.** Choosing 8+ categories dilutes ranking. Stick to the 5-6 we recommend.

**Suspended listings.** Google flags GBP listings as "suspicious" if multiple listings share the same address (common for shared offices), if the address is a P.O. Box (not allowed for service-area businesses), or if duplicate listings exist. Make sure no legacy / unclaimed Beit listings exist before claiming the new one — search Maps for "Beit Building" before starting.

**Stale photos.** A profile that hasn't been updated in 6+ months ranks lower than active ones. Schedule a 15-min monthly review on the calendar.

**Empty Q&A.** If you don't pre-seed the Q&A, anyone can ask — and competitors sometimes do, leaving questions like "is this contractor licensed?" unanswered. Pre-seed.

**Forgetting to update after license renewal.** DBPR licenses renew every 2 years. When CCC1337413 or CGC1534077 renews on 08/31/2026, update the description AND the dbprData.ts file AND the schema fallback in index.html.

---

## Once verified — feed the URL back into the site

Once your GBP is verified and you have the public listing URL (typically `https://g.page/r/<place-id>` or the longer maps.google.com URL), update **two specific places** in the codebase:

1. **`src/data/business.ts`** — set `export const GBP_URL = 'https://g.page/r/...'` (currently `null`). This propagates to:
   - The LocalBusiness schema's `sameAs` array (boosts entity-graph signals)
   - The Footer's "View us on Google" link (added in Phase 12)
   - Any future component that imports `GBP_URL`

2. **`src/data/business.ts` SAME_AS array** — the GBP entry is auto-prepended when `GBP_URL` is set, so step 1 covers this automatically. No separate edit needed.

After updating, re-run `npm run build` and deploy. The site is now linked to the GBP and Google's entity graph treats them as one business.

---

## Time estimate

- Initial claim: 30 min
- Postcard wait: 5-14 days
- Profile completion: 90 min
- Photo upload: 60 min
- Q&A pre-seed: 30 min
- First batch of posts: 60 min

**Total active work: ~4-5 hours plus the postcard wait.**

After that: 30 min/week for posts + 15 min/week for review responses.
