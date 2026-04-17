/**
 * Fixture Models — parametric 3D shapes replacing the placeholder GlowRings.
 *
 * Each fixture type gets a recognizable low-poly shape built from
 * Three.js primitives (no imported meshes). The shapes are designed
 * to be instantly identifiable at a glance:
 *
 *   Toilet    — oval bowl + rectangular tank on the wall side
 *   Sink      — shallow rectangular basin + cylinder faucet
 *   Shower    — flat square pan + tall riser pipe + sphere head
 *   Bathtub   — elongated rounded box
 *   Floor drain — flat disc with cross pattern
 *
 * Each fixture retains a GlowRing on its drain/supply connection
 * point that pulses when the FSM is in 'idle' state.
 */

import { useRef, useMemo, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { GlowRing } from '@ui/SensoryFeedback';
import { useFSM } from '@hooks/useFSM';
import { userFSM } from '@core/UserProgressFSM';
import { useLayerStore } from '@store/layerStore';
import { useFloorParams } from '@store/floorStore';
import { useFixtureStore, type FixtureInstance } from '@store/fixtureStore';
import { useInteractionStore } from '@store/interactionStore';
import { usePhaseFilter } from '@store/phaseStore';
import { shouldPhaseRender, PHASE_META } from '@core/phases/PhaseTypes';
import { classifyFixture } from '@core/phases/PhaseClassifier';
import { getFixtureGeometry } from '@core/fixtures/ConnectionPoints';
import type { FixtureSubtype } from '../../engine/graph/GraphNode';
import { type ThreeEvent } from '@react-three/fiber';

// ── Fixture colors ──────────────────────────────────────────────

const FIXTURE_COLOR = '#e0e0e0';
const FIXTURE_ACCENT = '#b0bec5';
const METAL_COLOR = '#8a9bae';

// ── Toilet ──────────────────────────────────────────────────────

/**
 * Residential tank-type toilet modeled with actual ANSI Z124 dimensions:
 *   - Base: 17" wide at rim, 19" at floor flare, 6" tall
 *   - Bowl: 14" wide × (18"/15" elongated/round) deep × 14" tall
 *   - Tank: 17" W × 8" D × 14" tall, sits on back of bowl
 *   - Total height: 30" to rim (ADA "comfort height" = 17.5")
 *
 * Porcelain-grade material: high-roughness diffuse + clearcoat-like
 * specular via MeshStandardMaterial with metalness bumped slightly.
 */
function ToiletModel({ position, params }: { position: [number, number, number]; params?: Record<string, unknown> }) {
  const elongated = (params?.bowlShape ?? 'elongated') === 'elongated';
  const seatHeight = Number(params?.seatHeight ?? 16.5) / 12; // inches → ft
  const wallMount = params?.wallMounted === true;
  const commercial = params?.commercial === true;

  // Real dimensions (all in feet)
  const rimW = 17 / 12;                       // 1.42 ft
  const rimD = (elongated ? 18 : 15) / 12;    // 1.5 / 1.25 ft
  const baseFlareW = 19 / 12;                 // 1.58 ft
  const baseH = 0.5;                          // 6"
  const bowlH = seatHeight - baseH;           // bowl body height
  const tankW = rimW;
  const tankD = 8 / 12;                       // 0.67 ft
  const tankH = 14 / 12;                      // 1.17 ft
  const rimThickness = 0.07;                  // 0.84"

  const porcelain = {
    color: FIXTURE_COLOR,
    metalness: 0.15,
    roughness: 0.18,             // glossy porcelain
    envMapIntensity: 1.0,
  };

  return (
    <group position={position}>
      {!wallMount && (
        <>
          {/* Base pedestal — slightly tapered (wider at floor) */}
          <mesh position={[0, baseH / 2, rimD * 0.18]} castShadow receiveShadow>
            <cylinderGeometry args={[rimW / 2 * 0.8, baseFlareW / 2 * 0.8, baseH, 24]} />
            <meshStandardMaterial {...porcelain} />
          </mesh>

          {/* Bowl body — oval frustum (skirted) */}
          <mesh position={[0, baseH + bowlH / 2, rimD * 0.18]} scale={[1, 1, elongated ? 1.15 : 1]} castShadow receiveShadow>
            <cylinderGeometry args={[rimW / 2 * 0.92, rimW / 2 * 0.85, bowlH, 28]} />
            <meshStandardMaterial {...porcelain} />
          </mesh>

          {/* Bowl rim — oval torus on top of bowl */}
          <mesh position={[0, seatHeight, rimD * 0.18]} rotation-x={Math.PI / 2} scale={[1, elongated ? 1.15 : 1, 1]}>
            <torusGeometry args={[rimW / 2, rimThickness, 14, 36]} />
            <meshStandardMaterial {...porcelain} />
          </mesh>

          {/* Bowl interior (concave dark surface) */}
          <mesh position={[0, seatHeight - rimThickness * 2, rimD * 0.18]} rotation-x={-Math.PI / 2} scale={[1, elongated ? 1.15 : 1, 1]}>
            <circleGeometry args={[rimW / 2 * 0.9, 28]} />
            <meshStandardMaterial color="#8a94a1" metalness={0.2} roughness={0.4} side={THREE.DoubleSide} />
          </mesh>

          {/* Seat — ring on top of rim */}
          <mesh position={[0, seatHeight + rimThickness + 0.04, rimD * 0.18]} rotation-x={-Math.PI / 2} scale={[1, elongated ? 1.15 : 1, 1]}>
            <ringGeometry args={[rimW / 2 * 0.55, rimW / 2 * 1.0, 36]} />
            <meshStandardMaterial {...porcelain} side={THREE.DoubleSide} />
          </mesh>

          {/* Seat outer edge thickness */}
          <mesh position={[0, seatHeight + rimThickness + 0.02, rimD * 0.18]} rotation-x={Math.PI / 2} scale={[1, elongated ? 1.15 : 1, 1]}>
            <torusGeometry args={[rimW / 2, 0.025, 8, 36]} />
            <meshStandardMaterial {...porcelain} />
          </mesh>
        </>
      )}

      {!wallMount && !commercial && (
        <>
          {/* Tank body — slightly tapered at top */}
          <mesh position={[0, baseH + bowlH + rimThickness + tankH / 2, -tankD / 2]} castShadow receiveShadow>
            <boxGeometry args={[tankW, tankH, tankD]} />
            <meshStandardMaterial {...porcelain} />
          </mesh>

          {/* Tank lid — slight overhang */}
          <mesh position={[0, baseH + bowlH + rimThickness + tankH + 0.04, -tankD / 2]}>
            <boxGeometry args={[tankW + 0.08, 0.08, tankD + 0.08]} />
            <meshStandardMaterial {...porcelain} />
          </mesh>

          {/* Flush handle — chrome lever on front-left of tank */}
          <mesh
            position={[tankW / 2 - 0.12, baseH + bowlH + rimThickness + tankH * 0.8, -tankD * 0.05]}
            rotation-z={-Math.PI / 8}
            castShadow
          >
            <cylinderGeometry args={[0.015, 0.015, 0.16, 10]} />
            <meshStandardMaterial color="#c0c4ca" metalness={0.9} roughness={0.12} />
          </mesh>

          {/* Handle base plate */}
          <mesh position={[tankW / 2 - 0.05, baseH + bowlH + rimThickness + tankH * 0.8, -tankD * 0.05]} rotation-y={Math.PI / 2}>
            <cylinderGeometry args={[0.025, 0.025, 0.02, 12]} />
            <meshStandardMaterial color="#c0c4ca" metalness={0.9} roughness={0.15} />
          </mesh>

          {/* Supply angle stop (visible at base rear) */}
          <mesh position={[-tankW / 2 + 0.12, 0.7, -tankD * 0.85]}>
            <cylinderGeometry args={[0.018, 0.018, 0.12, 12]} />
            <meshStandardMaterial color="#c0c4ca" metalness={0.85} roughness={0.18} />
          </mesh>
        </>
      )}

      {/* Commercial flushometer (replaces tank) */}
      {(wallMount || commercial) && (
        <>
          <mesh position={[0, seatHeight + 0.75, -0.35]}>
            <cylinderGeometry args={[0.05, 0.05, 1.2, 14]} />
            <meshStandardMaterial color="#c0c4ca" metalness={0.9} roughness={0.15} />
          </mesh>
          {/* Valve body */}
          <mesh position={[0, seatHeight + 1.25, -0.28]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.09, 0.09, 0.18, 14]} />
            <meshStandardMaterial color="#c0c4ca" metalness={0.9} roughness={0.13} />
          </mesh>
          {/* Wall flange (where pipe enters wall) */}
          <mesh position={[0, seatHeight + 1.9, -0.35]}>
            <cylinderGeometry args={[0.1, 0.1, 0.03, 14]} />
            <meshStandardMaterial color="#c0c4ca" metalness={0.85} roughness={0.2} />
          </mesh>
        </>
      )}
    </group>
  );
}

