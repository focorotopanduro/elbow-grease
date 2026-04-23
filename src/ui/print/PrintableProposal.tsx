/**
 * PrintableProposal — the DOM the browser prints to PDF.
 *
 * Always mounted. Normally hidden via `display: none` (on-screen),
 * revealed only when `document.body.classList.contains('printing')`
 * — set by `printProposal()` in the print controller.
 *
 * The CSS is authored for BOTH screen (debug preview) and print:
 *   - Screen: shown as a modal-like preview when the body class is
 *     set, so a developer toggling it manually can see the layout.
 *   - Print: styled to 8.5×11 paper with professional typography.
 *
 * Components:
 *   • TitleBlock      — contractor + project + customer header
 *   • ScopeSection    — optional free-text scope description
 *   • LineItemsTable  — the BOM rows (variant-aware: customer vs internal)
 *   • TotalsSection   — subtotal, tax, grand total (+ internal breakdown)
 *   • SignatureBlock  — lines for contractor + customer signatures + date
 *   • FooterTerms     — contractor's proposal terms
 *
 * All text colors are pure black for print. Layout is CSS-only — no
 * JS runs inside the browser's print pipeline.
 */

import { usePrintStore } from '@core/print/printProposal';
import type { ProposalData, ProposalLineItem } from '@core/print/proposalData';
import { PLACEHOLDER_COMPANY } from '@store/contractorProfileStore';
// Phase 5 (ARCHITECTURE.md §4.8) — domain-presence gating so
// roofing-only jobs don't render an empty plumbing BOM table
// and plumbing-only jobs don't render a placeholder roofing
// section. Always-on sections (header, customer block, scope,
// signatures, terms) remain unconditional.
import { getDomainPresence, type DomainPresence } from '@core/proposal/domainPresence';

export function PrintableProposal() {
  const proposal = usePrintStore((s) => s.proposal);

  return (
    <>
      {/* Inject print-specific CSS once. Keeping it inline rather than
          in a separate .css so the component is self-contained. */}
      <style>{CSS_RULES}</style>

      <div className="printable-proposal" aria-hidden={!proposal}>
        {proposal && <ProposalDocument proposal={proposal} />}
      </div>
    </>
  );
}

// ── Root document ─────────────────────────────────────────────

function ProposalDocument({ proposal }: { proposal: ProposalData }) {
  // Phase 5 — gate domain-specific sections on entity presence.
  // Header / customer / scope / signatures / terms remain
  // unconditional per §4.8.
  const presence = getDomainPresence();

  return (
    <article className="proposal-doc">
      <TitleBlock proposal={proposal} />
      {proposal.project.scopeDescription && (
        <ScopeSection text={proposal.project.scopeDescription} />
      )}
      {presence.plumbing && <LineItemsTable proposal={proposal} />}
      {/*
        Phase 5 — roofing line-item rendering is feature work (see
        §4.8: "must accept line items from both engines"). When
        that lands, its section imports `presence.roofing` and
        slots in here. Until then, roofing-only jobs render header
        + customer + scope + signatures + terms — and that is the
        correct output per the presence rule: "no header, no empty
        table, no placeholder".
      */}
      {(presence.plumbing || presence.roofing) && (
        <TotalsSection proposal={proposal} presence={presence} />
      )}
      <SignatureBlock proposal={proposal} />
      {proposal.contractor.proposalTerms && (
        <FooterTerms text={proposal.contractor.proposalTerms} />
      )}
    </article>
  );
}

// ── Title block ────────────────────────────────────────────────

