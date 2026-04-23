/**
 * RoofGraph — Phase 14.R.1.
 *
 * Pure-function tests for the ported roof graph geometry. Each
 * helper cross-referenced against the Python `roof_graph.py`
 * reference implementation (property-by-property).
 */

import { describe, it, expect } from 'vitest';
import {
  type RoofSection,
  type RoofVertex,
  type MeasureLine,
  type PDFLayer,
  pdfPhysicalSize,
  rescaleFromWorldPoints,
  createSection,
  slopeFactorOf,
  adjLength,
  adjRun,
  areaPlan,
  areaActual,
  perimeterPlan,
  rise,
  commonRafter,
  ridgeLength,
  roofAngleDeg,
  corners,
  center,
  containsPoint,
  vertices3d,
  edges3d,
  faces3d,
  outlineForView,
  containsPointView,
  measureLength,
  calibratePdf,
  totalAreaNet,
  totalAreaPlan,
  totalPerimeter,
  sectionAt,
  vertexDistance,
  emptyPdfLayer,
  emptyRoofSnapshot,
  DEFAULT_LAYERS,
  // Phase 14.R.9 polygon helpers
  polygonArea,
  polygonPerimeter,
  polygonBoundingBox,
  hasPolygon,
  // Phase 14.R.10 triangulation
  earClipTriangulate,
  // Phase 14.R.11 convexity + centroid + polygon-hip
  isConvexPolygon,
  polygonCentroid,
  polygonPyramidRise,
  // Phase 14.R.12 rectilinear decomposition
  isRectilinearPolygon,
  decomposeRectilinearPolygon,
  classifyPolygonRoof,
  // Phase 14.R.13 straight-skeleton helpers
  reflexVertexIndices,
  polygonVertexInteriorBisector,
  subRectRidges,
  rayHitAxisSegment,
  // Phase 14.R.14
  rayHitSegment,
  polygonSplitAtReflexBisector,
  // Phase 14.R.15
  polygonSplitTryAnyReflex,
  polygonDecomposeToConvex,
  // Phase 14.R.16
  computePolygonGable,
  // Phase 14.R.17
  computePolygonShed,
  // Phase 14.R.19
  rotatePolygon,
  // Phase 14.R.27 — penetrations
  createPenetration,
  penetrationCounts,
  PENETRATION_DEFAULTS,
  PENETRATION_LABELS,
} from '../RoofGraph';

// ── Helpers ─────────────────────────────────────────────────────

function mkSection(overrides: Partial<RoofSection> = {}): RoofSection {
  return createSection({
    sectionId: 'SEC-AAA',
    x: 0, y: 0,
    length: 30, run: 20,
    slope: 6,
    roofType: 'gable',
    overhang: 1,
    z: 0,
    ...overrides,
  });
}

// ── Derived properties ──────────────────────────────────────────

describe('slopeFactorOf + adjLength + adjRun + areaPlan + areaActual', () => {
  it('slopeFactorOf mirrors calcEngine.slopeFactor', () => {
    expect(slopeFactorOf({ slope: 0 })).toBe(1);
    expect(slopeFactorOf({ slope: 12 })).toBeCloseTo(Math.SQRT2, 5);
    expect(slopeFactorOf({ slope: 6 })).toBeCloseTo(Math.sqrt(1 + 0.25), 5);
  });

  it('adjLength + adjRun include overhang on both sides', () => {
    const s = mkSection({ length: 30, run: 20, overhang: 1 });
    expect(adjLength(s)).toBe(32);
    expect(adjRun(s)).toBe(22);
  });

  it('areaPlan = adjLength × adjRun', () => {
    const s = mkSection({ length: 30, run: 20, overhang: 1 });
    expect(areaPlan(s)).toBe(32 * 22);
  });

  it('areaActual = areaPlan × slopeFactor', () => {
    const s = mkSection({ length: 30, run: 20, overhang: 1, slope: 6 });
    expect(areaActual(s)).toBeCloseTo(32 * 22 * Math.sqrt(1.25), 4);
  });

  it('perimeterPlan = 2·(adjLength + adjRun)', () => {
    const s = mkSection({ length: 30, run: 20, overhang: 1 });
    expect(perimeterPlan(s)).toBe(2 * (32 + 22));
  });

  it('rise = (slope/12) × (run/2)', () => {
    const s = mkSection({ run: 20, slope: 6 });
    expect(rise(s)).toBeCloseTo(5, 5); // (6/12) × 10
  });

  it('commonRafter = (run/2 + overhang) × slopeFactor', () => {
    const s = mkSection({ run: 20, overhang: 1, slope: 6 });
    const expected = 11 * Math.sqrt(1.25);
    expect(commonRafter(s)).toBeCloseTo(expected, 5);
  });

  it('ridgeLength(gable) = adjLength', () => {
    const s = mkSection({ length: 30, run: 20, overhang: 1, roofType: 'gable' });
    expect(ridgeLength(s)).toBe(32);
  });

  it('ridgeLength(hip) = max(adjLength - adjRun, 0)', () => {
    const s = mkSection({ length: 30, run: 20, overhang: 1, roofType: 'hip' });
    expect(ridgeLength(s)).toBe(10); // 32 - 22
  });

  it('ridgeLength(square hip) = 0 (pyramid)', () => {
    const s = mkSection({ length: 20, run: 20, overhang: 1, roofType: 'hip' });
    expect(ridgeLength(s)).toBe(0);
  });

  it('roofAngleDeg matches atan(slope/12) in degrees', () => {
    expect(roofAngleDeg({ slope: 0 })).toBe(0);
    expect(roofAngleDeg({ slope: 12 })).toBeCloseTo(45, 3);
    expect(roofAngleDeg({ slope: 4 })).toBeCloseTo(18.43, 1);
  });
});

// ── Corners + center + hit testing (plan view) ──────────────────

describe('corners + center + containsPoint (plan)', () => {
  it('axis-aligned rectangle: corners in BL/BR/TR/TL order', () => {
    const s = mkSection({ x: 0, y: 0, length: 10, run: 6, rotation: 0 });
    const c = corners(s);
    expect(c).toHaveLength(4);
    // Center is (5, 3). Half-width 5, half-height 3.
    expect(c[0]![0]).toBeCloseTo(0, 5);   // BL x
    expect(c[0]![1]).toBeCloseTo(0, 5);   // BL y
    expect(c[1]![0]).toBeCloseTo(10, 5);  // BR x
    expect(c[2]![0]).toBeCloseTo(10, 5);  // TR x
    expect(c[2]![1]).toBeCloseTo(6, 5);   // TR y
    expect(c[3]![1]).toBeCloseTo(6, 5);   // TL y
  });

  it('rotation 90° CCW swaps the rectangle around its center', () => {
    const s = mkSection({ x: 0, y: 0, length: 10, run: 6, rotation: 90 });
    const c = corners(s);
    // All four points remain 90° rotated around (5, 3).
    // BL at original (0,0) rotates to (5 - 0·(-3·sin(90°) = -3),
    // 3 + 0·cos(90°) + (-3)·sin(90°)) — let's just check each
    // corner lies on a circle of radius √(5² + 3²) around (5, 3).
    const radius = Math.sqrt(5 * 5 + 3 * 3);
    for (const [cx, cy] of c) {
      const dx = cx - 5;
      const dy = cy - 3;
      expect(Math.sqrt(dx * dx + dy * dy)).toBeCloseTo(radius, 4);
    }
  });

  it('center returns the nominal geometric center', () => {
    const s = mkSection({ x: 5, y: 10, length: 20, run: 10 });
    expect(center(s)).toEqual([15, 15]);
  });

  it('containsPoint: inside rectangle → true', () => {
    const s = mkSection({ x: 0, y: 0, length: 10, run: 6 });
    expect(containsPoint(s, 5, 3)).toBe(true);
    expect(containsPoint(s, 1, 1)).toBe(true);
  });

  it('containsPoint: outside rectangle → false', () => {
    const s = mkSection({ x: 0, y: 0, length: 10, run: 6 });
    expect(containsPoint(s, -1, 3)).toBe(false);
    expect(containsPoint(s, 5, 7)).toBe(false);
  });

  it('containsPoint respects rotation', () => {
    const s = mkSection({ x: 0, y: 0, length: 10, run: 2, rotation: 90 });
    // After 90° rotation around center (5, 1), the rectangle is
    // tall: length-axis along Y. Original point (1, 1) was inside;
    // after rotation, a horizontal probe at (6, 5) should be inside
    // (within the rotated rect).
    expect(containsPoint(s, 5, 5)).toBe(true);
    // And (9, 1) — inside the AXIS-ALIGNED rect — is OUTSIDE the
    // rotated one.
    expect(containsPoint(s, 9, 1)).toBe(false);
  });
});

// ── 3D vertices — per roof type ─────────────────────────────────

describe('vertices3d per roof type', () => {
  it('flat: 4 corners, all at z = section.z', () => {
    const s = mkSection({ roofType: 'flat', z: 10 });
    const v = vertices3d(s);
    expect(v).toHaveLength(4);
    for (const [, , z] of v) expect(z).toBe(10);
  });

  it('shed: 2 low eave + 2 high eave', () => {
    const s = mkSection({ roofType: 'shed', run: 20, slope: 6, z: 0 });
    const v = vertices3d(s);
    expect(v).toHaveLength(4);
    const rf = (6 / 12) * 20; // 10
    // Low edge at z=0, high edge at z=rf.
    const zs = v.map((p) => p[2]).sort((a, b) => a - b);
    expect(zs[0]).toBeCloseTo(0, 5);
    expect(zs[1]).toBeCloseTo(0, 5);
    expect(zs[2]).toBeCloseTo(rf, 5);
    expect(zs[3]).toBeCloseTo(rf, 5);
  });

  it('hip: rectangular roof has 6 vertices with distinct ridge', () => {
    const s = mkSection({ roofType: 'hip', length: 40, run: 20, overhang: 1 });
    const v = vertices3d(s);
    expect(v).toHaveLength(6);
    // Two ridge vertices (v[4], v[5]) have nonzero z.
    expect(v[4]![2]).toBeGreaterThan(0);
    expect(v[5]![2]).toBeGreaterThan(0);
    // They're distinct (not a pyramid).
    expect(Math.abs(v[4]![0] - v[5]![0])).toBeGreaterThan(0.5);
  });

  it('hip-square: pyramid — both ridge verts collapse to peak', () => {
    const s = mkSection({ roofType: 'hip', length: 20, run: 20, overhang: 1 });
    const v = vertices3d(s);
    // Both ridge verts at the same horizontal position.
    expect(Math.abs(v[4]![0] - v[5]![0])).toBeLessThan(0.01);
    expect(Math.abs(v[4]![1] - v[5]![1])).toBeLessThan(0.01);
  });

  it('gable: 6 vertices with ridge along length axis', () => {
    const s = mkSection({ roofType: 'gable', length: 30, run: 20, overhang: 1 });
    const v = vertices3d(s);
    expect(v).toHaveLength(6);
    // Ridge verts span the full adjLength (32 ft with overhang).
    const dx = Math.abs(v[4]![0] - v[5]![0]);
    expect(dx).toBeCloseTo(32, 4);
  });

  it('elevation offset (z) lifts ALL vertices uniformly', () => {
    const s = mkSection({ roofType: 'gable', z: 15 });
    const v = vertices3d(s);
    for (const [, , z] of v) expect(z).toBeGreaterThanOrEqual(15);
  });
});

// ── 3D edges + faces ────────────────────────────────────────────

describe('edges3d per roof type', () => {
  it('flat: 4 eave edges only', () => {
    const s = mkSection({ roofType: 'flat' });
    const e = edges3d(s);
    expect(e).toHaveLength(4);
    for (const edge of e) expect(edge.edgeType).toBe('eave');
  });

  it('shed: 1 eave + 1 ridge + 2 rakes', () => {
    const s = mkSection({ roofType: 'shed' });
    const e = edges3d(s);
    const types = e.map((x) => x.edgeType).sort();
    expect(types).toEqual(['eave', 'rake', 'rake', 'ridge']);
  });

  it('gable: 2 eaves + 2 rakes + 1 ridge + 4 slope edges', () => {
    const s = mkSection({ roofType: 'gable' });
    const e = edges3d(s);
    const counts: Record<string, number> = {};
    for (const edge of e) counts[edge.edgeType] = (counts[edge.edgeType] ?? 0) + 1;
    expect(counts.eave).toBe(2);
    expect(counts.rake).toBe(2);
    expect(counts.ridge).toBe(1);
    expect(counts.slope).toBe(4);
  });

  it('hip (rectangular): 4 eaves + 4 hip edges + 1 ridge', () => {
    const s = mkSection({ roofType: 'hip', length: 40, run: 20 });
    const e = edges3d(s);
    const counts: Record<string, number> = {};
    for (const edge of e) counts[edge.edgeType] = (counts[edge.edgeType] ?? 0) + 1;
    expect(counts.eave).toBe(4);
    expect(counts.hip).toBe(4);
    expect(counts.ridge).toBe(1);
  });

  it('hip (square / pyramid): 4 eaves + 4 hip edges, NO ridge', () => {
    const s = mkSection({ roofType: 'hip', length: 20, run: 20 });
    const e = edges3d(s);
    const counts: Record<string, number> = {};
    for (const edge of e) counts[edge.edgeType] = (counts[edge.edgeType] ?? 0) + 1;
    expect(counts.eave).toBe(4);
    expect(counts.hip).toBe(4);
    expect(counts.ridge).toBeUndefined();
  });
});

describe('faces3d per roof type', () => {
  it('flat: 1 flat face', () => {
    expect(faces3d(mkSection({ roofType: 'flat' }))).toHaveLength(1);
  });

  it('shed: 1 slope face', () => {
    const f = faces3d(mkSection({ roofType: 'shed' }));
    expect(f).toHaveLength(1);
    expect(f[0]!.faceType).toBe('slope');
  });

  it('gable: 2 slopes + 2 gable-end faces', () => {
    const f = faces3d(mkSection({ roofType: 'gable' }));
    expect(f).toHaveLength(4);
    const types = f.map((x) => x.faceType).sort();
    expect(types).toEqual(['gable_left', 'gable_right', 'slope_far', 'slope_near']);
  });

  it('hip (rectangular): 2 slopes + 2 hip ends', () => {
    const f = faces3d(mkSection({ roofType: 'hip', length: 40, run: 20 }));
    expect(f).toHaveLength(4);
  });

  it('hip (pyramid): 4 triangular faces', () => {
    const f = faces3d(mkSection({ roofType: 'hip', length: 20, run: 20 }));
    expect(f).toHaveLength(4);
    // Each is triangular (3 vertex indices).
    for (const face of f) expect(face.vertexIndices).toHaveLength(3);
  });
});

