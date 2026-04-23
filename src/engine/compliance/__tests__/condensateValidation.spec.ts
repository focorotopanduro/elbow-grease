/**
 * condensateValidation — Phase 14.AA.3 tests.
 *
 * Locks the FBC 314.2.1.1 / IPC 314.2.1.1 compliance rule:
 * HVAC condensate can't discharge directly into DWV.
 */

import { describe, it, expect } from 'vitest';
import {
  validateCondensateDischarge,
  reportCondensate,
} from '../condensateValidation';
import type { CommittedPipe } from '../../../store/pipeStore';
import type { FixtureInstance } from '../../../store/fixtureStore';
import type { SystemType } from '../../graph/GraphNode';

// ── Builders ──────────────────────────────────────────────────

function mkPipe(
  id: string,
  points: [number, number, number][],
  system: SystemType = 'condensate',
): CommittedPipe {
  return {
    id, points,
    diameter: 0.75,
    material: 'pvc_sch40',
    system,
    color: '#9575cd',
    visible: true,
    selected: false,
  };
}

function mkFixture(
  id: string,
  subtype: FixtureInstance['subtype'],
  position: [number, number, number],
): FixtureInstance {
  return { id, subtype, position, params: {}, createdTs: 0, connectedPipeIds: [] };
}

// ── Empty / clean cases ──────────────────────────────────────

describe('validateCondensateDischarge — clean cases', () => {
  it('empty scene → no violations', () => {
    expect(validateCondensateDischarge([], [])).toEqual([]);
  });

  it('no condensate pipes → no violations', () => {
    const pipes = [mkPipe('a', [[0, 0, 0], [5, 0, 0]], 'cold_supply')];
    expect(validateCondensateDischarge(pipes, [])).toEqual([]);
  });

  it('condensate pipe not touching any drainage → clean', () => {
    const pipes = [
      mkPipe('c1', [[0, 0, 0], [5, 0, 0]], 'condensate'),
      mkPipe('d1', [[20, 0, 0], [25, 0, 0]], 'waste'),
    ];
    expect(validateCondensateDischarge(pipes, [])).toEqual([]);
  });
});

// ── Direct-to-DWV violations ─────────────────────────────────

describe('validateCondensateDischarge — direct-to-DWV', () => {
  it('condensate endpoint touches waste endpoint → violation', () => {
    const pipes = [
      mkPipe('c1', [[0, 0, 0], [5, 0, 0]], 'condensate'),
      mkPipe('d1', [[5, 0, 0], [10, 0, 0]], 'waste'),
    ];
    const v = validateCondensateDischarge(pipes, []);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      kind: 'direct_to_dwv',
      condensatePipeId: 'c1',
      targetPipeId: 'd1',
      severity: 'critical',
      codeRef: expect.stringContaining('314.2.1.1'),
    });
  });

  it('condensate endpoint touches storm endpoint → also violation', () => {
    const pipes = [
      mkPipe('c1', [[0, 0, 0], [5, 0, 0]], 'condensate'),
      mkPipe('s1', [[5, 0, 0], [10, 0, 0]], 'storm'),
    ];
    const v = validateCondensateDischarge(pipes, []);
    expect(v).toHaveLength(1);
    expect(v[0]!.targetPipeId).toBe('s1');
  });

  it('message contains actionable guidance', () => {
    const pipes = [
      mkPipe('c1', [[0, 0, 0], [5, 0, 0]], 'condensate'),
      mkPipe('d1', [[5, 0, 0], [10, 0, 0]], 'waste'),
    ];
    const v = validateCondensateDischarge(pipes, []);
    expect(v[0]!.message).toContain('receptor');
    expect(v[0]!.message).toContain('314.2.1.1');
  });
});

// ── Approved receptors clear the violation ───────────────────

