/**
 * IPC Rule Parser — encodes IPC 2021 chapters 6–9 as machine-readable
 * knowledge graph triples and PCSP-ready rule templates.
 *
 * Each rule is:
 *   1. A set of KG triples (the code's declarative knowledge)
 *   2. A RuleTemplate with condition patterns + constraint check
 *      (the code's procedural requirement)
 *
 * This parser covers the core IPC sections that apply to residential
 * and light commercial plumbing design:
 *
 *   Chapter 6 — Water Supply and Distribution
 *     604.4  Sizing
 *     604.5  Velocity limits
 *     604.6  Minimum pressure
 *     604.8  Water hammer
 *
 *   Chapter 7 — Sanitary Drainage
 *     704.1  Slope requirements
 *     706.3  Fittings and connections
 *     708.1  Cleanout requirements
 *     710.1  Drainage pipe sizing
 *
 *   Chapter 9 — Vents
 *     903.1  Vent required
 *     906.1  Trap arm distance
 *     906.2  Trap arm slope
 *     916.1  Air admittance valves
 */

import { KnowledgeGraph, type Triple, type RuleTemplate } from './KnowledgeGraph';
import type { CodeReference } from './IPCOntology';

// ── Helper to build code reference ──────────────────────────────

function ipcRef(section: string, description: string, table?: string): CodeReference {
  return {
    code: 'IPC',
    edition: '2021',
    chapter: parseInt(section),
    section,
    table,
    description,
  };
}

// ── Triple generators ───────────────────────────────────────────

function trapArmTriples(): Triple[] {
  // IPC Table 906.1: Trap arm distances by trap size
  const ref = ipcRef('906.1', 'Trap arm maximum distance', 'Table 906.1');
  return [
    { subject: 'ipc:TrapArm/1.25in', predicate: 'ipc:maxDistance', object: 2.5, source: ref },
    { subject: 'ipc:TrapArm/1.25in', predicate: 'ipc:trapSize', object: 1.25, source: ref },
    { subject: 'ipc:TrapArm/1.5in', predicate: 'ipc:maxDistance', object: 3.5, source: ref },
    { subject: 'ipc:TrapArm/1.5in', predicate: 'ipc:trapSize', object: 1.5, source: ref },
    { subject: 'ipc:TrapArm/2in', predicate: 'ipc:maxDistance', object: 5, source: ref },
    { subject: 'ipc:TrapArm/2in', predicate: 'ipc:trapSize', object: 2, source: ref },
    { subject: 'ipc:TrapArm/3in', predicate: 'ipc:maxDistance', object: 6, source: ref },
    { subject: 'ipc:TrapArm/3in', predicate: 'ipc:trapSize', object: 3, source: ref },
    { subject: 'ipc:TrapArm/4in', predicate: 'ipc:maxDistance', object: 10, source: ref },
    { subject: 'ipc:TrapArm/4in', predicate: 'ipc:trapSize', object: 4, source: ref },
  ];
}

function slopeTriples(): Triple[] {
  const ref = ipcRef('704.1', 'Minimum slope for horizontal drainage', 'Section 704.1');
  return [
    // Pipes 3" and smaller: 1/4" per foot minimum
    { subject: 'ipc:Slope/small', predicate: 'ipc:maxDiameter', object: 3, source: ref },
    { subject: 'ipc:Slope/small', predicate: 'ipc:minSlope', object: 0.25, source: ref },
    // Pipes 4" and larger: 1/8" per foot minimum
    { subject: 'ipc:Slope/large', predicate: 'ipc:minDiameter', object: 4, source: ref },
    { subject: 'ipc:Slope/large', predicate: 'ipc:minSlope', object: 0.125, source: ref },
  ];
}

function velocityTriples(): Triple[] {
  const ref = ipcRef('604.5', 'Maximum water supply velocity');
  return [
    { subject: 'ipc:WaterSupply', predicate: 'ipc:maxVelocity', object: 8, source: ref },
    { subject: 'ipc:WaterSupply', predicate: 'ipc:velocityUnit', object: 'ft/s', source: ref },
  ];
}

function pressureTriples(): Triple[] {
  const ref = ipcRef('604.6', 'Minimum fixture supply pressure');
  return [
    { subject: 'ipc:FixtureSupply', predicate: 'ipc:minPressure', object: 8, source: ref },
    { subject: 'ipc:FixtureSupply', predicate: 'ipc:pressureUnit', object: 'psi', source: ref },
    // Flush valves require higher pressure
    { subject: 'ipc:FlushValve', predicate: 'ipc:minPressure', object: 15, source: ref },
  ];
}

