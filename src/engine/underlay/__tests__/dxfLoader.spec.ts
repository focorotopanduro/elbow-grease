/**
 * dxfLoader — Phase 14.R.25 tests.
 *
 * Covers the pure parser path. Rasterization (canvas-based) is
 * exercised by the RoofingPDFPanel integration in the running app
 * — jsdom's canvas shim doesn't faithfully reproduce
 * `toDataURL('image/png')` so unit-testing it would test the shim,
 * not our code.
 */

import { describe, it, expect } from 'vitest';
import {
  isDxfFile,
  parseDxf,
  computeBbox,
  type DxfEntity,
} from '../dxfLoader';

// ── isDxfFile ──────────────────────────────────────────────────

describe('isDxfFile', () => {
  it('accepts .dxf extension', () => {
    expect(isDxfFile({ name: 'plans.dxf' })).toBe(true);
  });

  it('accepts .DXF extension (case-insensitive)', () => {
    expect(isDxfFile({ name: 'PLANS.DXF' })).toBe(true);
  });

  it('accepts application/dxf MIME', () => {
    expect(isDxfFile({ type: 'application/dxf', name: 'x' })).toBe(true);
  });

  it('accepts image/vnd.dxf MIME', () => {
    expect(isDxfFile({ type: 'image/vnd.dxf', name: 'x' })).toBe(true);
  });

  it('rejects .pdf', () => {
    expect(isDxfFile({ name: 'plans.pdf' })).toBe(false);
  });

  it('rejects .png', () => {
    expect(isDxfFile({ name: 'roof.png', type: 'image/png' })).toBe(false);
  });

  it('rejects empty input', () => {
    expect(isDxfFile({})).toBe(false);
  });
});

// ── DXF text fixtures ──────────────────────────────────────────

/** Build a DXF "ENTITIES" section wrapped in the required headers. */
function dxfWithEntities(entitiesBody: string): string {
  return [
    '0', 'SECTION',
    '2', 'ENTITIES',
    entitiesBody,
    '0', 'ENDSEC',
    '0', 'EOF',
  ].join('\n');
}

// ── Parser ─────────────────────────────────────────────────────

describe('parseDxf — empty / minimal', () => {
  it('returns empty entities for an EOF-only file', () => {
    const out = parseDxf(['0', 'EOF'].join('\n'));
    expect(out.entities).toEqual([]);
    expect(out.bbox).toBeNull();
  });

  it('returns empty entities for an empty ENTITIES section', () => {
    const out = parseDxf(dxfWithEntities([].join('\n')));
    expect(out.entities).toEqual([]);
    expect(out.bbox).toBeNull();
  });

  it('rejects binary DXF with a clear error', () => {
    expect(() => parseDxf('AutoCAD Binary DXF\n...')).toThrow(/Binary DXF/);
  });

  it('handles CRLF line endings', () => {
    const text = ['0', 'SECTION', '2', 'ENTITIES',
      '0', 'LINE', '10', '0', '20', '0', '11', '5', '21', '0',
      '0', 'ENDSEC', '0', 'EOF',
    ].join('\r\n');
    const out = parseDxf(text);
    expect(out.entities).toHaveLength(1);
  });
});

describe('parseDxf — LINE', () => {
  it('parses a single LINE with start + end coords', () => {
    const body = [
      '0', 'LINE',
      '10', '1', '20', '2',
      '11', '4', '21', '6',
    ].join('\n');
    const out = parseDxf(dxfWithEntities(body));
    expect(out.entities).toHaveLength(1);
    expect(out.entities[0]).toEqual({
      kind: 'line', x1: 1, y1: 2, x2: 4, y2: 6,
    });
  });

  it('parses multiple consecutive LINEs', () => {
    const body = [
      '0', 'LINE', '10', '0', '20', '0', '11', '10', '21', '0',
      '0', 'LINE', '10', '10', '20', '0', '11', '10', '21', '5',
    ].join('\n');
    const out = parseDxf(dxfWithEntities(body));
    expect(out.entities).toHaveLength(2);
    expect(out.entities[0]!.kind).toBe('line');
    expect(out.entities[1]!.kind).toBe('line');
  });

  it('skips a malformed LINE that\u2019s missing endpoint coords', () => {
    const body = [
      '0', 'LINE', '10', '1', '20', '2', // no 11/21
    ].join('\n');
    const out = parseDxf(dxfWithEntities(body));
    expect(out.entities).toHaveLength(0);
  });
});

describe('parseDxf — LWPOLYLINE', () => {
  it('parses a 4-vertex closed polyline', () => {
    const body = [
      '0', 'LWPOLYLINE',
      '90', '4',
      '70', '1', // closed
      '10', '0',  '20', '0',
      '10', '10', '20', '0',
      '10', '10', '20', '5',
      '10', '0',  '20', '5',
    ].join('\n');
    const out = parseDxf(dxfWithEntities(body));
    expect(out.entities).toHaveLength(1);
    const poly = out.entities[0] as Extract<DxfEntity, { kind: 'polyline' }>;
    expect(poly.kind).toBe('polyline');
    expect(poly.closed).toBe(true);
    expect(poly.points).toEqual([[0, 0], [10, 0], [10, 5], [0, 5]]);
  });

  it('treats unset 70 flag as open polyline', () => {
    const body = [
      '0', 'LWPOLYLINE',
      '10', '0', '20', '0',
      '10', '5', '20', '5',
      '10', '10', '20', '0',
    ].join('\n');
    const out = parseDxf(dxfWithEntities(body));
    const poly = out.entities[0] as Extract<DxfEntity, { kind: 'polyline' }>;
    expect(poly.closed).toBe(false);
    expect(poly.points).toHaveLength(3);
  });

  it('skips polylines with fewer than 2 vertices', () => {
    const body = [
      '0', 'LWPOLYLINE',
      '10', '0', '20', '0',
    ].join('\n');
    const out = parseDxf(dxfWithEntities(body));
    expect(out.entities).toHaveLength(0);
  });
});

