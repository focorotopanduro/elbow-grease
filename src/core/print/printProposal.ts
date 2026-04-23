/**
 * printProposal — orchestrates the "show hidden layout → print" flow.
 *
 * Architecture:
 *   The PrintableProposal component is always mounted but normally
 *   rendered with `display: none` via CSS (`body:not(.printing)
 *   .printable-proposal { display: none }`).
 *
 *   When the user clicks "Export Proposal PDF":
 *     1. Compose the proposal data (pure; tested in isolation).
 *     2. Set `body.classList.add('printing')` so the printable layout
 *        becomes visible and the rest of the app hides.
 *     3. Wait one frame for the DOM to paint the new layout.
 *     4. Call `window.print()` — browser opens its print dialog.
 *     5. Whichever path: dialog confirmed OR cancelled, restore the
 *        body class so the app comes back.
 *
 * Why this shape instead of a JS PDF library:
 *   • Zero bundle cost — no jsPDF / pdfmake / react-pdf dep.
 *   • Full CSS control: title block, typography, signature lines.
 *   • Tauri's native print dialog offers "Save as PDF" on every OS.
 *   • Users already know "File → Print → Save as PDF" as a workflow.
 *
 * See ADR 033 for the decision rationale.
 */

import { create } from 'zustand';
import { logger } from '@core/logger/Logger';
import { composeProposalData, type ProposalData, type ProposalVariant, generateProposalNumber } from './proposalData';
import { getActiveContractorProfile } from '@store/contractorProfileStore';
import { getActivePricingProfile } from '@store/pricingStore';
import { useCustomerStore } from '@store/customerStore';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { generateAllFittings } from '@ui/pipe/FittingGenerator';
import { generateBOM } from '../../engine/export/BOMExporter';
// Phase 14.D — auto-plan p-traps + cleanouts so the proposal's
// material list + labor hours reflect real install cost.
import { planPTrapsAndCleanouts, planToFittings } from '@core/compliance/pTrapCleanoutPlanner';
// Phase 14.H — per-material hanger plan drives the support lines
// instead of BOMExporter's flat 4-ft rollup.
import { planHangers, planToBOMItems as planHangerBOMItems } from '@core/compliance/hangerPlanner';
// Phase 14.G — auto-save a revision snapshot on every print.
import { useProposalRevisionStore } from '@store/proposalRevisionStore';
import { nextRevisionNumber } from '@core/print/proposalRevision';

const log = logger('PrintProposal');

// ── Print-mode state (consumed by PrintableProposal) ──────────

interface PrintState {
  /** Currently staged proposal data. Null when no print is in progress. */
  proposal: ProposalData | null;
  /**
   * Phase 14.G — currently staged change order (revision diff). Null
   * when no change-order print is active. Only one of `proposal` /
   * `changeOrder` is set at a time; the matching Printable* component
   * subscribes to its own slot.
   */
  changeOrder: import('./printChangeOrder').ChangeOrderPrintData | null;
}

export const usePrintStore = create<PrintState>(() => ({
  proposal: null,
  changeOrder: null,
}));

// ── Controller ────────────────────────────────────────────────

export interface PrintProposalOptions {
  variant: ProposalVariant;
  /** Optional override — otherwise derived from the loaded scene. */
  projectName?: string;
  /** Optional scope description — otherwise empty. */
  scopeDescription?: string;
  /**
   * Phase 14.G — when set, the print is treated as a revision of an
   * existing proposal: the base number is reused and the next R{n}
   * label is derived from the revision store. When omitted, a fresh
   * base number is generated and saved as R1.
   */
  revisionOfBaseNumber?: string;
  /**
   * Phase 14.G — free-text note attached to this revision snapshot.
   * Shown in the compare panel + printed on change orders.
   */
  revisionNote?: string;
}

const PRINTING_CLASS = 'printing';

