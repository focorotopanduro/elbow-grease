/**
 * contractorLibrary — Phase 14.J tests.
 *
 * Covers:
 *   • buildLibrary / serializeLibrary round-trip via parseLibrary
 *   • parseLibrary rejects: bad JSON, wrong magic, future version
 *   • summarizeLibrary counts templates, revisions, and detects each section
 *   • mergeLibrary: per-section inclusion via `plan.sections`
 *   • mergeLibrary strategies: replace / skip / keep-both on templates
 *   • mergeLibrary revisions append-without-duplicating
 *   • suggestExportFilename formatting
 */

import { describe, it, expect } from 'vitest';
import {
  buildLibrary,
  serializeLibrary,
  parseLibrary,
  summarizeLibrary,
  mergeLibrary,
  suggestExportFilename,
  LIBRARY_FILE_MAGIC,
  LIBRARY_SCHEMA_VERSION,
  type ContractorLibrary,
  type MergeState,
  type MergePlan,
} from '../contractorLibrary';
import type { ContractorProfile } from '@core/print/proposalData';
import type { PricingProfile } from '../../../engine/export/computeBid';
import type { AssemblyTemplate } from '@core/templates/assemblyTemplate';
import type { SavedRevision } from '@core/print/proposalRevision';

// ── Fixtures ──────────────────────────────────────────────────

function mkContractor(overrides: Partial<ContractorProfile> = {}): ContractorProfile {
  return {
    companyName: 'Beit Building',
    contactName: 'Test',
    licenseNumber: 'CFC1',
    phone: '',
    email: '',
    addressLine1: '',
    cityStateZip: '',
    ...overrides,
  };
}

function mkPricing(overrides: Partial<PricingProfile> = {}): PricingProfile {
  return {
    id: 'default',
    name: 'FL Residential Default',
    laborRateUsdPerHr: 95,
    overheadMarkupPercent: 0.15,
    profitMarginPercent: 0.20,
    salesTaxPercent: 0.065,
    taxOnMaterial: true,
    taxOnLabor: false,
    ...overrides,
  };
}

function mkTemplate(id: string, name: string): AssemblyTemplate {
  return {
    id,
    name,
    createdAt: '2026-04-18T00:00:00.000Z',
    pipes: [],
    fixtures: [],
    extents: { width: 0, depth: 0, height: 0 },
    counts: { pipes: 0, fixtures: 0 },
  };
}

function mkRevision(base: string, idx: number): SavedRevision {
  return {
    id: `${base}|R${idx}`,
    baseNumber: base,
    revisionNumber: `R${idx}`,
    revisionIndex: idx,
    savedAtIso: '2026-04-18T00:00:00.000Z',
    data: {
      variant: 'customer-facing',
      contractor: mkContractor(),
      customer: null,
      project: { name: 'x', proposalNumber: base, dateIso: '', dateDisplay: '' },
      lineItems: [],
      totals: { customerSubtotal: 0, customerTax: 0, customerTotal: 0 },
      customerBlock: { displayName: '', siteAddressLines: [], contactLines: [] },
      hints: { showInternalBreakdown: false, showDetailedRows: false },
    },
  };
}

// ── buildLibrary + serialize ─────────────────────────────────

describe('buildLibrary', () => {
  it('embeds magic + version', () => {
    const lib = buildLibrary({ exportedAt: '2026-04-18T00:00:00.000Z' });
    expect(lib.magic).toBe(LIBRARY_FILE_MAGIC);
    expect(lib.version).toBe(LIBRARY_SCHEMA_VERSION);
    expect(lib.exportedAt).toBe('2026-04-18T00:00:00.000Z');
  });

  it('omits absent sections', () => {
    const lib = buildLibrary({ exportedAt: '2026-04-18T00:00:00.000Z' });
    expect(lib.contractorProfile).toBeUndefined();
    expect(lib.pricingProfile).toBeUndefined();
    expect(lib.templates).toBeUndefined();
    expect(lib.revisions).toBeUndefined();
  });

  it('carries every provided section', () => {
    const lib = buildLibrary({
      exportedAt: '2026-04-18T00:00:00.000Z',
      contractorProfile: mkContractor(),
      pricingProfile: mkPricing(),
      templates: { order: ['t1'], byId: { t1: mkTemplate('t1', 'A') } },
      revisions: { byBase: { 'P-1': [mkRevision('P-1', 1)] } },
      label: 'pre-rate-bump',
    });
    expect(lib.contractorProfile).toBeDefined();
    expect(lib.pricingProfile).toBeDefined();
    expect(lib.templates?.order).toEqual(['t1']);
    expect(lib.revisions?.byBase['P-1']).toHaveLength(1);
    expect(lib.label).toBe('pre-rate-bump');
  });
});

// ── parseLibrary ─────────────────────────────────────────────