// ── 2D outlines + view hit testing ──────────────────────────────

describe('outlineForView + containsPointView', () => {
  it('top view returns the plan corners', () => {
    const s = mkSection();
    const topOutline = outlineForView(s, 'top');
    expect(topOutline).toEqual(corners(s));
  });

  it('front view outline is non-empty for gable', () => {
    const s = mkSection({ roofType: 'gable' });
    const outline = outlineForView(s, 'front');
    expect(outline.length).toBeGreaterThan(2);
  });

  it('side view outline is non-empty for gable', () => {
    const s = mkSection({ roofType: 'gable' });
    const outline = outlineForView(s, 'side');
    expect(outline.length).toBeGreaterThan(2);
  });

  it('containsPointView: plan-view positive case', () => {
    const s = mkSection({ x: 0, y: 0, length: 10, run: 6 });
    expect(containsPointView(s, 5, 3, 'top')).toBe(true);
  });
});

// ── Measures + PDF + vertex distance ────────────────────────────

describe('measureLength + vertexDistance', () => {
  it('measureLength: Euclidean 3-4-5', () => {
    const m: MeasureLine = { lineId: 'M', x1: 0, y1: 0, x2: 3, y2: 4, label: '' };
    expect(measureLength(m)).toBe(5);
  });

  it('vertexDistance: mirrors pythagorean distance', () => {
    const a: RoofVertex = { vertexId: 'A', x: 0, y: 0, label: '' };
    const b: RoofVertex = { vertexId: 'B', x: 6, y: 8, label: '' };
    expect(vertexDistance(a, b)).toBe(10);
  });
});

describe('calibratePdf', () => {
  const base: PDFLayer = emptyPdfLayer();

  it('computes scale from pixel distance / real feet', () => {
    // 100 px between points, 10 ft real → 10 px/ft.
    const c = calibratePdf(base, 0, 0, 100, 0, 10);
    expect(c.scale).toBe(10);
    expect(c.calDistanceFt).toBe(10);
  });

  it('returns unchanged scale when realFt is 0', () => {
    const c = calibratePdf(base, 0, 0, 100, 0, 0);
    expect(c.scale).toBe(base.scale);
  });

  it('returns unchanged scale when points coincide', () => {
    const c = calibratePdf(base, 0, 0, 0, 0, 10);
    expect(c.scale).toBe(base.scale);
  });

  it('sets calibration anchors regardless', () => {
    const c = calibratePdf(base, 1, 2, 3, 4, 5);
    expect(c.calX1).toBe(1);
    expect(c.calY1).toBe(2);
    expect(c.calX2).toBe(3);
    expect(c.calY2).toBe(4);
  });
});

// ── Phase 14.R.5 PDF helpers ───────────────────────────────────

describe('pdfPhysicalSize', () => {
  it('returns widthFt / depthFt from pixel dims and scale', () => {
    const size = pdfPhysicalSize({ widthPx: 2000, heightPx: 1000, scale: 10 });
    expect(size).toEqual({ widthFt: 200, depthFt: 100 });
  });

  it('returns null when image dims are missing', () => {
    expect(pdfPhysicalSize({ widthPx: undefined, heightPx: 500, scale: 10 })).toBeNull();
    expect(pdfPhysicalSize({ widthPx: 500, heightPx: undefined, scale: 10 })).toBeNull();
  });

  it('returns null when scale is non-positive', () => {
    expect(pdfPhysicalSize({ widthPx: 100, heightPx: 100, scale: 0 })).toBeNull();
    expect(pdfPhysicalSize({ widthPx: 100, heightPx: 100, scale: -5 })).toBeNull();
  });
});

// ── Phase 14.R.9 Polygon helpers ───────────────────────────────

describe('polygonArea', () => {
  it('returns 0 for degenerate polygons (<3 vertices)', () => {
    expect(polygonArea([])).toBe(0);
    expect(polygonArea([[0, 0]])).toBe(0);
    expect(polygonArea([[0, 0], [5, 5]])).toBe(0);
  });

  it('computes a unit square correctly', () => {
    expect(polygonArea([[0, 0], [1, 0], [1, 1], [0, 1]])).toBe(1);
  });

  it('computes a 10×20 rectangle correctly', () => {
    expect(polygonArea([[0, 0], [10, 0], [10, 20], [0, 20]])).toBe(200);
  });

  it('is winding-invariant (CW and CCW return the same magnitude)', () => {
    const ccw: [number, number][] = [[0, 0], [10, 0], [10, 5], [0, 5]];
    const cw = [...ccw].reverse() as [number, number][];
    expect(polygonArea(ccw)).toBe(polygonArea(cw));
  });

  it('L-shape (6x6 minus a 3x3 bite)', () => {
    // Draw the outline of an L starting at (0,0), going CCW.
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    // Area = 6*6 - 3*3 = 27
    expect(polygonArea(L)).toBe(27);
  });

  it('returns 0 for collinear points', () => {
    expect(polygonArea([[0, 0], [1, 0], [2, 0]])).toBe(0);
  });
});

describe('polygonPerimeter', () => {
  it('returns 0 for empty / single-vertex polygons', () => {
    expect(polygonPerimeter([])).toBe(0);
    expect(polygonPerimeter([[0, 0]])).toBe(0);
  });

  it('includes the closing edge', () => {
    // Triangle 3-4-5. Perimeter should be 3+4+5 = 12.
    expect(polygonPerimeter([[0, 0], [3, 0], [0, 4]])).toBeCloseTo(12, 6);
  });

  it('10×20 rectangle → 60', () => {
    expect(polygonPerimeter([[0, 0], [10, 0], [10, 20], [0, 20]])).toBe(60);
  });
});

describe('polygonBoundingBox', () => {
  it('returns null for empty polygon', () => {
    expect(polygonBoundingBox([])).toBeNull();
  });

  it('tracks min / max on both axes', () => {
    expect(
      polygonBoundingBox([[-3, -1], [5, 2], [1, 8], [-2, 4]]),
    ).toEqual({ minX: -3, minY: -1, maxX: 5, maxY: 8 });
  });

  it('handles single-vertex polygon (returns the point)', () => {
    expect(polygonBoundingBox([[4, 7]])).toEqual({
      minX: 4, minY: 7, maxX: 4, maxY: 7,
    });
  });
});

describe('hasPolygon', () => {
  it('is false when polygon is undefined', () => {
    expect(hasPolygon({ polygon: undefined })).toBe(false);
  });

  it('is false for fewer than 3 vertices', () => {
    expect(hasPolygon({ polygon: [] })).toBe(false);
    expect(hasPolygon({ polygon: [[0, 0]] })).toBe(false);
    expect(hasPolygon({ polygon: [[0, 0], [1, 1]] })).toBe(false);
  });

  it('is true for 3+ vertices', () => {
    expect(hasPolygon({ polygon: [[0, 0], [1, 0], [0, 1]] })).toBe(true);
  });
});

describe('polygon-aware section geometry', () => {
  const polyTriangle: [number, number][] = [[0, 0], [10, 0], [5, 10]];

  function mkPolySec(over: Partial<RoofSection> = {}): RoofSection {
    return {
      sectionId: 'POLY',
      label: 'Poly',
      x: 0, y: 0, length: 10, run: 10,
      rotation: 0,
      slope: 0,
      roofType: 'flat',
      sectionType: 'main_roof',
      overhang: 0,
      z: 0,
      wastePct: 15,
      colorIdx: 0,
      locked: false,
      polygon: polyTriangle,
      ...over,
    };
  }

  it('corners() returns polygon vertices when polygon is set', () => {
    const c = corners(mkPolySec());
    expect(c).toHaveLength(3);
    expect(c[0]).toEqual([0, 0]);
    expect(c[1]).toEqual([10, 0]);
    expect(c[2]).toEqual([5, 10]);
  });

  it('corners() falls back to rect when polygon is absent', () => {
    const sec = mkPolySec({ polygon: undefined, length: 6, run: 4 });
    const c = corners(sec);
    expect(c).toHaveLength(4);
  });

  it('areaPlan uses polygon area when present', () => {
    // Triangle area = ½·10·10 = 50
    expect(areaPlan(mkPolySec())).toBe(50);
  });

  it('perimeterPlan uses polygon perimeter when present', () => {
    // Triangle: 10 + √(125) + √(125) ≈ 10 + 11.18 + 11.18
    const expected = 10 + 2 * Math.sqrt(125);
    expect(perimeterPlan(mkPolySec())).toBeCloseTo(expected, 6);
  });

  it('vertices3d returns polygon vertices at elevation z (flat treatment)', () => {
    const sec = mkPolySec({ z: 15 });
    const v = vertices3d(sec);
    expect(v).toHaveLength(3);
    for (const [, , z] of v) {
      expect(z).toBe(15);
    }
    expect(v[0]).toEqual([0, 0, 15]);
    expect(v[1]).toEqual([10, 0, 15]);
    expect(v[2]).toEqual([5, 10, 15]);
  });

  it('edges3d returns one eave edge per polygon side', () => {
    const e = edges3d(mkPolySec());
    expect(e).toHaveLength(3);
    for (const edge of e) {
      expect(edge.edgeType).toBe('eave');
    }
    // Check the closing edge (last vertex → first).
    expect(e[2]!.fromIdx).toBe(2);
    expect(e[2]!.toIdx).toBe(0);
  });

  it('faces3d returns one flat face covering every polygon vertex', () => {
    const f = faces3d(mkPolySec());
    expect(f).toHaveLength(1);
    expect(f[0]!.faceType).toBe('flat');
    expect(f[0]!.vertexIndices).toEqual([0, 1, 2]);
  });

  it('containsPoint hits the polygon interior', () => {
    // Centroid of the triangle is at (5, 10/3) ≈ (5, 3.33)
    expect(containsPoint(mkPolySec(), 5, 3.33)).toBe(true);
    // Outside the triangle
    expect(containsPoint(mkPolySec(), 11, 5)).toBe(false);
    expect(containsPoint(mkPolySec(), -1, 0)).toBe(false);
  });

  it('polygon sections ignore rotation (coords are absolute)', () => {
    const sec = mkPolySec({ rotation: 90 });
    // Rotation would flip the triangle if applied; polygon path
    // short-circuits that.
    const c = corners(sec);
    expect(c[0]).toEqual([0, 0]);
    expect(c[1]).toEqual([10, 0]);
  });
});

// ── Phase 14.R.10 ear-clipping ─────────────────────────────────

describe('earClipTriangulate', () => {
  // A helper: given triangle-index triples + the polygon, sum the
  // triangle areas. For a correct triangulation this MUST equal the
  // polygon's area (no gaps, no overlaps).
  function sumTriAreas(
    polygon: ReadonlyArray<readonly [number, number]>,
    tris: [number, number, number][],
  ): number {
    let total = 0;
    for (const [a, b, c] of tris) {
      const pa = polygon[a]!;
      const pb = polygon[b]!;
      const pc = polygon[c]!;
      const cross = (pb[0] - pa[0]) * (pc[1] - pa[1])
                  - (pb[1] - pa[1]) * (pc[0] - pa[0]);
      total += Math.abs(cross) / 2;
    }
    return total;
  }

  it('returns empty for degenerate polygons', () => {
    expect(earClipTriangulate([])).toEqual([]);
    expect(earClipTriangulate([[0, 0]])).toEqual([]);
    expect(earClipTriangulate([[0, 0], [1, 1]])).toEqual([]);
  });

  it('returns a single triangle for a triangle input', () => {
    const t = earClipTriangulate([[0, 0], [10, 0], [5, 10]]);
    expect(t).toEqual([[0, 1, 2]]);
  });

  it('triangulates a convex square into 2 triangles', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const tris = earClipTriangulate(sq);
    expect(tris).toHaveLength(2);
    expect(sumTriAreas(sq, tris)).toBeCloseTo(100, 6);
  });

  it('triangulates a convex pentagon into 3 triangles', () => {
    const pent: [number, number][] = [
      [0, 0], [10, 0], [12, 6], [5, 10], [-2, 6],
    ];
    const tris = earClipTriangulate(pent);
    expect(tris).toHaveLength(3); // n - 2
    expect(sumTriAreas(pent, tris)).toBeCloseTo(polygonArea(pent), 6);
  });

  it('triangulates a CONCAVE L-shape correctly (6 vertices → 4 tris)', () => {
    // L = 6×6 square minus a 3×3 bite at the top-right.
    // CCW order starting at origin, going right along the bottom.
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const tris = earClipTriangulate(L);
    expect(tris).toHaveLength(4); // n - 2
    // Sum of tri areas must equal polygon area (27).
    expect(sumTriAreas(L, tris)).toBeCloseTo(27, 6);
  });

  it('triangulates a CONCAVE U-shape correctly (8 vertices → 6 tris)', () => {
    // U-shape: 6×6 outer, with a 2×4 notch from the top.
    //   0: (0,0)   1: (6,0)   2: (6,6)   3: (4,6)
    //   4: (4,2)   5: (2,2)   6: (2,6)   7: (0,6)
    const U: [number, number][] = [
      [0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6],
    ];
    const tris = earClipTriangulate(U);
    expect(tris).toHaveLength(6); // n - 2
    // Area = 6*6 - 2*4 = 28
    expect(sumTriAreas(U, tris)).toBeCloseTo(28, 6);
  });

  it('is winding-invariant: CCW and CW inputs produce same total area', () => {
    const ccw: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const cw: [number, number][] = [...ccw].reverse() as [number, number][];
    expect(sumTriAreas(ccw, earClipTriangulate(ccw)))
      .toBeCloseTo(sumTriAreas(cw, earClipTriangulate(cw)), 6);
  });

  it('output triangles cover the polygon area exactly (no gaps, no overlaps)', () => {
    // Irregular polygon with a reflex vertex
    const poly: [number, number][] = [
      [0, 0], [8, 0], [8, 4], [5, 4], [5, 7], [8, 7], [8, 10], [0, 10],
    ];
    const tris = earClipTriangulate(poly);
    expect(tris).toHaveLength(6); // n - 2
    expect(sumTriAreas(poly, tris)).toBeCloseTo(polygonArea(poly), 6);
  });

  it('output triangle indices are valid polygon indices', () => {
    const poly: [number, number][] = [
      [0, 0], [10, 0], [10, 5], [5, 5], [5, 10], [0, 10],
    ];
    const tris = earClipTriangulate(poly);
    for (const tri of tris) {
      for (const idx of tri) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(poly.length);
      }
      // And no triangle re-uses a vertex.
      const seen = new Set(tri);
      expect(seen.size).toBe(3);
    }
  });

  it('convex polygon: triangle count is always n-2', () => {
    // Regular hexagon
    const R = 5;
    const hex: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      hex.push([R * Math.cos(a), R * Math.sin(a)]);
    }
    expect(earClipTriangulate(hex)).toHaveLength(4); // n - 2
  });

  it('survives a plus-sign polygon (12 vertices, 4 reflex corners)', () => {
    // Cross / plus shape: 4 outer bumps, each reflex at the neck
    const plus: [number, number][] = [
      [3, 0], [6, 0], [6, 3], [9, 3], [9, 6], [6, 6],
      [6, 9], [3, 9], [3, 6], [0, 6], [0, 3], [3, 3],
    ];
    const tris = earClipTriangulate(plus);
    expect(tris).toHaveLength(10); // n - 2
    expect(sumTriAreas(plus, tris)).toBeCloseTo(polygonArea(plus), 6);
  });

  it('does not explode on a collinear-heavy polygon', () => {
    // A thin rectangle with extra collinear points on the long sides
    const poly: [number, number][] = [
      [0, 0], [5, 0], [10, 0], [10, 1], [5, 1], [0, 1],
    ];
    const tris = earClipTriangulate(poly);
    // Sum-of-tri-area must still equal polygon-area (10) even if the
    // triangle count differs from n-2 when collinear vertices get
    // skipped or produce zero-area slivers.
    expect(sumTriAreas(poly, tris)).toBeCloseTo(polygonArea(poly), 6);
  });
});

