# Blog Photo TODO

Per-post photo briefs for the Beit Building blog. Replace placeholder paths in each post's MDX frontmatter (`heroImage` + `ogImage`) with the real assets once the photos exist.

## Universal specs

| Property | Target |
| --- | --- |
| Hero / OG image | 1600 × 900 (16:9), WebP at quality 82 + JPEG fallback |
| In-article images | Max 1200px wide, WebP/JPEG, lazy-loaded |
| File size budget | Hero ≤ 220 KB WebP / 280 KB JPEG; in-article ≤ 150 KB |
| Color | sRGB |
| Alt text | Descriptive, includes context (location, project, condition) |

Folder layout:

```
public/images/blog/<post-slug>/
  hero.jpg
  hero.webp
  fig-01-<descriptor>.jpg
  fig-01-<descriptor>.webp
  fig-02-<descriptor>.jpg
  ...
```

The current MDX `heroImage` paths point to `/images/blog/<some-name>.jpg` — when the real photos land, either drop them at that exact path or update the frontmatter to match the new location.

---

## Post: `florida-hurricane-roof-insurance-claim-guide`

Path expected by frontmatter: `/images/blog/hurricane-claim-hero.jpg` + `.webp`

### Hero (required for above-the-fold)

**Subject:** Hurricane-damaged roof with claim-documentation context. Three good options:

1. Aerial drone shot of a partially-damaged Florida roof — torn shingles visible across one slope, blue tarp partially deployed. Wide enough to show neighborhood context. Late-afternoon side light is ideal.
2. A roofer (Beit crew member, branded shirt or reflective vest) photographing damage with a smartphone — captures the "documentation" theme of the article without being literal damage porn.
3. A claim-documentation packet on a desk: laptop with damage photos visible, drone, moisture meter, printed insurance doc with carrier name redacted. Studio-style still life.

**Recommendation:** Option 1 or 2. Option 3 reads as too business-stocky.

### In-article figures (3-5 supporting photos)

- **fig-01-pre-storm-photo-example** — A clean Florida roof photographed pre-storm with a date-stamp visible. Use to illustrate Section 1's pre-storm documentation advice.
- **fig-02-damage-with-scale** — Damaged shingle area with a 12" ruler or tape measure for scale. Section 3.
- **fig-03-drone-aerial-damage** — Drone aerial of a damaged roof, ideally annotated (text overlays pointing to specific damage). Section 3 + Section 7.
- **fig-04-attic-moisture-reading** — Moisture meter reading in attic decking, with the meter display visible. Section 3.
- **fig-05-mitigation-tarp** — Properly-installed emergency tarp on a Florida roof, visible Beit branding optional. Section 2.

### Owner action

If you don't have these specific photos yet, source from past Beit storm-claim jobs. The damage doesn't have to be from the same year — older Ian or Nicole jobs work fine. The article is timeless content; the photos will get reused as more posts publish.

For the date-stamp pre-storm photo, take a quick photo of a current intact roof TODAY and let the EXIF do the work. That gives us a 2026-stamped reference image immediately.

---

---

## Post: `florida-roofing-materials-guide-2026`

Path expected by frontmatter: `/images/blog/materials-hero.jpg` + `.webp`

### Hero (required)

**Subject:** Three roof material samples laid out on a workbench — a section of clay or concrete tile, a Class-G or Class-H architectural shingle bundle (GAF Timberline preferred since most Central FL homes), and a section of standing-seam metal panel. Golden-hour side lighting. Workbench surface visible (cedar or weathered wood reads premium).

**Alt text recommendation:** "Three Florida roof material samples — concrete tile, architectural shingle, and standing-seam metal — laid side by side."

### In-article figures (4-5)

- **fig-01-clay-tile-detail** — Close-up of installed clay or concrete tile showing the S-tile or barrel profile. Period-correct neighborhood (Audubon Park, College Park, Park Avenue) reads best.
- **fig-02-architectural-shingle** — Close-up of a finished architectural shingle install on a Lake Nona / MetroWest-style modern home. Show the dimensional layered look.
- **fig-03-standing-seam-metal** — Standing-seam metal roof on a Conway / Hunters Creek-style home, low-angle three-quarter view emphasizing the seam pattern.
- **fig-04-flat-tpo-membrane** — TPO membrane install on a residential addition or screen room. White surface visible.
- **fig-05-decision-matrix** — Designed graphic of the decision matrix (table form). Optional but high-leverage for shareability + Pinterest pickup.

### Owner action

The hero photo is the most important since it's the OG card image too. If we don't have a workbench composite, swap to a wide shot of a recently-completed Beit project with the material highlighted. Caption appropriately.

---

## Post: `hurricane-prep-checklist-florida-roof`

Path expected by frontmatter: `/images/blog/hurricane-prep-hero.jpg` + `.webp`

### Hero (required)

**Subject:** A Florida home with menacing storm clouds approaching from the Atlantic side. Single-family residential, mature landscaping, palm trees bending in pre-storm wind. Late-afternoon golden light cutting under the cloud bank reads as both ominous and beautiful — the visual hook for "season is coming."

