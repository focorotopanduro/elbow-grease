/**
 * FittingMeshes — renders auto-generated fittings using InstancedMesh.
 *
 * Groups fittings by type, creates one InstancedMesh per type, and
 * updates instance matrices from FittingInstance data. This handles
 * ~2000 fittings in ~12 draw calls (3 types × 4 diameter buckets).
 *
 * Fitting geometry:
 *   Elbow 90°  → quarter-torus (smooth bend)
 *   Elbow 45°  → eighth-torus
 *   Tee        → cylinder + perpendicular stub
 *   Reducer    → truncated cone
 */

import { useMemo, useEffect, useRef } from 'react';
import * as THREE from 'three';
import { usePipeStore } from '@store/pipeStore';
import { useLayerStore } from '@store/layerStore';
import { useFloorParams } from '@store/floorStore';
import { usePhaseFilter } from '@store/phaseStore';
import { shouldPhaseRender } from '@core/phases/PhaseTypes';
import { classifyPipe } from '@core/phases/PhaseClassifier';
import {
  generateJunctionFittings,
  type FittingInstance,
} from './FittingGenerator';
import { getFittingCache } from '@core/pipe/fittingCache';
import { mergePexRuns } from '@core/pipe/mergePexRuns';
import { getPipeMaterial } from './PipeMaterial';
import { getOuterDiameterFt, getOuterRadiusFt } from '@core/pipe/PipeSizeSpec';
import {
  getHubOuterRadiusFt,
  getSocketDepthFt,
  getBendCenterlineRadiusFt,
  getPortOffsetFt,
  P_TRAP_SEAL_DEPTH_IN,
} from '@core/pipe/PipeStandards';
import type { PipeMaterial } from '../../engine/graph/GraphEdge';

// ── Geometry-segment tuning ─────────────────────────────────────

// Smoother = higher numbers. All curved surfaces go through these
// constants so we can retune fidelity in one place. Each geometry is
// cached, so segment count only affects initial build + GPU memory —
// not per-frame perf.
const CYL_SEGS = 24;            // cylinder radial facets
const CYL_SEGS_TINY = 10;       // small cosmetic bumps (bolts, grooves)
const HEX_SEGS = 6;             // deliberately faceted hex nut
const TORUS_TUBE_SEGS = 14;     // tube-wall roundness for toruses
const TORUS_ARC_PER_RAD = 28;   // arc segments per radian (full circle = 88)

function arcSegs(angleRad: number): number {
  return Math.max(8, Math.round(TORUS_ARC_PER_RAD * angleRad));
}

// ── Geometry builders (created once, reused across instances) ───

const geoCache = new Map<string, THREE.BufferGeometry>();

/**
 * Builds a math-correct torus-arc bend with hub shoulders at each end.
 *
 *   - Torus major radius = centerline bend radius (per PipeStandards)
 *   - Torus minor radius = pipe OD / 2
 *   - Hub shoulders: short flared cylinders at each end, radius =
 *     hub OD / 2, length = socket depth
 */
/**
 * Build a hub-shoulder cylinder plus its **material-specific decoration**.
 * The decoration is the visual signature that makes each material's
 * fittings recognizable at a glance:
 *
 *   Cast iron no-hub     — stainless band clamp at the joint face with
 *                          2 visible bolt bumps
 *   Copper (L/M)         — dark solder bead ring where the sweat joint
 *                          would be
 *   Galvanized steel     — 3 thread-groove rings
 *   PEX (Uponor ProPEX)  — stainless crimp ring (the compressed sleeve
 *                          that seals the expanded pipe)
 *   PVC / CPVC / ABS     — narrow primer-purple tint ring at the
 *                          cement line
 *
 * Returns a single merged BufferGeometry so callers can treat it as
 * one unit. All sub-pieces are oriented and positioned so the hub's
 * OUTER end is at `center` and the decoration sits exactly where the
 * real joint feature would be on a physical fitting.
 */
function buildHubShoulder(
  material: PipeMaterial,
  diameter: number,
  center: THREE.Vector3,
  axis: THREE.Vector3,
): THREE.BufferGeometry {
  const pipeOdFt = getOuterDiameterFt(material, diameter);
  const pipeR = pipeOdFt / 2;
  const hubR = getHubOuterRadiusFt(material, pipeOdFt);
  const socket = getSocketDepthFt(material, diameter);

  const dir = axis.clone().normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(up, dir);

  const parts: THREE.BufferGeometry[] = [];

  // Base hub — the flared socket
  const hub = new THREE.CylinderGeometry(hubR, hubR, socket, CYL_SEGS);
  const hubPos = center.clone().add(dir.clone().multiplyScalar(-socket / 2));
  hub.applyMatrix4(new THREE.Matrix4().compose(hubPos, q, new THREE.Vector3(1, 1, 1)));
  parts.push(hub);

  // Material-specific decoration, placed at the joint face (outer end
  // of the hub, where pipe meets fitting).
  const decoBase = center.clone();

  switch (material) {
    case 'pex': {
      // Stainless crimp ring just inside the hub face
      const crimpW = pipeR * 0.20;
      const crimpR = hubR * 1.04;
      const ring = new THREE.CylinderGeometry(crimpR, crimpR, crimpW, CYL_SEGS);
      const ringPos = decoBase.clone().add(dir.clone().multiplyScalar(-crimpW * 0.5 - socket * 0.15));
      ring.applyMatrix4(new THREE.Matrix4().compose(ringPos, q, new THREE.Vector3(1, 1, 1)));
      parts.push(ring);
      break;
    }
    case 'copper_type_l':
    case 'copper_type_m': {
      // Solder bead — thin slightly-larger ring right at the joint face
      const beadW = pipeR * 0.10;
      const beadR = hubR * 1.06;
      const bead = new THREE.CylinderGeometry(beadR, beadR, beadW, CYL_SEGS);
      const beadPos = decoBase.clone().add(dir.clone().multiplyScalar(-beadW * 0.5));
      bead.applyMatrix4(new THREE.Matrix4().compose(beadPos, q, new THREE.Vector3(1, 1, 1)));
      parts.push(bead);
      break;
    }
    case 'cast_iron':
    case 'ductile_iron': {
      // No-hub band clamp — wider ring with two small bolt-like bumps
      const bandW = pipeR * 0.55;
      const bandR = hubR * 1.08;
      const band = new THREE.CylinderGeometry(bandR, bandR, bandW, CYL_SEGS);
      const bandPos = decoBase.clone().add(dir.clone().multiplyScalar(-bandW * 0.5));
      band.applyMatrix4(new THREE.Matrix4().compose(bandPos, q, new THREE.Vector3(1, 1, 1)));
      parts.push(band);
      // Two bolt bumps at the top of the band clamp
      for (let i = 0; i < 2; i++) {
        const bolt = new THREE.CylinderGeometry(pipeR * 0.18, pipeR * 0.18, pipeR * 0.3, CYL_SEGS_TINY);
        // Bumps perpendicular to axis — along an arbitrary perpendicular
        const perp = Math.abs(dir.y) < 0.9
          ? new THREE.Vector3(0, 1, 0).cross(dir).normalize()
          : new THREE.Vector3(1, 0, 0).cross(dir).normalize();
        const angle = i === 0 ? 0.4 : -0.4;
        const offset = perp.clone().applyAxisAngle(dir, angle).multiplyScalar(bandR);
        const boltPos = bandPos.clone().add(offset);
        const boltQ = new THREE.Quaternion().setFromUnitVectors(up, perp);
        bolt.applyMatrix4(new THREE.Matrix4().compose(boltPos, boltQ, new THREE.Vector3(1, 1, 1)));
        parts.push(bolt);
      }
      break;
    }
    case 'galvanized_steel': {
      // 3 thread-groove rings at progressively deeper axial positions
      for (let i = 0; i < 3; i++) {
        const grW = pipeR * 0.06;
        const grR = hubR * 0.995;
        const groove = new THREE.CylinderGeometry(grR, grR, grW, CYL_SEGS);
        const grPos = decoBase.clone().add(dir.clone().multiplyScalar(-grW * 1.5 - i * pipeR * 0.25));
        groove.applyMatrix4(new THREE.Matrix4().compose(grPos, q, new THREE.Vector3(1, 1, 1)));
        parts.push(groove);
      }
      break;
    }
    case 'pvc_sch40':
    case 'pvc_sch80':
    case 'cpvc':
    case 'abs': {
      // Thin primer ring at the cement line (just a subtle visual hint
      // at the exact joint plane)
      const primerW = pipeR * 0.05;
      const primerR = hubR * 1.01;
      const primer = new THREE.CylinderGeometry(primerR, primerR, primerW, CYL_SEGS);
      const primerPos = decoBase.clone().add(dir.clone().multiplyScalar(-primerW * 0.5));
      primer.applyMatrix4(new THREE.Matrix4().compose(primerPos, q, new THREE.Vector3(1, 1, 1)));
      parts.push(primer);
      break;
    }
  }

  return mergeGeometries(parts);
}