// ── Sink / Lavatory ─────────────────────────────────────────────

interface ModelProps {
  position: [number, number, number];
  params?: Record<string, unknown>;
}

/**
 * Kitchen sink — real dimensions:
 *   Countertop cut: 33"W × 22"D (single) or 36"W × 25"D (double)
 *   Bowl depth: 7-10" below countertop
 *   Deck-mount faucet: chrome, 8" tall + curved spout ~10"
 *   Countertop height: 36" (standard)
 */
function KitchenSinkModel({ position, params }: ModelProps) {
  const bowlCount = Number(params?.bowlCount ?? 2);
  const depthIn = Number(params?.bowlDepth ?? 9);
  const depthFt = depthIn / 12;

  // Countertop dimensions (real)
  const topWidth = bowlCount === 1 ? 33 / 12 : bowlCount === 2 ? 36 / 12 : 42 / 12;
  const topDepth = 22 / 12;
  const topH = 36 / 12; // counter height
  const counterThickness = 0.12; // 1.5"

  const porcelain = { color: FIXTURE_COLOR, metalness: 0.15, roughness: 0.2 };
  const stainless = { color: '#a8a8a8', metalness: 0.9, roughness: 0.18 };
  const chrome = { color: '#c0c4ca', metalness: 0.92, roughness: 0.1 };

  return (
    <group position={position}>
      {/* Countertop slab */}
      <mesh position={[0, topH + counterThickness / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[topWidth, counterThickness, topDepth]} />
        <meshStandardMaterial color="#d4c9b5" metalness={0.1} roughness={0.45} />
      </mesh>

      {/* Countertop edge profile (thin dark bullnose) */}
      <mesh position={[0, topH, 0]}>
        <boxGeometry args={[topWidth + 0.005, 0.02, topDepth + 0.005]} />
        <meshStandardMaterial color="#8a7a62" metalness={0.1} roughness={0.5} />
      </mesh>

      {/* Basin(s) — recessed stainless bowls */}
      {renderStainlessBowls(bowlCount, topWidth, topDepth, topH, depthFt, stainless, porcelain)}

      {/* Deck-mount faucet — centered, rear of sink */}
      <group position={[0, topH + counterThickness, -topDepth * 0.35]}>
        {/* Faucet base */}
        <mesh castShadow>
          <cylinderGeometry args={[0.045, 0.05, 0.08, 16]} />
          <meshStandardMaterial {...chrome} />
        </mesh>
        {/* Vertical body */}
        <mesh position={[0, 0.2, 0]}>
          <cylinderGeometry args={[0.025, 0.03, 0.35, 14]} />
          <meshStandardMaterial {...chrome} />
        </mesh>
        {/* Curved arc spout */}
        <mesh position={[0, 0.4, 0.08]} rotation-x={-Math.PI / 3}>
          <torusGeometry args={[0.16, 0.022, 12, 20, Math.PI]} />
          <meshStandardMaterial {...chrome} />
        </mesh>
        {/* Handle */}
        <mesh position={[0.08, 0.25, 0]} rotation-z={-Math.PI / 6}>
          <cylinderGeometry args={[0.015, 0.015, 0.12, 10]} />
          <meshStandardMaterial {...chrome} />
        </mesh>
      </group>

      {/* Pot filler (optional) */}
      {params?.potFiller === true && (
        <group position={[topWidth / 2 + 0.15, topH + counterThickness + 0.45, -topDepth * 0.3]}>
          <mesh rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.018, 0.018, 0.5, 12]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
          <mesh position={[-0.25, 0, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 0.12, 12]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
        </group>
      )}

      {/* Instant hot water tap */}
      {params?.instantHotWater === true && (
        <mesh position={[topWidth / 2 - 0.18, topH + counterThickness + 0.12, -topDepth * 0.35]}>
          <cylinderGeometry args={[0.02, 0.022, 0.2, 12]} />
          <meshStandardMaterial color="#a52a2a" metalness={0.6} roughness={0.25} />
        </mesh>
      )}

      {/* Soap dispenser (always shown — common) */}
      <mesh position={[-topWidth / 2 + 0.2, topH + counterThickness + 0.08, -topDepth * 0.35]}>
        <cylinderGeometry args={[0.018, 0.02, 0.12, 12]} />
        <meshStandardMaterial {...chrome} />
      </mesh>

      {/* Base cabinet (so the sink doesn't float) */}
      <mesh position={[0, topH / 2, 0]} receiveShadow>
        <boxGeometry args={[topWidth - 0.05, topH, topDepth - 0.05]} />
        <meshStandardMaterial color="#6d5a3e" metalness={0.05} roughness={0.75} />
      </mesh>

      {/* Cabinet doors */}
      {[-topWidth / 4, topWidth / 4].map((xOff, i) => (
        <mesh key={i} position={[xOff, topH / 2, topDepth / 2 - 0.03]}>
          <boxGeometry args={[topWidth / 2 - 0.08, topH - 0.15, 0.03]} />
          <meshStandardMaterial color="#7a6646" metalness={0.08} roughness={0.6} />
        </mesh>
      ))}

      {/* Door handles */}
      {[-topWidth / 4 + 0.12, topWidth / 4 - 0.12].map((xOff, i) => (
        <mesh key={i} position={[xOff, topH / 2, topDepth / 2]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.01, 0.01, 0.08, 8]} />
          <meshStandardMaterial {...chrome} />
        </mesh>
      ))}
    </group>
  );
}

function renderStainlessBowls(
  count: number,
  topW: number,
  topD: number,
  topH: number,
  depthFt: number,
  stainless: { color: string; metalness: number; roughness: number },
  _porcelain: { color: string; metalness: number; roughness: number },
) {
  // Basins are recessed BELOW the countertop surface (topH).
  const basinY = topH - depthFt / 2;
  const insetX = 0.15; // 1.8" margin from countertop edge
  const insetZ = 0.08; // 1" margin from front/back
  const pieces: JSX.Element[] = [];

  if (count <= 1) {
    const bw = topW - insetX * 2;
    const bd = topD - insetZ * 2;
    pieces.push(
      <mesh key="b0" position={[0, basinY, 0]}>
        <boxGeometry args={[bw, depthFt, bd]} />
        <meshStandardMaterial {...stainless} />
      </mesh>,
      // Drain visible at basin bottom
      <mesh key="d0" position={[0, basinY - depthFt / 2 + 0.005, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.065, 16]} />
        <meshStandardMaterial color="#6a6a6a" metalness={0.8} roughness={0.25} side={THREE.DoubleSide} />
      </mesh>,
    );
  } else if (count === 2) {
    const bw = (topW - insetX * 2) / 2 - 0.03;
    const bd = topD - insetZ * 2;
    for (const [key, xOff] of [['l', -topW / 4 + 0.02], ['r', topW / 4 - 0.02]] as const) {
      pieces.push(
        <mesh key={key} position={[xOff as number, basinY, 0]}>
          <boxGeometry args={[bw, depthFt, bd]} />
          <meshStandardMaterial {...stainless} />
        </mesh>,
        <mesh key={`d${key}`} position={[xOff as number, basinY - depthFt / 2 + 0.005, 0]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.06, 16]} />
          <meshStandardMaterial color="#6a6a6a" metalness={0.8} roughness={0.25} side={THREE.DoubleSide} />
        </mesh>,
      );
    }
  } else {
    // Triple: large + prep + large
    const wideW = (topW - insetX * 2) * 0.38;
    const smallW = (topW - insetX * 2) * 0.2;
    const bd = topD - insetZ * 2;
    const entries: Array<[string, number, number, number]> = [
      ['l', -topW / 4, wideW, depthFt],
      ['c', 0, smallW, depthFt * 0.7],
      ['r', topW / 4, wideW, depthFt],
    ];
    for (const [key, xOff, w, h] of entries) {
      const by = topH - h / 2;
      pieces.push(
        <mesh key={key} position={[xOff, by, 0]}>
          <boxGeometry args={[w, h, bd]} />
          <meshStandardMaterial {...stainless} />
        </mesh>,
        <mesh key={`d${key}`} position={[xOff, by - h / 2 + 0.005, 0]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.05, 16]} />
          <meshStandardMaterial color="#6a6a6a" metalness={0.8} roughness={0.25} side={THREE.DoubleSide} />
        </mesh>,
      );
    }
  }
  return <>{pieces}</>;
}

