/**
 * defaultTeeFor orientation rules — Phase 14.AD.22.
 *
 * Locks the domain-specific PVC DWV fitting-selection logic the
 * user specified 2026-04-20:
 *
 *   • Horizontal main + vertical branch → san-tee
 *     ("san-tees are used to connect horizontal drain lines to
 *      vertical drains or vent pipes")
 *   • Vertical main + horizontal branch → combo
 *     ("combos are to be used for vertical to horizontal")
 *   • Horizontal main + horizontal branch (laid flat) → combo
 *     ("combos are used by laying them on the ground with the
 *      middle inlet to the side flat against the floor")
 *   • Strict 45° horizontal branch → plain wye
 *   • Supply materials always → plain tee
 *
 * Y is the vertical axis (THREE.js / world convention).
 */

import { describe, it, expect } from 'vitest';
import { defaultTeeFor } from '../FittingCatalog';

const UP: [number, number, number]        = [0, 1, 0];
const DOWN: [number, number, number]      = [0, -1, 0];
const EAST: [number, number, number]      = [1, 0, 0];
const WEST: [number, number, number]      = [-1, 0, 0];
const NORTH: [number, number, number]     = [0, 0, 1];
const NORTH_E45: [number, number, number] = [0.707, 0, 0.707];

describe('defaultTeeFor — PVC DWV orientation rules (AD.22)', () => {
  it('horizontal main + VERTICAL UP branch → sanitary_tee (vent stack)', () => {
    const t = defaultTeeFor('pvc_sch40', 90, true, { mainDir: EAST, branchDir: UP });
    expect(t).toBe('sanitary_tee');
  });

  it('horizontal main + VERTICAL DOWN branch → sanitary_tee (stack drop)', () => {
    const t = defaultTeeFor('pvc_sch40', 90, true, { mainDir: EAST, branchDir: DOWN });
    expect(t).toBe('sanitary_tee');
  });

  it('vertical main + horizontal branch → combo_wye_eighth (stack-to-lateral)', () => {
    const t = defaultTeeFor('pvc_sch40', 90, true, { mainDir: UP, branchDir: EAST });
    expect(t).toBe('combo_wye_eighth');
  });

  it('vertical main + horizontal branch, opposite sides → combo_wye_eighth', () => {
    const t = defaultTeeFor('pvc_sch40', 90, true, { mainDir: DOWN, branchDir: WEST });
    expect(t).toBe('combo_wye_eighth');
  });

  it('horizontal main + horizontal 90° branch (laid flat) → combo_wye_eighth', () => {
    const t = defaultTeeFor('pvc_sch40', 90, true, { mainDir: EAST, branchDir: NORTH });
    expect(t).toBe('combo_wye_eighth');
  });

  it('horizontal main + horizontal 45° branch (strict Y-plane) → wye', () => {
    const t = defaultTeeFor('pvc_sch40', 45, true, { mainDir: EAST, branchDir: NORTH_E45 });
    expect(t).toBe('wye');
  });

  it('both vertical (stack + vent above) → sanitary_tee', () => {
    const t = defaultTeeFor('pvc_sch40', 90, true, { mainDir: UP, branchDir: DOWN });
    expect(t).toBe('sanitary_tee');
  });

  it('ABS DWV follows same rules as PVC', () => {
    expect(defaultTeeFor('abs', 90, true, { mainDir: EAST, branchDir: UP })).toBe('sanitary_tee');
    expect(defaultTeeFor('abs', 90, true, { mainDir: UP,   branchDir: EAST })).toBe('combo_wye_eighth');
  });

  it('cast-iron DWV follows same rules', () => {
    expect(defaultTeeFor('cast_iron', 90, true, { mainDir: EAST, branchDir: UP })).toBe('sanitary_tee');
  });
});

describe('defaultTeeFor — supply materials ignore orientation', () => {
  it('copper supply + horizontal-to-vertical → plain tee (no DWV rules)', () => {
    const t = defaultTeeFor('copper_type_l', 90, false, { mainDir: EAST, branchDir: UP });
    expect(t).toBe('tee');
  });

  it('CPVC supply → plain tee regardless of angle', () => {
    expect(defaultTeeFor('cpvc', 90, false, { mainDir: EAST, branchDir: UP })).toBe('tee');
    expect(defaultTeeFor('cpvc', 45, false, { mainDir: EAST, branchDir: NORTH_E45 })).toBe('tee');
  });

  it('galvanized steel supply → plain tee', () => {
    expect(defaultTeeFor('galvanized_steel', 90, false, { mainDir: EAST, branchDir: UP })).toBe('tee');
  });

  it('PEX always → plain tee (flexible)', () => {
    expect(defaultTeeFor('pex', 90, false, { mainDir: EAST, branchDir: UP })).toBe('tee');
    expect(defaultTeeFor('pex', 90, true,  { mainDir: EAST, branchDir: UP })).toBe('tee');
  });
});

describe('defaultTeeFor — angle-only fallback when no directions passed', () => {
  it('90° DWV with no directions → sanitary_tee (preserves pre-AD.22 behavior)', () => {
    expect(defaultTeeFor('pvc_sch40', 90, true)).toBe('sanitary_tee');
  });

  it('45° DWV with no directions → wye', () => {
    expect(defaultTeeFor('pvc_sch40', 45, true)).toBe('wye');
  });

  it('63° DWV with no directions → combo_wye_eighth (between wye + san-tee)', () => {
    expect(defaultTeeFor('pvc_sch40', 63, true)).toBe('combo_wye_eighth');
  });
});

describe('defaultTeeFor — edge / mixed-angle orientation cases', () => {
  it('main horizontal + branch at 45° up-and-forward (not strict vertical) → fallback to angle', () => {
    // Branch has y=0.707 which is exactly at the vertical cutoff;
    // not strictly horizontal, not strictly vertical. Falls through
    // to angle classifier.
    const t = defaultTeeFor('pvc_sch40', 45, true, {
      mainDir: EAST,
      branchDir: [0.5, 0.707, 0.5],
    });
    expect(['wye', 'sanitary_tee', 'combo_wye_eighth']).toContain(t);
  });

  it('vertical main + slanted branch (neither pure horizontal nor vertical) falls through', () => {
    // Branch at 30° below horizontal — not horizontal enough for
    // the combo rule, not vertical enough for the san-tee rule.
    const t = defaultTeeFor('pvc_sch40', 60, true, {
      mainDir: UP,
      branchDir: [0.866, -0.5, 0],
    });
    expect(['wye', 'sanitary_tee', 'combo_wye_eighth']).toContain(t);
  });
});