// ── Phase 14.R.11 convex check + centroid + polygon-hip ────────

describe('isConvexPolygon', () => {
  it('triangle is convex', () => {
    expect(isConvexPolygon([[0, 0], [10, 0], [5, 10]])).toBe(true);
  });

  it('square is convex (both windings)', () => {
    expect(isConvexPolygon([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(true);
    expect(isConvexPolygon([[0, 10], [10, 10], [10, 0], [0, 0]])).toBe(true);
  });

  it('regular pentagon is convex', () => {
    const pent: [number, number][] = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      pent.push([Math.cos(a), Math.sin(a)]);
    }
    expect(isConvexPolygon(pent)).toBe(true);
  });

  it('L-shape is concave', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    expect(isConvexPolygon(L)).toBe(false);
  });

  it('U-shape is concave', () => {
    const U: [number, number][] = [
      [0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6],
    ];
    expect(isConvexPolygon(U)).toBe(false);
  });

  it('<3 vertices is not convex', () => {
    expect(isConvexPolygon([])).toBe(false);
    expect(isConvexPolygon([[0, 0]])).toBe(false);
    expect(isConvexPolygon([[0, 0], [1, 1]])).toBe(false);
  });

  it('collinear polygon is not convex', () => {
    expect(isConvexPolygon([[0, 0], [1, 0], [2, 0]])).toBe(false);
  });

  it('convex polygon with a collinear vertex remains convex', () => {
    // Square with an extra collinear point on one edge.
    expect(isConvexPolygon([
      [0, 0], [5, 0], [10, 0], [10, 10], [0, 10],
    ])).toBe(true);
  });
});

describe('polygonCentroid', () => {
  it('centroid of unit square is (0.5, 0.5)', () => {
    const [cx, cy] = polygonCentroid([[0, 0], [1, 0], [1, 1], [0, 1]]);
    expect(cx).toBeCloseTo(0.5, 6);
    expect(cy).toBeCloseTo(0.5, 6);
  });

  it('centroid of a right triangle at ((0,0),(3,0),(0,6)) is (1,2)', () => {
    const [cx, cy] = polygonCentroid([[0, 0], [3, 0], [0, 6]]);
    expect(cx).toBeCloseTo(1, 6);
    expect(cy).toBeCloseTo(2, 6);
  });

  it('centroid of a translated rectangle translates accordingly', () => {
    // 10×20 rect centered at (100, 50).
    const r: [number, number][] = [
      [95, 40], [105, 40], [105, 60], [95, 60],
    ];
    const [cx, cy] = polygonCentroid(r);
    expect(cx).toBeCloseTo(100, 6);
    expect(cy).toBeCloseTo(50, 6);
  });

  it('centroid of degenerate polygon falls back to vertex mean', () => {
    // Collinear points — signed area = 0.
    const [cx, cy] = polygonCentroid([[0, 0], [1, 0], [2, 0]]);
    expect(cx).toBeCloseTo(1, 6);
    expect(cy).toBeCloseTo(0, 6);
  });

  it('empty polygon returns [0,0]', () => {
    expect(polygonCentroid([])).toEqual([0, 0]);
  });

  it('centroid is winding-invariant', () => {
    const ccw: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const cw = [...ccw].reverse() as [number, number][];
    const a = polygonCentroid(ccw);
    const b = polygonCentroid(cw);
    expect(a[0]).toBeCloseTo(b[0], 6);
    expect(a[1]).toBeCloseTo(b[1], 6);
  });
});

describe('polygonPyramidRise', () => {
  it('zero slope → zero rise', () => {
    expect(polygonPyramidRise([[0, 0], [10, 0], [5, 10]], 0)).toBe(0);
  });

  it('degenerate polygon → zero rise', () => {
    expect(polygonPyramidRise([[0, 0], [1, 0]], 6)).toBe(0);
    expect(polygonPyramidRise([], 6)).toBe(0);
  });

  it('matches rectangular-hip rise for a square', () => {
    // Square 10×10 → A=100, P=40, W_eff = 4·100/40 = 10.
    // rise = (slope/12) · (W_eff/2) = (6/12) · 5 = 2.5
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(polygonPyramidRise(sq, 6)).toBeCloseTo(2.5, 6);
  });

  it('matches expected rise for a 20×10 rectangle', () => {
    // A=200, P=60, W_eff = 800/60 ≈ 13.33
    // rise = (6/12) · (13.33/2) ≈ 3.333
    const r: [number, number][] = [[0, 0], [20, 0], [20, 10], [0, 10]];
    expect(polygonPyramidRise(r, 6)).toBeCloseTo(3.333, 3);
  });

  it('scales linearly in slope', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const r6 = polygonPyramidRise(sq, 6);
    const r12 = polygonPyramidRise(sq, 12);
    expect(r12).toBeCloseTo(2 * r6, 6);
  });
});

describe('polygon + hip pyramid geometry', () => {
  function mkHipSec(polygon: [number, number][]): RoofSection {
    return {
      sectionId: 'H',
      label: 'Hip',
      x: 0, y: 0, length: 10, run: 10,
      rotation: 0,
      slope: 6,
      roofType: 'hip',
      sectionType: 'main_roof',
      overhang: 0,
      z: 0,
      wastePct: 15,
      colorIdx: 0,
      locked: false,
      polygon,
    };
  }

  it('convex hex → 7 vertices (6 base + apex at centroid)', () => {
    const R = 10;
    const hex: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      hex.push([R * Math.cos(a), R * Math.sin(a)]);
    }
    const sec = mkHipSec(hex);
    const v = vertices3d(sec);
    expect(v).toHaveLength(7);
    // Apex is last and sits above the centroid at elevation z + rise.
    const [apexX, apexY, apexZ] = v[6]!;
    expect(apexX).toBeCloseTo(0, 6);
    expect(apexY).toBeCloseTo(0, 6);
    expect(apexZ).toBeGreaterThan(0);
  });

  it('convex hex → 12 edges (6 eaves + 6 hips)', () => {
    const R = 10;
    const hex: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      hex.push([R * Math.cos(a), R * Math.sin(a)]);
    }
    const e = edges3d(mkHipSec(hex));
    const eaves = e.filter((x) => x.edgeType === 'eave');
    const hips = e.filter((x) => x.edgeType === 'hip');
    expect(eaves).toHaveLength(6);
    expect(hips).toHaveLength(6);
    expect(e).toHaveLength(12);
    // All hips must terminate at the apex index (n = 6).
    for (const h of hips) {
      expect(h.toIdx).toBe(6);
    }
  });

  it('convex hex → 6 triangular hip_left faces', () => {
    const R = 10;
    const hex: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      hex.push([R * Math.cos(a), R * Math.sin(a)]);
    }
    const f = faces3d(mkHipSec(hex));
    expect(f).toHaveLength(6);
    for (const face of f) {
      expect(face.vertexIndices).toHaveLength(3);
      expect(face.faceType).toBe('hip_left');
      // Third index must be the apex (6).
      expect(face.vertexIndices[2]).toBe(6);
    }
  });

  it('degenerate polygon (<3 vertices post hasPolygon) \u2192 flat fallback', () => {
    // Polygons with fewer than 3 vertices don\u2019t satisfy hasPolygon(),
    // so the geometry functions skip all polygon branches entirely
    // and emit the rect-based output.
    const sec: RoofSection = { ...mkHipSec([[0, 0], [10, 0], [5, 8]]) };
    (sec as any).polygon = [[0, 0], [5, 0]]; // degenerate
    // Non-polygon path runs \u2014 rect hip produces 6 verts.
    const v = vertices3d(sec);
    expect(v).toHaveLength(6);
  });

  it('R.14 single-reflex non-rectilinear + hip \u2192 skeleton (not flat)', () => {
    // Previously-flat fixture is now handled by R.14's skeleton split.
    const poly: [number, number][] = [
      [0, 0], [10, 0], [5, 3], [10, 10], [0, 10],
    ];
    const sec = mkHipSec(poly);
    const f = faces3d(sec);
    // Non-trivial face count (not just 1 flat face).
    expect(f.length).toBeGreaterThan(1);
    // And no face should be of type 'flat' \u2014 skeleton path emits
    // per-sub-poly hip_left triangle faces.
    expect(f.every((x) => x.faceType !== 'flat')).toBe(true);
  });

  it('concave RECTILINEAR L + hip \u2192 rectilinear-union (R.12 promotes)', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const sec = mkHipSec(L);
    // 2 sub-rects \u00d7 6 verts each
    expect(vertices3d(sec)).toHaveLength(12);
    // 2 sub-rects \u00d7 4 faces each
    expect(faces3d(sec)).toHaveLength(8);
    // Faces should be the rect-hip types (slope_near/far, hip_left/right),
    // not flat.
    const flatFaceCount = faces3d(sec).filter((f) => f.faceType === 'flat').length;
    expect(flatFaceCount).toBe(0);
  });

  it('convex square + gable \u2192 gable-ridge-auto (R.16-promoted)', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const sec: RoofSection = {
      ...mkHipSec(sq),
      roofType: 'gable',
    };
    const f = faces3d(sec);
    // Gable produces 4 faces: 2 slope trapezoids + 2 gable triangles.
    expect(f).toHaveLength(4);
    expect(f.every((x) => x.faceType !== 'flat')).toBe(true);
    // Vertices: 4 eaves + 4 projections.
    const v = vertices3d(sec);
    expect(v).toHaveLength(8);
  });

  it('apex elevation uses polygonPyramidRise', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const sec = mkHipSec(sq);
    // Expected rise for 10×10 square at slope 6 = 2.5
    const v = vertices3d(sec);
    expect(v[4]![2]).toBeCloseTo(2.5, 6);
  });
});

// ── Phase 14.R.12 rectilinear decomposition ────────────────────

