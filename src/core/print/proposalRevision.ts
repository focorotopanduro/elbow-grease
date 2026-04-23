/**
 * proposalRevision — Phase 14.G
 *
 * Version tracking + diffing for ProposalData. Lets a contractor:
 *   • Save every printed proposal as a snapshot (R1 → R2 → R3 …)
 *   • Compare any two revisions and see a line-by-line diff
 *   • Generate a plain-English "Change Order" summary:
 *       "Added 2× 1.5\" PVC elbow (+$16 mat, +0.60 hr)
 *        Removed 1× shower (–$450 mat)
 *        Total delta: +$340 material, +2.5 hr labor, +$620 bid"
 *
 * The pure module. No Zustand, no React, no localStorage. All inputs
 * are plain JSON-serializable; all outputs are plain data. Integration
 * layers (store + panel) wrap this for persistence and display.
 *
 * Design notes:
 *   • Revision IDs are "R1", "R2", … (1-indexed) derived from the
 *     count of prior revisions on the same base proposal number.
 *     The original proposal is R1; the first change order is R2.
 *   • Line-item identity uses `partHint` when available, falling back
 *     to `category|material|size|description` for synthetic items
 *     (consumables like primer/cement, user-added rows, etc.).
 *   • Quantity-changed items are matched and bucketed separately from
 *     added/removed so the change-order reads naturally:
 *       "2 → 5 of 1.5" elbow (+3 units, +$24)"
 *     rather than two opposite changes in the same summary.
 */

import type { ProposalData, ProposalLineItem, ProposalTotals } from './proposalData';

// ── Snapshot + revision types ─────────────────────────────────

/**
 * A saved revision is a point-in-time snapshot of a ProposalData plus
 * metadata about when/why it was saved.
 */
export interface SavedRevision {
  /** Stable ID — `baseNumber|R<N>`. */
  id: string;
  /** The "P-YYMMDD-XXXX" portion (shared across every revision of the
   *  same proposal). */
  baseNumber: string;
  /** Revision label: "R1", "R2", … (R1 = original). */
  revisionNumber: string;
  /** Revision index (1-based, used for ordering + sparse-gap prevention). */
  revisionIndex: number;
  /** ISO timestamp the snapshot was saved. */
  savedAtIso: string;
  /** Optional human-facing note ("Added tub and moved the WC"). */
  note?: string;
  /** The full proposal data as printed at this revision. */
  data: ProposalData;
}

// ── Diff types ────────────────────────────────────────────────

export interface LineItemDelta {
  /** Matched by stable identity — whichever side(s) had the item. */
  identity: LineItemIdentity;
  /** Change classification. */
  kind: 'added' | 'removed' | 'quantity_changed' | 'price_changed';
  /** Present for added or removed items. */
  side?: ProposalLineItem;
  /** Present for quantity/price changes. */
  before?: ProposalLineItem;
  after?: ProposalLineItem;
  /** Quantity delta (signed). For `added`, equals after.quantity. For
   *  `removed`, equals -before.quantity. */
  quantityDelta: number;
  /** Dollar delta on customerPrice (signed). */
  customerPriceDelta: number;
  /** Dollar delta on material cost (signed, internal variant only). */
  materialCostDelta: number;
  /** Hour delta on labor (signed, internal variant only). */
  laborHoursDelta: number;
}

export interface LineItemIdentity {
  /** Best-effort stable key: partHint OR `${category}|${material}|${size}|${description}`. */
  key: string;
  /** Human-readable label for the change order. */
  label: string;
}

export interface TotalsDelta {
  customerSubtotalDelta: number;
  customerTaxDelta: number;
  customerTotalDelta: number;
  /** Present when BOTH revisions carry internal breakdowns. */
  internal?: {
    rawMaterialDelta: number;
    rawLaborHoursDelta: number;
    rawLaborCostDelta: number;
    overheadDelta: number;
    marginDelta: number;
  };
}

