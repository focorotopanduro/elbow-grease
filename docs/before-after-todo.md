# Before/After Gallery — Photo TODO

The Beit home page mounts a `BeforeAfterGallery` section between About and Stats with three side-by-side image comparison sliders (`/src/components/BeforeAfterSlider.tsx`). Until real photos land, each slider gracefully falls back to a "Photo coming soon" placeholder via its onError handler.

## Universal specs

| Property | Target |
| --- | --- |
| Aspect ratio | 4:3 (matches CSS aspect-ratio) |
| Resolution | 1600 × 1200 minimum (CSS displays smaller; ships hi-DPI) |
| Format priority | JPEG quality 84 (slider doesn't currently support `<picture>` source sets — keep JPEG for now; WebP support can be added later) |
| File size budget | ≤ 220 KB per image |
| Color | sRGB |
| Pair-matching | **Critical**: each pair must be shot from the IDENTICAL angle and similar lighting. Mismatched angles defeat the whole "side by side" effect. |
| Pair-matching tip | When sourcing from past jobs, the BEFORE photo should be the homeowner's pre-job intake photo (or your day-1 site photo); the AFTER photo should be the final-walkthrough photo. The contractor shooting both with similar framing is the easiest path. |

## Folder layout

All before/after photos live under:

```
public/images/before-after/
```

Naming convention: `<slug>-before.jpg` and `<slug>-after.jpg`. Slug uses kebab-case, neighborhood-or-project first, year suffix.

## Pairs to source

### Pair 1 — `audubon-park-tile`

**Caption shown on page:** *Clay tile restoration — Audubon Park, 2024*

**Files expected:**
- `public/images/before-after/audubon-park-tile-before.jpg`
- `public/images/before-after/audubon-park-tile-after.jpg`

**What to capture:**
- Mediterranean Revival or Spanish Colonial home in the Audubon Park / Park Avenue district
- BEFORE: weathered tile roof with damaged or discolored sections visible
- AFTER: same roof post-restoration with period-correct color match
- Wide angle showing full slope or full elevation reads strongest

### Pair 2 — `lake-nona-shingle`

**Caption shown on page:** *Shingle replacement after Hurricane Nicole — Lake Nona, 2022*

**Files expected:**
- `public/images/before-after/lake-nona-shingle-before.jpg`
- `public/images/before-after/lake-nona-shingle-after.jpg`

**What to capture:**
- Newer subdivision home (Lake Nona aesthetic — modern stucco)
- BEFORE: storm-damaged shingle roof with visible lifting / missing tabs / tarping
- AFTER: same roof with completed architectural shingle replacement
- Drone aerial works very well here — shingle pattern reads cleanly from above

### Pair 3 — `conway-metal`

**Caption shown on page:** *Standing-seam metal install — Conway, 2024*

**Files expected:**
- `public/images/before-after/conway-metal-before.jpg`
- `public/images/before-after/conway-metal-after.jpg`

**What to capture:**
- Conway-area mid-century home that received a standing-seam metal upgrade
- BEFORE: existing asphalt or aged metal roof
- AFTER: completed standing-seam metal in matte finish
- Late-afternoon side light catching the panel surface reads as premium

## After uploading

1. Drop both `<slug>-before.jpg` and `<slug>-after.jpg` into `public/images/before-after/`.
2. The runtime onError handler in `BeforeAfterSlider.tsx` will automatically remove the "Photo coming soon" placeholder when both images load successfully — no code changes needed.
3. Spot-check on mobile + desktop. The slider handle should remain centered on the divider line at all positions.

## Alternative: dual-purpose with city pages

The city pages (`/orlando-roofing`, `/oviedo-roofing`, etc.) also need project photos in `public/images/projects/<city-slug>/` per `docs/orlando-photo-todo.md` and `docs/city-photo-todo.md`. Those project photos can sometimes be cropped and reused as before/after pairs here:

- A drone aerial of a damaged roof + the same drone aerial post-repair = perfect pair
- An interior water-damage close-up + the same room post-restoration = good pair for storm-damage page

When sourcing photos for one page, ask: "could a different framing of this same job work for before/after?"

## Adding more pairs

To add a 4th-6th pair: edit the `PROJECTS` array in `src/sections/BeforeAfterGallery.tsx` and add a new entry with `id`, `before`, `after`, `alt`, `caption`. The grid is `auto-fit` so the layout expands automatically.

For more than 6 pairs, consider pagination or a "View more" CTA — the slider is interactive and rendering 10+ on a single section gets heavy on mobile.