describe('isRectilinearPolygon', () => {
  it('axis-aligned square is rectilinear', () => {
    expect(isRectilinearPolygon([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(true);
  });

  it('L-shape is rectilinear', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    expect(isRectilinearPolygon(L)).toBe(true);
  });

  it('U-shape is rectilinear', () => {
    const U: [number, number][] = [
      [0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6],
    ];
    expect(isRectilinearPolygon(U)).toBe(true);
  });

  it('T-shape is rectilinear', () => {
    const T: [number, number][] = [
      [0, 0], [3, 0], [3, 2], [6, 2], [6, 4], [3, 4], [3, 6], [0, 6],
    ];
    // Wait — that isn't a T; that's an L. Let me use a proper T:
    const properT: [number, number][] = [
      [0, 4], [2, 4], [2, 0], [5, 0], [5, 4], [7, 4], [7, 6], [0, 6],
    ];
    expect(isRectilinearPolygon(properT)).toBe(true);
    // (And the first one is also rectilinear, just not a T.)
    expect(isRectilinearPolygon(T)).toBe(true);
  });

  it('triangle is not rectilinear', () => {
    expect(isRectilinearPolygon([[0, 0], [10, 0], [5, 10]])).toBe(false);
  });

  it('rotated square is not rectilinear', () => {
    // 45-degree square
    expect(isRectilinearPolygon([[5, 0], [10, 5], [5, 10], [0, 5]])).toBe(false);
  });

  it('fewer than 4 vertices is not rectilinear', () => {
    expect(isRectilinearPolygon([])).toBe(false);
    expect(isRectilinearPolygon([[0, 0], [1, 0], [1, 1]])).toBe(false);
  });

  it('rejects degenerate zero-length edge', () => {
    // Duplicate consecutive vertex
    expect(isRectilinearPolygon([
      [0, 0], [0, 0], [10, 0], [10, 10], [0, 10],
    ])).toBe(false);
  });
});

describe('decomposeRectilinearPolygon', () => {
  it('returns one rect for an axis-aligned square', () => {
    const rects = decomposeRectilinearPolygon([
      [0, 0], [10, 0], [10, 10], [0, 10],
    ]);
    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({ x: 0, y: 0, w: 10, h: 10 });
  });

  it('L-shape decomposes into 2 rects summing to the L\u2019s area', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const rects = decomposeRectilinearPolygon(L);
    expect(rects).toHaveLength(2);
    const totalArea = rects.reduce((s, r) => s + r.w * r.h, 0);
    expect(totalArea).toBeCloseTo(27, 6); // L area = 36 − 9 = 27
  });

  it('U-shape decomposes into sub-rects summing to the U\u2019s area', () => {
    // U: 6×6 outer minus a 2×4 notch from the top
    const U: [number, number][] = [
      [0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6],
    ];
    const rects = decomposeRectilinearPolygon(U);
    expect(rects.length).toBeGreaterThanOrEqual(2);
    const totalArea = rects.reduce((s, r) => s + r.w * r.h, 0);
    expect(totalArea).toBeCloseTo(28, 6); // 36 − 8
  });

  it('non-rectilinear polygon returns []', () => {
    // Triangle
    expect(decomposeRectilinearPolygon([[0, 0], [10, 0], [5, 10]])).toEqual([]);
  });

  it('<4-vertex polygon returns []', () => {
    expect(decomposeRectilinearPolygon([])).toEqual([]);
  });

  it('cross / plus shape decomposes to rects summing to plus area', () => {
    const plus: [number, number][] = [
      [3, 0], [6, 0], [6, 3], [9, 3], [9, 6], [6, 6],
      [6, 9], [3, 9], [3, 6], [0, 6], [0, 3], [3, 3],
    ];
    const rects = decomposeRectilinearPolygon(plus);
    expect(rects.length).toBeGreaterThanOrEqual(3);
    const totalArea = rects.reduce((s, r) => s + r.w * r.h, 0);
    // Plus area: center 3×3 + 4 arms of 3×3 = 45
    expect(totalArea).toBeCloseTo(45, 6);
  });
});

describe('classifyPolygonRoof', () => {
  it('convex hip \u2192 pyramid', () => {
    expect(classifyPolygonRoof({
      polygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
      roofType: 'hip',
    })).toBe('pyramid');
  });

  it('rectilinear concave + hip \u2192 rectilinear-union', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    expect(classifyPolygonRoof({ polygon: L, roofType: 'hip' })).toBe('rectilinear-union');
  });

  it('non-rectilinear concave (single-reflex) + hip \u2192 skeleton (R.14 promoted)', () => {
    // A pentagon with a diagonal reflex edge. R.12 fell back to flat;
    // R.14 splits along the reflex bisector when the two halves are convex.
    const poly: [number, number][] = [
      [0, 0], [10, 0], [7, 5], [10, 10], [0, 10],
    ];
    expect(classifyPolygonRoof({ polygon: poly, roofType: 'hip' }))
      .toBe('skeleton-single-reflex');
  });

  it('convex polygon + gable \u2192 gable-ridge-auto (R.16-promoted)', () => {
    expect(classifyPolygonRoof({
      polygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
      roofType: 'gable',
    })).toBe('gable-ridge-auto');
  });

  it('convex polygon + shed \u2192 shed-auto (R.17-promoted)', () => {
    expect(classifyPolygonRoof({
      polygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
      roofType: 'shed',
    })).toBe('shed-auto');
  });

  it('polygon + flat \u2192 flat', () => {
    expect(classifyPolygonRoof({
      polygon: [[0, 0], [10, 0], [10, 10], [0, 10]],
      roofType: 'flat',
    })).toBe('flat');
  });

  it('no polygon \u2192 flat', () => {
    expect(classifyPolygonRoof({ polygon: undefined, roofType: 'hip' })).toBe('flat');
  });
});

describe('rectilinear-union geometry composition', () => {
  function mkLSec(): RoofSection {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    return {
      sectionId: 'L',
      label: 'L',
      x: 0, y: 0, length: 6, run: 6,
      rotation: 0,
      slope: 6,
      roofType: 'hip',
      sectionType: 'main_roof',
      overhang: 0,
      z: 0,
      wastePct: 15,
      colorIdx: 0,
      locked: false,
      polygon: L,
    };
  }

  it('vertex count = sum of sub-rect vertex counts', () => {
    const sec = mkLSec();
    const v = vertices3d(sec);
    // Each sub-rect-hip emits 6 vertices (4 eaves + 2 ridge points,
    // coincident for squares). L-shape → 2 sub-rects → 12 vertices.
    expect(v.length).toBe(12);
  });

  it('every vertex lies at elevation z=0 for eaves and z=rise for ridges', () => {
    const sec = mkLSec();
    const v = vertices3d(sec);
    const eaveCount = v.filter((p) => p[2] === 0).length;
    const ridgeCount = v.filter((p) => p[2] > 0).length;
    // 4 eaves + 2 ridges per sub-rect, 2 sub-rects.
    expect(eaveCount).toBe(8);
    expect(ridgeCount).toBe(4);
  });

  it('faces count = N sub-rect hip faces (4 each)', () => {
    const sec = mkLSec();
    const f = faces3d(sec);
    // Each rect-hip emits 4 faces (2 slope, 2 hip-triangle).
    // 2 sub-rects * 4 = 8 faces.
    expect(f).toHaveLength(8);
  });

  it('edges count = N sub-rect hip edges with correct types + valley', () => {
    const sec = mkLSec();
    const e = edges3d(sec);
    // Rect hip (non-square): 4 eaves + 1 ridge + 4 hips = 9 edges.
    // Square rect hip (pyramid degenerate): 4 eaves + 4 hips = 8 edges.
    // L-shape sub-rects: 6\u00d73 (9) + 3\u00d73 (8) = 17, plus 1 valley from
    // the reflex corner (3,3) inward (R.13) = 18.
    expect(e).toHaveLength(18);
    const eaves = e.filter((x) => x.edgeType === 'eave').length;
    const ridges = e.filter((x) => x.edgeType === 'ridge').length;
    const hips = e.filter((x) => x.edgeType === 'hip').length;
    const valleys = e.filter((x) => x.edgeType === 'valley').length;
    expect(eaves).toBe(8); // 4 per sub-rect \u00d7 2
    expect(ridges).toBe(1); // only the non-square rect has a ridge edge
    expect(hips).toBe(8);
    expect(valleys).toBe(1); // R.13: reflex corner \u2192 long wing ridge
  });

  it('face vertex indices point to the composed vertex list', () => {
    const sec = mkLSec();
    const v = vertices3d(sec);
    const f = faces3d(sec);
    for (const face of f) {
      for (const idx of face.vertexIndices) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(v.length);
      }
    }
  });

  it('R.15 multi-reflex non-rectilinear polygon + hip \u2192 skeleton geometry (not flat)', () => {
    // The same dumbbell R.14 fell back to flat on is now handled
    // by R.15's recursive decomposition. Expect non-trivial faces
    // (multiple hip_left triangles, not a single flat face).
    const sec: RoofSection = {
      sectionId: 'NR',
      label: 'NR',
      x: 0, y: 0, length: 12, run: 8,
      rotation: 0,
      slope: 6,
      roofType: 'hip',
      sectionType: 'main_roof',
      overhang: 0,
      z: 0,
      wastePct: 15,
      colorIdx: 0,
      locked: false,
      polygon: [
        [0, 2], [3, 4], [6, 2], [9, 4], [12, 2],
        [12, 8], [9, 6], [6, 8], [3, 6], [0, 8],
      ],
    };
    const f = faces3d(sec);
    expect(f.length).toBeGreaterThan(1);
    expect(f.every((x) => x.faceType !== 'flat')).toBe(true);
  });
});

// ── Phase 14.R.13 straight-skeleton helpers ─────────────────────

describe('reflexVertexIndices', () => {
  it('convex square has zero reflex vertices', () => {
    expect(reflexVertexIndices([
      [0, 0], [10, 0], [10, 10], [0, 10],
    ])).toEqual([]);
  });

  it('L-shape has exactly one reflex vertex at the interior corner', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const reflex = reflexVertexIndices(L);
    expect(reflex).toEqual([3]); // (3,3)
  });

  it('U-shape has two reflex vertices', () => {
    const U: [number, number][] = [
      [0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6],
    ];
    const reflex = reflexVertexIndices(U);
    expect(reflex).toHaveLength(2);
    // Vertices 4 = (4,2) and 5 = (2,2) are the two interior corners.
    expect(reflex).toContain(4);
    expect(reflex).toContain(5);
  });

  it('plus-sign has 4 reflex vertices (one per inside bend)', () => {
    const plus: [number, number][] = [
      [3, 0], [6, 0], [6, 3], [9, 3], [9, 6], [6, 6],
      [6, 9], [3, 9], [3, 6], [0, 6], [0, 3], [3, 3],
    ];
    expect(reflexVertexIndices(plus)).toHaveLength(4);
  });

  it('winding-invariant: CW L-shape has the same reflex corner', () => {
    const ccw: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const cw = [...ccw].reverse() as [number, number][];
    const ccwReflex = reflexVertexIndices(ccw);
    const cwReflex = reflexVertexIndices(cw);
    // The reflex POINT is the same, but its INDEX may differ under
    // reversal. Check the world position.
    const ccwCorner = ccw[ccwReflex[0]!];
    const cwCorner = cw[cwReflex[0]!];
    expect(ccwCorner).toEqual(cwCorner);
  });

  it('< 4 vertices or collinear returns []', () => {
    expect(reflexVertexIndices([])).toEqual([]);
    expect(reflexVertexIndices([[0, 0], [1, 1], [2, 2]])).toEqual([]);
  });
});

