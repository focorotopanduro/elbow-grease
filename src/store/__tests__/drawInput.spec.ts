/**
 * drawInput — Phase 14.S tests for the draw-point store actions.
 *
 * Covers the three operations that drive the draw loop:
 *   • addDrawPoint — the constrained commit path (already covered
 *     by angleSnap.spec.ts at the pure-math layer; here we verify
 *     the store wiring in isolation)
 *   • addDrawPointRaw — bypass path for Alt-held clicks
 *   • popDrawPoint — Backspace-style single-point undo
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { usePlumbingDrawStore } from '../plumbingDrawStore';

// Small helper: reset the store to a clean draw session.
function resetStore() {
  usePlumbingDrawStore.setState({
    mode: 'draw',
    drawPoints: [],
    isDrawing: false,
    cursorPos: null,
    gridSnap: 0.5,
    drawPlane: 'horizontal',
    drawDiameter: 2,
    drawMaterial: 'pvc_sch40',
    verticalAnchorY: 0,
    navFrozen: false,
  });
}

describe('plumbingDrawStore — draw input', () => {
  beforeEach(resetStore);

  // ── addDrawPoint (constrained) ──────────────────────────────

  describe('addDrawPoint', () => {
    it('first call records the grid-snapped point + sets isDrawing', () => {
      usePlumbingDrawStore.getState().addDrawPoint([3.27, 0, 5.13]);
      const s = usePlumbingDrawStore.getState();
      expect(s.drawPoints).toEqual([[3.5, 0, 5.0]]);
      expect(s.isDrawing).toBe(true);
    });

    it('third point bends to a legal relative angle', () => {
      const s = usePlumbingDrawStore.getState();
      s.addDrawPoint([0, 0, 0]);
      s.addDrawPoint([10, 0, 0]); // due +X
      // Ask for a 19° bend — should snap to 22.5° relative.
      s.addDrawPoint([20, 0, 3]);
      const pts = usePlumbingDrawStore.getState().drawPoints;
      const last = pts[2]!;
      const dx = last[0] - 10;
      const dz = last[2];
      const relDeg = (Math.atan2(dz, dx) * 180) / Math.PI;
      // Must match one of the legal detents within rounding noise
      const legal = [0, 22.5, 45, 90];
      const best = legal.reduce(
        (b, l) => Math.abs(relDeg - l) < Math.abs(relDeg - b) ? l : b,
        999,
      );
      expect(Math.abs(relDeg - best)).toBeLessThan(0.1);
    });

    it('enforces minimum segment length via the constraint pipeline', () => {
      const s = usePlumbingDrawStore.getState();
      s.addDrawPoint([0, 0, 0]);
      // A 0.05 ft click gets bumped to 1 grid step by
      // snapLengthOnDirection. Near-duplicate elimination can't
      // happen on the constrained path — that's the 14.R contract.
      s.addDrawPoint([0.05, 0, 0.05]);
      const pts = usePlumbingDrawStore.getState().drawPoints;
      expect(pts).toHaveLength(2);
      const last = pts[1]!;
      const d = Math.hypot(last[0], last[1], last[2]);
      // Minimum = gridStep (0.5)
      expect(d).toBeGreaterThanOrEqual(0.5 - 1e-6);
    });
  });

  // ── addDrawPointRaw (bypass) ────────────────────────────────

  describe('addDrawPointRaw', () => {
    it('grid-snaps but does NOT angle-constrain', () => {
      const s = usePlumbingDrawStore.getState();
      s.addDrawPoint([0, 0, 0]);
      s.addDrawPoint([10, 0, 0]);
      // A true ~17° bend — constrained path would snap to 22.5°
      s.addDrawPointRaw([20, 0, 3]);
      const pts = usePlumbingDrawStore.getState().drawPoints;
      const last = pts[2]!;
      // Raw path: grid-snap only. Expect (20, 0, 3) exactly.
      expect(last).toEqual([20, 0, 3]);
    });

    it('respects the near-duplicate floor', () => {
      const s = usePlumbingDrawStore.getState();
      s.addDrawPoint([0, 0, 0]);
      s.addDrawPointRaw([0.02, 0, 0]);
      expect(usePlumbingDrawStore.getState().drawPoints).toHaveLength(1);
    });
  });

  // ── popDrawPoint (Backspace) ────────────────────────────────

  describe('popDrawPoint', () => {
    it('removes the most recent point', () => {
      const s = usePlumbingDrawStore.getState();
      s.addDrawPoint([0, 0, 0]);
      s.addDrawPoint([5, 0, 0]);
      s.addDrawPoint([5, 0, 5]);
      s.popDrawPoint();
      const pts = usePlumbingDrawStore.getState().drawPoints;
      expect(pts).toHaveLength(2);
      expect(pts[1]).toEqual([5, 0, 0]);
    });

    it('keeps isDrawing true when points remain', () => {
      const s = usePlumbingDrawStore.getState();
      s.addDrawPoint([0, 0, 0]);
      s.addDrawPoint([5, 0, 0]);
      s.popDrawPoint();
      expect(usePlumbingDrawStore.getState().isDrawing).toBe(true);
    });

    it('drops isDrawing to false when popping the last point', () => {
      const s = usePlumbingDrawStore.getState();
      s.addDrawPoint([0, 0, 0]);
      s.popDrawPoint();
      expect(usePlumbingDrawStore.getState().drawPoints).toEqual([]);
      expect(usePlumbingDrawStore.getState().isDrawing).toBe(false);
    });

    it('no-op on empty polyline', () => {
      usePlumbingDrawStore.getState().popDrawPoint();
      expect(usePlumbingDrawStore.getState().drawPoints).toEqual([]);
    });

    it('mode stays draw after pop-to-empty', () => {
      const s = usePlumbingDrawStore.getState();
      s.addDrawPoint([0, 0, 0]);
      s.popDrawPoint();
      // Backspace-clear should NOT exit draw mode; user keeps
      // clicking after the undo.
      expect(usePlumbingDrawStore.getState().mode).toBe('draw');
    });
  });

  // ── Undo-redo integration ───────────────────────────────────

  describe('Backspace-like flow', () => {
    it('pop then re-add reconstructs an identical point', () => {
      const s = usePlumbingDrawStore.getState();
      s.addDrawPoint([0, 0, 0]);
      s.addDrawPoint([5, 0, 0]);
      s.popDrawPoint();
      s.addDrawPoint([5, 0, 0]);
      const pts = usePlumbingDrawStore.getState().drawPoints;
      expect(pts).toEqual([[0, 0, 0], [5, 0, 0]]);
    });
  });
});
