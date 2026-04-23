/**
 * PipeHitboxes — dual-zone click detection per pipe.
 *
 * For every visible pipe, renders three invisible hit targets:
 *
 *   • Center body — a box covering the segments' bulk, minus the
 *     edge zones. Click = select pipe (normal behavior).
 *
 *   • Start edge disc — a small sphere at point[0].
 *     Click-and-drag = enter PIVOT mode, anchor = end of pipe.
 *
 *   • End edge disc — a small sphere at point[N-1].
 *     Click-and-drag = enter PIVOT mode, anchor = start of pipe.
 *
 * Active only in SELECT interaction mode. When cursor hovers an edge
 * disc, it visually reveals (becomes a small outlined ring) and the
 * document cursor style changes to "grab" to advertise the pivot.
 *
 * The hitboxes are R3F children inside the main Canvas so they
 * participate in the raycaster naturally, but their materials are
 * fully transparent (opacity 0) except when hovered.
 */

import { useMemo, useRef, useState, useCallback } from 'react';
import { type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { usePipeStore, type CommittedPipe } from '@store/pipeStore';
import { usePlumbingDrawStore } from '@store/plumbingDrawStore';
import { useLayerStore } from '@store/layerStore';
import { useFloorParams } from '@store/floorStore';
import { useFeatureFlagStore } from '@store/featureFlagStore';
import { beginExtend } from './ExtendSession';
import { nearestSegmentOnPolyline } from '@core/pipe/polylineMath';
import type { Vec3 } from '@core/events';

// ── Edge disc radius (world units) ──────────────────────────────

/** Multiplier on pipe radius for the edge-grab zone size. */
const EDGE_HIT_MULT = 2.8;
/** Minimum edge disc radius in feet (so small-diameter pipes are still grabbable). */
const MIN_EDGE_RADIUS_FT = 0.18;

// ── Per-pipe hitbox ─────────────────────────────────────────────

function PipeHitbox({ pipe }: { pipe: CommittedPipe }) {
  const selectPipe = usePipeStore((s) => s.selectPipe);
  const beginPivot = usePipeStore((s) => s.beginPivot);

  const startPos = pipe.points[0]!;
  const endPos = pipe.points[pipe.points.length - 1]!;
  const pipeRadius = pipe.diameter / 24;
  const edgeRadius = Math.max(MIN_EDGE_RADIUS_FT, pipeRadius * EDGE_HIT_MULT);

  const [hoveredZone, setHoveredZone] = useState<'center' | 'start' | 'end' | null>(null);

  // Build center body segments (cylinders between consecutive non-edge points)
  const centerSegments = useMemo(() => {
    const segs: { pos: THREE.Vector3; quat: THREE.Quaternion; len: number }[] = [];
    const pts = pipe.points;
    if (pts.length < 2) return segs;

    for (let i = 1; i < pts.length; i++) {
      const a = new THREE.Vector3(...pts[i - 1]!);
      const b = new THREE.Vector3(...pts[i]!);
      const dir = b.clone().sub(a);
      const len = dir.length();
      if (len < 0.02) continue;

      // Shrink ends away from pipe endpoints by edge radius so we don't
      // overlap the edge hitboxes
      const shrinkStart = i === 1 ? edgeRadius * 1.1 : 0;
      const shrinkEnd = i === pts.length - 1 ? edgeRadius * 1.1 : 0;
      const effectiveLen = len - shrinkStart - shrinkEnd;
      if (effectiveLen < 0.1) continue;

      const unit = dir.clone().normalize();
      const start = a.clone().add(unit.clone().multiplyScalar(shrinkStart));
      const center = start.clone().add(unit.clone().multiplyScalar(effectiveLen / 2));

      // Quaternion from default (Y-up) cylinder axis to our direction
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        unit,
      );

      segs.push({ pos: center, quat, len: effectiveLen });
    }
    return segs;
  }, [pipe.points, edgeRadius]);

  // Phase 7.A: tee-from-middle-drag threshold.
  // A pointer that moves beyond this many client-space pixels between
  // pointerdown and pointerup counts as a DRAG — which creates a tee
  // and starts extending a branch. Under the threshold = CLICK = select.
  const DRAG_THRESHOLD_PX = 8;

  // ── Handlers ────────────────────────────────────────────────

  // Pull the extend-drag flag once per render — the handler below
  // closes over the latest value via store reads.
  const extendDragEnabled = useFeatureFlagStore((s) => s.pipeExtendDrag);

  const onCenterDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    // Phase 7.A path: if the extend-drag flag is on, defer the
    // select/drag decision until we see whether the user moves. If the
    // flag is off, fall through to the legacy instant-select behavior.
    if (!extendDragEnabled) {
      selectPipe(pipe.id);
      return;
    }

    // Capture the pipe-local hit context we'll need if this turns
    // into a drag. The R3F event carries `e.point` in world space;
    // we find the nearest pipe segment + its `t` parameter now so
    // the anchor is computed from the actual click point, not from
    // wherever the cursor was when the drag threshold crossed.
    const hitWorld: Vec3 = [e.point.x, e.point.y, e.point.z];
    const nearest = nearestSegmentOnPolyline(pipe.points, hitWorld);
    if (!nearest) {
      // Degenerate pipe — fall back to select.
      selectPipe(pipe.id);
      return;
    }

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    let dragged = false;

    const onMove = (ev: PointerEvent) => {
      if (dragged) return; // one-shot arm
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) return;
      dragged = true;

      // Snap the anchor to the grid — the user expects tees to land
      // on grid points, matching the rest of the drawing flow.
      const grid = usePlumbingDrawStore.getState().gridSnap || 0.5;
      const snappedAnchor: Vec3 = [
        Math.round(nearest.worldPoint[0] / grid) * grid,
        nearest.worldPoint[1],
        Math.round(nearest.worldPoint[2] / grid) * grid,
      ];

      beginExtend({
        parentPipeId: pipe.id,
        origin: 'tee',
        anchor: snappedAnchor,
        teeSegmentIdx: nearest.segmentIdx,
      });
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      // Click (no drag) → select. Drag → ExtendSession's window listeners
      // already handle commit/cancel; we stay out of its way.
      if (!dragged) {
        selectPipe(pipe.id);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [pipe.id, pipe.points, selectPipe, extendDragEnabled]);

  const onEdgeDown = useCallback((e: ThreeEvent<PointerEvent>, which: 'start' | 'end') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    beginPivot(pipe.id, which);
  }, [pipe.id, beginPivot]);

  const onEdgeHover = useCallback((which: 'start' | 'end' | null) => {
    setHoveredZone(which);
    document.body.style.cursor = which ? 'grab' : '';
  }, []);

  const onCenterHover = useCallback((hover: boolean) => {
    setHoveredZone(hover ? 'center' : null);
    document.body.style.cursor = hover ? 'pointer' : '';
  }, []);

  const cylRadius = Math.max(pipeRadius * 1.4, 0.1);

  return (
    <group>
      {/* Center body segments */}
      {centerSegments.map((seg, i) => (
        <mesh
          key={`c-${i}`}
          position={seg.pos}
          quaternion={seg.quat}
          onPointerDown={onCenterDown}
          onPointerOver={(e) => { e.stopPropagation(); onCenterHover(true); }}
          onPointerOut={() => onCenterHover(false)}
        >
          <cylinderGeometry args={[cylRadius, cylRadius, seg.len, 8]} />
          <meshBasicMaterial transparent opacity={hoveredZone === 'center' ? 0.06 : 0} color="#00e5ff" />
        </mesh>
      ))}

      {/* Start edge hitbox */}
      <mesh
        position={startPos}
        onPointerDown={(e) => onEdgeDown(e, 'start')}
        onPointerOver={(e) => { e.stopPropagation(); onEdgeHover('start'); }}
        onPointerOut={() => onEdgeHover(null)}
      >
        <sphereGeometry args={[edgeRadius, 16, 16]} />
        <meshBasicMaterial
          transparent
          opacity={hoveredZone === 'start' ? 0.25 : 0}
          color="#ffa726"
        />
      </mesh>

      {/* End edge hitbox */}
      <mesh
        position={endPos}
        onPointerDown={(e) => onEdgeDown(e, 'end')}
        onPointerOver={(e) => { e.stopPropagation(); onEdgeHover('end'); }}
        onPointerOut={() => onEdgeHover(null)}
      >
        <sphereGeometry args={[edgeRadius, 16, 16]} />
        <meshBasicMaterial
          transparent
          opacity={hoveredZone === 'end' ? 0.25 : 0}
          color="#ffa726"
        />
      </mesh>

      {/* Visual ring indicators when edge is hovered */}
      {hoveredZone === 'start' && (
        <EdgeHoverRing position={startPos} radius={edgeRadius * 1.1} />
      )}
      {hoveredZone === 'end' && (
        <EdgeHoverRing position={endPos} radius={edgeRadius * 1.1} />
      )}
    </group>
  );
}

