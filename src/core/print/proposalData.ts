/**
 * proposalData — pure composition of the proposal payload.
 *
 * Takes every datasource the printable proposal needs (contractor
 * profile, active customer, BOM report with bid, proposal number, date)
 * and returns a structured object the layout components render from.
 *
 * Pure function — no React, no Zustand, no `window.print()`. The
 * R3F / DOM integration lives in `printProposal.ts`; this module
 * handles the data shape + customer-facing vs. internal variants so
 * both paths can be unit-tested.
 *
 * Two variants:
 *   • 'customer-facing' — hides overhead / labor-hour / margin detail.
 *     Shows: line-item descriptions + qty + total price; bid total;
 *     labor as a single dollar line; tax as a single line. The
 *     customer sees what they're paying for, not the contractor's cost
 *     structure.
 *   • 'internal' — full breakdown: raw material + raw labor hours +
 *     overhead amount + margin amount + every intermediate number.
 *     Used for the contractor's own records or for bid-review with
 *     a project manager.
 */

import type { BOMReport } from '../../engine/export/BOMExporter';
import type { CustomerProfile } from '@store/customerStore';

// ── Types ──────────────────────────────────────────────────────

export interface ContractorProfile {
  companyName: string;
  contactName: string;
  licenseNumber: string;
  phone: string;
  email: string;
  addressLine1: string;
  addressLine2?: string;
  cityStateZip: string;
  /** Optional base64 data URL of a logo image. */
  logoDataUrl?: string;
  /** Additional contractor-set disclaimers / terms boilerplate. */
  proposalTerms?: string;
}

export type ProposalVariant = 'customer-facing' | 'internal';

export interface ProposalData {
  variant: ProposalVariant;
  contractor: ContractorProfile;
  /** Optional — null when the project has no linked customer yet. */
  customer: CustomerProfile | null;
  project: {
    name: string;
    proposalNumber: string;
    dateIso: string;
    dateDisplay: string;      // "April 18, 2026"
    scopeDescription?: string;
  };
  lineItems: ProposalLineItem[];
  totals: ProposalTotals;
  /** For the "what we already know about you" block. */
  customerBlock: {
    displayName: string;
    siteAddressLines: string[];
    contactLines: string[];  // person name, phone, email
  };
  /** Hints for the renderer. */
  hints: {
    /** Include the full overhead / margin / raw-hours breakdown? */
    showInternalBreakdown: boolean;
    /** Include the individual BOM row totals (material + labor side-by-side)? */
    showDetailedRows: boolean;
  };
}

export interface ProposalLineItem {
  description: string;
  quantity: number;
  unit: string;
  /** Customer-facing: total price only. Internal: item.totalCost + labor $. */
  customerPrice: number;
  /** Present only on internal variant. */
  internalBreakdown?: {
    materialCost: number;
    laborHours: number;
    laborCost: number;
  };
  // ─ Phase 14.G — structural metadata for revision diffing. ──
  // None of these affect the rendered layout; they're carried so
  // `diffProposals()` can match items stably across revisions.
  /** Stable identity when available (e.g. "PVC-SCH40-2-20FT"). */
  partHint?: string;
  /** BOM category ('pipe' | 'fitting' | 'fixture' | …). */
  category?: 'pipe' | 'fitting' | 'fixture' | 'support' | 'misc';
  /** Material key (e.g. "pvc_sch40"). */
  material?: string;
  /** Size string (e.g. "2\"" or "1.5\""). */
  size?: string;
}

export interface ProposalTotals {
  /** Customer-facing figures. */
  customerSubtotal: number;
  customerTax: number;
  customerTotal: number;
  /** Internal-only figures (omitted from the customer variant's display). */
  internal?: {
    rawMaterial: number;
    rawLaborHours: number;
    rawLaborCost: number;
    overhead: number;
    margin: number;
  };
}

// ── Inputs ─────────────────────────────────────────────────────

export interface ComposeProposalInput {
  variant: ProposalVariant;
  contractor: ContractorProfile;
  customer: CustomerProfile | null;
  bom: BOMReport;
  project: {
    name: string;
    proposalNumber: string;
    dateIso: string;
    scopeDescription?: string;
  };
  /** Contractor-facing labor rate for internal breakdowns (sourced
   *  from the bid's profileSnapshot for audit-trail alignment). */
  laborRateUsdPerHr: number;
}

