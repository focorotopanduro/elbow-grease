# Project Portfolio — Photo TODO

The Beit home page renders a filterable portfolio grid sourced from `src/data/projects.ts`. Each project has a hero image + 2-3 gallery shots + optional before/after pair for the modal's image-comparison slider. Until real photos exist, the runtime onError handlers in `ProjectPortfolio.tsx` and `ProjectModal.tsx` fall back to gradient placeholders so the layout stays intact.

## Folder layout

All project photos live under:

```
public/images/projects/<city-slug>/
```

Where `<city-slug>` is one of: `orlando`, `winter-park`, `oviedo`, `kissimmee`, `sanford`, `other`.

Naming convention per project:

```
public/images/projects/<city-slug>/<project-slug>-hero.jpg
public/images/projects/<city-slug>/<project-slug>-detail-1.jpg
public/images/projects/<city-slug>/<project-slug>-detail-2.jpg
public/images/projects/<city-slug>/<project-slug>-detail-3.jpg
public/images/projects/<city-slug>/<project-slug>-before.jpg   (optional)
public/images/projects/<city-slug>/<project-slug>-after.jpg    (optional)
```

## Universal specs

| Property | Target |
| --- | --- |
| Aspect ratio (hero) | 16:9 |
| Aspect ratio (gallery thumbs) | 4:3 |
| Aspect ratio (before/after) | 4:3 (matches BeforeAfterSlider) |
| Resolution | 1600 × 900 minimum (hero), 1200 × 900 (thumbs + before/after) |
| Format | JPEG quality 84 (WebP support can be added to the components later) |
| File size budget | ≤ 220 KB hero, ≤ 150 KB gallery, ≤ 180 KB before/after |
| Color | sRGB |
| Pair-matching (before/after only) | Identical angle + similar lighting (same time of day if possible) |

## Project briefs

### 1. `audubon-park-tile-restoration` — Roofing / Orlando / 2024-09

Mediterranean Revival home in Audubon Park district, full clay tile restoration.

- `hero.jpg` — wide angle showing full elevation with restored clay tile roof, late-afternoon golden light
- `detail-1.jpg` — close-up of period-correct color match against original tile
- `detail-2.jpg` — copper flashing detail (chimney saddle or valley)
- `detail-3.jpg` — FBC §1518 SWB underlayment visible during install
- `before.jpg` — pre-restoration, weathered tile with damaged sections
- `after.jpg` — same angle, restored

### 2. `park-avenue-cedar-shake` — Roofing / Winter Park / 2024-07

Park Avenue district porch overhang, cedar shake replacement.

- `hero.jpg` — porch elevation with restored cedar shake
- `detail-1.jpg` — kiln-dried cedar shake close-up
- `detail-2.jpg` — porch context showing historic home detail
- `before.jpg` — weathered/failing cedar shake
- `after.jpg` — same angle, restored

### 3. `stoneybrook-hurricane-claim` — Roofing / Oviedo / 2022-11

Post-Hurricane Nicole shingle replacement with insurance claim documentation.

- `hero.jpg` — wide angle of completed architectural shingle install
- `detail-1.jpg` — Class 4 impact-resistant shingle close-up showing the wind-class label
- `detail-2.jpg` — drone aerial of the completed roof
- `detail-3.jpg` — claim documentation packet (mock-up — laptop with damage photos open)
- `before.jpg` — post-storm damage (lifted/missing shingles, tarping if applicable)
- `after.jpg` — same angle, completed

### 4. `live-oak-reserve-garage-conversion` — General Construction / Oviedo / 2024-05

Two-car garage converted to permitted home office.

- `hero.jpg` — finished home office interior with separate-entry door visible
- `detail-1.jpg` — exterior showing the converted entry
- `detail-2.jpg` — structural reframing in progress (mid-build)

### 5. `conway-composite-deck` — Deck & Fence / Orlando / 2024-03

Backyard composite deck with code-compliant pool fencing.

- `hero.jpg` — finished deck with pool visible, backyard context
- `detail-1.jpg` — composite board texture close-up (TimberTech AZEK)
- `detail-2.jpg` — pool fencing detail showing F.S. Chapter 515 compliance

### 6. `lake-nona-exterior-paint` — Painting & Siding / Orlando / 2024-08

Two-story exterior repaint with elastomeric coating.

- `hero.jpg` — full façade post-repaint
- `detail-1.jpg` — close-up of the elastomeric finish
- `detail-2.jpg` — trim/fascia contrast detail
- `before.jpg` — pre-repaint façade
- `after.jpg` — same angle, post-repaint

## After uploading

1. Drop files into the appropriate `public/images/projects/<city-slug>/` folder.
2. Verify the slug matches the project's `slug` field in `src/data/projects.ts` (kebab-case).
3. Reload the home page — the portfolio gallery + modal will pick up the photos automatically. The runtime onError handlers will stop firing.
4. Run `npm run build` and confirm the photos appear in production.

## Adding a new project

1. Append an entry to `PROJECTS` in `src/data/projects.ts`:
   - Generate a unique `slug` (kebab-case neighborhood-or-feature, year suffix)
   - Pick the appropriate `city` and `serviceCategory`
   - Set `completedDate` to ISO format (`YYYY-MM-DD`)
   - Write a 2-3 sentence `summary`
   - Set `featured: true` if you want the project to appear in any future featured-subset views
2. Drop the photo files per the conventions above.
3. The portfolio + modal pick up the new project automatically — no other code changes needed.

## Schema work (deferred — Tier 5+)

Once the portfolio has real content, emit `@type: CreativeWork` JSON-LD per project so the gallery surfaces in image search. See the TODO comment at the top of `src/sections/ProjectPortfolio.tsx`.
