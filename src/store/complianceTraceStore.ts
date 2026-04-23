/**
 * complianceTraceStore — holds the most recent compliance traces
 * keyed by the entity (pipe or fixture) they violate against.
 *
 * Phase 2 data flow:
 *
 *   Worker                                   Main thread
 *   ───────────────────────────────────     ──────────────────────────────
 *   ComplianceEngine.check()
 *     ├─ reads TRACE_ENABLED flag
 *     └─ buildReport() attaches `trace` ─► SIM_MSG.SIMULATION_COMPLETE
 *        to each ComplianceViolation               │
 *                                                  ▼
 *                                          bootComplianceTraceStore()
 *                                          subscribes, populates this store,
 *                                          keyed by violation.entityId.
 *                                                  │
 *                                                  ▼
 *                                          ComplianceDebugger.tsx renders.
 *
 * Lifecycle:
 *   • Traces replace-on-solve. A new solve wipes the store and repopulates
 *     from the fresh report. We don't accumulate history — the God Mode
 *     console (Phase 1) is where historical debugging lives; this store
 *     is a live snapshot.
 *
 *   • If the `complianceTrace` flag is OFF, SIMULATION_COMPLETE still
 *     fires but every violation has `trace === undefined`, and this
 *     store stays empty. Bundle impact: the store itself is ~1KB
 *     regardless of flag state.
 */

import { create } from 'zustand';
import { simBus, SIM_MSG, type SimMessage } from '../engine/graph/MessageBus';
import type { ComplianceReport } from '../engine/compliance/ComplianceEngine';
import type { ViolationTrace } from '../engine/compliance/ViolationTrace';
import { setComplianceTraceEnabled } from '../engine/compliance/ComplianceEngine';
import { useFeatureFlagStore } from './featureFlagStore';

// ── Store shape ────────────────────────────────────────────────

export interface TracedViolation {
  /** ID of the entity the violation was pinned to (node or edge id). */
  entityId: string;
  entityType: 'node' | 'edge';
  ruleId: string;
  ruleName: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  codeRefSection: string;
  cost: number;
  trace: ViolationTrace;
}

interface ComplianceTraceState {
  /** Map: entityId → array of traced violations on that entity. */
  byEntity: Record<string, TracedViolation[]>;
  /** Flat list in severity+cost order — same as the ComplianceReport. */
  all: TracedViolation[];
  /** Timestamp of the latest solve that populated this store. */
  lastSolvedAt: number;
  /** Number of traces in the latest solve. */
  count: number;

  populate: (report: ComplianceReport) => void;
  clear: () => void;
}

export const useComplianceTraceStore = create<ComplianceTraceState>((set) => ({
  byEntity: {},
  all: [],
  lastSolvedAt: 0,
  count: 0,

  populate: (report) => {
    const byEntity: Record<string, TracedViolation[]> = {};
    const all: TracedViolation[] = [];

    for (const v of report.violations) {
      if (!v.trace) continue; // trace flag was off at solve time
      const traced: TracedViolation = {
        entityId: v.entityId,
        entityType: v.entityType,
        ruleId: v.ruleId,
        ruleName: v.ruleName,
        message: v.message,
        severity: v.severity as 'error' | 'warning' | 'info',
        codeRefSection: v.codeRef.section,
        cost: v.cost,
        trace: v.trace,
      };
      all.push(traced);
      if (!byEntity[v.entityId]) byEntity[v.entityId] = [];
      byEntity[v.entityId]!.push(traced);
    }

    set({
      byEntity,
      all,
      lastSolvedAt: performance.now(),
      count: all.length,
    });
  },

  clear: () => set({ byEntity: {}, all: [], count: 0 }),
}));

// ── Boot / subscription ────────────────────────────────────────

let booted = false;

/**
 * Call once at app bootstrap (App.tsx useEffect).
 *
 * Responsibilities:
 *   1. Subscribe to SIM_MSG.SIMULATION_COMPLETE and populate the store.
 *   2. Mirror the `complianceTrace` feature flag into the solver's
 *      TRACE_ENABLED static. Re-mirrors on every flag change so a user
 *      flipping the flag in God Mode takes effect on the NEXT solve.
 */
export function bootComplianceTraceStore(): void {
  if (booted) return;
  booted = true;

  // Initial flag sync (covers the case where the user saved the flag
  // on in a previous session — localStorage loads before boot).
  setComplianceTraceEnabled(useFeatureFlagStore.getState().complianceTrace);

  // Keep solver flag in sync with user toggles.
  useFeatureFlagStore.subscribe((state, prev) => {
    if (state.complianceTrace !== prev.complianceTrace) {
      setComplianceTraceEnabled(state.complianceTrace);
      if (!state.complianceTrace) {
        // User just turned traces off — prune the panel so it doesn't
        // show stale data from when they were on.
        useComplianceTraceStore.getState().clear();
      }
    }
  });

  // Main subscription — every completed solve refreshes the traces.
  simBus.on(SIM_MSG.SIMULATION_COMPLETE, (msg: SimMessage) => {
    const p = msg.payload as { complianceReport?: ComplianceReport } | undefined;
    if (!p?.complianceReport) return;
    useComplianceTraceStore.getState().populate(p.complianceReport);
  });
}
