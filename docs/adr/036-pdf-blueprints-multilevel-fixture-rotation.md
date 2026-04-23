# ADR 036 — Native PDF Blueprints, Per-Floor Backdrops, Fixture Rotation (Phase 14.E)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 14.E
- **Depends on:** Phase 2.G (backdrop system), Phase 10.B (floor store), Phase 14.D.

## Context

Phase 14.A–D made the BOM + proposal + compliance pipeline honest about dollar amounts and code obligations. But three concrete friction points remained in the "actually bid a real job from a real blueprint" workflow:

1. **PDF blueprints**. Architects ship plans as PDF. The existing backdrop system only accepted PNG/JPG, forcing the contractor to open a PDF externally, export each page to an image, then upload. On a multi-story job with floor plans on separate pages, that's five extra clicks per job.

2. **Multi-level layout**. The backdrop store pinned images to a raw Y coordinate with no association to the first-class `floorStore` concept. If the user uploaded three floors' worth of blueprints, all three rendered simultaneously on top of each other unless the user manually hid two.

3. **Fixture rotation friction**. `params.rotationDeg` existed on fixtures, but the only input paths were a numeric text field in the FixtureParamWindow and an interactive ring in the top-view editor. Both require breaking away from the pointer — slow when tracing a blueprint where every fixture might need a small rotation to align.

All three are blueprint-tracing workflow gaps.

## Decision

Ship three cleanly separable units in one phase:

### 1. PDFRenderer + lazy-loaded pdfjs-dist

New module `src/engine/pdf/PDFRenderer.ts` wrapping the `pdfjs-dist` 4.10 API:

```ts
readPdfMetadata(file)          → { numPages, pages: [{ pageNumber, widthPt, heightPt }] }
renderPdfPage(file, page, dpi) → { dataUrl, widthPx, heightPx, pageNumber, dpi }
renderFirstPage(file, dpi?)    → convenience wrapper for 1-page PDFs
isPdfFile(file)                → MIME + extension check for uploader routing
```

Registered in the lazy-loader system as `loadPdfRenderer`. Users who never import a PDF pay zero bundle cost — the ~300 KB pdfjs chunk only loads when the first PDF upload fires.

The pdfjs worker file is set up via Vite's `?url` import convention:

```ts
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
```

This emits the worker as a separately-bundled asset with a content hash for cache-busting — the worker also only loads at first render time.

### 2. Floor association on Backdrop

`Backdrop` grew two optional fields:

```ts
interface Backdrop {
  // ... existing fields …
  floorId?: string;       // 'floor_1' | 'basement' | 'slab' | ...
  source?: {              // provenance metadata (nice-to-have for UI)
    kind: 'image' | 'pdf';
    originalName: string;
    pageNumber?: number;
    totalPages?: number;
    dpi?: number;
  };
}
```

`addBackdrop` signature changed to accept an options object:

```ts
addBackdrop(name, dataUrl, pxW, pxH, { floorY?, floorId?, source? })
```

When no explicit floor is given, the new backdrop defaults to the *active* floor at upload time (read from `floorStore.activeFloorId`). A new action `assignToFloor(id, floorId)` lets the user retarget a backdrop after the fact.

Backdrops predating Phase 14.E have no `floorId`; they continue to render on every floor (safe, backward-compatible default).

### 3. Per-floor rendering filter

`BackdropLayer` reads `useFloorStore.visibilityMode` and filters backdrops by floor:

- `visibilityMode: 'all'` — every backdrop renders (legacy behavior)
- `visibilityMode: 'active_only'` — only backdrops on the active floor render
- `visibilityMode: 'ghost'` — off-floor backdrops render at ~15% opacity so the user has orientation context without them dominating

Legacy (floorId-less) backdrops always render — their semantics predate the concept.

### 4. PDF upload UX

`MeasureToolbar.onFileChange` grew a PDF branch:

```
user drops/uploads a file
  ├── image/*       → uploadBackdropFile (unchanged)
  └── application/pdf or .pdf
       ├── readPdfMetadata
       ├── 1 page  → uploadBackdropPdfPage(file, 1) directly
       └── >1 pages → open PdfPagePicker modal
                        ├── "Single page N → floor X"  → upload one
                        ├── "All pages, starting at floor X" → upload each, advancing floors
                        └── Cancel
```

