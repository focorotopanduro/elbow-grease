/**
 * Pipe Material Factory — cached MeshStandardMaterial per
 * (material × system × diameter × variant).
 *
 * Visual targets match real jobsite pipe appearance:
 *
 *   PVC Sch 40 / Sch 80   slightly off-white plastic, very matte
 *   ABS DWV               matte black plastic
 *   CPVC                  beige / cream plastic
 *   Cast Iron             dark charcoal, semi-metallic
 *   Copper L/M            warm orange-red, bright metallic sheen
 *   Galvanized Steel      cool silver, medium metallic
 *   PEX (Uponor)          color by SYSTEM:
 *                             hot_supply  → red   (AquaPEX-R)
 *                             cold_supply → blue  (AquaPEX-B)
 *                             waste/vent  → white (rare PEX use in DWV)
 *
 * Per-diameter color accents are preserved via a secondary "rim" color
 * that PipeRenderer can use for the wall-shell ring or an end-cap
 * stripe — keeping the QuickPlumb-Pro convention of instant diameter
 * recognition WITHOUT losing material identity.
 */

import * as THREE from 'three';
import type { PipeMaterial as PipeMaterialType } from '../../engine/graph/GraphEdge';
import type { SystemType } from '../../engine/graph/GraphNode';
import { getColorForDiameter } from '@store/pipeStore';

// ── Material base appearance ────────────────────────────────────

interface MaterialLook {
  baseColor: string;
  metalness: number;
  roughness: number;
  /** Subtle emissive so pipes read well under low ambient. */
  emissiveIntensity: number;
  /** Ratio of diameter-tint blended into the base (0 = pure material color). */
  diameterTintBlend: number;
}

const MATERIAL_LOOK: Record<PipeMaterialType, MaterialLook> = {
  // PVC / ABS / CPVC — slightly glossier than pure matte so the
  // warehouse HDRI gives them a subtle highlight stripe.
  pvc_sch40:        { baseColor: '#e8e4d9', metalness: 0.05, roughness: 0.48, emissiveIntensity: 0.03, diameterTintBlend: 0.12 },
  pvc_sch80:        { baseColor: '#4a5264', metalness: 0.08, roughness: 0.42, emissiveIntensity: 0.03, diameterTintBlend: 0.10 },
  abs:              { baseColor: '#1a1a1c', metalness: 0.05, roughness: 0.58, emissiveIntensity: 0.02, diameterTintBlend: 0.08 },
  cpvc:             { baseColor: '#d6b88a', metalness: 0.06, roughness: 0.45, emissiveIntensity: 0.03, diameterTintBlend: 0.10 },
  // PEX — soft satin plastic. Slightly higher metalness+lower rough
  // than PVC reads as "wet" plastic, matching real PEX-A appearance.
  pex:              { baseColor: '#f1f1f1', metalness: 0.10, roughness: 0.40, emissiveIntensity: 0.04, diameterTintBlend: 0.00 },
  // Copper — bumped metalness toward unity + lower roughness gives the
  // warm gloss you see on new copper runs. Slight emissive keeps
  // shadow-side from going muddy.
  copper_type_l:    { baseColor: '#c25d1e', metalness: 0.92, roughness: 0.15, emissiveIntensity: 0.06, diameterTintBlend: 0.00 },
  copper_type_m:    { baseColor: '#b05418', metalness: 0.88, roughness: 0.18, emissiveIntensity: 0.06, diameterTintBlend: 0.00 },
  // Cast iron — oily, very dark. Slight metalness keeps the texture
  // from looking chalky.
  cast_iron:        { baseColor: '#2a2c30', metalness: 0.60, roughness: 0.72, emissiveIntensity: 0.02, diameterTintBlend: 0.00 },
  // Galvanized — crisp brushed steel sheen
  galvanized_steel: { baseColor: '#a8b0b8', metalness: 0.80, roughness: 0.25, emissiveIntensity: 0.04, diameterTintBlend: 0.00 },
  ductile_iron:    { baseColor: '#33353a', metalness: 0.65, roughness: 0.68, emissiveIntensity: 0.02, diameterTintBlend: 0.00 },
};

// ── PEX system-specific colors (industry convention) ────────────

const PEX_SYSTEM_COLOR: Record<SystemType, string> = {
  hot_supply:  '#d13e3e',  // red  — Uponor AquaPEX-R
  cold_supply: '#2a6fd6',  // blue — Uponor AquaPEX-B
  waste:       '#eeeeee',  // white
  vent:        '#eeeeee',
  storm:       '#5b6f84',
};

// ── Helpers ─────────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  return {
    r: parseInt(full.substring(0, 2), 16) / 255,
    g: parseInt(full.substring(2, 4), 16) / 255,
    b: parseInt(full.substring(4, 6), 16) / 255,
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function blendColors(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(
    ca.r * (1 - t) + cb.r * t,
    ca.g * (1 - t) + cb.g * t,
    ca.b * (1 - t) + cb.b * t,
  );
}

/**
 * Compute the final base color given material, system, and diameter.
 * PEX uses system color; other materials blend their base with a
 * small amount of diameter tint for at-a-glance size recognition.
 */