/**
 * Build a thin stop-ring inside a fitting body at a given position.
 * Real fittings (couplings, reducers) have an internal lip that stops
 * pipes at the socket depth. A subtly-darker ring makes this visible.
 */
function buildStopRing(
  pipeR: number,
  hubR: number,
  center: THREE.Vector3,
  axis: THREE.Vector3,
): THREE.BufferGeometry {
  const ringThickness = pipeR * 0.08;
  const ring = new THREE.CylinderGeometry(pipeR * 0.92, pipeR * 0.92, ringThickness, CYL_SEGS);
  const dir = axis.clone().normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const m = new THREE.Matrix4().compose(center, q, new THREE.Vector3(1, 1, 1));
  ring.applyMatrix4(m);
  void hubR;
  return ring;
}

function buildMathBend(
  material: PipeMaterial,
  diameter: number,
  bendKind: 'short_sweep' | 'long_sweep' | 'eighth' | 'sixteenth',
  angleRad: number,
): THREE.BufferGeometry {
  const pipeOdFt = getOuterDiameterFt(material, diameter);
  const pipeR = pipeOdFt / 2;
  const bendR = getBendCenterlineRadiusFt(material, pipeOdFt, bendKind);
  const hubR = getHubOuterRadiusFt(material, pipeOdFt);
  const socketDepth = getSocketDepthFt(material, diameter);

  // Torus arc itself — centered at origin, arc spans angle `angleRad`
  const torus = new THREE.TorusGeometry(bendR, pipeR, TORUS_TUBE_SEGS, arcSegs(angleRad), angleRad);
  // THREE.TorusGeometry sweeps from 0 along XY plane; rotate so the
  // "start" end points along +X (matching our bendQuaternion basis).
  torus.rotateZ(-angleRad / 2);

  // Hub A — at start of arc (angle 0 before rotation → rotates to -angleRad/2)
  const hubA = new THREE.CylinderGeometry(hubR, hubR, socketDepth, CYL_SEGS);
  // Place at the arc's entry, oriented along the tangent
  {
    const ang = -angleRad / 2;
    const cx = Math.cos(ang) * bendR;
    const cy = Math.sin(ang) * bendR;
    const tangent = new THREE.Vector3(-Math.sin(ang), Math.cos(ang), 0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    m.compose(
      new THREE.Vector3(cx - tangent.x * socketDepth / 2, cy - tangent.y * socketDepth / 2, 0),
      q,
      new THREE.Vector3(1, 1, 1),
    );
    hubA.applyMatrix4(m);
  }

  // Hub B — at end of arc
  const hubB = new THREE.CylinderGeometry(hubR, hubR, socketDepth, CYL_SEGS);
  {
    const ang = angleRad / 2;
    const cx = Math.cos(ang) * bendR;
    const cy = Math.sin(ang) * bendR;
    const tangent = new THREE.Vector3(-Math.sin(ang), Math.cos(ang), 0);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tangent);
    m.compose(
      new THREE.Vector3(cx + tangent.x * socketDepth / 2, cy + tangent.y * socketDepth / 2, 0),
      q,
      new THREE.Vector3(1, 1, 1),
    );
    hubB.applyMatrix4(m);
  }

  return mergeGeometries([torus, hubA, hubB]);
}

// ── Exported geometry accessors ──────────────────────────────
// Phase 14.Q — LiveFittings (the pre-commit preview) reuses these
// caches to render fitting ghosts at each junction during drawing.
// Keeping one canonical geometry per {type, material, diameter}
// avoids duplicating the swept-torus build and keeps caches warm
// for when the pipe actually commits.

export function getElbow90Geo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `elbow90-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;
  geo = buildMathBend(material, diameter, 'short_sweep', Math.PI / 2);
  geoCache.set(key, geo);
  return geo;
}

/**
 * Phase 14.V — Uponor ProPEX 90° elbow geometry.
 *
 * Distinguished from the rigid `bend_90` by:
 *   • Tighter centerline radius (ProPEX elbows pull the corner
 *     closer; Uponor spec is ~1.5× OD).
 *   • Expansion-ring COLLARS at each end — slightly wider band
 *     encircling the socket, visually echoing the crimped
 *     stainless/brass ProPEX ring.
 *
 * Together those two cues read as "Uponor fitting" at a glance
 * even before the user clicks to see the fitting label.
 */
export function getPexElbow90Geo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `pexelbow90-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;
  geo = buildPexElbow90(material, diameter);
  geoCache.set(key, geo);
  return geo;
}

