# Storm Replay Cinematic — Blender Asset Spec

A 15-frame photorealistic flipbook that overlays the SVG simulator
during storm replay. Drop the rendered WebP files into
`/public/cinematic/` matching the names below — the cinematic activates
automatically. If any file is missing, the SVG-only experience plays as
a graceful fallback.

## Files expected

```
public/cinematic/
  storm-01.webp   ← calm before storm
  storm-02.webp
  storm-03.webp   ← wind rising, palms start bending
  storm-04.webp
  storm-05.webp   ← heavy wind, debris in air
  storm-06.webp
  storm-07.webp   ← first shingles lifting (pressure peak at corners)
  storm-08.webp
  storm-09.webp   ← shingle field stripping away
  storm-10.webp
  storm-11.webp   ← underlayment exposed, fluttering
  storm-12.webp   ← sheathing tearing free
  storm-13.webp   ← panels flying off the deck
  storm-14.webp
  storm-15.webp   ← aftermath — bare deck, structure exposed
```

To change the frame count, edit `FRAME_COUNT` in `frames.ts` and ship
matching files. Do NOT change the file naming pattern (zero-padded
`storm-NN.webp` starting at 01) without also updating `frames.ts`.

## Render specifications

| Property | Value | Why |
|---|---|---|
| Resolution | **1600 × 960 px** | 2× the SVG viewBox (800×480), retina crisp |
| Format | **WebP** | Best compression for natural images. Quality ~80. |
| Total payload | **≤ 300 KB combined** | Mobile budget. ~20 KB/frame averaged. |
| Color space | sRGB | Matches browser default |
| Aspect | 5:3 (matches viz container) | No letterboxing |
| Camera | Front-elevated, ~5–10° down-angle | Matches the perceived camera in the front view |
| Subject | Generic Florida ranch (1-story, gable roof, attached garage) | Matches the simulated geometry |
| Lighting | Stormy daytime; key from upper-left | Matches the SVG sun position |
| Background | Full-frame; sky should be visible | Replaces the SVG entirely during play |

## Animation timing (target)

The component crossfades between consecutive frames as
`replay.progress` advances from 0 → 1. With 15 frames, each frame holds
for ~1/14 of the total replay duration (~7s default → ~0.5s/frame). The
final frame stays for an extra **1.5s** before fade-out so the
"aftermath" lands.

Keep critical events visually anchored to these progress points:

| Frame | Progress | What's happening |
|---|---|---|
| 01 | 0.00 | Calm pre-storm |
| 04 | 0.21 | Wind ramping, palms moving |
| 07 | 0.43 | First shingle uplift |
| 09 | 0.57 | Field shingles failing |
| 11 | 0.71 | Underlayment fluttering |
| 12 | 0.79 | Sheathing tearing |
| 13 | 0.86 | Flying debris |
| 15 | 1.00 | Bare deck (aftermath) |

These should roughly align with the cascade thresholds in
`physics/cascade.ts` — but EXACT alignment is not required; the SVG
cascade fires independently underneath. The cinematic is the
cinematic; the cascade is the truth.

## Building the scene in Blender

1. Model a generic 1-story Florida ranch:
   - 36'6" × ~30' footprint
   - 7/12 gable roof
   - Attached garage on the left
   - Stucco walls, asphalt shingles, hurricane shutters (optional)
2. Animate over 90 frames (3s @ 30fps), then sample 15 keyframes.
3. Use a particle system + force fields for debris (palm fronds, shingles).
4. Use `Bloom` + light volumetrics for the storm atmosphere.
5. Render with Cycles or Eevee (Eevee is faster and fine for stylised photoreal).

## Rendering / export pipeline

```bash
# After Blender output, batch-convert PNG → WebP (quality 80)
for f in storm-*.png; do
  cwebp -q 80 "$f" -o "${f%.png}.webp"
done

# Confirm total payload is under budget
du -sh storm-*.webp | tail -1
```

## QA checklist before shipping

- [ ] All 15 files present in `public/cinematic/`
- [ ] Total payload ≤ 300 KB
- [ ] Each frame is exactly 1600×960
- [ ] Calm-to-aftermath sequence reads coherently
- [ ] Open `/hurricane-uplift.html`, click ▶ Play hurricane → cinematic plays
- [ ] Test on slow 3G: graceful fallback to SVG when frames don't preload in time
