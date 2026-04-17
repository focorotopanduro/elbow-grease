/**
 * DRAWING Wheel — CTRL+SPACE activates this wheel.
 *
 * 4 primary sectors (one per cardinal direction):
 *
 *   LEFT   — DWV pipes       scroll = cycle materials (PVC-40/PVC-80/ABS/CI)
 *   TOP    — Drafting tools  scroll = cycle Ruler/Scale/Grid
 *   RIGHT  — Walls           scroll = cycle wall type (int/ext/plumb/partition/knee)
 *   BOTTOM — Supply pipes    scroll = cycle materials (PEX/CPVC/Cu-L/Cu-M)
 *
 * Previously the DWV sector enumerated every (material × size) pair
 * producing 20 subtypes to scroll through. That was unusable. Now the
 * subtype list is JUST materials; diameter keeps the current value
 * from interactionStore (or uses a sensible default for the chosen
 * system). Per-pipe diameter can be adjusted post-draw via the
 * Toolbar / PipeInspector / wheel re-select.
 *
 * Each sector's onSelect now performs a REAL action:
 *   DWV/SUPPLY   → setDrawMaterial + setDrawDiameter + enter draw mode
 *   UTILITIES    → toggle ruler / scale / cycle grid size
 *   WALLS        → beginWallDraw with the selected wall type
 */

import { useMemo } from 'react';
import { RadialMenu, type WheelConfig } from '../RadialMenu';
import { useInteractionStore } from '@store/interactionStore';
import { useMeasureStore } from '@store/measureStore';
import { useWallStore, type WallType } from '@store/wallStore';
import type { PipeMaterial } from '../../../engine/graph/GraphEdge';

// ── Subtype definitions ────────────────────────────────────────

interface MaterialSubtype {
  id: string;
  label: string;
  icon: string;
  material: PipeMaterial;
  /** Default diameter to apply when this material is picked. */
  defaultDiameterIn: number;
}

const DWV_MATERIALS: MaterialSubtype[] = [
  { id: 'pvc-40',  label: 'PVC Schedule 40', icon: '⚪', material: 'pvc_sch40',  defaultDiameterIn: 3 },
  { id: 'pvc-80',  label: 'PVC Schedule 80', icon: '⚫', material: 'pvc_sch80',  defaultDiameterIn: 3 },
  { id: 'abs',     label: 'ABS DWV',         icon: '⬛', material: 'abs',         defaultDiameterIn: 3 },
  { id: 'ci',      label: 'Cast Iron Hub',   icon: '🔘', material: 'cast_iron',  defaultDiameterIn: 4 },
];

const SUPPLY_MATERIALS: MaterialSubtype[] = [
  { id: 'pex',     label: 'PEX-A (Uponor)',  icon: '🔵', material: 'pex',            defaultDiameterIn: 0.5 },
  { id: 'cpvc',    label: 'CPVC',            icon: '🟡', material: 'cpvc',           defaultDiameterIn: 0.5 },
  { id: 'copper-l',label: 'Copper Type L',   icon: '🟠', material: 'copper_type_l',  defaultDiameterIn: 0.5 },
  { id: 'copper-m',label: 'Copper Type M',   icon: '🟤', material: 'copper_type_m',  defaultDiameterIn: 0.5 },
];

interface UtilityDef {
  id: 'ruler' | 'scale' | 'grid';
  label: string;
  icon: string;
  description: string;
}

const UTILITIES: UtilityDef[] = [
  { id: 'ruler', label: 'Ruler',    icon: '📏', description: 'Click two points to measure distance (R)' },
  { id: 'scale', label: 'Scale',    icon: '⚖️', description: 'Calibrate world scale from a known length (K)' },
  { id: 'grid',  label: 'Grid',     icon: '⊞',  description: 'Cycle snap grid: 1" → 3" → 6" → 12" → 24"' },
];

interface WallSubDef {
  id: WallType;
  label: string;
  icon: string;
  description: string;
}

const WALL_TYPES: WallSubDef[] = [
  { id: 'interior',  label: 'Interior 4.5"',   icon: '▤', description: 'Standard 2×4 partition with drywall' },
  { id: 'exterior',  label: 'Exterior 6"',     icon: '▥', description: 'Load-bearing 2×6 rim wall' },
  { id: 'plumbing',  label: 'Plumbing 6"',     icon: '🪠', description: 'Oversized wet-wall for DWV stacks' },
  { id: 'partition', label: 'Partition 3.5"',  icon: '┃',  description: 'Non-load-bearing divider' },
  { id: 'knee',      label: 'Knee 2.5"',       icon: '▬',  description: 'Low attic/crawl wall' },
];