export interface ProposalDiff {
  /** The from/to revision labels for display. */
  fromRevision: string;
  toRevision: string;
  /** Same-order categorization — `added`, `removed`, `quantity_changed`, `price_changed`. */
  deltas: LineItemDelta[];
  totals: TotalsDelta;
  /** Was the contractor profile, customer, or scope description changed? */
  metadataChanges: {
    customerChanged: boolean;
    contractorChanged: boolean;
    scopeChanged: boolean;
  };
  /** Net headline figures for the change-order title strip. */
  summary: {
    lineItemsAdded: number;
    lineItemsRemoved: number;
    lineItemsChanged: number;
    netMaterialDelta: number;
    netLaborHoursDelta: number;
    netBidDelta: number;
  };
}

// ── Revision number derivation ────────────────────────────────

/**
 * Given the base proposal number + the existing revisions for it,
 * compute the next revision number. Monotonic — uses max+1, not
 * length, so gaps from deletions don't collide.
 */
export function nextRevisionNumber(existing: readonly SavedRevision[]): {
  revisionNumber: string;
  revisionIndex: number;
} {
  if (existing.length === 0) return { revisionNumber: 'R1', revisionIndex: 1 };
  let max = 0;
  for (const r of existing) {
    if (r.revisionIndex > max) max = r.revisionIndex;
  }
  const nextIdx = max + 1;
  return { revisionNumber: `R${nextIdx}`, revisionIndex: nextIdx };
}

/**
 * Parse "R3" or "r03" → 3. Returns null for malformed input.
 * Handles leading whitespace + case variation.
 */