**Alt text recommendation:** "Florida home before a hurricane — palms bending, storm clouds approaching."

### In-article figures (3-4 supporting photos)

- **fig-01-roof-photo-checklist** — Ground-level photo of a Beit-installed roof showing the full slope (the kind of pre-storm reference image the article tells homeowners to take). Caption draws the parallel.
- **fig-02-gutter-clean** — A clean, freshly-cleared gutter with the downspout visible. Pairs with the 30-day-before checklist.
- **fig-03-tree-trim** — Trimmed tree limbs at safe distance from a roofline, showing the 10-foot clearance the article specifies.
- **fig-04-emergency-supplies** — Flat-lay of hurricane supplies (water gallons, flashlight, batteries, generator fuel can, charged power bank). Optional — generic but useful.

### Owner action

Hero is the high-leverage shot. Without a clean storm-approach photo from the Beit archive, sourcing from a stock library is acceptable for this post — the content itself doesn't reference a specific Beit job. If a Beit-branded vehicle or crew member can be in any of the supporting figures, that's preferred.

---

## Post: `repair-vs-replace-roof-florida`

Path expected by frontmatter: `/images/blog/repair-vs-replace-hero.jpg` + `.webp`

### Hero (required)

**Subject:** A split-frame composition — left half shows a localized roof repair (a contractor patching a single slope, scaffolding visible), right half shows a finished full replacement (clean shingle/tile pattern, fresh look). Visual metaphor for the central question of the article. Alternatively, a single before-after of a Beit-completed project showing both stages stacked vertically.

**Alt text recommendation:** "Florida roof comparison — localized repair vs full replacement."

### In-article figures (3-4)

- **fig-01-decking-soft-spot** — Close-up of a contractor's foot indenting soft decking, or visible rot through removed shingle. Pairs with Section 1 ("structural deck damage").
- **fig-02-granule-loss-bare-felt** — Macro of a shingle slope with significant granule loss, asphalt visible. Pairs with Section 1 ("granule loss approaching bare felt").
- **fig-03-localized-repair** — Beit crew member patching a single damaged slope, showing the surrounding intact roof. Pairs with the "5 signs repair is enough" section.
- **fig-04-aerial-drone-doc** — Drone aerial of a complete roof showing condition variation across slopes. Used in the contractor inspection section.

### Owner action

Hero is the highest-leverage shot. The split-frame metaphor reads strongly even as a stock-style composite. If sourcing original from a Beit project, look for a reroof job where there's a clear before/after that wasn't disrupted by mid-project staging.

---

## Post: `vet-florida-roofing-contractor`

Path expected by frontmatter: `/images/blog/vet-contractor-hero.jpg` + `.webp`

### Hero (required)

**Subject:** A homeowner reviewing a contract on a tablet or laptop, with the DBPR portal visible on the screen showing a license verification result. Or alternatively: a clean composition of a Beit-branded business card next to a printed COI (Certificate of Insurance) on a wood surface, golden-hour light. The visual hook is "due diligence in progress."

**Alt text recommendation:** "Verifying a Florida roofing contractor's license on the DBPR portal."

### In-article figures (3)

- **fig-01-dbpr-portal-screenshot** — A clean screenshot of the DBPR Public License Search results page showing CCC1337413 with "Current, Active" status. Pairs with Section 1.
- **fig-02-coi-sample** — A redacted sample Certificate of Insurance with key fields highlighted (cert holder, GL limits, WC). Section 3.
- **fig-03-checklist-printable** — Designed graphic of the 5-minute due-diligence checklist (pinterest-shareable format). Section 7.

### Owner action

The DBPR portal screenshot is the most important supporting figure — it makes the verification process concrete. Take it once, redact any PII, save permanently to `public/images/blog/vet-contractor/`. Reuse on future posts that reference the verification process.

---

## Post: `roof-replacement-cost-central-florida-2026`

Path expected by frontmatter: `/images/blog/roof-cost-hero.jpg` + `.webp`

### Hero (required)

**Subject:** A clean itemized roofing quote on a clipboard, with a calculator and pen visible. The quote should be readable enough that "Architectural Shingle" or "Tile" reads at hero scale. Alternative: roof material samples with a calculator overlaid as a composite.

**Alt text recommendation:** "Itemized Florida roof replacement quote — line-by-line cost breakdown."

### In-article figures (3-4)

- **fig-01-tile-roof-completed** — Finished concrete or clay tile roof on a Mediterranean-style home (Park Avenue / College Park aesthetic). Pairs with tile cost section.
- **fig-02-shingle-bundle-with-spec** — Close-up of a GAF Timberline or Owens Corning bundle wrapper with the wind-class spec visible. Concretizes the ASTM D7158 references.
- **fig-03-decking-replacement** — Mid-project shot showing decking replacement after tear-off, with weathered/replaced sections visible. Pairs with the add-on costs section.
- **fig-04-permit-screenshot** — Redacted permit document or county online portal showing a roof permit fee. Optional.