function TitleBlock({ proposal }: { proposal: ProposalData }) {
  const { contractor, project, customerBlock, variant } = proposal;
  const showPlaceholderWarning = contractor.companyName === PLACEHOLDER_COMPANY;

  return (
    <header className="pp-header">
      <div className="pp-header-contractor">
        {contractor.logoDataUrl && (
          <img className="pp-logo" src={contractor.logoDataUrl} alt="" />
        )}
        <div className="pp-contractor-text">
          <div className={`pp-company${showPlaceholderWarning ? ' pp-placeholder' : ''}`}>
            {contractor.companyName}
          </div>
          {contractor.contactName && <div>{contractor.contactName}</div>}
          {contractor.licenseNumber && (
            <div>License # {contractor.licenseNumber}</div>
          )}
          {contractor.addressLine1 && <div>{contractor.addressLine1}</div>}
          {contractor.addressLine2 && <div>{contractor.addressLine2}</div>}
          {contractor.cityStateZip && <div>{contractor.cityStateZip}</div>}
          {contractor.phone && <div>{contractor.phone}</div>}
          {contractor.email && <div>{contractor.email}</div>}
        </div>
      </div>

      <div className="pp-header-project">
        <div className="pp-doc-title">
          {variant === 'customer-facing' ? 'PROJECT PROPOSAL' : 'BID BREAKDOWN (INTERNAL)'}
        </div>
        <table className="pp-project-info">
          <tbody>
            <tr><th>Proposal #</th><td>{project.proposalNumber}</td></tr>
            <tr><th>Date</th><td>{project.dateDisplay}</td></tr>
            <tr><th>Project</th><td>{project.name}</td></tr>
          </tbody>
        </table>

        <div className="pp-customer-block">
          <div className="pp-section-label">Prepared For</div>
          <div className="pp-customer-name">{customerBlock.displayName}</div>
          {customerBlock.contactLines.map((l, i) => (
            <div key={`c-${i}`} className="pp-customer-line">{l}</div>
          ))}
          {customerBlock.siteAddressLines.length > 0 && (
            <div className="pp-site-address">
              <div className="pp-section-label pp-tight">Site</div>
              {customerBlock.siteAddressLines.map((l, i) => (
                <div key={`s-${i}`} className="pp-customer-line">{l}</div>
              ))}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

// ── Scope ─────────────────────────────────────────────────────

function ScopeSection({ text }: { text: string }) {
  return (
    <section className="pp-scope">
      <h2 className="pp-section-heading">Scope of Work</h2>
      <p className="pp-scope-text">{text}</p>
    </section>
  );
}

// ── Line items ────────────────────────────────────────────────

function LineItemsTable({ proposal }: { proposal: ProposalData }) {
  const isInternal = proposal.hints.showDetailedRows;

  return (
    <section className="pp-items">
      <h2 className="pp-section-heading">
        {isInternal ? 'Bill of Materials (detailed)' : 'Materials & Labor'}
      </h2>
      <table className="pp-line-items">
        <thead>
          <tr>
            <th className="pp-col-desc">Description</th>
            <th className="pp-col-qty">Qty</th>
            <th className="pp-col-unit">Unit</th>
            {isInternal && <th className="pp-col-money">Material</th>}
            {isInternal && <th className="pp-col-qty">Hrs</th>}
            {isInternal && <th className="pp-col-money">Labor</th>}
            <th className="pp-col-money">Price</th>
          </tr>
        </thead>
        <tbody>
          {proposal.lineItems.length === 0 && (
            <tr><td colSpan={isInternal ? 7 : 4} className="pp-empty">
              (No line items — scene is empty)
            </td></tr>
          )}
          {proposal.lineItems.map((item, i) => (
            <LineItemRow key={i} item={item} isInternal={isInternal} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function LineItemRow({
  item, isInternal,
}: {
  item: ProposalLineItem;
  isInternal: boolean;
}) {
  return (
    <tr>
      <td>{item.description}</td>
      <td className="pp-col-qty">{item.quantity}</td>
      <td className="pp-col-unit">{item.unit}</td>
      {isInternal && item.internalBreakdown && (
        <>
          <td className="pp-col-money">{usd(item.internalBreakdown.materialCost)}</td>
          <td className="pp-col-qty">{item.internalBreakdown.laborHours.toFixed(2)}</td>
          <td className="pp-col-money">{usd(item.internalBreakdown.laborCost)}</td>
        </>
      )}
      <td className="pp-col-money pp-price-col">{usd(item.customerPrice)}</td>
    </tr>
  );
}

// ── Totals ────────────────────────────────────────────────────
//
// Phase 5 (ARCHITECTURE.md §4.8) — receives the `DomainPresence`
// object so the grand-total row can sum ONLY the domains that
// are present. Today `ProposalData.totals` carries a single
// plumbing-derived figure; when the roofing line-item pipeline
// lands, this component will combine per-domain subtotals,
// skipping absent ones (no `$0.00` filler rows per §4.8).
// Until then the sole visible difference is that the totals
// block renders `$0.00` cleanly for a roofing-only job and
// stays hidden entirely when BOTH domains are absent.

function TotalsSection({
  proposal, presence,
}: {
  proposal: ProposalData;
  presence: DomainPresence;
}) {
  const { totals, hints } = proposal;

  // When plumbing is absent, the totals we were handed are
  // stale (derived from an empty plumbing BOM). Show zeros
  // rather than a misleading non-zero subtotal. This path
  // becomes a real sum once roofing totals flow in.
  const plumbingTotals = presence.plumbing ? totals : {
    customerSubtotal: 0,
    customerTax: 0,
    customerTotal: 0,
    internal: totals.internal,
  };

  return (
    <section className="pp-totals">
      {hints.showInternalBreakdown && plumbingTotals.internal && presence.plumbing && (
        <div className="pp-internal-breakdown">
          <h3 className="pp-section-heading">Internal Breakdown</h3>
          <table className="pp-kv-table">
            <tbody>
              <tr><th>Raw material</th><td>{usd(plumbingTotals.internal.rawMaterial)}</td></tr>
              <tr><th>Raw labor ({plumbingTotals.internal.rawLaborHours.toFixed(2)} hrs)</th>
                  <td>{usd(plumbingTotals.internal.rawLaborCost)}</td></tr>
              <tr><th>Overhead</th><td>{usd(plumbingTotals.internal.overhead)}</td></tr>
              <tr><th>Margin</th><td>{usd(plumbingTotals.internal.margin)}</td></tr>
            </tbody>
          </table>
        </div>
      )}

      <table className="pp-kv-table pp-bid-table">
        <tbody>
          <tr><th>Subtotal</th><td>{usd(plumbingTotals.customerSubtotal)}</td></tr>
          {plumbingTotals.customerTax > 0 && (
            <tr><th>Sales Tax</th><td>{usd(plumbingTotals.customerTax)}</td></tr>
          )}
          <tr className="pp-grand-total">
            <th>TOTAL</th>
            <td>{usd(plumbingTotals.customerTotal)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// ── Signatures ────────────────────────────────────────────────

function SignatureBlock({ proposal }: { proposal: ProposalData }) {
  return (
    <section className="pp-signatures">
      <div className="pp-sig-row">
        <div className="pp-sig-col">
          <div className="pp-sig-line" />
          <div className="pp-sig-label">Accepted by (Customer)</div>
        </div>
        <div className="pp-sig-col">
          <div className="pp-sig-line" />
          <div className="pp-sig-label">Date</div>
        </div>
      </div>
      <div className="pp-sig-row">
        <div className="pp-sig-col">
          <div className="pp-sig-line" />
          <div className="pp-sig-label">{proposal.contractor.companyName}</div>
        </div>
        <div className="pp-sig-col">
          <div className="pp-sig-line" />
          <div className="pp-sig-label">Date</div>
        </div>
      </div>
    </section>
  );
}

// ── Footer terms ──────────────────────────────────────────────

function FooterTerms({ text }: { text: string }) {
  return (
    <section className="pp-terms">
      <h2 className="pp-section-heading">Terms</h2>
      <p className="pp-terms-text">{text}</p>
    </section>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function usd(n: number): string {
  return `$${n.toFixed(2)}`;
}

// ── CSS ───────────────────────────────────────────────────────
//
// Two modes:
//   • Screen (debug preview) — `body.printing .printable-proposal`
//     shown as a full-viewport overlay with a light shadow so devs can
//     verify layout before sending to the printer. Hidden otherwise.
//   • Print — body.printing triggers @media print styles; the proposal
//     is the only visible thing, paginated onto 8.5×11 paper.

const CSS_RULES = `
/* ── Default: hidden from screen ─── */
.printable-proposal {
  display: none;
}

/* ── Debug preview (toggled on by setting body.printing) ─── */
body.printing .printable-proposal {
  display: block;
  position: fixed;
  inset: 0;
  overflow: auto;
  z-index: 9999;
  background: white;
  color: black;
  font-family: 'Times New Roman', Georgia, serif;
}

/* ── When printing, hide EVERYTHING except the proposal ─── */
@media print {
  body.printing > *:not(.printable-proposal) {
    display: none !important;
  }
  body.printing .printable-proposal {
    position: static !important;
    inset: auto !important;
    overflow: visible !important;
    z-index: auto !important;
    box-shadow: none !important;
    background: white !important;
    color: black !important;
  }
  body.printing {
    background: white !important;
    color: black !important;
  }
  @page {
    size: letter;
    margin: 0.5in;
  }
}

/* ── Layout ─── */
.proposal-doc {
  max-width: 7.5in;
  margin: 0 auto;
  padding: 0.5in 0.5in 1in;
  font-size: 10pt;
  line-height: 1.35;
}

.pp-header {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  padding-bottom: 16px;
  border-bottom: 2pt solid #000;
  margin-bottom: 18px;
}

.pp-header-contractor { display: flex; gap: 14px; align-items: flex-start; }
.pp-logo { max-width: 100px; max-height: 100px; object-fit: contain; }
.pp-contractor-text { font-size: 9pt; line-height: 1.4; }
.pp-company { font-size: 12pt; font-weight: bold; margin-bottom: 3px; }
.pp-placeholder { color: #b33; font-style: italic; }

.pp-doc-title {
  font-size: 14pt;
  font-weight: bold;
  letter-spacing: 2px;
  margin-bottom: 12px;
  text-align: right;
}

.pp-project-info { width: 100%; border-collapse: collapse; font-size: 9pt; margin-bottom: 14px; }
.pp-project-info th {
  text-align: left; font-weight: normal; color: #555;
  padding: 2px 8px 2px 0; width: 30%; vertical-align: top;
}
.pp-project-info td { padding: 2px 0; font-weight: 600; }

.pp-customer-block { border-top: 1pt solid #ccc; padding-top: 8px; }
.pp-section-label {
  font-size: 8pt; text-transform: uppercase; letter-spacing: 1.5px;
  color: #555; margin-bottom: 4px;
}
.pp-section-label.pp-tight { margin-top: 6px; }
.pp-customer-name { font-size: 11pt; font-weight: bold; margin-bottom: 3px; }
.pp-customer-line { font-size: 9pt; }

.pp-section-heading {
  font-size: 11pt;
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin: 16px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1pt solid #999;
}

.pp-scope-text { margin: 0; font-size: 10pt; text-align: justify; }

.pp-line-items {
  width: 100%;
  border-collapse: collapse;
  font-size: 9pt;
  margin-top: 4px;
}
.pp-line-items th {
  text-align: left;
  padding: 6px 4px;
  border-bottom: 1pt solid #000;
  font-weight: bold;
  background: #eee;
}
.pp-line-items td { padding: 4px; border-bottom: 0.5pt solid #ddd; }
.pp-line-items tr:nth-child(even) td { background: #fafafa; }

.pp-col-qty { text-align: right; width: 8%; }
.pp-col-unit { width: 14%; }
.pp-col-money { text-align: right; width: 14%; font-variant-numeric: tabular-nums; }
.pp-col-desc { width: auto; }
.pp-price-col { font-weight: 600; }
.pp-empty { text-align: center; font-style: italic; color: #888; padding: 16px; }

.pp-totals {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
  gap: 24px;
}
.pp-internal-breakdown { max-width: 260px; }
.pp-kv-table { border-collapse: collapse; font-size: 10pt; }
.pp-kv-table th {
  text-align: left; padding: 3px 16px 3px 0;
  font-weight: normal; color: #444;
}
.pp-kv-table td { padding: 3px 0; text-align: right; font-variant-numeric: tabular-nums; min-width: 100px; }

.pp-bid-table { border: 2pt solid #000; padding: 8px 12px; }
.pp-bid-table th,
.pp-bid-table td { padding: 4px 12px 4px 0; }
.pp-grand-total th,
.pp-grand-total td {
  font-size: 13pt; font-weight: bold;
  border-top: 1pt solid #000;
  padding-top: 6px;
}

.pp-signatures { margin-top: 40px; }
.pp-sig-row { display: grid; grid-template-columns: 3fr 1fr; gap: 24px; margin-bottom: 36px; }
.pp-sig-col { display: flex; flex-direction: column; }
.pp-sig-line { border-bottom: 1pt solid #000; height: 28px; }
.pp-sig-label { font-size: 8pt; margin-top: 4px; color: #444; }

.pp-terms {
  margin-top: 24px;
  page-break-inside: avoid;
}
.pp-terms-text { font-size: 8pt; line-height: 1.45; color: #333; margin: 0; }

/* Avoid page breaks inside rows */
.pp-line-items tr { page-break-inside: avoid; }
.pp-signatures { page-break-inside: avoid; }
`;
