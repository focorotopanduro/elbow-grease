/**
 * PipeStandards dimensional accuracy — Phase 14.AD.6.
 *
 * Locks real-world PVC / copper / PEX / cast-iron socket depths + hub
 * oversize multipliers to their published spec values. These numbers
 * drive both the visual geometry (hub shoulder length, hub OD) AND
 * the pipe-end retraction at bend vertices. If they drift, fittings
 * render at the wrong scale AND pipes overlap/underlap their hub
 * shoulders.
 *
 * Reference:
 *   • PVC DWV: ASTM D-2665, Spears / Charlotte Plastics catalogs.
 *   • PVC Sch 40 / Sch 80 pressure: ASTM D-1785.
 *   • Copper sweat: ASME B16.22, NIBCO Wrot Copper tables.
 *   • PEX: ASTM F-877 + Uponor ProPEX fitting catalog.
 *   • Cast iron hub: CISPI 301, Charlotte Soil Pipe specs.
 */

import { describe, it, expect } from 'vitest';
import {
  getSocketDepthIn,
  getSocketDepthFt,
  getHubOuterRadiusFt,
  getBendCenterlineRadiusFt,
} from '../PipeStandards';

// ── PVC DWV (ABS uses same table) ────────────────────────────

describe('PVC / ABS DWV fitting socket depth — ASTM D-2665', () => {
  it('2" DWV socket is 1-5/8" (1.625"), not 2.375" (the pre-AD.6 bug)', () => {
    // The pre-AD.6 value of 2.375" was the pipe's OUTSIDE DIAMETER,
    // not its socket depth. Real DWV socket depth is 1-5/8".
    expect(getSocketDepthIn('abs', 2)).toBeCloseTo(1.625, 3);
  });

  it('3" DWV socket is 2-1/4" (2.25"), not 3.625"', () => {
    expect(getSocketDepthIn('abs', 3)).toBeCloseTo(2.25, 3);
  });

  it('4" DWV socket is 3.0", not 4.625"', () => {
    expect(getSocketDepthIn('abs', 4)).toBeCloseTo(3.0, 3);
  });

  it('1.5" DWV socket is 1-1/4" (1.25")', () => {
    expect(getSocketDepthIn('abs', 1.5)).toBeCloseTo(1.25, 3);
  });

  it('unknown size falls back to 0.75× nominal (sensible default)', () => {
    expect(getSocketDepthIn('abs', 0.125)).toBeCloseTo(0.125 * 0.75, 3);
  });
});

// ── PVC Sch 40 / Sch 80 pressure ─────────────────────────────

describe('PVC Sch 40 pressure fitting socket depth — ASTM D-1785', () => {
  it('2" Sch 40 socket is 1-1/2" (1.5")', () => {
    expect(getSocketDepthIn('pvc_sch40', 2)).toBeCloseTo(1.5, 3);
  });

  it('3" Sch 40 socket is 2-1/4" (2.25")', () => {
    expect(getSocketDepthIn('pvc_sch40', 3)).toBeCloseTo(2.25, 3);
  });

  it('4" Sch 40 socket is 3.0"', () => {
    expect(getSocketDepthIn('pvc_sch40', 4)).toBeCloseTo(3.0, 3);
  });

  it('1" Sch 40 socket is 7/8" (0.875")', () => {
    expect(getSocketDepthIn('pvc_sch40', 1)).toBeCloseTo(0.875, 3);
  });
});

describe('PVC Sch 80 pressure fitting socket depth — ASTM D-1785', () => {
  it('2" Sch 80 socket matches Sch 40 (same hub body, thicker wall)', () => {
    expect(getSocketDepthIn('pvc_sch80', 2)).toBeCloseTo(
      getSocketDepthIn('pvc_sch40', 2),
      3,
    );
  });

  it('4" Sch 80 socket is 3.0"', () => {
    expect(getSocketDepthIn('pvc_sch80', 4)).toBeCloseTo(3.0, 3);
  });
});

// ── Copper sweat depth (reference) ───────────────────────────

describe('Copper sweat-joint depth — ASME B16.22', () => {
  it('1/2" type L is 0.500"', () => {
    expect(getSocketDepthIn('copper_type_l', 0.5)).toBeCloseTo(0.5, 3);
  });

  it('2" type L is 1.375"', () => {
    expect(getSocketDepthIn('copper_type_l', 2)).toBeCloseTo(1.375, 3);
  });
});

// ── Cast iron hub depth (reference) ──────────────────────────

describe('Cast iron hub depth — CISPI 301', () => {
  it('2" cast iron hub is 2.5"', () => {
    expect(getSocketDepthIn('cast_iron', 2)).toBeCloseTo(2.5, 3);
  });

  it('4" cast iron hub is 3.5"', () => {
    expect(getSocketDepthIn('cast_iron', 4)).toBeCloseTo(3.5, 3);
  });
});

// ── Socket depth → feet conversion ───────────────────────────

describe('getSocketDepthFt conversion', () => {
  it('returns inches / 12 for any material', () => {
    const in2Depth = getSocketDepthIn('abs', 2);
    expect(getSocketDepthFt('abs', 2)).toBeCloseTo(in2Depth / 12, 5);
  });
});

