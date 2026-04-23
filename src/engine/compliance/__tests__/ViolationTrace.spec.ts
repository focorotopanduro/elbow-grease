/**
 * Phase 2 — ViolationTrace acceptance test.
 *
 * Seeds a deliberately-non-compliant DAG (waste pipe with slope below
 * the IPC 704.1 minimum), runs the ComplianceEngine with traces enabled,
 * and asserts the inference chain is complete and structurally sane.
 *
 * Also verifies:
 *   • With the flag OFF, no trace is attached (zero production cost).
 *   • Traces are serializable (can round-trip through JSON, which is
 *     required to cross the Web Worker postMessage boundary).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  ComplianceEngine,
  setComplianceTraceEnabled,
} from '../ComplianceEngine';
import { PlumbingDAG } from '../../graph/PlumbingDAG';
import { createFixtureNode, createDrainNode } from '../../graph/GraphNode';
import { createEdge } from '../../graph/GraphEdge';

/**
 * Build a 2-node DAG: one fixture draining to a drain via a single
 * pipe. The pipe has slope 0.0625 in/ft, but IPC 704.1 requires 0.25
 * for 2" pipe — this must trigger the min-slope constraint.
 */
function seedFailingDag(): PlumbingDAG {
  const dag = new PlumbingDAG();

  const fixture = createFixtureNode('kitchen_sink', 'waste', 0, 'KitchenSink');
  const drain = createDrainNode(-0.5, 'BuildingDrain');
  dag.addNode(fixture);
  dag.addNode(drain);

  // Below-minimum slope on 2" pipe → IPC 704.1 violation
  const pipe = createEdge(
    fixture.id,
    drain.id,
    'pvc_sch40',
    2,                 // 2" diameter
    10,                // 10 ft length
    0.0625,            // slope: 1/16 in/ft — BELOW the 1/4 in/ft minimum
    -0.5,              // elevation delta
  );
  dag.addEdge(pipe);

  return dag;
}

// ── Lifecycle ──────────────────────────────────────────────────

beforeEach(() => {
  setComplianceTraceEnabled(false);
});

// ── Tests ──────────────────────────────────────────────────────

describe('ViolationTrace — flag-gating', () => {
  it('flag OFF: violations have no trace attached', () => {
    setComplianceTraceEnabled(false);
    const engine = new ComplianceEngine();
    const report = engine.check(seedFailingDag());

    expect(report.violations.length).toBeGreaterThan(0);
    for (const v of report.violations) {
      expect(v.trace).toBeUndefined();
    }
  });

  it('flag ON: every violation has a populated trace', () => {
    setComplianceTraceEnabled(true);
    const engine = new ComplianceEngine();
    const report = engine.check(seedFailingDag());

    expect(report.violations.length).toBeGreaterThan(0);
    for (const v of report.violations) {
      expect(v.trace).toBeDefined();
    }
  });
});

describe('ViolationTrace — structure', () => {
  beforeEach(() => setComplianceTraceEnabled(true));

  it('min-slope violation has expected trace fields', () => {
    const engine = new ComplianceEngine();
    const report = engine.check(seedFailingDag());

    // Find the IPC 704.1 slope violation specifically.
    const slopeViolation = report.violations.find(
      (v) => v.codeRef.section === '704.1',
    );
    expect(slopeViolation).toBeDefined();
    const trace = slopeViolation!.trace!;

    // Failed constraint shape
    expect(trace.failedConstraint.codeRef).toBe('IPC 704.1');
    expect(trace.failedConstraint.hard).toBe(true);
    expect(trace.failedConstraint.variableIds.length).toBeGreaterThan(0);
    expect(trace.failedConstraint.cost).toBeGreaterThan(0);

    // Must NOT carry a costFn (the field should not exist on the clone).
    // Serializability test — see the separate test below.

    // Applied conditions must list at least one entry bound to the edge.
    expect(trace.appliedConditions.length).toBeGreaterThanOrEqual(1);
    expect(trace.appliedConditions[0]!.boundEntities[0]).toBe(slopeViolation!.entityId);

    // Source triples must include the violating edge's own facts.
    expect(trace.sourceTriples.length).toBeGreaterThan(0);
    const edgeUri = `bldg:${slopeViolation!.entityId}`;
    const selfTriples = trace.sourceTriples.filter((t) => t.subject === edgeUri);
    expect(selfTriples.length).toBeGreaterThan(0);

    // Must have captured the actual slope variable value.
    const slopeVarId = trace.failedConstraint.variableIds.find((id) => id.endsWith(':slope'));
    expect(slopeVarId).toBeDefined();
    expect(trace.variableValues[slopeVarId!]).toBe(0.0625);

    // IPC link is present for section 704.1.
    expect(trace.sourceCode.section).toBe('704.1');
    expect(trace.sourceCode.url).toContain('704.1');

    // Phase + timestamp are sensible.
    expect(trace.phase).toBe('solve');
    expect(trace.solvedAt).toBeGreaterThan(0);
  });

  it('trace is fully JSON-serializable (worker-postMessage safe)', () => {
    const engine = new ComplianceEngine();
    const report = engine.check(seedFailingDag());

    // Round-trip every violation through JSON.
    for (const v of report.violations) {
      expect(v.trace).toBeDefined();
      const roundTripped = JSON.parse(JSON.stringify(v.trace!));
      expect(roundTripped.failedConstraint.id).toBe(v.trace!.failedConstraint.id);
      expect(roundTripped.sourceTriples.length).toBe(v.trace!.sourceTriples.length);
      // No function fields should survive (they'd have turned into undefined,
      // which is ignored by stringify). The serialized object must deep-equal
      // the live one for all OWN enumerable props.
      expect(typeof roundTripped.failedConstraint.cost).toBe('number');
    }
  });
});

