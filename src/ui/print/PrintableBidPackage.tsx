/**
 * PrintableBidPackage — Phase 14.AA.2
 *
 * Multi-page printable deliverable. Always mounted; normally
 * hidden via `display: none`. Revealed when the body has the
 * `printing-bid` class (set + cleared by `printBidPackage()` in the
 * orchestrator).
 *
 * Pages (separated by CSS `page-break-before: always`):
 *   1. Cover        — big branded header with logo, project title,
 *                     customer + proposal #, date
 *   2. Scope summary — executive-scope + headline totals
 *   3. Itemized BOM  — line-item table with pricing
 *   4. Compliance    — pass/fail + violation table for AHJ submittal
 *   5. Terms + signatures
 *
 * No JavaScript runs during the print pipeline. CSS-only layout.
 */

import { usePrintBidPackageStore } from '@core/print/printBidPackage';
import type { BidPackageData, BidComplianceRow } from '@core/print/bidPackageData';
import type { ProposalData, ProposalLineItem } from '@core/print/proposalData';
// Phase 5 (ARCHITECTURE.md §4.8) — gate per-domain pages on
// entity presence. Cover + terms pages remain unconditional;
// Scope, LineItems, Compliance are plumbing-only content today
// and skip cleanly when the project has no plumbing entities.
import { getDomainPresence } from '@core/proposal/domainPresence';

export function PrintableBidPackage() {
  const data = usePrintBidPackageStore((s) => s.bidPackage);
  return (
    <>
      <style>{CSS_RULES}</style>
      <div className="printable-bid" aria-hidden={!data}>
        {data && <Document data={data} />}
      </div>
    </>
  );
}

// ── Document ──────────────────────────────────────────────────

function Document({ data }: { data: BidPackageData }) {
  // Phase 5 (§4.8) — Scope totals, LineItems, and Compliance
  // are plumbing-scoped pages today. Gate them on plumbing
  // presence so a roofing-only bid package prints Cover + Terms
  // without empty plumbing tables or "N/A" code-compliance
  // seals. When the roofing line-item pipeline lands, it adds
  // its own page set gated on `presence.roofing`.
  const presence = getDomainPresence();
  return (
    <article className="bid-doc">
      <CoverPage data={data} />
      {presence.plumbing && <ScopePage data={data} />}
      {presence.plumbing && <LineItemsPage proposal={data.proposal} />}
      {presence.plumbing && <CompliancePage data={data} />}
      <TermsPage proposal={data.proposal} />
    </article>
  );
}

// ── 1. Cover page ────────────────────────────────────────────

function CoverPage({ data }: { data: BidPackageData }) {
  const { cover, proposal } = data;
  const contractor = proposal.contractor;
  return (
    <section className="bid-page bid-cover">
      <div className="bid-cover-logo">
        {contractor.logoDataUrl && (
          <img src={contractor.logoDataUrl} alt="" />
        )}
      </div>
      <div className="bid-cover-title">
        <div className="bid-cover-subtitle">{cover.subtitle.toUpperCase()}</div>
        <h1>{cover.title}</h1>
        <div className="bid-cover-divider" />
        <table className="bid-cover-info">
          <tbody>
            <tr><th>Prepared for</th><td>{cover.preparedFor}</td></tr>
            <tr><th>Prepared by</th><td>{cover.preparedBy}</td></tr>
            <tr><th>Proposal #</th><td>{cover.proposalNumber}</td></tr>
            <tr><th>Date</th><td>{cover.dateDisplay}</td></tr>
          </tbody>
        </table>
      </div>
      <div className="bid-cover-footer">
        {contractor.companyName}{contractor.licenseNumber ? ` · License # ${contractor.licenseNumber}` : ''}
        {contractor.phone ? ` · ${contractor.phone}` : ''}
      </div>
    </section>
  );
}

// ── 2. Scope / executive summary ─────────────────────────────

function ScopePage({ data }: { data: BidPackageData }) {
  const { proposal } = data;
  return (
    <section className="bid-page bid-scope">
      <h2>Scope of Work</h2>
      <p className="bid-scope-body">
        {proposal.project.scopeDescription ?? 'See itemized bill of materials for full detail.'}
      </p>

      <h3>Project Totals at a Glance</h3>
      <table className="bid-kv-table">
        <tbody>
          <tr><th>Line items</th><td>{proposal.lineItems.length}</td></tr>
          <tr><th>Subtotal</th><td>{usd(proposal.totals.customerSubtotal)}</td></tr>
          {proposal.totals.customerTax > 0 && (
            <tr><th>Tax</th><td>{usd(proposal.totals.customerTax)}</td></tr>
          )}
          <tr className="bid-total-row"><th>Grand total</th><td>{usd(proposal.totals.customerTotal)}</td></tr>
        </tbody>
      </table>
    </section>
  );
}

