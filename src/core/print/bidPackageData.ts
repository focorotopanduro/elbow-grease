/**
 * bidPackageData — Phase 14.AA.2
 *
 * Pure composition of the multi-page BID PACKAGE payload — the
 * "customer-ready deliverable" export the original Python Elbow
 * Grease shipped.
 *
 * A bid package combines four sections behind a single PDF:
 *
 *   1. Cover page — big logo, project title, customer + date,
 *      proposal number
 *   2. Executive summary — scope description + headline totals
 *   3. Itemized BOM — full line-item detail (reuses ProposalData)
 *   4. Compliance summary — list of violations or "design is
 *      code-compliant" seal, suitable for AHJ submittal
 *
 * This module is PURE — no React, no Zustand, no print driver.
 * `composeBidPackage` takes the same inputs as the standard
 * proposal (contractor, customer, pipes, fittings) plus the
 * current compliance report. Returns a `BidPackageData` object
 * the printable component renders.
 */

import type { ProposalData } from './proposalData';
import type { ComplianceViolation } from '../../engine/compliance/ComplianceEngine';

// ── Types ─────────────────────────────────────────────────────

export interface BidPackageComplianceSummary {
  /** True when no critical violations are present. */
  passesCode: boolean;
  /** Count by severity, for the summary table. */
  counts: {
    critical: number;
    warning: number;
    info: number;
  };
  /** Human-readable violation list for the appendix page. */
  violations: BidComplianceRow[];
  /** One-liner for the cover seal ("Design complies with IPC / FBC"). */
  headline: string;
}

export interface BidComplianceRow {
  /** Short human label (from the violation rule). */
  label: string;
  /** Severity tag ('critical' | 'warning' | 'info'). */
  severity: 'critical' | 'warning' | 'info';
  /** Code reference (e.g. "IPC 906.1" / "FBC 314.2.1.1"). */
  codeRef: string;
  /** What + where for the AHJ reviewer. */
  description: string;
}

export interface BidPackageData {
  /** Embedded proposal payload — reuses the existing line-item layout. */
  proposal: ProposalData;
  /** Compliance summary for the appendix page. */
  compliance: BidPackageComplianceSummary;
  /** Cover-page metadata. */
  cover: {
    title: string;
    subtitle: string;
    preparedFor: string;
    preparedBy: string;
    dateDisplay: string;
    proposalNumber: string;
  };
}

// ── Compose ───────────────────────────────────────────────────

export interface ComposeBidPackageInput {
  proposal: ProposalData;
  violations: readonly ComplianceViolation[];
}

/**
 * Pure compose function. Builds the BidPackageData from the
 * current proposal + latest compliance violations.
 */
export function composeBidPackage(
  input: ComposeBidPackageInput,
): BidPackageData {
  const { proposal, violations } = input;

  // Aggregate by severity. Compliance engine uses 'error' | 'warning'
  // | 'info'; the bid package collapses 'error' into 'critical' since
  // that's the plumber-friendly label the AHJ expects.
  const counts = {
    critical: violations.filter((v) => v.severity === 'error').length,
    warning: violations.filter((v) => v.severity === 'warning').length,
    info: violations.filter((v) => v.severity === 'info').length,
  };

  const rows: BidComplianceRow[] = violations.slice(0, 50).map((v) => ({
    label: v.ruleName,
    severity: v.severity === 'error' ? 'critical' : v.severity,
    codeRef: formatCodeRef(v.codeRef),
    description: v.message,
  }));

  const headline = counts.critical > 0
    ? `${counts.critical} code-critical issues — review required before permit submittal`
    : counts.warning > 0
      ? `No code-critical issues. ${counts.warning} warnings flagged for review.`
      : 'Design complies with IPC / FBC — ready for permit submittal';

  const cover = {
    title: proposal.project.name || 'Plumbing Project',
    subtitle: proposal.variant === 'customer-facing'
      ? 'Project Proposal'
      : 'Internal Bid Breakdown',
    preparedFor: proposal.customerBlock.displayName,
    preparedBy: proposal.contractor.companyName,
    dateDisplay: proposal.project.dateDisplay,
    proposalNumber: proposal.project.proposalNumber,
  };

  return {
    proposal,
    compliance: {
      passesCode: counts.critical === 0,
      counts,
      violations: rows,
      headline,
    },
    cover,
  };
}

// ── Helpers ───────────────────────────────────────────────────

function formatCodeRef(
  codeRef: unknown,
): string {
  if (!codeRef || typeof codeRef !== 'object') return '';
  const ref = codeRef as { section?: string; code?: string; table?: string };
  const parts: string[] = [];
  if (ref.code) parts.push(ref.code);
  if (ref.section) parts.push(ref.section);
  if (ref.table) parts.push(`(${ref.table})`);
  return parts.join(' ');
}
