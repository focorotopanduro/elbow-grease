/**
 * InstancedWallMeshes — batched wall rendering.
 *
 * Replaces the per-wall mesh+lineSegments pattern with at most 5
 * draw calls regardless of wall count:
 *
 *   1. full bucket InstancedMesh (bright, interactive walls)
 *   2. full bucket edge LineSegments (single merged geometry)
 *   3. dim  bucket InstancedMesh (ghosted / cutaway / walls-down)
 *   4. dim  bucket edge LineSegments
 *   5. selected-wall non-instanced mesh + its yellow edge overlay
 *
 * (Three.js automatically skips rendering empty buckets — the "worst
 * case" above is 5 draw calls only when all three states are non-empty
 * and a selection is present. Typical scenes with 10–20 walls in
 * walls-up mode draw as 2 calls total.)
 *
 * See `@core/walls/wallInstanceBuckets` for the pure bucketing logic
 * (tested independently in isolation from R3F).
 *
 * Per-instance color: each wall's type color is written via
 * `mesh.setColorAt`, creating a per-instance color attribute that
 * multiplies with material.color (kept white). This preserves the
 * "brown exterior / grey interior / cyan plumbing" accent palette.
 *
 * Interaction:
 *   • onClick on the full bucket reads `event.instanceId` → maps back
 *     to the wall id via the parallel `fullInstances` array and calls
 *     `selectWall(id)`.
 *   • dim bucket's walls are non-interactive (see bucketWalls docs).
 *   • selected wall has its own mesh with onClick that deselects.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import {
  useWallStore,
  WALL_TYPE_META,
  type Wall,
  type WallType,
} from '@store/wallStore';
import { useFloorParams } from '@store/floorStore';
import { useRenderModeStore } from '@store/renderModeStore';
import {
  bucketWalls,
  writeWallEdges,
  EDGE_VERTS_PER_WALL,
  type WallInstance,
} from '@core/walls/wallInstanceBuckets';
import { useCutawaySet } from './useCutawaySet';

// ── Shared resources ──────────────────────────────────────────
//
// One unit-box geometry shared by every InstancedMesh bucket. Scaling
// each instance via its matrix (length, height, thickness) stretches
// the unit box to the correct wall size.

const unitBox = new THREE.BoxGeometry(1, 1, 1);

/**
 * The `InstancedMesh` ctor takes an explicit maxCount. Over-provision so
 * we never need to reallocate mid-session. Typical scenes have < 50
 * walls; a three-story commercial job is still well under 500.
 */
const MAX_WALL_INSTANCES = 1024;

// Scratch objects reused across frames — any per-frame allocation
// inside a 100-wall loop adds real GC pressure. Not refs because this
// component's effect only runs when buckets change, not every frame.
const scratchMatrix = new THREE.Matrix4();
const scratchPos = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();
const scratchColor = new THREE.Color();

const WALL_TYPE_COLOR = (t: WallType): string => WALL_TYPE_META[t].color;

// ── Main ──────────────────────────────────────────────────────

export function InstancedWallMeshes() {
  const wallsRecord = useWallStore((s) => s.walls);
  const selectedId = useWallStore((s) => s.selectedWallId);
  const selectWall = useWallStore((s) => s.selectWall);
  const wallOpacity = useWallStore((s) => s.wallOpacity);

  const renderMode = useRenderModeStore((s) => s.mode);
  const cutawaySet = useCutawaySet();
  const getFloorParams = useFloorParams();

  // Stable array from the store record — memoized against the record's
  // reference identity so per-tick store reads don't re-bucket.
  const walls = useMemo(() => Object.values(wallsRecord), [wallsRecord]);

  // Run the pure bucket function on the reactive inputs. This recomputes
  // whenever anything that could change a wall's visual state changes.
  const buckets = useMemo(
    () => bucketWalls({
      walls,
      selectedId,
      cutawaySet,
      renderMode,
      getFloorParams,
      wallTypeColor: WALL_TYPE_COLOR,
    }),
    [walls, selectedId, cutawaySet, renderMode, getFloorParams],
  );

  return (
    <group>
      <BucketInstancedMesh
        instances={buckets.full}
        baseOpacity={wallOpacity}
        onInstanceClick={(idx) => {
          const w = buckets.full[idx]?.wall;
          if (w) selectWall(w.id);
        }}
      />
      <BucketEdges instances={buckets.full} opacity={Math.min(0.9, wallOpacity * 2)} />

      <BucketInstancedMesh
        instances={buckets.dim}
        baseOpacity={wallOpacity * 0.15}
        onInstanceClick={null}
      />
      <BucketEdges instances={buckets.dim} opacity={wallOpacity * 0.4} />

      {buckets.selected && (
        <SelectedWallHighlight
          instance={buckets.selected}
          baseOpacity={wallOpacity}
          onDeselect={() => selectWall(null)}
        />
      )}
    </group>
  );
}

// ── Bucket instanced-mesh ─────────────────────────────────────

/**
 * One InstancedMesh per bucket. Matrices + colors are populated
 * imperatively in a useEffect so we can reuse a single scratch Matrix4.
 * The R3F declarative path would force per-instance allocations.
 */
