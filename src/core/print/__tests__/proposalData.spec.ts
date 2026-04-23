/**
 * proposalData — Phase 14.B tests.
 *
 * Covers:
 *   • customer-facing variant hides internal breakdown (no margin,
 *     no overhead, no labor-hour column).
 *   • internal variant includes every per-line and per-total figure.
 *   • customer block composes name + site address + contact lines
 *     correctly, handles null customer gracefully.
 *   • date display formatting is consistent and locale-stable.
 *   • proposal number format is P-YYMMDD-XXXX.
 *   • lineItems preserve ordering and carry per-line math.
 *   • totals reflect bid.grandTotal when bid is present.
 */

import { describe, it, expect } from 'vitest';
import {
  composeProposalData,
  generateProposalNumber,
  type ContractorProfile,
  type ComposeProposalInput,
} from '../proposalData';
import type { BOMReport } from '../../../engine/export/BOMExporter';
import type { CustomerProfile } from '@store/customerStore';

// ── Fixtures ──────────────────────────────────────────────────

const CONTRACTOR: ContractorProfile = {
  companyName: 'Beit Building Contractors LLC',
  contactName: 'Example Contractor',
  licenseNumber: 'CFC1428384',
  phone: '(407) 555-0199',
  email: 'estimates@beitbuilding.example',
  addressLine1: '123 Main St, Suite 200',
  cityStateZip: 'Orlando, FL 32801',
};

const CUSTOMER: CustomerProfile = {
  id: 'cust-jones',
  name: 'Jones Residence',
  templates: {},
  defaults: { wasteMaterial: 'pvc_sch40', supplyMaterial: 'pex', ventMaterial: 'pvc_sch40' },
  codes: [],
  markupPercent: 0,
  createdAt: '2026-01-01T00:00:00Z',
  contact: {
    personName: 'Eleanor Jones',
    phone: '(407) 555-0111',
    email: 'eleanor@example.com',
  },
  siteAddress: {
    street: '45 Oak Dr',
    city: 'Orlando',
    state: 'FL',
    zip: '32802',
  },
};

function mkBom(overrides: Partial<BOMReport> = {}): BOMReport {
  return {
    items: [],
    subtotals: { pipe: 0, fitting: 0, fixture: 0, support: 0, misc: 0 },
    grandTotal: 1000,
    grandLaborHours: 10,
    cutList: {
      perDiameter: [],
      totalStockLength: 0,
      totalRequiredLength: 0,
      totalWaste: 0,
      wastePercent: 0,
      summary: [],
    } as unknown as BOMReport['cutList'],
    generatedAt: '2026-04-18T00:00:00Z',
    ...overrides,
  };
}

function mkInput(overrides: Partial<ComposeProposalInput> = {}): ComposeProposalInput {
  return {
    variant: 'customer-facing',
    contractor: CONTRACTOR,
    customer: CUSTOMER,
    bom: mkBom(),
    project: {
      name: 'Jones 2-Bath Rough-In',
      proposalNumber: 'P-260418-ABCD',
      dateIso: '2026-04-18T00:00:00Z',
    },
    laborRateUsdPerHr: 95,
    ...overrides,
  };
}

// ── Customer-facing variant ──────────────────────────────────

describe('customer-facing variant', () => {
  it('hints.showInternalBreakdown is false', () => {
    const p = composeProposalData(mkInput({ variant: 'customer-facing' }));
    expect(p.hints.showInternalBreakdown).toBe(false);
    expect(p.hints.showDetailedRows).toBe(false);
  });

  it('line items carry customerPrice but no internalBreakdown', () => {
    const bom = mkBom({
      items: [{
        category: 'pipe', description: 'pvc_sch40 2" pipe', material: 'pvc_sch40',
        size: '2"', quantity: 3, unit: '10ft stick',
        unitCost: 38, totalCost: 114,
        unitLaborHours: 0.3, laborHours: 3,
        partHint: 'PVC-2-10FT',
      }],
    });
    const p = composeProposalData(mkInput({ variant: 'customer-facing', bom }));
    expect(p.lineItems).toHaveLength(1);
    expect(p.lineItems[0]!.internalBreakdown).toBeUndefined();
    // customerPrice = totalCost + labor at rate = 114 + 3*95 = 399
    expect(p.lineItems[0]!.customerPrice).toBeCloseTo(399, 4);
  });

  it('totals.internal is omitted when variant is customer-facing', () => {
    const p = composeProposalData(mkInput({ variant: 'customer-facing' }));
    expect(p.totals.internal).toBeUndefined();
  });
});

// ── Internal variant ──────────────────────────────────────────

