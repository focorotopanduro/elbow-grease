/**
 * printBidPackage — Phase 14.AA.2
 *
 * Orchestrates the multi-page "Bid Package" print flow. Sibling of
 * `printProposal.ts` — same toggle-body-class + window.print()
 * pattern (see ADR 033), but renders the `PrintableBidPackage`
 * component with its extra cover + compliance pages.
 *
 * Entry point: `printBidPackage()` (no options — reads the current
 * scene, contractor profile, pricing, and latest violations from
 * the active stores).
 */

import { create } from 'zustand';
import { logger } from '@core/logger/Logger';
import {
  composeBidPackage,
  type BidPackageData,
} from './bidPackageData';
import { composeProposalData, generateProposalNumber } from './proposalData';
import { getActiveContractorProfile } from '@store/contractorProfileStore';
import { getActivePricingProfile } from '@store/pricingStore';
import { useCustomerStore } from '@store/customerStore';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { generateAllFittings } from '@ui/pipe/FittingGenerator';
import { generateBOM } from '../../engine/export/BOMExporter';
import { planPTrapsAndCleanouts, planToFittings } from '@core/compliance/pTrapCleanoutPlanner';
import { planHangers, planToBOMItems as planHangerBOMItems } from '@core/compliance/hangerPlanner';
import type { ComplianceViolation } from '../../engine/compliance/ComplianceEngine';

const log = logger('PrintBidPackage');

// ── State ─────────────────────────────────────────────────────

interface PrintState {
  bidPackage: BidPackageData | null;
}

export const usePrintBidPackageStore = create<PrintState>(() => ({
  bidPackage: null,
}));

// ── Public API ────────────────────────────────────────────────

export interface PrintBidPackageOptions {
  /** Plumbing-scope one-liner for the cover + executive summary page. */
  scopeDescription?: string;
  /** Fetched from the active store unless explicitly provided. */
  violations?: readonly ComplianceViolation[];
  /** For the cover page; defaults to "Plumbing Project" + customer name. */
  projectName?: string;
}

export function printBidPackage(options: PrintBidPackageOptions = {}): void {
  const contractor = getActiveContractorProfile();
  const pricing = getActivePricingProfile();
  const customerState = useCustomerStore.getState();
  const customer = customerState.activeCustomerId
    ? customerState.profiles[customerState.activeCustomerId] ?? null
    : null;
  const pipes = Object.values(usePipeStore.getState().pipes);
  const fixtures = Object.values(useFixtureStore.getState().fixtures);

  // Same BOM-enrichment pipeline the proposal flow uses (ADR 038).
  const mechanicalFittings = generateAllFittings(pipes);
  const traps = planPTrapsAndCleanouts(pipes, fixtures);
  const complianceFittings = planToFittings(traps);
  const hangerPlan = planHangers(pipes);
  const bom = generateBOM(
    pipes,
    [...mechanicalFittings, ...complianceFittings],
    pricing,
    { supportItemsOverride: planHangerBOMItems(hangerPlan) },
    fixtures,
  );

  const nowIso = new Date().toISOString();
  const proposal = composeProposalData({
    contractor,
    customer,
    bom,
    variant: 'customer-facing',
    project: {
      name: options.projectName ?? 'Plumbing Project',
      proposalNumber: generateProposalNumber(),
      dateIso: nowIso,
      scopeDescription: options.scopeDescription ?? defaultScope(pipes.length, fixtures.length),
    },
    laborRateUsdPerHr: pricing.laborRateUsdPerHr ?? 95,
  });

  const bidPackage = composeBidPackage({
    proposal,
    violations: options.violations ?? [],
  });

  // Stage the data — the PrintableBidPackage component re-renders
  // with the composed payload. CSS has a `display: none` by default
  // that lifts when the `printing-bid` body class is set.
  usePrintBidPackageStore.setState({ bidPackage });

  // Defer to next frame so React mounts the document before we
  // invoke the print dialog.
  requestAnimationFrame(() => {
    const body = document.body;
    body.classList.add('printing-bid');
    requestAnimationFrame(() => {
      try {
        window.print();
      } finally {
        body.classList.remove('printing-bid');
        // Hold the staged payload for 100ms so the print preview
        // doesn't race to an empty document.
        setTimeout(() => {
          usePrintBidPackageStore.setState({ bidPackage: null });
        }, 100);
      }
    });
  });

  log.info('bid package print triggered', {
    pipes: pipes.length,
    fixtures: fixtures.length,
    violations: bidPackage.compliance.counts,
  });
}

function defaultScope(pipeCount: number, fixtureCount: number): string {
  return (
    `This bid covers the full plumbing rough-in and trim for the project: `
    + `${pipeCount} pipe segment${pipeCount === 1 ? '' : 's'} `
    + `connecting ${fixtureCount} plumbing fixture${fixtureCount === 1 ? '' : 's'}, `
    + `including all required code-compliant fittings, hangers, cleanouts, `
    + `and traps. Work is performed per 2023 Florida Building Code (Plumbing) `
    + `and IPC 2021 with material-grade substitutions noted in the itemized bill of materials.`
  );
}