export function parseRevisionIndex(label: string): number | null {
  const m = /^\s*[Rr](\d+)\s*$/.exec(label);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/**
 * Build a snapshot record from a ProposalData + revision metadata.
 * The returned snapshot is a fresh object — the caller's ProposalData
 * is not mutated.
 */
export function buildSnapshot(
  data: ProposalData,
  baseNumber: string,
  revisionNumber: string,
  revisionIndex: number,
  opts: { note?: string; savedAtIso?: string } = {},
): SavedRevision {
  return {
    id: `${baseNumber}|${revisionNumber}`,
    baseNumber,
    revisionNumber,
    revisionIndex,
    savedAtIso: opts.savedAtIso ?? new Date().toISOString(),
    ...(opts.note !== undefined && opts.note.length > 0 ? { note: opts.note } : {}),
    data,
  };
}

// ── Diffing ───────────────────────────────────────────────────

/**
 * Compute the stable identity key + human label for a line item.
 * Falls back to description when structural fields aren't carried
 * (legacy snapshots pre-partHint extension).
 */
export function lineItemIdentity(item: ProposalLineItem): LineItemIdentity {
  const partHint = item.partHint;
  const cat = item.category ?? '';
  const mat = item.material ?? '';
  const size = item.size ?? '';
  const key = partHint && partHint.length > 0
    ? partHint
    : `${cat}|${mat}|${size}|${item.description}`;
  // Human label: size + material + description, de-duplicated.
  const bits: string[] = [];
  if (size) bits.push(size);
  if (mat && !item.description.toLowerCase().includes(mat.toLowerCase())) {
    bits.push(mat.replace(/_/g, ' '));
  }
  bits.push(item.description);
  return { key, label: bits.join(' ') };
}

function approxEq(a: number, b: number, epsilon = 0.005): boolean {
  return Math.abs(a - b) < epsilon;
}

/**
 * Compare two proposals and emit a structured diff. Matches line
 * items by `lineItemIdentity.key`. Unmatched keys in `before` are
 * marked `removed`; unmatched in `after` are `added`. Matched pairs
 * with differing quantities are `quantity_changed`; matched with
 * same qty but different price are `price_changed`.
 */
export function diffProposals(before: ProposalData, after: ProposalData): ProposalDiff {
  // Index by identity key.
  const beforeIndex = new Map<string, ProposalLineItem>();
  const beforeIdent = new Map<string, LineItemIdentity>();
  for (const item of before.lineItems) {
    const ident = lineItemIdentity(item);
    beforeIndex.set(ident.key, item);
    beforeIdent.set(ident.key, ident);
  }

  const afterIndex = new Map<string, ProposalLineItem>();
  const afterIdent = new Map<string, LineItemIdentity>();
  for (const item of after.lineItems) {
    const ident = lineItemIdentity(item);
    afterIndex.set(ident.key, item);
    afterIdent.set(ident.key, ident);
  }

  const deltas: LineItemDelta[] = [];

  // Removed: in before, not in after.
  for (const [key, item] of beforeIndex) {
    if (afterIndex.has(key)) continue;
    deltas.push({
      identity: beforeIdent.get(key)!,
      kind: 'removed',
      side: item,
      quantityDelta: -item.quantity,
      customerPriceDelta: -item.customerPrice,
      materialCostDelta: -(item.internalBreakdown?.materialCost ?? 0),
      laborHoursDelta: -(item.internalBreakdown?.laborHours ?? 0),
    });
  }

  // Added + changed.
  for (const [key, after_] of afterIndex) {
    const before_ = beforeIndex.get(key);
    if (!before_) {
      deltas.push({
        identity: afterIdent.get(key)!,
        kind: 'added',
        side: after_,
        quantityDelta: after_.quantity,
        customerPriceDelta: after_.customerPrice,
        materialCostDelta: after_.internalBreakdown?.materialCost ?? 0,
        laborHoursDelta: after_.internalBreakdown?.laborHours ?? 0,
      });
      continue;
    }
    const qtyDelta = after_.quantity - before_.quantity;
    const priceDelta = after_.customerPrice - before_.customerPrice;
    const matDelta = (after_.internalBreakdown?.materialCost ?? 0)
                   - (before_.internalBreakdown?.materialCost ?? 0);
    const hrDelta = (after_.internalBreakdown?.laborHours ?? 0)
                  - (before_.internalBreakdown?.laborHours ?? 0);

    const qtyChanged = !approxEq(qtyDelta, 0);
    const priceChanged = !approxEq(priceDelta, 0) || !approxEq(matDelta, 0) || !approxEq(hrDelta, 0);
    if (!qtyChanged && !priceChanged) continue; // no-op

    deltas.push({
      identity: afterIdent.get(key)!,
      kind: qtyChanged ? 'quantity_changed' : 'price_changed',
      before: before_,
      after: after_,
      quantityDelta: qtyDelta,
      customerPriceDelta: priceDelta,
      materialCostDelta: matDelta,
      laborHoursDelta: hrDelta,
    });
  }

  // Totals deltas.
  const totals: TotalsDelta = {
    customerSubtotalDelta: after.totals.customerSubtotal - before.totals.customerSubtotal,
    customerTaxDelta: after.totals.customerTax - before.totals.customerTax,
    customerTotalDelta: after.totals.customerTotal - before.totals.customerTotal,
  };
  if (before.totals.internal && after.totals.internal) {
    totals.internal = {
      rawMaterialDelta: after.totals.internal.rawMaterial - before.totals.internal.rawMaterial,
      rawLaborHoursDelta: after.totals.internal.rawLaborHours - before.totals.internal.rawLaborHours,
      rawLaborCostDelta: after.totals.internal.rawLaborCost - before.totals.internal.rawLaborCost,
      overheadDelta: after.totals.internal.overhead - before.totals.internal.overhead,
      marginDelta: after.totals.internal.margin - before.totals.internal.margin,
    };
  }

  // Metadata changes.
  const metadataChanges = {
    customerChanged: customerKey(before) !== customerKey(after),
    contractorChanged: before.contractor.companyName !== after.contractor.companyName
                    || (before.contractor.licenseNumber ?? '') !== (after.contractor.licenseNumber ?? ''),
    scopeChanged: (before.project.scopeDescription ?? '') !== (after.project.scopeDescription ?? ''),
  };

  // Summary headline counts.
  let added = 0, removed = 0, changed = 0;
  let netMat = 0, netHr = 0;
  for (const d of deltas) {
    if (d.kind === 'added') added++;
    else if (d.kind === 'removed') removed++;
    else changed++;
    netMat += d.materialCostDelta;
    netHr += d.laborHoursDelta;
  }

  return {
    fromRevision: before.project.proposalNumber,
    toRevision: after.project.proposalNumber,
    deltas,
    totals,
    metadataChanges,
    summary: {
      lineItemsAdded: added,
      lineItemsRemoved: removed,
      lineItemsChanged: changed,
      netMaterialDelta: netMat,
      netLaborHoursDelta: netHr,
      netBidDelta: totals.customerTotalDelta,
    },
  };
}

function customerKey(p: ProposalData): string {
  const c = p.customer;
  if (!c) return '__none__';
  // Use id + name + siteAddress for identity; changes in contact info
  // alone don't bump "customerChanged."
  const site = c.siteAddress
    ? `${c.siteAddress.street}|${c.siteAddress.city}|${c.siteAddress.state}|${c.siteAddress.zip}`
    : '';
  return `${c.id}|${c.name}|${site}`;
}

// ── Change-order summary (plain English) ──────────────────────

/**
 * Produce a plain-English multi-line summary suitable for the Change
 * Order PDF's "Summary of Changes" block and the compare panel's
 * headline strip.
 */
export function summarizeChangeOrder(diff: ProposalDiff): string[] {
  const out: string[] = [];

  if (diff.metadataChanges.scopeChanged) {
    out.push('Scope of work updated.');
  }
  if (diff.metadataChanges.customerChanged) {
    out.push('Customer / site address updated.');
  }

  for (const d of diff.deltas) {
    const label = d.identity.label;
    if (d.kind === 'added') {
      out.push(`Added ${fmtQty(d.quantityDelta)}× ${label} (${fmtDollarSigned(d.customerPriceDelta)}).`);
    } else if (d.kind === 'removed') {
      out.push(`Removed ${fmtQty(Math.abs(d.quantityDelta))}× ${label} (${fmtDollarSigned(d.customerPriceDelta)}).`);
    } else if (d.kind === 'quantity_changed') {
      const before = d.before?.quantity ?? 0;
      const after = d.after?.quantity ?? 0;
      out.push(
        `${label}: ${before} → ${after} (${fmtDeltaQty(d.quantityDelta)}, ${fmtDollarSigned(d.customerPriceDelta)}).`,
      );
    } else {
      out.push(`${label}: price updated (${fmtDollarSigned(d.customerPriceDelta)}).`);
    }
  }

  const t = diff.totals;
  const parts: string[] = [];
  if (!approxEq(t.customerTotalDelta, 0)) parts.push(`bid ${fmtDollarSigned(t.customerTotalDelta)}`);
  if (t.internal && !approxEq(t.internal.rawMaterialDelta, 0)) parts.push(`mat ${fmtDollarSigned(t.internal.rawMaterialDelta)}`);
  if (t.internal && !approxEq(t.internal.rawLaborHoursDelta, 0)) parts.push(`labor ${fmtDeltaHours(t.internal.rawLaborHoursDelta)}`);
  if (parts.length > 0) {
    out.push(`Net change: ${parts.join(', ')}.`);
  }

  if (out.length === 0) out.push('No changes.');
  return out;
}

// ── Number formatters (kept local to minimize import surface) ─

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function fmtDeltaQty(n: number): string {
  const s = n >= 0 ? '+' : '';
  return `${s}${fmtQty(n)}`;
}

function fmtDollarSigned(n: number): string {
  const s = n >= 0 ? '+' : '−';
  return `${s}$${Math.abs(n).toFixed(n >= 100 ? 0 : 2)}`;
}

function fmtDeltaHours(n: number): string {
  const s = n >= 0 ? '+' : '−';
  return `${s}${Math.abs(n).toFixed(2)} hr`;
}