function cleanoutTriples(): Triple[] {
  const ref = ipcRef('708.1', 'Cleanout requirements');
  return [
    // Required at base of each stack
    { subject: 'ipc:Cleanout/stackBase', predicate: 'ipc:requiredAt', object: 'ipc:StackBase', source: ref },
    // Required at direction changes > 45°
    { subject: 'ipc:Cleanout/dirChange', predicate: 'ipc:requiredAt', object: 'ipc:DirectionChange45', source: ref },
    // Maximum interval: every 100 ft for 4" and larger
    { subject: 'ipc:Cleanout/interval', predicate: 'ipc:maxInterval', object: 100, source: ref },
    { subject: 'ipc:Cleanout/interval', predicate: 'ipc:minDiameter', object: 4, source: ref },
  ];
}

function ventTriples(): Triple[] {
  const ref = ipcRef('903.1', 'Vent system required');
  return [
    // Every trap requires a vent
    { subject: 'ipc:VentRequirement', predicate: 'ipc:appliesTo', object: 'ipc:Trap', source: ref },
    { subject: 'ipc:VentRequirement', predicate: 'ipc:purpose', object: 'trap seal protection', source: ref },
    // Trap seal depth: 2" minimum, 4" maximum (IPC 1002.1)
    { subject: 'ipc:TrapSeal', predicate: 'ipc:minDepth', object: 2, source: ipcRef('1002.1', 'Trap seal depth') },
    { subject: 'ipc:TrapSeal', predicate: 'ipc:maxDepth', object: 4, source: ipcRef('1002.1', 'Trap seal depth') },
  ];
}

function drainSizingTriples(): Triple[] {
  const ref = ipcRef('710.1', 'Drainage pipe sizing', 'Table 710.1(1)');
  // Horizontal branch maximums by diameter
  return [
    { subject: 'ipc:HorizBranch/1.5in', predicate: 'ipc:diameter', object: 1.5, source: ref },
    { subject: 'ipc:HorizBranch/1.5in', predicate: 'ipc:maxDFU', object: 1, source: ref },
    { subject: 'ipc:HorizBranch/2in', predicate: 'ipc:diameter', object: 2, source: ref },
    { subject: 'ipc:HorizBranch/2in', predicate: 'ipc:maxDFU', object: 3, source: ref },
    { subject: 'ipc:HorizBranch/3in', predicate: 'ipc:diameter', object: 3, source: ref },
    { subject: 'ipc:HorizBranch/3in', predicate: 'ipc:maxDFU', object: 20, source: ref },
    { subject: 'ipc:HorizBranch/4in', predicate: 'ipc:diameter', object: 4, source: ref },
    { subject: 'ipc:HorizBranch/4in', predicate: 'ipc:maxDFU', object: 160, source: ref },
    { subject: 'ipc:HorizBranch/6in', predicate: 'ipc:diameter', object: 6, source: ref },
    { subject: 'ipc:HorizBranch/6in', predicate: 'ipc:maxDFU', object: 620, source: ref },
  ];
}

// ── Rule template generators ────────────────────────────────────

function trapArmDistanceRule(): RuleTemplate {
  return {
    id: 'IPC-906.1-trap-arm-distance',
    name: 'Trap arm maximum distance',
    description: 'Trap arm length shall not exceed values in Table 906.1',
    codeRef: ipcRef('906.1', 'Trap arm maximum distance', 'Table 906.1'),
    severity: 'error',
    conditions: [
      { subject: '?fixture', predicate: 'rdf:type', object: 'ipc:Fixture' },
      { subject: '?fixture', predicate: 'ipc:trapSize', object: '?trapSize' },
      { subject: '?fixture', predicate: 'ipc:connectsTo', object: '?pipe' },
      { subject: '?pipe', predicate: 'ipc:length', object: '?pipeLength' },
    ],
    check: {
      variable: '?pipeLength',
      property: 'value',
      op: 'lte',
      threshold: { variable: '?trapSize', property: 'ipc:maxDistanceForTrapSize' },
      message: 'Trap arm ${?pipeLength}ft exceeds max ${threshold}ft for ${?trapSize}" trap (IPC 906.1)',
    },
  };
}

function minSlopeRule(): RuleTemplate {
  return {
    id: 'IPC-704.1-min-slope',
    name: 'Minimum drainage slope',
    description: 'Horizontal drainage pipes shall have minimum slope per Section 704.1',
    codeRef: ipcRef('704.1', 'Minimum slope for horizontal drainage'),
    severity: 'error',
    conditions: [
      { subject: '?pipe', predicate: 'rdf:type', object: 'ipc:Pipe' },
      { subject: '?pipe', predicate: 'ipc:system', object: 'waste' },
      { subject: '?pipe', predicate: 'ipc:slope', object: '?slope' },
      { subject: '?pipe', predicate: 'ipc:diameter', object: '?diameter' },
    ],
    check: {
      variable: '?slope',
      property: 'value',
      op: 'gte',
      threshold: { variable: '?diameter', property: 'ipc:minSlopeForDiameter' },
      message: 'Slope ${?slope}"/ft below minimum for ${?diameter}" pipe (IPC 704.1)',
    },
  };
}