// ── Main ──────────────────────────────────────────────────────

export function composeProposalData(input: ComposeProposalInput): ProposalData {
  const { variant, contractor, customer, bom, project } = input;

  const lineItems = bom.items.map((it) => {
    const laborCost = it.laborHours * input.laborRateUsdPerHr;
    return {
      description: it.description,
      quantity: it.quantity,
      unit: it.unit,
      // Customer-facing price includes THIS line's material + its labor
      // at the configured rate (no overhead/margin — those are applied
      // to the grand total, not per-line).
      customerPrice: it.totalCost + laborCost,
      internalBreakdown: variant === 'internal' ? {
        materialCost: it.totalCost,
        laborHours: it.laborHours,
        laborCost,
      } : undefined,
      // Phase 14.G — carry BOM-level identity so the revision diff
      // can match items stably across snapshots (see proposalRevision.ts).
      partHint: it.partHint,
      category: it.category,
      material: it.material,
      size: it.size,
    } satisfies ProposalLineItem;
  });

  const bid = bom.bid;
  const totals: ProposalTotals = bid
    ? {
        // Customer sees the final tax-inclusive grand total. "Subtotal"
        // on the customer slip is pre-tax, which matches how a
        // retail/service invoice customer is used to reading.
        customerSubtotal: bid.preTaxSubtotal + (bid.profileSnapshot.profitMarginPercent > 0
          ? bid.preTaxSubtotal * bid.profileSnapshot.profitMarginPercent
          : 0),
        customerTax: bid.taxAmount,
        customerTotal: bid.grandTotal,
        internal: variant === 'internal' ? {
          rawMaterial: bid.rawMaterialCost,
          rawLaborHours: bid.rawLaborHours,
          rawLaborCost: bid.rawLaborCost,
          overhead: bid.overheadAmount,
          margin: bid.marginAmount,
        } : undefined,
      }
    : {
        customerSubtotal: bom.grandTotal,
        customerTax: 0,
        customerTotal: bom.grandTotal,
      };

  return {
    variant,
    contractor,
    customer,
    project: {
      ...project,
      dateDisplay: formatDateDisplay(project.dateIso),
    },
    lineItems,
    totals,
    customerBlock: buildCustomerBlock(customer),
    hints: {
      showInternalBreakdown: variant === 'internal',
      showDetailedRows: variant === 'internal',
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────

function buildCustomerBlock(customer: CustomerProfile | null): ProposalData['customerBlock'] {
  if (!customer) {
    return {
      displayName: '(no customer linked)',
      siteAddressLines: [],
      contactLines: [],
    };
  }
  const siteLines: string[] = [];
  if (customer.siteAddress?.street) siteLines.push(customer.siteAddress.street);
  const locBits = [
    customer.siteAddress?.city,
    customer.siteAddress?.state,
    customer.siteAddress?.zip,
  ].filter(Boolean);
  if (locBits.length > 0) siteLines.push(locBits.join(', '));

  const contactLines: string[] = [];
  if (customer.contact?.personName) contactLines.push(customer.contact.personName);
  if (customer.contact?.phone) contactLines.push(customer.contact.phone);
  if (customer.contact?.email) contactLines.push(customer.contact.email);

  return {
    displayName: customer.name,
    siteAddressLines: siteLines,
    contactLines,
  };
}

function formatDateDisplay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Generate a short human-readable proposal number. Defaults to
 * "P-YYMMDD-XXXX" where XXXX is a random 4-char suffix. Pass a custom
 * value if the contractor has their own numbering scheme.
 */
export function generateProposalNumber(nowMs: number = Date.now()): string {
  // UTC-based so contractors submitting across timezones (or test
  // agents in a different zone) see a deterministic proposal number,
  // not drift between "April 17" / "April 18" at late-night boundaries.
  const d = new Date(nowMs);
  const yy = String(d.getUTCFullYear()).slice(2);
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `P-${yy}${mm}${dd}-${rand}`;
}
