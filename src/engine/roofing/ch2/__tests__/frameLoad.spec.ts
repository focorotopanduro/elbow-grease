/**
 * ALG-016 — `flag_frame_load_check_needed` tests.
 *
 * Covers all 6 implicit scenarios plus spec §10 E-017 (reroof with
 * heavier new covering fires the flag).
 */

import { describe, it, expect } from 'vitest';
import { flag_frame_load_check_needed } from '../algorithms/frameLoad';

describe('ALG-016 flag_frame_load_check_needed — non-reroof path', () => {
  it('new construction (is_reroof=false) → always null regardless of weights', () => {
    expect(flag_frame_load_check_needed(10, null, false)).toBeNull();
    expect(flag_frame_load_check_needed(10, 5, false)).toBeNull();
    expect(flag_frame_load_check_needed(10, 15, false)).toBeNull();
    expect(flag_frame_load_check_needed(2, 5, false)).toBeNull();
  });
});

describe('ALG-016 — reroof with unknown existing weight', () => {
  it('existing=null → always fires flag (conservative)', () => {
    const flag = flag_frame_load_check_needed(3, null, true);
    expect(flag).not.toBeNull();
    expect(flag?.code).toBe('frame_load_check_required');
    expect(flag?.severity).toBe('warning');
    expect(flag?.message).toContain('unknown');
  });

  it('existing=null with very light new covering → still fires (can\'t prove safe)', () => {
    const flag = flag_frame_load_check_needed(0.5, null, true);
    expect(flag).not.toBeNull();
  });
});

describe('ALG-016 — reroof with known existing weight', () => {
  // E-017: heavier new covering → flag
  it('heavier new (6 psf) over existing (5 psf) → flag (E-017)', () => {
    const flag = flag_frame_load_check_needed(6, 5, true);
    expect(flag).not.toBeNull();
    expect(flag?.code).toBe('frame_load_check_required');
    // Message should quote both weights for the bid reviewer
    expect(flag?.message).toContain('6.00');
    expect(flag?.message).toContain('5.00');
  });

  it('equal weights (5 = 5) → null (no load increase)', () => {
    expect(flag_frame_load_check_needed(5, 5, true)).toBeNull();
  });

  it('lighter new (3 psf) over heavier existing (5 psf) → null (frame safe)', () => {
    expect(flag_frame_load_check_needed(3, 5, true)).toBeNull();
  });

  // Boundary — strictly greater (>)
  it('new marginally heavier (5.001 > 5) → flag', () => {
    const flag = flag_frame_load_check_needed(5.001, 5, true);
    expect(flag).not.toBeNull();
  });

  it('new marginally lighter (4.999 < 5) → null', () => {
    expect(flag_frame_load_check_needed(4.999, 5, true)).toBeNull();
  });
});

describe('ALG-016 — remediation text present', () => {
  it('unknown-existing flag has a remediation pointer', () => {
    const flag = flag_frame_load_check_needed(3, null, true);
    expect(flag?.remediation).toBeDefined();
    expect(flag?.remediation).toMatch(/engineer|survey|as-built/i);
  });

  it('heavier-new flag has a remediation pointer', () => {
    const flag = flag_frame_load_check_needed(10, 5, true);
    expect(flag?.remediation).toBeDefined();
    expect(flag?.remediation).toMatch(/engineer|lighter/i);
  });
});

describe('ALG-016 — typical scenarios', () => {
  it('reroof: asphalt (2 psf) → tile (10 psf) → flag (classic E-017)', () => {
    const flag = flag_frame_load_check_needed(10, 2, true);
    expect(flag).not.toBeNull();
  });

  it('reroof: tile (10 psf) → asphalt (2 psf) → null (much lighter)', () => {
    const flag = flag_frame_load_check_needed(2, 10, true);
    expect(flag).toBeNull();
  });

  it('reroof: asphalt → fiberglass (both ~2 psf) → null (same weight)', () => {
    const flag = flag_frame_load_check_needed(2.0, 2.0, true);
    expect(flag).toBeNull();
  });
});