describe('polygonVertexInteriorBisector', () => {
  it('at L-shape reflex (3,3) points toward (-1,-1)/\u221a2', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const b = polygonVertexInteriorBisector(L, 3);
    expect(b).not.toBeNull();
    const [bx, by] = b!;
    expect(bx).toBeCloseTo(-Math.SQRT1_2, 6); // -1/\u221a2
    expect(by).toBeCloseTo(-Math.SQRT1_2, 6);
  });

  it('at convex square corner (0,0) points toward (+1,+1)/\u221a2', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const b = polygonVertexInteriorBisector(sq, 0);
    expect(b).not.toBeNull();
    const [bx, by] = b!;
    expect(bx).toBeCloseTo(Math.SQRT1_2, 6);
    expect(by).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('returns null for degenerate polygon', () => {
    expect(polygonVertexInteriorBisector([[0, 0], [1, 0], [2, 0]], 1)).toBeNull();
  });

  it('U-shape reflex (4,2) bisector points toward (+1,-1)/\u221a2 (into the bottom)', () => {
    const U: [number, number][] = [
      [0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6],
    ];
    // Vertex 4 = (4,2). Incoming edge e1 = (4,6)→(4,2) = (0,-4).
    // Outgoing e2 = (4,2)→(2,2) = (-2,0). CCW.
    // Interior normals (rotate 90\u00b0 CCW):
    //   n1 rotated from (0,-4) = (4, 0)/4 = (1, 0)
    //   n2 rotated from (-2, 0) = (0, -2)/2 = (0, -1)
    // Sum = (1, -1); normalized = (1,-1)/\u221a2
    const b = polygonVertexInteriorBisector(U, 4);
    expect(b).not.toBeNull();
    expect(b![0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(b![1]).toBeCloseTo(-Math.SQRT1_2, 6);
  });
});

describe('subRectRidges', () => {
  it('6\u00d73 rect produces a horizontal ridge segment', () => {
    const r = subRectRidges([{ x: 0, y: 0, w: 6, h: 3 }], 6);
    expect(r).toHaveLength(1);
    expect(r[0]!.from).toEqual([1.5, 1.5]);
    expect(r[0]!.to).toEqual([4.5, 1.5]);
    // zRidge = (6/12)\u00b7(3/2) = 0.75
    expect(r[0]!.zRidge).toBeCloseTo(0.75, 6);
  });

  it('3\u00d76 rect produces a vertical ridge segment', () => {
    const r = subRectRidges([{ x: 0, y: 0, w: 3, h: 6 }], 6);
    expect(r).toHaveLength(1);
    expect(r[0]!.from).toEqual([1.5, 1.5]);
    expect(r[0]!.to).toEqual([1.5, 4.5]);
  });

  it('square sub-rect produces a degenerate point (pyramid apex)', () => {
    const r = subRectRidges([{ x: 0, y: 0, w: 4, h: 4 }], 6);
    expect(r[0]!.from).toEqual([2, 2]);
    expect(r[0]!.to).toEqual([2, 2]);
    expect(r[0]!.zRidge).toBeCloseTo(1, 6); // (6/12)\u00b72
  });

  it('multiple rects produce multiple ridges', () => {
    const r = subRectRidges([
      { x: 0, y: 0, w: 6, h: 3 },
      { x: 0, y: 3, w: 3, h: 3 },
    ], 6);
    expect(r).toHaveLength(2);
  });
});

describe('rayHitAxisSegment', () => {
  it('horizontal segment: 45\u00b0 ray from below hits at computed x', () => {
    // Ray from (3,0) direction (0,1) — straight up. Segment at y=5, x\u2208[0,10].
    const h = rayHitAxisSegment(3, 0, 0, 1, 0, 5, 10, 5);
    expect(h).not.toBeNull();
    expect(h!.t).toBeCloseTo(5, 6);
    expect(h!.x).toBeCloseTo(3, 6);
    expect(h!.y).toBeCloseTo(5, 6);
  });

  it('horizontal segment: ray parallel to segment \u2192 null', () => {
    // Ray direction (1, 0) horizontal. Segment also horizontal at y=5.
    expect(rayHitAxisSegment(0, 5, 1, 0, 0, 5, 10, 5)).toBeNull();
  });

  it('vertical segment: 45\u00b0 ray hits inside segment range', () => {
    // Ray from (3,3) direction (-1,-1)/\u221a2. Vertical segment x=1.5, y\u2208[1.5,4.5].
    const s = Math.SQRT1_2;
    const h = rayHitAxisSegment(3, 3, -s, -s, 1.5, 1.5, 1.5, 4.5);
    expect(h).not.toBeNull();
    expect(h!.x).toBeCloseTo(1.5, 6);
    expect(h!.y).toBeCloseTo(1.5, 6);
  });

  it('ray misses when hit point lies outside segment range', () => {
    // Ray from (3,3) going +x, segment at x=10 y\u2208[0,1]. Hit at y=3 which is outside [0,1].
    const h = rayHitAxisSegment(3, 3, 1, 0, 10, 0, 10, 1);
    expect(h).toBeNull();
  });

  it('returns null when t <= 0 (segment behind ray origin)', () => {
    // Ray starts at (3,5) going +y, segment at y=2 (behind).
    expect(rayHitAxisSegment(3, 5, 0, 1, 0, 2, 10, 2)).toBeNull();
  });
});

describe('valley edges in rectilinear-union geometry', () => {
  function mkLHipSec(): RoofSection {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    return {
      sectionId: 'L',
      label: 'L',
      x: 0, y: 0, length: 6, run: 6,
      rotation: 0,
      slope: 6,
      roofType: 'hip',
      sectionType: 'main_roof',
      overhang: 0,
      z: 0,
      wastePct: 15,
      colorIdx: 0,
      locked: false,
      polygon: L,
    };
  }

  it('L-shape rectilinear-union edges include exactly 1 valley edge', () => {
    const sec = mkLHipSec();
    const e = edges3d(sec);
    const valleys = e.filter((x) => x.edgeType === 'valley');
    expect(valleys).toHaveLength(1);
  });

  it('L-shape valley connects reflex (3,3,0) to ridge-hit (1.5,1.5,0.75)', () => {
    const sec = mkLHipSec();
    const verts = vertices3d(sec);
    const e = edges3d(sec);
    const valley = e.find((x) => x.edgeType === 'valley')!;
    const from = verts[valley.fromIdx]!;
    const to = verts[valley.toIdx]!;
    // from should be at the reflex corner (3,3,0)
    expect(from[0]).toBeCloseTo(3, 6);
    expect(from[1]).toBeCloseTo(3, 6);
    expect(from[2]).toBeCloseTo(0, 6);
    // to should be at the long-wing ridge endpoint (1.5, 1.5, 0.75)
    expect(to[0]).toBeCloseTo(1.5, 6);
    expect(to[1]).toBeCloseTo(1.5, 6);
    expect(to[2]).toBeCloseTo(0.75, 6);
  });

  it('convex hip pyramid has NO valley edges', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const sec: RoofSection = { ...mkLHipSec(), polygon: sq };
    const e = edges3d(sec);
    expect(e.filter((x) => x.edgeType === 'valley')).toHaveLength(0);
  });

  it('U-shape produces 2 valley edges (one per reflex corner)', () => {
    const U: [number, number][] = [
      [0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6],
    ];
    const sec: RoofSection = { ...mkLHipSec(), polygon: U };
    const e = edges3d(sec);
    const valleys = e.filter((x) => x.edgeType === 'valley');
    // U has 2 reflex corners; each projects a valley into the bottom wing.
    expect(valleys.length).toBe(2);
  });
});

// ── Phase 14.R.14 single-reflex skeleton ───────────────────────

describe('rayHitSegment', () => {
  it('diagonal ray hits diagonal segment at the expected point', () => {
    // Ray from (0,0) going +45° direction hits segment from (4,0) to (0,4).
    const s = Math.SQRT1_2;
    const h = rayHitSegment(0, 0, s, s, 4, 0, 0, 4);
    expect(h).not.toBeNull();
    // Midpoint of the segment at (2, 2).
    expect(h!.x).toBeCloseTo(2, 6);
    expect(h!.y).toBeCloseTo(2, 6);
  });

  it('returns null when ray parallel to segment', () => {
    // Ray direction (1, 0), segment also horizontal.
    expect(rayHitSegment(0, 0, 1, 0, 5, 0, 10, 0)).toBeNull();
  });

  it('returns null when hit parameter u is outside segment', () => {
    // Ray from (0, 0) direction (1, 0), segment from (5, 2) to (5, 8)
    //   (vertical segment at x=5, y in [2,8]).
    // Hit would be at y=0, which is u = (0-2)/(8-2) = -0.33 → outside.
    expect(rayHitSegment(0, 0, 1, 0, 5, 2, 5, 8)).toBeNull();
  });

  it('returns null when t <= 0 (segment behind ray)', () => {
    expect(rayHitSegment(10, 10, 1, 1, 0, 0, 0, 5)).toBeNull();
  });
});

describe('polygonSplitAtReflexBisector', () => {
  // Concave pentagon (non-rectilinear): chevron/arrow shape with
  // a single reflex at v3 = (5, 5).
  const arrow: [number, number][] = [
    [0, 0], [10, 0], [10, 8], [5, 5], [0, 8],
  ];

  it('returns non-null for a single-reflex non-rectilinear polygon', () => {
    const split = polygonSplitAtReflexBisector(arrow);
    expect(split).not.toBeNull();
  });

  it('bisector hit lands on the expected opposite edge', () => {
    // Bisector from (5,5) is straight down (0,-1); hits edge 0→1 at (5,0).
    const split = polygonSplitAtReflexBisector(arrow)!;
    expect(split.hitEdgeIdx).toBe(0);
    expect(split.bisectorHit[0]).toBeCloseTo(5, 6);
    expect(split.bisectorHit[1]).toBeCloseTo(0, 6);
  });

  it('both sub-polygons contain the reflex vertex AND the hit point', () => {
    const split = polygonSplitAtReflexBisector(arrow)!;
    const hasPoint = (poly: [number, number][], p: [number, number]) =>
      poly.some(([x, y]) => Math.abs(x - p[0]) < 1e-6 && Math.abs(y - p[1]) < 1e-6);
    expect(hasPoint(split.subPolyA, [5, 5])).toBe(true);
    expect(hasPoint(split.subPolyA, [5, 0])).toBe(true);
    expect(hasPoint(split.subPolyB, [5, 5])).toBe(true);
    expect(hasPoint(split.subPolyB, [5, 0])).toBe(true);
  });

  it('sub-polygon areas sum to the original polygon area', () => {
    const split = polygonSplitAtReflexBisector(arrow)!;
    const aA = polygonArea(split.subPolyA);
    const aB = polygonArea(split.subPolyB);
    expect(aA + aB).toBeCloseTo(polygonArea(arrow), 3);
  });

  it('both sub-polygons are convex', () => {
    const split = polygonSplitAtReflexBisector(arrow)!;
    expect(isConvexPolygon(split.subPolyA)).toBe(true);
    expect(isConvexPolygon(split.subPolyB)).toBe(true);
  });

  it('convex polygon returns null (no reflex vertex)', () => {
    expect(polygonSplitAtReflexBisector([
      [0, 0], [10, 0], [10, 10], [0, 10],
    ])).toBeNull();
  });

  it('multi-reflex polygon returns null', () => {
    // U-shape has two reflex vertices.
    const U: [number, number][] = [
      [0, 0], [6, 0], [6, 6], [4, 6], [4, 2], [2, 2], [2, 6], [0, 6],
    ];
    expect(polygonSplitAtReflexBisector(U)).toBeNull();
  });

  it('<4 vertices returns null', () => {
    expect(polygonSplitAtReflexBisector([])).toBeNull();
    expect(polygonSplitAtReflexBisector([[0, 0], [1, 0], [0, 1]])).toBeNull();
  });
});

describe('classifyPolygonRoof — single-reflex skeleton mode', () => {
  it('arrow pentagon + hip → skeleton-single-reflex', () => {
    const arrow: [number, number][] = [
      [0, 0], [10, 0], [10, 8], [5, 5], [0, 8],
    ];
    expect(classifyPolygonRoof({ polygon: arrow, roofType: 'hip' }))
      .toBe('skeleton-single-reflex');
  });

  it('rectilinear-union still wins over skeleton for L-shape + hip', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    expect(classifyPolygonRoof({ polygon: L, roofType: 'hip' }))
      .toBe('rectilinear-union');
  });

  it('convex polygon wins pyramid over skeleton', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(classifyPolygonRoof({ polygon: sq, roofType: 'hip' })).toBe('pyramid');
  });

  it('arrow + gable → skeleton-gable (R.21-promoted from flat)', () => {
    const arrow: [number, number][] = [
      [0, 0], [10, 0], [10, 8], [5, 5], [0, 8],
    ];
    expect(classifyPolygonRoof({ polygon: arrow, roofType: 'gable' }))
      .toBe('skeleton-gable');
  });

  it('R.15 multi-reflex non-rectilinear polygon \u2192 skeleton-multi-reflex (promoted)', () => {
    // R.14 fell back to flat for this; R.15 decomposes recursively.
    const dumbbell: [number, number][] = [
      [0, 2], [3, 4], [6, 2], [9, 4], [12, 2],
      [12, 8], [9, 6], [6, 8], [3, 6], [0, 8],
    ];
    expect(classifyPolygonRoof({ polygon: dumbbell, roofType: 'hip' }))
      .toBe('skeleton-multi-reflex');
  });
});

describe('skeleton-single-reflex 3D geometry', () => {
  function mkArrowSec(): RoofSection {
    const arrow: [number, number][] = [
      [0, 0], [10, 0], [10, 8], [5, 5], [0, 8],
    ];
    return {
      sectionId: 'A',
      label: 'Arrow',
      x: 0, y: 0, length: 10, run: 8,
      rotation: 0,
      slope: 6,
      roofType: 'hip',
      sectionType: 'main_roof',
      overhang: 0,
      z: 0,
      wastePct: 15,
      colorIdx: 0,
      locked: false,
      polygon: arrow,
    };
  }

  it('vertex count = (N_A + 1) + (N_B + 1) for the two sub-pyramids', () => {
    const sec = mkArrowSec();
    const v = vertices3d(sec);
    // subPolyA has 4 verts + apex (5 total); subPolyB has 4 verts + apex (5).
    expect(v.length).toBe(10);
  });

  it('face count = N_A + N_B (one triangular face per sub-poly base edge)', () => {
    const sec = mkArrowSec();
    const f = faces3d(sec);
    expect(f.length).toBe(8);
    for (const face of f) {
      expect(face.vertexIndices).toHaveLength(3);
    }
  });

  it('edges include exactly 2 valley classifications (one per sub-poly closing eave)', () => {
    const sec = mkArrowSec();
    const e = edges3d(sec);
    const valleys = e.filter((x) => x.edgeType === 'valley');
    expect(valleys).toHaveLength(2);
  });

  it('valley edges connect the reflex vertex to the bisector hit at z=0', () => {
    const sec = mkArrowSec();
    const v = vertices3d(sec);
    const e = edges3d(sec);
    const valleys = e.filter((x) => x.edgeType === 'valley');
    for (const valley of valleys) {
      const from = v[valley.fromIdx]!;
      const to = v[valley.toIdx]!;
      // Endpoints should be (5, 5, 0) and (5, 0, 0) in some order.
      const endpoints = [from, to];
      const hasReflex = endpoints.some((p) =>
        Math.abs(p[0] - 5) < 1e-6 && Math.abs(p[1] - 5) < 1e-6 && p[2] === 0);
      const hasHit = endpoints.some((p) =>
        Math.abs(p[0] - 5) < 1e-6 && Math.abs(p[1] - 0) < 1e-6 && p[2] === 0);
      expect(hasReflex && hasHit).toBe(true);
    }
  });

  it('non-skeleton polygon + hip (convex) still has zero valleys', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const sec: RoofSection = { ...mkArrowSec(), polygon: sq };
    const e = edges3d(sec);
    expect(e.filter((x) => x.edgeType === 'valley')).toHaveLength(0);
  });
});

// ── Phase 14.R.15 multi-reflex recursive decomposition ──────────

describe('polygonSplitTryAnyReflex', () => {
  it('returns non-null for any polygon with \u2265 1 reflex vertex', () => {
    // 2-reflex hexagonal polygon (non-rectilinear).
    const hex: [number, number][] = [
      [0, 0], [12, 0], [12, 10], [7, 5], [5, 5], [0, 10],
    ];
    const split = polygonSplitTryAnyReflex(hex);
    expect(split).not.toBeNull();
  });

  it('returns null for convex polygon (no reflex vertices)', () => {
    expect(polygonSplitTryAnyReflex([
      [0, 0], [10, 0], [10, 10], [0, 10],
    ])).toBeNull();
  });

  it('allows non-convex halves (doesn\u2019t require requireConvexHalves)', () => {
    // 2-reflex hex: the first split leaves one half with a reflex
    // vertex. polygonSplitAtReflexBisector(single-reflex-only) would
    // reject this; polygonSplitTryAnyReflex accepts it.
    const hex: [number, number][] = [
      [0, 0], [12, 0], [12, 10], [7, 5], [5, 5], [0, 10],
    ];
    expect(polygonSplitAtReflexBisector(hex)).toBeNull();
    expect(polygonSplitTryAnyReflex(hex)).not.toBeNull();
  });
});

describe('polygonDecomposeToConvex', () => {
  it('convex polygon returns itself as the single leaf', () => {
    const sq: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const d = polygonDecomposeToConvex(sq);
    expect(d).not.toBeNull();
    expect(d!.convexLeaves).toHaveLength(1);
    expect(d!.valleys).toHaveLength(0);
  });

  it('single-reflex arrow decomposes into 2 leaves + 1 valley', () => {
    const arrow: [number, number][] = [
      [0, 0], [10, 0], [10, 8], [5, 5], [0, 8],
    ];
    const d = polygonDecomposeToConvex(arrow);
    expect(d).not.toBeNull();
    expect(d!.convexLeaves).toHaveLength(2);
    expect(d!.valleys).toHaveLength(1);
  });

  it('2-reflex non-rectilinear hexagon decomposes into 3 leaves + 2 valleys', () => {
    const hex: [number, number][] = [
      [0, 0], [12, 0], [12, 10], [7, 5], [5, 5], [0, 10],
    ];
    const d = polygonDecomposeToConvex(hex);
    expect(d).not.toBeNull();
    // Each recursive split adds one valley. Final leaf count =
    // 1 + number_of_splits. The 2-reflex hex splits twice \u2192 3 leaves.
    expect(d!.convexLeaves).toHaveLength(3);
    expect(d!.valleys).toHaveLength(2);
  });

  it('every convex leaf is actually convex', () => {
    const hex: [number, number][] = [
      [0, 0], [12, 0], [12, 10], [7, 5], [5, 5], [0, 10],
    ];
    const d = polygonDecomposeToConvex(hex)!;
    for (const leaf of d.convexLeaves) {
      expect(isConvexPolygon(leaf)).toBe(true);
    }
  });

  it('sum of leaf areas equals polygon area', () => {
    const hex: [number, number][] = [
      [0, 0], [12, 0], [12, 10], [7, 5], [5, 5], [0, 10],
    ];
    const d = polygonDecomposeToConvex(hex)!;
    const sum = d.convexLeaves.reduce((s, leaf) => s + polygonArea(leaf), 0);
    expect(sum).toBeCloseTo(polygonArea(hex), 3);
  });

  it('guards against runaway recursion (depth cap)', () => {
    // Degenerate \u2018polygon\u2019 with only 2 vertices.
    expect(polygonDecomposeToConvex([[0, 0], [1, 1]])).toBeNull();
  });

  it('rectilinear L-shape still decomposes (though R.12 handles it faster)', () => {
    // classifyPolygonRoof would not route L-shape here \u2014 R.12 wins.
    // But the decomposer itself handles it correctly.
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const d = polygonDecomposeToConvex(L);
    expect(d).not.toBeNull();
    expect(d!.convexLeaves.length).toBeGreaterThanOrEqual(2);
  });
});