function buildPexElbow90(
  material: PipeMaterial,
  diameter: number,
): THREE.BufferGeometry {
  const pipeOdFt = getOuterDiameterFt(material, diameter);
  const pipeR = pipeOdFt / 2;
  // Tighter bend radius than rigid — Uponor ProPEX 90° is ~1.5× OD
  // vs. rigid short-sweep at ~1.3× OD, so still compact but shaped
  // to accommodate the expansion-ring end geometry.
  const bendR = pipeOdFt * 1.5;
  // Collar = wider than the hub, marking the expansion ring. 1.25×
  // OD gives a clearly-visible ring without dominating the fitting.
  const collarR = pipeOdFt * 0.625; // 1.25 × radius
  const hubR = pipeOdFt * 0.55;
  // Collar thickness along pipe axis
  const collarLen = pipeOdFt * 0.35;
  // Socket extending past the collar (hub body)
  const socketDepth = pipeOdFt * 1.0;
  const angleRad = Math.PI / 2;

  // Main torus — the bend itself
  const torus = new THREE.TorusGeometry(
    bendR,
    pipeR,
    TORUS_TUBE_SEGS,
    arcSegs(angleRad),
    angleRad,
  );
  torus.rotateZ(-angleRad / 2);

  // Helper to place a cylinder along the tangent at a given arc angle
  const placeAtArc = (ang: number, length: number, radius: number, outward: number): THREE.CylinderGeometry => {
    const cyl = new THREE.CylinderGeometry(radius, radius, length, CYL_SEGS);
    const cx = Math.cos(ang) * bendR;
    const cy = Math.sin(ang) * bendR;
    const tangent = new THREE.Vector3(-Math.sin(ang), Math.cos(ang), 0);
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      tangent,
    );
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(
        cx + tangent.x * outward,
        cy + tangent.y * outward,
        0,
      ),
      q,
      new THREE.Vector3(1, 1, 1),
    );
    cyl.applyMatrix4(m);
    return cyl;
  };

  // Hub A (entry) — sits just past the torus end, oriented outward
  const hubA = placeAtArc(-angleRad / 2, socketDepth, hubR, -socketDepth / 2);
  // Hub B (exit)
  const hubB = placeAtArc(angleRad / 2, socketDepth, hubR, socketDepth / 2);

  // Expansion-ring COLLARS — wider disc just outboard of each hub.
  // The `-socketDepth + collarLen / 2` offset places them at the
  // exact end of the hub (outboard side) so they read as the ring
  // that would sit around the incoming PEX tube.
  const collarA = placeAtArc(-angleRad / 2, collarLen, collarR, -socketDepth - collarLen / 2);
  const collarB = placeAtArc(angleRad / 2, collarLen, collarR, socketDepth + collarLen / 2);

  return mergeGeometries([torus, hubA, hubB, collarA, collarB]);
}

export function getElbow45Geo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `elbow45-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;
  geo = buildMathBend(material, diameter, 'eighth', Math.PI / 4);
  geoCache.set(key, geo);
  return geo;
}

export function getBend22_5Geo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `bend225-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;
  geo = buildMathBend(material, diameter, 'sixteenth', Math.PI / 8);
  geoCache.set(key, geo);
  return geo;
}

export function getBend90LongSweepGeo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `bend90ls-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;
  geo = buildMathBend(material, diameter, 'long_sweep', Math.PI / 2);
  geoCache.set(key, geo);
  return geo;
}

/**
 * P-trap — a proper U-shape built from two 90° bends + straight arm.
 * Seal depth per UPC 1002.4 minimum 2", max 4".
 */
function getPTrapGeo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `ptrap-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;

  const pipeOdFt = getOuterDiameterFt(material, diameter);
  const pipeR = pipeOdFt / 2;
  const bendR = getBendCenterlineRadiusFt(material, pipeOdFt, 'short_sweep');
  const sealFt = P_TRAP_SEAL_DEPTH_IN / 12;

  // Half-torus for the U — 180° arc
  const uBend = new THREE.TorusGeometry(bendR, pipeR, TORUS_TUBE_SEGS, arcSegs(Math.PI), Math.PI);
  // Downlet: short vertical stub into the trap
  const downletLen = sealFt + pipeR;
  const downlet = new THREE.CylinderGeometry(pipeR, pipeR, downletLen, CYL_SEGS);
  downlet.translate(-bendR, downletLen / 2, 0);
  // Trap arm: horizontal run out of the trap
  const armLen = pipeR * 6;
  const arm = new THREE.CylinderGeometry(pipeR, pipeR, armLen, CYL_SEGS);
  arm.rotateZ(Math.PI / 2);
  arm.translate(bendR + armLen / 2, 0, 0);

  geo = mergeGeometries([uBend, downlet, arm]);
  geoCache.set(key, geo);
  return geo;
}

/**
 * Closet bend — toilet-specific 90° with extended horizontal leg to
 * reach the soil stack; typically reduces 4" → 3" at the flange.
 */
function getClosetBendGeo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `closetbend-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;

  const pipeOdFt = getOuterDiameterFt(material, diameter);
  const pipeR = pipeOdFt / 2;
  const bendR = pipeR * 2.2;

  const elbow = new THREE.TorusGeometry(bendR, pipeR, TORUS_TUBE_SEGS, arcSegs(Math.PI / 2), Math.PI / 2);
  elbow.rotateZ(-Math.PI / 4);

  // Longer horizontal than short-sweep
  const hArmLen = pipeR * 8;
  const hArm = new THREE.CylinderGeometry(pipeR, pipeR, hArmLen, CYL_SEGS);
  hArm.rotateZ(Math.PI / 2);
  hArm.translate(bendR + hArmLen / 2, -bendR, 0);

  // Short vertical neck (up to flange)
  const vNeckLen = pipeR * 3;
  const vNeck = new THREE.CylinderGeometry(pipeR, pipeR, vNeckLen, CYL_SEGS);
  vNeck.translate(-bendR, bendR + vNeckLen / 2, 0);

  geo = mergeGeometries([elbow, hArm, vNeck]);
  geoCache.set(key, geo);
  return geo;
}

/**
 * Regular tee — used for supply-side branching (PEX/ProPEX, copper,
 * CPVC, galvanized). Three hubs + stop ring. The Uponor PEX tee has
 * its signature **stainless crimp ring** on each hub; we add those for
 * PEX so the fitting reads as a ProPEX tee at a glance.
 */
function getTeeStraightGeo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `tee-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;

  const pipeOd = getOuterDiameterFt(material, diameter);
  const pipeR = pipeOd / 2;
  const portOff = getPortOffsetFt(material, pipeOd);

  // Central through body (X-axis) — compact tight body like Uponor
  const bodyLen = portOff * 1.9;
  const body = new THREE.CylinderGeometry(pipeR, pipeR, bodyLen, CYL_SEGS);
  body.rotateZ(Math.PI / 2);
  // Branch (+Y) — short, clean
  const branchLen = portOff * 0.9;
  const branch = new THREE.CylinderGeometry(pipeR, pipeR, branchLen, CYL_SEGS);
  branch.translate(0, branchLen / 2, 0);

  // Three hub shoulders
  const hubA = buildHubShoulder(material, diameter, new THREE.Vector3(-bodyLen / 2, 0, 0), new THREE.Vector3(-1, 0, 0));
  const hubB = buildHubShoulder(material, diameter, new THREE.Vector3( bodyLen / 2, 0, 0), new THREE.Vector3( 1, 0, 0));
  const hubC = buildHubShoulder(material, diameter, new THREE.Vector3(0, branchLen, 0), new THREE.Vector3(0, 1, 0));

  const stop = buildStopRing(pipeR, pipeR, new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));

  // PEX crimp ring / copper solder bead / cast iron band clamp / PVC
  // primer ring / galvanized thread grooves are already included in
  // buildHubShoulder — no per-fitting special casing needed.
  const parts: THREE.BufferGeometry[] = [body, branch, hubA, hubB, hubC, stop];

  geo = mergeGeometries(parts);
  geoCache.set(key, geo);
  return geo;
}

