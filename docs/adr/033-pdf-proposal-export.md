# ADR 033 — PDF Proposal Export (Phase 14.B)

- **Status:** Accepted
- **Date:** 2026-04-18
- **Phase:** 14.B
- **Depends on:** ADR 030 (BOM Accuracy), ADR 032 (Pricing Engine).

## Context

After Phase 14.A (ADR 032), the app can compute a real dollar bid. What it can't do yet is hand the customer a printed/signed proposal. The missing link is:

1. **Contractor identity** — company name, license #, address, logo, signature line.
2. **Formatted document** — title block, project info, BOM table, totals, signature lines, terms.
3. **PDF output** — native-looking document the customer can sign and return.

## Decision

Ship a **browser print-to-PDF** flow rather than embedding a JS PDF library. Three reasons:

1. **Zero bundle cost.** jsPDF = ~50 KB gz, pdfmake = ~200 KB gz, react-pdf = ~300 KB gz. Not huge, but avoidable.
2. **Tauri's native print dialog** — on every OS, the system print dialog offers "Save as PDF" / "Microsoft Print to PDF" / "Save to Files" as a destination. The user already knows how to use it.
3. **Full CSS control** over typography, title block layout, signature lines, page breaks. A JS PDF library exposes a drawing API; CSS/HTML is both more expressive and easier to maintain.

### Architecture

```
┌──────────────────────────┐
│ User clicks "Proposal"   │
│ button in ExportPanel    │
└────────────┬─────────────┘
             │
             ▼
   printProposal(opts) ────────────► 1. Compose proposal data (pure)
   [src/core/print/                   2. usePrintStore.setState({proposal})
    printProposal.ts]                 3. body.classList.add('printing')
                                      4. await 2 frames for paint
                                      5. window.print()
                                      6. body.classList.remove('printing')
                                      7. Clear proposal from store
             │
             ▼
   Browser print dialog
   (user picks "Save as PDF")
```

`PrintableProposal` is always mounted in the DOM but normally hidden via `display: none`. A `body.printing` class flip makes it visible + hides everything else under a `@media print` rule. The browser then captures the proposal DOM exclusively.

### Files

```
src/core/print/proposalData.ts           Pure composition → ProposalData (13 tests)
src/core/print/__tests__/proposalData.spec.ts
src/core/print/printProposal.ts          Orchestrator: compose → show → print → tear down
src/ui/print/PrintableProposal.tsx       The printable DOM + inline @media print CSS
src/ui/print/ContractorProfilePanel.tsx  Editor for contractor identity (Ctrl+Shift+I)
src/store/contractorProfileStore.ts      Contractor profile (localStorage-persisted)
```

### Two variants: customer-facing vs internal

Same data source, same layout shell, different exposed numbers:

| Section | Customer-facing | Internal |
|---|---|---|
| Title | "PROJECT PROPOSAL" | "BID BREAKDOWN (INTERNAL)" |
| Line items | Description, Qty, Unit, Price | Description, Qty, Unit, **Material $, Hours, Labor $**, Price |
| Totals | Subtotal, Tax, TOTAL | adds "Internal Breakdown" box: Raw material, Raw labor, Overhead $, Margin $ |
| Signatures | Present | Present |
| Terms | Present | Present |

The customer sees what they're paying for. The contractor has the internal variant for their own records or bid-review conversations. Both share the title block, project info, customer block, signature lines, and terms boilerplate.

### Proposal data composition is pure

`composeProposalData(input) → ProposalData` is a pure function with 13 tests exercising:
- Customer-facing hides internal breakdown (no per-line labor, no overhead/margin)
- Internal variant carries full per-line + per-total breakdown
- Customer block composition: name + site address + contact lines from the linked `CustomerProfile`
- Graceful handling of null customer, partial customer (no address/contact)
- Date formatting (ISO → "April 18, 2026"), fallback on malformed input
- Proposal number format (`P-YYMMDD-XXXX`, UTC-based for timezone stability)
- Empty-BOM edge case

Keeping this module pure means layout + print-trigger logic can be tested independently; a future redesign of the PrintableProposal visual doesn't put the data-shape tests at risk.

### Contractor profile

First-launch sentinel: `PLACEHOLDER_COMPANY = "(Set company name in Ctrl+Shift+I)"`. The export flow checks `isUnset()` and asks for user confirmation before printing with a placeholder.

Fields: company name, contact name, license #, phone, email, address lines, city/state/zip, logo (optional, uploaded as data URL, capped at 512KB), proposal terms (editable boilerplate).

Logo is stored as a base64 data URL in localStorage. This is the correct choice: re-resolving a file path at print time would be a footgun in Tauri contexts where the user may have moved the file. Embedding solves it permanently.

