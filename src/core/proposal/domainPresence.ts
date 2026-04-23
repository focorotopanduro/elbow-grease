/**
 * domainPresence — Phase 5 (ARCHITECTURE.md §4.8).
 *
 * Single source of truth for "is there content in this domain?" as
 * seen by the proposal / bid-package / change-order renderers.
 *
 * Presence semantics (§4.8):
 *   • Presence = ENTITY EXISTENCE, not pricing > $0. Users who draw
 *     items before pricing them still see the section.
 *   • Both-empty is a valid state — renderers must not crash on it.
 *   • `roofingScopeStore` scope filters WHAT IS PRICED, not
 *     WHAT IS PRESENT. A scoped-out section still counts as "roofing
 *     is present" for gating purposes.
 *   • Change orders follow the same rule — a CO touching only
 *     plumbing contains no roofing section.
 *
 * Why a shared helper instead of per-component store reads: the
 * three print entry points (PrintableProposal, PrintableBidPackage,
 * PrintableChangeOrder) would each need to duplicate the same
 * "domain X exists" logic. Consolidating here keeps the check
 * uniform and lets a future Printable plug in with a single
 * import.
 */

import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { useManifoldStore } from '@store/manifoldStore';
import { useRoofStore } from '@store/roofStore';

/**
 * Which domains currently have content worth rendering in a
 * proposal / bid package. Consumers short-circuit headers,
 * tables, and per-domain totals on the corresponding flag.
 */
export type DomainPresence = {
  plumbing: boolean;
  roofing: boolean;
};

/**
 * Live presence, read from the four domain stores via
 * `getState()`. Pure — no subscription, safe to call inside a
 * render or anywhere else that needs a one-shot check.
 *
 * The underlying record-shaped stores (`pipes` /
 * `fixtures` / `manifolds` / `sections` are
 * `Record<string, T>`) use their accompanying order arrays
 * where present for an O(1) size check; `fixtureStore` has no
 * order array so we fall back to `Object.keys`.
 */
export function getDomainPresence(): DomainPresence {
  const pipeOrder = usePipeStore.getState().pipeOrder;
  const fixtures = useFixtureStore.getState().fixtures;
  const manifoldOrder = useManifoldStore.getState().order;
  const sectionOrder = useRoofStore.getState().sectionOrder;

  return {
    plumbing:
      pipeOrder.length > 0
      || Object.keys(fixtures).length > 0
      || manifoldOrder.length > 0,
    roofing:
      sectionOrder.length > 0,
  };
}

/**
 * Pure variant that takes a plain snapshot — useful for tests
 * and for callers that already hold store counts and don't want
 * to `getState()` three more times.
 */
export function computeDomainPresence(counts: {
  pipeCount: number;
  fixtureCount: number;
  manifoldCount: number;
  sectionCount: number;
}): DomainPresence {
  return {
    plumbing:
      counts.pipeCount > 0
      || counts.fixtureCount > 0
      || counts.manifoldCount > 0,
    roofing: counts.sectionCount > 0,
  };
}
