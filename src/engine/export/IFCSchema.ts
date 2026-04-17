/**
 * IFC Schema — entity type mappings for plumbing BIM export.
 *
 * Maps ELBOW GREASE internal types to IFC4 (ISO 16739-1:2018)
 * entity classes for Building Information Modeling interoperability.
 *
 * IFC plumbing entities used:
 *
 *   IfcPipeSegment          — straight pipe run between two points
 *   IfcPipeFitting          — elbow, tee, reducer, coupling
 *   IfcFlowTerminal         — fixture (toilet, sink, shower, etc.)
 *   IfcSanitaryTerminal     — fixture subtype for sanitary fixtures
 *   IfcWasteTerminal        — floor drain, cleanout
 *   IfcFlowSegment          — generic flow conduit
 *   IfcDistributionPort     — connection point on a pipe/fitting
 *   IfcDistributionSystem   — groups elements by system (waste/supply/vent)
 *
 * Geometry representation:
 *   IfcSweptDiskSolid       — pipe geometry (circle swept along a curve)
 *   IfcExtrudedAreaSolid    — fitting geometry (extruded profiles)
 *   IfcPolyline / IfcTrimmedCurve — path definitions
 *
 * Property sets:
 *   Pset_PipeSegmentTypeCommon    — diameter, length, material
 *   Pset_PipeFittingTypeCommon    — fitting type, angle, diameter
 *   Pset_FlowTerminalTypeCommon   — fixture type, DFU, WSFU
 *   Pset_DistributionSystemCommon — system type, design pressure
 */

import type { SystemType, FixtureSubtype, NodeType } from '../graph/GraphNode';
import type { FittingType, PipeMaterial } from '../graph/GraphEdge';

// ── IFC entity class mappings ───────────────────────────────────

export const NODE_TO_IFC: Record<NodeType, string> = {
  fixture:   'IfcSanitaryTerminal',
  junction:  'IfcJunctionBox',
  stack:     'IfcPipeSegment',
  vent:      'IfcPipeSegment',
  cleanout:  'IfcWasteTerminal',
  manifold:  'IfcDistributionChamberElement',
  source:    'IfcValve',
  drain:     'IfcWasteTerminal',
};

export const FIXTURE_TO_IFC: Partial<Record<FixtureSubtype, string>> = {
  water_closet:      'IfcSanitaryTerminal',
  lavatory:          'IfcSanitaryTerminal',
  kitchen_sink:      'IfcSanitaryTerminal',
  bathtub:           'IfcSanitaryTerminal',
  shower:            'IfcSanitaryTerminal',
  floor_drain:       'IfcWasteTerminal',
  urinal:            'IfcSanitaryTerminal',
  drinking_fountain: 'IfcSanitaryTerminal',
  dishwasher:        'IfcFlowTerminal',
  clothes_washer:    'IfcFlowTerminal',
  hose_bibb:         'IfcValve',
};

export const FITTING_TO_IFC: Record<FittingType, string> = {
  bend_22_5:        'IfcPipeFitting',
  bend_45:          'IfcPipeFitting',
  bend_90:          'IfcPipeFitting',
  bend_90_ls:       'IfcPipeFitting',
  elbow_90:         'IfcPipeFitting',
  elbow_45:         'IfcPipeFitting',
  tee:              'IfcPipeFitting',
  sanitary_tee:     'IfcPipeFitting',
  wye:              'IfcPipeFitting',
  combo_wye_eighth: 'IfcPipeFitting',
  cross:            'IfcPipeFitting',
  coupling:         'IfcPipeFitting',
  reducer:          'IfcPipeFitting',
  cap:              'IfcPipeFitting',
  cleanout_adapter: 'IfcPipeFitting',
  p_trap:           'IfcPipeFitting',
  closet_flange:    'IfcPipeFitting',
  manifold_2:       'IfcDistributionChamberElement',
  manifold_4:       'IfcDistributionChamberElement',
  manifold_6:       'IfcDistributionChamberElement',
  manifold_8:       'IfcDistributionChamberElement',
};

export const SYSTEM_TO_IFC: Record<SystemType, { type: string; predefined: string }> = {
  waste:       { type: 'IfcDistributionSystem', predefined: 'DRAINAGE' },
  vent:        { type: 'IfcDistributionSystem', predefined: 'VENTILATION' },
  cold_supply: { type: 'IfcDistributionSystem', predefined: 'DOMESTICCOLDWATER' },
  hot_supply:  { type: 'IfcDistributionSystem', predefined: 'DOMESTICHOTWATER' },
  storm:       { type: 'IfcDistributionSystem', predefined: 'STORMWATER' },
};

// ── IFC material mappings ───────────────────────────────────────

export const MATERIAL_TO_IFC: Record<PipeMaterial, string> = {
  pvc_sch40:         'PVC Schedule 40',
  pvc_sch80:         'PVC Schedule 80',
  abs:               'ABS DWV',
  cast_iron:         'Cast Iron No-Hub',
  copper_type_l:     'Copper Type L',
  copper_type_m:     'Copper Type M',
  cpvc:              'CPVC',
  pex:               'PEX',
  galvanized_steel:  'Galvanized Steel',
  ductile_iron:      'Ductile Iron',
};

// ── IFC fitting predefined types ────────────────────────────────

export const FITTING_PREDEFINED: Record<FittingType, string> = {
  bend_22_5:        'BEND',
  bend_45:          'BEND',
  bend_90:          'BEND',
  bend_90_ls:       'BEND',
  elbow_90:         'BEND',
  elbow_45:         'BEND',
  tee:              'JUNCTION',
  sanitary_tee:     'JUNCTION',
  wye:              'JUNCTION',
  combo_wye_eighth: 'JUNCTION',
  cross:            'JUNCTION',
  coupling:         'CONNECTOR',
  reducer:          'TRANSITION',
  cap:              'ENTRY',
  cleanout_adapter: 'ENTRY',
  p_trap:           'TRAP',
  closet_flange:    'CONNECTOR',
  manifold_2:       'JUNCTION',
  manifold_4:       'JUNCTION',
  manifold_6:       'JUNCTION',
  manifold_8:       'JUNCTION',
};

// ── IFC GUID generator ──────────────────────────────────────────

const IFC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$';

export function generateIfcGuid(): string {
  let guid = '';
  for (let i = 0; i < 22; i++) {
    guid += IFC_CHARS[Math.floor(Math.random() * 64)];
  }
  return guid;
}

// ── IFC header template ─────────────────────────────────────────

export function ifcHeader(
  projectName: string,
  author: string,
  organization: string,
): string {
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
  return `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');
FILE_NAME('${projectName}.ifc','${now}',('${author}'),('${organization}'),'ELBOW GREASE 0.1','ELBOW GREASE Plumbing CAD','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
`;
}

// ── IFC property set helpers ────────────────────────────────────

export interface IfcProperty {
  name: string;
  type: 'string' | 'real' | 'integer' | 'boolean' | 'label';
  value: string | number | boolean;
}

export function formatIfcValue(prop: IfcProperty): string {
  switch (prop.type) {
    case 'string':
    case 'label':
      return `IfcLabel('${prop.value}')`;
    case 'real':
      return `IfcReal(${Number(prop.value).toFixed(6)})`;
    case 'integer':
      return `IfcInteger(${Math.round(Number(prop.value))})`;
    case 'boolean':
      return prop.value ? '.T.' : '.F.';
  }
}