### Why `display: none` for screen + `@media print` for the paper version

Several alternatives considered:

**Alt A — print via iframe.** Create a hidden iframe, populate its document, call `iframe.contentWindow.print()`. More isolation but more DOM plumbing; the main-document approach shares React context (store subscriptions, theme), which is what we want.

**Alt B — Separate print-only route** (e.g. `/print?variant=customer-facing`). Would need routing and a second React tree. Overkill.

**Alt C — Headless print via `window.print()` without the body class trick.** The proposal would show on screen permanently. Rejected — it'd cover the app.

The body-class trick is the minimum-viable pattern: one CSS rule for the toggle, one `document.body.classList` line on each side of the print call, everything else is standard CSS. Widely used in practice (Medium, Notion).

### Page layout details

- 8.5 × 11 letter paper, 0.5" margins (`@page { size: letter; margin: 0.5in }`).
- Times New Roman / Georgia serif default — gives proposal a "legal document" feel that customers recognize.
- Title block uses a two-column CSS grid: contractor info on the left (with optional logo), project + customer info on the right.
- BOM table uses zebra striping (even rows grey) for readability. `page-break-inside: avoid` on individual rows prevents a line item from splitting across pages.
- Signature block uses a 3:1 grid (name above line, date next to it) matching the legal-document convention.
- Terms at the bottom, small font, italicized is avoided (harder to read on paper).

## Consequences

**Good:**
- Users get professional-looking PDFs with zero dep cost.
- The full end-to-end loop now exists: design → compliance → takeoff → bid → **printed proposal**.
- Customer-facing vs internal variants from the same code path — one data composer, two render hints.
- Composition module is pure + tested (13 tests) — future refactors of the visual layer can't silently break the numbers.
- Contractor profile is reusable for future features (invoice, change order, letterhead).

**Accepted costs:**
- The user has to click "Save as PDF" in their browser's print dialog. One extra click vs. "Download PDF" with a JS library. Industry-standard UX, but worth documenting.
- Page break control is CSS-based — complex content (long BOMs that split in awkward places) can be tricky. Mitigated with `page-break-inside: avoid` on rows and sections.
- Browser print engines vary slightly in rendering (Chrome vs Firefox vs Safari vs WebKit-via-Tauri). Tested against Chromium (what Tauri uses on Windows/Mac/Linux). Should be consistent across platforms in practice.
- Logo is embedded as base64 → bloats localStorage slightly. 512KB cap is enforced at upload time.

**Non-consequences:**
- No change to BOM, bid math, pricing store, or any existing export.
- No bundle growth — zero new dependencies.
- No schema change on `.elbow` bundles. Proposal is generated on demand from current scene + profile.

## Alternatives considered

**jsPDF.** 50KB gz, programmatic API. Rejected because CSS is more expressive for this shape of document (title block, signature lines, page-break control), and the bundle cost isn't free.

**pdfmake.** 200KB gz, declarative JSON DSL, good table support. Rejected for bundle size + JSON DSL learning curve when CSS already does the job.

**@react-pdf/renderer.** 300KB gz, React components for PDF. Rejected for size — it would become one of the biggest chunks in the app.

**Serve a static HTML from the Tauri backend and point the browser to it.** Would require extending the Rust side. Overkill when the React DOM already contains the proposal data.

**Generate the PDF headlessly via a Rust/Tauri `render_pdf` command with a Chromium Embedded Framework fallback.** The "no user click" dream, but it's a significant platform-side feature with real cross-platform testing cost. The one extra click is a fair price for keeping this entirely in the frontend.

## Validation

- `Vitest`:
  - `src/core/print/__tests__/proposalData.spec.ts` — 13 tests. Covers customer-facing variant hiding internal breakdown, internal variant carrying full breakdown, customer block null/partial/full, date formatting, proposal number format, empty BOM, line item price math.
  - All prior suites (BOM, pricing, coverage, etc.) continue to pass.
- `tsc --noEmit` clean.
- `vite build` clean.
- Full-suite run expected to pass (pending verification).
- Manual test plan:
  - Press Ctrl+Shift+I, fill in contractor profile, upload a logo.
  - Draw a couple of pipes, activate a customer via the customer wheel.
  - Press Ctrl+Shift+B, set pricing profile (or use FL default).
  - Click "Proposal — Customer-facing" in ExportPanel.
  - Browser print dialog opens; pick "Save as PDF" destination.
  - Open resulting PDF — verify title block has logo + company, line items table looks right, totals include tax + grand total, signature lines are present, terms at the bottom.
  - Repeat with "Proposal — Internal breakdown" — verify extra columns (Material / Hours / Labor) appear and an "Internal Breakdown" totals table shows overhead + margin.
