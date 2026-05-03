# Orlando City Page — Photo TODO

The Orlando service-area landing page (`/orlando-roofing`) renders three project tiles from the gallery defined in `src/data/cities/orlando.ts`. Until the actual photos exist, the runtime falls back to a styled "Photo coming soon" placeholder treatment (see `CityPage.css` `.city-projects__item--placeholder`).

This document is the brief for what each photo needs to show, where to drop the file, and how to name it. Replace each placeholder over time as real project photos accumulate.

---

## Folder layout

All Orlando project photos live under:

```
public/images/projects/orlando/
```

Each tile expects **two files** (the runtime serves WebP first, falls back to JPEG):

```
public/images/projects/orlando/<slug>.webp
public/images/projects/orlando/<slug>.jpg
```

Naming convention: kebab-case, neighborhood-or-feature first, year suffix. Examples:

- `audubon-park-tile-replacement-2024.webp` + `.jpg`
- `lake-nona-shingle-storm-2023.webp` + `.jpg`
- `conway-standing-seam-metal-2024.webp` + `.jpg`

## Image specs

| Property | Target |
| --- | --- |
| Aspect ratio | 4:3 |
| Resolution | 1600 × 1200 minimum (the CSS uses 800 × 600 but ships hi-DPI) |
| Format priority | WebP at quality 82 → JPEG at quality 84 fallback |
| File size | WebP ≤ 180 KB, JPEG ≤ 240 KB |
| Color | sRGB; avoid heavy filters that flatten roof material details |
| Orientation | Landscape (vertical photos crop awkwardly into the tile) |

Use the `scripts/optimize-logos.mjs` pattern (Sharp pipeline) for batch conversion if needed — it already handles WebP + JPEG fallback generation cleanly.

## Photos to source

### Tile 1 — `audubon-park-tile-replacement-2024`

**Caption shown on page:** *Audubon Park — full clay tile replacement after Hurricane Ian*

**What to capture:**
- Mediterranean / Spanish-revival home in Audubon Park (or similar mid-century revival neighborhood)
- Full clay-tile roof in finished state, ideally golden hour
- Show full slope ridge-to-eave so the tile pattern reads
- Bonus: include an EXIF-stripped before/after pair if available — we can swap to a slider component later

**Owner action:** select a project file with photo permission cleared. If no Audubon Park project exists, retitle to the actual neighborhood (e.g., College Park, Thornton Park) and update the slug + caption + `localProjects[0]` in `src/data/cities/orlando.ts`.

---

### Tile 2 — `lake-nona-shingle-storm-2023`

**Caption shown on page:** *Lake Nona — architectural shingle replacement after Nicole*

**What to capture:**
- Newer subdivision home (Lake Nona, MetroWest, or Avalon Park aesthetic — modern stucco)
- Architectural shingle roof completed after storm-damage replacement
- A wide angle showing the home's full façade plus roof helps the "after" read clearly
- If a clean drone shot is available, it makes the algorithmic shingle pattern legible

**Owner action:** swap to actual completed Nicole-era replacement. If we don't have a Nicole-specific job, change "Nicole" → "Ian" in the caption (or remove the storm reference entirely — "Lake Nona — architectural shingle replacement").

---

### Tile 3 — `conway-standing-seam-metal-2024`

**Caption shown on page:** *Conway — standing-seam metal install for hurricane resilience*

**What to capture:**
- Standing-seam metal roof on a Conway-area home (or similar mid-century neighborhood)
- Show the seam pattern from a low-angle three-quarter view (highlights the linear ridges)
- Late afternoon light catching the panel surface reads as premium

**Owner action:** swap to an actual Conway metal install. Standing-seam is the highest-end roofing tier — even one strong photo dramatically lifts perceived value of the page.

---

## After uploading

1. Drop both `<slug>.webp` and `<slug>.jpg` in `public/images/projects/orlando/`.
2. If you renamed the slug, update `localProjects[i].slug` + `alt` + `caption` in `src/data/cities/orlando.ts`.
3. Run `npm run build` and confirm the placeholder treatment is gone — the CSS `.city-projects__item--placeholder` class is added at runtime *only* when the image fails to load, so a successful load auto-removes the badge.
4. Spot-check Lighthouse: target Performance 90+ on the Orlando page. The optimization budget is 240 KB JPEG / 180 KB WebP per tile; over those, expect Lighthouse to flag CLS or LCP.

## Future expansion (Phase 8+)

Each additional city page (Winter Park, Oviedo, Oviedo Storm Damage) follows the same folder + slug pattern. The CityPage component is fully generic — there's nothing Orlando-specific in the gallery rendering, just the data file under `src/data/cities/<slug>.ts`.