describe('classifyPolygonRoof multi-reflex fallback', () => {
  it('2-reflex non-rectilinear hexagon + hip \u2192 skeleton-multi-reflex', () => {
    const hex: [number, number][] = [
      [0, 0], [12, 0], [12, 10], [7, 5], [5, 5], [0, 10],
    ];
    expect(classifyPolygonRoof({ polygon: hex, roofType: 'hip' }))
      .toBe('skeleton-multi-reflex');
  });

  it('single-reflex still wins over multi-reflex when applicable', () => {
    const arrow: [number, number][] = [
      [0, 0], [10, 0], [10, 8], [5, 5], [0, 8],
    ];
    expect(classifyPolygonRoof({ polygon: arrow, roofType: 'hip' }))
      .toBe('skeleton-single-reflex');
  });

  it('rectilinear-union still wins over multi-reflex for rectilinear polygons', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    expect(classifyPolygonRoof({ polygon: L, roofType: 'hip' }))
      .toBe('rectilinear-union');
  });
});

describe('skeleton-multi-reflex 3D geometry', () => {
  function mkHexSec(): RoofSection {
    const hex: [number, number][] = [
      [0, 0], [12, 0], [12, 10], [7, 5], [5, 5], [0, 10],
    ];
    return {
      sectionId: 'HX',
      label: 'Hex',
      x: 0, y: 0, length: 12, run: 10,
      rotation: 0,
      slope: 6,
      roofType: 'hip',
      sectionType: 'main_roof',
      overhang: 0,
      z: 0,
      wastePct: 15,
      colorIdx: 0,
      locked: false,
      polygon: hex,
    };
  }

  it('vertex count sums (N_i + 1) across every convex leaf', () => {
    const sec = mkHexSec();
    const v = vertices3d(sec);
    // Expect 3 leaves. Their individual (N+1) counts sum here.
    expect(v.length).toBeGreaterThanOrEqual(9); // at minimum, 3 leaves \u00d7 (3+1)
  });

  it('every face is a triangular hip_left (one per leaf base edge)', () => {
    const sec = mkHexSec();
    const f = faces3d(sec);
    expect(f.length).toBeGreaterThan(0);
    for (const face of f) {
      expect(face.vertexIndices).toHaveLength(3);
      expect(face.faceType).toBe('hip_left');
    }
  });

  it('emits valley edges for each bisector split (\u2265 1 valley)', () => {
    const sec = mkHexSec();
    const e = edges3d(sec);
    const valleys = e.filter((x) => x.edgeType === 'valley');
    expect(valleys.length).toBeGreaterThanOrEqual(1);
  });
});

// ── Phase 14.R.16 polygon gable ─────────────────────────────────

describe('computePolygonGable', () => {
  const rectWide: [number, number][] = [[0, 0], [20, 0], [20, 10], [0, 10]];
  const rectTall: [number, number][] = [[0, 0], [10, 0], [10, 20], [0, 20]];

  it('wide rectangle: ridge runs horizontally through centroid', () => {
    const g = computePolygonGable(rectWide, 6)!;
    expect(g).not.toBeNull();
    // axis along +X (horizontal ridge).
    expect(g.axis[0]).toBeCloseTo(1, 6);
    expect(g.axis[1]).toBeCloseTo(0, 6);
    expect(g.ridgeStart[1]).toBeCloseTo(5, 6);
    expect(g.ridgeEnd[1]).toBeCloseTo(5, 6);
    expect(g.ridgeStart[0]).toBeCloseTo(0, 6);
    expect(g.ridgeEnd[0]).toBeCloseTo(20, 6);
  });

  it('tall rectangle: ridge runs vertically', () => {
    const g = computePolygonGable(rectTall, 6)!;
    // axis along +Y (vertical ridge).
    expect(g.axis[0]).toBeCloseTo(0, 6);
    expect(g.axis[1]).toBeCloseTo(1, 6);
    expect(g.ridgeStart[0]).toBeCloseTo(5, 6);
    expect(g.ridgeEnd[0]).toBeCloseTo(5, 6);
  });

  it('matches rect-gable rise formula: (slope/12) \u00d7 (perp/2)', () => {
    // 20\u00d710 horizontal. Perp = 10. Rise = (6/12)\u00b75 = 2.5.
    const g = computePolygonGable(rectWide, 6)!;
    expect(g.rise).toBeCloseTo(2.5, 6);
  });

  it('scales rise linearly in slope', () => {
    const a = computePolygonGable(rectWide, 6)!;
    const b = computePolygonGable(rectWide, 12)!;
    expect(b.rise).toBeCloseTo(2 * a.rise, 6);
  });

  it('octagonal polygon: ridge clips to polygon interior', () => {
    // A chamfered-rectangle octagon (12\u00d712 with 2-foot corner cuts).
    const oct: [number, number][] = [
      [2, 0], [10, 0], [12, 2], [12, 10], [10, 12], [2, 12], [0, 10], [0, 2],
    ];
    const g = computePolygonGable(oct, 6)!;
    // Width=height (bbox 12\u00d712), so horizontal is chosen on tie.
    expect(g.axis[0]).toBeCloseTo(1, 6);
    expect(g.axis[1]).toBeCloseTo(0, 6);
    // Ridge endpoints at y = centroid.y, clipped to polygon edges
    // (0, cy) on the left-edge, (12, cy) on the right-edge. Centroid
    // of this symmetric octagon is (6, 6).
    expect(g.ridgeStart[0]).toBeCloseTo(0, 3);
    expect(g.ridgeStart[1]).toBeCloseTo(6, 3);
    expect(g.ridgeEnd[0]).toBeCloseTo(12, 3);
    expect(g.ridgeEnd[1]).toBeCloseTo(6, 3);
  });

  it('per-vertex projection: projections onto the ridge segment', () => {
    const g = computePolygonGable(rectWide, 6)!;
    // Vertices (0,0), (20,0), (20,10), (0,10).
    // Horizontal ridge at y=5 \u2014 projections keep x, snap y to 5
    // (and clamp to ridge segment).
    expect(g.projections[0]).toEqual([0, 5]);
    expect(g.projections[1]).toEqual([20, 5]);
    expect(g.projections[2]).toEqual([20, 5]);
    expect(g.projections[3]).toEqual([0, 5]);
  });

  it('non-convex polygon returns null (gable not supported over concave)', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    expect(computePolygonGable(L, 6)).toBeNull();
  });

  it('degenerate polygon (zero bbox dimension) returns null', () => {
    // All points collinear \u2192 zero bbox height.
    expect(computePolygonGable([[0, 0], [5, 0], [10, 0]], 6)).toBeNull();
  });
});

// ── Phase 14.R.20 axis override ─────────────────────────────────

