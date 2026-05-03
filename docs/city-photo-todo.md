# City Page Photo TODO — Master List

Each Beit city landing page renders three project tiles. This document is the consolidated brief: what photo, what folder, what naming convention, what dimensions. Replace placeholders over time as real project photos accumulate.

The Orlando-specific brief (`docs/orlando-photo-todo.md`) was created in Phase 7 — this Phase 8 document covers Winter Park, Oviedo, and the Oviedo storm-damage page.

---

## Universal specs

| Property | Target |
| --- | --- |
| Aspect ratio | 4:3 |
| Resolution | 1600 × 1200 minimum (CSS displays 800 × 600 but ships hi-DPI) |
| Format priority | WebP at quality 82 → JPEG at quality 84 fallback |
| File size | WebP ≤ 180 KB, JPEG ≤ 240 KB |
| Color | sRGB; avoid filters that flatten roof material details |
| Orientation | Landscape (vertical photos crop awkwardly into the tile) |

Use the same Sharp pipeline pattern from `scripts/optimize-logos.mjs` for batch conversion if needed.

After uploading a real photo, the runtime onError handler in `CityPage.tsx` automatically removes the "Photo coming soon" placeholder treatment when the image loads successfully — no code changes required.

---

## Winter Park (`/winter-park-roofing`)

Folder: `public/images/projects/winter-park/`

**Tile 1 — `park-avenue-clay-tile-restoration`**
- Caption: *Park Avenue district — clay tile restoration with period-matched color lot*
- Capture: Mediterranean Revival or Spanish Colonial home in the Park Avenue district. Roof in finished state. Match the historic-home pitch — "we restored, we didn't just replace."
- Bonus: a side-by-side with a tile sample card showing the matched-color lot reads as proof.

**Tile 2 — `olde-winter-park-cedar-shake`**
- Caption: *Olde Winter Park — cedar shake porch restoration with kiln-dried mill stock*
- Capture: Cedar-shake porch detail (close enough to see the wood grain) on an Olde Winter Park-style home. Late-afternoon side light makes shakes pop.
- Bonus: include a side shot showing the original cedar coloration vs. weathered baseline.

**Tile 3 — `lake-sue-copper-flashing`**
- Caption: *Lake Sue — hand-fabricated lead-coated copper flashing & ridge details*
- Capture: Copper detail work — hand-fabricated chimney saddle, valley flashing, or ridge cap. Patina-aged or freshly installed both work; pick whichever Beit has done that the homeowner approved for portfolio use.

---

## Oviedo (`/oviedo-roofing`)

Folder: `public/images/projects/oviedo/`

**Tile 1 — `alafaya-woods-tile-replacement`**
- Caption: *Alafaya Woods — concrete tile replacement following Ian damage*
- Capture: Concrete-tile roof in finished state on an Alafaya Woods-style home (1990s-2000s suburban two-story). Wide angle showing the home plus roof reads as "complete project."

**Tile 2 — `stoneybrook-shingle-storm`**
- Caption: *Stoneybrook — full architectural shingle replacement after Nicole*
- Capture: Architectural-shingle roof on a Stoneybrook-style home (newer subdivision, modern stucco). Drone aerial works very well here — algorithmic shingle pattern reads cleanly from above.

**Tile 3 — `live-oak-reserve-paint-siding`**
- Caption: *Live Oak Reserve — full exterior repaint with elastomeric system*
- Capture: A two-story Oviedo home post-exterior-repaint. Show the full façade so the color reads. If James Hardie siding was part of the project, make sure the lap detail is visible.

---

## Oviedo Storm Damage (`/oviedo-storm-damage`)

Folder: `public/images/projects/oviedo-storm-damage/`

These photos differ from the standard Oviedo page — they show **work in progress**, **damage**, and **emergency response**, not finished portfolio shots. Authenticity beats polish here.

**Tile 1 — `alafaya-woods-emergency-tarp`**
- Caption: *Alafaya Woods — emergency tarping deployed within 6 hours of call*
- Capture: A roof actively being tarped, or just-tarped. The blue tarp + Beit-branded vehicle in frame is gold. Storm-aftermath context (broken branches, debris) reinforces the urgency angle.

**Tile 2 — `stoneybrook-claim-documentation`**
- Caption: *Stoneybrook — drone aerial documentation for insurance claim package*
- Capture: A drone aerial of a storm-damaged roof showing the damage clearly. This photo doubles as a portfolio piece AND as an example of what claim-quality documentation looks like.
- Bonus: a screenshot/composite of the documentation packet (with carrier logos blurred) reads as proof of process.

**Tile 3 — `twin-rivers-permanent-repair`**
- Caption: *Twin Rivers — permanent re-roof following carrier-approved scope*
- Capture: The "after" photo of a completed storm-damage repair. Wide angle of the finished roof. Pairs naturally with Tile 1 + Tile 2 to tell a damage → mitigation → permanent-repair narrative.

---

## Renaming a tile

If you change a slug:
1. Update `src/data/cities/<slug>.ts` `localProjects[i].slug` + `alt` + `caption`.
2. Re-upload the file to `public/images/projects/<city-slug>/<new-slug>.webp` + `.jpg`.
3. Run `npm run build` and verify the placeholder treatment is gone.

## Adding a 4th+ tile

The CityProjects grid is `auto-fit` — adding a 4th project entry to `localProjects` automatically expands the grid. No CSS changes needed.

## Orlando

See `docs/orlando-photo-todo.md` for the Orlando-specific photo brief. Same conventions, separate file because Orlando shipped first and has more detailed per-tile capture notes.