function BucketInstancedMesh({
  instances,
  baseOpacity,
  onInstanceClick,
}: {
  instances: WallInstance[];
  baseOpacity: number;
  onInstanceClick: ((instanceId: number) => void) | null;
}) {
  const ref = useRef<THREE.InstancedMesh>(null!);

  // Separate material per bucket so each can have its own opacity
  // without cross-contaminating the other bucket.
  const material = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({
      color: 0xffffff,            // white — per-instance color multiplies in
      transparent: true,
      opacity: Math.max(0.04, baseOpacity),
      depthWrite: false,
      metalness: 0.05,
      roughness: 0.8,
    });
    return m;
  }, [baseOpacity]);

  // Dispose material on unmount / material swap — MeshStandardMaterial
  // holds onto GPU program state that otherwise leaks.
  useEffect(() => () => material.dispose(), [material]);

  // Push matrices + per-instance colors into the InstancedMesh.
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;

    for (let i = 0; i < instances.length; i++) {
      const inst = instances[i]!;
      scratchPos.set(inst.position[0], inst.position[1], inst.position[2]);
      scratchQuat.set(
        inst.quaternion[0], inst.quaternion[1],
        inst.quaternion[2], inst.quaternion[3],
      );
      scratchScale.set(inst.scale[0], inst.scale[1], inst.scale[2]);
      scratchMatrix.compose(scratchPos, scratchQuat, scratchScale);
      mesh.setMatrixAt(i, scratchMatrix);
      scratchColor.set(inst.color);
      mesh.setColorAt(i, scratchColor);
    }

    // Cap active count so slots beyond `instances.length` don't render.
    mesh.count = instances.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    // Recompute bounds so frustum culling stays accurate after moves.
    mesh.computeBoundingSphere?.();
  }, [instances]);

  const handleClick = onInstanceClick
    ? (e: ThreeEvent<MouseEvent>) => {
        if (e.instanceId == null) return;
        e.stopPropagation();
        onInstanceClick(e.instanceId);
      }
    : undefined;

  return (
    <instancedMesh
      ref={ref}
      args={[unitBox, material, MAX_WALL_INSTANCES]}
      // Pre-size count to 0; the effect above sets it correctly.
      count={0}
      raycast={onInstanceClick ? undefined : () => null}
      onClick={handleClick}
    />
  );
}

// ── Merged edge geometry per bucket ───────────────────────────

/**
 * Builds one `LineSegments` spanning every wall edge in the bucket.
 * Each wall contributes 24 vertices (12 edges × 2 endpoints) written
 * into a shared Float32Array via `writeWallEdges`.
 *
 * Memoized against the bucket contents: when the bucket list hasn't
 * changed, the same geometry instance is reused across renders.
 */
function BucketEdges({
  instances,
  opacity,
}: {
  instances: WallInstance[];
  opacity: number;
}) {
  const geometry = useMemo(() => {
    if (instances.length === 0) return null;
    const verts = new Float32Array(instances.length * EDGE_VERTS_PER_WALL * 3);
    let offset = 0;
    for (const inst of instances) {
      offset = writeWallEdges(inst, verts, offset);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    geom.computeBoundingSphere();
    return geom;
  }, [instances]);

  // Dispose previous geometry on rebuild — prevents GPU-buffer leak.
  useEffect(() => () => geometry?.dispose(), [geometry]);

  if (!geometry) return null;

  return (
    <lineSegments geometry={geometry} raycast={() => null}>
      <lineBasicMaterial
        color="#4a5668"
        transparent
        opacity={Math.max(0.08, Math.min(0.95, opacity))}
        depthWrite={false}
      />
    </lineSegments>
  );
}

// ── Selected-wall highlight ───────────────────────────────────

/**
 * The selected wall renders non-instanced so it can carry a thicker /
 * brighter edge outline + a yellow highlight. Geometry + rotation
 * match the InstancedMesh transform exactly so the selection visually
 * overlays the batch.
 */
function SelectedWallHighlight({
  instance,
  baseOpacity,
  onDeselect,
}: {
  instance: WallInstance;
  baseOpacity: number;
  onDeselect: () => void;
}) {
  const position = instance.position;
  const scale = instance.scale;

  // Rebuild the quaternion-angle to euler-Y for the rotation prop.
  // The bucket stores a unit-Y-axis quaternion whose y/w components
  // encode the rotation — extract θ = 2·atan2(y, w).
  const rotY = 2 * Math.atan2(instance.quaternion[1], instance.quaternion[3]);

  // Create a box geometry at the wall's actual size for edge lines.
  // (We could share the unit box and scale it, but the wireframe gets
  //  its edge lines from the geometry's own edges, which would then be
  //  wrong-scaled — simpler to just build a properly-sized geometry
  //  for this single instance.)
  const geom = useMemo(
    () => new THREE.BoxGeometry(scale[0], scale[1], scale[2]),
    [scale[0], scale[1], scale[2]],
  );
  useEffect(() => () => geom.dispose(), [geom]);

  const edgeGeom = useMemo(() => new THREE.EdgesGeometry(geom), [geom]);
  useEffect(() => () => edgeGeom.dispose(), [edgeGeom]);

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh
        geometry={geom}
        onClick={(e: ThreeEvent<MouseEvent>) => {
          e.stopPropagation();
          onDeselect();
        }}
      >
        <meshStandardMaterial
          color={instance.color}
          transparent
          opacity={Math.max(0.1, baseOpacity)}
          metalness={0.05}
          roughness={0.8}
          depthWrite={false}
        />
      </mesh>
      <lineSegments geometry={edgeGeom} raycast={() => null}>
        <lineBasicMaterial color="#ffd54f" transparent opacity={0.95} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

// ── Re-export for tests ────────────────────────────────────────
// Not strictly needed, but useful if future integration tests want to
// mount individual buckets without the outer store wiring.
export { BucketInstancedMesh, BucketEdges, SelectedWallHighlight };

// Satisfy lint: Wall is used in the type reference.
export type { Wall };