const GRID_STEPS_FT = [1 / 12, 3 / 12, 6 / 12, 1, 2]; // 1", 3", 6", 1ft, 2ft

// ── Build wheel config ──────────────────────────────────────────

export function getDrawingWheelConfig(): WheelConfig {
  const ixn = useInteractionStore.getState();
  const measureStore = useMeasureStore.getState();
  const wallStore = useWallStore.getState();

  const dwvSubtypes = DWV_MATERIALS.map((m) => ({
    id: m.id,
    label: m.label,
    icon: m.icon,
  }));

  const supplySubtypes = SUPPLY_MATERIALS.map((m) => ({
    id: m.id,
    label: m.label,
    icon: m.icon,
  }));

  const utilitySubtypes = UTILITIES.map((u) => ({
    id: u.id,
    label: u.label,
    icon: u.icon,
  }));

  const wallSubtypes = WALL_TYPES.map((w) => ({
    id: w.id,
    label: w.label,
    icon: w.icon,
  }));

  return {
    id: 'drawing',
    title: 'DRAWING',
    accentColor: '#00e5ff',
    outerRadiusPx: 220,
    innerRadiusPx: 70,
    tapToSelect: true,
    sectors: [
      {
        id: 'left',
        label: 'DWV',
        icon: '⬇',
        // Real plumbing convention: DWV = brown/earthy (cast iron color).
        color: '#8d6e63',
        centerAngleRad: Math.PI,
        halfWidthRad: Math.PI / 4,
        description: 'Drain, Waste, Vent — gravity flow',
        subtypes: dwvSubtypes,
        onSelect: (subtypeIdx) => {
          const m = DWV_MATERIALS[subtypeIdx];
          if (!m) return;
          ixn.setDrawMaterial(m.material);
          ixn.setDrawDiameter(m.defaultDiameterIn);
          ixn.setMode('draw');
        },
      },
      {
        id: 'top',
        label: 'UTILITIES',
        icon: '📐',
        color: '#7c4dff',
        centerAngleRad: Math.PI / 2,
        halfWidthRad: Math.PI / 4,
        description: 'Measurement & drafting aids',
        subtypes: utilitySubtypes,
        onSelect: (subtypeIdx) => {
          const u = UTILITIES[subtypeIdx];
          if (!u) return;
          switch (u.id) {
            case 'ruler':
              measureStore.setMode(measureStore.mode === 'ruler' ? 'off' : 'ruler');
              break;
            case 'scale':
              measureStore.setMode(measureStore.mode === 'scale' ? 'off' : 'scale');
              break;
            case 'grid': {
              // Cycle grid snap through common increments
              const current = useInteractionStore.getState().gridSnap;
              const idx = GRID_STEPS_FT.findIndex((s) => Math.abs(s - current) < 0.001);
              const next = GRID_STEPS_FT[(idx + 1) % GRID_STEPS_FT.length]!;
              useInteractionStore.setState({ gridSnap: next });
              break;
            }
          }
        },
      },
      {
        id: 'right',
        label: 'WALLS',
        icon: '🧱',
        color: '#9e9e9e',
        centerAngleRad: 0,
        halfWidthRad: Math.PI / 4,
        description: 'Framing — snap pipes to walls',
        subtypes: wallSubtypes,
        onSelect: (subtypeIdx) => {
          const w = WALL_TYPES[subtypeIdx];
          if (!w) return;
          if (wallStore.drawSession && wallStore.drawSession.type === w.id) {
            wallStore.cancelWallDraw();
          } else {
            wallStore.beginWallDraw(w.id, true);
          }
        },
      },
      {
        id: 'bottom',
        label: 'SUPPLY',
        icon: '💧',
        // Real plumbing convention: supply = blue (cold) / orange (hot).
        // Use cyan as a neutral supply accent.
        color: '#29b6f6',
        centerAngleRad: -Math.PI / 2,
        halfWidthRad: Math.PI / 4,
        description: 'Pressurized hot + cold water supply',
        subtypes: supplySubtypes,
        onSelect: (subtypeIdx) => {
          const m = SUPPLY_MATERIALS[subtypeIdx];
          if (!m) return;
          ixn.setDrawMaterial(m.material);
          ixn.setDrawDiameter(m.defaultDiameterIn);
          ixn.setMode('draw');
        },
      },
    ],
  };
}

// ── React component wrapper ─────────────────────────────────────

export function DrawingWheel() {
  const config = useMemo(() => getDrawingWheelConfig(), []);
  return <RadialMenu config={config} />;
}