describe('parseDxf — CIRCLE', () => {
  it('parses center + radius', () => {
    const body = ['0', 'CIRCLE', '10', '5', '20', '7', '40', '3'].join('\n');
    const out = parseDxf(dxfWithEntities(body));
    expect(out.entities[0]).toEqual({ kind: 'circle', cx: 5, cy: 7, r: 3 });
  });

  it('skips circle with non-positive radius', () => {
    const body = ['0', 'CIRCLE', '10', '5', '20', '7', '40', '0'].join('\n');
    expect(parseDxf(dxfWithEntities(body)).entities).toHaveLength(0);
  });
});

describe('parseDxf — ARC', () => {
  it('parses center, radius, and start/end angles', () => {
    const body = [
      '0', 'ARC',
      '10', '0', '20', '0',
      '40', '5',
      '50', '0',
      '51', '90',
    ].join('\n');
    const out = parseDxf(dxfWithEntities(body));
    expect(out.entities[0]).toEqual({
      kind: 'arc', cx: 0, cy: 0, r: 5, startDeg: 0, endDeg: 90,
    });
  });

  it('skips arc missing angle data', () => {
    const body = ['0', 'ARC', '10', '0', '20', '0', '40', '5', '50', '0'].join('\n');
    expect(parseDxf(dxfWithEntities(body)).entities).toHaveLength(0);
  });
});

describe('parseDxf — unsupported entities are silently skipped', () => {
  it('skips TEXT entities without erroring', () => {
    const body = [
      '0', 'TEXT', '10', '0', '20', '0', '40', '0.2', '1', 'hello',
      '0', 'LINE', '10', '0', '20', '0', '11', '5', '21', '0',
    ].join('\n');
    const out = parseDxf(dxfWithEntities(body));
    expect(out.entities).toHaveLength(1);
    expect(out.entities[0]!.kind).toBe('line');
  });

  it('skips SPLINE without erroring', () => {
    const body = [
      '0', 'SPLINE', '70', '8',
      '0', 'CIRCLE', '10', '0', '20', '0', '40', '1',
    ].join('\n');
    const out = parseDxf(dxfWithEntities(body));
    expect(out.entities).toHaveLength(1);
    expect(out.entities[0]!.kind).toBe('circle');
  });
});

describe('parseDxf — bbox', () => {
  it('computes bbox across mixed entities', () => {
    const body = [
      '0', 'LINE', '10', '0', '20', '0', '11', '10', '21', '0',
      '0', 'CIRCLE', '10', '20', '20', '5', '40', '3',
    ].join('\n');
    const out = parseDxf(dxfWithEntities(body));
    expect(out.bbox).toEqual({
      minX: 0, minY: 0, maxX: 23, maxY: 8,
    });
  });

  it('bbox is null for an empty file', () => {
    expect(parseDxf(['0', 'EOF'].join('\n')).bbox).toBeNull();
  });
});

// ── computeBbox standalone ─────────────────────────────────────

describe('computeBbox', () => {
  it('returns null for empty input', () => {
    expect(computeBbox([])).toBeNull();
  });

  it('handles a single line', () => {
    expect(computeBbox([
      { kind: 'line', x1: 1, y1: 2, x2: 7, y2: -3 },
    ])).toEqual({ minX: 1, minY: -3, maxX: 7, maxY: 2 });
  });

  it('handles a closed polyline', () => {
    expect(computeBbox([
      { kind: 'polyline', closed: true, points: [[0, 0], [10, 0], [5, 8]] },
    ])).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 8 });
  });

  it('handles a circle (full radius bbox)', () => {
    expect(computeBbox([
      { kind: 'circle', cx: 5, cy: 5, r: 2 },
    ])).toEqual({ minX: 3, minY: 3, maxX: 7, maxY: 7 });
  });

  it('handles an arc as if it were the full circle (conservative)', () => {
    // An arc only on the upper half still gets its bbox sized as the
    // full circle — over-includes empty space but never clips content.
    expect(computeBbox([
      { kind: 'arc', cx: 0, cy: 0, r: 10, startDeg: 0, endDeg: 180 },
    ])).toEqual({ minX: -10, minY: -10, maxX: 10, maxY: 10 });
  });

  it('combines bboxes across heterogeneous entities', () => {
    const e: DxfEntity[] = [
      { kind: 'line', x1: -5, y1: 0, x2: 5, y2: 0 },
      { kind: 'circle', cx: 0, cy: 10, r: 3 },
      { kind: 'polyline', closed: false, points: [[20, -2], [25, 12]] },
    ];
    // line contributes y=0; circle contributes y\u2208[7,13]; polyline
    // contributes y\u2208[-2,12]. Union minY=-2, maxY=13.
    expect(computeBbox(e)).toEqual({
      minX: -5, minY: -2, maxX: 25, maxY: 13,
    });
  });
});
