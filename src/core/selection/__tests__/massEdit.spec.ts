/**
 * massEdit — Phase 14.N tests.
 *
 * Covers:
 *   • applyPipeEdit: diff vs current, unchanged-when-same
 *   • visibility ops (show / hide / unchanged)
 *   • summarizeSelection: histograms sorted sensibly
 *   • isEmptyChangeSet: recognizes various no-op shapes
 *   • changeSetAffectsAny: true only when at least one pipe diffs
 *   • human formatters (material, system, diameter)
 */

import { describe, it, expect } from 'vitest';
import {
  applyPipeEdit,
  summarizeSelection,
  isEmptyChangeSet,
  changeSetAffectsAny,
  humanMaterial,
  humanSystem,
  humanDiameter,
  type EditablePipe,
  type PipeChangeSet,
} from '../massEdit';

// ── Fixtures ──────────────────────────────────────────────────

function mkPipe(overrides: Partial<EditablePipe> = {}): EditablePipe {
  return {
    id: 'p1',
    material: 'pvc_sch40',
    diameter: 2,
    system: 'waste',
    visible: true,
    ...overrides,
  };
}

// ── applyPipeEdit ─────────────────────────────────────────────

describe('applyPipeEdit', () => {
  it('no-op when change-set is empty', () => {
    const r = applyPipeEdit(mkPipe(), {});
    expect(r.changed).toBe(false);
    expect(r.material).toBeUndefined();
    expect(r.diameter).toBeUndefined();
    expect(r.system).toBeUndefined();
  });

  it('no-op when change matches current value', () => {
    const r = applyPipeEdit(mkPipe({ material: 'pvc_sch40' }), { material: 'pvc_sch40' });
    expect(r.changed).toBe(false);
    expect(r.material).toBeUndefined();
  });

  it('emits only the field that actually differs (material)', () => {
    const r = applyPipeEdit(mkPipe(), { material: 'copper_type_l', diameter: 2 });
    expect(r.changed).toBe(true);
    expect(r.material).toBe('copper_type_l');
    expect(r.diameter).toBeUndefined(); // same as current, skipped
  });

  it('emits multiple fields when multiple differ', () => {
    const r = applyPipeEdit(
      mkPipe(),
      { material: 'copper_type_l', diameter: 1, system: 'cold_supply' },
    );
    expect(r.changed).toBe(true);
    expect(r.material).toBe('copper_type_l');
    expect(r.diameter).toBe(1);
    expect(r.system).toBe('cold_supply');
  });

  it('visibility: show forces visible=true when hidden', () => {
    const r = applyPipeEdit(mkPipe({ visible: false }), { visibility: 'show' });
    expect(r.changed).toBe(true);
    expect(r.visible).toBe(true);
  });

  it('visibility: hide forces visible=false when visible', () => {
    const r = applyPipeEdit(mkPipe({ visible: true }), { visibility: 'hide' });
    expect(r.changed).toBe(true);
    expect(r.visible).toBe(false);
  });

  it('visibility: unchanged is a no-op', () => {
    const r = applyPipeEdit(mkPipe(), { visibility: 'unchanged' });
    expect(r.changed).toBe(false);
    expect(r.visible).toBeUndefined();
  });

  it('visibility: no diff when already in target state', () => {
    const r = applyPipeEdit(mkPipe({ visible: true }), { visibility: 'show' });
    expect(r.changed).toBe(false);
    expect(r.visible).toBeUndefined();
  });
});

// ── summarizeSelection ───────────────────────────────────────