/**
 * Sanitary tee — DWV specific. The branch curves smoothly INTO the main
 * run so waste flows downward without turbulence. Built as: straight
 * main body + 90° torus-arc branch tangent to the main, placed so the
 * branch entry is swept into the downstream direction.
 */
function getSanitaryTeeGeo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `san-tee-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;

  const pipeOd = getOuterDiameterFt(material, diameter);
  const pipeR = pipeOd / 2;
  const portOff = getPortOffsetFt(material, pipeOd);
  const bendR = getBendCenterlineRadiusFt(material, pipeOd, 'short_sweep');

  // Main through body
  const bodyLen = portOff * 2.2;
  const body = new THREE.CylinderGeometry(pipeR, pipeR, bodyLen, CYL_SEGS);
  body.rotateZ(Math.PI / 2);

  // Branch: a short upright stub
  const branchLen = portOff * 0.4;
  const upright = new THREE.CylinderGeometry(pipeR, pipeR, branchLen, CYL_SEGS);
  upright.translate(0, bendR + branchLen / 2, 0);

  // Quarter-torus connecting the branch to the main — swept in the +X
  // direction (downstream). This is the "sanitary curve".
  const sweep = new THREE.TorusGeometry(bendR, pipeR, TORUS_TUBE_SEGS, arcSegs(Math.PI / 2), Math.PI / 2);
  // Orient so the torus sits with its center above the body, arc swept
  // down-and-forward: center at (bendR, bendR, 0), arc from 90° → 180°.
  sweep.rotateZ(Math.PI);
  sweep.translate(bendR, bendR, 0);

  // Hubs
  const hubA = buildHubShoulder(material, diameter, new THREE.Vector3(-bodyLen / 2, 0, 0), new THREE.Vector3(-1, 0, 0));
  const hubB = buildHubShoulder(material, diameter, new THREE.Vector3( bodyLen / 2, 0, 0), new THREE.Vector3( 1, 0, 0));
  const hubC = buildHubShoulder(material, diameter, new THREE.Vector3(0, bendR + branchLen, 0), new THREE.Vector3(0, 1, 0));

  geo = mergeGeometries([body, upright, sweep, hubA, hubB, hubC]);
  geoCache.set(key, geo);
  return geo;
}

/**
 * Wye — 45° tangential branch off a straight main. Per ASTM D-2665
 * the branch's centerline meets the main's centerline at the fitting
 * center at a true 45°, not offset.
 */
function getWyeGeo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `wye-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;

  const pipeOd = getOuterDiameterFt(material, diameter);
  const pipeR = pipeOd / 2;
  const portOff = getPortOffsetFt(material, pipeOd) * 1.3;

  // Main through body
  const bodyLen = portOff * 2;
  const body = new THREE.CylinderGeometry(pipeR, pipeR, bodyLen, CYL_SEGS);
  body.rotateZ(Math.PI / 2);

  // Branch — cylinder rotated 45° around Z, pivoting at the fitting
  // center. Translate so its far end is at the 45° port position.
  const branchLen = portOff;
  const branch = new THREE.CylinderGeometry(pipeR, pipeR, branchLen, CYL_SEGS);
  branch.rotateZ(-Math.PI / 4); // tilt +X and +Y
  // Offset so it emerges from the main
  const bx = Math.cos(Math.PI / 4) * branchLen / 2;
  const by = Math.sin(Math.PI / 4) * branchLen / 2;
  branch.translate(bx, by, 0);

  // Hubs
  const diag = new THREE.Vector3(Math.cos(Math.PI / 4), Math.sin(Math.PI / 4), 0).normalize();
  const hubA = buildHubShoulder(material, diameter, new THREE.Vector3(-bodyLen / 2, 0, 0), new THREE.Vector3(-1, 0, 0));
  const hubB = buildHubShoulder(material, diameter, new THREE.Vector3( bodyLen / 2, 0, 0), new THREE.Vector3( 1, 0, 0));
  const hubC = buildHubShoulder(material, diameter, new THREE.Vector3(bx * 2, by * 2, 0), diag);

  geo = mergeGeometries([body, branch, hubA, hubB, hubC]);
  geoCache.set(key, geo);
  return geo;
}

/**
 * Combo wye + 1/8 bend — a wye whose branch has a 45° sweep added so
 * the branch runs PARALLEL to the main (used when connecting two
 * horizontal runs with a smooth flow path). Per Charlotte PVC fitting
 * spec: body is a standard wye with a 45° elbow fused to the branch.
 */
function getComboGeo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `combo-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;

  const pipeOd = getOuterDiameterFt(material, diameter);
  const pipeR = pipeOd / 2;
  const portOff = getPortOffsetFt(material, pipeOd) * 1.3;
  const bendR = getBendCenterlineRadiusFt(material, pipeOd, 'eighth');

  // Main body
  const bodyLen = portOff * 2;
  const body = new THREE.CylinderGeometry(pipeR, pipeR, bodyLen, CYL_SEGS);
  body.rotateZ(Math.PI / 2);

  // 45° branch (same as wye)
  const branchLen = portOff * 0.8;
  const branch = new THREE.CylinderGeometry(pipeR, pipeR, branchLen, CYL_SEGS);
  branch.rotateZ(-Math.PI / 4);
  const bx = Math.cos(Math.PI / 4) * branchLen / 2;
  const by = Math.sin(Math.PI / 4) * branchLen / 2;
  branch.translate(bx, by, 0);

  // 1/8 (45°) bend at the end of the branch, sweeping the branch back
  // to horizontal (+X direction). Torus positioned at the end of the
  // branch, arc from ¾π rotating down to π.
  const bendEndX = bx * 2;
  const bendEndY = by * 2;
  const bend = new THREE.TorusGeometry(bendR, pipeR, TORUS_TUBE_SEGS, arcSegs(Math.PI / 4), Math.PI / 4);
  bend.rotateZ(-Math.PI / 2);
  bend.translate(bendEndX + bendR * Math.cos(Math.PI / 4), bendEndY, 0);

  // Final branch stub after the bend, running horizontal
  const stubLen = portOff * 0.5;
  const stub = new THREE.CylinderGeometry(pipeR, pipeR, stubLen, CYL_SEGS);
  stub.rotateZ(Math.PI / 2);
  stub.translate(bendEndX + bendR + stubLen / 2, 0, 0);

  // Hubs
  const hubA = buildHubShoulder(material, diameter, new THREE.Vector3(-bodyLen / 2, 0, 0), new THREE.Vector3(-1, 0, 0));
  const hubB = buildHubShoulder(material, diameter, new THREE.Vector3( bodyLen / 2, 0, 0), new THREE.Vector3( 1, 0, 0));
  const hubC = buildHubShoulder(material, diameter, new THREE.Vector3(bendEndX + bendR + stubLen, 0, 0), new THREE.Vector3(1, 0, 0));

  geo = mergeGeometries([body, branch, bend, stub, hubA, hubB, hubC]);
  geoCache.set(key, geo);
  return geo;
}

/**
 * Coupling — straight joint with proper hubs at each end and a central
 * stop ring where pipes meet. Used to join two pipes in-line.
 */
function getCouplingGeo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `cpl-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;

  const pipeOd = getOuterDiameterFt(material, diameter);
  const pipeR = pipeOd / 2;
  const hubR = getHubOuterRadiusFt(material, pipeOd);
  const socket = getSocketDepthFt(material, diameter);

  // Outer body (the "band" of the coupling)
  const bodyLen = socket * 2 + pipeR * 0.4;
  const body = new THREE.CylinderGeometry(hubR, hubR, bodyLen, CYL_SEGS);
  body.rotateZ(Math.PI / 2);

  // Central stop ring (slightly darker — future material tweak)
  const stop = buildStopRing(pipeR, hubR, new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));

  geo = mergeGeometries([body, stop]);
  geoCache.set(key, geo);
  return geo;
}