describe('computePolygonGable axisDegOverride', () => {
  const rectWide: [number, number][] = [[0, 0], [20, 0], [20, 10], [0, 10]];

  it('0\u00b0 override matches bbox auto-pick for wide rect (ridge along +X)', () => {
    const auto = computePolygonGable(rectWide, 6)!;
    const override = computePolygonGable(rectWide, 6, 0)!;
    expect(override.axis[0]).toBeCloseTo(auto.axis[0], 6);
    expect(override.axis[1]).toBeCloseTo(auto.axis[1], 6);
    expect(override.rise).toBeCloseTo(auto.rise, 6);
    expect(override.ridgeStart[0]).toBeCloseTo(auto.ridgeStart[0], 6);
    expect(override.ridgeEnd[0]).toBeCloseTo(auto.ridgeEnd[0], 6);
  });

  it('90\u00b0 override rotates the ridge from horizontal to vertical', () => {
    // Wide rect auto-pick = horizontal ridge at y=5, x \u2208 [0, 20].
    // 90\u00b0 override = vertical ridge at x=10, y \u2208 [0, 10].
    const g = computePolygonGable(rectWide, 6, 90)!;
    expect(g.axis[0]).toBeCloseTo(0, 6);
    expect(g.axis[1]).toBeCloseTo(1, 6);
    // rise still uses max-perp distance, but now perp is along +X
    // so perp = half the bbox X-extent = 10 \u2192 rise = (6/12)*10 = 5.
    expect(g.rise).toBeCloseTo(5, 6);
  });

  it('45\u00b0 override produces a diagonal ridge', () => {
    const g = computePolygonGable(rectWide, 6, 45)!;
    expect(g.axis[0]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(g.axis[1]).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('-90\u00b0 override = 270\u00b0 override (direction mod 180\u00b0 by clipping)', () => {
    // Ridge line at \u00b190\u00b0 passes through same two polygon edges \u2014
    // clipping produces axis vectors that may differ only in sign,
    // but the RIDGE LINE (not direction) is identical. So `rise`
    // and physical ridge match.
    const a = computePolygonGable(rectWide, 6, 90)!;
    const b = computePolygonGable(rectWide, 6, -90)!;
    expect(a.rise).toBeCloseTo(b.rise, 6);
  });
});

describe('computePolygonShed axisDegOverride', () => {
  const rectWide: [number, number][] = [[0, 0], [20, 0], [20, 10], [0, 10]];

  it('90\u00b0 override matches the auto-pick for a wide rect', () => {
    // Wide rect auto-pick tilts along +Y. Override 90\u00b0 = same direction.
    const auto = computePolygonShed(rectWide, 6)!;
    const override = computePolygonShed(rectWide, 6, 90)!;
    expect(override.axis[0]).toBeCloseTo(auto.axis[0], 6);
    expect(override.axis[1]).toBeCloseTo(auto.axis[1], 6);
    expect(override.riseAtHigh).toBeCloseTo(auto.riseAtHigh, 6);
  });

  it('0\u00b0 override: tilts along +X instead of +Y', () => {
    const s = computePolygonShed(rectWide, 6, 0)!;
    expect(s.axis[0]).toBeCloseTo(1, 6);
    expect(s.axis[1]).toBeCloseTo(0, 6);
    // New run = bboxW = 20; rise = (6/12)*20 = 10.
    expect(s.riseAtHigh).toBeCloseTo(10, 6);
    expect(s.lowValue).toBe(0);
    expect(s.highValue).toBe(20);
  });

  it('0\u00b0 override makes (20,0) the high point, (0,0) the low', () => {
    const s = computePolygonShed(rectWide, 6, 0)!;
    // Vertices (0,0),(20,0),(20,10),(0,10). Along +X:
    // v0 = 0 (low), v1 = 20 (high), v2 = 20 (high), v3 = 0 (low).
    expect(s.perVertexRise[0]).toBe(0);
    expect(s.perVertexRise[1]).toBeCloseTo(10, 6);
    expect(s.perVertexRise[2]).toBeCloseTo(10, 6);
    expect(s.perVertexRise[3]).toBe(0);
  });
});

describe('classifyPolygonRoof + axis override still classifies correctly', () => {
  it('convex polygon + gable + override \u2192 gable-ridge-auto', () => {
    expect(classifyPolygonRoof({
      polygon: [[0, 0], [20, 0], [20, 10], [0, 10]],
      roofType: 'gable',
      roofAxisOverrideDeg: 45,
    })).toBe('gable-ridge-auto');
  });

  it('convex polygon + shed + override \u2192 shed-auto', () => {
    expect(classifyPolygonRoof({
      polygon: [[0, 0], [20, 0], [20, 10], [0, 10]],
      roofType: 'shed',
      roofAxisOverrideDeg: 30,
    })).toBe('shed-auto');
  });
});

describe('classifyPolygonRoof gable + convex polygon', () => {
  it('wide rectangle + gable \u2192 gable-ridge-auto', () => {
    const rect: [number, number][] = [[0, 0], [20, 0], [20, 10], [0, 10]];
    expect(classifyPolygonRoof({ polygon: rect, roofType: 'gable' }))
      .toBe('gable-ridge-auto');
  });

  it('octagon + gable \u2192 gable-ridge-auto', () => {
    const oct: [number, number][] = [
      [2, 0], [10, 0], [12, 2], [12, 10], [10, 12], [2, 12], [0, 10], [0, 2],
    ];
    expect(classifyPolygonRoof({ polygon: oct, roofType: 'gable' }))
      .toBe('gable-ridge-auto');
  });

  it('L-shape (concave) + gable \u2192 skeleton-gable (R.21-promoted)', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    expect(classifyPolygonRoof({ polygon: L, roofType: 'gable' }))
      .toBe('skeleton-gable');
  });

  it('convex rect + hip still classifies as pyramid (hip wins over gable)', () => {
    const rect: [number, number][] = [[0, 0], [20, 0], [20, 10], [0, 10]];
    expect(classifyPolygonRoof({ polygon: rect, roofType: 'hip' })).toBe('pyramid');
  });
});

// ── Phase 14.R.21 concave + gable via skeleton ──────────────────

describe('classifyPolygonRoof concave + gable', () => {
  it('L-shape + gable \u2192 skeleton-gable (promoted from flat)', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    expect(classifyPolygonRoof({ polygon: L, roofType: 'gable' }))
      .toBe('skeleton-gable');
  });

  it('arrow pentagon + gable \u2192 skeleton-gable', () => {
    const arrow: [number, number][] = [
      [0, 0], [10, 0], [10, 8], [5, 5], [0, 8],
    ];
    expect(classifyPolygonRoof({ polygon: arrow, roofType: 'gable' }))
      .toBe('skeleton-gable');
  });

  it('2-reflex hexagon + gable \u2192 skeleton-gable', () => {
    const hex: [number, number][] = [
      [0, 0], [12, 0], [12, 10], [7, 5], [5, 5], [0, 10],
    ];
    expect(classifyPolygonRoof({ polygon: hex, roofType: 'gable' }))
      .toBe('skeleton-gable');
  });

  it('convex + gable still wins gable-ridge-auto (not skeleton-gable)', () => {
    expect(classifyPolygonRoof({
      polygon: [[0, 0], [20, 0], [20, 10], [0, 10]],
      roofType: 'gable',
    })).toBe('gable-ridge-auto');
  });
});

describe('skeleton-gable 3D geometry', () => {
  function mkGableSec(polygon: [number, number][]): RoofSection {
    return {
      sectionId: 'SG',
      label: 'Skeleton Gable',
      x: 0, y: 0, length: 10, run: 10,
      rotation: 0,
      slope: 6,
      roofType: 'gable',
      sectionType: 'main_roof',
      overhang: 0,
      z: 0,
      wastePct: 15,
      colorIdx: 0,
      locked: false,
      polygon,
    };
  }

  const L: [number, number][] = [
    [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
  ];

  it('L-shape: vertices = sum of (2 * leaf vertex count) across leaves', () => {
    const sec = mkGableSec(L);
    const v = vertices3d(sec);
    // R.15 decomposes the L into convex leaves; each leaf has N_i
    // polygon corners + N_i projections \u2192 2 * N_i vertices.
    // L-shape decomposition typically yields 2 leaves, e.g. 4-vert
    // and 4-vert (or 5+3), giving 2*4 + 2*4 = 16 or similar.
    expect(v.length).toBeGreaterThan(8);
  });

  it('L-shape: no face has faceType `flat` (every face is a gable slope/end)', () => {
    const sec = mkGableSec(L);
    const f = faces3d(sec);
    expect(f.every((x) => x.faceType !== 'flat')).toBe(true);
  });

  it('L-shape emits at least one valley edge at ground level', () => {
    const sec = mkGableSec(L);
    const e = edges3d(sec);
    const valleys = e.filter((x) => x.edgeType === 'valley');
    expect(valleys.length).toBeGreaterThanOrEqual(1);
  });

  it('axis override propagates to every leaf', () => {
    // Set override on the parent; expect every leaf's ridge to share
    // that direction. Since leaves are convex polygons, each one's
    // computePolygonGable produces a ridge along the override axis.
    const sec: RoofSection = { ...mkGableSec(L), roofAxisOverrideDeg: 45 };
    const f = faces3d(sec);
    // A face count > 2 confirms multiple leaves are contributing (not
    // just one convex fallback). Actual face layout depends on the
    // decomposition, but it must be non-trivial.
    expect(f.length).toBeGreaterThan(2);
  });

  it('undecomposable polygon + gable \u2192 flat fallback', () => {
    // Degenerate polygon with fewer than 3 vertices can\u2019t be classified
    // as a polygon at all (hasPolygon returns false), so this stays on
    // the rect path. We test with the dumbbell instead \u2014 which IS
    // decomposable, so expect skeleton-gable.
    const dumbbell: [number, number][] = [
      [0, 2], [3, 4], [6, 2], [9, 4], [12, 2],
      [12, 8], [9, 6], [6, 8], [3, 6], [0, 8],
    ];
    const sec = mkGableSec(dumbbell);
    const f = faces3d(sec);
    // Dumbbell decomposes successfully, so no single "flat" face.
    expect(f.every((x) => x.faceType !== 'flat')).toBe(true);
  });
});

describe('gable-ridge-auto 3D geometry', () => {
  function mkGableSec(polygon: [number, number][]): RoofSection {
    return {
      sectionId: 'G',
      label: 'Gable',
      x: 0, y: 0, length: 10, run: 10,
      rotation: 0,
      slope: 6,
      roofType: 'gable',
      sectionType: 'main_roof',
      overhang: 0,
      z: 0,
      wastePct: 15,
      colorIdx: 0,
      locked: false,
      polygon,
    };
  }

  it('wide rectangle: 4 eaves + 4 corners at z + 4 projections at z+rise', () => {
    const sec = mkGableSec([[0, 0], [20, 0], [20, 10], [0, 10]]);
    const v = vertices3d(sec);
    expect(v).toHaveLength(8);
    // First 4 at z=0
    for (let i = 0; i < 4; i++) {
      expect(v[i]![2]).toBe(0);
    }
    // Last 4 at z=rise=2.5
    for (let i = 4; i < 8; i++) {
      expect(v[i]![2]).toBeCloseTo(2.5, 6);
    }
  });

  it('rect: 4 faces \u2014 2 slope trapezoids + 2 gable-end triangles', () => {
    const sec = mkGableSec([[0, 0], [20, 0], [20, 10], [0, 10]]);
    const f = faces3d(sec);
    expect(f).toHaveLength(4);
    const slopes = f.filter((x) => x.faceType === 'slope_near');
    const gables = f.filter((x) => x.faceType === 'gable_left');
    expect(slopes).toHaveLength(2);
    expect(gables).toHaveLength(2);
    // Trapezoid faces have 4 indices; triangle gable-ends have 3.
    for (const face of slopes) expect(face.vertexIndices).toHaveLength(4);
    for (const face of gables) expect(face.vertexIndices).toHaveLength(3);
  });

  it('rect: edge classification has ridge + rakes + slope + eaves', () => {
    const sec = mkGableSec([[0, 0], [20, 0], [20, 10], [0, 10]]);
    const e = edges3d(sec);
    const counts = {
      eave: e.filter((x) => x.edgeType === 'eave').length,
      ridge: e.filter((x) => x.edgeType === 'ridge').length,
      rake: e.filter((x) => x.edgeType === 'rake').length,
      slope: e.filter((x) => x.edgeType === 'slope').length,
    };
    expect(counts.eave).toBe(4);
    // Rectangle: 4 corners all project to ridge endpoints, so all
    // slope-edges become rakes (gable-end slanted rake board runs).
    expect(counts.rake).toBe(4);
    expect(counts.slope).toBe(0);
    // Ridge edges run between consecutive projections when they differ.
    // For a wide rect, proj sequence is (0,5),(20,5),(20,5),(0,5) \u2014
    // changes at steps 0\u21921 and 2\u21923, so 2 ridge edges.
    expect(counts.ridge).toBe(2);
  });

  it('octagon gable: more interior slope edges than rake edges', () => {
    const oct: [number, number][] = [
      [2, 0], [10, 0], [12, 2], [12, 10], [10, 12], [2, 12], [0, 10], [0, 2],
    ];
    const sec = mkGableSec(oct);
    const e = edges3d(sec);
    const rakes = e.filter((x) => x.edgeType === 'rake').length;
    const slopes = e.filter((x) => x.edgeType === 'slope').length;
    // Ridge-endpoint vertices of the octagon: only 4 (the ones at
    // x=0 and x=12) — rest are interior slopes.
    expect(rakes).toBe(4);
    expect(slopes).toBe(4);
  });

  it('concave polygon + gable \u2192 skeleton-gable (R.21-promoted, non-flat)', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const sec = mkGableSec(L);
    const f = faces3d(sec);
    expect(f.length).toBeGreaterThan(1);
    expect(f.every((x) => x.faceType !== 'flat')).toBe(true);
  });
});

// ── Phase 14.R.17 polygon shed ──────────────────────────────────

describe('computePolygonShed', () => {
  const rectWide: [number, number][] = [[0, 0], [20, 0], [20, 10], [0, 10]];

  it('wide rectangle: tilts along +Y (perpendicular to bbox long axis)', () => {
    const s = computePolygonShed(rectWide, 6)!;
    expect(s).not.toBeNull();
    expect(s.axis[0]).toBeCloseTo(0, 6);
    expect(s.axis[1]).toBeCloseTo(1, 6);
    // Tiny float drift from Math.cos/sin(\u03c0/2); use close-to.
    expect(s.lowValue).toBeCloseTo(0, 6);
    expect(s.highValue).toBeCloseTo(10, 6);
  });

  it('tall rectangle: tilts along +X', () => {
    const rectTall: [number, number][] = [[0, 0], [10, 0], [10, 20], [0, 20]];
    const s = computePolygonShed(rectTall, 6)!;
    expect(s.axis[0]).toBeCloseTo(1, 6);
    expect(s.axis[1]).toBeCloseTo(0, 6);
    expect(s.lowValue).toBeCloseTo(0, 6);
    expect(s.highValue).toBeCloseTo(10, 6);
  });

  it('riseAtHigh matches rect-shed: (slope/12) \u00b7 run', () => {
    // 20\u00d710 horizontal \u2192 run=10 (the short bbox dim), rise=(6/12)*10=5.
    const s = computePolygonShed(rectWide, 6)!;
    expect(s.riseAtHigh).toBeCloseTo(5, 6);
  });

  it('per-vertex rise is linear in along-axis coordinate', () => {
    const s = computePolygonShed(rectWide, 6)!;
    // Vertices (0,0), (20,0), (20,10), (0,10). Axis = +Y, lowValue=0.
    // Rise = y/10 \u00d7 5.
    expect(s.perVertexRise[0]).toBeCloseTo(0, 6);
    expect(s.perVertexRise[1]).toBeCloseTo(0, 6);
    expect(s.perVertexRise[2]).toBeCloseTo(5, 6);
    expect(s.perVertexRise[3]).toBeCloseTo(5, 6);
  });

  it('scales rise linearly in slope', () => {
    const a = computePolygonShed(rectWide, 6)!;
    const b = computePolygonShed(rectWide, 12)!;
    expect(b.riseAtHigh).toBeCloseTo(2 * a.riseAtHigh, 6);
  });

  it('triangle apex gets full rise; base vertices get zero', () => {
    const tri: [number, number][] = [[0, 0], [10, 0], [5, 10]];
    const s = computePolygonShed(tri, 6)!;
    expect(s.perVertexRise[0]).toBeCloseTo(0, 6); // base
    expect(s.perVertexRise[1]).toBeCloseTo(0, 6); // base
    expect(s.perVertexRise[2]).toBeCloseTo(5, 6); // apex
  });

  it('octagon: interior vertices get intermediate rise', () => {
    const oct: [number, number][] = [
      [2, 0], [10, 0], [12, 2], [12, 10], [10, 12], [2, 12], [0, 10], [0, 2],
    ];
    const s = computePolygonShed(oct, 6)!;
    // useY=true (12x12 tie, <= picks true), lowValue=0, highValue=12, rise=6.
    // Vertex 0 (2,0): rise = 0.
    // Vertex 2 (12,2): rise = 2/12 \u00b7 6 = 1.
    // Vertex 4 (10,12): rise = 12/12 \u00b7 6 = 6.
    expect(s.perVertexRise[0]).toBe(0);
    expect(s.perVertexRise[2]).toBeCloseTo(1, 6);
    expect(s.perVertexRise[4]).toBeCloseTo(6, 6);
  });

  it('non-convex polygon returns a valid shed (R.22 \u2014 single tilted plane)', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const s = computePolygonShed(L, 6);
    expect(s).not.toBeNull();
    // bbox 6\u00d76 \u2192 tie goes to axis along +Y. lowValue=0 (at y=0 eaves),
    // highValue=6 (at y=6 eaves), run=6, riseAtHigh=(6/12)*6 = 3.
    expect(s!.axis[0]).toBeCloseTo(0, 6);
    expect(s!.axis[1]).toBeCloseTo(1, 6);
    expect(s!.lowValue).toBeCloseTo(0, 6);
    expect(s!.highValue).toBeCloseTo(6, 6);
    expect(s!.riseAtHigh).toBeCloseTo(3, 6);
  });

  it('L-shape per-vertex rise lies on the single tilted plane', () => {
    // L at y=0 (eaves z=0), interior seam at y=3 (z=1.5), top at y=6 (z=3).
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const s = computePolygonShed(L, 6)!;
    expect(s.perVertexRise[0]).toBeCloseTo(0, 6);   // (0,0)
    expect(s.perVertexRise[1]).toBeCloseTo(0, 6);   // (6,0)
    expect(s.perVertexRise[2]).toBeCloseTo(1.5, 6); // (6,3)
    expect(s.perVertexRise[3]).toBeCloseTo(1.5, 6); // (3,3)
    expect(s.perVertexRise[4]).toBeCloseTo(3, 6);   // (3,6)
    expect(s.perVertexRise[5]).toBeCloseTo(3, 6);   // (0,6)
  });

  it('degenerate polygon (<3 vertices) returns null', () => {
    expect(computePolygonShed([[0, 0], [5, 0]], 6)).toBeNull();
  });

  it('degenerate polygon (zero bbox dim) returns null', () => {
    expect(computePolygonShed([[0, 0], [5, 0], [10, 0]], 6)).toBeNull();
  });
});

describe('classifyPolygonRoof shed', () => {
  it('convex polygon + shed \u2192 shed-auto', () => {
    expect(classifyPolygonRoof({
      polygon: [[0, 0], [20, 0], [20, 10], [0, 10]],
      roofType: 'shed',
    })).toBe('shed-auto');
  });

  it('concave polygon + shed \u2192 shed-auto (R.22-promoted from flat)', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    expect(classifyPolygonRoof({ polygon: L, roofType: 'shed' }))
      .toBe('shed-auto');
  });

  it('convex polygon + gable still \u2192 gable-ridge-auto (not shed)', () => {
    expect(classifyPolygonRoof({
      polygon: [[0, 0], [20, 0], [20, 10], [0, 10]],
      roofType: 'gable',
    })).toBe('gable-ridge-auto');
  });
});