The `PdfPagePicker` is a focus-trapped modal with a page selector (input + clickable chips), a target-floor dropdown, and two commit buttons. For architectural blueprint sets (floor plans on separate pages), the "all pages, one per floor" mode reads `floorStore.getFloorsOrdered()` and advances up the stack — page 1 to the selected start floor, page 2 to the next one up, and so on. Pages that run past the top floor are dropped silently (contractor can re-upload with a different start).

### 5. Fixture rotation shortcuts

New hook `useFixtureRotationShortcuts()` + binder `<FixtureRotationShortcutsBinder />`:

| Key chord | Effect |
|---|---|
| `]` | +15° |
| `[` | -15° |
| `Shift+]` | +5° (fine nudge) |
| `Shift+[` | -5° (fine nudge) |
| `Ctrl+]` | +90° (cardinal snap) |
| `Ctrl+[` | -90° (cardinal snap) |

Activation requires a selected fixture (`fixtureStore.selectedFixtureId !== null`) and non-typing focus (skip when target is an input/textarea/contenteditable). Ctrl beats Shift when both are held (OS convention: "coarser modifier wins"). Meta key releases the chord to the browser so native cmd+bracket chords (e.g. browser back/forward on macOS) aren't stolen.

Why brackets and not `R`: `R` is already taken for the measurement ruler (Phase 2.G). The CAD-editor convention of `[` / `]` for rotate/nudge is widely used (Illustrator, Figma, SketchUp) and leaves a clean right-hand-on-mouse + left-hand-on-bracket ergonomic.

### Files

```
src/engine/pdf/PDFRenderer.ts                 pdfjs-dist wrapper (17 tests)
src/engine/pdf/__tests__/PDFRenderer.spec.ts
src/ui/backdrop/PdfPagePicker.tsx              Multi-page picker modal
src/ui/fixtures/useFixtureRotationShortcuts.ts [/]/Shift/Ctrl chord handler (14 tests)
src/ui/fixtures/__tests__/useFixtureRotationShortcuts.spec.ts
docs/adr/036-pdf-blueprints-multilevel-fixture-rotation.md

src/core/lazy/loaders.ts                       (mod) loadPdfRenderer registration
src/store/backdropStore.ts                     (mod) floorId field, source metadata,
                                                      PDF uploader, assignToFloor action
src/ui/backdrop/BackdropPlane.tsx              (mod) per-floor visibility + ghost opacity
src/ui/measure/MeasureToolbar.tsx              (mod) .pdf accept, routing, picker
src/App.tsx                                    (mod) FixtureRotationShortcutsBinder mount
src/core/input/ShortcutRegistry.ts             (mod) 3 new bracket chord entries
package.json                                   (mod) +pdfjs-dist@^4.10.38
```

## Consequences

**Good:**
- Workflow collapses 5+ clicks per blueprint to one. Drop a PDF, pick a page (or auto-distribute across floors), and it's on the floor ready to trace.
- Multi-story jobs finally work: one blueprint per floor, toggled by floor visibility mode. No accidental visual stacking.
- Rotation ergonomics match CAD tools the contractor has used before. `[` / `]` to fine-tune a fixture's orientation while mouse stays on the scene.
- Zero bundle cost for users who never import PDFs: pdfjs loads on demand, worker loads on first render.
- Pure rotation math is unit-tested (14 tests including wraparound, modifier precedence, non-matching keys).
- pdfjs helper math (dpi→scale, points→feet, dpi clamping, MIME detection) is unit-tested (17 tests).

**Accepted costs:**
- pdfjs-dist at ~300 KB gz is our largest optional dependency. Justified by (a) lazy load, (b) functionality per KB, (c) industry-standard PDF renderer with active maintenance. Alternative would be a server-side render via Tauri — cross-platform install cost is higher than the 300 KB.
- PDF-rendered images can be large data URLs (1–3 MB at 200 DPI for a D-size sheet). Projects with many PDF pages embedded will bloat `.elbow` bundles. Future work: either externalize data URLs to a sidecar file, or offer a "re-render at lower DPI" action from the manage panel.
- Per-floor filtering uses `activeFloorId` only — no "show floors 1 and 2 together" multi-select. Real edge case is low (plumber works on one floor at a time), but a bitmask-based multi-active-floor mode is an obvious v2.
- "All pages, one per floor" mode assumes page order matches floor order bottom-up. If the architect's PDF is top-down (attic → basement), the contractor has to re-upload with the start-floor set differently. No auto-detection of page orientation.
- Rotation shortcut requires fixture selection. "Rotate while drag-placing a new fixture" isn't a currently supported input mode; the shortcut fires after placement. v2: live rotation during placement ghost.

