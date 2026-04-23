/**
 * OrthoPipeInteraction — Phase 14.AD.23.
 *
 * CAD-style click-drag-on-pipe interaction, active ONLY in
 * orthographic plan / elevation views (top / front / side / bottom).
 * Designed to mimic traditional 2D CAD drawing where the pipe itself
 * is directly manipulable:
 *
 *   • Click + drag from the MIDDLE of a pipe → spawns a new BRANCH
 *     pipe starting at the click point. On release, the fitting
 *     emitter (FittingGenerator.AD.20) auto-generates the correct
 *     tee / wye / combo at the branch point via the mid-segment
 *     branch detection + AD.22 orientation rules.
 *
 *   • Click + drag from an ENDPOINT of a pipe → EXTENDS that pipe
 *     by appending (or prepending for start-end) a new vertex at
 *     the release position.
 *
 *   • Click WITHOUT drag → SELECTS the pipe. Delete key removes it.
 *
 *   • Click on empty background (when mode active) → DESELECTS.
 *
 * Bug-fix pass (AD.23.b):
 *   • OrbitControls previously fought click-drag — now `navFrozen`
 *     is set for the session's duration so the camera doesn't
 *     pan/rotate under a drag.
 *   • Pointer-move previously relied on R3F's onPointerMove, which
 *     stops firing when the cursor leaves the hit volume. Now the
 *     session installs WINDOW-level listeners and raycasts the
 *     cursor back into world space through the scene's camera +
 *     raycaster, so drags work even when the pointer strays from
 *     the pipe.
 *   • Minimum-drag-after-snap guard prevents useless micro-pipes
 *     that resolved to zero-length after gridSnap rounding.
 *   • Stop-propagation on pointer events prevents the existing
 *     PipeHitboxes / pivot layer from firing double.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { usePipeStore, type CommittedPipe } from '@store/pipeStore';
import { useInteractionStore } from '@store/interactionStore';
import { useIsoCameraStore } from '@ui/cameras/IsoCamera';
import { EV, type Vec3, type PipeCompletePayload } from '@core/events';
import { eventBus } from '@core/EventBus';
import { nearestSegmentOnPolyline } from '@core/pipe/polylineMath';
import { getOuterRadiusFt } from '@core/pipe/PipeSizeSpec';

// ── Constants ────────────────────────────────────────────────────

const ORTHO_VIEWS = new Set(['top', 'front', 'side', 'bottom']);

/** World-space distance (ft) at which a click snaps to the nearest
 *  pipe endpoint instead of treating it as a midpoint. */
const ENDPOINT_SNAP_FT = 1.0;

/** Minimum cursor movement (world ft) to register as drag vs click. */
const DRAG_THRESHOLD_FT = 0.25;

// ── Types ────────────────────────────────────────────────────────

export type AnchorKind = 'start' | 'end' | 'mid';

interface DragSession {
  pipeId: string;
  anchor: Vec3;
  anchorKind: AnchorKind;
  segmentIdx: number;
  pointerStart: Vec3;
  cursor: Vec3;
  dragging: boolean;
  /** Phase 14.AD.27 — Shift held during drag constrains the cursor
   *  to the nearest 45° direction from the anchor in the active 2D
   *  drag plane. Drives the orthogonal-snap visual + commit target. */
  orthoSnap: boolean;
}

// ── Pure helpers (exported for unit testing) ─────────────────────

export function classifyAnchorKind(
  pipe: Pick<CommittedPipe, 'points'>,
  hitOnPolyline: Vec3,
  snapFt: number = ENDPOINT_SNAP_FT,
): { kind: AnchorKind; anchor: Vec3 } {
  const first = pipe.points[0]!;
  const last = pipe.points[pipe.points.length - 1]!;
  const distToFirst = dist(hitOnPolyline, first);
  const distToLast = dist(hitOnPolyline, last);
  if (distToFirst < snapFt && distToFirst <= distToLast) {
    return { kind: 'start', anchor: first };
  }
  if (distToLast < snapFt) {
    return { kind: 'end', anchor: last };
  }
  return { kind: 'mid', anchor: hitOnPolyline };
}

export function snapToGrid(p: Vec3, step: number): Vec3 {
  return [
    Math.round(p[0] / step) * step,
    Math.round(p[1] / step) * step,
    Math.round(p[2] / step) * step,
  ];
}

