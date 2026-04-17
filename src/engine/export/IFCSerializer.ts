/**
 * IFC Serializer — converts the PlumbingDAG + committed pipes to
 * IFC-SPF (STEP Physical File) format per ISO 16739.
 *
 * Output is a complete .ifc text file that can be imported into:
 *   - Autodesk Revit
 *   - Trimble Connect
 *   - Solibri Model Checker
 *   - BIMcollab
 *   - Any IFC4-compliant BIM viewer
 *
 * Geometry: IfcSweptDiskSolid (circle swept along polyline path)
 * — this produces the same cylindrical pipe shape in all BIM tools.
 */

import type { CommittedPipe } from '../../store/pipeStore';
import type { Vec3 } from '../../core/events';
import type { FittingInstance } from '../../ui/pipe/FittingGenerator';
import {
  generateIfcGuid,
  ifcHeader,
  NODE_TO_IFC,
  FITTING_TO_IFC,
  FITTING_PREDEFINED,
  SYSTEM_TO_IFC,
  MATERIAL_TO_IFC,
  type IfcProperty,
  formatIfcValue,
} from './IFCSchema';
import type { SystemType, FixtureSubtype } from '../graph/GraphNode';
import type { PipeMaterial, FittingType } from '../graph/GraphEdge';

// ── Line counter for STEP entity IDs ────────────────────────────

class StepWriter {
  private lines: string[] = [];
  private entityId = 0;

  /** Write a STEP entity line. Returns the entity ID (#N). */
  entity(content: string): number {
    this.entityId++;
    this.lines.push(`#${this.entityId}=${content};`);
    return this.entityId;
  }

  /** Get the current entity ID without writing. */
  peek(): number {
    return this.entityId + 1;
  }

  /** Get all lines as a string. */
  toString(): string {
    return this.lines.join('\n');
  }

  get count(): number {
    return this.entityId;
  }
}

// ── Coordinate conversion (feet → meters for IFC) ──────────────

function feetToMeters(ft: number): number {
  return ft * 0.3048;
}

function vec3ToIfc(p: Vec3): string {
  return `(${feetToMeters(p[0]).toFixed(6)},${feetToMeters(p[1]).toFixed(6)},${feetToMeters(p[2]).toFixed(6)})`;
}

function inchesToMeters(inches: number): number {
  return inches * 0.0254;
}

// ── Main serializer ─────────────────────────────────────────────

export interface IFCExportOptions {
  projectName: string;
  author: string;
  organization: string;
  /** Include property sets (diameter, material, DFU, etc.). */
  includeProperties: boolean;
  /** Include fittings as separate entities. */
  includeFittings: boolean;
  /** Group elements by system (waste, supply, vent). */
  groupBySystems: boolean;
}

const DEFAULT_OPTIONS: IFCExportOptions = {
  projectName: 'ELBOW GREASE Export',
  author: 'Plumber',
  organization: 'Beit Building Contractors',
  includeProperties: true,
  includeFittings: true,
  groupBySystems: true,
};

export interface IFCExportResult {
  /** The complete IFC file content. */
  content: string;
  /** Number of IFC entities written. */
  entityCount: number;
  /** Number of pipe segments exported. */
  pipeCount: number;
  /** Number of fittings exported. */
  fittingCount: number;
  /** File size in bytes. */
  sizeBytes: number;
}

/**
 * Export the current plumbing design to IFC4 format.
 */