describe('parseLibrary', () => {
  it('round-trips via serialize', () => {
    const lib = buildLibrary({
      exportedAt: '2026-04-18T00:00:00.000Z',
      contractorProfile: mkContractor(),
    });
    const json = serializeLibrary(lib);
    const parsed = parseLibrary(json);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.library.contractorProfile?.companyName).toBe('Beit Building');
    }
  });

  it('rejects bad JSON', () => {
    const r = parseLibrary('{not json');
    expect(r.ok).toBe(false);
  });

  it('rejects wrong magic', () => {
    const r = parseLibrary(JSON.stringify({ magic: 'other', version: 1, exportedAt: '' }));
    expect(r.ok).toBe(false);
  });

  it('rejects missing version', () => {
    const r = parseLibrary(JSON.stringify({ magic: LIBRARY_FILE_MAGIC, exportedAt: '' }));
    expect(r.ok).toBe(false);
  });

  it('rejects future version', () => {
    const r = parseLibrary(JSON.stringify({
      magic: LIBRARY_FILE_MAGIC,
      version: 999,
      exportedAt: '2026-04-18T00:00:00.000Z',
    }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain('999');
    }
  });

  it('rejects non-string exportedAt', () => {
    const r = parseLibrary(JSON.stringify({
      magic: LIBRARY_FILE_MAGIC,
      version: 1,
      exportedAt: 123,
    }));
    expect(r.ok).toBe(false);
  });
});

// ── summarizeLibrary ─────────────────────────────────────────

describe('summarizeLibrary', () => {
  it('reports empty sections', () => {
    const lib = buildLibrary({ exportedAt: '2026-04-18T00:00:00.000Z' });
    const s = summarizeLibrary(lib);
    expect(s.hasContractorProfile).toBe(false);
    expect(s.hasPricingProfile).toBe(false);
    expect(s.templateCount).toBe(0);
    expect(s.revisionProposalCount).toBe(0);
    expect(s.revisionTotalCount).toBe(0);
  });

  it('counts templates + revisions correctly', () => {
    const lib = buildLibrary({
      exportedAt: '2026-04-18T00:00:00.000Z',
      contractorProfile: mkContractor(),
      pricingProfile: mkPricing(),
      templates: { order: ['t1', 't2'], byId: { t1: mkTemplate('t1', 'A'), t2: mkTemplate('t2', 'B') } },
      revisions: {
        byBase: {
          'P-1': [mkRevision('P-1', 1), mkRevision('P-1', 2)],
          'P-2': [mkRevision('P-2', 1)],
        },
      },
      label: 'test',
    });
    const s = summarizeLibrary(lib);
    expect(s.hasContractorProfile).toBe(true);
    expect(s.contractorCompanyName).toBe('Beit Building');
    expect(s.hasPricingProfile).toBe(true);
    expect(s.pricingProfileName).toBe('FL Residential Default');
    expect(s.templateCount).toBe(2);
    expect(s.revisionProposalCount).toBe(2);
    expect(s.revisionTotalCount).toBe(3);
    expect(s.label).toBe('test');
  });
});

// ── mergeLibrary — section inclusion ─────────────────────────

describe('mergeLibrary — section inclusion', () => {
  const current: MergeState = {};
  const incoming: ContractorLibrary = buildLibrary({
    exportedAt: '2026-04-18T00:00:00.000Z',
    contractorProfile: mkContractor({ companyName: 'New Co' }),
    pricingProfile: mkPricing({ name: 'New Pricing' }),
    templates: { order: ['t1'], byId: { t1: mkTemplate('t1', 'A') } },
    revisions: { byBase: { 'P-1': [mkRevision('P-1', 1)] } },
  });

  it('only merges included sections', () => {
    const plan: MergePlan = {
      sections: { templates: true },
      strategyByKind: {},
    };
    const { next } = mergeLibrary(current, incoming, plan);
    expect(next.contractorProfile).toBeUndefined();
    expect(next.pricingProfile).toBeUndefined();
    expect(next.templates?.byId['t1']).toBeDefined();
    expect(next.revisions).toBeUndefined();
  });

  it('merges all sections when all enabled', () => {
    const plan: MergePlan = {
      sections: { contractorProfile: true, pricingProfile: true, templates: true, revisions: true },
      strategyByKind: {},
    };
    const { next, report } = mergeLibrary(current, incoming, plan);
    expect(next.contractorProfile?.companyName).toBe('New Co');
    expect(next.pricingProfile?.name).toBe('New Pricing');
    expect(report.contractorProfileReplaced).toBe(true);
    expect(report.pricingProfileReplaced).toBe(true);
    expect(report.templates.added).toBe(1);
    expect(report.revisions.basesAdded).toBe(1);
  });
});

// ── mergeLibrary — conflict strategies ───────────────────────

