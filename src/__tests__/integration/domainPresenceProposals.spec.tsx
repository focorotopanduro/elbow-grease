/**
 * Integration: domain-presence gating of the Printable* components.
 *
 * Phase 5 (ARCHITECTURE.md §4.8). For each of `PrintableProposal`,
 * `PrintableBidPackage`, and `PrintableChangeOrder`, seed one of
 * the three presence configurations (plumbing-only / roofing-only
 * / both) and verify the rendered DOM:
 *
 *   • Always-on sections (header / customer block / scope /
 *     signatures / terms) render regardless of presence.
 *   • Plumbing-scoped sections are present iff `presence.plumbing`.
 *   • Roofing-only jobs produce ZERO plumbing output — no
 *     headings, no tables, no empty-state placeholder rows.
 *
 * Rather than boot the actual orchestrator (which calls
 * `window.print()` and depends on the live BOM pipeline), the
 * tests set the print stores directly with synthetic payloads
 * and render the Printable components standalone via
 * @testing-library/react. This exercises the render path that
 * the real print pipeline would otherwise flow into.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PrintableProposal } from '@ui/print/PrintableProposal';
import { PrintableBidPackage } from '@ui/print/PrintableBidPackage';
import { PrintableChangeOrder } from '@ui/print/PrintableChangeOrder';
import { usePrintStore } from '@core/print/printProposal';
import { usePrintBidPackageStore } from '@core/print/printBidPackage';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { useManifoldStore } from '@store/manifoldStore';
import { useRoofStore } from '@store/roofStore';
import type { ProposalData } from '@core/print/proposalData';
import type { BidPackageData } from '@core/print/bidPackageData';
import type { ChangeOrderPrintData } from '@core/print/printChangeOrder';
import { emptyRoofSnapshot } from '@engine/roofing/RoofGraph';

// ── Store seeding helpers ─────────────────────────────────────

function resetDomainStores() {
  usePipeStore.setState({
    pipes: {}, pipeOrder: [], selectedId: null,
    undoStack: [], redoStack: [], pivotSession: null,
  });
  useFixtureStore.setState({ fixtures: {}, selectedFixtureId: null });
  useManifoldStore.setState({ manifolds: {}, order: [], selectedId: null });
  useRoofStore.setState({
    sections: {}, sectionOrder: [],
    vertices: {}, measures: {}, layers: [],
    pdf: emptyRoofSnapshot().pdf,
    selectedSectionId: null,
    penetrations: {}, penetrationOrder: [],
    undoStack: [], redoStack: [], batchDepth: 0, dirtyDuringBatch: false,
  });
}

function seedPlumbing() {
  usePipeStore.setState({
    pipes: {
      p1: {
        id: 'p1', points: [[0, 0, 0], [5, 0, 0]], diameter: 2,
        material: 'pvc_sch40', system: 'waste', color: '#ef5350',
        visible: true, selected: false,
      },
    },
    pipeOrder: ['p1'],
    selectedId: null, undoStack: [], redoStack: [], pivotSession: null,
  });
}

function seedRoofing() {
  useRoofStore.getState().addSection({ x: 0, y: 0, length: 20, run: 15 });
}

// ── Synthetic print payloads ──────────────────────────────────

function fakeProposal(): ProposalData {
  return {
    variant: 'customer-facing',
    contractor: {
      companyName: 'Test Plumbing Co',
      contactName: 'Pat Contractor',
      licenseNumber: 'CFC12345',
      phone: '555-0100',
      email: 'pat@test.co',
      addressLine1: '1 Main St',
      cityStateZip: 'Orlando, FL 32801',
    },
    customer: null,
    project: {
      name: 'Test Project',
      proposalNumber: 'P-260423-TEST',
      dateIso: '2026-04-23',
      dateDisplay: 'April 23, 2026',
      scopeDescription: 'Trace me: a rough-in re-pipe.',
    },
    lineItems: [
      {
        description: 'PVC pipe 2" × 10 ft',
        quantity: 1, unit: 'length',
        customerPrice: 42,
        partHint: 'PVC-SCH40-2-10FT',
        category: 'pipe',
        material: 'pvc_sch40',
        size: '2"',
      },
    ],
    totals: {
      customerSubtotal: 42,
      customerTax: 3,
      customerTotal: 45,
    },
    customerBlock: {
      displayName: '(no customer linked)',
      siteAddressLines: [],
      contactLines: [],
    },
    hints: {
      showInternalBreakdown: false,
      showDetailedRows: false,
    },
  };
}

function fakeBidPackage(): BidPackageData {
  return {
    proposal: fakeProposal(),
    compliance: {
      passesCode: true,
      counts: { critical: 0, warning: 0, info: 0 },
      violations: [],
      headline: 'Design complies with IPC / FBC',
    },
    cover: {
      title: 'Test Project',
      subtitle: 'Customer-Ready Bid Package',
      preparedFor: 'Test Customer',
      preparedBy: 'Test Plumbing Co',
      dateDisplay: 'April 23, 2026',
      proposalNumber: 'P-260423-TEST',
    },
  };
}

function fakeChangeOrder(): ChangeOrderPrintData {
  const base = fakeProposal();
  return {
    baseNumber: 'P-260423-TEST',
    fromRevision: {
      id: 'P-260423-TEST|R1',
      baseNumber: 'P-260423-TEST',
      revisionNumber: 'R1',
      revisionIndex: 1,
      savedAtIso: '2026-04-20T00:00:00Z',
      note: 'Original',
      data: base,
    },
    toRevision: {
      id: 'P-260423-TEST|R2',
      baseNumber: 'P-260423-TEST',
      revisionNumber: 'R2',
      revisionIndex: 2,
      savedAtIso: '2026-04-22T00:00:00Z',
      note: 'Revised',
      data: base,
    },
    diff: {
      fromRevision: 'R1',
      toRevision: 'R2',
      deltas: [],
      totals: {
        customerSubtotalDelta: 0,
        customerTaxDelta: 0,
        customerTotalDelta: 0,
      },
      metadataChanges: {
        customerChanged: false,
        contractorChanged: false,
        scopeChanged: false,
      },
      summary: {
        lineItemsAdded: 0,
        lineItemsRemoved: 0,
        lineItemsChanged: 0,
        netMaterialDelta: 0,
        netLaborHoursDelta: 0,
        netBidDelta: 0,
      },
    },
    summary: ['No material changes.'],
    generatedAtIso: '2026-04-23T00:00:00Z',
    dateDisplay: 'April 23, 2026',
  };
}

// ── Shared setup ──────────────────────────────────────────────

beforeEach(() => {
  resetDomainStores();
  usePrintStore.setState({ proposal: null, changeOrder: null });
  usePrintBidPackageStore.setState({ bidPackage: null });
});

afterEach(() => {
  cleanup();
});

// ── PrintableProposal ─────────────────────────────────────────

describe('PrintableProposal — domain-presence gating (ARCHITECTURE.md §4.8)', () => {
  it('plumbing-only: renders the plumbing BOM section + totals', () => {
    seedPlumbing();
    usePrintStore.setState({ proposal: fakeProposal(), changeOrder: null });
    const { container } = render(<PrintableProposal />);

    // Always-on sections render.
    expect(container.querySelector('.pp-header')).toBeTruthy();
    expect(container.querySelector('.pp-signatures')).toBeTruthy();
    // Plumbing section + totals render.
    expect(container.querySelector('.pp-items')).toBeTruthy();
    expect(container.querySelector('.pp-totals')).toBeTruthy();
  });

  it('roofing-only: ZERO plumbing output (no heading, no table, no empty-state row)', () => {
    seedRoofing();
    usePrintStore.setState({ proposal: fakeProposal(), changeOrder: null });
    const { container } = render(<PrintableProposal />);

    // Always-on sections still render.
    expect(container.querySelector('.pp-header')).toBeTruthy();
    expect(container.querySelector('.pp-signatures')).toBeTruthy();

    // No plumbing BOM section.
    expect(container.querySelector('.pp-items')).toBeNull();
    // No "(No line items — scene is empty)" placeholder.
    expect(container.textContent).not.toContain('No line items');
    // No "Materials & Labor" heading.
    expect(container.textContent).not.toContain('Materials & Labor');
  });

  it('both domains: plumbing section present (roofing rendering is feature work)', () => {
    seedPlumbing();
    seedRoofing();
    usePrintStore.setState({ proposal: fakeProposal(), changeOrder: null });
    const { container } = render(<PrintableProposal />);

    expect(container.querySelector('.pp-items')).toBeTruthy();
    expect(container.querySelector('.pp-totals')).toBeTruthy();
  });

  it('neither domain: header + customer + signatures + terms still render; no crash', () => {
    // Don't seed any domain store; pure empty-project case.
    usePrintStore.setState({ proposal: fakeProposal(), changeOrder: null });
    const { container } = render(<PrintableProposal />);

    expect(container.querySelector('.pp-header')).toBeTruthy();
    expect(container.querySelector('.pp-signatures')).toBeTruthy();
    expect(container.querySelector('.pp-items')).toBeNull();
    expect(container.querySelector('.pp-totals')).toBeNull();
  });
});

// ── PrintableBidPackage ───────────────────────────────────────

describe('PrintableBidPackage — domain-presence gating', () => {
  it('plumbing-only: cover + scope + BOM + compliance + terms all render', () => {
    seedPlumbing();
    usePrintBidPackageStore.setState({ bidPackage: fakeBidPackage() });
    const { container } = render(<PrintableBidPackage />);

    // Always-on.
    expect(container.querySelector('.bid-cover')).toBeTruthy();
    expect(container.querySelector('.bid-terms')).toBeTruthy();
    // Plumbing-gated pages.
    expect(container.querySelector('.bid-scope')).toBeTruthy();
    expect(container.querySelector('.bid-items')).toBeTruthy();
    expect(container.querySelector('.bid-compliance')).toBeTruthy();
  });

  it('roofing-only: cover + terms only; no plumbing scope/items/compliance pages', () => {
    seedRoofing();
    usePrintBidPackageStore.setState({ bidPackage: fakeBidPackage() });
    const { container } = render(<PrintableBidPackage />);

    expect(container.querySelector('.bid-cover')).toBeTruthy();
    expect(container.querySelector('.bid-terms')).toBeTruthy();

    // Absent plumbing pages.
    expect(container.querySelector('.bid-scope')).toBeNull();
    expect(container.querySelector('.bid-items')).toBeNull();
    expect(container.querySelector('.bid-compliance')).toBeNull();

    // And none of the heading text leaks through.
    expect(container.textContent).not.toContain('Itemized Bill of Materials');
    expect(container.textContent).not.toContain('Code Compliance Summary');
  });

  it('both: all plumbing pages render (roofing pages are future feature work)', () => {
    seedPlumbing();
    seedRoofing();
    usePrintBidPackageStore.setState({ bidPackage: fakeBidPackage() });
    const { container } = render(<PrintableBidPackage />);

    expect(container.querySelector('.bid-scope')).toBeTruthy();
    expect(container.querySelector('.bid-items')).toBeTruthy();
    expect(container.querySelector('.bid-compliance')).toBeTruthy();
  });
});

// ── PrintableChangeOrder ──────────────────────────────────────

describe('PrintableChangeOrder — domain-presence gating', () => {
  it('plumbing-only: reference + summary + change-table + totals-delta render', () => {
    seedPlumbing();
    usePrintStore.setState({ proposal: null, changeOrder: fakeChangeOrder() });
    const { container } = render(<PrintableChangeOrder />);

    // Always-on.
    expect(container.querySelector('.co-header')).toBeTruthy();
    expect(container.querySelector('.co-parties')).toBeTruthy();
    // Plumbing-gated.
    expect(container.querySelector('.co-reference')).toBeTruthy();
    expect(container.querySelector('.co-summary')).toBeTruthy();
    expect(container.querySelector('.co-changes')).toBeTruthy();
    expect(container.querySelector('.co-totals')).toBeTruthy();
  });

  it('roofing-only: header + parties + signatures + terms only; zero plumbing delta output', () => {
    seedRoofing();
    usePrintStore.setState({ proposal: null, changeOrder: fakeChangeOrder() });
    const { container } = render(<PrintableChangeOrder />);

    expect(container.querySelector('.co-header')).toBeTruthy();
    expect(container.querySelector('.co-parties')).toBeTruthy();

    expect(container.querySelector('.co-reference')).toBeNull();
    expect(container.querySelector('.co-summary')).toBeNull();
    expect(container.querySelector('.co-changes')).toBeNull();
    expect(container.querySelector('.co-totals')).toBeNull();

    // Text leakage guards.
    expect(container.textContent).not.toContain('Summary of Changes');
    expect(container.textContent).not.toContain('Net Total Impact');
  });

  it('both domains: change-order plumbing sections render', () => {
    seedPlumbing();
    seedRoofing();
    usePrintStore.setState({ proposal: null, changeOrder: fakeChangeOrder() });
    const { container } = render(<PrintableChangeOrder />);

    expect(container.querySelector('.co-reference')).toBeTruthy();
    expect(container.querySelector('.co-changes')).toBeTruthy();
  });
});
