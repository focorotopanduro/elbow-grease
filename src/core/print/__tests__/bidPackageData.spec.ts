/**
 * bidPackageData — Phase 14.AA.2 tests.
 *
 * Covers the pure compose logic: counts by severity, headline
 * messaging branch, cover-page fields, violation-row transformation.
 */

import { describe, it, expect } from 'vitest';
import { composeBidPackage } from '../bidPackageData';
import type { ProposalData } from '../proposalData';
import type { ComplianceViolation } from '../../../engine/compliance/ComplianceEngine';

// ── Fixture ───────────────────────────────────────────────────

function mkProposal(): ProposalData {
  return {
    variant: 'customer-facing',
    contractor: {
      companyName: 'Acme Plumbing LLC',
      contactName: 'Jane Contractor',
      licenseNumber: 'CFC-12345',
      phone: '555-1212',
      email: 'j@acme',
      addressLine1: '1 Main St',
      cityStateZip: 'Orlando, FL 32801',
      proposalTerms: 'Terms: payment net 30.',
    },
    customer: null,
    project: {
      name: 'Smith Residence',
      proposalNumber: '20260419-001',
      dateIso: '2026-04-19T00:00:00Z',
      dateDisplay: 'April 19, 2026',
      scopeDescription: 'Rough-in + trim for a 2-bath renovation.',
    },
    lineItems: [],
    totals: {
      customerSubtotal: 1000,
      customerTax: 80,
      customerTotal: 1080,
    },
    customerBlock: {
      displayName: 'John Smith',
      siteAddressLines: ['456 Oak Ln'],
      contactLines: ['John Smith'],
    },
    hints: {
      showInternalBreakdown: false,
      showDetailedRows: true,
    },
  };
}

function mkViolation(
  severity: ComplianceViolation['severity'],
  ruleName: string,
  message = 'something wrong',
): ComplianceViolation {
  return {
    ruleId: 'IPC-704',
    ruleName,
    codeRef: { code: 'IPC', section: '704.1' } as any,
    severity,
    cost: 0,
    message,
    entityId: 'p1',
    entityType: 'edge',
    remediations: [],
  };
}

// ── composeBidPackage ────────────────────────────────────────

describe('composeBidPackage — clean design', () => {
  it('no violations → passesCode = true + permit-submittal headline', () => {
    const bp = composeBidPackage({ proposal: mkProposal(), violations: [] });
    expect(bp.compliance.passesCode).toBe(true);
    expect(bp.compliance.counts).toEqual({ critical: 0, warning: 0, info: 0 });
    expect(bp.compliance.violations).toEqual([]);
    expect(bp.compliance.headline).toContain('Design complies');
  });

  it('cover page fields mirror proposal + contractor', () => {
    const bp = composeBidPackage({ proposal: mkProposal(), violations: [] });
    expect(bp.cover.title).toBe('Smith Residence');
    expect(bp.cover.preparedBy).toBe('Acme Plumbing LLC');
    expect(bp.cover.preparedFor).toBe('John Smith');
    expect(bp.cover.proposalNumber).toBe('20260419-001');
    expect(bp.cover.subtitle).toBe('Project Proposal'); // customer-facing variant
  });

  it('internal-variant proposal → cover subtitle reflects it', () => {
    const p = mkProposal();
    p.variant = 'internal';
    const bp = composeBidPackage({ proposal: p, violations: [] });
    expect(bp.cover.subtitle).toContain('Internal');
  });
});

describe('composeBidPackage — with violations', () => {
  it('single critical error → passesCode = false + count = 1', () => {
    const v = mkViolation('error', 'Min drainage slope');
    const bp = composeBidPackage({ proposal: mkProposal(), violations: [v] });
    expect(bp.compliance.passesCode).toBe(false);
    expect(bp.compliance.counts.critical).toBe(1);
    expect(bp.compliance.violations[0]!.severity).toBe('critical');
    expect(bp.compliance.headline).toContain('code-critical');
  });

  it('warning-only → passesCode true, headline mentions warnings', () => {
    const v = mkViolation('warning', 'Max supply velocity');
    const bp = composeBidPackage({ proposal: mkProposal(), violations: [v] });
    expect(bp.compliance.passesCode).toBe(true);
    expect(bp.compliance.counts.warning).toBe(1);
    expect(bp.compliance.headline).toContain('warnings flagged');
  });

  it('severity tri-count matches violation breakdown', () => {
    const violations: ComplianceViolation[] = [
      mkViolation('error', 'A'),
      mkViolation('error', 'B'),
      mkViolation('warning', 'C'),
      mkViolation('info', 'D'),
    ];
    const bp = composeBidPackage({ proposal: mkProposal(), violations });
    expect(bp.compliance.counts).toEqual({ critical: 2, warning: 1, info: 1 });
  });

  it('violation rows capped at 50 even when many violations exist', () => {
    const violations: ComplianceViolation[] = [];
    for (let i = 0; i < 80; i++) {
      violations.push(mkViolation('error', `Rule ${i}`));
    }
    const bp = composeBidPackage({ proposal: mkProposal(), violations });
    expect(bp.compliance.violations).toHaveLength(50);
    expect(bp.compliance.counts.critical).toBe(80); // full count is preserved
  });

  it('violation row carries rule label + severity + code ref + message', () => {
    const v = mkViolation('error', 'Trap arm too long', 'Trap arm 8 ft exceeds max 5 ft');
    const bp = composeBidPackage({ proposal: mkProposal(), violations: [v] });
    const row = bp.compliance.violations[0]!;
    expect(row.label).toBe('Trap arm too long');
    expect(row.severity).toBe('critical');
    expect(row.codeRef).toContain('704.1'); // from our fixture
    expect(row.description).toContain('8 ft');
  });
});