/**
 * Main entry point. Run from the ExportPanel or hotkey handler.
 * Returns after the print dialog has closed (resolved or cancelled).
 *
 * Throws if the scene has no pipes (nothing to bid on) — caller
 * should surface a friendly toast rather than catching silently.
 */
export async function printProposal(opts: PrintProposalOptions): Promise<void> {
  const pipes = Object.values(usePipeStore.getState().pipes);
  if (pipes.length === 0) {
    throw new Error('No pipes in the scene — draw something before exporting a proposal.');
  }

  // 1. Compose proposal data.
  const contractor = getActiveContractorProfile();
  const pricing = getActivePricingProfile();
  const customerId = useCustomerStore.getState().activeCustomerId;
  const customer = customerId
    ? useCustomerStore.getState().profiles[customerId] ?? null
    : null;

  const fixtures = Object.values(useFixtureStore.getState().fixtures);
  const mechanicalFittings = generateAllFittings(pipes);
  const compliancePlan = planPTrapsAndCleanouts(pipes, fixtures);
  const fittings = [...mechanicalFittings, ...planToFittings(compliancePlan)];
  // Phase 14.H — per-material hanger plan for accurate support costs.
  const hangerPlan = planHangers(pipes);
  const supportItemsOverride = planHangerBOMItems(hangerPlan);
  const bom = generateBOM(pipes, fittings, pricing, { supportItemsOverride }, fixtures);

  const projectName = opts.projectName
    ?? customer?.name
    ?? 'Plumbing Project';

  // Phase 14.G — revision-aware proposal number. When continuing an
  // existing proposal, the printed number combines base + revision
  // label: "P-260418-ABCD · R2". R1 prints as the bare base number.
  const revisionStore = useProposalRevisionStore.getState();
  const baseNumber = opts.revisionOfBaseNumber ?? generateProposalNumber();
  const existingRevisions = revisionStore.getRevisions(baseNumber);
  const { revisionNumber, revisionIndex } = nextRevisionNumber(existingRevisions);
  const displayProposalNumber = revisionIndex === 1
    ? baseNumber
    : `${baseNumber} · ${revisionNumber}`;

  const proposal = composeProposalData({
    variant: opts.variant,
    contractor,
    customer,
    bom,
    project: {
      name: projectName,
      proposalNumber: displayProposalNumber,
      dateIso: new Date().toISOString(),
      scopeDescription: opts.scopeDescription,
    },
    laborRateUsdPerHr: pricing.laborRateUsdPerHr,
  });

  // 2. Stage it in the print store — PrintableProposal subscribes.
  usePrintStore.setState({ proposal });

  // 3. Switch to printing mode + wait for paint.
  document.body.classList.add(PRINTING_CLASS);

  await nextFrame();
  await nextFrame(); // second frame so layout stabilizes under @media print

  // 4. Trigger the browser's print flow.
  try {
    window.print();
  } catch (err) {
    log.error('window.print() threw', err);
  }

  // 5. Tear down. After window.print() returns the user has dismissed
  // the dialog (either by confirming or cancelling); in both cases we
  // want the app back. Slight delay so the final print frame completes.
  await sleep(50);
  document.body.classList.remove(PRINTING_CLASS);
  usePrintStore.setState({ proposal: null });

  // 6. Phase 14.G — persist this print as a revision snapshot so the
  // contractor can compare future edits against it + generate change
  // orders. Saves even on customer-facing variant because customer may
  // ask "what was in the first proposal you sent me?"
  revisionStore.saveRevision(baseNumber, proposal, {
    ...(opts.revisionNote !== undefined ? { note: opts.revisionNote } : {}),
  });

  log.info('proposal printed + saved as revision', {
    variant: opts.variant,
    baseNumber,
    revisionNumber,
    lineItems: proposal.lineItems.length,
    grandTotal: proposal.totals.customerTotal,
  });
}

// ── Helpers ────────────────────────────────────────────────────

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'undefined') { resolve(); return; }
    requestAnimationFrame(() => resolve());
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const __testables = { PRINTING_CLASS };