/**
 * Cap — closed-end stopper that slips over a pipe terminus.
 *
 * Phase 14.AD.9 — previously aliased to `getCouplingGeo` (L.948-950
 * in the dispatch switch), which is an OPEN cylinder with a central
 * stop ring. A real cap has:
 *   - One hub socket at the pipe side (same diameter as coupling hub)
 *   - A CLOSED DOME / FLAT END on the outside
 *   - No through-hole
 *
 * Visually: coupling = short tube you can see through; cap = tube
 * closed at the far end. The difference reads clearly even at mid
 * camera distance on a DWV cleanout stub or a capped future-expansion
 * line.
 */
function getCapGeo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `cap-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;

  const pipeOd = getOuterDiameterFt(material, diameter);
  const pipeR = pipeOd / 2;
  const hubR = getHubOuterRadiusFt(material, pipeOd);
  const socket = getSocketDepthFt(material, diameter);

  // Hub socket — open toward the pipe side, closed on the other.
  // Body length = socket depth + a short closed-dome portion at the end.
  const domeLen = pipeR * 0.5; // half a pipe-radius of closed material past the socket
  const totalLen = socket + domeLen;
  // Center the cap along +X so the open end sits at x = -socket/2 - …
  // Actually: we want the OPEN end (where pipe enters) at x=0 and the
  // closed end (dome) at x = +totalLen. Build along local X axis.
  const body = new THREE.CylinderGeometry(hubR, hubR, totalLen, CYL_SEGS);
  body.rotateZ(Math.PI / 2);
  body.translate(totalLen / 2, 0, 0);

  // Closed dome end: a disc at the far end of the body. Use a
  // cylinder-like disc (radius = hubR, thin). This closes the tube
  // so it visually reads as a cap rather than a pipe stub.
  const domeDisc = new THREE.CylinderGeometry(hubR, hubR * 0.98, pipeR * 0.1, CYL_SEGS);
  domeDisc.rotateZ(Math.PI / 2);
  domeDisc.translate(totalLen + pipeR * 0.05, 0, 0);

  // Stop ring inside the socket (pipe butts up against it).
  const stop = buildStopRing(
    pipeR, hubR,
    new THREE.Vector3(socket, 0, 0),
    new THREE.Vector3(1, 0, 0),
  );

  geo = mergeGeometries([body, domeDisc, stop]);
  geoCache.set(key, geo);
  return geo;
}

/**
 * Cross — true 4-way fitting with perpendicular branches. Used when
 * four pipes meet at a single point (supply manifolds, DWV stacks
 * with 4 tributaries).
 *
 * Phase 14.AD.10 — previously aliased to `getTeeStraightGeo`
 * (L.942-943), which only has 3 hubs. A true cross has:
 *   - One through-line (main) — 2 hubs
 *   - One perpendicular line — 2 hubs
 *   - Central stop ring at the intersection
 *
 * The geometry is symmetric across both axes. Each branch is a
 * straight cylinder; the two cylinders intersect at the origin.
 */
function getCrossGeo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `x-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;

  const pipeOd = getOuterDiameterFt(material, diameter);
  const pipeR = pipeOd / 2;
  const hubR = getHubOuterRadiusFt(material, pipeOd);
  const socket = getSocketDepthFt(material, diameter);
  const portOffset = getPortOffsetFt(material, pipeOd);

  // Main through-line (along X axis) — two hubs + central body.
  const mainLen = (portOffset + socket) * 2;
  const main = new THREE.CylinderGeometry(hubR, hubR, mainLen, CYL_SEGS);
  main.rotateZ(Math.PI / 2);

  // Perpendicular branch (along Z axis) — two hubs + central body.
  // Use Z so it's visually distinct from the main X axis; the
  // fitting instance can be rotated to any orientation via its
  // quaternion.
  const branchLen = (portOffset + socket) * 2;
  const branch = new THREE.CylinderGeometry(hubR, hubR, branchLen, CYL_SEGS);
  // Default cylinder axis is Y; rotate to Z so branches run along Z.
  branch.rotateX(Math.PI / 2);

  // Four hubs (shoulders) — one at each port. The buildHubShoulder
  // helper positions them so the OUTER end sits at `center`, inward
  // along `axis`. Place each at the port offset along its respective
  // half-axis.
  const hubMainPos = buildHubShoulder(
    material, pipeR,
    new THREE.Vector3(portOffset + socket / 2, 0, 0),
    new THREE.Vector3(1, 0, 0),
  );
  const hubMainNeg = buildHubShoulder(
    material, pipeR,
    new THREE.Vector3(-portOffset - socket / 2, 0, 0),
    new THREE.Vector3(-1, 0, 0),
  );
  const hubBranchPos = buildHubShoulder(
    material, pipeR,
    new THREE.Vector3(0, 0, portOffset + socket / 2),
    new THREE.Vector3(0, 0, 1),
  );
  const hubBranchNeg = buildHubShoulder(
    material, pipeR,
    new THREE.Vector3(0, 0, -portOffset - socket / 2),
    new THREE.Vector3(0, 0, -1),
  );

  // Central stop ring at the intersection.
  const stop = buildStopRing(pipeR, hubR, new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 0, 0));

  geo = mergeGeometries([main, branch, hubMainPos, hubMainNeg, hubBranchPos, hubBranchNeg, stop]);
  geoCache.set(key, geo);
  return geo;
}

/**
 * Reducer — conical transition from `diameter` to `diameter2` with
 * both hubs and a visible shoulder step at each end.
 */
