/**
 * PrintableChangeOrder — Phase 14.G
 *
 * Mirrors PrintableProposal: always mounted, normally display:none,
 * revealed when `body.classList` contains 'printing' AND
 * `usePrintStore.changeOrder` is non-null.
 *
 * Layout:
 *   1. Title block     — "CHANGE ORDER" + base proposal number + Rn→Rm
 *   2. Reference box   — dates/labels for the two revisions being diffed
 *   3. Parties block   — contractor + customer (from the "to" revision)
 *   4. Summary lines   — plain-English bullets from summarizeChangeOrder
 *   5. Change table    — per-item deltas grouped by Add/Remove/Change
 *   6. Totals delta    — net material / labor / bid with signed deltas
 *   7. Signature block — customer + contractor signature lines + date
 *   8. Terms footer    — "Change order supplements original proposal…"
 *
 * Uses the same CSS approach as PrintableProposal (body.printing flip +
 * @media print) so pages print cleanly on letter paper.
 */

import { usePrintStore } from '@core/print/printProposal';
import type { ChangeOrderPrintData } from '@core/print/printChangeOrder';
import type { LineItemDelta, TotalsDelta } from '@core/print/proposalRevision';
import { PLACEHOLDER_COMPANY } from '@store/contractorProfileStore';

export function PrintableChangeOrder() {
  const changeOrder = usePrintStore((s) => s.changeOrder);

  return (
    <>
      <style>{CSS_RULES}</style>
      <div className="printable-change-order" aria-hidden={!changeOrder}>
        {changeOrder && <ChangeOrderDocument data={changeOrder} />}
      </div>
    </>
  );
}

// ── Root document ─────────────────────────────────────────────

function ChangeOrderDocument({ data }: { data: ChangeOrderPrintData }) {
  return (
    <article className="co-doc">
      <TitleBlock data={data} />
      <ReferenceBlock data={data} />
      <PartiesBlock data={data} />
      <SummarySection summary={data.summary} />
      <ChangeTable deltas={data.diff.deltas} />
      <TotalsDeltaSection totals={data.diff.totals} />
      <SignatureBlock data={data} />
      <TermsFooter />
    </article>
  );
}

// ── Title block ───────────────────────────────────────────────

function TitleBlock({ data }: { data: ChangeOrderPrintData }) {
  const contractor = data.toRevision.data.contractor;
  const showPlaceholderWarning = contractor.companyName === PLACEHOLDER_COMPANY;
  return (
    <header className="co-header">
      <div className="co-header-contractor">
        {contractor.logoDataUrl && (
          <img src={contractor.logoDataUrl} alt="" className="co-logo" />
        )}
        <div className="co-contractor-text">
          <div className={`co-company${showPlaceholderWarning ? ' co-placeholder' : ''}`}>
            {contractor.companyName}
          </div>
          {contractor.licenseNumber && (
            <div>License #: {contractor.licenseNumber}</div>
          )}
          {contractor.addressLine1 && <div>{contractor.addressLine1}</div>}
          {contractor.cityStateZip && <div>{contractor.cityStateZip}</div>}
          {contractor.phone && <div>{contractor.phone}</div>}
          {contractor.email && <div>{contractor.email}</div>}
        </div>
      </div>
      <div className="co-title-col">
        <div className="co-doc-title">CHANGE ORDER</div>
        <table className="co-project-info">
          <tbody>
            <tr>
              <th>Proposal #</th>
              <td>{data.baseNumber}</td>
            </tr>
            <tr>
              <th>Revision</th>
              <td>
                {data.fromRevision.revisionNumber} → {data.toRevision.revisionNumber}
              </td>
            </tr>
            <tr>
              <th>Generated</th>
              <td>{data.dateDisplay}</td>
            </tr>
            <tr>
              <th>Project</th>
              <td>{data.toRevision.data.project.name}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </header>
  );
}

// ── Reference block ───────────────────────────────────────────

