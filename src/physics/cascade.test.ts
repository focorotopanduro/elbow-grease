/**
 * Reliability-contract tests for cascade.ts
 *
 * IMPORTANT MODELING NOTE
 * -----------------------
 * The cascade uses GCpi = ±0.55 (partially-enclosed) as the worst-case
 * assumption appropriate for WBDR — i.e. the building's envelope can be
 * breached by windborne debris. This is intentionally conservative and
 * means even moderate winds can lift Class D shingles at the corners /
 * edges, and Class H shingles can be just over their cap in the field at
 * Orlando design wind (130 mph).
 *
 * If a homeowner has impact-rated openings + intact shutters and we
 * could justify a fully-enclosed GCpi = 0.18, all uplift values drop
 * by ~30%. We do not assume this in v1.
 */
import { describe, it, expect } from 'vitest';
import { buildFailureCascade, failureWindSpeed } from './cascade';
import { INSTALL_PROFILES } from './resistance';

const codeMin = INSTALL_PROFILES.code_min;
const fbc = INSTALL_PROFILES.fbc_wbdr;

describe('buildFailureCascade — code_min profile', () => {
  it('at 60 mph: drip edge does NOT trigger (corner uplift ~17 psf < 30 trigger)', () => {
    const r = buildFailureCascade(60, codeMin);
    expect(r.stages.find((s) => s.id === 'drip_edge')?.triggered).toBe(false);
  });

  it('at 60 mph: corner Class D shingles ARE lifted (worst-case GCpi)', () => {
    // Honest physics: partially-enclosed loading + Class D 12 psf cap
    // means corner tabs (uplift ~17 psf) already over capacity at 60 mph.
    const r = buildFailureCascade(60, codeMin);
    expect(r.stages.find((s) => s.id === 'field_shingles')?.triggered).toBe(true);
  });

  it('at 80 mph: drip edge triggers (corner suction past 30 psf)', () => {
    const r = buildFailureCascade(80, codeMin);
    expect(r.stages.find((s) => s.id === 'drip_edge')?.triggered).toBe(true);
  });

  it('at 175 mph (Andrew): every stage triggers', () => {
    const r = buildFailureCascade(175, codeMin);
    r.stages.forEach((s) => expect(s.triggered).toBe(true));
    expect(r.highestStageReached).toBe('sheathing');
  });

  it('marginPsf is negative at the corner when capacity is exceeded', () => {
    const r = buildFailureCascade(140, codeMin);
    expect(r.marginPsf.corner).toBeLessThan(0);
  });
});

describe('buildFailureCascade — fbc_wbdr profile', () => {
  it('at Orlando design (130 mph) Class H field cap is just exceeded under WBDR loading', () => {
    // Honest physics: field uplift 37.3 psf vs Class H 35 psf cap →
    // field shingles can lift at design wind under partially-enclosed
    // assumption. This is a teachable moment for the homeowner.
    const r = buildFailureCascade(130, fbc);
    expect(r.uplift.field).toBeGreaterThan(r.resistance.shingleCapPsf);
  });

  it('SWB label appears in the underlayment stage', () => {
    const r = buildFailureCascade(150, fbc);
    const u = r.stages.find((s) => s.id === 'underlayment');
    expect(u?.label.toLowerCase()).toContain('swb');
  });

  it('sheathing does not blow off until extreme winds (>>175 mph) for fbc_wbdr', () => {
    const r = buildFailureCascade(175, fbc);
    expect(r.stages.find((s) => s.id === 'sheathing')?.triggered).toBe(false);
  });
});

describe('failureWindSpeed — bisection helper', () => {
  it('returns the (very low) threshold V where Class D corner shingles first lift', () => {
    // Class D + partially-enclosed pushes the trigger down to ~50 mph.
    const V = failureWindSpeed('field_shingles', codeMin);
    expect(V).not.toBeNull();
    expect(V!).toBeGreaterThan(40);
    expect(V!).toBeLessThan(80);
  });

  it('upgrade significantly raises the shingle-failure threshold', () => {
    const oldV = failureWindSpeed('field_shingles', codeMin)!;
    const newV = failureWindSpeed('field_shingles', fbc)!;
    expect(newV).toBeGreaterThan(oldV);
  });

  it('returns null when stage never triggers in the search range', () => {
    // sheathing under fbc_wbdr in [50, 220] should never trigger
    const V = failureWindSpeed('sheathing', fbc, undefined, [50, 220]);
    expect(V).toBeNull();
  });
});

describe('Cascade ordering invariants', () => {
  it('stages are returned in physical order: drip → field → underlayment → sheathing', () => {
    const r = buildFailureCascade(120, codeMin);
    const ids = r.stages.map((s) => s.id);
    expect(ids).toEqual(['drip_edge', 'field_shingles', 'underlayment', 'sheathing']);
  });

  it('underlayment never triggers while ALL shingles intact', () => {
    for (let V = 60; V <= 200; V += 10) {
      const r = buildFailureCascade(V, codeMin);
      const fieldOn = r.stages.find((s) => s.id === 'field_shingles')?.triggered;
      const underOn = r.stages.find((s) => s.id === 'underlayment')?.triggered;
      if (underOn) expect(fieldOn).toBe(true);
    }
  });
});