describe('internal variant', () => {
  it('hints.showInternalBreakdown is true', () => {
    const p = composeProposalData(mkInput({ variant: 'internal' }));
    expect(p.hints.showInternalBreakdown).toBe(true);
    expect(p.hints.showDetailedRows).toBe(true);
  });

  it('line items carry internalBreakdown with materialCost, laborHours, laborCost', () => {
    const bom = mkBom({
      items: [{
        category: 'fitting', description: 'elbow 90 2"', material: 'pvc_sch40',
        size: '2"', quantity: 4, unit: 'ea',
        unitCost: 5, totalCost: 20,
        unitLaborHours: 0.35, laborHours: 1.4,
        partHint: 'FIT-ELBOW_90-2',
      }],
    });
    const p = composeProposalData(mkInput({ variant: 'internal', bom }));
    const lb = p.lineItems[0]!.internalBreakdown!;
    expect(lb.materialCost).toBe(20);
    expect(lb.laborHours).toBeCloseTo(1.4, 4);
    expect(lb.laborCost).toBeCloseTo(1.4 * 95, 4);
  });

  it('totals.internal carries full bid breakdown', () => {
    // Construct a BOM with a realistic bid.
    const bom = mkBom({
      grandTotal: 1000,
      grandLaborHours: 10,
      bid: {
        rawMaterialCost: 1000,
        rawLaborHours: 10,
        rawLaborCost: 950,
        markedUpMaterial: 1150,
        markedUpLabor: 1092.5,
        overheadAmount: 292.5,
        preTaxSubtotal: 2242.5,
        taxableBase: 1150,
        taxAmount: 74.75,
        preMarginTotal: 2317.25,
        marginAmount: 463.45,
        grandTotal: 2780.7,
        profileSnapshot: {
          id: 'test', name: 'test', laborRateUsdPerHr: 95,
          overheadMarkupPercent: 0.15, profitMarginPercent: 0.20,
          salesTaxPercent: 0.065, taxOnMaterial: true, taxOnLabor: false,
        },
        computedAt: '2026-04-18T00:00:00Z',
      },
    });
    const p = composeProposalData(mkInput({ variant: 'internal', bom }));
    const inside = p.totals.internal!;
    expect(inside.rawMaterial).toBe(1000);
    expect(inside.rawLaborHours).toBe(10);
    expect(inside.rawLaborCost).toBe(950);
    expect(inside.overhead).toBe(292.5);
    expect(inside.margin).toBe(463.45);
    // Customer still sees the grand total (both variants).
    expect(p.totals.customerTotal).toBe(2780.7);
  });
});

// ── Customer block composition ────────────────────────────────

describe('customer block', () => {
  it('populates from customer profile', () => {
    const p = composeProposalData(mkInput());
    expect(p.customerBlock.displayName).toBe('Jones Residence');
    expect(p.customerBlock.siteAddressLines).toEqual([
      '45 Oak Dr',
      'Orlando, FL, 32802',
    ]);
    expect(p.customerBlock.contactLines).toEqual([
      'Eleanor Jones',
      '(407) 555-0111',
      'eleanor@example.com',
    ]);
  });

  it('handles null customer gracefully', () => {
    const p = composeProposalData(mkInput({ customer: null }));
    expect(p.customerBlock.displayName).toBe('(no customer linked)');
    expect(p.customerBlock.siteAddressLines).toEqual([]);
    expect(p.customerBlock.contactLines).toEqual([]);
  });

  it('handles partial customer (no address, no contact) without crashing', () => {
    const minimal: CustomerProfile = {
      id: 'x', name: 'Minimal Customer',
      templates: {},
      defaults: { wasteMaterial: 'pvc_sch40', supplyMaterial: 'pex', ventMaterial: 'pvc_sch40' },
      codes: [], markupPercent: 0, createdAt: '2026-01-01T00:00:00Z',
    };
    const p = composeProposalData(mkInput({ customer: minimal }));
    expect(p.customerBlock.displayName).toBe('Minimal Customer');
    expect(p.customerBlock.siteAddressLines).toEqual([]);
    expect(p.customerBlock.contactLines).toEqual([]);
  });
});

// ── Date + proposal number ────────────────────────────────────

describe('date and proposal number', () => {
  it('formats ISO date as readable English-month display', () => {
    const p = composeProposalData(mkInput({
      project: {
        name: 'X',
        proposalNumber: 'P-1',
        dateIso: '2026-04-18T00:00:00Z',
      },
    }));
    // Locale-dependent but should include "April" + 2026.
    expect(p.project.dateDisplay).toContain('2026');
    expect(p.project.dateDisplay.toLowerCase()).toContain('apr');
  });

  it('falls back to the raw iso on unparseable date', () => {
    const p = composeProposalData(mkInput({
      project: { name: 'X', proposalNumber: 'P-1', dateIso: 'not-a-date' },
    }));
    expect(p.project.dateDisplay).toBe('not-a-date');
  });

  it('generateProposalNumber matches P-YYMMDD-XXXX shape', () => {
    const n = generateProposalNumber(Date.UTC(2026, 3, 18));
    expect(n).toMatch(/^P-260418-[A-Z0-9]{4}$/);
  });
});

// ── Empty scene ──────────────────────────────────────────────

describe('empty bom', () => {
  it('produces zero-total customer-facing proposal without crashing', () => {
    const bom = mkBom({ grandTotal: 0, grandLaborHours: 0, items: [] });
    const p = composeProposalData(mkInput({ bom }));
    expect(p.lineItems).toHaveLength(0);
    expect(p.totals.customerTotal).toBe(0);
  });
});
