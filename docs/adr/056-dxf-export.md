# ADR 056 — DXF Export (Phase 14.AA.1)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AA.1
- **Depends on:** ADR 015 (lazy exporters), existing ExportPanel.

## Context

Contractor hand-off reality: ~80% of general contractors still
run AutoCAD / Revit / BricsCAD as their shop standard. IFC is
the "future" BIM format but DXF is what the GC wants in their
inbox *today*. Shipping the plumbing design as a plan-view DXF
eliminates an entire class of "convert this to a CAD format I
can open" back-and-forth.

## Decision

Ship a lazy-loaded DXF exporter wired into the existing
ExportPanel, following the same chunk-split pattern as IFC
(ADR 015).

### `src/engine/export/DXFExporter.ts` — pure exporter

```ts
exportToDXF(
  scene: { pipes, fixtures, walls?, fittings? },
  options?: {
    projection?: 'plan' | 'elevation_x' | 'elevation_z',
    projectName?: string,
    includeWalls?: boolean,
    includeFittings?: boolean,
    includeLabels?: boolean,
  },
) → { content, entityCount, sizeBytes, layersUsed }
```

**Format:** AutoCAD DXF ASCII, `$ACADVER = AC1027` (AutoCAD 2013+).
Universally readable by every modern CAD consumer (Revit,
ArchiCAD, BricsCAD, Draftsight, LibreCAD, FreeCAD). Units set
to decimal feet (`$INSUNITS = 2`).

**Projection:** default plan view drops Y → 2D (X, Z). Elevation
variants keep Y and drop one horizontal axis — useful for
riser-stack section drawings. Callers pick per export.

**Layers:** AIA CAD Layer Guideline names so imports land in the
right buckets automatically in a well-organized AutoCAD project:

| Source | AIA Layer | AutoCAD color |
|---|---|---|
| `waste` pipes | `P-DRAN-WAST` | 1 (red) |
| `vent` pipes | `P-VENT` | 2 (yellow) |
| `storm` pipes | `P-DRAN-STRM` | 6 (magenta) |
| `cold_supply` pipes | `P-DOMC` | 5 (blue) |
| `hot_supply` pipes | `P-DOMH` | 1 (red) |
| fixtures | `P-FIXT` | 3 (green) |
| fittings | `P-FIXT-SYMB` | 4 (cyan) |
| walls | `A-WALL` | 8 (dark gray) |
| labels | `P-NOTE` | 7 (black/white) |

Only layers containing entities are written to the LAYER table —
an all-supply-no-drainage scene won't emit P-DRAN-WAST at all.

**Entity mapping:**

| Source | DXF entity |
|---|---|
| Pipe polyline | `LWPOLYLINE` (one per pipe, N-vertex) |
| Fixture footprint | `CIRCLE` (0.5 ft radius) + `TEXT` label |
| Fitting | `CIRCLE` sized by pipe OD × 1.2 |
| Wall segment | `LINE` (one per wall edge pair) |
| Labels | `TEXT` (diameter + material abbrev + fixture subtype) |

### UI integration

- **ExportPanel button** — fourth button alongside BIM IFC / CSV /
  BOM JSON. Same hover-prewarm pattern as IFC: 500 ms hover loads
  the chunk so the click feels instant.
- **Lazy chunk** `dxf-exporter.js` — split out via the existing
  `makeLazyLoader` infrastructure. Module is ~250 LOC so the
  chunk is tiny (~4 KB gzipped).
- **Download filename**: `plumbing-plan.dxf` with MIME type
  `application/dxf`.

### Why not 3D DXF

3D DXF (using 3DFACE, 3DSOLID, etc.) is technically possible but
not what the consumer expects. The overwhelming majority of DXF
consumers import plan drawings as 2D drafting references on top
of which they build their own 3D model. Shipping 3D would be a
"wrong answer" to the contractor's actual need. Plan is the
default; elevation sections are the escape hatch.

## Trade-offs

- **No blocks / block references.** Every entity is inline
  geometry. Blocks would be more compact for repeated fixture
  symbols but require a BLOCKS section + block-definition table
  that AutoCAD is picky about. Inline works + scales to ~1000
  fixtures without complaint.
- **No dimension primitives.** The rewrite's existing
  `DimensionHelpers` produces floating 3D text, not real DXF
  DIMENSION entities. Emitting proper ordinate / aligned
  dimensions is a 14.AB candidate.
- **Labels as TEXT, not MTEXT.** Single-line labels stay readable
  in every DXF consumer. MTEXT adds paragraph support we don't
  need.
- **No BLOCKS for fitting symbols.** A fitting is a small circle
  sized to the pipe OD. Acceptable for plan view; future ISO-A
  symbol blocks (proper tee, wye, bend detailing) belong to a
  symbol-library pass.

## Verification

- `npx vitest run` — 1251 tests pass (1233 prior + 18 new in
  `DXFExporter.spec.ts`).
- `npx tsc -b --noEmit` — clean.
- Manual in the desktop app:
  1. Draw some pipes + place a few fixtures.
  2. Export panel → **DXF → AutoCAD DXF** button → download starts.
  3. Open the `.dxf` in LibreCAD / AutoCAD / BricsCAD — every pipe
     on its AIA-correct layer, fixture circles on P-FIXT, labels
     readable.

## Files

- `src/engine/export/DXFExporter.ts` — pure module, 330 LOC.
- `src/engine/export/__tests__/DXFExporter.spec.ts` — 18 tests.
- `src/core/lazy/loaders.ts` — `loadDxfExporter` entry.
- `src/ui/ExportPanel.tsx` — DXF button + `handleExportDXF` handler
  + hover-prewarm wiring.
- `docs/adr/056-dxf-export.md` — this document.

## What's left from the audit

- **14.AA.2 — Branded bid package PDF** (company logo + cover +
  itemized BOM + compliance summary)
- **14.AA.3 — Condensate discharge rule R-014**
