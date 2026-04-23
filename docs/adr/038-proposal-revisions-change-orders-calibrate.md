# ADR 038 — Proposal Revisions, Change Orders, and Full Calibrate (Phase 14.G)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 14.G
- **Depends on:** Phase 14.A (Pricing Engine), Phase 14.B (PDF Proposal), Phase 14.E (native PDF backdrops).

## Context

Two real-world friction points remained after Phase 14.F:

1. **Change-order friction is the #1 contractor-customer sore spot.** Once a proposal is signed, every edit the customer requests ("add a tub, move the laundry") requires either (a) reprinting the whole proposal and losing the reference to what was signed, or (b) writing a change order by hand from scratch. Phase 14.B generated a fresh proposal number on every print with no link back to the previous one — no way to answer "what was in R1 vs. what you're quoting now?"

2. **"Calibrate" was just scale.** The scale tool set world-feet-per-pixel, but did nothing about orientation ("which way is north on this blueprint?") or origin ("where on the blueprint is world 0,0,0?"). Users tracing a real-world floor plan had to live with whatever rotation and position the PDF render happened to have.

Both block the polished "bid, revise, re-sign, bid again" loop the app aspires to.

## Decision

Ship two coordinated feature sets:

### Part 1 — Proposal revisions + change orders

#### `proposalRevision.ts` — pure revision math

```ts
nextRevisionNumber(existing) → { revisionNumber, revisionIndex }
parseRevisionIndex('R3')     → 3
buildSnapshot(data, base, rev, idx, opts?) → SavedRevision
lineItemIdentity(item)       → { key, label }   // stable match key
diffProposals(before, after) → ProposalDiff     // added / removed / qty / price
summarizeChangeOrder(diff)   → string[]          // English bullets
```

Every function is React-free, Zustand-free, JSON-in / JSON-out. **30 tests** cover revision numbering (contiguous, sparse gaps), snapshot shape, identity derivation (partHint preferred, fallback composite), every diff kind (added/removed/qty/price), totals deltas (customer + internal), metadata flags (scope/customer/contractor), summary counts + nets, English formatting.

**Line-item identity uses `partHint` when present**, falling back to `category|material|size|description` for synthetic items (primer, cement, user-added rows). I extended `ProposalLineItem` with four new optional metadata fields (`partHint`, `category`, `material`, `size`) so diffing has stable keys without breaking the existing render layout.

#### `proposalRevisionStore.ts` — persisted revision library

Zustand store with one entry per base proposal number:

```
byBase: Record<baseNumber, SavedRevision[]>
```

Each list is sorted by `revisionIndex`, appended on save. Persisted to localStorage under `elbow-grease-proposal-revisions`, version-tagged so future schema bumps can drop stale data.

Actions:
- `saveRevision(base, data, opts?)` — auto-derives next R-label, appends.
- `deleteRevision(base, rev)` — explicit cleanup.
- `getRevisions(base)`, `getBaseNumbers()`, `getById()`, `clearAll()`.

#### Auto-save on every proposal print

`printProposal` now:
1. Accepts a new `revisionOfBaseNumber?` option. When set, the printed proposal number becomes `P-260418-ABCD · R2`; when omitted, a fresh base number is generated and saved as R1.
2. After `window.print()` returns (success OR cancel), saves the ProposalData to the revision store. "Save always" rather than "save on successful print" is intentional — a contractor who cancels the print dialog still made the design choices, and those are worth capturing for audit.
3. Accepts an optional `revisionNote` (free-text describing what changed).

The ExportPanel detects the most-recently-saved base number and offers a `Start new` checkbox. Unchecked (default) → next print is R{n+1} of the active base. Checked → next print is R1 of a fresh base. Keeps the happy-path (one project, many revisions) one click; starting a new project also one click.

#### `printChangeOrder` + `PrintableChangeOrder`

Separate print path, distinct layout:

```
┌────────────────────────────────────────────────┐
│  [logo]  Beit Building LLC      CHANGE ORDER   │
│                                 P-260418-ABCD  │
│                                 R1 → R2         │
├────────────────────────────────────────────────┤
│  References: (R1 on Apr 18 $2,780 — "original")│
│              (R2 on Apr 19 $3,420 — "add tub") │
├────────────────────────────────────────────────┤
│  Prepared For: Jones Residence  …              │
├────────────────────────────────────────────────┤
│  Summary of Changes                            │
│    • Added 1× bathtub (+$450)                  │
│    • Removed 1× shower (−$310)                 │
│    • Net change: bid +$640, mat +$140, …       │
├────────────────────────────────────────────────┤
│  Detailed Changes  (table with deltas)         │
├────────────────────────────────────────────────┤
│  Net Total Impact                              │
│    Subtotal change  +$620                      │
│    Tax change        +$20                      │
│    TOTAL BID CHANGE +$640                      │
├────────────────────────────────────────────────┤
│  [___________________]    [_____]              │
│  Customer signature        Date                 │
│  [___________________]    [_____]              │
│  Beit Building (contractor) Date                │
└────────────────────────────────────────────────┘
```