export function dist(a: Vec3, b: Vec3): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function isOrthoView(cameraMode: string): boolean {
  return ORTHO_VIEWS.has(cameraMode);
}

/**
 * Is a cursor drag large enough to count as "dragged" (not a click)?
 * Conservative: uses DRAG_THRESHOLD_FT as the floor and gridSnap as
 * the ceiling so snap-to-grid can't collapse a real drag into a
 * zero-length commit.
 */
export function isDragLargeEnough(
  start: Vec3,
  current: Vec3,
  gridSnap: number,
): boolean {
  const floor = Math.max(DRAG_THRESHOLD_FT, gridSnap * 0.6);
  return dist(start, current) >= floor;
}

/**
 * Phase 14.AD.27 — snap the cursor to the nearest 45° direction from
 * the anchor, in the local plane defined by the camera's forward
 * axis (passed as `viewNormal`).
 *
 * Projects `cursor - anchor` into the plane perpendicular to
 * `viewNormal`, picks two orthonormal basis vectors inside that
 * plane, computes the polar angle, snaps to the nearest 45°, and
 * reconstructs the snapped cursor position. Length is preserved.
 *
 * The snapped direction is chosen among: 0°, 45°, 90°, 135°, 180°,
 * 225°, 270°, 315° (eight octants) — enough for normal CAD workflow
 * while still allowing the classic axis-aligned + diagonal routes.
 */
export function snapDirectionTo45(
  anchor: Vec3,
  cursor: Vec3,
  viewNormal: Vec3,
): Vec3 {
  const dx = cursor[0] - anchor[0];
  const dy = cursor[1] - anchor[1];
  const dz = cursor[2] - anchor[2];
  const delta = { x: dx, y: dy, z: dz };
  const dLen = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dLen < 1e-4) return cursor;

  // Pick two orthonormal axes in the plane perpendicular to viewNormal.
  // Prefer world +X as one axis when possible (readability when the
  // view is a plan/elevation); otherwise fall through to +Y.
  const n = normalize3(viewNormal);
  const trial: [number, number, number] = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const axis1 = normalize3(cross3(n, trial));
  const axis2 = cross3(n, axis1); // already unit length since n,axis1 unit

  // Project delta onto axis1/axis2.
  const u = delta.x * axis1[0] + delta.y * axis1[1] + delta.z * axis1[2];
  const v = delta.x * axis2[0] + delta.y * axis2[1] + delta.z * axis2[2];
  const mag = Math.sqrt(u * u + v * v);
  if (mag < 1e-4) return cursor;

  // Snap the polar angle to nearest 45° (π/4).
  const theta = Math.atan2(v, u);
  const step = Math.PI / 4;
  const snapped = Math.round(theta / step) * step;
  const uSnap = mag * Math.cos(snapped);
  const vSnap = mag * Math.sin(snapped);

  // Reconstruct world-space delta.
  return [
    anchor[0] + uSnap * axis1[0] + vSnap * axis2[0],
    anchor[1] + uSnap * axis1[1] + vSnap * axis2[1],
    anchor[2] + uSnap * axis1[2] + vSnap * axis2[2],
  ];
}