describe('validateCondensateDischarge — approved receptors', () => {
  it('floor drain at the junction → no violation', () => {
    const pipes = [
      mkPipe('c1', [[0, 0, 0], [5, 0, 0]], 'condensate'),
      mkPipe('d1', [[5, 0, 0], [10, 0, 0]], 'waste'),
    ];
    // Floor drain located at the junction. Its drain port is
    // at local (0, drainRoughIn, 0) — for floor_drain that's
    // near ground, so it aligns with the junction.
    const fixtures = [mkFixture('fd1', 'floor_drain', [5, 0, 0])];
    const v = validateCondensateDischarge(pipes, fixtures);
    expect(v).toEqual([]);
  });

  it('utility sink at the junction → no violation', () => {
    const pipes = [
      mkPipe('c1', [[0, 0, 0], [5, 14 / 12, 0]], 'condensate'),
      mkPipe('d1', [[5, 14 / 12, 0], [10, 14 / 12, 0]], 'waste'),
    ];
    // Utility sink's drain port is at local (0, 14in, 0) —
    // position the fixture so that maps to (5, 14in, 0).
    const fixtures = [mkFixture('us1', 'utility_sink', [5, 0, 0])];
    const v = validateCondensateDischarge(pipes, fixtures);
    expect(v).toEqual([]);
  });

  it('NON-receptor fixture (lavatory) does NOT clear violation', () => {
    const pipes = [
      mkPipe('c1', [[0, 0, 0], [5, 0, 0]], 'condensate'),
      mkPipe('d1', [[5, 0, 0], [10, 0, 0]], 'waste'),
    ];
    // A lavatory isn't an approved receptor — it's a potable
    // fixture. Condensate into a lavatory drain is still
    // improper. But the lavatory DOES have a drain port at
    // local (0, drainRoughIn, 0) = (0, 1.5 ft, 0). If we
    // position it at (5, -1.5 ft, 0) the world position would
    // be (5, 0, 0) and match. We test that receptors-by-subtype
    // filter picks this up: even at the right position, a
    // lavatory doesn't clear the violation.
    const fixtures = [mkFixture('lav1', 'lavatory', [5, -1.5, 0])];
    const v = validateCondensateDischarge(pipes, fixtures);
    expect(v).toHaveLength(1);
    expect(v[0]!.kind).toBe('direct_to_dwv');
  });

  it('far-away receptor fixture (> 5 ft XZ) does NOT clear violation', () => {
    const pipes = [
      mkPipe('c1', [[0, 0, 0], [5, 0, 0]], 'condensate'),
      mkPipe('d1', [[5, 0, 0], [10, 0, 0]], 'waste'),
    ];
    // Floor drain far from the junction
    const fixtures = [mkFixture('fd1', 'floor_drain', [50, 0, 50])];
    const v = validateCondensateDischarge(pipes, fixtures);
    expect(v).toHaveLength(1);
  });
});

// ── Invisible pipes excluded ─────────────────────────────────

describe('visibility filter', () => {
  it('invisible condensate pipe → no violation', () => {
    const c = mkPipe('c1', [[0, 0, 0], [5, 0, 0]], 'condensate');
    c.visible = false;
    const d = mkPipe('d1', [[5, 0, 0], [10, 0, 0]], 'waste');
    expect(validateCondensateDischarge([c, d], [])).toEqual([]);
  });

  it('invisible waste pipe → no violation', () => {
    const c = mkPipe('c1', [[0, 0, 0], [5, 0, 0]], 'condensate');
    const d = mkPipe('d1', [[5, 0, 0], [10, 0, 0]], 'waste');
    d.visible = false;
    expect(validateCondensateDischarge([c, d], [])).toEqual([]);
  });
});

// ── reportCondensate ─────────────────────────────────────────

describe('reportCondensate', () => {
  it('clean scene → passesCode true', () => {
    const r = reportCondensate([], []);
    expect(r.passesCode).toBe(true);
    expect(r.violationCount).toBe(0);
  });

  it('violation present → passesCode false + count matches', () => {
    const pipes = [
      mkPipe('c1', [[0, 0, 0], [5, 0, 0]], 'condensate'),
      mkPipe('d1', [[5, 0, 0], [10, 0, 0]], 'waste'),
    ];
    const r = reportCondensate(pipes, []);
    expect(r.passesCode).toBe(false);
    expect(r.violationCount).toBe(1);
  });
});

// ── Multi-endpoint violations ────────────────────────────────

describe('multi-endpoint', () => {
  it('one condensate pipe with both endpoints at drain = 2 violations', () => {
    const pipes = [
      mkPipe('c1', [[0, 0, 0], [10, 0, 0]], 'condensate'),
      mkPipe('d1', [[-1, 0, 0], [0, 0, 0]], 'waste'),   // touches start
      mkPipe('d2', [[10, 0, 0], [11, 0, 0]], 'waste'),  // touches end
    ];
    const v = validateCondensateDischarge(pipes, []);
    expect(v).toHaveLength(2);
  });
});