/**
 * Lavatory — bathroom sink, either pedestal or wall-mount.
 *   Standard: 20" W × 17" D × 35" counter height with 6" deep bowl
 *   Pedestal: bowl + column from floor to bowl underside (~32" tall pedestal)
 */
function LavatoryModel({ position, params }: ModelProps) {
  const wallMount = params?.wallMounted === true;
  const basinShape = String(params?.basinShape ?? 'oval');

  const topH = 35 / 12;        // counter height
  const bowlW = 20 / 12;
  const bowlD = 17 / 12;
  const bowlDepth = 6 / 12;
  const counterThick = 0.1;

  const porcelain = { color: FIXTURE_COLOR, metalness: 0.15, roughness: 0.18 };
  const chrome = { color: '#c0c4ca', metalness: 0.92, roughness: 0.1 };

  return (
    <group position={position}>
      {/* Pedestal (only if not wall-mount) */}
      {!wallMount && (
        <mesh position={[0, topH / 2, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.12, 0.18, topH, 16]} />
          <meshStandardMaterial {...porcelain} />
        </mesh>
      )}

      {/* Wall mount bracket instead of pedestal */}
      {wallMount && (
        <mesh position={[0, topH - 0.05, -bowlD / 2 + 0.02]}>
          <boxGeometry args={[bowlW * 0.7, 0.15, 0.04]} />
          <meshStandardMaterial color="#707076" metalness={0.6} roughness={0.3} />
        </mesh>
      )}

      {/* Counter/sink top slab */}
      <mesh position={[0, topH + counterThick / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[bowlW, counterThick, bowlD]} />
        <meshStandardMaterial {...porcelain} />
      </mesh>

      {/* Basin cavity */}
      {basinShape === 'oval' || basinShape === 'round' ? (
        <mesh position={[0, topH + counterThick - bowlDepth / 2, 0]} rotation-x={-Math.PI / 2}>
          <cylinderGeometry args={[bowlW / 2 * 0.75, bowlW / 2 * 0.6, bowlDepth, 28]} />
          <meshStandardMaterial color="#e6e2d5" metalness={0.18} roughness={0.25} />
        </mesh>
      ) : basinShape === 'vessel' ? (
        // Vessel: bowl sits ON TOP of counter
        <group position={[0, topH + counterThick, 0]}>
          <mesh>
            <sphereGeometry args={[bowlW / 2.5, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial {...porcelain} />
          </mesh>
        </group>
      ) : (
        // Rectangle
        <mesh position={[0, topH + counterThick - bowlDepth / 2, 0]}>
          <boxGeometry args={[bowlW * 0.75, bowlDepth, bowlD * 0.6]} />
          <meshStandardMaterial color="#e6e2d5" metalness={0.18} roughness={0.25} />
        </mesh>
      )}

      {/* Drain */}
      <mesh position={[0, topH + counterThick - bowlDepth + 0.005, 0]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.035, 16]} />
        <meshStandardMaterial color="#6a6a6a" metalness={0.8} roughness={0.25} side={THREE.DoubleSide} />
      </mesh>

      {/* Faucet — widespread vs centerset based on params */}
      {String(params?.faucetCenters) === '8' ? (
        <>
          {/* Two handles */}
          {[-0.17, 0.17].map((xOff, i) => (
            <mesh key={i} position={[xOff, topH + counterThick + 0.05, -bowlD / 2 + 0.08]}>
              <cylinderGeometry args={[0.02, 0.025, 0.1, 12]} />
              <meshStandardMaterial {...chrome} />
            </mesh>
          ))}
          {/* Spout */}
          <mesh position={[0, topH + counterThick + 0.08, -bowlD / 2 + 0.1]}>
            <cylinderGeometry args={[0.02, 0.025, 0.16, 14]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
          <mesh position={[0, topH + counterThick + 0.2, -bowlD / 2 + 0.18]} rotation-x={-Math.PI / 3}>
            <cylinderGeometry args={[0.016, 0.018, 0.12, 12]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
        </>
      ) : (
        // Centerset / single-hole
        <group position={[0, topH + counterThick, -bowlD / 2 + 0.08]}>
          <mesh>
            <cylinderGeometry args={[0.035, 0.04, 0.05, 14]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
          <mesh position={[0, 0.08, 0]}>
            <cylinderGeometry args={[0.02, 0.025, 0.15, 14]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
          <mesh position={[0, 0.18, 0.06]} rotation-x={-Math.PI / 2.5}>
            <cylinderGeometry args={[0.016, 0.018, 0.14, 12]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
        </group>
      )}
    </group>
  );
}

// Back-compat alias (some call sites may still reference SinkModel)
function SinkModel(props: ModelProps) {
  const subtype = String((props.params as any)?.__subtype ?? '');
  if (subtype === 'kitchen_sink') return <KitchenSinkModel {...props} />;
  return <LavatoryModel {...props} />;
}

// Old renderSinkBowls helper removed — now handled by renderStainlessBowls
// inside KitchenSinkModel with real sizing.

// ── Shower ───────────────────────────────────────────────────────

/**
 * Shower — standard stall enclosure, real dimensions:
 *   Pan: 32×32, 36×36, 48×36, 60×32 (walk-in) per common sizes
 *   Pan thickness: 3" (tiled shower floor over slope-to-drain)
 *   Back + side walls: 80" tall (6'8") tile surround
 *   Shower arm: 80" above floor, wall-mounted elbow
 *   Valve trim: 48" above floor (knee-high)
 *   Handheld bar: 40" ADA position
 *   Body sprays: staggered 42"-60"
 *   Linear drain: 24-36" long, near one wall
 */
function ShowerModel({ position, params }: { position: [number, number, number]; params?: Record<string, unknown> }) {
  const panSize = String(params?.panSize ?? '36x36');
  const sizes = panSize.split('x').map((s) => parseInt(s, 10));
  const wIn = sizes[0] ?? 36;
  const dIn = sizes[1] ?? 36;
  const panW = wIn / 12;   // width (X)
  const panD = dIn / 12;   // depth (Z)
  const panThickness = 3 / 12;  // 3" pan
  const wallHeight = 80 / 12;   // 80" enclosure
  const armHeight = 80 / 12;    // 80" shower head
  const valveHeight = 48 / 12;  // 48" valve trim
  const handheldBar = 40 / 12;  // 40" ADA

  const drainType = String(params?.drainType ?? 'point');
  const linearDrain = drainType === 'linear';
  const valveType = String(params?.valveType ?? 'pressure_balance');
  const rainHead = params?.rainHead === true;
  const bodySprays = params?.bodySprays === true;
  const handheld = params?.handheld === true;
  const steam = params?.steamUnit === true;

  const tile = { color: '#dfe4e8', metalness: 0.08, roughness: 0.32 };
  const panMat = { color: '#c8cdd2', metalness: 0.12, roughness: 0.4 };
  const chrome = { color: '#c0c4ca', metalness: 0.92, roughness: 0.1 };
  const darkChrome = { color: '#707076', metalness: 0.82, roughness: 0.22 };

  // Shower wall is on -Z (back wall); valve + shower head mount to it
  return (
    <group position={position}>
      {/* Shower pan — slightly sloped (visually just a flat slab at pan thickness) */}
      <mesh position={[0, panThickness / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[panW, panThickness, panD]} />
        <meshStandardMaterial {...panMat} />
      </mesh>

      {/* Pan top surface with subtle slope (tiny slope toward drain, not exaggerated) */}
      <mesh position={[0, panThickness + 0.002, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[panW - 0.04, panD - 0.04]} />
        <meshStandardMaterial {...tile} side={THREE.DoubleSide} />
      </mesh>

      {/* Drain */}
      {linearDrain ? (
        <>
          <mesh position={[0, panThickness + 0.005, panD / 2 - 0.15]} rotation-x={-Math.PI / 2}>
            <planeGeometry args={[panW * 0.8, 0.15]} />
            <meshStandardMaterial {...darkChrome} side={THREE.DoubleSide} />
          </mesh>
          {/* Slot pattern */}
          {Array.from({ length: 14 }).map((_, i) => (
            <mesh key={i} position={[-(panW * 0.4) + i * (panW * 0.06), panThickness + 0.008, panD / 2 - 0.15]} rotation-x={-Math.PI / 2}>
              <planeGeometry args={[0.01, 0.12]} />
              <meshStandardMaterial color="#202025" side={THREE.DoubleSide} />
            </mesh>
          ))}
        </>
      ) : (
        <mesh position={[0, panThickness + 0.005, 0]} rotation-x={-Math.PI / 2}>
          <circleGeometry args={[0.08, 24]} />
          <meshStandardMaterial {...darkChrome} side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Back wall tile panel */}
      <mesh position={[0, panThickness + wallHeight / 2, -panD / 2 + 0.01]}>
        <boxGeometry args={[panW, wallHeight, 0.03]} />
        <meshStandardMaterial {...tile} />
      </mesh>

      {/* Left side wall panel */}
      <mesh position={[-panW / 2 + 0.01, panThickness + wallHeight / 2, 0]}>
        <boxGeometry args={[0.03, wallHeight, panD]} />
        <meshStandardMaterial {...tile} />
      </mesh>

      {/* Right side wall panel (absent if walk-in) */}
      {wIn < 54 && (
        <mesh position={[panW / 2 - 0.01, panThickness + wallHeight / 2, 0]}>
          <boxGeometry args={[0.03, wallHeight, panD]} />
          <meshStandardMaterial {...tile} />
        </mesh>
      )}

      {/* Tile grout line at floor — thin dark strip */}
      <mesh position={[0, panThickness + 0.03, -panD / 2 + 0.04]}>
        <boxGeometry args={[panW, 0.015, 0.012]} />
        <meshStandardMaterial color="#6d737c" metalness={0.1} roughness={0.8} />
      </mesh>

      {/* Valve trim plate — round, on back wall at 48" */}
      <mesh position={[0, valveHeight, -panD / 2 + 0.04]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.11, 0.11, 0.03, 20]} />
        <meshStandardMaterial {...chrome} />
      </mesh>
      {/* Rotating handle on trim */}
      <mesh position={[0, valveHeight, -panD / 2 + 0.09]}>
        <cylinderGeometry args={[0.04, 0.05, 0.08, 16]} />
        <meshStandardMaterial {...chrome} />
      </mesh>
      {/* Volume knob + temp indicator for thermostatic/pressure-balance */}
      {valveType === 'thermostatic' && (
        <mesh position={[0.09, valveHeight + 0.02, -panD / 2 + 0.08]}>
          <cylinderGeometry args={[0.022, 0.022, 0.05, 12]} />
          <meshStandardMaterial {...chrome} />
        </mesh>
      )}

      {/* Shower arm from back wall */}
      <mesh position={[0, armHeight, -panD / 2 + 0.15]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.02, 0.02, 0.3, 14]} />
        <meshStandardMaterial {...chrome} />
      </mesh>

      {/* Shower head — standard wall-mount */}
      {!rainHead && (
        <group position={[0, armHeight - 0.04, -panD / 2 + 0.35]}>
          <mesh rotation-x={-Math.PI / 6}>
            <sphereGeometry args={[0.06, 20, 14, 0, Math.PI * 2, 0, Math.PI / 1.5]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
          {/* Face plate with holes pattern (small disc) */}
          <mesh position={[0, -0.05, 0.02]} rotation-x={-Math.PI / 4}>
            <cylinderGeometry args={[0.055, 0.06, 0.01, 20]} />
            <meshStandardMaterial color="#8a8e93" metalness={0.75} roughness={0.3} />
          </mesh>
        </group>
      )}

      {/* Rain head — ceiling-mounted large disc */}
      {rainHead && (
        <group position={[0, armHeight + 0.3, 0]}>
          {/* Drop-down pipe from ceiling */}
          <mesh position={[0, 0.15, 0]}>
            <cylinderGeometry args={[0.022, 0.022, 0.3, 12]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
          {/* Rain head disc */}
          <mesh rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.2, 0.2, 0.035, 24]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
          {/* Spray face */}
          <mesh position={[0, -0.02, 0]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.19, 0.19, 0.005, 24]} />
            <meshStandardMaterial color="#707076" metalness={0.7} roughness={0.35} />
          </mesh>
        </group>
      )}

      {/* Handheld on slide bar — left wall ADA position */}
      {handheld && (
        <group>
          <mesh position={[-panW / 2 + 0.05, panThickness + handheldBar, 0]} rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.015, 0.015, 1.5, 10]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
          <mesh position={[-panW / 2 + 0.08, panThickness + handheldBar + 0.1, 0.3]} rotation-z={Math.PI / 6}>
            <cylinderGeometry args={[0.03, 0.04, 0.2, 14]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
          <mesh position={[-panW / 2 + 0.08, panThickness + handheldBar + 0.2, 0.38]}>
            <sphereGeometry args={[0.045, 16, 12]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
        </group>
      )}

      {/* Body sprays — 2 on back wall staggered height */}
      {bodySprays && [42, 54].map((hIn, i) => (
        <mesh key={i}
          position={[(i === 0 ? -1 : 1) * panW * 0.3, panThickness + hIn / 12, -panD / 2 + 0.05]}
          rotation-x={Math.PI / 2}
        >
          <cylinderGeometry args={[0.035, 0.035, 0.03, 16]} />
          <meshStandardMaterial {...chrome} />
        </mesh>
      ))}

      {/* Steam generator vent (small chrome tube from ceiling) */}
      {steam && (
        <mesh position={[0, armHeight + 0.6, -panD / 2 + 0.35]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.025, 0.025, 0.12, 12]} />
          <meshStandardMaterial {...darkChrome} />
        </mesh>
      )}
    </group>
  );
}

// ── Bathtub ─────────────────────────────────────────────────────

/**
 * Bathtub — standard alcove, real dimensions:
 *   Standard: 60" × 32" × 20" (L × W × H)
 *   Interior: 54" × 26" × 14" (bottom to rim)
 *   Apron (visible front wall): 1.5" thick
 *   Rim thickness: 2" around top edge
 *   Drain: 2" circle, 6" from drain-side end-wall, centered in width
 *   Overflow plate: 10" above drain, same end-wall
 *   Tub spout: 8" above rim, opposite end-wall
 *   Handles/faucet knobs: 18" above rim
 */
function BathtubModel({ position, params }: { position: [number, number, number]; params?: Record<string, unknown> }) {
  const lengthIn = Number(params?.length ?? 60);
  const widthIn  = Number(params?.width ?? 32);
  const heightIn = 20; // standard tub height (always 20" — doesn't vary)
  const interiorDepth = 14 / 12;  // 14" deep basin
  const rimThickness = 0.17;      // 2"
  const apronThick = 0.13;        // 1.5"

  const L = lengthIn / 12;   // 5.0 ft for 60"
  const W = widthIn / 12;    // 2.67 ft for 32"
  const H = heightIn / 12;   // 1.67 ft

  const drainSide = String(params?.drainSide ?? 'left');
  const drainZ = drainSide === 'right' ? -L / 2 + 0.5 : drainSide === 'center' ? 0 : L / 2 - 0.5;
  const whirlpool = params?.whirlpool === true;
  const jetCount = whirlpool ? Number(params?.jetCount ?? 6) : 0;
  const style = String(params?.tubStyle ?? 'alcove');
  const freestand = style === 'freestand';

  const porcelain = { color: FIXTURE_COLOR, metalness: 0.15, roughness: 0.18 };
  const interiorMat = { color: '#e6e2d5', metalness: 0.2, roughness: 0.22 };
  const chrome = { color: '#c0c4ca', metalness: 0.92, roughness: 0.1 };

  // Tub sits ON the floor — Y=0 is floor, top of rim at Y=H
  return (
    <group position={position}>
      {/* Outer tub shell — rounded top edges via a box with slightly inset rim */}
      <mesh position={[0, H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, H, L]} />
        <meshStandardMaterial {...porcelain} />
      </mesh>

      {/* Interior cavity — subtracted visually by rendering a dark inset */}
      <mesh position={[0, H - interiorDepth / 2, 0]}>
        <boxGeometry args={[W - apronThick * 2, interiorDepth, L - apronThick * 2]} />
        <meshStandardMaterial {...interiorMat} />
      </mesh>

      {/* Rim — raised lip all around top edge */}
      <mesh position={[0, H, 0]}>
        <boxGeometry args={[W + 0.04, rimThickness, L + 0.04]} />
        <meshStandardMaterial {...porcelain} />
      </mesh>

      {/* Inner rim cavity cutout */}
      <mesh position={[0, H + rimThickness / 2 - 0.01, 0]}>
        <boxGeometry args={[W - apronThick * 2, rimThickness + 0.02, L - apronThick * 2]} />
        <meshStandardMaterial {...interiorMat} />
      </mesh>

      {/* Drain */}
      <mesh position={[0, H - interiorDepth + 0.005, drainZ]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.08, 24]} />
        <meshStandardMaterial color="#6a6a6a" metalness={0.82} roughness={0.2} side={THREE.DoubleSide} />
      </mesh>

      {/* Overflow plate — 10" above tub bottom on the drain-end wall */}
      {params?.overflow === true && (
        <mesh position={[0, H - interiorDepth + 10 / 12, drainZ * 0.93]}>
          <cylinderGeometry args={[0.06, 0.06, 0.02, 16]} />
          <meshStandardMaterial color="#c0c4ca" metalness={0.82} roughness={0.18} />
        </mesh>
      )}

      {/* Tub spout + faucet handles — on opposite wall from drain */}
      {(() => {
        const faucetEnd = drainZ > 0 ? -L / 2 + 0.3 : L / 2 - 0.3;
        const spoutY = H + 8 / 12; // 8" above rim
        const handleY = H + 18 / 12; // 18" above rim
        return (
          <group>
            {/* Spout base (from wall) */}
            <mesh position={[0, spoutY, faucetEnd * 1.02]} rotation-x={Math.PI / 2}>
              <cylinderGeometry args={[0.04, 0.04, 0.1, 12]} />
              <meshStandardMaterial {...chrome} />
            </mesh>
            {/* Spout nozzle */}
            <mesh position={[0, spoutY - 0.04, faucetEnd - (drainZ > 0 ? 0.1 : -0.1)]}>
              <cylinderGeometry args={[0.025, 0.03, 0.12, 14]} />
              <meshStandardMaterial {...chrome} />
            </mesh>
            {/* Two handles */}
            {[-0.18, 0.18].map((xOff, i) => (
              <mesh key={i} position={[xOff, handleY, faucetEnd * 1.02]}>
                <cylinderGeometry args={[0.04, 0.04, 0.06, 14]} />
                <meshStandardMaterial {...chrome} />
              </mesh>
            ))}
            {/* Diverter button (tub/shower) */}
            <mesh position={[0, handleY, faucetEnd * 1.02]}>
              <cylinderGeometry args={[0.02, 0.02, 0.04, 12]} />
              <meshStandardMaterial {...chrome} />
            </mesh>
          </group>
        );
      })()}

      {/* Whirlpool jets around interior sides */}
      {whirlpool && Array.from({ length: jetCount }).map((_, i) => {
        const t = i / jetCount;
        const alongL = (-L / 2 + apronThick + 0.2) + t * (L - apronThick * 2 - 0.4);
        const sideX = (i % 2 === 0 ? -1 : 1) * (W / 2 - apronThick - 0.02);
        return (
          <mesh key={i} position={[sideX, H - interiorDepth * 0.5, alongL]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.04, 0.035, 0.04, 12]} />
            <meshStandardMaterial color="#ecf0f3" metalness={0.7} roughness={0.22} />
          </mesh>
        );
      })}

      {/* Freestanding feet / claw-foot style */}
      {freestand && ([
        [-W/2+0.15, -L/2+0.2], [W/2-0.15, -L/2+0.2],
        [-W/2+0.15,  L/2-0.2], [W/2-0.15,  L/2-0.2],
      ] as [number, number][]).map(([fx, fz], i) => (
        <mesh key={i} position={[fx, 0.1, fz]} castShadow>
          <cylinderGeometry args={[0.06, 0.05, 0.2, 10]} />
          <meshStandardMaterial color="#3a3a3a" metalness={0.85} roughness={0.2} />
        </mesh>
      ))}
    </group>
  );
}

// ── Floor Drain ─────────────────────────────────────────────────

/**
 * Floor drain — 6" square grate over a 4" body. Real dimensions:
 *   Grate: 5.5"–6" across with drainage slot pattern
 *   Body: 3-4" tall cast iron or PVC cup below slab
 *   Raised grate edge: 3/16" above floor for cleaning debris
 */
function FloorDrainModel({ position, params }: { position: [number, number, number]; params?: Record<string, unknown> }) {
  const sizeIn = Number(params?.size ?? 2);
  const grateWidth = Math.max(5.5, sizeIn * 2.2) / 12;  // 5.5-8" square
  const bodyDepth = Math.max(3, sizeIn * 1.5) / 12;     // 3-4" tall
  const raise = 0.015; // 3/16" raised edge

  return (
    <group position={position}>
      {/* Body cup (below slab — mostly hidden but visible in cut-view) */}
      <mesh position={[0, -bodyDepth / 2, 0]}>
        <cylinderGeometry args={[grateWidth * 0.45, grateWidth * 0.5, bodyDepth, 20]} />
        <meshStandardMaterial color="#3a3c40" metalness={0.5} roughness={0.7} />
      </mesh>

      {/* Slab flange (sits flush with floor) */}
      <mesh position={[0, 0.005, 0]}>
        <boxGeometry args={[grateWidth + 0.08, 0.01, grateWidth + 0.08]} />
        <meshStandardMaterial color="#707076" metalness={0.75} roughness={0.28} />
      </mesh>

      {/* Grate rim */}
      <mesh position={[0, raise / 2 + 0.005, 0]}>
        <boxGeometry args={[grateWidth, raise, grateWidth]} />
        <meshStandardMaterial color="#c0c4ca" metalness={0.82} roughness={0.18} />
      </mesh>

      {/* Slotted grate pattern — radial slots */}
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i / 8) * Math.PI * 2;
        return (
          <mesh
            key={i}
            position={[Math.cos(angle) * grateWidth * 0.22, raise + 0.008, Math.sin(angle) * grateWidth * 0.22]}
            rotation-y={angle}
          >
            <boxGeometry args={[grateWidth * 0.35, 0.005, 0.012]} />
            <meshStandardMaterial color="#2a2a30" />
          </mesh>
        );
      })}
      {/* Center ring */}
      <mesh position={[0, raise + 0.01, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[grateWidth * 0.1, grateWidth * 0.18, 20]} />
        <meshStandardMaterial color="#2a2a30" side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ── Urinal ───────────────────────────────────────────────────────

/**
 * Wall-hung urinal — real commercial dimensions:
 *   14" W × 14" projection × 24" tall
 *   Mount height: 21-24" to lip (17" for child ADA)
 *   Flushometer valve above: 12" tall, chrome, 1" pipe
 */
function UrinalModel({ position, params }: { position: [number, number, number]; params?: Record<string, unknown> }) {
  const ada = params?.ada === true;
  const waterless = params?.waterless === true;

  const lipHeight = ada ? 17 / 12 : 24 / 12;
  const urinalH = 24 / 12;     // 24" tall body
  const urinalW = 14 / 12;     // 14" wide
  const urinalD = 14 / 12;     // 14" projection from wall

  const porcelain = { color: FIXTURE_COLOR, metalness: 0.15, roughness: 0.18 };
  const chrome = { color: '#c0c4ca', metalness: 0.92, roughness: 0.1 };

  return (
    <group position={position}>
      {/* Urinal body — rounded rectangle shape */}
      <mesh position={[0, lipHeight + urinalH * 0.3, urinalD * 0.35]} castShadow receiveShadow>
        <boxGeometry args={[urinalW, urinalH * 0.6, urinalD * 0.4]} />
        <meshStandardMaterial {...porcelain} />
      </mesh>

      {/* Lower basin curve — larger depth at bottom */}
      <mesh position={[0, lipHeight, urinalD * 0.35]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[urinalW * 0.45, urinalW * 0.45, urinalD * 0.5, 24, 1, false, 0, Math.PI]} />
        <meshStandardMaterial {...porcelain} />
      </mesh>

      {/* Interior catch bowl (darker) */}
      <mesh position={[0, lipHeight + 0.05, urinalD * 0.2]} rotation-x={Math.PI / 4}>
        <sphereGeometry args={[urinalW * 0.4, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#d4cfc0" metalness={0.2} roughness={0.2} />
      </mesh>

      {/* Lip/rim around front top */}
      <mesh position={[0, lipHeight + urinalH * 0.6, urinalD * 0.15]}>
        <boxGeometry args={[urinalW * 1.05, 0.04, urinalD * 0.3]} />
        <meshStandardMaterial {...porcelain} />
      </mesh>

      {!waterless && (
        <>
          {/* Flushometer valve above urinal */}
          <mesh position={[0, lipHeight + urinalH * 0.9, 0]}>
            <cylinderGeometry args={[0.035, 0.035, 0.8, 14]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
          {/* Valve body */}
          <mesh position={[0, lipHeight + urinalH * 1.1, 0.06]}>
            <boxGeometry args={[0.14, 0.18, 0.1]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
          {/* Handle */}
          <mesh position={[0.1, lipHeight + urinalH * 1.08, 0.11]} rotation-z={-Math.PI / 8}>
            <cylinderGeometry args={[0.015, 0.015, 0.1, 10]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
        </>
      )}

      {/* Drain at bottom rear (hidden inside basin) */}
      <mesh position={[0, lipHeight - 0.1, urinalD * 0.1]} rotation-x={-Math.PI / 2}>
        <circleGeometry args={[0.035, 16]} />
        <meshStandardMaterial color="#6a6a6a" metalness={0.8} roughness={0.25} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

// ── Laundry Standpipe ───────────────────────────────────────────

/**
 * Laundry standpipe + wash-box: 2" standpipe rising from floor, 18-42"
 * tall. Washing-machine supply+drain box: 14×14 recessed wall box.
 */
function LaundryModel({ position, params }: { position: [number, number, number]; params?: Record<string, unknown> }) {
  const standpipeH = Number(params?.standpipeHeight ?? 30) / 12;
  const pan = params?.pan === true;
  const panW = 30 / 12;
  const panD = 30 / 12;
  const panDepth = 2.5 / 12;
  const boxY = standpipeH + 0.2;

  const pvc = { color: '#e8e4d9', metalness: 0.05, roughness: 0.5 };
  const boxMat = { color: '#cfcfd3', metalness: 0.3, roughness: 0.4 };

  return (
    <group position={position}>
      {/* Catch pan (optional, under washer) */}
      {pan && (
        <mesh position={[0, panDepth / 2, 0]}>
          <boxGeometry args={[panW, panDepth, panD]} />
          <meshStandardMaterial color="#a0a4a8" metalness={0.15} roughness={0.5} />
        </mesh>
      )}

      {/* 2" PVC standpipe */}
      <mesh position={[0.4, standpipeH / 2, -panD / 2 + 0.1]}>
        <cylinderGeometry args={[2 / 24, 2 / 24, standpipeH, 16]} />
        <meshStandardMaterial {...pvc} />
      </mesh>

      {/* P-trap under floor (partially visible) */}
      <mesh position={[0.4, 0.05, -panD / 2 + 0.1]} rotation-z={Math.PI / 2}>
        <torusGeometry args={[0.1, 2 / 24, 12, 20, Math.PI]} />
        <meshStandardMaterial {...pvc} />
      </mesh>

      {/* Supply + drain wash-box on wall */}
      <mesh position={[0, boxY, -panD / 2 + 0.02]}>
        <boxGeometry args={[14 / 12, 14 / 12, 0.06]} />
        <meshStandardMaterial {...boxMat} />
      </mesh>

      {/* Hot + cold shut-off valves (with red/blue knobs) */}
      {[['#d32f2f', -0.18], ['#1976d2', 0.18]].map(([color, xOff], i) => (
        <group key={i} position={[xOff as number, boxY, -panD / 2 + 0.08]}>
          <mesh rotation-x={Math.PI / 2}>
            <cylinderGeometry args={[0.04, 0.04, 0.06, 14]} />
            <meshStandardMaterial color="#c0c4ca" metalness={0.85} roughness={0.2} />
          </mesh>
          <mesh position={[0, 0, 0.05]}>
            <cylinderGeometry args={[0.035, 0.04, 0.04, 14]} />
            <meshStandardMaterial color={color as string} metalness={0.3} roughness={0.3} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ── Hose Bibb ───────────────────────────────────────────────────

/**
 * Hose bibb — exterior wall spigot. Real dimensions:
 *   Stem length 4-18" (frost-free has longer stem through wall)
 *   Outlet: 3/4" GHT (garden hose thread)
 *   Handle: 4" lever or T-handle
 *   Mounts at 18-24" above finished grade
 */
function HoseBibbModel({ position, params }: { position: [number, number, number]; params?: Record<string, unknown> }) {
  const frostFree = params?.frostFree === true;
  const stemLen = (Number(params?.length ?? 8)) / 12;  // inches → ft
  const mountH = 1.5;  // 18"

  const brass = { color: '#c8a060', metalness: 0.82, roughness: 0.3 };
  const handle = { color: '#1a3c68', metalness: 0.15, roughness: 0.6 }; // blue cast handle

  return (
    <group position={position}>
      {/* Stem cylinder through wall (if frost-free, stem is visible coming OUT toward us) */}
      {frostFree && (
        <mesh position={[0, mountH, stemLen * 0.5]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.04, 0.04, stemLen, 14]} />
          <meshStandardMaterial {...brass} />
        </mesh>
      )}

      {/* Body/valve cube */}
      <mesh position={[0, mountH, 0.06]}>
        <boxGeometry args={[0.14, 0.16, 0.12]} />
        <meshStandardMaterial {...brass} />
      </mesh>

      {/* Vacuum breaker (if enabled) — bulky top piece */}
      {Boolean(params?.vacuumBreaker) && (
        <mesh position={[0, mountH + 0.12, 0.06]}>
          <cylinderGeometry args={[0.035, 0.035, 0.08, 14]} />
          <meshStandardMaterial {...brass} />
        </mesh>
      )}

      {/* Hose outlet threads (pointing outward) */}
      <mesh position={[0, mountH - 0.05, 0.18]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.04, 0.04, 0.08, 14]} />
        <meshStandardMaterial {...brass} />
      </mesh>
      {/* Thread grooves ring */}
      <mesh position={[0, mountH - 0.05, 0.22]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[0.045, 0.045, 0.03, 14]} />
        <meshStandardMaterial color="#8a6a3a" metalness={0.7} roughness={0.4} />
      </mesh>

      {/* Handle — 4-arm T or lever */}
      <group position={[0, mountH + 0.14, 0.06]}>
        {/* Hub */}
        <mesh>
          <cylinderGeometry args={[0.02, 0.025, 0.04, 12]} />
          <meshStandardMaterial {...brass} />
        </mesh>
        {/* Cross-arms (wheel handle) */}
        <mesh position={[0, 0.02, 0]}>
          <boxGeometry args={[0.16, 0.015, 0.03]} />
          <meshStandardMaterial {...handle} />
        </mesh>
        <mesh position={[0, 0.02, 0]}>
          <boxGeometry args={[0.03, 0.015, 0.16]} />
          <meshStandardMaterial {...handle} />
        </mesh>
      </group>
    </group>
  );
}

// ── Drinking Fountain ───────────────────────────────────────────

/**
 * Drinking fountain — ADA compliant wall-mount:
 *   Spout height: 36" (standard), 28" (ADA child)
 *   Basin: 13" × 16" stainless, 6" deep
 *   Bubbler: chrome nozzle at center
 *   Push bar: on the front face
 */
function DrinkingFountainModel({ position, params }: { position: [number, number, number]; params?: Record<string, unknown> }) {
  const ada = params?.ada === true;
  const chilled = params?.chilled === true;
  const bottleFiller = params?.bottleFiller === true;

  const basinH = ada ? 28 / 12 : 36 / 12;
  const basinW = 16 / 12;
  const basinD = 13 / 12;

  const stainless = { color: '#b8bec4', metalness: 0.82, roughness: 0.22 };
  const chrome = { color: '#c0c4ca', metalness: 0.92, roughness: 0.1 };

  return (
    <group position={position}>
      {/* Stainless rectangular basin */}
      <mesh position={[0, basinH, basinD / 2 - 0.1]} castShadow receiveShadow>
        <boxGeometry args={[basinW, 0.1, basinD * 0.8]} />
        <meshStandardMaterial {...stainless} />
      </mesh>

      {/* Inner basin cavity (darker recess) */}
      <mesh position={[0, basinH + 0.03, basinD / 2 - 0.1]}>
        <boxGeometry args={[basinW - 0.05, 0.07, basinD * 0.7]} />
        <meshStandardMaterial color="#60686f" metalness={0.6} roughness={0.4} />
      </mesh>

      {/* Back panel (against wall) */}
      <mesh position={[0, basinH + 0.3, 0]}>
        <boxGeometry args={[basinW, 0.6, 0.05]} />
        <meshStandardMaterial {...stainless} />
      </mesh>

      {/* Bubbler — chrome nozzle at back of basin */}
      <mesh position={[0, basinH + 0.08, basinD / 2 - 0.15]}>
        <cylinderGeometry args={[0.018, 0.022, 0.05, 14]} />
        <meshStandardMaterial {...chrome} />
      </mesh>
      {/* Bubbler arch */}
      <mesh position={[0, basinH + 0.1, basinD / 2 - 0.12]} rotation-x={-Math.PI / 4}>
        <torusGeometry args={[0.015, 0.005, 8, 12, Math.PI / 2]} />
        <meshStandardMaterial {...chrome} />
      </mesh>

      {/* Push bar — front face of basin */}
      <mesh position={[0, basinH - 0.02, basinD - 0.12]}>
        <boxGeometry args={[basinW * 0.7, 0.03, 0.04]} />
        <meshStandardMaterial {...chrome} />
      </mesh>

      {/* Bottle filler sensor (recessed in back panel, above basin) */}
      {bottleFiller && (
        <group position={[0, basinH + 0.4, 0.06]}>
          <mesh>
            <boxGeometry args={[0.25, 0.3, 0.04]} />
            <meshStandardMaterial {...stainless} />
          </mesh>
          {/* Dispenser spout */}
          <mesh position={[0, -0.1, 0.02]} rotation-x={Math.PI}>
            <cylinderGeometry args={[0.02, 0.025, 0.04, 12]} />
            <meshStandardMaterial {...chrome} />
          </mesh>
          {/* Sensor window */}
          <mesh position={[0, 0.04, 0.025]}>
            <boxGeometry args={[0.05, 0.05, 0.005]} />
            <meshStandardMaterial color="#1a2a4a" metalness={0.3} roughness={0.15} emissive="#003366" emissiveIntensity={0.25} />
          </mesh>
        </group>
      )}

      {/* ADA / chilled badge on lower panel */}
      {chilled && (
        <mesh position={[basinW / 2 - 0.1, basinH + 0.05, basinD + 0.01]}>
          <boxGeometry args={[0.03, 0.03, 0.008]} />
          <meshStandardMaterial color="#00acc1" metalness={0.6} roughness={0.3} emissive="#006064" emissiveIntensity={0.15} />
        </mesh>
      )}

      {/* Wall mount apron (below basin) */}
      <mesh position={[0, basinH - 0.25, basinD / 2 - 0.2]}>
        <boxGeometry args={[basinW * 0.8, 0.3, 0.3]} />
        <meshStandardMaterial {...stainless} />
      </mesh>
    </group>
  );
}

// ── Appliances ───────────────────────────────────────────────────

/**
 * Dishwasher — 24" × 24" × 34" under-counter. Door on front.
 */
function DishwasherModel({ position, params }: { position: [number, number, number]; params?: Record<string, unknown> }) {
  const stainless = { color: '#b8bec4', metalness: 0.82, roughness: 0.22 };
  const W = 24 / 12, D = 24 / 12, H = 34 / 12;
  const powerMode = String(params?.powerMode ?? '120V');
  return (
    <group position={position}>
      {/* Body */}
      <mesh position={[0, H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} />
        <meshStandardMaterial {...stainless} />
      </mesh>
      {/* Door recess (front face) */}
      <mesh position={[0, H * 0.45, D / 2 + 0.005]}>
        <boxGeometry args={[W - 0.1, H * 0.85, 0.015]} />
        <meshStandardMaterial color="#60686f" metalness={0.7} roughness={0.3} />
      </mesh>
      {/* Handle */}
      <mesh position={[0, H * 0.82, D / 2 + 0.03]}>
        <boxGeometry args={[W * 0.8, 0.04, 0.06]} />
        <meshStandardMaterial color="#8a8e93" metalness={0.85} roughness={0.2} />
      </mesh>
      {/* Control panel (on top edge) */}
      <mesh position={[0, H * 0.96, D / 2 - 0.02]}>
        <boxGeometry args={[W - 0.05, 0.06, 0.04]} />
        <meshStandardMaterial color="#1a1c20" metalness={0.3} roughness={0.2} />
      </mesh>
      {/* Status LED */}
      <mesh position={[W * 0.3, H * 0.96, D / 2 + 0.001]}>
        <boxGeometry args={[0.02, 0.02, 0.002]} />
        <meshStandardMaterial color={powerMode === '120V' ? '#4caf50' : '#2196f3'} emissive={powerMode === '120V' ? '#4caf50' : '#2196f3'} emissiveIntensity={0.8} />
      </mesh>
    </group>
  );
}

/**
 * Clothes washer — 27" × 27" × 38-44" (top-load) or 24" × 27" × 38" (front-load).
 */
function ClothesWasherModel({ position }: { position: [number, number, number]; params?: Record<string, unknown> }) {
  const white = { color: '#ececec', metalness: 0.12, roughness: 0.32 };
  const glass = { color: '#202628', metalness: 0.2, roughness: 0.1, transparent: true, opacity: 0.6 };
  const W = 27 / 12, D = 27 / 12, H = 38 / 12;
  return (
    <group position={position}>
      {/* Body */}
      <mesh position={[0, H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[W, H, D]} />
        <meshStandardMaterial {...white} />
      </mesh>
      {/* Front-load door (circular glass) */}
      <mesh position={[0, H * 0.5, D / 2 + 0.01]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[H * 0.28, H * 0.28, 0.04, 28]} />
        <meshStandardMaterial color="#8a8e93" metalness={0.85} roughness={0.2} />
      </mesh>
      <mesh position={[0, H * 0.5, D / 2 + 0.035]} rotation-x={Math.PI / 2}>
        <cylinderGeometry args={[H * 0.24, H * 0.24, 0.005, 28]} />
        <meshStandardMaterial {...glass} />
      </mesh>
      {/* Control panel on top */}
      <mesh position={[0, H * 0.95, D * 0.15]}>
        <boxGeometry args={[W - 0.08, 0.08, D * 0.25]} />
        <meshStandardMaterial color="#cfcfd3" metalness={0.3} roughness={0.3} />
      </mesh>
      {/* Dial knob */}
      <mesh position={[W * 0.25, H * 0.97, D * 0.15]}>
        <cylinderGeometry args={[0.05, 0.05, 0.04, 20]} />
        <meshStandardMaterial color="#8a8e93" metalness={0.8} roughness={0.22} />
      </mesh>
    </group>
  );
}

// ── Generic fallback ────────────────────────────────────────────

function GenericFixtureModel({ position }: { position: [number, number, number]; params?: Record<string, unknown> }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[0.3, 0.3, 0.3]} />
        <meshStandardMaterial color={FIXTURE_ACCENT} metalness={0.1} roughness={0.5} transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

// ── Model selector ──────────────────────────────────────────────

type ModelFC = React.FC<{ position: [number, number, number]; params?: Record<string, unknown> }>;

const MODEL_MAP: Partial<Record<FixtureSubtype, ModelFC>> = {
  water_closet:      ToiletModel,
  lavatory:          LavatoryModel,
  kitchen_sink:      KitchenSinkModel,
  shower:            ShowerModel,
  bathtub:           BathtubModel,
  floor_drain:       FloorDrainModel,
  urinal:            UrinalModel,
  laundry_standpipe: LaundryModel,
  hose_bibb:         HoseBibbModel,
  drinking_fountain: DrinkingFountainModel,
  dishwasher:        DishwasherModel,
  clothes_washer:    ClothesWasherModel,
  mop_sink:          KitchenSinkModel,  // kitchen-sink geometry works OK for mop sinks
};

// ── Public fixture component ────────────────────────────────────

interface FixtureProps {
  position: [number, number, number];
  subtype: FixtureSubtype;
  showGlow?: boolean;
  params?: Record<string, unknown>;
}

export function FixtureModel({ position, subtype, showGlow = true, params }: FixtureProps) {
  const { state } = useFSM(userFSM);
  const Model = MODEL_MAP[subtype] ?? GenericFixtureModel;

  return (
    <group>
      <Model position={position} params={params} />
      {showGlow && (
        <GlowRing position={position} active={state === 'idle'} color="#00e5ff" />
      )}
    </group>
  );
}

// ── Fixture layer (renders all placed fixtures) ─────────────────

interface FixtureLayerProps {
  fixtures: { position: [number, number, number]; subtype: FixtureSubtype }[];
}

export function FixtureLayer({ fixtures }: FixtureLayerProps) {
  const fixturesVisible = useLayerStore((s) => s.fixtures);
  const getFloorParams = useFloorParams();

  if (!fixturesVisible) return null;

  return (
    <group>
      {fixtures.map((f, i) => {
        const y = f.position[1];
        const fp = getFloorParams(y, y);
        if (!fp.visible) return null;
        const dim = fp.opacity < 1;
        return (
          <group key={i} visible userData={{ floorOpacity: fp.opacity, floorGhost: dim }}>
            <FixtureModel position={f.position} subtype={f.subtype} showGlow={!dim} />
            {dim && (
              <mesh position={[f.position[0], f.position[1] + 0.5, f.position[2]]}>
                <sphereGeometry args={[0.8, 12, 12]} />
                <meshBasicMaterial
                  color="#1a1f26"
                  transparent
                  opacity={1 - fp.opacity * 0.9}
                  depthWrite={false}
                />
              </mesh>
            )}
          </group>
        );
      })}
    </group>
  );
}

// ── Store-driven fixture layer with click-to-select ─────────────

/**
 * Phase 2.B — renders fixtures from fixtureStore and handles clicks.
 * Click a fixture → selectFixture(id), which opens FixtureParamWindow.
 */
export function FixtureLayerFromStore() {
  const fixtureMap = useFixtureStore((s) => s.fixtures);
  const selectedId = useFixtureStore((s) => s.selectedFixtureId);
  const selectFixture = useFixtureStore((s) => s.selectFixture);
  const fixturesVisible = useLayerStore((s) => s.fixtures);
  const getFloorParams = useFloorParams();
  const phaseFilter = usePhaseFilter();

  if (!fixturesVisible) return null;

  const list = Object.values(fixtureMap);
  if (list.length === 0) return null;

  return (
    <group>
      {list.map((fx) => {
        const y = fx.position[1];
        const fp = getFloorParams(y, y);
        if (!fp.visible) return null;
        const autoPhase = classifyFixture(fx);
        const effectivePhase = phaseFilter.fixtureOverride(fx.id) ?? autoPhase;
        if (!shouldPhaseRender(effectivePhase, phaseFilter.activePhase, phaseFilter.mode)) return null;
        const dim = fp.opacity < 1;
        const selected = fx.id === selectedId;
        const phaseColor = PHASE_META[effectivePhase].color;
        return (
          <FixtureWithSelection
            key={fx.id}
            fixture={fx}
            dim={dim}
            ghostOpacity={fp.opacity}
            interactive={!fp.disableInteraction}
            selected={selected}
            phaseColor={phaseColor}
            selectFixture={selectFixture}
          />
        );
      })}
    </group>
  );
}

interface FixtureWithSelectionProps {
  fixture: FixtureInstance;
  dim: boolean;
  ghostOpacity: number;
  interactive: boolean;
  selected: boolean;
  phaseColor?: string;
  selectFixture: (id: string) => void;
}

function FixtureWithSelection({
  fixture, dim, ghostOpacity, interactive, selected, phaseColor, selectFixture,
}: FixtureWithSelectionProps) {
  const rotDeg = (fixture.params.rotationDeg as number | undefined) ?? 0;
  // Stable rotation tuple — avoids R3F resetting rotation every render.
  const rotation = useMemo<[number, number, number]>(
    () => [0, (rotDeg * Math.PI) / 180, 0],
    [rotDeg],
  );
  // Stable click handler — recomputed only when id changes.
  const handleClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!interactive) return;
      e.stopPropagation();
      selectFixture(fixture.id);
    },
    [interactive, selectFixture, fixture.id],
  );

  return (
    <group position={fixture.position} rotation={rotation}>
      {/* Fixture geometry (re-centered at group origin) */}
      <FixtureModel position={[0, 0, 0]} subtype={fixture.subtype} showGlow={!dim} params={fixture.params} />

      {/* Click hitbox — invisible BOX sized to the real fixture footprint.
          Previously a small sphere at y=0.4 couldn't hit a toilet's tank
          or a tub's far end. A box covering the full footprint lets you
          click ANYWHERE on the fixture to open its settings. */}
      <FixtureHitbox fixture={fixture} onClick={handleClick} />

      {/* Ghost overlay when off-floor */}
      {dim && (
        <mesh position={[0, 0.5, 0]} raycast={() => null}>
          <sphereGeometry args={[0.8, 12, 12]} />
          <meshBasicMaterial
            color="#1a1f26"
            transparent
            opacity={1 - ghostOpacity * 0.9}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* Phase-colored halo (under selection halo) */}
      {phaseColor && !dim && <PhaseHalo color={phaseColor} />}

      {/* Selection halo */}
      {selected && <SelectionHalo />}
    </group>
  );
}

/**
 * FixtureHitbox — invisible click-target sized to the fixture's real
 * footprint. Ensures you can click anywhere on the fixture body to
 * open settings, not just a tiny sphere near its center.
 *
 * Mode-aware: in Draw mode the hitbox goes INERT (no raycast) so that
 * a pipe-draw click near a fixture lands on the ground plane instead
 * of double-firing a fixture-select. Without this, the native canvas
 * click listener AND the R3F hit handler would both fire for a single
 * click — dropping a pipe vertex AND opening the settings window.
 */
function FixtureHitbox({
  fixture, onClick,
}: {
  fixture: FixtureInstance;
  onClick: (e: ThreeEvent<MouseEvent>) => void;
}) {
  const mode = useInteractionStore((s) => s.mode);
  const drawActive = mode === 'draw';

  // Use the connection-point geometry helper to get the real footprint.
  // Import is local so PhaseHalo stays at the top of the ordering.
  const geom = useMemo(
    () => getFixtureGeometry(fixture.subtype, fixture.params),
    [fixture.subtype, fixture.params],
  );
  const { width, depth, height } = geom.footprint;

  const handlePointerDown = drawActive ? undefined : (e: ThreeEvent<MouseEvent>) => {
    // Belt-and-suspenders: R3F stopPropagation halts the R3F chain, and
    // stopImmediatePropagation on the native event prevents the canvas-
    // level click listener in DrawInteraction from also firing if a user
    // switches modes mid-gesture.
    e.nativeEvent?.stopImmediatePropagation?.();
    onClick(e);
  };

  return (
    <mesh
      position={[0, height / 2, 0]}
      onPointerDown={handlePointerDown}
      // Skip raycast entirely in Draw mode — the whole fixture becomes
      // click-transparent so pipes can be drawn right through it.
      raycast={drawActive ? () => null : undefined}
    >
      <boxGeometry args={[width, height, depth]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function PhaseHalo({ color }: { color: string }) {
  // Static ring at floor level, phase-colored
  return (
    <mesh position={[0, 0.015, 0]} rotation-x={-Math.PI / 2} raycast={() => null}>
      <ringGeometry args={[0.55, 0.62, 32]} />
      <meshBasicMaterial color={color} transparent opacity={0.35} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

function SelectionHalo() {
  const meshRef = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;
    const s = 1 + 0.08 * Math.sin(t * 4);
    meshRef.current.scale.setScalar(s);
    (meshRef.current.material as THREE.MeshBasicMaterial).opacity =
      0.5 + 0.3 * Math.sin(t * 4 + Math.PI / 2);
  });
  return (
    <mesh ref={meshRef} position={[0, 0.02, 0]} rotation-x={-Math.PI / 2} raycast={() => null}>
      <ringGeometry args={[0.7, 0.95, 48]} />
      <meshBasicMaterial color="#ffd54f" transparent opacity={0.7} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}