function normalize3(v: readonly [number, number, number] | Vec3): [number, number, number] {
  const len = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (len < 1e-8) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross3(
  a: readonly [number, number, number] | Vec3,
  b: readonly [number, number, number] | Vec3,
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

// ── Main component ───────────────────────────────────────────────

export function OrthoPipeInteraction() {
  const cameraMode = useIsoCameraStore((s) => s.mode);
  const orthoClickDrag = useInteractionStore((s) => s.orthoClickDragMode);
  const interactionMode = useInteractionStore((s) => s.mode);
  const gridSnap = useInteractionStore((s) => s.gridSnap);
  const setNavFrozen = useInteractionStore((s) => s.setNavFrozen);
  const pipes = usePipeStore((s) => s.pipes);
  const pipeOrder = usePipeStore((s) => s.pipeOrder);
  const selectPipeAction = usePipeStore((s) => s.selectPipe);
  const setPoints = usePipeStore((s) => s.setPoints);
  const insertAnchor = usePipeStore((s) => s.insertAnchor);
  const selectedId = usePipeStore((s) => s.selectedId);
  const { camera, gl, raycaster } = useThree();

  const sessionRef = useRef<DragSession | null>(null);
  // Minimal re-render trigger — bumping this state variable is the
  // only reason this component re-renders when the drag session
  // mutates (cursor, dragging flag). The session itself lives in a
  // ref to avoid re-rendering the invisible click capsules on every
  // mousemove event.
  const [, setTick] = useState(0);
  const forceUpdate = useCallback(() => setTick((n) => (n + 1) & 0xffff), []);
  // Phase 14.AD.26 — hovered pipe ID for the highlight glow.
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const active =
    orthoClickDrag &&
    isOrthoView(cameraMode) &&
    interactionMode !== 'draw';

  // ── Project a screen-space cursor to world-space, on the plane
  //    that passes through the anchor perpendicular to the camera's
  //    forward axis. Works for any orthographic view.
  const projectCursorToWorld = useCallback(
    (clientX: number, clientY: number, anchor: Vec3): Vec3 | null => {
      const rect = gl.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      raycaster.setFromCamera(ndc, camera);
      const normal = new THREE.Vector3(0, 0, -1)
        .applyQuaternion(camera.quaternion)
        .normalize();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        normal,
        new THREE.Vector3(anchor[0], anchor[1], anchor[2]),
      );
      const out = new THREE.Vector3();
      if (!raycaster.ray.intersectPlane(plane, out)) return null;
      return [out.x, out.y, out.z];
    },
    [camera, gl, raycaster],
  );

  // ── Commit + cleanup ───────────────────────────────────────────
  const commitSession = useCallback(
    (s: DragSession) => {
      if (!s.dragging) {
        selectPipeAction(s.pipeId);
        return;
      }
      const snapped = snapToGrid(s.cursor, gridSnap);
      if (!isDragLargeEnough(s.anchor, snapped, gridSnap)) {
        // Micro-drag that rounded to zero after snap — treat as click.
        selectPipeAction(s.pipeId);
        return;
      }
      const pipe = usePipeStore.getState().pipes[s.pipeId];
      if (!pipe) return;

      if (s.anchorKind === 'end') {
        setPoints(s.pipeId, [...pipe.points, snapped]);
      } else if (s.anchorKind === 'start') {
        setPoints(s.pipeId, [snapped, ...pipe.points]);
      } else {
        // Phase 14.AD.28 — mid-pipe branch now SPLITS the main pipe
        // at the branch point (inserts a vertex there) and emits
        // the new branch pipe. The junction emitter's normal
        // endpoint↔vertex detection then fires with a proper
        // 3-pipe cluster (main-half-A + main-half-B + branch) and
        // the tee/wye/combo sits cleanly BETWEEN the two main
        // halves instead of overlapping a single continuous
        // through-pipe. Each pipe-half retracts at the shared
        // vertex; the branch pipe retracts at its endpoint.
        //
        // Before AD.28: new branch pipe emitted only; AD.20
        // mid-segment detection emitted a fitting AT the main's
        // centerline but the main pipe rendered continuous through
        // the fitting body → visible overlap. Now the split makes
        // the geometry match real plumbing: three pipe pieces
        // meeting at the tee's hubs.
        insertAnchor(s.pipeId, s.segmentIdx, s.anchor);
        const id = `pipe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const payload: PipeCompletePayload = {
          id,
          points: [s.anchor, snapped],
          diameter: pipe.diameter,
          material: pipe.material,
        };
        eventBus.emit(EV.PIPE_COMPLETE, payload);
      }
    },
    [gridSnap, selectPipeAction, setPoints, insertAnchor],
  );

  const endSession = useCallback(
    (committed: boolean) => {
      const s = sessionRef.current;
      if (s && committed) commitSession(s);
      sessionRef.current = null;
      setNavFrozen(false);
      forceUpdate();
    },
    [commitSession, setNavFrozen, forceUpdate],
  );

  // ── Window-level move / up while a session is live ─────────────
  useEffect(() => {
    if (!active) {
      // Mode flipped off (view change / toggle) mid-session: clean
      // up any dangling session silently. Otherwise a "stuck"
      // rotation ring could linger.
      if (sessionRef.current) {
        sessionRef.current = null;
        setNavFrozen(false);
        forceUpdate();
      }
      return;
    }
    function onMove(e: PointerEvent) {
      const s = sessionRef.current;
      if (!s) return;
      const world = projectCursorToWorld(e.clientX, e.clientY, s.anchor);
      if (!world) return;
      // Phase 14.AD.27 — Shift key = orthogonal snap. Live-applied
      // during move so the preview tube and readout both reflect
      // the snapped direction.
      s.orthoSnap = e.shiftKey;
      const viewNormal: Vec3 = cameraForward();
      s.cursor = s.orthoSnap
        ? snapDirectionTo45(s.anchor, world, viewNormal)
        : world;
      if (!s.dragging && isDragLargeEnough(s.pointerStart, world, gridSnap)) {
        s.dragging = true;
      }
      forceUpdate();
    }
    function cameraForward(): Vec3 {
      const n = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion).normalize();
      return [n.x, n.y, n.z];
    }
    function onUp(e: PointerEvent) {
      void e;
      if (!sessionRef.current) return;
      endSession(true);
    }
    function onCancel() {
      if (!sessionRef.current) return;
      endSession(false);
    }
    function onKey(e: KeyboardEvent) {
      const s = sessionRef.current;
      if (!s) {
        if (e.key === 'Escape' && sessionRef.current) endSession(false);
        return;
      }
      if (e.key === 'Escape') {
        endSession(false);
        return;
      }
      // Phase 14.AD.27 — toggle orthoSnap the moment Shift is
      // pressed/released, re-applying the snap against the last
      // known raw cursor if already dragging. The raw cursor isn't
      // tracked separately, so we just note the snap state and let
      // the next pointermove pick it up; this covers the common
      // case of pressing Shift after initial drag.
      if (e.key === 'Shift') {
        s.orthoSnap = true;
        forceUpdate();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      const s = sessionRef.current;
      if (!s) return;
      if (e.key === 'Shift') {
        s.orthoSnap = false;
        forceUpdate();
      }
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('blur', onCancel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [active, projectCursorToWorld, endSession, gridSnap, forceUpdate, setNavFrozen, camera]);

  // ── Per-pipe pointer-down ──────────────────────────────────────
  const onPipePointerDown = useCallback(
    (pipe: CommittedPipe, event: ThreeEvent<PointerEvent>) => {
      if (!active) return;
      // Prevent the pivot-on-endpoint + other pipe hit handlers from
      // firing on the same click.
      event.stopPropagation();
      (event.nativeEvent as Event).stopImmediatePropagation?.();
      const hit: Vec3 = [event.point.x, event.point.y, event.point.z];
      const near = nearestSegmentOnPolyline(pipe.points, hit);
      if (!near) return;
      const { kind, anchor } = classifyAnchorKind(pipe, near.worldPoint);
      sessionRef.current = {
        pipeId: pipe.id,
        anchor,
        anchorKind: kind,
        segmentIdx: near.segmentIdx,
        pointerStart: hit,
        cursor: hit,
        dragging: false,
        orthoSnap: event.nativeEvent.shiftKey,
      };
      setNavFrozen(true);
      forceUpdate();
    },
    [active, setNavFrozen, forceUpdate],
  );

  // ── Empty-background click to deselect ─────────────────────────
  //
  // Rather than mount an invisible background plane (which is edge-
  // on to the camera in top view and doesn't reliably catch clicks),
  // listen on the canvas element itself. By the time this bubbled
  // native listener runs, React has already dispatched our capsule's
  // onPipePointerDown — so if sessionRef is still null, the click
  // was on empty space.
  useEffect(() => {
    if (!active) return;
    function onDown(e: PointerEvent) {
      // Left button only — right/middle click is orbit / pan.
      if (e.button !== 0) return;
      if (sessionRef.current) return;
      if (selectedId) selectPipeAction(null);
    }
    const target = gl.domElement;
    target.addEventListener('pointerdown', onDown);
    return () => target.removeEventListener('pointerdown', onDown);
  }, [active, gl, selectedId, selectPipeAction]);

  if (!active) return null;

  const s = sessionRef.current;
  const hoveredPipe = hoveredId ? pipes[hoveredId] ?? null : null;
  return (
    <group>
      {pipeOrder.map((id) => {
        const p = pipes[id];
        if (!p || !p.visible || p.points.length < 2) return null;
        return (
          <PipeClickCapsules
            key={p.id}
            pipe={p}
            onPointerDown={(e) => onPipePointerDown(p, e)}
            onPointerOver={() => {
              if (!sessionRef.current) setHoveredId(p.id);
            }}
            onPointerOut={() => {
              setHoveredId((curr) => (curr === p.id ? null : curr));
            }}
          />
        );
      })}
      {/* Phase 14.AD.25 — endpoint hints visible whenever the mode is
          active AND nothing is being dragged. Small glowing dots at
          every pipe endpoint cue the user that those points are
          grab-handles for extension. */}
      {!s && <EndpointHints pipes={pipes} pipeOrder={pipeOrder} />}
      {/* Phase 14.AD.26 — hover highlight on the pipe under the
          cursor. Sits behind the drag preview (renderOrder lower)
          so a committed drag takes over visual dominance. */}
      {!s && hoveredPipe ? <HoverHighlight pipe={hoveredPipe} /> : null}
      {s?.dragging ? <DragPreview session={s} pipes={pipes} /> : null}
      {s ? <RotationAnchorRing session={s} /> : null}
      {s?.dragging ? <DragReadout session={s} pipes={pipes} gridSnap={gridSnap} /> : null}
      {s?.dragging ? <SnapTargetDot session={s} gridSnap={gridSnap} /> : null}
      {/* Phase 14.AD.26 — 5×5 snap-grid dots around the cursor so
          the user sees where adjacent grid points would land if
          they release slightly off. */}
      {s?.dragging ? <SnapGridPreview session={s} gridSnap={gridSnap} /> : null}
      {/* Phase 14.AD.26 — "Esc to cancel" hint below the anchor
          ring. Unobtrusive but learnable. */}
      {s ? <SessionKeyHint session={s} /> : null}
    </group>
  );
}

// ── Invisible per-segment capsule for click detection ────────────

function PipeClickCapsules({
  pipe,
  onPointerDown,
  onPointerOver,
  onPointerOut,
}: {
  pipe: CommittedPipe;
  onPointerDown: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOver?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (event: ThreeEvent<PointerEvent>) => void;
}) {
  const pipeRadiusFt = Math.max(
    0.08,
    getOuterRadiusFt(pipe.material as 'pvc_sch40', pipe.diameter),
  );
  const hitRadius = pipeRadiusFt * 2.2;
  return (
    <group>
      {pipe.points.slice(0, -1).map((p0, i) => {
        const p1 = pipe.points[i + 1]!;
        const mid = new THREE.Vector3(
          (p0[0] + p1[0]) / 2,
          (p0[1] + p1[1]) / 2,
          (p0[2] + p1[2]) / 2,
        );
        const dir = new THREE.Vector3(
          p1[0] - p0[0],
          p1[1] - p0[1],
          p1[2] - p0[2],
        );
        const len = dir.length();
        if (len < 1e-3) return null;
        dir.normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir,
        );
        return (
          <mesh
            key={i}
            position={mid}
            quaternion={quat}
            onPointerDown={onPointerDown}
            onPointerOver={onPointerOver}
            onPointerOut={onPointerOut}
          >
            <cylinderGeometry args={[hitRadius, hitRadius, len, 8]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          </mesh>
        );
      })}
    </group>
  );
}

// ── Visual feedback components (Phase 14.AD.25) ─────────────────

/** Action-specific color palette for the drag visuals. */
function colorFor(kind: AnchorKind): { main: string; glow: string } {
  switch (kind) {
    case 'start':
    case 'end':
      // Extension — green = "add to existing pipe".
      return { main: '#00e676', glow: '#69f0ae' };
    case 'mid':
      // Branch — orange = "fork off a new pipe with an auto-fitting".
      return { main: '#ff9100', glow: '#ffb74d' };
  }
}

/**
 * Pulsing ring at the drag anchor. Color cues the user which action
 * they're about to perform: green for extend, orange for branch. Two
 * concentric rings give a subtle depth cue (inner ring opaque, outer
 * ring faint + pulsing to draw the eye).
 */
function RotationAnchorRing({ session }: { session: DragSession }) {
  const outerRef = useRef<THREE.Mesh>(null);
  const { main, glow } = colorFor(session.anchorKind);
  useFrame(({ clock }) => {
    if (!outerRef.current) return;
    const t = clock.getElapsedTime();
    const pulse = 1 + 0.12 * Math.sin(t * 4);
    outerRef.current.scale.setScalar(pulse);
    const mat = outerRef.current.material as THREE.MeshBasicMaterial;
    mat.opacity = 0.25 + 0.15 * (1 + Math.sin(t * 4)) / 2;
  });
  return (
    <group position={session.anchor}>
      {/* Outer pulsing halo */}
      <mesh ref={outerRef}>
        <torusGeometry args={[0.38, 0.05, 8, 28]} />
        <meshBasicMaterial
          color={glow}
          transparent
          opacity={0.3}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      {/* Core ring — solid + stable */}
      <mesh>
        <torusGeometry args={[0.28, 0.035, 8, 24]} />
        <meshBasicMaterial
          color={main}
          transparent
          opacity={0.85}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      {/* Tiny center dot for precise anchor position feedback */}
      <mesh>
        <sphereGeometry args={[0.06, 12, 12]} />
        <meshBasicMaterial
          color="#ffffff"
          transparent
          opacity={0.95}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
    </group>
  );
}

function DragPreview({
  session,
  pipes,
}: {
  session: DragSession;
  pipes: Record<string, CommittedPipe>;
}) {
  const pipe = pipes[session.pipeId];
  if (!pipe) return null;
  const a = session.anchor;
  const b = session.cursor;
  const mid = new THREE.Vector3(
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
    (a[2] + b[2]) / 2,
  );
  const dir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = dir.length();
  if (len < 1e-3) return null;
  dir.normalize();
  const quat = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir,
  );
  const radius = Math.max(
    0.06,
    getOuterRadiusFt(pipe.material as 'pvc_sch40', pipe.diameter),
  );
  const { main } = colorFor(session.anchorKind);
  return (
    <group>
      {/* Solid preview tube — slightly transparent so the real
          geometry underneath stays readable. */}
      <mesh position={mid} quaternion={quat}>
        <cylinderGeometry args={[radius, radius, len, 16]} />
        <meshBasicMaterial
          color={main}
          transparent
          opacity={0.5}
          depthWrite={false}
        />
      </mesh>
      {/* Glow outline — slightly larger radius, highly transparent,
          gives the preview a visible halo without overwhelming. */}
      <mesh position={mid} quaternion={quat}>
        <cylinderGeometry args={[radius * 1.3, radius * 1.3, len, 16]} />
        <meshBasicMaterial
          color={main}
          transparent
          opacity={0.15}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/**
 * Floating length + diameter readout near the cursor during drag.
 * Uses drei's Billboard so the text always faces the camera
 * regardless of which ortho view is active.
 */
function DragReadout({
  session,
  pipes,
  gridSnap,
}: {
  session: DragSession;
  pipes: Record<string, CommittedPipe>;
  gridSnap: number;
}) {
  const pipe = pipes[session.pipeId];
  if (!pipe) return null;
  const a = session.anchor;
  const snapped = snapToGrid(session.cursor, gridSnap);
  const length = dist(a, snapped);
  if (length < 1e-3) return null;
  const action = session.anchorKind === 'mid' ? 'Branch' : 'Extend';
  // Phase 14.AD.26 — angle between the new segment and the anchor
  // pipe's direction. For an extension, this is the bend angle at
  // the new corner; for a branch, this is the branch angle off the
  // main (which drives the san-tee / wye / combo fitting selection).
  const angle = dragAngleDeg(session, pipe);
  const angleLabel = angle != null && angle > 0.5 && angle < 179.5
    ? `  ·  ${angle.toFixed(0)}°`
    : '';
  // Phase 14.AD.27 — tag the readout when Shift-snap is active so
  // the user knows the preview isn't raw cursor-tracked.
  const snapTag = session.orthoSnap ? '  ⇧ ORTHO' : '';
  const label = `${action}  ${formatFeetInches(length)}${angleLabel}${snapTag}  •  ${pipe.diameter}" ${friendlyMaterial(pipe.material)}`;
  // Position label slightly above the cursor's world position so it
  // doesn't z-fight with the preview cylinder.
  const pos: Vec3 = [snapped[0], snapped[1] + 0.35, snapped[2]];
  const color = colorFor(session.anchorKind).main;
  return (
    <Billboard position={pos}>
      {/* Background pill */}
      <mesh renderOrder={100}>
        <planeGeometry args={[Math.max(2.2, label.length * 0.12), 0.42]} />
        <meshBasicMaterial
          color="#0a0a0f"
          transparent
          opacity={0.85}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      <Text
        position={[0, 0, 0.01]}
        fontSize={0.22}
        color={color}
        outlineWidth={0.015}
        outlineColor="#000000"
        anchorX="center"
        anchorY="middle"
        renderOrder={101}
      >
        {label}
      </Text>
    </Billboard>
  );
}

/**
 * Small dot at the grid-snapped cursor position — tells the user
 * exactly where the pipe will land when they release. The live
 * cursor is raw (pixel-precise); the snap point is 0.5-ft (or
 * whatever `gridSnap` is set to).
 */
function SnapTargetDot({
  session,
  gridSnap,
}: {
  session: DragSession;
  gridSnap: number;
}) {
  const snapped = snapToGrid(session.cursor, gridSnap);
  const { main } = colorFor(session.anchorKind);
  return (
    <mesh position={snapped}>
      <sphereGeometry args={[0.09, 12, 12]} />
      <meshBasicMaterial
        color={main}
        transparent
        opacity={0.9}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

/**
 * Tiny glowing orbs at every pipe endpoint when the ortho-drag
 * mode is active and no session is running. Cues the user that
 * those specific points are grab-handles for extension (as
 * opposed to mid-pipe, which spawns a branch).
 */
function EndpointHints({
  pipes,
  pipeOrder,
}: {
  pipes: Record<string, CommittedPipe>;
  pipeOrder: string[];
}) {
  const endpoints: Vec3[] = [];
  for (const id of pipeOrder) {
    const p = pipes[id];
    if (!p || !p.visible || p.points.length < 2) continue;
    endpoints.push(p.points[0]!);
    endpoints.push(p.points[p.points.length - 1]!);
  }
  if (endpoints.length === 0) return null;
  return (
    <group>
      {endpoints.map((pt, i) => (
        <mesh key={i} position={pt} renderOrder={50}>
          <sphereGeometry args={[0.12, 10, 10]} />
          <meshBasicMaterial
            color="#00e676"
            transparent
            opacity={0.35}
            depthWrite={false}
            depthTest={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// ── Small formatters for the readout label ──────────────────────

function formatFeetInches(ft: number): string {
  const totalInches = ft * 12;
  const feet = Math.floor(totalInches / 12);
  const inches = totalInches - feet * 12;
  // Snap inches to nearest 1/4" for a readable label.
  const roundedIn = Math.round(inches * 4) / 4;
  if (feet === 0) return `${roundedIn.toFixed(2).replace(/\.?0+$/, '')}"`;
  if (roundedIn === 0) return `${feet}'`;
  return `${feet}' ${roundedIn.toFixed(2).replace(/\.?0+$/, '')}"`;
}

function friendlyMaterial(m: string): string {
  switch (m) {
    case 'pvc_sch40': return 'PVC Sch40';
    case 'pvc_sch80': return 'PVC Sch80';
    case 'abs':       return 'ABS';
    case 'cpvc':      return 'CPVC';
    case 'pex':       return 'PEX';
    case 'copper_type_l': return 'Copper L';
    case 'copper_type_m': return 'Copper M';
    case 'cast_iron':    return 'Cast Iron';
    case 'ductile_iron': return 'Ductile';
    case 'galvanized_steel': return 'Galv';
    default: return m;
  }
}

// ── Phase 14.AD.26 — hover highlight + snap-grid + key hint ─────

/**
 * Subtle cyan glow tube over the hovered pipe's centerline — reads as
 * "this pipe is grabbable". Rendered with `depthTest: false` so it
 * shows through pipes that might be between the camera and the
 * hovered pipe in orthographic views.
 */
function HoverHighlight({ pipe }: { pipe: CommittedPipe }) {
  const pipeRadiusFt = Math.max(
    0.06,
    getOuterRadiusFt(pipe.material as 'pvc_sch40', pipe.diameter),
  );
  const glowR = pipeRadiusFt * 1.35;
  return (
    <group>
      {pipe.points.slice(0, -1).map((p0, i) => {
        const p1 = pipe.points[i + 1]!;
        const mid = new THREE.Vector3(
          (p0[0] + p1[0]) / 2,
          (p0[1] + p1[1]) / 2,
          (p0[2] + p1[2]) / 2,
        );
        const dir = new THREE.Vector3(
          p1[0] - p0[0],
          p1[1] - p0[1],
          p1[2] - p0[2],
        );
        const len = dir.length();
        if (len < 1e-3) return null;
        dir.normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir,
        );
        return (
          <mesh key={i} position={mid} quaternion={quat} renderOrder={10}>
            <cylinderGeometry args={[glowR, glowR, len, 10]} />
            <meshBasicMaterial
              color="#00e5ff"
              transparent
              opacity={0.18}
              depthWrite={false}
            />
          </mesh>
        );
      })}
    </group>
  );
}

/**
 * 5×5 faint dots at the grid-cell intersections around the current
 * snap target. Helps the user predict where the release point will
 * land given the grid. Dots outside the snap target are dimmer so
 * the target dot itself (from SnapTargetDot) still reads brightest.
 */
function SnapGridPreview({
  session,
  gridSnap,
}: {
  session: DragSession;
  gridSnap: number;
}) {
  const center = snapToGrid(session.cursor, gridSnap);
  // The grid axes to display depend on which 2D plane the camera
  // is looking at. Use the two axes most perpendicular to the
  // anchor→cursor direction. For simplicity, always show XZ when
  // the drag is roughly horizontal (Y delta small) and XY otherwise.
  const dy = Math.abs(session.cursor[1] - session.anchor[1]);
  const horizontalDrag = dy < 0.2;
  const dots: Vec3[] = [];
  for (let i = -2; i <= 2; i++) {
    for (let j = -2; j <= 2; j++) {
      if (i === 0 && j === 0) continue; // target dot already rendered
      const dx = i * gridSnap;
      const dOther = j * gridSnap;
      if (horizontalDrag) {
        dots.push([center[0] + dx, center[1], center[2] + dOther]);
      } else {
        dots.push([center[0] + dx, center[1] + dOther, center[2]]);
      }
    }
  }
  return (
    <group>
      {dots.map((pt, i) => (
        <mesh key={i} position={pt} renderOrder={40}>
          <sphereGeometry args={[0.035, 6, 6]} />
          <meshBasicMaterial
            color="#ffffff"
            transparent
            opacity={0.25}
            depthWrite={false}
            depthTest={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Tiny floating hint near the anchor: "Esc cancel • Release to commit".
 * Discoverable shortcut without a modal or HUD overlay.
 */
function SessionKeyHint({ session }: { session: DragSession }) {
  const pos: Vec3 = [session.anchor[0], session.anchor[1] - 0.55, session.anchor[2]];
  return (
    <Billboard position={pos}>
      <mesh renderOrder={100}>
        <planeGeometry args={[2.6, 0.3]} />
        <meshBasicMaterial
          color="#0a0a0f"
          transparent
          opacity={0.7}
          depthWrite={false}
          depthTest={false}
        />
      </mesh>
      <Text
        position={[0, 0, 0.01]}
        fontSize={0.17}
        color="#aab"
        outlineWidth={0.01}
        outlineColor="#000000"
        anchorX="center"
        anchorY="middle"
        renderOrder={101}
      >
        Esc cancel · Release to commit
      </Text>
    </Billboard>
  );
}

// ── Angle helper for DragReadout ────────────────────────────────

/**
 * Compute the angle (degrees 0..180) between the new segment
 * (anchor → cursor) and the anchor pipe's direction at the anchor.
 *
 * For a mid-pipe branch, the "main direction" is the segment
 * tangent at the projection. For an endpoint extension, it's the
 * direction of the pipe's last segment (FROM the endpoint INTO the
 * pipe body). Returns null if either vector is degenerate.
 */
export function dragAngleDeg(
  session: DragSession,
  pipe: Pick<CommittedPipe, 'points'>,
): number | null {
  const a = session.anchor;
  const b = session.cursor;
  const dragDir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (dragDir.lengthSq() < 1e-6) return null;
  dragDir.normalize();

  let refDir: THREE.Vector3 | null = null;
  if (session.anchorKind === 'end' && pipe.points.length >= 2) {
    const last = pipe.points[pipe.points.length - 1]!;
    const prev = pipe.points[pipe.points.length - 2]!;
    refDir = new THREE.Vector3(
      last[0] - prev[0], last[1] - prev[1], last[2] - prev[2],
    );
  } else if (session.anchorKind === 'start' && pipe.points.length >= 2) {
    const first = pipe.points[0]!;
    const next = pipe.points[1]!;
    refDir = new THREE.Vector3(
      first[0] - next[0], first[1] - next[1], first[2] - next[2],
    );
  } else {
    // mid-pipe branch: use the segment at session.segmentIdx tangent.
    const idx = session.segmentIdx;
    if (idx >= 0 && idx < pipe.points.length - 1) {
      const p0 = pipe.points[idx]!;
      const p1 = pipe.points[idx + 1]!;
      refDir = new THREE.Vector3(
        p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2],
      );
    }
  }
  if (!refDir || refDir.lengthSq() < 1e-6) return null;
  refDir.normalize();
  const dot = Math.max(-1, Math.min(1, dragDir.dot(refDir)));
  return (Math.acos(dot) * 180) / Math.PI;
}
