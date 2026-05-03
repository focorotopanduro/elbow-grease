# Photo Pipeline — From Job Site to Live Page

The end-to-end workflow for getting Beit Building project photos onto the website. Designed so the owner can run it themselves without engineering involvement, and so each photo lands at consistent sizes and quality.

**Time per project:** ~10-15 minutes after the job completes.

---

## Step 1 — Capture (during the job)

**Source camera options:**

- **Drone** — DJI Mini 4 Pro / Mavic 3 / Air 3 are all overkill but work. Capture every roof slope at 30-50 ft altitude, then 100-150 ft altitude for context. Drone before-after pairs are gold-standard.
- **Crew phone** — modern iPhones / Pixels / Samsung Galaxy S-series produce more than enough resolution. Use the back-camera main lens (NOT ultrawide — distortion makes architectural detail look wrong).
- **Action camera** — GoPro / DJI Action work for in-progress shots (tear-off, decking install, drying-in). Less suitable for finished portfolio shots.

**Capture checklist per project:**

1. **Hero shot** (16:9 aspect ratio, late-afternoon golden hour ideal) — the one image that represents the project. Wide angle showing roof + house in context.
2. **Before-after pair** — same angle, similar lighting, both before and after. Critical: shoot the BEFORE photo on day 1 (intake walk), not after work has started.
3. **3-5 detail shots** — close-ups of materials, flashing, copper details, color matches, anything craftsmanship-distinctive.
4. **Wide context shot** — house + neighborhood / street, useful for the city-page gallery.
5. **Crew + branded vehicle** (optional but valuable for trust) — Beit logo visible, crew members in branded shirts.

**Capture conditions:**

- Avoid harsh midday sun if possible — bright noon shadows obscure detail
- Avoid wet roofs unless that's the point (storm damage, drying-in)
- Multiple angles per shot type — pick the best later
- HEIC (iPhone) / RAW (drone) is fine — the optimization pipeline handles both

---

## Step 2 — Curate

Drop everything from the job into a landing folder on Dropbox / Google Drive / iCloud:

```
Beit Photos / 2026-04-22 — Audubon Park / *.jpg, *.heic
```

Walk through the folder once and pick **the best 5-8 images**. More than 10 is overkill for a project page; quality > quantity.

Rename the picks to match the conventions:

```
hero.jpg               (the main image)
before.jpg             (before-after slider input — required if using slider)
after.jpg              (matching after image)
detail-1.jpg, detail-2.jpg, detail-3.jpg  (close-ups, in any order)
```

---

## Step 3 — Optimize via Sharp pipeline

Run the optimization script:

```bash
npm run optimize-images -- \
  --source "/path/to/Beit Photos/2026-04-22 — Audubon Park" \
  --city orlando \
  --slug audubon-park-tile-restoration
```

What the script does:

- Reads each image file in `--source`
- Auto-rotates based on EXIF
- Resizes to max 1600px wide (aspect preserved)
- Writes a JPEG fallback at quality 84 (mozjpeg, progressive)
- Writes a WebP version at quality 82 (effort 5)
- Both files land in `public/images/projects/<city>/<slug>-<filename>.{jpg,webp}`

Typical compression: 60-75% smaller than the source. A 4 MB iPhone shot becomes a ~280 KB JPEG + ~190 KB WebP — both under our per-image budget.

**Verify the output sizes:**

```bash
ls -la public/images/projects/orlando/audubon-park-tile-restoration-*
```

Expected: each pair (`.jpg` + `.webp`) under 280 KB / 190 KB respectively. Anything larger than 350 KB → re-run with lower quality (`--quality-jpg 78 --quality-webp 76`).

---

## Step 4 — Update `src/data/projects.ts`

If this is a NEW project, append a `ProjectEntry`:

```ts
{
  id: 'audubon-park-tile-2024',
  slug: 'audubon-park-tile-restoration',
  title: 'Clay tile roof restoration',
  neighborhood: 'Audubon Park',
  city: 'orlando',
  serviceCategory: 'roofing',
  completedDate: '2024-09-12',
  summary: '...',
  heroImage: '/images/projects/orlando/audubon-park-tile-restoration-hero.jpg',
  gallery: [
    '/images/projects/orlando/audubon-park-tile-restoration-detail-1.jpg',
    '/images/projects/orlando/audubon-park-tile-restoration-detail-2.jpg',
  ],
  beforeImage: '/images/projects/orlando/audubon-park-tile-restoration-before.jpg',
  afterImage: '/images/projects/orlando/audubon-park-tile-restoration-after.jpg',
  tags: ['Mediterranean Revival', 'Historic district', 'Tile'],
}
```

If this is an EXISTING project getting better photos, the runtime will pick up the new images automatically — no code change needed.

---

## Step 5 — Commit + deploy

```bash
git add public/images/projects/orlando/audubon-park-tile-restoration-* \
        src/data/projects.ts
git commit -m "Add Audubon Park tile restoration project photos"
git push
```

Vercel auto-deploys on push. New photos appear on the next page load. Service worker (Tier 6) caches them for repeat visitors.

---

## File-size budget recap

| Type | Budget |
| --- | --- |
| Hero (each) | ≤ 280 KB JPEG, ≤ 190 KB WebP |
| Gallery thumbnail (each) | ≤ 200 KB JPEG, ≤ 140 KB WebP |
| Before/after pair (each) | ≤ 250 KB JPEG, ≤ 170 KB WebP |
| Per-project total | ≤ 1.5 MB combined (5 images × ~300 KB) |

If a project page exceeds 2 MB total, run optimize-images again with lower quality flags.

---

## Troubleshooting

**The optimization script errors on HEIC.** The macOS / iOS HEIC format requires libheif. On most systems Sharp's prebuilt binaries don't include it. Workaround: convert HEIC → JPEG in Photos app first (drag photos out as JPG), then run the script on the converted folder.

**WebP looks worse than JPEG at the same quality number.** Normal — WebP and JPEG quality scales aren't equivalent. WebP at 82 ≈ JPEG at 84 visually. Don't drop WebP quality below 78 unless the file is truly massive.

**Drone photos look distorted at the edges.** Most drone cameras have visible barrel distortion. Modern editing apps (Lightroom Mobile, DJI Fly) include lens-correction profiles that fix this — apply BEFORE running optimize-images.

**Photos reordered randomly in the modal.** The `gallery` array in projects.ts preserves order. If photos appear out-of-order, check that the array ordering matches what you want.

---

## Future automation (deferred)

- **Per-project drone post-processing pipeline** — Lightroom presets + automated lens correction per drone model
- **Watermarking** — auto-add subtle Beit logo to bottom-right corner of all portfolio images
- **CDN serving** — currently all images ship from Vercel's edge; if image volume grows past ~200 photos, migrate to Cloudflare Images / Imgix for on-demand resize
- **AI-assisted curation** — auto-pick the best 5 photos from a job folder via image-quality scoring (Vision API + sharpness/composition heuristics)

None of these are necessary for current operations — manual workflow scales fine to ~50 projects/year.