Same print mechanism as PrintableProposal: always mounted, `body.printing` class flips visibility, subscribes to `usePrintStore.changeOrder`. A warm title accent (`#8a2e00`) distinguishes CO from the standard proposal's neutral black.

#### `RevisionComparePanel` — Ctrl+Shift+V

Browser + diff preview + print trigger:
1. Dropdown of every base number with saved revisions (newest-first).
2. List of that proposal's revisions, each row showing `R{n}`, saved-at date, total, optional note, and From/To/Delete buttons.
3. Inline diff preview (colored: green `+N added`, red `−M removed`, yellow `±K changed` + net bid delta).
4. "Print Change Order →" button at the footer fires `printChangeOrder({ from, to })`.

Auto-swaps From/To if the user picks them in reverse chronological order (R3 → R1 becomes R1 → R3) — a change order only makes sense earlier → later.

### Part 2 — Full calibrate (scale + level + origin)

The `Scale` tool was already present. Phase 14.G adds **Level** and **Origin**, grouped under a shared `CALIBRATE` label with an explanatory hover tooltip.

```
Scale   — click two points, type the real distance.
          Result: world feet per pixel is set; grid + labels scale.

Level   — click two points along a known-horizontal line
          (e.g. a wall that should run east-west).
          Result: every active-floor backdrop rotates around the
          clicked segment's midpoint so that line becomes horizontal.

Origin  — click the blueprint point that should be world (0, 0, 0)
          (typically a building corner or a bathroom-zero reference).
          Result: every active-floor backdrop translates so that
          clicked world point sits at origin.
```

Two new measure modes (`calibrate_level`, `calibrate_origin`) and two new backdrop actions (`rotateActiveFloorBackdropsToLevel`, `shiftActiveFloorBackdropsOrigin`) that apply the math to every backdrop on the currently active floor. The `RulerCatcher` plane in the scene handles clicks for all three modes (one-click for origin, two-click for the others).

**Design note:** level and origin move only the *backdrop(s)*, not the pipes or fixtures. The contractor's mental model is "align the blueprint to the world I've been drawing in" — so the blueprint should move, not the drawing. A floor plan that's calibrated *before* drawing starts is the normal case; calibrating after some drawing will (correctly) leave the drawing in place and shift the blueprint around it.

### Files

```
src/core/print/proposalRevision.ts                Pure revision + diff math (30 tests)
src/core/print/__tests__/proposalRevision.spec.ts
src/core/print/printChangeOrder.ts                Print orchestrator for change orders
src/ui/print/PrintableChangeOrder.tsx             Print layout (DOM + @media print CSS)
src/ui/print/RevisionComparePanel.tsx             Ctrl+Shift+V browser + diff + print
src/store/proposalRevisionStore.ts                Persisted library
docs/adr/038-proposal-revisions-change-orders-calibrate.md

src/core/print/proposalData.ts           (mod) +partHint/category/material/size on lines
src/core/print/printProposal.ts          (mod) +revisionOfBaseNumber + auto-save snapshot
src/ui/ExportPanel.tsx                   (mod) +revision-aware print labels + Start New
src/store/measureStore.ts                (mod) +calibrate_level / calibrate_origin modes
src/store/backdropStore.ts               (mod) +rotate/shift active-floor backdrops
src/ui/measure/RulerTool.tsx             (mod) +level/origin modes in click handler
src/ui/measure/MeasureToolbar.tsx        (mod) +CALIBRATE group with Level + Origin chips
src/App.tsx                              (mod) mount PrintableChangeOrder + RevisionComparePanel
src/core/input/ShortcutRegistry.ts       (mod) Ctrl+Shift+V registered
```

## Consequences

**Good:**
- Change-order friction dissolves. Every edit the customer requests can be quoted, diffed against the original, and signed as a distinct R{n} without losing the audit trail. The inspector-ready "here's exactly what changed between R1 and R2" PDF is one click away.
- Revision history accumulates automatically. No opt-in, no "did I remember to save?" anxiety. Every print is a snapshot.
- Calibrate now covers the full paper-to-world-frame alignment. A contractor can take a rotated PDF scan and square it up in three clicks: Scale two points, Level two more points, Origin one click.
- Pure revision math is 30-test-locked. Identity-matching + diff rules won't silently drift under future refactors.
- Change-order layout matches proposal layout so both look like they came from the same contractor — consistent header, same signature style, same terms boilerplate shape.