// ── Edge hover ring (visual feedback) ───────────────────────────

function EdgeHoverRing({ position, radius }: { position: [number, number, number]; radius: number }) {
  return (
    <group position={position}>
      {/* Outer glow ring */}
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[radius * 0.9, radius, 32]} />
        <meshBasicMaterial
          color="#ffa726"
          transparent
          opacity={0.8}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {/* Outer rotation indicator arrows */}
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[radius * 1.2, radius * 1.35, 32, 1, 0, Math.PI / 3]} />
        <meshBasicMaterial
          color="#ffa726"
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh rotation-x={-Math.PI / 2}>
        <ringGeometry args={[radius * 1.2, radius * 1.35, 32, 1, Math.PI, Math.PI / 3]} />
        <meshBasicMaterial
          color="#ffa726"
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ── Main component ──────────────────────────────────────────────

export function PipeHitboxes() {
  const pipes = usePipeStore((s) => s.pipes);
  const mode = usePlumbingDrawStore((s) => s.mode);
  const pivoting = usePipeStore((s) => s.pivotSession !== null);
  const systemVis = useLayerStore((s) => s.systems);
  const getFloorParams = useFloorParams();

  // Active in select mode, plus stays active during an ongoing pivot so
  // the user can continue tracking (even though the pivot itself uses
  // window-level listeners).
  const active = mode === 'select' || pivoting;
  if (!active) return null;

  const list = Object.values(pipes).filter((p) => {
    if (!p.visible || !systemVis[p.system] || pivoting) return false;
    // Only pipes on interactive floors get hitboxes
    let yMin = p.points[0]?.[1] ?? 0, yMax = yMin;
    for (const pt of p.points) { if (pt[1] < yMin) yMin = pt[1]; if (pt[1] > yMax) yMax = pt[1]; }
    const fp = getFloorParams(yMin, yMax);
    return fp.visible && !fp.disableInteraction;
  });

  return (
    <group>
      {list.map((pipe) => (
        <PipeHitbox key={pipe.id} pipe={pipe} />
      ))}
    </group>
  );
}