describe('mergeLibrary — template strategies', () => {
  const current: MergeState = {
    templates: {
      order: ['t1'],
      byId: { t1: mkTemplate('t1', 'Local original') },
    },
  };

  const incoming: ContractorLibrary = buildLibrary({
    exportedAt: '2026-04-18T00:00:00.000Z',
    templates: {
      order: ['t1', 't2'],
      byId: {
        t1: mkTemplate('t1', 'Incoming copy'),
        t2: mkTemplate('t2', 'Brand new'),
      },
    },
  });

  it('replace: overwrites existing + adds new', () => {
    const { next, report } = mergeLibrary(current, incoming, {
      sections: { templates: true },
      strategyByKind: { templates: 'replace' },
    });
    expect(next.templates?.byId['t1']?.name).toBe('Incoming copy');
    expect(next.templates?.byId['t2']?.name).toBe('Brand new');
    expect(report.templates).toEqual({ added: 1, replaced: 1, skipped: 0, renamed: 0 });
  });

  it('skip: leaves existing, drops incoming for conflicts + adds new', () => {
    const { next, report } = mergeLibrary(current, incoming, {
      sections: { templates: true },
      strategyByKind: { templates: 'skip' },
    });
    expect(next.templates?.byId['t1']?.name).toBe('Local original');
    expect(next.templates?.byId['t2']?.name).toBe('Brand new');
    expect(report.templates).toEqual({ added: 1, replaced: 0, skipped: 1, renamed: 0 });
  });

  it('keep-both: renames incoming copy with "(imported)" suffix', () => {
    const { next, report } = mergeLibrary(current, incoming, {
      sections: { templates: true },
      strategyByKind: { templates: 'keep-both' },
    });
    expect(next.templates?.byId['t1']?.name).toBe('Local original');
    const imported = Object.values(next.templates?.byId ?? {}).find(
      (t) => t.name === 'Incoming copy (imported)',
    );
    expect(imported).toBeDefined();
    expect(imported?.id).not.toBe('t1');
    expect(report.templates.renamed).toBe(1);
    expect(report.templates.added).toBe(1); // t2 still added fresh
  });
});

// ── mergeLibrary — revisions ─────────────────────────────────

describe('mergeLibrary — revisions', () => {
  const current: MergeState = {
    revisions: {
      byBase: {
        'P-A': [mkRevision('P-A', 1), mkRevision('P-A', 2)],
      },
    },
  };

  const incoming: ContractorLibrary = buildLibrary({
    exportedAt: '2026-04-18T00:00:00.000Z',
    revisions: {
      byBase: {
        'P-A': [mkRevision('P-A', 2), mkRevision('P-A', 3)], // R2 collides
        'P-B': [mkRevision('P-B', 1)],
      },
    },
  });

  it('adds new bases, extends existing with non-conflicting revisions', () => {
    const { next, report } = mergeLibrary(current, incoming, {
      sections: { revisions: true },
      strategyByKind: { revisions: 'skip' },
    });
    // P-A gets R3 (new); R2 collision is skipped.
    expect(next.revisions?.byBase['P-A']?.map((r) => r.revisionNumber)).toEqual(['R1', 'R2', 'R3']);
    expect(next.revisions?.byBase['P-B']?.map((r) => r.revisionNumber)).toEqual(['R1']);
    expect(report.revisions.basesAdded).toBe(1);      // P-B
    expect(report.revisions.snapshotsAdded).toBe(2);  // P-B/R1 + P-A/R3
    expect(report.revisions.snapshotsSkipped).toBe(1); // P-A/R2 collision
  });

  it('replace: overwrites a colliding revision snapshot', () => {
    const { report } = mergeLibrary(current, incoming, {
      sections: { revisions: true },
      strategyByKind: { revisions: 'replace' },
    });
    expect(report.revisions.snapshotsReplaced).toBe(1);
    expect(report.revisions.snapshotsSkipped).toBe(0);
  });
});

// ── Immutability ─────────────────────────────────────────────

describe('mergeLibrary — does not mutate inputs', () => {
  it('leaves the current state intact', () => {
    const current: MergeState = {
      templates: { order: ['t1'], byId: { t1: mkTemplate('t1', 'Original') } },
    };
    const incoming = buildLibrary({
      exportedAt: '2026-04-18T00:00:00.000Z',
      templates: { order: ['t1'], byId: { t1: mkTemplate('t1', 'Imported') } },
    });
    mergeLibrary(current, incoming, {
      sections: { templates: true },
      strategyByKind: { templates: 'replace' },
    });
    expect(current.templates?.byId['t1']?.name).toBe('Original');
  });
});

// ── Filename helper ──────────────────────────────────────────

describe('suggestExportFilename', () => {
  it('uses library-<date> when no tag given', () => {
    expect(suggestExportFilename(undefined, '2026-04-18T12:34:56Z')).toBe('library-2026-04-18.elbowlib.json');
  });

  it('sanitizes tag, joins with date', () => {
    expect(suggestExportFilename('pre rate/bump', '2026-04-18T00:00:00Z'))
      .toBe('pre_rate_bump-2026-04-18.elbowlib.json');
  });

  it('handles empty tag identically to undefined', () => {
    expect(suggestExportFilename('', '2026-04-18T00:00:00Z')).toBe('library-2026-04-18.elbowlib.json');
  });
});