**Accepted costs:**
- Revision snapshots duplicate the ProposalData (~1–5 KB per snapshot depending on BOM size + logo). A contractor with 100 revisions across 20 proposals will eat ~50–500 KB of localStorage. Well below quota. v2: cap history depth per base or externalize logo data URLs.
- Revisions are local to the installation. A contractor switching machines loses history. Export-to-file / import is v2.
- "Start new" checkbox in ExportPanel is model-level state — reset on successful print. If a user cancels the print dialog after ticking "Start new," they have to re-tick it. Arguable MVP; could be sticky across cancels in v2.
- Change order only supports from < to. Reverting a proposal (R3 back to R1's scope) requires manually creating a new revision that matches R1's line-items, then printing the diff. v2: an explicit "Revert to R1" action that deep-copies the snapshot into a new revision.
- Level calibrate uses the last two click points on the active floor — doesn't verify the user's INTENT that the line is "horizontal" vs "vertical." If they click along what they think is a north-south wall, the result will be 90° off. Tooltip + label name ("Level") guide toward horizontal; v2: offer a "Align vertical" variant too.
- Origin calibrate just translates; it doesn't clamp the backdrop to a specific floor Y. If multiple floors share a blueprint stack, each floor's calibrate is independent. Expected behavior but worth noting.

**Non-consequences:**
- No changes to BOM, pricing engine, compliance planner, simulation, or scene renderer. Feature is pure downstream of the print + calibrate layers.
- No schema bump on `.elbow` bundles. `partHint/category/material/size` on `ProposalLineItem` are new but optional; old bundles load unchanged.
- No new runtime dependencies — everything uses stores + existing print infrastructure.
- Compose/instantiate for assembly templates (14.C) and the p-trap / cleanout planner (14.D) are unaffected.

## Alternatives considered

**Store revisions inside `.elbow` bundles instead of localStorage.** Would enable cross-machine history via file sharing. Rejected because (a) revisions of a *proposal* are a contractor-level concern (what did we quote?), not a project-level one (what did we design?). The bundle can be shared as the raw scene; revisions live in the contractor's library. (b) Bundle schema bump would break backward compat. Future enhancement: an optional "embedded revisions" section in the bundle.

**Diff at the raw BOM level instead of the ProposalData level.** Simpler math, but loses the customer-facing perspective (the diff wouldn't account for tax/margin). Rejected — the customer sees the proposal, not the BOM; diffing should match what they experience.

**Use a full text-diff library (e.g. jsdiff) for the change order layout.** Overkill for structured data with stable identity keys. Our `diffProposals` is 100 lines and handles the four cases (add/remove/qty/price) explicitly, which produces cleaner summaries than character-level diffs would.

**Integrate Level/Origin as a wizard-style flow** (Step 1 → Step 2 → Step 3). Rejected for MVP — each tool is independent in practice (user may recalibrate just the rotation without redoing scale/origin). Three buttons with a shared `CALIBRATE` label + explanatory tooltip is simpler and composable. Wizard is fine to add later if user feedback demands it.

**Compute rotation-to-level from auto-detected blueprint edges.** Image-processing approach (Hough transform on the PDF raster). Rejected for MVP — 300 LOC minimum, CPU-heavy, language-dependent thresholds. Two clicks is good enough and gives the user explicit control over which line defines "horizontal."

## Validation

- `Vitest`:
  - `src/core/print/__tests__/proposalRevision.spec.ts` — **30 tests**: `nextRevisionNumber` (empty / contiguous / gaps-from-delete), `parseRevisionIndex` (canonical + sloppy + malformed), `buildSnapshot` (id shape, optional note, default timestamp), `lineItemIdentity` (partHint preferred, composite fallback, label dedupe), `diffProposals` (no-op, pure add, pure remove, qty+price changes, material/labor deltas), totals (customer + internal + asymmetric), metadata flags (scope / contractor / customer), summary formatting (added/removed/changed lines, net-change footer).
  - All prior tests continue to pass (proposalData, rotation gizmo, templates, p-trap planner, PDFRenderer, fixture rotation shortcuts, BOM, pricing, etc.).
- `tsc --noEmit` — clean.
- `vite build` — clean. No new runtime dependencies.
- Manual plan:
  - Draw a 2-bath scene, print R1 customer-facing. Check ExportPanel status: "Proposal R1 printed."
  - Open Ctrl+Shift+V. R1 appears with total. No From/To enabled (need 2 revisions).
  - Add a tub to the scene. Click "Proposal R2." Prompt appears for a note ("Added tub"). Print.
  - Reopen Ctrl+Shift+V. Both R1 and R2 listed; From/To auto-selected as oldest→newest. Diff preview shows "+1 added, net bid +$640" with a green +$640 indicator.
  - Click "Print Change Order →" — browser dialog opens; CO PDF has title block, summary bullets, change table, net totals, signature lines.
  - Upload a rotated PDF blueprint (Phase 14.E). Click CALIBRATE → Scale, measure a known 10 ft wall, enter 10 ft. Click CALIBRATE → Level, click two points along what should be horizontal. Backdrop rotates. Click CALIBRATE → Origin, click a corner. Backdrop shifts so the corner is at world origin.