### Owner action

Hero is the highest-leverage shot. The "itemized quote on a clipboard" composition is conventional for cost-content articles — strong CTR signal. If sourcing from a real Beit quote, redact specific customer names + addresses but keep line items visible.

---

## Post: `florida-summer-roof-heat-damage`

Path expected by frontmatter: `/images/blog/heat-damage-hero.jpg` + `.webp`

### Hero (required)

**Subject:** Sun-baked Florida shingle roof at midday with heat shimmer above the surface, showing visible color fade or alligatoring on a south-facing slope. Or alternatively: macro shot of a sun-faded shingle showing the granule-loss pattern up close. Strong "summer heat" visual identity.

**Alt text recommendation:** "Sun-faded asphalt shingles on a Central Florida roof showing summer heat damage."

### In-article figures (3-4)

- **fig-01-shingle-blistering** — Macro of blistering / bubble pattern on an aged asphalt shingle. Section 2.
- **fig-02-granule-loss-downspout** — Granules accumulated at the base of a downspout, with the bare-asphalt slope visible above. Section 2.
- **fig-03-attic-thermometer** — A digital thermometer reading 145-155°F in a Florida attic. Section 3.
- **fig-04-ridge-soffit-vent** — Cross-section illustration or photo showing balanced ridge + soffit ventilation airflow. Section 6.

### Owner action

Most heat-damage symptoms are easy to photograph from past Beit jobs. The attic thermometer shot is high-leverage if it can be sourced — concrete proof of the 145°F+ summer attic temps the article references. Take during summer afternoon hours.

---

## Post: `deck-materials-florida-composite-vs-pt-vs-cedar`

Path expected by frontmatter: `/images/blog/deck-materials-hero.jpg` + `.webp`

### Hero (required)

**Subject:** Three deck material samples laid side-by-side on a workbench — pressure-treated pine, composite (Trex/TimberTech), and cedar — to mirror the comparison structure of the article. Golden-hour side light. Mirrors the materials guide hero composition for visual consistency across the materials series.

**Alt text recommendation:** "Three Florida deck material samples — pressure-treated pine, composite, and cedar — laid side by side."

### In-article figures (3-4)

- **fig-01-pt-deck-completed** — Finished pressure-treated deck on a typical Florida residential home. Section 3.
- **fig-02-composite-detail** — Close-up of capped composite board surface showing the texture and color (Trex Transcend or TimberTech AZEK preferred). Section 4.
- **fig-03-cedar-deck-aged** — Cedar deck showing 2-3 year weathered patina, ideally with a refinished section adjacent for contrast. Section 5.
- **fig-04-pool-deck-aluminum** — Aluminum or light-color composite pool deck. Section 7.

### Owner action

Hero composition is conventional for material-comparison content and pinpins well on Pinterest. Sourcing from past Beit deck projects is preferred over stock — neighborhood context can be visible in supporting figures (Live Oak Reserve, Stoneybrook, Avalon Park).

---

## Post: `florida-residential-construction-timeline`

Path expected by frontmatter: `/images/blog/construction-timeline-hero.jpg` + `.webp`

### Hero (required)

**Subject:** A Central Florida residential construction site mid-build — framing visible, roof trusses set, scaffolding in place, ideally with palm trees and Central Florida sky as backdrop. Late-afternoon golden light. Reads as "active project in progress."

**Alt text recommendation:** "Florida residential construction project mid-build, framing and roof trusses installed."

### In-article figures (3-4)

- **fig-01-permit-clipboard** — Construction permit on a clipboard at a project site. Section 2 (Phase 1).
- **fig-02-foundation-slab-pour** — Concrete pour in progress on a residential foundation. Section 3 (Phase 2).
- **fig-03-dried-in-structure** — Framed structure with roof installed and windows in place — the "dried-in" milestone. Section 4 (Phase 3).
- **fig-04-finish-walkthrough** — Final walkthrough — homeowner + contractor reviewing finished interior. Section 6 (Phase 5).

### Owner action

Hero is the highest-leverage. Past Beit project archives likely have several mid-build photos suitable. Crew presence + Beit-branded shirt or vehicle in any figure adds trust signal.

---

## All 8 evergreen blog posts complete (Phase 11 batch)

This document covers heroes + figures for all 8 posts in the evergreen batch:

1. `florida-roofing-materials-guide-2026`
2. `hurricane-prep-checklist-florida-roof`
3. `repair-vs-replace-roof-florida`
4. `vet-florida-roofing-contractor`
5. `roof-replacement-cost-central-florida-2026`
6. `florida-summer-roof-heat-damage`
7. `deck-materials-florida-composite-vs-pt-vs-cedar`
8. `florida-residential-construction-timeline`

Plus the flagship `florida-hurricane-roof-insurance-claim-guide` from Phase 10 and the `welcome` placeholder from Phase 9.

Photos can be sourced over time as Beit project archives accumulate. The runtime auto-removes "Photo coming soon" placeholders when files land at the documented paths.