function resolveBaseColor(
  material: PipeMaterialType,
  system: SystemType,
  diameter: number,
): string {
  const look = MATERIAL_LOOK[material];
  if (material === 'pex') {
    return PEX_SYSTEM_COLOR[system] ?? look.baseColor;
  }
  if (look.diameterTintBlend <= 0) return look.baseColor;
  const diameterColor = getColorForDiameter(diameter);
  return blendColors(look.baseColor, diameterColor, look.diameterTintBlend);
}

// ── Cache ───────────────────────────────────────────────────────

const cache = new Map<string, THREE.MeshStandardMaterial>();
const wallCache = new Map<string, THREE.MeshStandardMaterial>();
const selectedCache = new Map<string, THREE.MeshStandardMaterial>();

function cacheKey(d: number, m: string, sys: string, v: string): string {
  return `${d}|${m}|${sys}|${v}`;
}

// ── Factory ─────────────────────────────────────────────────────

export function getPipeMaterial(
  diameter: number,
  pipeMaterial: string,
  system: SystemType = 'cold_supply',
): THREE.MeshStandardMaterial {
  const key = cacheKey(diameter, pipeMaterial, system, 'main');
  let mat = cache.get(key);
  if (mat) return mat;

  const mt = (pipeMaterial as PipeMaterialType) in MATERIAL_LOOK
    ? (pipeMaterial as PipeMaterialType)
    : 'pvc_sch40';
  const look = MATERIAL_LOOK[mt];
  const baseColor = resolveBaseColor(mt, system, diameter);

  mat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: look.metalness,
    roughness: look.roughness,
    emissive: baseColor,
    emissiveIntensity: look.emissiveIntensity,
    toneMapped: true,
    // Subtle flat-normal offset so pipes don't z-fight when packed
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  cache.set(key, mat);
  return mat;
}

export function getSelectedPipeMaterial(
  diameter: number,
  pipeMaterial: string,
  system: SystemType = 'cold_supply',
): THREE.MeshStandardMaterial {
  const key = cacheKey(diameter, pipeMaterial, system, 'selected');
  let mat = selectedCache.get(key);
  if (mat) return mat;

  const mt = (pipeMaterial as PipeMaterialType) in MATERIAL_LOOK
    ? (pipeMaterial as PipeMaterialType)
    : 'pvc_sch40';
  const look = MATERIAL_LOOK[mt];
  const baseColor = resolveBaseColor(mt, system, diameter);

  mat = new THREE.MeshStandardMaterial({
    color: baseColor,
    metalness: Math.min(1, look.metalness + 0.15),
    roughness: Math.max(0, look.roughness - 0.1),
    emissive: '#ffd54f',
    emissiveIntensity: 0.35,
    toneMapped: true,
  });

  selectedCache.set(key, mat);
  return mat;
}

export function getWallShellMaterial(
  diameter: number,
  pipeMaterial: string,
  system: SystemType = 'cold_supply',
): THREE.MeshStandardMaterial {
  const key = cacheKey(diameter, pipeMaterial, system, 'wall');
  let mat = wallCache.get(key);
  if (mat) return mat;

  const mt = (pipeMaterial as PipeMaterialType) in MATERIAL_LOOK
    ? (pipeMaterial as PipeMaterialType)
    : 'pvc_sch40';
  // Wall uses the DIAMETER-coded color (not material color) so plumber
  // can still pick out pipe sizes at a glance.
  const rimColor = getColorForDiameter(diameter);

  mat = new THREE.MeshStandardMaterial({
    color: rimColor,
    transparent: true,
    opacity: 0.10,
    metalness: 0.08,
    roughness: 0.5,
    side: THREE.BackSide,
    depthWrite: false,
  });
  void mt; // satisfy linter — material param exists for future per-material wall tuning

  wallCache.set(key, mat);
  return mat;
}

export function getPreviewMaterial(): THREE.MeshStandardMaterial {
  const key = 'preview';
  let mat = cache.get(key);
  if (mat) return mat;

  mat = new THREE.MeshStandardMaterial({
    color: '#00e5ff',
    transparent: true,
    opacity: 0.45,
    metalness: 0.2,
    roughness: 0.5,
    emissive: '#00e5ff',
    emissiveIntensity: 0.5,
    toneMapped: false,
    depthWrite: false,
  });

  cache.set(key, mat);
  return mat;
}

export function invalidateDiameterCache(oldDiameter: number, pipeMaterial: string): void {
  // Clear all cache entries matching this diameter × material across systems.
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${oldDiameter}|${pipeMaterial}|`)) {
      cache.get(key)?.dispose();
      cache.delete(key);
    }
  }
  for (const key of [...wallCache.keys()]) {
    if (key.startsWith(`${oldDiameter}|${pipeMaterial}|`)) {
      wallCache.get(key)?.dispose();
      wallCache.delete(key);
    }
  }
  for (const key of [...selectedCache.keys()]) {
    if (key.startsWith(`${oldDiameter}|${pipeMaterial}|`)) {
      selectedCache.get(key)?.dispose();
      selectedCache.delete(key);
    }
  }
}

export function disposeAllMaterials(): void {
  for (const mat of cache.values()) mat.dispose();
  for (const mat of wallCache.values()) mat.dispose();
  for (const mat of selectedCache.values()) mat.dispose();
  cache.clear();
  wallCache.clear();
  selectedCache.clear();
}