// ── Hub oversize (hub OD is wider than pipe OD) ──────────────

describe('Hub oversize ratio per material', () => {
  it('PVC Sch 40: hub OD ≈ 1.16× pipe OD (DWV fitting ring)', () => {
    // 2" DWV pipe OD = 2.375". Hub OD should be ~2.75 → ratio ~1.158.
    const pipeOdFt = 2.375 / 12;
    const hubRadiusFt = getHubOuterRadiusFt('pvc_sch40', pipeOdFt);
    const hubOdFt = hubRadiusFt * 2;
    const ratio = hubOdFt / pipeOdFt;
    expect(ratio).toBeCloseTo(1.16, 2);
  });

  it('Copper: hub OD only marginally wider than pipe OD (~1.04)', () => {
    const pipeOdFt = 2.125 / 12; // nominal 2" copper OD
    const hubRadiusFt = getHubOuterRadiusFt('copper_type_l', pipeOdFt);
    const hubOdFt = hubRadiusFt * 2;
    const ratio = hubOdFt / pipeOdFt;
    expect(ratio).toBeCloseTo(1.04, 2);
  });

  it('Cast iron: dramatically wider hub (~1.3×)', () => {
    const pipeOdFt = 2.375 / 12; // 2" CI no-hub ≈ same OD as PVC
    const hubRadiusFt = getHubOuterRadiusFt('cast_iron', pipeOdFt);
    const hubOdFt = hubRadiusFt * 2;
    const ratio = hubOdFt / pipeOdFt;
    expect(ratio).toBeCloseTo(1.30, 2);
  });
});

// ── Galvanized steel NPT engagement per ASME B1.20.1 (AD.15) ──

describe('Galvanized steel NPT thread engagement — ASME B1.20.1', () => {
  it('1/2" L2 engagement = 0.5337"', () => {
    expect(getSocketDepthIn('galvanized_steel', 0.5)).toBeCloseTo(0.5337, 3);
  });

  it('3/4" L2 engagement = 0.5457"', () => {
    expect(getSocketDepthIn('galvanized_steel', 0.75)).toBeCloseTo(0.5457, 3);
  });

  it('1" L2 engagement = 0.6828"', () => {
    expect(getSocketDepthIn('galvanized_steel', 1)).toBeCloseTo(0.6828, 3);
  });

  it('2" L2 engagement = 0.7565"', () => {
    expect(getSocketDepthIn('galvanized_steel', 2)).toBeCloseTo(0.7565, 3);
  });

  it('4" L2 engagement = 1.3000" (NOT the old 0.9× = 3.6")', () => {
    // This is the biggest correction — pre-AD.15, 4" galvanized
    // had a 3.6" socket depth (0.9 × 4). Real L2 is 1.3".
    expect(getSocketDepthIn('galvanized_steel', 4)).toBeCloseTo(1.3, 3);
  });

  it('unknown size falls back to 0.9× nominal (legacy behavior for sizes outside the table)', () => {
    // 5.5" isn't in the NPT table; fall through to the old flat
    // multiplier. Keeps behavior stable for unusual sizes while
    // fixing the standard range.
    expect(getSocketDepthIn('galvanized_steel', 5.5)).toBeCloseTo(5.5 * 0.9, 3);
  });

  it('engagement values are monotonically non-decreasing with size', () => {
    // Sanity check: a 2" fitting must have at least as much thread
    // engagement as a 1" fitting.
    let prev = 0;
    for (const size of [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]) {
      const L2 = getSocketDepthIn('galvanized_steel', size);
      expect(L2).toBeGreaterThanOrEqual(prev);
      prev = L2;
    }
  });
});

// ── Bend centerline radius — ASTM fitting spec ───────────────

describe('Bend centerline radius per fitting class', () => {
  const pipeOdFt = 2.375 / 12;

  it('PVC short-sweep 90°: centerline R ≈ 1.5× OD', () => {
    const r = getBendCenterlineRadiusFt('pvc_sch40', pipeOdFt, 'short_sweep');
    expect(r / pipeOdFt).toBeCloseTo(1.5, 2);
  });

  it('PVC long-sweep 90°: centerline R ≈ 3.0× OD', () => {
    const r = getBendCenterlineRadiusFt('pvc_sch40', pipeOdFt, 'long_sweep');
    expect(r / pipeOdFt).toBeCloseTo(3.0, 2);
  });

  it('PVC 45° (1/8 bend): centerline R ≈ 1.0× OD', () => {
    const r = getBendCenterlineRadiusFt('pvc_sch40', pipeOdFt, 'eighth');
    expect(r / pipeOdFt).toBeCloseTo(1.0, 2);
  });

  it('Copper 90° tighter than PVC (~1.0× OD instead of 1.5×)', () => {
    const r = getBendCenterlineRadiusFt('copper_type_l', pipeOdFt, 'short_sweep');
    expect(r / pipeOdFt).toBeCloseTo(1.0, 2);
  });
});