function getReducerGeo(
  material: PipeMaterial,
  diameter: number,
  diameter2: number,
): THREE.BufferGeometry {
  const key = `red-${material}-${diameter}-${diameter2}`;
  let geo = geoCache.get(key);
  if (geo) return geo;

  const bigOd = getOuterDiameterFt(material, diameter);
  const smallOd = getOuterDiameterFt(material, diameter2);
  const bigR = bigOd / 2;
  const smallR = smallOd / 2;
  const bigHubR = getHubOuterRadiusFt(material, bigOd);
  const smallHubR = getHubOuterRadiusFt(material, smallOd);
  const socketBig = getSocketDepthFt(material, diameter);
  const socketSmall = getSocketDepthFt(material, diameter2);

  // Conical body connecting the two sockets
  const transitionLen = Math.max(bigR, smallR) * 3;
  const cone = new THREE.CylinderGeometry(smallR, bigR, transitionLen, CYL_SEGS);
  cone.rotateZ(Math.PI / 2);

  // Large hub on one end, small hub on the other
  const hubBig = new THREE.CylinderGeometry(bigHubR, bigHubR, socketBig, CYL_SEGS);
  hubBig.rotateZ(Math.PI / 2);
  hubBig.translate(-transitionLen / 2 - socketBig / 2, 0, 0);

  const hubSmall = new THREE.CylinderGeometry(smallHubR, smallHubR, socketSmall, CYL_SEGS);
  hubSmall.rotateZ(Math.PI / 2);
  hubSmall.translate(transitionLen / 2 + socketSmall / 2, 0, 0);

  geo = mergeGeometries([cone, hubBig, hubSmall]);
  geoCache.set(key, geo);
  return geo;
}

/**
 * Bushing — hub-on-small-side + spigot-on-large-side reducing
 * adapter. Phase 14.AD.12.
 *
 * Asymmetric geometry, unlike the reducer coupling (both hubs):
 *   • LARGE end: SPIGOT — a straight cylinder at the pipe's outer
 *     diameter. Slips INTO an adjacent fitting's socket. No hub
 *     lip on this side.
 *   • SMALL end: HUB — full socket with stop ring for a pipe of
 *     the smaller diameter.
 *   • Between: a short conical transition.
 *
 * Real-world usage: adapt a 2" tee outlet down to 1.5" pipe
 * without needing a separate reducing coupling. Common for
 * retrofit / repair where sizes transition at an existing
 * fitting.
 *
 * Orientation: spigot end at local -X, hub end at local +X. The
 * instance quaternion rotates the whole bushing to align with
 * the pipe's travel direction (same convention as `getCouplingGeo`
 * post-AD.11).
 */
function getBushingGeo(
  material: PipeMaterial,
  diameter: number,
  diameter2: number,
): THREE.BufferGeometry {
  const key = `bsh-${material}-${diameter}-${diameter2}`;
  let geo = geoCache.get(key);
  if (geo) return geo;

  const bigOd = getOuterDiameterFt(material, diameter);
  const smallOd = getOuterDiameterFt(material, diameter2);
  const bigR = bigOd / 2;
  const smallR = smallOd / 2;
  const smallHubR = getHubOuterRadiusFt(material, smallOd);
  const socketSmall = getSocketDepthFt(material, diameter2);

  // Spigot on the big side — matches pipe OD exactly (slips into a
  // host fitting's socket sized for this diameter). Length = the
  // expected insert depth for a pipe of this diameter.
  const spigotLen = getSocketDepthFt(material, diameter);
  const spigot = new THREE.CylinderGeometry(bigR, bigR, spigotLen, CYL_SEGS);
  spigot.rotateZ(Math.PI / 2);
  spigot.translate(-spigotLen / 2, 0, 0);

  // Conical transition from big to small. Bushings are compact, so
  // transition is short relative to a full reducer coupling.
  const transitionLen = Math.max(bigR, smallR) * 1.2;
  const cone = new THREE.CylinderGeometry(smallR, bigR, transitionLen, CYL_SEGS);
  cone.rotateZ(Math.PI / 2);
  cone.translate(transitionLen / 2, 0, 0);

  // Hub on the small side — full socket with stop ring.
  const hub = new THREE.CylinderGeometry(smallHubR, smallHubR, socketSmall, CYL_SEGS);
  hub.rotateZ(Math.PI / 2);
  hub.translate(transitionLen + socketSmall / 2, 0, 0);

  // Stop ring at the inside of the hub so the pipe seats against it.
  const stop = buildStopRing(
    smallR, smallHubR,
    new THREE.Vector3(transitionLen, 0, 0),
    new THREE.Vector3(1, 0, 0),
  );

  geo = mergeGeometries([spigot, cone, hub, stop]);
  geoCache.set(key, geo);
  return geo;
}

/**
 * Cleanout — straight body with a threaded plug at the top.
 */
function getCleanoutGeo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `co-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;

  const pipeOd = getOuterDiameterFt(material, diameter);
  const pipeR = pipeOd / 2;
  const hubR = getHubOuterRadiusFt(material, pipeOd);

  const body = new THREE.CylinderGeometry(pipeR, pipeR, pipeR * 3, CYL_SEGS);
  const plug = new THREE.CylinderGeometry(hubR, pipeR * 1.05, pipeR * 0.6, CYL_SEGS);
  plug.translate(0, pipeR * 1.8, 0);
  // Hex rim on the plug
  const hex = new THREE.CylinderGeometry(hubR * 1.1, hubR * 1.1, pipeR * 0.2, HEX_SEGS);
  hex.translate(0, pipeR * 2.1, 0);

  const hubBottom = buildHubShoulder(material, diameter, new THREE.Vector3(0, -pipeR * 1.5, 0), new THREE.Vector3(0, -1, 0));

  geo = mergeGeometries([body, plug, hex, hubBottom]);
  geoCache.set(key, geo);
  return geo;
}

/**
 * Closet flange — 3×4 reducing flange that accepts a 3" pipe and
 * terminates in a 4" flange disc for toilet mounting.
 */
function getClosetFlangeGeo(material: PipeMaterial, diameter: number): THREE.BufferGeometry {
  const key = `cf-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;

  const pipeOd = getOuterDiameterFt(material, diameter);
  const pipeR = pipeOd / 2;

  const hub = new THREE.CylinderGeometry(pipeR, pipeR, pipeR * 2, CYL_SEGS);
  const flange = new THREE.CylinderGeometry(pipeR * 2.6, pipeR * 2.6, pipeR * 0.35, CYL_SEGS);
  flange.translate(0, pipeR * 0.85, 0);

  // Bolt-slot notches (decorative, not geometrically accurate)
  const bolts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const ang = (i / 4) * Math.PI * 2;
    const b = new THREE.CylinderGeometry(pipeR * 0.2, pipeR * 0.2, pipeR * 0.45, CYL_SEGS_TINY);
    b.translate(Math.cos(ang) * pipeR * 2.1, pipeR * 0.85, Math.sin(ang) * pipeR * 2.1);
    bolts.push(b);
  }

  const hubBottom = buildHubShoulder(material, diameter, new THREE.Vector3(0, -pipeR, 0), new THREE.Vector3(0, -1, 0));
  geo = mergeGeometries([hub, flange, ...bolts, hubBottom]);
  geoCache.set(key, geo);
  return geo;
}

