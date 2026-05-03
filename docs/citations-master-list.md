# Citation Master List — Beit Building Contractors

50 prioritized citation sources for a Florida roofing + general contractor. Citations are external directory listings that confirm your NAP (Name, Address, Phone). Each consistent, complete listing is a small ranking signal; together they build the "entity graph" that Google + Bing use for local search trust.

Order is **leverage-first**, not "easiest first." S-tier sources move the needle most; the long tail is a once-per-quarter cleanup chore.

**Before you submit anything:** run `npm run check:nap` to confirm site NAP is consistent. After each citation goes live, copy its URL into `docs/citations-tracker.csv`. Once you've added a few high-trust listings (S-tier + several A-tier), come back to `src/data/business.ts` and add them to `_STATIC_SAME_AS` to feed the schema graph.

---

## S-tier (6) — essential, do first

The S-tier moves rankings on its own. Skip this and nothing else matters.

### 1. Google Business Profile
- **URL:** [google.com/business](https://www.google.com/business/)
- **Why S:** The single highest-leverage local-SEO lever in 2026. Maps 3-pack, rich card, reviews.
- **Difficulty:** 30-min setup + 5-14 day postcard verification
- **Required:** all NAP, primary + secondary categories, hours, services, 10+ photos, GBP description
- **Notes:** Full playbook in `docs/google-business-profile-setup.md` (Phase 12)
- **sameAs:** Yes

### 2. Bing Places
- **URL:** [bingplaces.com](https://www.bingplaces.com/)
- **Why S:** Bing powers ~6-10% of US searches and feeds DuckDuckGo + Yahoo. Free, fast, quick win.
- **Difficulty:** 15-min — Bing offers "import from Google" once GBP is live
- **Required:** same as GBP (mostly auto-filled via import)
- **Notes:** Verification by phone callback or postcard. Auto-import from GBP usually works.
- **sameAs:** Yes

### 3. Apple Business Connect
- **URL:** [businessconnect.apple.com](https://businessconnect.apple.com/)
- **Why S:** Apple Maps backs Siri + every iOS device. Roughly 20% of US smartphone search runs through Maps app.
- **Difficulty:** 30-min + verification (varies)
- **Required:** all NAP, hours, photos, business attributes
- **Notes:** Free. Owner verification by phone or document upload.
- **sameAs:** No (Apple Business Connect doesn't expose a public profile URL)

### 4. Facebook Business Page
- **URL:** [facebook.com/business](https://www.facebook.com/business/)
- **Why S:** Facebook is a major review surface. Many Florida homeowners check FB pages before calling.
- **Difficulty:** 30-min setup + 60-min completion (about, services, photos, first post)
- **Required:** business name, category, NAP, About section, profile + cover photos, 5+ posts before going live
- **Notes:** Set up Reviews tab. Pin a recent project post. Reply to every review within 48h.
- **sameAs:** Yes

### 5. Yelp Business
- **URL:** [biz.yelp.com](https://biz.yelp.com/)
- **Why S:** Major review platform; Yelp data syndicates to Bing + Apple Maps. Customers DO check.
- **Difficulty:** 30-min — verify via phone or postcard
- **Required:** all NAP, categories, hours, services, photos, business description
- **Notes:** Yelp's algorithm aggressively filters reviews — older customers may have reviews "hidden" by spam filter. Don't pay for advertising; the organic listing works fine. Yelp Fusion API exists for read-only access if Phase 12+13 automation matters later.
- **sameAs:** Yes

### 6. Better Business Bureau (BBB) — Florida
- **URL:** [bbb.org/getaccredited](https://www.bbb.org/getaccredited)
- **Why S:** BBB is high-authority and Florida customers (especially older homeowners) actively check. Strong trust signal.
- **Difficulty:** 1-hour — accreditation requires application review (1-2 weeks) + annual fee
- **Required:** all NAP, business documents, references, **annual accreditation fee (~$500-700/yr for small contractors)**
- **Notes:** A non-accredited free listing is auto-created from public records — you can claim it without paying. The PAID accreditation gets you the BBB seal + higher visibility. Worth it for a contractor depending on local competition.
- **sameAs:** Yes

---

## A-tier (10) — high-volume, do second

A-tier moves rankings noticeably. Each is worth the 30 minutes.

### 7. Angi (formerly Angie's List + HomeAdvisor)
- **URL:** [pro.angi.com](https://pro.angi.com/)
- **Why A:** Largest home-services directory in the US. Massive traffic. The free profile is worthwhile.
- **Difficulty:** 30-min profile + optional paid lead-purchase commitment
- **Required:** all NAP, services, photos, business license uploads
- **Notes:** Free profile exists. Their paid lead-gen ("Angi Leads" / formerly HomeAdvisor) requires a credit-card commitment to buy leads at $15-80 each — opt OUT during signup unless you want that. Reviews syndicate from BBB + Yelp + Google.
- **sameAs:** Yes

### 8. Houzz
- **URL:** [pro.houzz.com](https://pro.houzz.com/)
- **Why A:** Strong for premium / design-oriented projects. Park Avenue / Olde Winter Park audience overlap.
- **Difficulty:** 30-min + 30-min photo curation
- **Required:** Premium project portfolio (high-quality photos, captions, project metadata), services, NAP
- **Notes:** Free pro account exists. Houzz weights heavy on photo quality; only upload Beit's best work.
- **sameAs:** Yes

### 9. Nextdoor
- **URL:** [business.nextdoor.com](https://business.nextdoor.com/)
- **Why A:** Hyper-local social platform. Recommendations on Nextdoor convert well. Crew-lives-here angle pays off.
- **Difficulty:** 30-min profile + ongoing engagement
- **Required:** NAP, neighborhood selection (start with Audubon Park, Olde Winter Park, Alafaya Woods), photos
- **Notes:** Free. Engagement rewards are highest within the first 6 months — answer questions actively.
- **sameAs:** Yes

### 10. Thumbtack
- **URL:** [thumbtack.com/pro](https://www.thumbtack.com/pro/)
- **Why A:** Top-of-funnel home-services platform. Quote-request flow.
- **Difficulty:** 30-min + ongoing quote-response activity
- **Required:** services + service-area + photos + NAP
- **Notes:** Free profile exists. Paid tier ("Thumbtack Promote") puts you higher in results — try free first, evaluate after 3 months.
- **sameAs:** Yes

### 11. Better Homes & Gardens — Real Estate Trusted Pros (or successor program)
- **URL:** [bhgre.com/services](https://www.bhgre.com/) — verify availability; the Trusted Pros program has been restructured multiple times
- **Why A:** When available, ties to BHG's home-improvement audience.
- **Difficulty:** Verify availability first
- **Required:** NAP, services, certifications
- **Notes:** Treat as B-tier if program isn't currently active in your area.
- **sameAs:** Yes (if listing exists)

### 12. Manta
- **URL:** [manta.com](https://www.manta.com/)
- **Why A:** Long-standing US business directory. Decent traffic, free.
- **Difficulty:** 15-min
- **Required:** NAP + categories + brief description
- **Notes:** Watch for upsell pressure. Free listing is enough.
- **sameAs:** Yes

### 13. MerchantCircle
- **URL:** [merchantcircle.com](https://www.merchantcircle.com/)
- **Why A:** Older US directory, still ranks for niche queries
- **Difficulty:** 15-min
- **Required:** NAP + brief description
- **Notes:** Free.
- **sameAs:** Yes

### 14. YellowPages.com
- **URL:** [yellowpages.com](https://www.yellowpages.com/)
- **Why A:** Pre-existing listings often auto-created from public records. Claim + complete.
- **Difficulty:** 15-min — search the directory first, claim if a stale listing exists
- **Required:** NAP + categories + photos + hours
- **Notes:** Free claim. Paid upgrades exist; skip them.
- **sameAs:** Yes

### 15. Foursquare for Business
- **URL:** [business.foursquare.com](https://business.foursquare.com/)
- **Why A:** Foursquare data feeds dozens of downstream apps + maps services
- **Difficulty:** 15-min
- **Required:** NAP + categories
- **Notes:** Free.
- **sameAs:** Yes

### 16. Local.com
- **URL:** [local.com](https://www.local.com/)
- **Why A:** Generic but high-domain-authority US directory
- **Difficulty:** 15-min
- **Required:** NAP + categories
- **Notes:** Free.
- **sameAs:** Yes

---

## B-tier (12) — niche-helpful, do quarterly

B-tier are minor signals — meaningful only in aggregate. Batch into 1-2 hour quarterly sessions rather than individual deep dives.

| # | Source | URL | Difficulty | Notes |
| --- | --- | --- | --- | --- |
| 17 | Hotfrog | [hotfrog.com](https://www.hotfrog.com/) | 15-min | Free; older directory; UK + US presence |
| 18 | Brownbook | [brownbook.net](https://www.brownbook.net/) | 15-min | Free; basic listing |
| 19 | Cylex USA | [cylex-usa.com](https://www.cylex-usa.com/) | 15-min | Free; minimal-info listing |
| 20 | Citysquares | [citysquares.com](https://citysquares.com/) | 15-min | Free; auto-created listings often exist |
| 21 | ShowMeLocal | [showmelocal.com](https://www.showmelocal.com/) | 15-min | Free; basic |
| 22 | Find-Us-Here | [find-us-here.com](https://find-us-here.com/) | 15-min | Free |
| 23 | MapQuest | [mapquest.com](https://www.mapquest.com/) | 15-min | Free; powered by Yext partnerships |
| 24 | Tupalo | [tupalo.com](https://tupalo.com/) | 15-min | Free; smaller traffic |
| 25 | GoLocal247 | [golocal247.com](https://www.golocal247.com/) | 15-min | Free |
| 26 | eBusinessPages | [ebusinesspages.com](https://www.ebusinesspages.com/) | 15-min | Free |
| 27 | BizCommunity | (varies) | verify | Several similarly-named directories — search first |
| 28 | Industrial Quick Search | [iqsdirectory.com](https://www.iqsdirectory.com/) | 30-min | Free; B2B-leaning, niche for commercial roofing |

For each B-tier source:
- Check if a stale auto-created listing already exists (search the directory for "Beit Building" first)
- Claim and update rather than creating new (avoids duplicates that cause NAP drift)
- Use the same description text (drafted in the GBP playbook) for consistency

---

## Florida-specific (12) — high local trust

Florida-specific directories carry above-average weight for in-state intent ("Orlando roofer", "Florida licensed contractor").

### 29. Florida Roofing & Sheet Metal Contractors Association (FRSA)
- **URL:** [floridaroof.com](https://www.floridaroof.com/)
- **Difficulty:** Membership application + annual dues
- **Notes:** Strongest trust signal for Florida-specific roofing intent. Member directory listed publicly. Worth the membership cost ($300-500/yr typical) for a credentialed roofer.
- **sameAs:** Yes (member profile URL)

### 30. Florida Chamber of Commerce
- **URL:** [flchamber.com](https://www.flchamber.com/)
- **Difficulty:** Membership application + annual dues
- **Notes:** State-level chamber. Pricey for small contractors; verify ROI vs local chamber.
- **sameAs:** Yes (member profile)

### 31. Orlando Regional Chamber of Commerce
- **URL:** [orlando.org](https://www.orlando.org/)
- **Difficulty:** Application + annual dues
- **Notes:** Local chamber — networking + member directory. ~$500-1000/yr for small business.
- **sameAs:** Yes

### 32. Seminole County Regional Chamber of Commerce
- **URL:** [seminolebusiness.org](https://www.seminolebusiness.org/)
- **Difficulty:** Application + annual dues
- **Notes:** Important for Oviedo + Sanford service area.
- **sameAs:** Yes

### 33. Oviedo–Winter Springs Regional Chamber
- **URL:** [oviedowintersprings.org](https://www.oviedowintersprings.org/)
- **Difficulty:** Application + annual dues
- **Notes:** Hyper-local; strongest signal for Oviedo-specific intent.
- **sameAs:** Yes

### 34. West Orange Chamber of Commerce
- **URL:** [westorange.org](https://www.westorange.org/)
- **Difficulty:** Application + dues
- **Notes:** Covers Winter Garden + Apopka — extends Beit's western Orange County coverage.
- **sameAs:** Yes

### 35. Visit Orlando — Partner Directory
- **URL:** [visitorlando.com](https://www.visitorlando.com/) (partner program)
- **Difficulty:** Verify partner program eligibility (typically tourism-leaning)
- **Notes:** May not apply to a B2C contractor; verify before pursuing.

### 36. Florida BBB (regional)
- **URL:** [bbb.org/local/0733](https://www.bbb.org/local/0733) (Florida Central regional)
- **Difficulty:** See S-tier #6 — same accreditation
- **Notes:** Same as #6 (BBB Florida) — kept here for the Florida-context reader.

### 37. MyFlorida CFO — Insurance Resource Directory
- **URL:** [myfloridacfo.com](https://www.myfloridacfo.com/) — verify if a contractor directory exists
- **Notes:** Florida CFO's insurance ombudsman programs occasionally publish contractor lists for storm-damage response. Worth checking after each named storm season.

### 38. Florida State Licensed Contractor Lookup (DBPR)
- **URL:** [myfloridalicense.com](https://www.myfloridalicense.com/wl11.asp?mode=1&search=LicNbr)
- **Notes:** Already reflected — the public license records for CCC1337413 + CGC1534077 exist by virtue of being licensed. Not a "submission" task; just a verification target other tools (incl. site's own TrustInline component) link to.
- **sameAs:** No (DBPR record isn't structured as a "profile URL")

### 39. Florida Restoration & Mitigation Association
- **URL:** Search "Florida restoration contractors association" — verify currently active
- **Notes:** Storm-damage / restoration-focused association. Membership listings carry weight for `/oviedo-storm-damage` keyword cluster.

### 40. Top Rated Local — Florida
- **URL:** [topratedlocal.com](https://www.topratedlocal.com/)
- **Difficulty:** 15-min
- **Notes:** Free; aggregates reviews from multiple sources.

---

## Niche roofing (10) — manufacturer + association directories

These are gold for roofing-specific intent. Even if the directory isn't a search-traffic juggernaut, getting listed signals professional credibility (you have to be approved, not just submit).

### 41. NRCA (National Roofing Contractors Association) Member Directory
- **URL:** [nrca.net](https://www.nrca.net/)
- **Difficulty:** Membership application + annual dues
- **Notes:** Largest roofing trade association. Member badge on website + listing in public directory.

### 42. GAF Master Elite® Contractor Directory
- **URL:** [gaf.com/en-us/roofing-contractors/master-elite](https://www.gaf.com/en-us/roofing-contractors/master-elite)
- **Difficulty:** Application + GAF training requirements + maintain warranty record
- **Notes:** Top 3% of GAF-installing contractors. Significant trust signal. Required: high install volume + clean warranty record. Worth pursuing if Beit installs significant GAF Timberline volume.

### 43. Owens Corning Preferred Contractor
- **URL:** [owenscorning.com/roofing/preferred-contractor](https://www.owenscorning.com/roofing/contractors)
- **Difficulty:** Application + Owens Corning training
- **Notes:** Similar to GAF. Worth pursuing if Beit installs significant Owens Corning volume.

### 44. CertainTeed SELECT ShingleMaster
- **URL:** [certainteed.com/contractor-locator](https://www.certainteed.com/)
- **Difficulty:** Training + installation track record
- **Notes:** CertainTeed's premium-installer program.

### 45. Tile Roofing Industry Alliance (TRI Alliance)
- **URL:** [tileroofing.org](https://tileroofing.org/)
- **Difficulty:** Membership application
- **Notes:** Florida is a top tile-roofing market. Membership benefits include a public installer directory.

### 46. Metal Roofing Alliance — Member Locator
- **URL:** [metalroofing.com/find-installer](https://www.metalroofing.com/)
- **Difficulty:** Membership application
- **Notes:** Lists certified metal roofing installers. Worth pursuing if Beit does meaningful standing-seam volume.

### 47. RoofingContractor.com Directory
- **URL:** [roofingcontractor.com](https://www.roofingcontractor.com/)
- **Difficulty:** 30-min — submit company profile
- **Notes:** Industry-trade-publication directory.

### 48. Asphalt Roofing Manufacturers Association (ARMA)
- **URL:** [asphaltroofing.org](https://www.asphaltroofing.org/)
- **Notes:** Industry trade association — manufacturer-oriented, not really a contractor directory. Useful as reference for technical citations in blog content.

### 49. Inspectopedia / Roofing Magazine Local Directories
- **URL:** Various
- **Notes:** Aggregator-style sites. Submit if free; skip if paid.

### 50. Yext Listings (paid aggregator)
- **URL:** [yext.com](https://www.yext.com/)
- **Why mentioned:** Yext is a paid service that auto-syndicates a single source-of-truth NAP record to ~100+ directories. ~$500-1500/yr for a small business.
- **Notes:** Aggressive shortcut to broad citation coverage. Not necessary if you DIY 25-30 of the directories above. Worth considering if your time is more expensive than the service fee.

---

## API + automation notes

Most directories don't expose write APIs for free. Notable exceptions:

- **Yelp Fusion API** — read-only. Useful for pulling Yelp reviews into the site's testimonials block (Phase 4 deferred — when implemented, see `src/data/reviews.ts` for the schema integration point).
- **Google Business Profile API** — write access, but requires verified GBP and OAuth flow. Available for batch posts, photo uploads, review responses. Worth scripting only if you're posting daily across many locations.
- **Yext** — full automation, paid (see #50).

For everything else, the realistic workflow is manual. Plan a 4-hour block to knock out S-tier + A-tier, then 30 minutes/quarter to maintain.

---

## Workflow

1. Run `npm run check:nap` to confirm site NAP is consistent (must pass).
2. Submit S-tier 1-6 in order. Each adds the GBP/Bing/Apple/Facebook/Yelp/BBB profile URL to `_STATIC_SAME_AS` in `src/data/business.ts` once verified.
3. Knock out A-tier 7-16 in a single 4-hour block.
4. Schedule quarterly review of B-tier + ongoing Florida-specific.
5. Pursue niche roofing programs (GAF Master Elite, etc.) opportunistically — these unlock when install volume justifies the application work.
6. Update `docs/citations-tracker.csv` after each citation goes live.
7. Periodically run `node scripts/nap-audit.mjs` with `docs/citations-live.json` populated to catch external NAP drift.