function ReferenceBlock({ data }: { data: ChangeOrderPrintData }) {
  const fromData = data.fromRevision.data;
  const toData = data.toRevision.data;
  return (
    <section className="co-reference">
      <div className="co-section-label">References</div>
      <table className="co-ref-table">
        <thead>
          <tr>
            <th>Revision</th>
            <th>Saved</th>
            <th>Total</th>
            <th>Note</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{data.fromRevision.revisionNumber}</td>
            <td>{fmtDate(data.fromRevision.savedAtIso)}</td>
            <td>${fromData.totals.customerTotal.toFixed(2)}</td>
            <td>{data.fromRevision.note ?? '—'}</td>
          </tr>
          <tr>
            <td>{data.toRevision.revisionNumber}</td>
            <td>{fmtDate(data.toRevision.savedAtIso)}</td>
            <td>${toData.totals.customerTotal.toFixed(2)}</td>
            <td>{data.toRevision.note ?? '—'}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// ── Parties block ─────────────────────────────────────────────

function PartiesBlock({ data }: { data: ChangeOrderPrintData }) {
  const block = data.toRevision.data.customerBlock;
  return (
    <section className="co-parties">
      <div className="co-section-label">Prepared For</div>
      <div className="co-customer-name">{block.displayName}</div>
      {block.siteAddressLines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
      {block.contactLines.map((line, i) => (
        <div key={i} className="co-customer-contact">{line}</div>
      ))}
    </section>
  );
}

// ── Summary (English bullets) ─────────────────────────────────

function SummarySection({ summary }: { summary: string[] }) {
  return (
    <section className="co-summary">
      <div className="co-section-label">Summary of Changes</div>
      <ul className="co-summary-list">
        {summary.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
    </section>
  );
}

// ── Change table (grouped deltas) ────────────────────────────

function ChangeTable({ deltas }: { deltas: readonly LineItemDelta[] }) {
  const added = deltas.filter((d) => d.kind === 'added');
  const removed = deltas.filter((d) => d.kind === 'removed');
  const changed = deltas.filter((d) => d.kind === 'quantity_changed' || d.kind === 'price_changed');

  return (
    <section className="co-changes">
      <div className="co-section-label">Detailed Changes</div>
      <table className="co-change-table">
        <thead>
          <tr>
            <th>Type</th>
            <th>Item</th>
            <th className="co-num">Qty</th>
            <th className="co-num">Unit</th>
            <th className="co-num">Δ Material</th>
            <th className="co-num">Δ Labor (hr)</th>
            <th className="co-num">Δ Customer Price</th>
          </tr>
        </thead>
        <tbody>
          {added.map((d, i) => (
            <DeltaRow key={`a-${i}`} delta={d} kindLabel="Added" />
          ))}
          {removed.map((d, i) => (
            <DeltaRow key={`r-${i}`} delta={d} kindLabel="Removed" />
          ))}
          {changed.map((d, i) => (
            <DeltaRow key={`c-${i}`} delta={d} kindLabel={d.kind === 'quantity_changed' ? 'Qty Δ' : 'Price Δ'} />
          ))}
          {deltas.length === 0 && (
            <tr>
              <td colSpan={7} className="co-empty">No line-item changes.</td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

function DeltaRow({ delta, kindLabel }: { delta: LineItemDelta; kindLabel: string }) {
  const label = delta.identity.label;
  const unit = delta.side?.unit ?? delta.after?.unit ?? delta.before?.unit ?? '—';
  const qtyCell = delta.kind === 'quantity_changed'
    ? `${delta.before?.quantity ?? 0} → ${delta.after?.quantity ?? 0}`
    : fmtSigned(delta.quantityDelta);
  return (
    <tr>
      <td>{kindLabel}</td>
      <td>{label}</td>
      <td className="co-num">{qtyCell}</td>
      <td className="co-num">{unit}</td>
      <td className="co-num">{fmtSignedUsd(delta.materialCostDelta)}</td>
      <td className="co-num">{fmtSigned(delta.laborHoursDelta, 2)}</td>
      <td className="co-num co-bold">{fmtSignedUsd(delta.customerPriceDelta)}</td>
    </tr>
  );
}

// ── Totals delta ──────────────────────────────────────────────

function TotalsDeltaSection({ totals }: { totals: TotalsDelta }) {
  return (
    <section className="co-totals">
      <div className="co-section-label">Net Total Impact</div>
      <table className="co-totals-table">
        <tbody>
          <tr>
            <th>Subtotal change</th>
            <td className="co-num">{fmtSignedUsd(totals.customerSubtotalDelta)}</td>
          </tr>
          <tr>
            <th>Tax change</th>
            <td className="co-num">{fmtSignedUsd(totals.customerTaxDelta)}</td>
          </tr>
          <tr className="co-total-row">
            <th>Total bid change</th>
            <td className="co-num">{fmtSignedUsd(totals.customerTotalDelta)}</td>
          </tr>
          {totals.internal && (
            <>
              <tr className="co-internal-sep">
                <th colSpan={2}>— Internal breakdown —</th>
              </tr>
              <tr>
                <th>Raw material Δ</th>
                <td className="co-num">{fmtSignedUsd(totals.internal.rawMaterialDelta)}</td>
              </tr>
              <tr>
                <th>Raw labor hours Δ</th>
                <td className="co-num">{fmtSigned(totals.internal.rawLaborHoursDelta, 2)} hr</td>
              </tr>
              <tr>
                <th>Overhead Δ</th>
                <td className="co-num">{fmtSignedUsd(totals.internal.overheadDelta)}</td>
              </tr>
              <tr>
                <th>Margin Δ</th>
                <td className="co-num">{fmtSignedUsd(totals.internal.marginDelta)}</td>
              </tr>
            </>
          )}
        </tbody>
      </table>
    </section>
  );
}

// ── Signatures + terms ────────────────────────────────────────

function SignatureBlock({ data }: { data: ChangeOrderPrintData }) {
  return (
    <section className="co-signatures">
      <div className="co-section-label">Approvals</div>
      <div className="co-sig-row">
        <div className="co-sig">
          <div className="co-sig-line" />
          <div className="co-sig-label">Customer signature</div>
        </div>
        <div className="co-sig-date">
          <div className="co-sig-line" />
          <div className="co-sig-label">Date</div>
        </div>
      </div>
      <div className="co-sig-row">
        <div className="co-sig">
          <div className="co-sig-line" />
          <div className="co-sig-label">
            {data.toRevision.data.contractor.companyName} (contractor)
          </div>
        </div>
        <div className="co-sig-date">
          <div className="co-sig-line" />
          <div className="co-sig-label">Date</div>
        </div>
      </div>
    </section>
  );
}

function TermsFooter() {
  return (
    <footer className="co-terms">
      This Change Order supplements and modifies the original proposal
      referenced above. All other terms and conditions of the original
      proposal remain in effect. Signatures by both parties constitute
      acceptance of the modified scope and total.
    </footer>
  );
}

// ── Formatting helpers ───────────────────────────────────────

function fmtDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch { return iso; }
}

function fmtSigned(n: number, decimals = 0): string {
  if (Math.abs(n) < 0.005) return '—';
  const sign = n > 0 ? '+' : '−';
  return `${sign}${Math.abs(n).toFixed(decimals)}`;
}

function fmtSignedUsd(n: number): string {
  if (Math.abs(n) < 0.005) return '—';
  const sign = n > 0 ? '+' : '−';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

// ── CSS ───────────────────────────────────────────────────────

const CSS_RULES = `
/* ── Default: hidden ─── */
.printable-change-order { display: none; }

/* ── body.printing + .changeOrder present → visible preview ─── */
body.printing .printable-change-order {
  display: block;
  position: fixed;
  inset: 0;
  overflow: auto;
  z-index: 9999;
  background: white;
  color: black;
  font-family: 'Times New Roman', Georgia, serif;
}

/* ── Print ─── */
@media print {
  body.printing > *:not(.printable-change-order):not(.printable-proposal) {
    display: none !important;
  }
  body.printing .printable-change-order {
    position: static !important;
    inset: auto !important;
    overflow: visible !important;
    z-index: auto !important;
    background: white !important;
    color: black !important;
  }
}

/* ── Layout ─── */
.co-doc {
  max-width: 7.5in;
  margin: 0 auto;
  padding: 0.5in 0.5in 1in;
  font-size: 10pt;
  line-height: 1.35;
  color: black;
}

.co-header {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  padding-bottom: 16px;
  border-bottom: 2pt solid #000;
  margin-bottom: 18px;
}
.co-header-contractor { display: flex; gap: 14px; align-items: flex-start; }
.co-logo { max-width: 100px; max-height: 100px; object-fit: contain; }
.co-contractor-text { font-size: 9pt; line-height: 1.4; }
.co-company { font-size: 12pt; font-weight: bold; margin-bottom: 3px; }
.co-placeholder { color: #b33; font-style: italic; }

.co-title-col { text-align: right; }
.co-doc-title {
  font-size: 16pt;
  font-weight: bold;
  letter-spacing: 3px;
  margin-bottom: 10px;
  color: #8a2e00;  /* distinct from proposal — CO has a warm accent */
}

.co-project-info { width: 100%; border-collapse: collapse; font-size: 9pt; }
.co-project-info th {
  text-align: left; font-weight: normal; color: #555;
  padding: 2px 8px 2px 0; vertical-align: top;
}
.co-project-info td { padding: 2px 0; font-weight: 600; text-align: left; }

/* ── Sections ─── */
.co-section-label {
  font-size: 9pt;
  letter-spacing: 2pt;
  color: #555;
  margin-top: 14px;
  margin-bottom: 4px;
  text-transform: uppercase;
}
.co-reference, .co-parties, .co-summary, .co-changes, .co-totals, .co-signatures {
  margin-bottom: 6px;
  page-break-inside: avoid;
}

.co-ref-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9pt;
}
.co-ref-table th, .co-ref-table td {
  border: 0.5pt solid #999;
  padding: 4px 6px;
  text-align: left;
}
.co-ref-table th { background: #f0f0f0; font-weight: 600; }

.co-customer-name { font-weight: bold; font-size: 11pt; margin-bottom: 2px; }
.co-customer-contact { font-size: 9pt; color: #333; }

.co-summary-list {
  margin: 4px 0 10px;
  padding-left: 20px;
  font-size: 10pt;
}
.co-summary-list li {
  margin-bottom: 3px;
  page-break-inside: avoid;
}

/* ── Change table ─── */
.co-change-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9pt;
  margin-bottom: 8px;
}
.co-change-table th, .co-change-table td {
  border: 0.5pt solid #aaa;
  padding: 3px 5px;
}
.co-change-table thead th {
  background: #e8e8e8;
  font-weight: 600;
  font-size: 8pt;
  letter-spacing: 0.5pt;
  text-transform: uppercase;
}
.co-change-table tbody tr:nth-child(even) { background: #f6f6f6; }
.co-num { text-align: right; font-variant-numeric: tabular-nums; }
.co-bold { font-weight: 600; }
.co-empty { text-align: center; color: #888; font-style: italic; padding: 12px 6px; }

/* ── Totals delta ─── */
.co-totals-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10pt;
}
.co-totals-table th {
  text-align: left;
  padding: 3px 0;
  color: #333;
  font-weight: normal;
}
.co-totals-table td { padding: 3px 0; }
.co-totals-table .co-total-row th, .co-totals-table .co-total-row td {
  font-weight: bold;
  border-top: 1pt solid #000;
  padding-top: 6px;
  font-size: 11pt;
}
.co-internal-sep th {
  padding-top: 10px;
  font-size: 8pt;
  letter-spacing: 1pt;
  color: #888;
}

/* ── Signatures ─── */
.co-signatures { margin-top: 22px; }
.co-sig-row {
  display: grid;
  grid-template-columns: 3fr 1fr;
  gap: 30px;
  margin-top: 20px;
}
.co-sig, .co-sig-date { display: flex; flex-direction: column; }
.co-sig-line {
  border-bottom: 1pt solid #000;
  height: 22px;
}
.co-sig-label {
  font-size: 8pt;
  color: #555;
  margin-top: 2px;
}

/* ── Terms ─── */
.co-terms {
  margin-top: 24px;
  padding-top: 10px;
  border-top: 0.5pt solid #ccc;
  font-size: 8.5pt;
  line-height: 1.5;
  color: #444;
  text-align: justify;
}
`;