/**
 * PEX manifold — a fat cylindrical body with branch ports along one
 * side, each with its own valve-style knob representing a shutoff.
 * Matches Uponor ProPEX manifold visual layout.
 */
function getManifoldGeo(
  material: PipeMaterial,
  diameter: number,
  ports: 2 | 4 | 6 | 8,
): THREE.BufferGeometry {
  const key = `manifold${ports}-${material}-${diameter}`;
  let geo = geoCache.get(key);
  if (geo) return geo;

  const pipeOd = getOuterDiameterFt(material, diameter);
  const pipeR = pipeOd / 2;
  const bodyR = pipeR * 2.4;
  const spacing = pipeR * 3.5;
  const bodyLen = ports * spacing + spacing * 0.6;

  // Main supply body (Y-axis)
  const mainBody = new THREE.CylinderGeometry(bodyR, bodyR, bodyLen, CYL_SEGS);

  // End caps (flat discs)
  const capTop = new THREE.CylinderGeometry(bodyR * 1.05, bodyR * 1.05, pipeR * 0.3, CYL_SEGS);
  capTop.translate(0, bodyLen / 2, 0);
  const capBot = new THREE.CylinderGeometry(bodyR * 1.05, bodyR * 1.05, pipeR * 0.3, CYL_SEGS);
  capBot.translate(0, -bodyLen / 2, 0);

  // Inlet hub at the bottom
  const inlet = buildHubShoulder(material, diameter, new THREE.Vector3(0, -bodyLen / 2 - pipeR * 0.5, 0), new THREE.Vector3(0, -1, 0));

  const parts: THREE.BufferGeometry[] = [mainBody, capTop, capBot, inlet];

  for (let i = 0; i < ports; i++) {
    const yOff = (i - (ports - 1) / 2) * spacing;

    // Branch stub (+X direction)
    const stub = new THREE.CylinderGeometry(pipeR, pipeR, pipeR * 4, CYL_SEGS);
    stub.rotateZ(Math.PI / 2);
    stub.translate(bodyR + pipeR * 2, yOff, 0);

    // Valve body (knob) — short cylinder perpendicular to branch
    const knob = new THREE.CylinderGeometry(pipeR * 1.2, pipeR * 1.2, pipeR * 0.9, CYL_SEGS_TINY);
    knob.translate(bodyR + pipeR * 0.6, yOff, 0);

    // Hub at the branch exit
    const branchHub = buildHubShoulder(
      material, diameter,
      new THREE.Vector3(bodyR + pipeR * 4, yOff, 0),
      new THREE.Vector3(1, 0, 0),
    );

    parts.push(stub, knob, branchHub);
  }

  geo = mergeGeometries(parts);
  geoCache.set(key, geo);
  return geo;
}

/** Simple geometry merge (positions only, no UVs). */
function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let totalVerts = 0;
  let totalIdx = 0;
  for (const g of geos) {
    totalVerts += g.getAttribute('position').count;
    totalIdx += (g.index?.count ?? g.getAttribute('position').count);
  }

  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const indices: number[] = [];
  let vertOffset = 0;
  let idxOffset = 0;

  for (const g of geos) {
    const pos = g.getAttribute('position');
    const norm = g.getAttribute('normal');

    for (let i = 0; i < pos.count; i++) {
      positions[(vertOffset + i) * 3] = pos.getX(i);
      positions[(vertOffset + i) * 3 + 1] = pos.getY(i);
      positions[(vertOffset + i) * 3 + 2] = pos.getZ(i);
      if (norm) {
        normals[(vertOffset + i) * 3] = norm.getX(i);
        normals[(vertOffset + i) * 3 + 1] = norm.getY(i);
        normals[(vertOffset + i) * 3 + 2] = norm.getZ(i);
      }
    }

    if (g.index) {
      for (let i = 0; i < g.index.count; i++) {
        indices.push(g.index.getX(i) + vertOffset);
      }
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices.push(i + vertOffset);
      }
    }

    vertOffset += pos.count;
  }

  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setIndex(indices);
  return merged;
}

// ── Geometry dispatch (exported for testability) ─────────────────

/**
 * Phase 14.AD.13 — single entry point for getting the cached
 * `BufferGeometry` for any `FittingType`. Mirrors the switch inside
 * `buildGroups` so the snapshot test harness can exercise every
 * geometry builder through one function without individually
 * exporting each internal builder.
 *
 * `diameter2` is only consulted for reducer + bushing, which are
 * two-diameter transitions. For all other types it's ignored.
 *
 * Returns the same cached THREE.BufferGeometry the renderer uses —
 * caller must NOT mutate it.
 */
export function getFittingGeometryByType(
  type: string,
  material: PipeMaterial,
  diameter: number,
  diameter2?: number,
): THREE.BufferGeometry {
  const d2 = diameter2 ?? diameter;
  switch (type) {
    case 'bend_22_5':        return getBend22_5Geo(material, diameter);
    case 'bend_45':          return getElbow45Geo(material, diameter);
    case 'elbow_45':         return getElbow45Geo(material, diameter);
    case 'bend_90':          return getElbow90Geo(material, diameter);
    case 'elbow_90':         return getElbow90Geo(material, diameter);
    case 'pex_elbow_90':     return getPexElbow90Geo(material, diameter);
    case 'bend_90_ls':       return getBend90LongSweepGeo(material, diameter);
    case 'tee':              return getTeeStraightGeo(material, diameter);
    case 'sanitary_tee':     return getSanitaryTeeGeo(material, diameter);
    case 'wye':              return getWyeGeo(material, diameter);
    case 'combo_wye_eighth': return getComboGeo(material, diameter);
    case 'cross':            return getCrossGeo(material, diameter);
    case 'reducer':          return getReducerGeo(material, diameter, d2);
    case 'bushing':          return getBushingGeo(material, diameter, d2);
    case 'coupling':         return getCouplingGeo(material, diameter);
    case 'cap':              return getCapGeo(material, diameter);
    case 'cleanout_adapter': return getCleanoutGeo(material, diameter);
    case 'closet_flange':    return getClosetFlangeGeo(material, diameter);
    case 'p_trap':           return getPTrapGeo(material, diameter);
    case 'manifold_2':       return getManifoldGeo(material, diameter, 2);
    case 'manifold_4':       return getManifoldGeo(material, diameter, 4);
    case 'manifold_6':       return getManifoldGeo(material, diameter, 6);
    case 'manifold_8':       return getManifoldGeo(material, diameter, 8);
    default:                 return getElbow90Geo(material, diameter);
  }
}

// ── Fitting type groups ─────────────────────────────────────────

type FittingGroup = {
  type: string;
  instances: FittingInstance[];
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
};

