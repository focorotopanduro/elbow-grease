/**
 * ALG-017 — `check_attic_ventilation` tests.
 *
 * Covers spec §10 edge-case matrix E-018 (solid + unvented → flag)
 * and E-019 (spaced + unvented → no flag, breathes naturally).
 */

import { describe, it, expect } from 'vitest';
import { check_attic_ventilation } from '../algorithms/ventilation';
import type { SheathingType } from '../types';

describe('ALG-017 check_attic_ventilation — E-018 canonical case', () => {
  it('solid + unvented attic → ventilation_insufficient warning', () => {
    const flag = check_attic_ventilation('solid', false);
    expect(flag).not.toBeNull();
    expect(flag?.code).toBe('ventilation_insufficient');
    expect(flag?.severity).toBe('warning');
    expect(flag?.remediation).toMatch(/vent|ridge|soffit/i);
  });

  it('solid + vented attic → null (compliant)', () => {
    expect(check_attic_ventilation('solid', true)).toBeNull();
  });
});

describe('ALG-017 — spaced sheathing breathes (E-019)', () => {
  it('spaced_with_solid_zones + unvented → null', () => {
    expect(check_attic_ventilation('spaced_with_solid_zones', false)).toBeNull();
  });

  it('spaced_with_solid_zones + vented → null', () => {
    expect(check_attic_ventilation('spaced_with_solid_zones', true)).toBeNull();
  });

  it('spaced_over_solid_hybrid + unvented → null (breathes through gaps)', () => {
    expect(check_attic_ventilation('spaced_over_solid_hybrid', false)).toBeNull();
  });

  it('spaced_over_solid_hybrid + vented → null', () => {
    expect(check_attic_ventilation('spaced_over_solid_hybrid', true)).toBeNull();
  });
});

describe('ALG-017 — exhaustive truth table', () => {
  const all_types: SheathingType[] = [
    'solid',
    'spaced_with_solid_zones',
    'spaced_over_solid_hybrid',
  ];

  it.each(all_types)('sheathing=%s + vented=true → null (compliant)', (type) => {
    expect(check_attic_ventilation(type, true)).toBeNull();
  });

  it('ONLY solid + unvented combination fires the flag', () => {
    let fire_count = 0;
    for (const type of all_types) {
      for (const vented of [true, false]) {
        const flag = check_attic_ventilation(type, vented);
        if (flag !== null) fire_count++;
      }
    }
    expect(fire_count).toBe(1);
  });
});

describe('ALG-017 — remediation + severity contract', () => {
  it('flag severity is warning (not error — bid can proceed with corrective line)', () => {
    const flag = check_attic_ventilation('solid', false);
    expect(flag?.severity).toBe('warning');
  });

  it('remediation names the corrective measures (ridge vent, soffit vents, fan)', () => {
    const flag = check_attic_ventilation('solid', false);
    expect(flag?.remediation).toMatch(/ridge|soffit|fan/i);
    // Message should also explain the WHY — condensation/rot/mold
    expect(flag?.message.toLowerCase()).toMatch(/moisture|condensation|rot/);
  });
});
