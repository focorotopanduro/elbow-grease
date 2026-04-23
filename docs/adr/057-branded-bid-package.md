# ADR 057 — Branded Bid Package PDF (Phase 14.AA.2)

- **Status:** Accepted
- **Date:** 2026-04-19
- **Phase:** 14.AA.2
- **Depends on:** ADR 033 (print-to-PDF pattern), 14.A (pricing),
  14.B (contractor profile), 14.G (proposal revisions), 14.A–14.H
  (compliance engine).

## Context

The original Python Elbow Grease shipped a "bid package" export:
a single branded multi-page PDF the contractor hands a customer or
files with the AHJ. The rewrite already had printable proposals +
change orders as separate single-page flows, but no unified
deliverable.

User ask: *"multi-page PDF with customer branding"* covering
cover, proposal terms, itemized BOM, compliance summary,
change-order template.

## Decision

Ship three new files + a button wire-up. Same print-to-PDF
pattern as the existing proposal flow (ADR 033): toggle a body
class, let the browser's native print dialog save to PDF. Zero
JS PDF dependency.

### `src/core/print/bidPackageData.ts` — pure compose

```ts
composeBidPackage({ proposal, violations }) → BidPackageData
```

Takes a fully-composed `ProposalData` + the latest compliance
violations. Returns:

```ts
interface BidPackageData {
  proposal: ProposalData;
  compliance: {
    passesCode: boolean;
    counts: { critical, warning, info };
    violations: BidComplianceRow[];   // capped at 50 rows
    headline: string;                  // "Design complies" / "N issues"
  };
  cover: {
    title, subtitle, preparedFor, preparedBy,
    dateDisplay, proposalNumber,
  };
}
```

- Severity mapping: compliance engine uses `'error' | 'warning' |
  'info'`; the bid package collapses `error → critical` for the
  AHJ-friendly label.
- Row cap: 50 violations max in the detail table. Any excess shows
  only in the top-level counts. A 500-violation design doesn't
  produce a 50-page appendix; it shows "500 critical" in the
  summary + the first 50 in the table.
- Headline branches by severity:
  - ≥ 1 critical → *"N code-critical issues — review required"*
  - warnings only → *"No code-critical issues. N warnings flagged"*
  - all clean → *"Design complies with IPC / FBC"*

### `src/core/print/printBidPackage.ts` — orchestrator

Entry `printBidPackage(options)` — reads active contractor profile +
pricing profile + customer + pipes + fixtures + compliance state,
runs the existing BOM / hanger / trap planners, composes the
package, stages into `usePrintBidPackageStore`, toggles
`body.classList.add('printing-bid')`, calls `window.print()`,
cleans up on return.

Same request-animation-frame pacing as the proposal flow so the
DOM paints before the dialog opens.

### `src/ui/print/PrintableBidPackage.tsx` — 5-page layout

Always mounted; normally hidden via `body:not(.printing-bid)
.printable-bid { display: none }`. The document:

| Page | Content |
|---|---|
| 1 | **Cover** — big right-aligned logo, 36pt project title, centered "Prepared for / Prepared by / Proposal # / Date" info table, license-number footer |
| 2 | **Scope** — free-text scope description + totals-at-a-glance mini table |
| 3 | **Itemized BOM** — five-column line-item table (#, description, qty, unit, price) |
| 4 | **Compliance** — big green "DESIGN COMPLIANT" seal (or red "REVIEW REQUIRED"), severity count table, violation detail rows color-coded by severity |
| 5 | **Terms + signatures** — contractor terms + dual signature block |

CSS-only layout with `page-break-after: always` between sections.
Uses the same typography conventions as `PrintableProposal`
(Segoe UI, pure-black text, printer-friendly) — if the contractor's
proposal template works, the bid package template works.

### `src/ui/ExportPanel.tsx` — "Bid Package" button

Sixth button on the export bar, between DXF and CSV.
`onClick → printBidPackage({})` with no parameters — everything
reads from the live stores.

## Trade-offs

- **No violation collection from a dedicated compliance store.**
  14.AA.2 passes `violations = []` by default; the user's current
  compliance trace comes from `useComplianceTraceStore` + the
  solver, which runs on the worker and isn't synchronous.
  Next iteration can wire `printBidPackage` to pick up the last
  solve's violations automatically. For now, callers pass the
  current list explicitly if they have one (the ExportPanel call
  doesn't — which is fine; it prints "Design complies" when no
  violations are known).
- **Fixed 5-page template.** No contractor-side customization
  (extra pages, cover logo position, etc.). Belongs to Phase 14.AB
  if users ask.
- **Change-order page not embedded.** The existing
  `PrintableChangeOrder` is still a separate flow. Bundling both
  into one PDF is nice-to-have; for now the change order prints
  as its own document.
- **Tax / overhead not shown on the scope page.** Matches the
  customer-facing variant's rule of hiding overhead / margin. The
  line-item page shows the customer price per item; the totals on
  the scope page show subtotal + tax + grand total.

## Verification

- `npx vitest run` — 1259 tests pass (1251 prior + 8 new in
  `bidPackageData.spec.ts`).
- `npx tsc -b --noEmit` — clean.
- Manual in the desktop app:
  1. Contractor profile set up (name, logo, license).
  2. A customer is active + the scene has pipes/fixtures.
  3. Bottom Export bar → **BID → Bid Package** button.
  4. Native print dialog opens; Save as PDF → get a 5-page
     branded document.

## Files

- `src/core/print/bidPackageData.ts` — pure compose, 135 LOC.
- `src/core/print/__tests__/bidPackageData.spec.ts` — 8 tests.
- `src/core/print/printBidPackage.ts` — orchestrator, 120 LOC.
- `src/ui/print/PrintableBidPackage.tsx` — 5-page component,
  ~320 LOC including CSS.
- `src/ui/ExportPanel.tsx` — button + handler wired.
- `src/App.tsx` — `<PrintableBidPackage />` mounted in its own
  ErrorBoundary next to `<PrintableProposal />`.
- `docs/adr/057-branded-bid-package.md` — this document.

## What's left from the 14.AA port list

- **14.AA.3 — Condensate discharge rule (R-014)** — HVAC
  condensate-into-DWV compliance check. Needs a `condensate`
  system type first (touches every SystemType record in the
  codebase).