function buildGroups(fittings: FittingInstance[]): FittingGroup[] {
  // Group by type + diameter + material (material drives radius + color)
  const buckets = new Map<string, FittingInstance[]>();
  for (const f of fittings) {
    const key = `${f.type}-${f.diameter}-${f.material}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(f);
  }

  const groups: FittingGroup[] = [];

  for (const [, instances] of buckets) {
    const sample = instances[0]!;
    // Real OD in feet — matches the pipe radius used by PipeRenderer.
    const radius = getOuterRadiusFt(sample.material as PipeMaterial, sample.diameter);

    const mat = sample.material as PipeMaterial;
    const diam = sample.diameter;

    let geometry: THREE.BufferGeometry;
    switch (sample.type) {
      case 'bend_22_5':
        geometry = getBend22_5Geo(mat, diam);
        break;
      case 'bend_45':
      case 'elbow_45':
        geometry = getElbow45Geo(mat, diam);
        break;
      case 'bend_90':
      case 'elbow_90':
        geometry = getElbow90Geo(mat, diam);
        break;
      case 'pex_elbow_90':
        // Phase 14.V — Uponor ProPEX elbow. Distinct from bend_90
        // via the expansion-ring collars baked into the geometry.
        geometry = getPexElbow90Geo(mat, diam);
        break;
      case 'bend_90_ls':
        geometry = getBend90LongSweepGeo(mat, diam);
        break;
      case 'tee':
        geometry = getTeeStraightGeo(mat, diam);
        break;
      case 'sanitary_tee':
        geometry = getSanitaryTeeGeo(mat, diam);
        break;
      case 'wye':
        geometry = getWyeGeo(mat, diam);
        break;
      case 'combo_wye_eighth':
        geometry = getComboGeo(mat, diam);
        break;
      case 'cross':
        // Phase 14.AD.10 — real 4-way cross with 4 hubs. Previously
        // aliased to getTeeStraightGeo (3 hubs).
        geometry = getCrossGeo(mat, diam);
        break;
      case 'reducer':
        geometry = getReducerGeo(mat, diam, sample.diameter2 ?? diam);
        break;
      case 'bushing':
        // Phase 14.AD.12 — asymmetric reducer (hub + spigot), unlike
        // `reducer` which has two hubs. diameter = large side
        // (spigot), diameter2 = small side (hub).
        geometry = getBushingGeo(mat, diam, sample.diameter2 ?? diam);
        break;
      case 'coupling':
        geometry = getCouplingGeo(mat, diam);
        break;
      case 'cap':
        // Phase 14.AD.9 — real closed-end cap. Previously aliased
        // to getCouplingGeo (open cylinder).
        geometry = getCapGeo(mat, diam);
        break;
      case 'cleanout_adapter':
        geometry = getCleanoutGeo(mat, diam);
        break;
      case 'closet_flange':
        geometry = getClosetFlangeGeo(mat, diam);
        break;
      case 'p_trap':
        geometry = getPTrapGeo(mat, diam);
        break;
      case 'manifold_2':
        geometry = getManifoldGeo(mat, diam, 2);
        break;
      case 'manifold_4':
        geometry = getManifoldGeo(mat, diam, 4);
        break;
      case 'manifold_6':
        geometry = getManifoldGeo(mat, diam, 6);
        break;
      case 'manifold_8':
        geometry = getManifoldGeo(mat, diam, 8);
        break;
      default:
        geometry = getElbow90Geo(mat, diam);
    }

    const material = getPipeMaterial(sample.diameter, sample.material);

    groups.push({
      type: `${sample.type}-${sample.diameter}-${sample.material}`,
      instances,
      geometry,
      material,
    });
  }

  return groups;
}

// ── InstancedMesh renderer ──────────────────────────────────────

function FittingGroup({ group }: { group: FittingGroup }) {
  const meshRef = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    if (!meshRef.current) return;

    for (let i = 0; i < group.instances.length; i++) {
      const inst = group.instances[i]!;
      dummy.position.set(inst.position[0], inst.position[1], inst.position[2]);
      dummy.quaternion.set(
        inst.quaternion[0], inst.quaternion[1],
        inst.quaternion[2], inst.quaternion[3],
      );
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }

    meshRef.current.instanceMatrix.needsUpdate = true;
  }, [group.instances, dummy]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[group.geometry, group.material, group.instances.length]}
      castShadow
      receiveShadow
    />
  );
}

// ── Main component ──────────────────────────────────────────────

export function FittingRenderer() {
  const pipes = usePipeStore((state) => state.pipes);
  const fittingsVisible = useLayerStore((s) => s.fittings);
  const systemVisibility = useLayerStore((s) => s.systems);
  const getFloorParams = useFloorParams();
  const phaseFilter = usePhaseFilter();

  const groups = useMemo(() => {
    if (!fittingsVisible) return [];
    const pipeList = Object.values(pipes).filter((p) => {
      if (!p.visible || !systemVisibility[p.system]) return false;
      let yMin = p.points[0]?.[1] ?? 0, yMax = yMin;
      for (const pt of p.points) { if (pt[1] < yMin) yMin = pt[1]; if (pt[1] > yMax) yMax = pt[1]; }
      const fp = getFloorParams(yMin, yMax);
      // Bug-fix (user report "no fittings on riser"): the old `fp.opacity
      // < 0.9` cull dropped ALL fittings for any pipe spanning multiple
      // floors (floorStore returns 0.82 for risers) OR viewed on a
      // ghosted non-active floor. The pipe itself kept rendering
      // (PipeRenderer uses `ghostify` instead of culling) so the scene
      // showed naked pipes with no elbows / tees / couplings. Now: cull
      // ONLY when the floor is literally hidden (fp.visible === false)
      // or the ghost is effectively zero (< 0.05). Full-opacity fittings
      // on a ghosted floor look slightly bright vs. the pipe but they
      // are correct + visible.
      if (!fp.visible || fp.opacity < 0.05) return false;
      const autoPhase = classifyPipe(p);
      const effectivePhase = phaseFilter.pipeOverride(p.id) ?? autoPhase;
      return shouldPhaseRender(effectivePhase, phaseFilter.activePhase, phaseFilter.mode);
    });
    if (pipeList.length === 0) return [];

    // Phase 14.T — use the memoized per-pipe cache for bends + flex
    // warnings. Junctions still recompute each pass; they're cheap
    // relative to the bend scan and they cross pipes so caching
    // them per-pipe isn't meaningful.
    const cache = getFittingCache();
    const perPipe = cache.collectPerPipe(pipeList);
    const { mergedVertices } = mergePexRuns(pipeList);
    const junctions = generateJunctionFittings(pipeList, mergedVertices);
    const fittings: FittingInstance[] = [...perPipe, ...junctions];
    return buildGroups(fittings);
  }, [pipes, fittingsVisible, systemVisibility, getFloorParams, phaseFilter]);

  if (groups.length === 0) return null;

  return (
    <group>
      {groups.map((g) => (
        <FittingGroup key={g.type} group={g} />
      ))}
    </group>
  );
}