// ── 3. Itemized BOM ──────────────────────────────────────────

function LineItemsPage({ proposal }: { proposal: ProposalData }) {
  return (
    <section className="bid-page bid-items">
      <h2>Itemized Bill of Materials</h2>
      <table className="bid-items-table">
        <thead>
          <tr>
            <th>#</th>
            <th className="bid-col-desc">Description</th>
            <th className="bid-col-qty">Qty</th>
            <th className="bid-col-unit">Unit</th>
            <th className="bid-col-price">Price</th>
          </tr>
        </thead>
        <tbody>
          {proposal.lineItems.map((it, i) => (
            <LineRow key={i} index={i + 1} item={it} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function LineRow({ index, item }: { index: number; item: ProposalLineItem }) {
  return (
    <tr>
      <td>{index}</td>
      <td>{item.description}</td>
      <td className="bid-col-qty">{item.quantity}</td>
      <td className="bid-col-unit">{item.unit}</td>
      <td className="bid-col-price">{usd(item.customerPrice)}</td>
    </tr>
  );
}

// ── 4. Compliance summary ────────────────────────────────────

function CompliancePage({ data }: { data: BidPackageData }) {
  const { compliance } = data;
  return (
    <section className="bid-page bid-compliance">
      <h2>Code Compliance Summary</h2>
      <div className={`bid-compliance-seal ${compliance.passesCode ? 'bid-pass' : 'bid-fail'}`}>
        {compliance.passesCode ? '✓ DESIGN COMPLIANT' : '⚠ REVIEW REQUIRED'}
      </div>
      <p className="bid-compliance-headline">{compliance.headline}</p>

      <table className="bid-kv-table">
        <tbody>
          <tr><th>Code-critical issues</th><td>{compliance.counts.critical}</td></tr>
          <tr><th>Warnings</th><td>{compliance.counts.warning}</td></tr>
          <tr><th>Informational</th><td>{compliance.counts.info}</td></tr>
        </tbody>
      </table>

      {compliance.violations.length > 0 && (
        <>
          <h3>Violation Detail</h3>
          <table className="bid-compliance-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Rule</th>
                <th>Code Ref</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {compliance.violations.map((v, i) => (
                <ViolationRow key={i} v={v} />
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function ViolationRow({ v }: { v: BidComplianceRow }) {
  return (
    <tr className={`bid-violation-${v.severity}`}>
      <td>{v.severity.toUpperCase()}</td>
      <td>{v.label}</td>
      <td>{v.codeRef}</td>
      <td>{v.description}</td>
    </tr>
  );
}

// ── 5. Terms + signatures ────────────────────────────────────

function TermsPage({ proposal }: { proposal: ProposalData }) {
  return (
    <section className="bid-page bid-terms">
      <h2>Terms &amp; Acceptance</h2>
      {proposal.contractor.proposalTerms && (
        <div className="bid-terms-body">
          {proposal.contractor.proposalTerms.split(/\n+/).map((para, i) => (
            <p key={i}>{para}</p>
          ))}
        </div>
      )}
      <div className="bid-sig-grid">
        <div className="bid-sig-block">
          <div className="bid-sig-line" />
          <div className="bid-sig-label">Contractor signature / date</div>
        </div>
        <div className="bid-sig-block">
          <div className="bid-sig-line" />
          <div className="bid-sig-label">Customer signature / date</div>
        </div>
      </div>
    </section>
  );
}

// ── Helpers ───────────────────────────────────────────────────

function usd(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });
}

// ── CSS ────────────────────────────────────────────────────────

const CSS_RULES = `
/* Hidden on-screen unless body.printing-bid */
body:not(.printing-bid) .printable-bid { display: none; }
body.printing-bid * { visibility: hidden; }
body.printing-bid .printable-bid,
body.printing-bid .printable-bid * { visibility: visible; }

.printable-bid {
  position: absolute;
  inset: 0;
  background: #fff;
  color: #000;
  font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif;
  z-index: 99999;
}

.bid-doc { padding: 0; margin: 0; }

.bid-page {
  page-break-after: always;
  padding: 0.75in 0.65in;
  min-height: 10in;
  box-sizing: border-box;
}

.bid-page:last-child { page-break-after: auto; }

/* ── Cover page ────────────────────────────────────── */

.bid-cover {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  min-height: 9.5in;
}
.bid-cover-logo { text-align: right; }
.bid-cover-logo img { max-width: 220px; max-height: 150px; object-fit: contain; }
.bid-cover-title { margin-top: 2in; }
.bid-cover-subtitle {
  font-size: 11pt;
  letter-spacing: 4pt;
  color: #555;
  margin-bottom: 8pt;
}
.bid-cover-title h1 {
  font-size: 36pt;
  font-weight: 300;
  margin: 0 0 12pt 0;
  line-height: 1.1;
}
.bid-cover-divider {
  border-top: 3pt solid #000;
  width: 80pt;
  margin: 16pt 0 24pt 0;
}
.bid-cover-info { border-collapse: collapse; font-size: 11pt; }
.bid-cover-info th {
  text-align: left;
  padding-right: 20pt;
  color: #666;
  font-weight: 500;
  font-size: 9pt;
  letter-spacing: 1pt;
  text-transform: uppercase;
  padding-bottom: 6pt;
}
.bid-cover-info td { padding-bottom: 6pt; }
.bid-cover-footer {
  font-size: 9pt;
  color: #666;
  border-top: 1pt solid #ccc;
  padding-top: 12pt;
}

/* ── Content pages ───────────────────────────────── */

.bid-page h2 {
  font-size: 18pt;
  font-weight: 600;
  margin: 0 0 16pt 0;
  border-bottom: 2pt solid #000;
  padding-bottom: 4pt;
}
.bid-page h3 {
  font-size: 12pt;
  font-weight: 600;
  margin: 18pt 0 8pt 0;
  color: #333;
}

.bid-kv-table { border-collapse: collapse; font-size: 11pt; min-width: 40%; margin: 8pt 0; }
.bid-kv-table th {
  text-align: left;
  padding: 3pt 20pt 3pt 0;
  font-weight: 500;
  color: #444;
}
.bid-kv-table td { padding: 3pt 0; text-align: right; }
.bid-total-row th, .bid-total-row td {
  border-top: 1.5pt solid #000;
  padding-top: 6pt !important;
  font-weight: 700;
}

.bid-scope-body {
  font-size: 11pt;
  line-height: 1.6;
  color: #222;
}

.bid-items-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10pt;
}
.bid-items-table thead { border-bottom: 1.5pt solid #000; }
.bid-items-table th {
  text-align: left;
  padding: 6pt 4pt;
  font-size: 9pt;
  text-transform: uppercase;
  letter-spacing: 0.5pt;
}
.bid-items-table td { padding: 4pt; border-bottom: 0.5pt solid #eee; vertical-align: top; }
.bid-col-qty, .bid-col-unit { text-align: center; width: 50pt; }
.bid-col-price { text-align: right; width: 80pt; }
.bid-col-desc { width: auto; }

/* ── Compliance ────────────────────────────────────── */

.bid-compliance-seal {
  display: inline-block;
  font-size: 20pt;
  font-weight: 700;
  padding: 8pt 16pt;
  border: 3pt solid;
  letter-spacing: 2pt;
  margin: 8pt 0 12pt 0;
}
.bid-pass { color: #0a6b2a; border-color: #0a6b2a; }
.bid-fail { color: #a40c0c; border-color: #a40c0c; }
.bid-compliance-headline {
  font-size: 11pt;
  color: #222;
  margin-bottom: 14pt;
}

.bid-compliance-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9.5pt;
  margin-top: 8pt;
}
.bid-compliance-table th {
  text-align: left;
  padding: 6pt 4pt;
  font-size: 9pt;
  text-transform: uppercase;
  border-bottom: 1.5pt solid #000;
}
.bid-compliance-table td { padding: 4pt; border-bottom: 0.5pt solid #eee; vertical-align: top; }
.bid-violation-critical td:first-child { color: #a40c0c; font-weight: 700; }
.bid-violation-warning  td:first-child { color: #b8860b; font-weight: 700; }
.bid-violation-info     td:first-child { color: #555; }

/* ── Terms + signatures ───────────────────────────── */

.bid-terms-body { font-size: 10pt; line-height: 1.5; }
.bid-terms-body p { margin: 8pt 0; }
.bid-sig-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 40pt;
  margin-top: 40pt;
}
.bid-sig-line { border-bottom: 1pt solid #000; height: 30pt; }
.bid-sig-label { font-size: 9pt; color: #555; margin-top: 4pt; }

/* Printer rules */
@media print {
  @page { size: letter; margin: 0.5in; }
  body.printing-bid .printable-bid { position: static; }
}
`;
