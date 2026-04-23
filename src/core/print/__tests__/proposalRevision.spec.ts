/**
 * proposalRevision — Phase 14.G tests.
 *
 * Covers:
 *   • nextRevisionNumber: max+1 from existing, handles gaps
 *   • parseRevisionIndex: canonical + sloppy input
 *   • buildSnapshot: shape, id format, optional note
 *   • lineItemIdentity: partHint preferred, fallback composite
 *   • diffProposals:
 *       - added / removed / quantity_changed / price_changed
 *       - no-op when proposals are identical
 *       - totals deltas (customer + internal)
 *       - metadata flags (scope / customer / contractor changes)
 *       - summary counts + nets
 *   • summarizeChangeOrder: English lines include deltas with signs
 */

import { describe, it, expect } from 'vitest';
import {
  nextRevisionNumber,
  parseRevisionIndex,
  buildSnapshot,
  lineItemIdentity,
  diffProposals,
  summarizeChangeOrder,
  type SavedRevision,
} from '../proposalRevision';
import type { ProposalData, ProposalLineItem } from '../proposalData';

// ── Fixtures ──────────────────────────────────────────────────

function mkLineItem(overrides: Partial<ProposalLineItem> = {}): ProposalLineItem {
  return {
    description: 'Default line',
    quantity: 1,
    unit: 'ea',
    customerPrice: 10,
    partHint: 'TEST-DEFAULT',
    category: 'fitting',
    material: 'pvc_sch40',
    size: '1.5"',
    ...overrides,
  };
}

function mkProposal(overrides: Partial<ProposalData> = {}): ProposalData {
  return {
    variant: 'customer-facing',
    contractor: {
      companyName: 'Beit Building',
      contactName: 'Test',
      licenseNumber: 'CFC1',
      phone: '', email: '', addressLine1: '', cityStateZip: '',
    },
    customer: null,
    project: {
      name: 'Test',
      proposalNumber: 'P-260418-ABCD',
      dateIso: '2026-04-18T00:00:00Z',
      dateDisplay: 'April 18, 2026',
    },
    lineItems: [],
    totals: {
      customerSubtotal: 0,
      customerTax: 0,
      customerTotal: 0,
    },
    customerBlock: { displayName: '—', siteAddressLines: [], contactLines: [] },
    hints: { showInternalBreakdown: false, showDetailedRows: false },
    ...overrides,
  };
}

function mkSnapshot(idx: number, base = 'P-260418-ABCD'): SavedRevision {
  return {
    id: `${base}|R${idx}`,
    baseNumber: base,
    revisionNumber: `R${idx}`,
    revisionIndex: idx,
    savedAtIso: '2026-04-18T00:00:00.000Z',
    data: mkProposal(),
  };
}

// ── nextRevisionNumber ────────────────────────────────────────

describe('nextRevisionNumber', () => {
  it('returns R1 for empty history (original proposal)', () => {
    expect(nextRevisionNumber([])).toEqual({ revisionNumber: 'R1', revisionIndex: 1 });
  });

  it('returns max+1 for a contiguous history', () => {
    expect(nextRevisionNumber([mkSnapshot(1), mkSnapshot(2), mkSnapshot(3)]))
      .toEqual({ revisionNumber: 'R4', revisionIndex: 4 });
  });

  it('returns max+1 even when there are gaps from deletions', () => {
    // R2 and R3 were deleted; next should be R5 (not R3).
    expect(nextRevisionNumber([mkSnapshot(1), mkSnapshot(4)]))
      .toEqual({ revisionNumber: 'R5', revisionIndex: 5 });
  });
});

// ── parseRevisionIndex ────────────────────────────────────────