describe('summarizeSelection', () => {
  it('counts empty selection', () => {
    const s = summarizeSelection([], 0);
    expect(s.pipeCount).toBe(0);
    expect(s.fixtureCount).toBe(0);
    expect(s.pipes.materials).toEqual([]);
  });

  it('histograms materials, sorted by count desc', () => {
    const s = summarizeSelection(
      [
        mkPipe({ id: '1', material: 'pvc_sch40' }),
        mkPipe({ id: '2', material: 'pvc_sch40' }),
        mkPipe({ id: '3', material: 'copper_type_l' }),
      ],
      0,
    );
    expect(s.pipes.materials).toEqual([
      { value: 'pvc_sch40', count: 2 },
      { value: 'copper_type_l', count: 1 },
    ]);
  });

  it('histograms diameters, sorted ascending by value', () => {
    const s = summarizeSelection(
      [
        mkPipe({ id: '1', diameter: 3 }),
        mkPipe({ id: '2', diameter: 2 }),
        mkPipe({ id: '3', diameter: 2 }),
        mkPipe({ id: '4', diameter: 4 }),
      ],
      0,
    );
    expect(s.pipes.diameters).toEqual([
      { value: 2, count: 2 },
      { value: 3, count: 1 },
      { value: 4, count: 1 },
    ]);
  });

  it('counts visible vs hidden', () => {
    const s = summarizeSelection(
      [
        mkPipe({ id: '1', visible: true }),
        mkPipe({ id: '2', visible: true }),
        mkPipe({ id: '3', visible: false }),
      ],
      0,
    );
    expect(s.pipes.visibleCount).toBe(2);
    expect(s.pipes.hiddenCount).toBe(1);
  });

  it('carries fixture count as provided', () => {
    const s = summarizeSelection([], 7);
    expect(s.fixtureCount).toBe(7);
  });
});

// ── isEmptyChangeSet ─────────────────────────────────────────

describe('isEmptyChangeSet', () => {
  it('true for literally empty object', () => {
    expect(isEmptyChangeSet({})).toBe(true);
  });

  it('true when all pipe fields are undefined/unchanged', () => {
    expect(isEmptyChangeSet({ pipes: { visibility: 'unchanged' } })).toBe(true);
    expect(isEmptyChangeSet({ pipes: {} })).toBe(true);
  });

  it('false when any pipe field is set', () => {
    expect(isEmptyChangeSet({ pipes: { diameter: 2 } })).toBe(false);
    expect(isEmptyChangeSet({ pipes: { visibility: 'hide' } })).toBe(false);
  });

  it('false when fixture visibility is set', () => {
    expect(isEmptyChangeSet({ fixtures: { visibility: 'show' } })).toBe(false);
  });
});

// ── changeSetAffectsAny ──────────────────────────────────────

describe('changeSetAffectsAny', () => {
  it('false when no change-set is supplied', () => {
    expect(changeSetAffectsAny([mkPipe()], {})).toBe(false);
  });

  it('false when change-set matches all existing pipes', () => {
    const pipes = [mkPipe({ material: 'pvc_sch40', diameter: 2 }), mkPipe({ id: 'p2', material: 'pvc_sch40', diameter: 2 })];
    const set: { pipes: PipeChangeSet } = { pipes: { material: 'pvc_sch40', diameter: 2 } };
    expect(changeSetAffectsAny(pipes, set)).toBe(false);
  });

  it('true when at least one pipe would change', () => {
    const pipes = [mkPipe({ diameter: 2 }), mkPipe({ id: 'p2', diameter: 3 })];
    const set: { pipes: PipeChangeSet } = { pipes: { diameter: 2 } };
    expect(changeSetAffectsAny(pipes, set)).toBe(true); // p2 goes 3 → 2
  });
});

// ── Human formatters ────────────────────────────────────────

describe('humanMaterial', () => {
  it('maps known materials', () => {
    expect(humanMaterial('pvc_sch40')).toBe('PVC Sch 40');
    expect(humanMaterial('copper_type_l')).toBe('Copper Type L');
    expect(humanMaterial('pex')).toBe('PEX');
  });
  it('returns the raw value for unknown materials', () => {
    expect(humanMaterial('unobtanium')).toBe('unobtanium');
  });
});

describe('humanSystem', () => {
  it('maps each SystemType', () => {
    expect(humanSystem('waste')).toBe('Waste');
    expect(humanSystem('vent')).toBe('Vent');
    expect(humanSystem('cold_supply')).toBe('Cold Supply');
    expect(humanSystem('hot_supply')).toBe('Hot Supply');
    expect(humanSystem('storm')).toBe('Storm');
  });
});

describe('humanDiameter', () => {
  it('formats common sizes', () => {
    expect(humanDiameter(0.5)).toBe('½″');
    expect(humanDiameter(0.75)).toBe('¾″');
    expect(humanDiameter(1)).toBe('1″');
    expect(humanDiameter(1.5)).toBe('1½″');
    expect(humanDiameter(2)).toBe('2″');
    expect(humanDiameter(2.5)).toBe('2½″');
    expect(humanDiameter(4)).toBe('4″');
  });
});
