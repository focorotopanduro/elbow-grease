/**
 * pipeInvariants — Phase 14.AD.30.
 *
 * Lock the geometric contract. If these assertions break, a whole
 * class of "why is my pipe rendering at (NaN, NaN, NaN)?" bugs
 * becomes regressions instead of mysteries.
 */

import { describe, it, expect } from 'vitest';
import { validatePipe, validateFitting, validateScene } from '../pipeInvariants';
import type { CommittedPipe } from '../../../store/pipeStore';
import type { FittingInstance } from '../../../ui/pipe/FittingGenerator';
import type { Vec3 } from '@core/events';

function mkPipe(overrides: Partial<CommittedPipe> = {}): CommittedPipe {
  return {
    id: 'p1',
    points: [[0, 0, 0], [10, 0, 0]] as Vec3[],
    diameter: 2,
    material: 'pvc_sch40',
    system: 'cold_supply',
    color: '#ffa726',
    visible: true,
    selected: false,
    ...overrides,
  };
}

function mkFitting(overrides: Partial<FittingInstance> = {}): FittingInstance {
  return {
    id: 'f1',
    type: 'elbow_90',
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    diameter: 2,
    material: 'pvc_sch40',
    pipeId: 'p1',
    ...overrides,
  };
}

// ── validatePipe ────────────────────────────────────────────────

describe('validatePipe', () => {
  it('valid pipe → no violations', () => {
    expect(validatePipe(mkPipe())).toEqual([]);
  });

  it('< 2 points → too-few-points', () => {
    const v = validatePipe(mkPipe({ points: [[0, 0, 0]] }));
    expect(v).toHaveLength(1);
    expect(v[0]!.kind).toBe('too-few-points');
  });

  it('NaN in a point → non-finite-point', () => {
    const v = validatePipe(mkPipe({
      points: [[0, 0, 0], [NaN, 0, 0]],
    }));
    const kinds = v.map((x) => x.kind);
    expect(kinds).toContain('non-finite-point');
  });

  it('Infinity in a point → non-finite-point', () => {
    const v = validatePipe(mkPipe({
      points: [[0, 0, 0], [0, Infinity, 0]],
    }));
    expect(v.some((x) => x.kind === 'non-finite-point')).toBe(true);
  });

  it('zero diameter → non-positive-diameter', () => {
    const v = validatePipe(mkPipe({ diameter: 0 }));
    expect(v.some((x) => x.kind === 'non-positive-diameter')).toBe(true);
  });

  it('negative diameter → non-positive-diameter', () => {
    const v = validatePipe(mkPipe({ diameter: -1 }));
    expect(v.some((x) => x.kind === 'non-positive-diameter')).toBe(true);
  });

  it('NaN diameter → non-finite-diameter', () => {
    const v = validatePipe(mkPipe({ diameter: NaN }));
    expect(v.some((x) => x.kind === 'non-finite-diameter')).toBe(true);
  });

  it('empty material → empty-material', () => {
    const v = validatePipe(mkPipe({ material: '' }));
    expect(v.some((x) => x.kind === 'empty-material')).toBe(true);
  });

  it('coincident consecutive points → coincident-points', () => {
    const v = validatePipe(mkPipe({
      points: [[0, 0, 0], [5, 0, 0], [5, 0, 0], [10, 0, 0]],
    }));
    expect(v.some((x) => x.kind === 'coincident-points')).toBe(true);
  });

  it('valid multi-point pipe with bends → no violations', () => {
    const v = validatePipe(mkPipe({
      points: [[0, 0, 0], [10, 0, 0], [10, 0, 10], [0, 0, 10]],
    }));
    expect(v).toEqual([]);
  });

  it('accumulates multiple violations', () => {
    const v = validatePipe(mkPipe({
      points: [[NaN, 0, 0], [5, 0, 0]],
      diameter: -5,
      material: '',
    }));
    const kinds = v.map((x) => x.kind).sort();
    expect(kinds).toContain('non-finite-point');
    expect(kinds).toContain('non-positive-diameter');
    expect(kinds).toContain('empty-material');
  });
});

// ── validateFitting ─────────────────────────────────────────────

describe('validateFitting', () => {
  it('valid fitting → no violations', () => {
    expect(validateFitting(mkFitting())).toEqual([]);
  });

  it('NaN quaternion component → non-finite-quaternion', () => {
    const v = validateFitting(mkFitting({
      quaternion: [0, NaN, 0, 1],
    }));
    expect(v.some((x) => x.kind === 'non-finite-quaternion')).toBe(true);
  });

  it('NaN position → non-finite-point', () => {
    const v = validateFitting(mkFitting({
      position: [NaN, 0, 0],
    }));
    expect(v.some((x) => x.kind === 'non-finite-point')).toBe(true);
  });

  it('zero diameter → non-positive-diameter', () => {
    const v = validateFitting(mkFitting({ diameter: 0 }));
    expect(v.some((x) => x.kind === 'non-positive-diameter')).toBe(true);
  });
});

// ── validateScene ───────────────────────────────────────────────

describe('validateScene', () => {
  it('empty scene → no violations', () => {
    expect(validateScene([])).toEqual([]);
  });

  it('aggregates violations across pipes + fittings', () => {
    const pipes = [
      mkPipe({ id: 'good' }),
      mkPipe({ id: 'bad', diameter: -1 }),
    ];
    const fittings = [
      mkFitting({ id: 'goodf' }),
      mkFitting({ id: 'badf', quaternion: [NaN, 0, 0, 1] }),
    ];
    const v = validateScene(pipes, fittings);
    expect(v).toHaveLength(2);
    expect(v.find((x) => x.pipeId === 'bad')).toBeDefined();
    expect(v.find((x) => x.fittingId === 'badf')).toBeDefined();
  });
});