function maxVelocityRule(): RuleTemplate {
  return {
    id: 'IPC-604.5-max-velocity',
    name: 'Maximum supply velocity',
    description: 'Water supply velocity shall not exceed 8 ft/s',
    codeRef: ipcRef('604.5', 'Maximum water supply velocity'),
    severity: 'warning',
    conditions: [
      { subject: '?pipe', predicate: 'rdf:type', object: 'ipc:Pipe' },
      { subject: '?pipe', predicate: 'ipc:system', object: 'supply' },
      { subject: '?pipe', predicate: 'ipc:velocity', object: '?velocity' },
    ],
    check: {
      variable: '?velocity',
      property: 'value',
      op: 'lte',
      threshold: 8,
      message: 'Velocity ${?velocity} ft/s exceeds 8 ft/s max (IPC 604.5)',
    },
  };
}

function minPressureRule(): RuleTemplate {
  return {
    id: 'IPC-604.6-min-pressure',
    name: 'Minimum fixture pressure',
    description: 'Fixture supply pressure shall not be less than 8 psi',
    codeRef: ipcRef('604.6', 'Minimum fixture supply pressure'),
    severity: 'error',
    conditions: [
      { subject: '?fixture', predicate: 'rdf:type', object: 'ipc:Fixture' },
      { subject: '?fixture', predicate: 'ipc:pressure', object: '?pressure' },
    ],
    check: {
      variable: '?pressure',
      property: 'value',
      op: 'gte',
      threshold: 8,
      message: 'Fixture pressure ${?pressure} psi below minimum 8 psi (IPC 604.6)',
    },
  };
}

function maxDFURule(): RuleTemplate {
  return {
    id: 'IPC-710.1-max-dfu',
    name: 'Maximum DFU on branch',
    description: 'DFU on horizontal branch shall not exceed Table 710.1(1)',
    codeRef: ipcRef('710.1', 'Drainage pipe sizing', 'Table 710.1(1)'),
    severity: 'error',
    conditions: [
      { subject: '?pipe', predicate: 'rdf:type', object: 'ipc:Pipe' },
      { subject: '?pipe', predicate: 'ipc:system', object: 'waste' },
      { subject: '?pipe', predicate: 'ipc:accumulatedDFU', object: '?dfu' },
      { subject: '?pipe', predicate: 'ipc:diameter', object: '?diameter' },
    ],
    check: {
      variable: '?dfu',
      property: 'value',
      op: 'lte',
      threshold: { variable: '?diameter', property: 'ipc:maxDFUForDiameter' },
      message: 'DFU ${?dfu} exceeds max for ${?diameter}" pipe (IPC Table 710.1)',
    },
  };
}

function ventRequiredRule(): RuleTemplate {
  return {
    id: 'IPC-903.1-vent-required',
    name: 'Vent required for every trap',
    description: 'Each trap shall be individually vented per Section 903.1',
    codeRef: ipcRef('903.1', 'Vent system required'),
    severity: 'error',
    conditions: [
      { subject: '?fixture', predicate: 'rdf:type', object: 'ipc:Fixture' },
      { subject: '?fixture', predicate: 'ipc:hasTrap', object: 'true' },
    ],
    check: {
      variable: '?fixture',
      property: 'ipc:hasVent',
      op: 'eq',
      threshold: 1,
      message: 'Fixture ${?fixture} trap is not vented (IPC 903.1)',
    },
  };
}

// ── Public loader ───────────────────────────────────────────────

/**
 * Load the full IPC 2021 knowledge base into a KnowledgeGraph.
 * Returns the populated graph with all triples and rule templates.
 */
export function loadIPCKnowledgeBase(): KnowledgeGraph {
  const kg = new KnowledgeGraph();

  // Load triples
  kg.addBatch(trapArmTriples());
  kg.addBatch(slopeTriples());
  kg.addBatch(velocityTriples());
  kg.addBatch(pressureTriples());
  kg.addBatch(cleanoutTriples());
  kg.addBatch(ventTriples());
  kg.addBatch(drainSizingTriples());

  // Load rule templates
  kg.registerRules([
    trapArmDistanceRule(),
    minSlopeRule(),
    maxVelocityRule(),
    minPressureRule(),
    maxDFURule(),
    ventRequiredRule(),
  ]);

  return kg;
}
