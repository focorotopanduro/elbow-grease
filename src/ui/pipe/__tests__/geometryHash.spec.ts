/**
 * geometryHash primitive — Phase 14.AD.13.a tests.
 *
 * The hash is the foundation of AD.13.b/c snapshot tests. If it's
 * non-deterministic or too collision-prone, every downstream test
 * either flakes or misses regressions. These specs lock the
 * invariants before we build snapshots on top of them.
 *
 * Determinism:
 *   - Same geometry → same hash forever.
 *   - Same shape, different buffer instance → same hash.
 *   - Float drift at 6th decimal → same hash (quantized).
 *
 * Sensitivity:
 *   - One vertex moved > 1 µft → different hash.
 *   - Extra vertex → different hash.
 *   - Changed index → different hash.
 *   - Missing normal attribute → different hash.
 *
 * Output shape:
 *   - 16 lowercase hex characters.
 *   - Not obviously correlated to input size.
 */

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { hashBufferGeometry, fingerprintBufferGeometry } from '../geometryHash';

// ── Test helpers ─────────────────────────────────────────────

function makeBox(w = 1, h = 1, d = 1): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d);
}

function makeCyl(r = 1, h = 1, segs = 8): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, h, segs);
}

// ── Output shape ─────────────────────────────────────────────

describe('hashBufferGeometry — output format', () => {
  it('returns a 16-character lowercase hex string', () => {
    const h = hashBufferGeometry(makeBox());
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it('empty geometry still produces 16 chars', () => {
    const h = hashBufferGeometry(new THREE.BufferGeometry());
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ── Determinism ──────────────────────────────────────────────

describe('hashBufferGeometry — deterministic', () => {
  it('same geometry built twice → identical hash', () => {
    const h1 = hashBufferGeometry(makeBox(1, 1, 1));
    const h2 = hashBufferGeometry(makeBox(1, 1, 1));
    expect(h1).toBe(h2);
  });

  it('same cylinder params → identical hash across fresh allocations', () => {
    const h1 = hashBufferGeometry(makeCyl(0.1, 5, 12));
    const h2 = hashBufferGeometry(makeCyl(0.1, 5, 12));
    expect(h1).toBe(h2);
  });

  it('multiple hashes across 100 iterations — all identical', () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      hashes.add(hashBufferGeometry(makeBox(2, 3, 4)));
    }
    expect(hashes.size).toBe(1);
  });
});

// ── Sensitivity: real changes trip the hash ─────────────────

describe('hashBufferGeometry — sensitivity', () => {
  it('different box size → different hash', () => {
    const h1 = hashBufferGeometry(makeBox(1, 1, 1));
    const h2 = hashBufferGeometry(makeBox(2, 1, 1));
    expect(h1).not.toBe(h2);
  });

  it('box vs cylinder → different hash', () => {
    const h1 = hashBufferGeometry(makeBox());
    const h2 = hashBufferGeometry(makeCyl());
    expect(h1).not.toBe(h2);
  });

  it('cylinder with more segments → different hash', () => {
    const h1 = hashBufferGeometry(makeCyl(1, 1, 8));
    const h2 = hashBufferGeometry(makeCyl(1, 1, 16));
    expect(h1).not.toBe(h2);
  });

  it('translated geometry → different hash (position matters)', () => {
    const g1 = makeBox();
    const g2 = makeBox();
    g2.translate(1, 0, 0);
    expect(hashBufferGeometry(g1)).not.toBe(hashBufferGeometry(g2));
  });

  it('rotated geometry → different hash (orientation matters)', () => {
    const g1 = makeBox();
    const g2 = makeBox();
    g2.rotateY(Math.PI / 4);
    expect(hashBufferGeometry(g1)).not.toBe(hashBufferGeometry(g2));
  });
});

// ── Quantization: benign drift doesn't trip ─────────────────

describe('hashBufferGeometry — quantization', () => {
  it('drift at 7th decimal place → SAME hash (below 1 µft precision)', () => {
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0.0000001, 0, 0, 1, 0, 0, 0.5, 1, 0]), 3,
    ));
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0.0000003, 0, 0, 1, 0, 0, 0.5, 1, 0]), 3,
    ));
    expect(hashBufferGeometry(g1)).toBe(hashBufferGeometry(g2));
  });

  it('drift at 5th decimal place → DIFFERENT hash (1 µft is the threshold)', () => {
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0.00001, 0, 0, 1, 0, 0]), 3,
    ));
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0.00002, 0, 0, 1, 0, 0]), 3,
    ));
    expect(hashBufferGeometry(g1)).not.toBe(hashBufferGeometry(g2));
  });

  it('+0 and -0 hash identically (signed-zero guard)', () => {
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, 1, 0, 0]), 3,
    ));
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-0, -0, -0, 1, -0, 0]), 3,
    ));
    expect(hashBufferGeometry(g1)).toBe(hashBufferGeometry(g2));
  });

  it('NaN / Infinity values are treated as 0 (defensive)', () => {
    const g1 = new THREE.BufferGeometry();
    g1.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([NaN, Infinity, -Infinity, 1, 0, 0]), 3,
    ));
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, 1, 0, 0]), 3,
    ));
    expect(hashBufferGeometry(g1)).toBe(hashBufferGeometry(g2));
  });
});

// ── Attribute presence ──────────────────────────────────────

describe('hashBufferGeometry — attribute presence', () => {
  it('geometry with vs without normals → different hash', () => {
    const g1 = makeBox(); // BoxGeometry includes normals
    const g2 = makeBox();
    g2.deleteAttribute('normal');
    expect(hashBufferGeometry(g1)).not.toBe(hashBufferGeometry(g2));
  });

  it('indexed vs non-indexed → different hash', () => {
    const g1 = makeBox(); // indexed
    const g2 = g1.toNonIndexed();
    expect(hashBufferGeometry(g1)).not.toBe(hashBufferGeometry(g2));
  });
});

// ── Dimensional fingerprint (orthogonal sanity check) ───────

describe('fingerprintBufferGeometry', () => {
  it('box 2×3×4 → span = (2, 3, 4), volume = 24', () => {
    const fp = fingerprintBufferGeometry(makeBox(2, 3, 4));
    expect(fp.spanX).toBe(2);
    expect(fp.spanY).toBe(3);
    expect(fp.spanZ).toBe(4);
    expect(fp.aabbVolume).toBe(24);
  });

  it('vertex count matches the BufferGeometry', () => {
    const g = makeCyl(1, 1, 8);
    const fp = fingerprintBufferGeometry(g);
    expect(fp.vertexCount).toBe(g.getAttribute('position').count);
  });

  it('identical-shape rebuilds produce identical fingerprints', () => {
    const f1 = fingerprintBufferGeometry(makeBox(1, 2, 3));
    const f2 = fingerprintBufferGeometry(makeBox(1, 2, 3));
    expect(f1).toEqual(f2);
  });
});