describe('ViolationTrace — live store integration', () => {
  it('populating the store from a real report produces expected count', async () => {
    setComplianceTraceEnabled(true);
    const { usePlumbingComplianceStore } = await import('@store/plumbingComplianceStore');
    usePlumbingComplianceStore.getState().clear();

    const engine = new ComplianceEngine();
    const report = engine.check(seedFailingDag());
    usePlumbingComplianceStore.getState().populate(report);

    const state = usePlumbingComplianceStore.getState();
    expect(state.count).toBeGreaterThan(0);
    expect(state.all.length).toBe(state.count);

    // Grouping by entity should total the flat count (every trace gets
    // exactly one bucket).
    const totalGrouped = Object.values(state.byEntity).reduce(
      (acc, arr) => acc + arr.length, 0,
    );
    expect(totalGrouped).toBe(state.count);
  });

  it('store clear() empties byEntity + all + count', async () => {
    setComplianceTraceEnabled(true);
    const { usePlumbingComplianceStore } = await import('@store/plumbingComplianceStore');
    const engine = new ComplianceEngine();
    const report = engine.check(seedFailingDag());
    usePlumbingComplianceStore.getState().populate(report);
    expect(usePlumbingComplianceStore.getState().count).toBeGreaterThan(0);
    usePlumbingComplianceStore.getState().clear();
    const after = usePlumbingComplianceStore.getState();
    expect(after.count).toBe(0);
    expect(after.all).toHaveLength(0);
    expect(Object.keys(after.byEntity)).toHaveLength(0);
  });

  it('populate() with flag-OFF report yields an empty store', async () => {
    setComplianceTraceEnabled(false);
    const { usePlumbingComplianceStore } = await import('@store/plumbingComplianceStore');
    usePlumbingComplianceStore.getState().clear();
    const engine = new ComplianceEngine();
    const report = engine.check(seedFailingDag());
    // Report still has violations, but none carry a `trace` field
    // (flag was off during buildReport). populate() filters by trace.
    expect(report.violations.length).toBeGreaterThan(0);
    usePlumbingComplianceStore.getState().populate(report);
    expect(usePlumbingComplianceStore.getState().count).toBe(0);
  });

  it('populate() twice with the SAME report produces the SAME count (idempotent per solve)', async () => {
    setComplianceTraceEnabled(true);
    const { usePlumbingComplianceStore } = await import('@store/plumbingComplianceStore');
    usePlumbingComplianceStore.getState().clear();
    const engine = new ComplianceEngine();
    const report = engine.check(seedFailingDag());
    usePlumbingComplianceStore.getState().populate(report);
    const firstCount = usePlumbingComplianceStore.getState().count;
    usePlumbingComplianceStore.getState().populate(report);
    const secondCount = usePlumbingComplianceStore.getState().count;
    // Populate replaces rather than appends — two populates with the
    // same report yield the same count, not 2× the violations.
    expect(secondCount).toBe(firstCount);
  });
});

// ── Phase 2: helper semantics ─────────────────────────────────

describe('setComplianceTraceEnabled', () => {
  it('toggling the flag at runtime affects subsequent solves, not the in-flight one', async () => {
    // Solve with flag on
    setComplianceTraceEnabled(true);
    const engine = new ComplianceEngine();
    const report1 = engine.check(seedFailingDag());
    for (const v of report1.violations) expect(v.trace).toBeDefined();

    // Toggle off; new solve has no traces.
    setComplianceTraceEnabled(false);
    const report2 = engine.check(seedFailingDag());
    for (const v of report2.violations) expect(v.trace).toBeUndefined();

    // The ORIGINAL report1's traces still exist — they were materialized
    // before the flag flipped.
    for (const v of report1.violations) expect(v.trace).toBeDefined();
  });
});
