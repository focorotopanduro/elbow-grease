/**
 * IPC Ontology — semantic type system for the International Plumbing Code.
 *
 * Instead of hardcoding compliance rules as scattered if/else blocks,
 * this ontology defines the IPC's conceptual structure as a formal
 * schema. Every code section, entity, property, and relationship
 * gets a unique URI-like identifier and typed semantics.
 *
 * Ontology layers:
 *
 *   Entity classes — what things exist in the code
 *     ipc:Fixture, ipc:Pipe, ipc:TrapArm, ipc:Vent, ipc:Stack,
 *     ipc:Drain, ipc:Cleanout, ipc:WaterSupply, ipc:Fitting
 *
 *   Property classes — measurable attributes
 *     ipc:diameter, ipc:length, ipc:slope, ipc:dfu, ipc:wsfu,
 *     ipc:pressure, ipc:velocity, ipc:elevation, ipc:temperature
 *
 *   Relationship classes — how entities connect
 *     ipc:connectsTo, ipc:drainsInto, ipc:ventsThrough,
 *     ipc:suppliedBy, ipc:servesFixture, ipc:containsFitting
 *
 *   Constraint classes — what rules apply
 *     ipc:MaxDistance, ipc:MinSlope, ipc:MaxDFU, ipc:MinDiameter,
 *     ipc:MaxVelocity, ipc:MinPressure, ipc:RequiresVent,
 *     ipc:RequiresCleanout, ipc:ProhibitsConnection
 *
 *   Code reference — traceability back to IPC section
 *     ipc:section, ipc:table, ipc:edition, ipc:chapter
 */

// ── Namespace prefixes ──────────────────────────────────────────

export const NS = {
  IPC:  'ipc:',
  FBC:  'fbc:',     // Florida Building Code overlay
  UPC:  'upc:',     // Uniform Plumbing Code
  BLDG: 'bldg:',    // Building-specific instances
} as const;

// ── Entity classes ──────────────────────────────────────────────

export type EntityClass =
  | 'ipc:Fixture'
  | 'ipc:Pipe'
  | 'ipc:TrapArm'
  | 'ipc:Vent'
  | 'ipc:VentStack'
  | 'ipc:WasteStack'
  | 'ipc:BuildingDrain'
  | 'ipc:BuildingSewer'
  | 'ipc:Cleanout'
  | 'ipc:WaterSupply'
  | 'ipc:HotWaterSupply'
  | 'ipc:Fitting'
  | 'ipc:TrapSeal'
  | 'ipc:BackwaterValve'
  | 'ipc:Manifold'
  | 'ipc:WaterHeater'
  | 'ipc:PRV';

// ── Property classes ────────────────────────────────────────────

export type PropertyClass =
  | 'ipc:diameter'
  | 'ipc:length'
  | 'ipc:slope'
  | 'ipc:dfu'
  | 'ipc:wsfu'
  | 'ipc:pressure'
  | 'ipc:velocity'
  | 'ipc:elevation'
  | 'ipc:temperature'
  | 'ipc:flowRate'
  | 'ipc:trapSealDepth'
  | 'ipc:roughness'
  | 'ipc:material'
  | 'ipc:gradePercent';

// ── Relationship classes ────────────────────────────────────────

export type RelationshipClass =
  | 'ipc:connectsTo'
  | 'ipc:drainsInto'
  | 'ipc:ventsThrough'
  | 'ipc:suppliedBy'
  | 'ipc:servesFixture'
  | 'ipc:containsFitting'
  | 'ipc:isUpstreamOf'
  | 'ipc:isDownstreamOf'
  | 'ipc:isOnStack'
  | 'ipc:isOnBranch'
  | 'ipc:requiresVentBy'
  | 'ipc:requiresCleanoutAt';

// ── Constraint classes ──────────────────────────────────────────

export type ConstraintClass =
  | 'ipc:MaxDistance'
  | 'ipc:MinDistance'
  | 'ipc:MinSlope'
  | 'ipc:MaxSlope'
  | 'ipc:MaxDFU'
  | 'ipc:MinDiameter'
  | 'ipc:MaxDiameter'
  | 'ipc:MaxVelocity'
  | 'ipc:MinVelocity'
  | 'ipc:MinPressure'
  | 'ipc:MaxPressure'
  | 'ipc:RequiresVent'
  | 'ipc:RequiresCleanout'
  | 'ipc:RequiresTrap'
  | 'ipc:ProhibitsConnection'
  | 'ipc:MaxFixturesPerBranch'
  | 'ipc:MinTrapSealDepth'
  | 'ipc:MaxTrapSealDepth'
  | 'ipc:MinAirGap'
  | 'ipc:MaxDevelopedLength';

// ── Comparison operators ────────────────────────────────────────

export type ComparisonOp = 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'neq' | 'in' | 'notIn';

// ── Code reference ──────────────────────────────────────────────

export interface CodeReference {
  code: 'IPC' | 'FBC' | 'UPC';
  edition: string;       // e.g. "2021", "2024", "2026 9th Ed"
  chapter: number;
  section: string;       // e.g. "906.1", "710.1(1)"
  table?: string;        // e.g. "Table 710.1(1)"
  paragraph?: string;    // e.g. "906.1.1"
  description: string;   // human-readable rule summary
}

// ── Severity ────────────────────────────────────────────────────

export type ViolationSeverity = 'error' | 'warning' | 'info';

/**
 * Severity classification:
 *   error   — hard code violation, design is non-compliant
 *   warning — near violation or best-practice deviation
 *   info    — advisory (e.g. "consider larger diameter for future expansion")
 */
export function classifySeverity(
  violationCost: number,
  threshold: number,
): ViolationSeverity {
  const ratio = violationCost / (threshold || 1);
  if (ratio >= 1.0) return 'error';
  if (ratio >= 0.8) return 'warning';
  return 'info';
}

// ── Remediation action ──────────────────────────────────────────

export interface RemediationAction {
  description: string;
  /** Which entity to modify. */
  targetEntityId: string;
  /** Which property to change. */
  property: PropertyClass;
  /** Suggested new value. */
  suggestedValue: number | string;
  /** Estimated cost impact of the fix. */
  costDelta: number;
}