describe('parseRevisionIndex', () => {
  it('parses canonical labels', () => {
    expect(parseRevisionIndex('R1')).toBe(1);
    expect(parseRevisionIndex('R10')).toBe(10);
  });

  it('accepts lowercase + whitespace', () => {
    expect(parseRevisionIndex('  r3  ')).toBe(3);
  });

  it('accepts leading zeros', () => {
    expect(parseRevisionIndex('R07')).toBe(7);
  });

  it('returns null for malformed input', () => {
    expect(parseRevisionIndex('X1')).toBeNull();
    expect(parseRevisionIndex('R')).toBeNull();
    expect(parseRevisionIndex('R0')).toBeNull();
    expect(parseRevisionIndex('1')).toBeNull();
  });
});

// ── buildSnapshot ────────────────────────────────────────────

describe('buildSnapshot', () => {
  it('assembles a well-formed snapshot', () => {
    const snap = buildSnapshot(mkProposal(), 'P-260418-ABCD', 'R2', 2, {
      note: 'Added tub',
      savedAtIso: '2026-04-18T12:00:00.000Z',
    });
    expect(snap.id).toBe('P-260418-ABCD|R2');
    expect(snap.baseNumber).toBe('P-260418-ABCD');
    expect(snap.revisionNumber).toBe('R2');
    expect(snap.revisionIndex).toBe(2);
    expect(snap.savedAtIso).toBe('2026-04-18T12:00:00.000Z');
    expect(snap.note).toBe('Added tub');
  });

  it('omits the note field when empty', () => {
    const snap = buildSnapshot(mkProposal(), 'P-260418-ABCD', 'R1', 1, { note: '' });
    expect(snap.note).toBeUndefined();
  });

  it('generates savedAtIso if not provided', () => {
    const snap = buildSnapshot(mkProposal(), 'P-260418-ABCD', 'R1', 1);
    expect(snap.savedAtIso).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

// ── lineItemIdentity ─────────────────────────────────────────

describe('lineItemIdentity', () => {
  it('prefers partHint when present', () => {
    const id = lineItemIdentity(mkLineItem({ partHint: 'PVC-SCH40-2-10FT' }));
    expect(id.key).toBe('PVC-SCH40-2-10FT');
  });

  it('falls back to composite key when partHint is missing', () => {
    const id = lineItemIdentity(mkLineItem({
      partHint: undefined,
      category: 'fitting',
      material: 'pvc_sch40',
      size: '2"',
      description: 'sanitary tee',
    }));
    expect(id.key).toBe('fitting|pvc_sch40|2"|sanitary tee');
  });

  it('label includes size + material + description, de-duped', () => {
    const id = lineItemIdentity(mkLineItem({
      size: '1.5"',
      material: 'pvc_sch40',
      description: 'p-trap',
    }));
    expect(id.label.toLowerCase()).toContain('1.5"');
    expect(id.label.toLowerCase()).toContain('pvc');
    expect(id.label.toLowerCase()).toContain('p-trap');
  });
});

// ── diffProposals ────────────────────────────────────────────

describe('diffProposals — added / removed', () => {
  it('no-ops on identical proposals', () => {
    const p = mkProposal({
      lineItems: [mkLineItem({ partHint: 'A', quantity: 2, customerPrice: 20 })],
    });
    const diff = diffProposals(p, p);
    expect(diff.deltas).toHaveLength(0);
    expect(diff.summary.netMaterialDelta).toBe(0);
  });

  it('detects pure additions', () => {
    const before = mkProposal({ lineItems: [] });
    const after = mkProposal({
      lineItems: [mkLineItem({ partHint: 'NEW', quantity: 3, customerPrice: 45 })],
    });
    const diff = diffProposals(before, after);
    expect(diff.deltas).toHaveLength(1);
    expect(diff.deltas[0]!.kind).toBe('added');
    expect(diff.deltas[0]!.quantityDelta).toBe(3);
    expect(diff.deltas[0]!.customerPriceDelta).toBe(45);
    expect(diff.summary.lineItemsAdded).toBe(1);
  });

  it('detects pure removals', () => {
    const before = mkProposal({
      lineItems: [mkLineItem({ partHint: 'GONE', quantity: 2, customerPrice: 30 })],
    });
    const after = mkProposal({ lineItems: [] });
    const diff = diffProposals(before, after);
    expect(diff.deltas).toHaveLength(1);
    expect(diff.deltas[0]!.kind).toBe('removed');
    expect(diff.deltas[0]!.quantityDelta).toBe(-2);
    expect(diff.deltas[0]!.customerPriceDelta).toBe(-30);
    expect(diff.summary.lineItemsRemoved).toBe(1);
  });
});

describe('diffProposals — quantity and price changes', () => {
  it('matches items by partHint across revisions', () => {
    const before = mkProposal({
      lineItems: [mkLineItem({ partHint: 'PVC-2', quantity: 5, customerPrice: 100 })],
    });
    const after = mkProposal({
      lineItems: [mkLineItem({ partHint: 'PVC-2', quantity: 8, customerPrice: 160 })],
    });
    const diff = diffProposals(before, after);
    expect(diff.deltas).toHaveLength(1);
    expect(diff.deltas[0]!.kind).toBe('quantity_changed');
    expect(diff.deltas[0]!.quantityDelta).toBe(3);
    expect(diff.deltas[0]!.customerPriceDelta).toBe(60);
  });

  it('price_changed when quantity is unchanged but price differs', () => {
    const before = mkProposal({
      lineItems: [mkLineItem({ partHint: 'A', quantity: 2, customerPrice: 20 })],
    });
    const after = mkProposal({
      lineItems: [mkLineItem({ partHint: 'A', quantity: 2, customerPrice: 25 })],
    });
    const diff = diffProposals(before, after);
    expect(diff.deltas[0]!.kind).toBe('price_changed');
    expect(diff.deltas[0]!.customerPriceDelta).toBe(5);
  });

  it('carries material + labor deltas when both have internal breakdown', () => {
    const before = mkProposal({
      lineItems: [mkLineItem({
        partHint: 'A', quantity: 1, customerPrice: 50,
        internalBreakdown: { materialCost: 20, laborHours: 0.5, laborCost: 30 },
      })],
    });
    const after = mkProposal({
      lineItems: [mkLineItem({
        partHint: 'A', quantity: 2, customerPrice: 100,
        internalBreakdown: { materialCost: 40, laborHours: 1.0, laborCost: 60 },
      })],
    });
    const diff = diffProposals(before, after);
    expect(diff.deltas[0]!.materialCostDelta).toBe(20);
    expect(diff.deltas[0]!.laborHoursDelta).toBe(0.5);
  });
});

describe('diffProposals — totals', () => {
  it('computes customer totals delta', () => {
    const before = mkProposal({
      totals: { customerSubtotal: 1000, customerTax: 65, customerTotal: 1065 },
    });
    const after = mkProposal({
      totals: { customerSubtotal: 1500, customerTax: 97.5, customerTotal: 1597.5 },
    });
    const diff = diffProposals(before, after);
    expect(diff.totals.customerSubtotalDelta).toBe(500);
    expect(diff.totals.customerTaxDelta).toBeCloseTo(32.5, 2);
    expect(diff.totals.customerTotalDelta).toBeCloseTo(532.5, 2);
  });

  it('computes internal deltas when both sides have internals', () => {
    const before = mkProposal({
      totals: {
        customerSubtotal: 0, customerTax: 0, customerTotal: 0,
        internal: { rawMaterial: 500, rawLaborHours: 5, rawLaborCost: 475, overhead: 150, margin: 200 },
      },
    });
    const after = mkProposal({
      totals: {
        customerSubtotal: 0, customerTax: 0, customerTotal: 0,
        internal: { rawMaterial: 750, rawLaborHours: 8, rawLaborCost: 760, overhead: 225, margin: 300 },
      },
    });
    const diff = diffProposals(before, after);
    expect(diff.totals.internal).toBeDefined();
    expect(diff.totals.internal!.rawMaterialDelta).toBe(250);
    expect(diff.totals.internal!.rawLaborHoursDelta).toBe(3);
    expect(diff.totals.internal!.marginDelta).toBe(100);
  });

  it('omits internal deltas when one side lacks them', () => {
    const before = mkProposal();
    const after = mkProposal({
      totals: {
        customerSubtotal: 0, customerTax: 0, customerTotal: 0,
        internal: { rawMaterial: 100, rawLaborHours: 1, rawLaborCost: 95, overhead: 30, margin: 40 },
      },
    });
    const diff = diffProposals(before, after);
    expect(diff.totals.internal).toBeUndefined();
  });
});

describe('diffProposals — metadata changes', () => {
  it('flags scope change', () => {
    const before = mkProposal({ project: { ...mkProposal().project, scopeDescription: 'v1' } });
    const after = mkProposal({ project: { ...mkProposal().project, scopeDescription: 'v2' } });
    const diff = diffProposals(before, after);
    expect(diff.metadataChanges.scopeChanged).toBe(true);
  });

  it('flags contractor change (company name)', () => {
    const before = mkProposal();
    const after = mkProposal({
      contractor: { ...mkProposal().contractor, companyName: 'New Name' },
    });
    const diff = diffProposals(before, after);
    expect(diff.metadataChanges.contractorChanged).toBe(true);
  });

  it('flags customer change (null → populated)', () => {
    const before = mkProposal({ customer: null });
    const after = mkProposal({
      customer: {
        id: 'c1', name: 'Jones', templates: {},
        defaults: { wasteMaterial: 'pvc_sch40', supplyMaterial: 'pex', ventMaterial: 'pvc_sch40' },
        codes: [], markupPercent: 0, createdAt: '',
      },
    });
    const diff = diffProposals(before, after);
    expect(diff.metadataChanges.customerChanged).toBe(true);
  });
});

// ── summarizeChangeOrder ─────────────────────────────────────

describe('summarizeChangeOrder', () => {
  it('returns "No changes" for an empty diff', () => {
    const p = mkProposal();
    const diff = diffProposals(p, p);
    expect(summarizeChangeOrder(diff)).toEqual(['No changes.']);
  });

  it('includes add lines with positive signs', () => {
    const before = mkProposal();
    const after = mkProposal({
      lineItems: [mkLineItem({ partHint: 'NEW', quantity: 2, customerPrice: 80 })],
      totals: { customerSubtotal: 80, customerTax: 0, customerTotal: 80 },
    });
    const summary = summarizeChangeOrder(diffProposals(before, after));
    const joined = summary.join('\n');
    expect(joined).toMatch(/Added 2×/);
    expect(joined).toMatch(/\+\$80/);
  });

  it('includes remove lines with negative signs', () => {
    const before = mkProposal({
      lineItems: [mkLineItem({ partHint: 'OLD', quantity: 1, customerPrice: 45 })],
      totals: { customerSubtotal: 45, customerTax: 0, customerTotal: 45 },
    });
    const after = mkProposal();
    const summary = summarizeChangeOrder(diffProposals(before, after));
    const joined = summary.join('\n');
    expect(joined).toMatch(/Removed/);
    expect(joined).toMatch(/−\$45/);
  });

  it('includes quantity change lines with "before → after" format', () => {
    const before = mkProposal({
      lineItems: [mkLineItem({ partHint: 'A', quantity: 3, customerPrice: 30 })],
    });
    const after = mkProposal({
      lineItems: [mkLineItem({ partHint: 'A', quantity: 7, customerPrice: 70 })],
    });
    const summary = summarizeChangeOrder(diffProposals(before, after));
    const joined = summary.join('\n');
    expect(joined).toMatch(/3 → 7/);
  });

  it('includes a net-change footer when totals differ', () => {
    const before = mkProposal();
    const after = mkProposal({
      totals: { customerSubtotal: 100, customerTax: 10, customerTotal: 110 },
    });
    const summary = summarizeChangeOrder(diffProposals(before, after));
    const joined = summary.join('\n');
    expect(joined.toLowerCase()).toContain('net change');
    expect(joined).toMatch(/bid \+\$110/);
  });
});