**Non-consequences:**
- No changes to BOM, pricing, proposal, compliance, or any export. This phase is purely UX / input ergonomics + data-model enrichment.
- No schema bump on `.elbow` bundles. The new `floorId` + `source` fields are optional; old bundles load unchanged.
- No impact on the simulation engine, renderer performance (per-floor filter is O(n) on backdrop count, typical N < 10), or the existing measurement/scale tool.
- No conflict with ruler (R) or any other existing shortcut — bracket chords are unassigned.

## Alternatives considered

**Render PDFs server-side via a Tauri command.** Would avoid the pdfjs bundle entirely, but adds a Rust dependency + cross-platform build complexity. pdfjs-dist is battle-tested, installs via npm, and works identically in dev + prod + Tauri. Rejected for scope.

**Keep backdrops at raw Y; don't add floorId.** The user could just position each blueprint manually. Rejected because the `floorStore` already knows what elevation each floor lives at — having every user type those numbers is unnecessary friction. `floorId` is the correct level of abstraction.

**Use `R` for rotation (context-switched away from ruler when a fixture is selected).** Considered. Rejected because R has behaved as "ruler" for long enough that muscle memory matters. Adding a stealth overload would surprise anyone who's used the app before, and we can't A/B test it meaningfully. Brackets are a clean add with no prior claim.

**"Click to place at cursor" for templates + PDF drop combined mode.** Considered for this phase. Deferred — the drop-at-active-floor flow is the 80% case and both scope the MVP independently. Can be a Phase 14.F.

**Thumbnail preview in the page picker.** Rejected for MVP. Rendering every page at thumbnail DPI just to pick one adds 1–2 seconds of wait per multi-page PDF. Page-number chips + dimensions-in-the-tooltip are sufficient. Will revisit if user feedback demands it.

## Validation

- `Vitest`:
  - `src/engine/pdf/__tests__/PDFRenderer.spec.ts` — **17 tests** covering `dpiToScale` (72→1, 144→2, 200→2.778, throw on non-finite), `pointsToFeet` (72pt→1/12ft, 864pt→1ft, blueprint-sized inputs), `clampDpi` (passthrough, floor @ 72, ceiling @ 400, NaN/Infinity fallback, float rounding), `isPdfFile` (MIME + extension + image rejection).
  - `src/ui/fixtures/__tests__/useFixtureRotationShortcuts.spec.ts` — **14 tests** covering `normalizeDeg` (wraparound both directions, the `-0` gotcha on exact multiples), bare brackets ±15°, Shift ±5° (accepts both `{`/`}` and `[`/`]` key reports), Ctrl ±90°, non-matching keys + meta-held → null, Ctrl beats Shift when both held.
  - All prior test files continue to pass.
- `tsc --noEmit` — clean.
- `vite build` — clean. pdf-renderer emits as a separate lazy chunk (not in main bundle).
- Manual plan:
  - Press `B` → click **+** → pick a 3-page PDF blueprint
  - Picker opens → click "Import all 3 pages, starting at 1st Floor" → three backdrops land on 1st/2nd/3rd Floor
  - Press `[` when floor selector is active → cycles visibility mode to `active_only`; only 1st-floor blueprint remains visible (wait — `[` nudges fixtures now! — this test requires NO fixture selected, so the key falls through to whatever else handles it)
  - Select a fixture → press `]` → fixture rotates 15° CW; repeat 5× to confirm accumulation; press `Ctrl+[` → snaps -90°
  - Press `Shift+]` to fine-nudge; confirm 5° steps
  - Switch active floor → drop a pipe → verify pipe lands on the current floor's elevation
  - Export CSV → confirm BOM is unchanged (this phase doesn't touch exports)