export function exportToIFC(
  pipes: CommittedPipe[],
  fittings: FittingInstance[] = [],
  fixtures: { position: Vec3; subtype: FixtureSubtype }[] = [],
  options: Partial<IFCExportOptions> = {},
): IFCExportResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const w = new StepWriter();

  // ── Header ──────────────────────────────────────────────────
  let output = ifcHeader(opts.projectName, opts.author, opts.organization);
  output += 'DATA;\n';

  // ── Shared context entities ─────────────────────────────────

  // Owner history
  const personId = w.entity(`IfcPerson($,$,'${opts.author}',$,$,$,$,$)`);
  const orgId = w.entity(`IfcOrganization($,'${opts.organization}',$,$,$)`);
  const personOrgId = w.entity(`IfcPersonAndOrganization(#${personId},#${orgId},$)`);
  const appId = w.entity(`IfcApplication(#${orgId},'0.1','ELBOW GREASE','ElbowGrease')`);
  const ownerHistId = w.entity(`IfcOwnerHistory(#${personOrgId},#${appId},$,.NOCHANGE.,$,#${personOrgId},#${appId},${Math.floor(Date.now() / 1000)})`);

  // Units (meters, radians)
  const siLenId = w.entity(`IfcSIUnit(*,.LENGTHUNIT.,$,.METRE.)`);
  const siAreaId = w.entity(`IfcSIUnit(*,.AREAUNIT.,$,.SQUARE_METRE.)`);
  const siVolId = w.entity(`IfcSIUnit(*,.VOLUMEUNIT.,$,.CUBIC_METRE.)`);
  const siAngId = w.entity(`IfcSIUnit(*,.PLANEANGLEUNIT.,$,.RADIAN.)`);
  const unitsId = w.entity(`IfcUnitAssignment((#${siLenId},#${siAreaId},#${siVolId},#${siAngId}))`);

  // Geometric context
  const originId = w.entity(`IfcCartesianPoint((0.,0.,0.))`);
  const dirZId = w.entity(`IfcDirection((0.,0.,1.))`);
  const dirXId = w.entity(`IfcDirection((1.,0.,0.))`);
  const axis2dId = w.entity(`IfcAxis2Placement3D(#${originId},#${dirZId},#${dirXId})`);
  const contextId = w.entity(`IfcGeometricRepresentationContext($,'Model',3,1.0E-5,#${axis2dId},$)`);

  // Project
  const projectGuid = generateIfcGuid();
  const projectId = w.entity(`IfcProject('${projectGuid}',#${ownerHistId},'${opts.projectName}',$,$,$,$,(#${contextId}),#${unitsId})`);

  // Site → Building → Storey
  const siteId = w.entity(`IfcSite('${generateIfcGuid()}',#${ownerHistId},'Site',$,$,$,$,$,.ELEMENT.,$,$,$,$,$)`);
  const buildingId = w.entity(`IfcBuilding('${generateIfcGuid()}',#${ownerHistId},'Building',$,$,$,$,$,.ELEMENT.,$,$,$)`);
  const storeyId = w.entity(`IfcBuildingStorey('${generateIfcGuid()}',#${ownerHistId},'Ground Floor',$,$,$,$,$,.ELEMENT.,0.)`);

  // Spatial hierarchy
  w.entity(`IfcRelAggregates('${generateIfcGuid()}',#${ownerHistId},$,$,#${projectId},(#${siteId}))`);
  w.entity(`IfcRelAggregates('${generateIfcGuid()}',#${ownerHistId},$,$,#${siteId},(#${buildingId}))`);
  w.entity(`IfcRelAggregates('${generateIfcGuid()}',#${ownerHistId},$,$,#${buildingId},(#${storeyId}))`);

  // ── Distribution systems ────────────────────────────────────

  const systemIds = new Map<SystemType, number>();
  if (opts.groupBySystems) {
    const systems: SystemType[] = ['waste', 'vent', 'cold_supply', 'hot_supply', 'storm'];
    for (const sys of systems) {
      const ifcSys = SYSTEM_TO_IFC[sys];
      const sysId = w.entity(
        `IfcDistributionSystem('${generateIfcGuid()}',#${ownerHistId},'${sys.replace(/_/g, ' ')}',$,$,.${ifcSys.predefined}.)`
      );
      systemIds.set(sys, sysId);
    }
  }

  // ── Pipe segments ───────────────────────────────────────────

  const pipeEntityIds: number[] = [];

  for (const pipe of pipes) {
    // Build polyline from pipe points
    const pointIds: number[] = [];
    for (const pt of pipe.points) {
      pointIds.push(w.entity(`IfcCartesianPoint(${vec3ToIfc(pt)})`));
    }
    const polylineId = w.entity(`IfcPolyline((${pointIds.map((id) => `#${id}`).join(',')}))`);

    // Swept disk solid (circle swept along polyline = pipe geometry)
    const radiusM = inchesToMeters(pipe.diameter / 2);
    const geoId = w.entity(`IfcSweptDiskSolid(#${polylineId},${radiusM.toFixed(6)},${(radiusM * 0.9).toFixed(6)},$,$)`);

    // Shape representation
    const shapeRepId = w.entity(`IfcShapeRepresentation(#${contextId},'Body','SweptSolid',(#${geoId}))`);
    const prodDefId = w.entity(`IfcProductDefinitionShape($,$,(#${shapeRepId}))`);

    // Local placement (identity — geometry is in world coords)
    const placementId = w.entity(`IfcLocalPlacement($,#${axis2dId})`);

    // IfcPipeSegment entity
    const pipeGuid = generateIfcGuid();
    const material = (pipe.material as PipeMaterial) || 'pvc_sch40';
    const matName = MATERIAL_TO_IFC[material] ?? pipe.material;
    const pipeId = w.entity(
      `IfcPipeSegment('${pipeGuid}',#${ownerHistId},'${pipe.id}','${matName} ${pipe.diameter}"',$,#${placementId},#${prodDefId},$,.RIGIDSEGMENT.)`
    );
    pipeEntityIds.push(pipeId);

    // Property set
    if (opts.includeProperties) {
      const props: IfcProperty[] = [
        { name: 'NominalDiameter', type: 'real', value: inchesToMeters(pipe.diameter) },
        { name: 'NominalDiameterInches', type: 'real', value: pipe.diameter },
        { name: 'Material', type: 'label', value: matName },
        { name: 'System', type: 'label', value: pipe.system },
      ];

      // Compute total length
      let totalLen = 0;
      for (let i = 1; i < pipe.points.length; i++) {
        const dx = pipe.points[i]![0] - pipe.points[i-1]![0];
        const dy = pipe.points[i]![1] - pipe.points[i-1]![1];
        const dz = pipe.points[i]![2] - pipe.points[i-1]![2];
        totalLen += Math.sqrt(dx*dx + dy*dy + dz*dz);
      }
      props.push({ name: 'Length', type: 'real', value: feetToMeters(totalLen) });
      props.push({ name: 'LengthFeet', type: 'real', value: totalLen });

      const propIds: number[] = [];
      for (const prop of props) {
        propIds.push(w.entity(
          `IfcPropertySingleValue('${prop.name}',$,${formatIfcValue(prop)},$)`
        ));
      }
      const psetId = w.entity(
        `IfcPropertySet('${generateIfcGuid()}',#${ownerHistId},'Pset_PipeSegmentTypeCommon',$,(${propIds.map((id) => `#${id}`).join(',')}))`
      );
      w.entity(
        `IfcRelDefinesByProperties('${generateIfcGuid()}',#${ownerHistId},$,$,(#${pipeId}),#${psetId})`
      );
    }

    // Assign to system
    const sysId = systemIds.get(pipe.system);
    if (sysId) {
      w.entity(
        `IfcRelAssignsToGroup('${generateIfcGuid()}',#${ownerHistId},$,$,(#${pipeId}),.PRODUCT.,#${sysId})`
      );
    }
  }

  // Contain pipes in storey
  if (pipeEntityIds.length > 0) {
    w.entity(
      `IfcRelContainedInSpatialStructure('${generateIfcGuid()}',#${ownerHistId},$,$,(${pipeEntityIds.map((id) => `#${id}`).join(',')}),#${storeyId})`
    );
  }

  // ── Fittings ────────────────────────────────────────────────

  let fittingCount = 0;
  if (opts.includeFittings && fittings.length > 0) {
    const fittingEntityIds: number[] = [];

    for (const fitting of fittings) {
      const ptId = w.entity(`IfcCartesianPoint(${vec3ToIfc(fitting.position)})`);
      const fitPlacementId = w.entity(`IfcLocalPlacement($,#${axis2dId})`);

      // Simple box representation for fittings
      const r = inchesToMeters(fitting.diameter / 2);
      const boxId = w.entity(`IfcBlock(#${axis2dId},${(r*4).toFixed(6)},${(r*4).toFixed(6)},${(r*4).toFixed(6)})`);
      const shapeId = w.entity(`IfcShapeRepresentation(#${contextId},'Body','CSG',(#${boxId}))`);
      const prodId = w.entity(`IfcProductDefinitionShape($,$,(#${shapeId}))`);

      const predefined = FITTING_PREDEFINED[fitting.type as FittingType] ?? 'USERDEFINED';
      const fEntityId = w.entity(
        `IfcPipeFitting('${generateIfcGuid()}',#${ownerHistId},'${fitting.type}','${fitting.diameter}" ${fitting.type.replace(/_/g,' ')}',$,#${fitPlacementId},#${prodId},$,.${predefined}.)`
      );
      fittingEntityIds.push(fEntityId);
      fittingCount++;
    }

    if (fittingEntityIds.length > 0) {
      w.entity(
        `IfcRelContainedInSpatialStructure('${generateIfcGuid()}',#${ownerHistId},$,$,(${fittingEntityIds.map((id) => `#${id}`).join(',')}),#${storeyId})`
      );
    }
  }

  // ── Close data section ──────────────────────────────────────

  output += w.toString();
  output += '\nENDSEC;\nEND-ISO-10303-21;\n';

  return {
    content: output,
    entityCount: w.count,
    pipeCount: pipes.length,
    fittingCount,
    sizeBytes: new TextEncoder().encode(output).length,
  };
}