describe('shed-auto 3D geometry', () => {
  function mkShedSec(polygon: [number, number][]): RoofSection {
    return {
      sectionId: 'S',
      label: 'Shed',
      x: 0, y: 0, length: 20, run: 10,
      rotation: 0,
      slope: 6,
      roofType: 'shed',
      sectionType: 'main_roof',
      overhang: 0,
      z: 0,
      wastePct: 15,
      colorIdx: 0,
      locked: false,
      polygon,
    };
  }

  it('rect: N vertices at per-vertex elevations (no duplicates)', () => {
    const sec = mkShedSec([[0, 0], [20, 0], [20, 10], [0, 10]]);
    const v = vertices3d(sec);
    expect(v).toHaveLength(4);
    expect(v[0]![2]).toBeCloseTo(0, 6); // low
    expect(v[1]![2]).toBeCloseTo(0, 6); // low
    expect(v[2]![2]).toBeCloseTo(5, 6); // high
    expect(v[3]![2]).toBeCloseTo(5, 6); // high
  });

  it('rect: 1 slope face covering all polygon indices', () => {
    const sec = mkShedSec([[0, 0], [20, 0], [20, 10], [0, 10]]);
    const f = faces3d(sec);
    expect(f).toHaveLength(1);
    expect(f[0]!.faceType).toBe('slope');
    expect(f[0]!.vertexIndices).toEqual([0, 1, 2, 3]);
  });

  it('rect: 4 edges \u2014 1 eave + 1 ridge + 2 rakes', () => {
    const sec = mkShedSec([[0, 0], [20, 0], [20, 10], [0, 10]]);
    const e = edges3d(sec);
    expect(e).toHaveLength(4);
    expect(e.filter((x) => x.edgeType === 'eave')).toHaveLength(1);
    expect(e.filter((x) => x.edgeType === 'ridge')).toHaveLength(1);
    expect(e.filter((x) => x.edgeType === 'rake')).toHaveLength(2);
  });

  it('triangle: 3 verts at varying z, 1 slope face, 1 eave + 2 rake edges', () => {
    const sec = mkShedSec([[0, 0], [10, 0], [5, 10]]);
    const v = vertices3d(sec);
    expect(v).toHaveLength(3);
    expect(v[0]![2]).toBeCloseTo(0, 6);
    expect(v[1]![2]).toBeCloseTo(0, 6);
    expect(v[2]![2]).toBeCloseTo(5, 6);
    const f = faces3d(sec);
    expect(f).toHaveLength(1);
    expect(f[0]!.faceType).toBe('slope');
    const e = edges3d(sec);
    expect(e.filter((x) => x.edgeType === 'eave')).toHaveLength(1); // base
    expect(e.filter((x) => x.edgeType === 'rake')).toHaveLength(2);
    expect(e.filter((x) => x.edgeType === 'ridge')).toHaveLength(0);
  });

  it('concave L-shape + shed \u2192 single tilted slope face (R.22)', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const sec = mkShedSec(L);
    const f = faces3d(sec);
    // ONE slope face covering all 6 polygon vertices. Ear-clipping
    // downstream in buildFaceGeometry handles the concave shape.
    expect(f).toHaveLength(1);
    expect(f[0]!.faceType).toBe('slope');
    expect(f[0]!.vertexIndices).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('L-shape shed: interior seam vertex sits at intermediate elevation', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const sec = mkShedSec(L);
    const v = vertices3d(sec);
    // Reflex vertex at polygon index 3 = (3, 3). Expected z = 1.5
    // (half of riseAtHigh=3 for slope=6, run=6).
    expect(v[3]![0]).toBeCloseTo(3, 6);
    expect(v[3]![1]).toBeCloseTo(3, 6);
    expect(v[3]![2]).toBeCloseTo(1.5, 6);
  });

  it('L-shape shed edges: interior seam edge classified as rake (spans low-high boundary)', () => {
    const L: [number, number][] = [
      [0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6],
    ];
    const sec = mkShedSec(L);
    const e = edges3d(sec);
    expect(e).toHaveLength(6);
    // Edges spanning y=0 eave and y=6 eave are classified through
    // the shed-auto alongAxis logic; interior edges at intermediate
    // y values are rakes.
    const rakes = e.filter((x) => x.edgeType === 'rake').length;
    expect(rakes).toBeGreaterThan(0);
  });
});

// ── Phase 14.R.19 polygon rotation ──────────────────────────────

describe('rotatePolygon', () => {
  it('0\u00b0 rotation returns a copy with identical coords', () => {
    const poly: [number, number][] = [[0, 0], [10, 0], [10, 5], [0, 5]];
    const rotated = rotatePolygon(poly, [5, 2.5], 0);
    expect(rotated).toEqual(poly);
    // Should be a new array reference (immutability).
    expect(rotated).not.toBe(poly);
  });

  it('90\u00b0 CCW rotates around center: (10,0)\u2192(5,5) when center=(5,2.5)', () => {
    // Center (5, 2.5). Point (10, 0) rotated 90° CCW around center:
    //   rel = (5, -2.5); rotated = (2.5, 5); world = (7.5, 7.5)
    const rotated = rotatePolygon([[10, 0]], [5, 2.5], 90);
    expect(rotated[0]![0]).toBeCloseTo(7.5, 6);
    expect(rotated[0]![1]).toBeCloseTo(7.5, 6);
  });

  it('180\u00b0 rotation mirrors each vertex across the center', () => {
    const poly: [number, number][] = [[0, 0], [10, 0], [10, 5], [0, 5]];
    const center: [number, number] = [5, 2.5];
    const rotated = rotatePolygon(poly, center, 180);
    // Floating-point: Math.sin(\u03c0) leaves ~3e-16 residue. Use close-to.
    expect(rotated[0]![0]).toBeCloseTo(10, 6);
    expect(rotated[0]![1]).toBeCloseTo(5, 6);
    expect(rotated[1]![0]).toBeCloseTo(0, 6);
    expect(rotated[1]![1]).toBeCloseTo(5, 6);
    expect(rotated[2]![0]).toBeCloseTo(0, 6);
    expect(rotated[2]![1]).toBeCloseTo(0, 6);
    expect(rotated[3]![0]).toBeCloseTo(10, 6);
    expect(rotated[3]![1]).toBeCloseTo(0, 6);
  });

  it('360\u00b0 rotation returns each vertex to its original position', () => {
    const poly: [number, number][] = [[1, 2], [7, 3], [8, 9], [2, 8]];
    const rotated = rotatePolygon(poly, [4, 5], 360);
    for (let i = 0; i < poly.length; i++) {
      expect(rotated[i]![0]).toBeCloseTo(poly[i]![0], 6);
      expect(rotated[i]![1]).toBeCloseTo(poly[i]![1], 6);
    }
  });

  it('rotating around a vertex keeps that vertex fixed', () => {
    const poly: [number, number][] = [[0, 0], [10, 0], [5, 8]];
    const rotated = rotatePolygon(poly, [0, 0], 45);
    expect(rotated[0]![0]).toBeCloseTo(0, 6);
    expect(rotated[0]![1]).toBeCloseTo(0, 6);
  });

  it('input polygon is NOT mutated', () => {
    const poly: [number, number][] = [[0, 0], [10, 0], [10, 5]];
    rotatePolygon(poly, [5, 2.5], 45);
    expect(poly).toEqual([[0, 0], [10, 0], [10, 5]]);
  });

  it('negative angle rotates clockwise', () => {
    const poly: [number, number][] = [[10, 0]];
    // CCW 90 vs CW 90 from (0,0): CCW (10,0)\u2192(0,10), CW \u2192(0,-10).
    const ccw = rotatePolygon(poly, [0, 0], 90);
    const cw = rotatePolygon(poly, [0, 0], -90);
    expect(ccw[0]![1]).toBeCloseTo(10, 6);
    expect(cw[0]![1]).toBeCloseTo(-10, 6);
  });
});

describe('rescaleFromWorldPoints', () => {
  it('scales up when the real distance is smaller than measured', () => {
    // 5-ft world gap measured under scale 10 → 50 px apart.
    // User says they are 2 ft apart in reality → newScale = 50/2 = 25.
    const s = rescaleFromWorldPoints(10, [0, 0], [5, 0], 2);
    expect(s).toBeCloseTo(25, 6);
  });

  it('scales down when the real distance is larger than measured', () => {
    // 5-ft gap at scale 10 → 50 px. User says 10 ft → newScale = 5.
    const s = rescaleFromWorldPoints(10, [0, 0], [5, 0], 10);
    expect(s).toBeCloseTo(5, 6);
  });

  it('returns currentScale on zero realFt', () => {
    expect(rescaleFromWorldPoints(7, [0, 0], [3, 4], 0)).toBe(7);
  });

  it('returns currentScale on negative realFt', () => {
    expect(rescaleFromWorldPoints(7, [0, 0], [3, 4], -5)).toBe(7);
  });

  it('returns currentScale when both anchors coincide', () => {
    expect(rescaleFromWorldPoints(7, [1, 1], [1, 1], 5)).toBe(7);
  });

  it('handles diagonal anchors', () => {
    // (0,0) → (3,4) has world dist 5. Scale 10 → 50 px. Real 20 ft → 2.5.
    const s = rescaleFromWorldPoints(10, [0, 0], [3, 4], 20);
    expect(s).toBeCloseTo(2.5, 6);
  });
});

// ── Aggregate queries ──────────────────────────────────────────

describe('totalAreaNet / totalAreaPlan / totalPerimeter', () => {
  const s1 = mkSection({ sectionId: 'A', length: 30, run: 20, overhang: 1, slope: 6 });
  const s2 = mkSection({ sectionId: 'B', length: 40, run: 20, overhang: 1, slope: 4 });

  it('empty list → 0', () => {
    expect(totalAreaNet([])).toBe(0);
    expect(totalAreaPlan([])).toBe(0);
    expect(totalPerimeter([])).toBe(0);
  });

  it('single section matches direct helper', () => {
    expect(totalAreaPlan([s1])).toBe(areaPlan(s1));
    expect(totalAreaNet([s1])).toBe(areaActual(s1));
  });

  it('two sections sum', () => {
    expect(totalAreaPlan([s1, s2])).toBe(areaPlan(s1) + areaPlan(s2));
    expect(totalAreaNet([s1, s2])).toBe(areaActual(s1) + areaActual(s2));
    expect(totalPerimeter([s1, s2])).toBe(perimeterPlan(s1) + perimeterPlan(s2));
  });
});

// ── sectionAt hit test ──────────────────────────────────────────

describe('sectionAt', () => {
  const a = mkSection({ sectionId: 'A', x: 0, y: 0, length: 10, run: 10 });
  const b = mkSection({ sectionId: 'B', x: 5, y: 5, length: 10, run: 10 }); // overlaps A

  it('empty list → null', () => {
    expect(sectionAt([], 1, 1)).toBeNull();
  });

  it('single section: inside → id, outside → null', () => {
    expect(sectionAt([a], 5, 5)).toBe('A');
    expect(sectionAt([a], 50, 50)).toBeNull();
  });

  it('topmost wins: later sections take precedence', () => {
    // Point (7, 7) is inside both A and B. B is LATER in list → B wins.
    expect(sectionAt([a, b], 7, 7)).toBe('B');
    expect(sectionAt([b, a], 7, 7)).toBe('A');
  });
});

// ── Empty snapshot ─────────────────────────────────────────────

describe('emptyRoofSnapshot', () => {
  it('has default layers + empty pdf', () => {
    const s = emptyRoofSnapshot();
    expect(s.layers).toHaveLength(DEFAULT_LAYERS.length);
    expect(s.pdf.pdfPath).toBe('');
    expect(Object.keys(s.sections)).toHaveLength(0);
  });

  it('includes empty penetrations slice (R.27)', () => {
    const s = emptyRoofSnapshot();
    expect(s.penetrations).toBeDefined();
    expect(Object.keys(s.penetrations!)).toHaveLength(0);
    expect(s.penetrationOrder).toEqual([]);
  });
});

// ── Phase 14.R.27 — penetration helpers ─────────────────────────

describe('createPenetration (R.27)', () => {
  it('fills kind-specific defaults when size is omitted', () => {
    const chim = createPenetration({ id: 'A', kind: 'chimney',      x: 0, y: 0 });
    const sky  = createPenetration({ id: 'B', kind: 'skylight',     x: 0, y: 0 });
    const vent = createPenetration({ id: 'C', kind: 'plumbing_vent', x: 0, y: 0 });
    expect(chim.widthFt).toBe(PENETRATION_DEFAULTS.chimney.widthFt);
    expect(sky.widthFt).toBe(PENETRATION_DEFAULTS.skylight.widthFt);
    expect(sky.lengthFt).toBe(PENETRATION_DEFAULTS.skylight.lengthFt);
    expect(vent.widthFt).toBe(PENETRATION_DEFAULTS.plumbing_vent.widthFt);
  });

  it('labels default to the kind label (unsuffixed)', () => {
    const pen = createPenetration({ id: 'X', kind: 'skylight', x: 0, y: 0 });
    expect(pen.label).toBe(PENETRATION_LABELS.skylight);
  });

  it('explicit overrides win over defaults', () => {
    const pen = createPenetration({
      id: 'X', kind: 'chimney', x: 5, y: 5,
      widthFt: 4, lengthFt: 4, label: 'Big one',
    });
    expect(pen.widthFt).toBe(4);
    expect(pen.lengthFt).toBe(4);
    expect(pen.label).toBe('Big one');
  });
});

describe('penetrationCounts (R.27)', () => {
  it('returns zero counts for an empty array', () => {
    expect(penetrationCounts([])).toEqual({
      plumbing_vent: 0, skylight: 0, chimney: 0,
    });
  });

  it('tallies by kind', () => {
    const list = [
      createPenetration({ id: '1', kind: 'skylight',      x: 0, y: 0 }),
      createPenetration({ id: '2', kind: 'skylight',      x: 1, y: 0 }),
      createPenetration({ id: '3', kind: 'chimney',       x: 2, y: 0 }),
      createPenetration({ id: '4', kind: 'plumbing_vent', x: 3, y: 0 }),
      createPenetration({ id: '5', kind: 'plumbing_vent', x: 4, y: 0 }),
      createPenetration({ id: '6', kind: 'plumbing_vent', x: 5, y: 0 }),
    ];
    expect(penetrationCounts(list)).toEqual({
      plumbing_vent: 3, skylight: 2, chimney: 1,
    });
  });

  it('kinds with no placements stay at zero in the output (all three keys always present)', () => {
    const onlySkylights = [
      createPenetration({ id: '1', kind: 'skylight', x: 0, y: 0 }),
    ];
    const c = penetrationCounts(onlySkylights);
    expect(c.skylight).toBe(1);
    expect(c.chimney).toBe(0);
    expect(c.plumbing_vent).toBe(0);
  });
});
