/**
 * SharedDagBuffer — zero-copy main↔worker DAG transport via SharedArrayBuffer.
 *
 * PHASE 3 SCOPE: This file is the DESIGN + INFRASTRUCTURE for what the
 * iterated prompt called "1,200-node handoff < 2ms p95". It is NOT yet
 * the active IPC path for the live app. Until a real ≥500-pipe scene
 * proves structured-clone is actually the bottleneck, the legacy
 * postMessage path stays primary. The feature flag `sabIpc` selects
 * between them. All tests below run against this infrastructure in
 * isolation; the integration shim in SimulationBridge lights up when
 * the flag is on.
 *
 * ── Packed format ─────────────────────────────────────────────────
 *
 *                       ┌──────────────────┐
 *                       │   HEADER (64 B)  │
 *                       ├──────────────────┤
 *                       │   NODES SLAB     │  32 B × N nodes
 *                       ├──────────────────┤
 *                       │   EDGES SLAB     │  32 B × M edges
 *                       ├──────────────────┤
 *                       │   ID TABLE SLAB  │  variable length (UTF-8)
 *                       └──────────────────┘
 *
 * Everything lives in a single SharedArrayBuffer so both sides see one
 * coherent view. The allocator sizes the buffer at construction based
 * on declared capacity (max nodes, max edges, bytes reserved for strings).
 *
 * ── Header (offset 0, 64 bytes) ──────────────────────────────────
 *
 *   u32   magic       = 0x454C4247 ("ELBG")
 *   u16   schema      = 1
 *   u16   flags       = reserved bits
 *   u32   nodeCount   = current populated nodes
 *   u32   nodeCap     = max nodes the slab holds
 *   u32   edgeCount   = current populated edges
 *   u32   edgeCap     = max edges
 *   u32   idTableBytes= bytes currently used in the ID table
 *   u32   idTableCap  = bytes reserved for the ID table
 *   u64   generation  = monotonic counter; bumped on each write-commit
 *   u32   writerLock  = 0 free, 1 writer holds
 *   u32   _reserved[5]= future use
 *
 * ── Node record (32 bytes) ───────────────────────────────────────
 *
 *   u32   idOffset    = byte offset into ID table of this node's UTF-8 id
 *   u16   idLen       = length of the id string in bytes
 *   u8    type        = NodeType enum (fixture, junction, stack, …)
 *   u8    system      = SystemType enum (waste, vent, cold, hot, storm)
 *   u8    fixtureSub  = FixtureSubtype enum (0-12) or 255 for non-fixtures
 *   u8    _pad[3]
 *   f32   dfu
 *   f32   trapSize    = trap diameter, inches; 0 for non-fixtures
 *   f32   elevation   = feet
 *   f32   coldWSFU
 *   f32   hotWSFU
 *
 * ── Edge record (32 bytes) ───────────────────────────────────────
 *
 *   u32   idOffset    = byte offset into ID table
 *   u16   idLen
 *   u16   fromNodeIdx = index into nodes slab
 *   u16   toNodeIdx
 *   u8    material    = PipeMaterial enum
 *   u8    _pad
 *   f32   diameter    = inches
 *   f32   length      = feet
 *   f32   slope       = in/ft
 *   f32   elevDelta   = feet
 *   f32   _reserved   = future (velocity, pressure drop cache?)
 *
 * ── Concurrency ──────────────────────────────────────────────────
 *
 * Single writer (main thread during graph edits, worker during solves
 * — never both simultaneously because a solve is synchronous from the
 * main thread's POV). The writer acquires the writerLock via
 * Atomics.compareExchange, writes, bumps generation, releases lock.
 *
 * Readers never lock. They snapshot generation, read, then check
 * generation again. If it changed mid-read, retry. This is the
 * classic "sequence lock" pattern — safe for frequent readers since
 * reads don't contend.
 *
 * ── Fallback ─────────────────────────────────────────────────────
 *
 * If `typeof SharedArrayBuffer === 'undefined'` OR
 * `!self.crossOriginIsolated`, the SAB constructor throws and the
 * caller should fall back to the legacy structured-clone IPC.
 * `isSabAvailable()` below exposes a compile-time safe check.
 */

// ── Enum encodings (must match GraphNode.ts/GraphEdge.ts unions) ─

export const NODE_TYPE = {
  fixture: 0, junction: 1, stack: 2, vent: 3,
  cleanout: 4, manifold: 5, source: 6, drain: 7,
} as const;
export type NodeTypeStr = keyof typeof NODE_TYPE;

export const SYSTEM_TYPE = {
  waste: 0, vent: 1, cold_supply: 2, hot_supply: 3, storm: 4, condensate: 5,
} as const;
export type SystemTypeStr = keyof typeof SYSTEM_TYPE;

export const FIXTURE_SUBTYPE = {
  water_closet: 0, lavatory: 1, kitchen_sink: 2, bathtub: 3,
  shower: 4, floor_drain: 5, laundry_standpipe: 6, dishwasher: 7,
  clothes_washer: 8, hose_bibb: 9, urinal: 10, mop_sink: 11,
  drinking_fountain: 12,
  // Phase 14.Y + 14.AA additions
  water_heater: 13, tankless_water_heater: 14, bidet: 15,
  laundry_tub: 16, utility_sink: 17, expansion_tank: 18,
  backflow_preventer: 19, pressure_reducing_valve: 20,
  cleanout_access: 21,
} as const;
export type FixtureSubtypeStr = keyof typeof FIXTURE_SUBTYPE;
export const FIXTURE_SUBTYPE_NONE = 255;

export const PIPE_MATERIAL = {
  pvc_sch40: 0, pvc_sch80: 1, cpvc: 2, abs: 3,
  copper_type_l: 4, copper_type_m: 5, pex: 6,
  cast_iron: 7, ductile_iron: 8, galvanized_steel: 9,
} as const;
export type PipeMaterialStr = keyof typeof PIPE_MATERIAL;

// Reverse maps for readback
const NODE_TYPE_NAMES = Object.keys(NODE_TYPE) as NodeTypeStr[];
const SYSTEM_TYPE_NAMES = Object.keys(SYSTEM_TYPE) as SystemTypeStr[];
const FIXTURE_SUBTYPE_NAMES = Object.keys(FIXTURE_SUBTYPE) as FixtureSubtypeStr[];
const PIPE_MATERIAL_NAMES = Object.keys(PIPE_MATERIAL) as PipeMaterialStr[];

// ── Byte layout constants ──────────────────────────────────────

export const MAGIC = 0x454C4247; // "ELBG"
export const SCHEMA_VERSION = 1;
export const HEADER_BYTES = 64;
export const NODE_RECORD_BYTES = 32;
export const EDGE_RECORD_BYTES = 32;

// Header field offsets (in bytes from slab start)
const H_MAGIC = 0;       // u32
const H_SCHEMA = 4;      // u16
const H_FLAGS = 6;       // u16
const H_NODE_COUNT = 8;  // u32
const H_NODE_CAP = 12;   // u32
const H_EDGE_COUNT = 16; // u32
const H_EDGE_CAP = 20;   // u32
const H_ID_BYTES = 24;   // u32
const H_ID_CAP = 28;     // u32
const H_GEN = 32;        // u64 (written as [lo u32, hi u32])
const H_WRITER_LOCK = 40; // u32
// 16 bytes reserved after — bytes 44..63

// Node record field offsets (from record start)
const N_ID_OFFSET = 0;    // u32
const N_ID_LEN = 4;       // u16
const N_TYPE = 6;         // u8
const N_SYSTEM = 7;       // u8
const N_FIX_SUB = 8;      // u8
// 3 bytes pad at offsets 9..11
const N_DFU = 12;         // f32
const N_TRAP = 16;        // f32
const N_ELEV = 20;        // f32
const N_COLD = 24;        // f32
const N_HOT = 28;         // f32

// Edge record field offsets
const E_ID_OFFSET = 0;    // u32
const E_ID_LEN = 4;       // u16
const E_FROM_IDX = 6;     // u16
const E_TO_IDX = 8;       // u16
const E_MATERIAL = 10;    // u8
// 1 byte pad at offset 11
const E_DIAM = 12;        // f32
const E_LEN = 16;         // f32
const E_SLOPE = 20;       // f32
const E_ELEV_D = 24;      // f32
// 4 bytes reserved at offset 28

// ── Public helpers ─────────────────────────────────────────────

/** Is SharedArrayBuffer usable in the current context? */
export function isSabAvailable(): boolean {
  if (typeof SharedArrayBuffer === 'undefined') return false;
  // crossOriginIsolated requires COOP/COEP headers; not all dev/test
  // environments provide them. jsdom (our Vitest env) does NOT set
  // the global — we detect that and allow the SAB anyway for tests,
  // falling back only when truly unsupported.
  if (typeof globalThis !== 'undefined' &&
      'crossOriginIsolated' in globalThis &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (globalThis as any).crossOriginIsolated === false) {
    // Explicit false (running in a real browser without isolation).
    return false;
  }
  return true;
}

// ── Value types ────────────────────────────────────────────────

export interface PackedNodeInput {
  id: string;
  type: NodeTypeStr;
  system: SystemTypeStr;
  fixtureSubtype?: FixtureSubtypeStr;
  dfu: number;
  trapSize: number;
  elevation: number;
  coldWSFU: number;
  hotWSFU: number;
}

export interface PackedEdgeInput {
  id: string;
  fromNodeIdx: number;
  toNodeIdx: number;
  material: PipeMaterialStr;
  diameter: number;
  length: number;
  slope: number;
  elevationDelta: number;
}

export interface ReadNode extends PackedNodeInput {
  index: number;
}

export interface ReadEdge extends PackedEdgeInput {
  index: number;
}

// ── Capacity config ────────────────────────────────────────────

export interface DagBufferCapacity {
  nodes: number;
  edges: number;
  /** Bytes reserved for the UTF-8 id table. Typical id length ~14 chars,
   *  so default 32 × (nodes + edges) gives ~2× headroom. */
  idTableBytes?: number;
}

// ── Main class ─────────────────────────────────────────────────

export class SharedDagBuffer {
  readonly buffer: SharedArrayBuffer | ArrayBuffer;
  readonly capacity: Required<DagBufferCapacity>;
  private readonly view: DataView;
  private readonly u8: Uint8Array;

  /**
   * Offset of nodes slab in the buffer (immediately after header).
   */
  private readonly nodesOffset: number;
  /**
   * Offset of edges slab (after nodes).
   */
  private readonly edgesOffset: number;
  /**
   * Offset of id table (after edges).
   */
  private readonly idTableOffset: number;

  /** Pre-allocated TextEncoder / TextDecoder for id I/O. */
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder('utf-8', { fatal: false });

  constructor(
    capacity: DagBufferCapacity,
    sharedBuffer?: SharedArrayBuffer | ArrayBuffer,
  ) {
    // Id-table size must be 4-byte aligned so the whole buffer is too —
    // Int32Array (used by Atomics) requires alignment.
    const requested = capacity.idTableBytes
      ?? Math.max(1024, 32 * (capacity.nodes + capacity.edges));
    const idTableBytes = Math.ceil(requested / 4) * 4;
    this.capacity = { ...capacity, idTableBytes };

    this.nodesOffset = HEADER_BYTES;
    this.edgesOffset = this.nodesOffset + capacity.nodes * NODE_RECORD_BYTES;
    this.idTableOffset = this.edgesOffset + capacity.edges * EDGE_RECORD_BYTES;
    const totalBytes = this.idTableOffset + idTableBytes;

    if (sharedBuffer) {
      if (sharedBuffer.byteLength < totalBytes) {
        throw new Error(
          `SharedDagBuffer: provided buffer too small (${sharedBuffer.byteLength} < ${totalBytes})`,
        );
      }
      this.buffer = sharedBuffer;
    } else if (isSabAvailable()) {
      this.buffer = new SharedArrayBuffer(totalBytes);
    } else {
      // Fallback: plain ArrayBuffer. Semantics unchanged within one
      // agent, but no cross-thread sharing. Callers in production
      // should detect SAB and fall back to structured-clone IPC
      // instead; this ArrayBuffer path exists mainly for tests.
      this.buffer = new ArrayBuffer(totalBytes);
    }

    this.view = new DataView(this.buffer);
    this.u8 = new Uint8Array(this.buffer);

    // Initialize header if freshly allocated (magic == 0 means uninitialized)
    if (this.view.getUint32(H_MAGIC, true) !== MAGIC) {
      this.initHeader();
    }
  }

  /**
   * Detect SAB: when a buffer is shared across threads, Atomics calls
   * behave differently. For our purposes (same-agent tests) ArrayBuffer
   * still supports the full DataView API — atomics just become non-atomic.
   */
  get isShared(): boolean {
    return typeof SharedArrayBuffer !== 'undefined' &&
           this.buffer instanceof SharedArrayBuffer;
  }

  /** Total bytes allocated for this buffer. */
  get totalBytes(): number {
    return this.buffer.byteLength;
  }

  // ── Header ──────────────────────────────────────────────────

  private initHeader(): void {
    this.view.setUint32(H_MAGIC, MAGIC, true);
    this.view.setUint16(H_SCHEMA, SCHEMA_VERSION, true);
    this.view.setUint16(H_FLAGS, 0, true);
    this.view.setUint32(H_NODE_COUNT, 0, true);
    this.view.setUint32(H_NODE_CAP, this.capacity.nodes, true);
    this.view.setUint32(H_EDGE_COUNT, 0, true);
    this.view.setUint32(H_EDGE_CAP, this.capacity.edges, true);
    this.view.setUint32(H_ID_BYTES, 0, true);
    this.view.setUint32(H_ID_CAP, this.capacity.idTableBytes, true);
    this.view.setUint32(H_GEN, 0, true);
    this.view.setUint32(H_GEN + 4, 0, true); // high word of u64
    this.view.setUint32(H_WRITER_LOCK, 0, true);
  }

  get magic(): number { return this.view.getUint32(H_MAGIC, true); }
  get schemaVersion(): number { return this.view.getUint16(H_SCHEMA, true); }
  get nodeCount(): number { return this.view.getUint32(H_NODE_COUNT, true); }
  get edgeCount(): number { return this.view.getUint32(H_EDGE_COUNT, true); }
  get idTableBytesUsed(): number { return this.view.getUint32(H_ID_BYTES, true); }

  /** Monotonic generation counter. Bumped on each write commit. */
  get generation(): bigint {
    const lo = BigInt(this.view.getUint32(H_GEN, true));
    const hi = BigInt(this.view.getUint32(H_GEN + 4, true));
    return (hi << 32n) | lo;
  }

  private bumpGeneration(): void {
    const lo = this.view.getUint32(H_GEN, true);
    const hi = this.view.getUint32(H_GEN + 4, true);
    // 64-bit increment with carry
    if (lo === 0xFFFFFFFF) {
      this.view.setUint32(H_GEN, 0, true);
      this.view.setUint32(H_GEN + 4, (hi + 1) >>> 0, true);
    } else {
      this.view.setUint32(H_GEN, (lo + 1) >>> 0, true);
    }
  }

  // ── Writer protocol ─────────────────────────────────────────

  /**
   * Acquire the writer lock (spin-wait bounded by maxAttempts).
   * Returns true on success. Callers MUST call endWrite() after.
   *
   * On ArrayBuffer (non-shared) builds, this is a plain write and
   * always returns true — no contention is possible.
   */
  beginWrite(maxAttempts: number = 1000): boolean {
    if (!this.isShared) {
      this.view.setUint32(H_WRITER_LOCK, 1, true);
      return true;
    }
    // Atomics work only on Int32Array views over a SharedArrayBuffer.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const i32 = new Int32Array((this.buffer as any) as SharedArrayBuffer);
    const lockIndex = H_WRITER_LOCK / 4;
    for (let i = 0; i < maxAttempts; i++) {
      if (Atomics.compareExchange(i32, lockIndex, 0, 1) === 0) return true;
      // Small backoff — yield to other threads
      Atomics.wait(i32, lockIndex, 1, 1);
    }
    return false;
  }

  /** Release the writer lock AND bump the generation counter. */
  endWrite(): void {
    this.bumpGeneration();
    if (!this.isShared) {
      this.view.setUint32(H_WRITER_LOCK, 0, true);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const i32 = new Int32Array((this.buffer as any) as SharedArrayBuffer);
    Atomics.store(i32, H_WRITER_LOCK / 4, 0);
    Atomics.notify(i32, H_WRITER_LOCK / 4);
  }

  // ── ID table ────────────────────────────────────────────────

  /**
   * Write a UTF-8 string into the ID table. Returns { offset, length }
   * referring to the position in the table. Throws if the table is full.
   */
  private writeId(id: string): { offset: number; length: number } {
    const encoded = this.encoder.encode(id);
    const used = this.view.getUint32(H_ID_BYTES, true);
    const cap = this.capacity.idTableBytes;
    if (used + encoded.length > cap) {
      throw new Error(
        `SharedDagBuffer: ID table overflow ` +
        `(need ${used + encoded.length} bytes, have ${cap})`,
      );
    }
    const absOffset = this.idTableOffset + used;
    this.u8.set(encoded, absOffset);
    this.view.setUint32(H_ID_BYTES, used + encoded.length, true);
    return { offset: used, length: encoded.length };
  }

  private readId(relativeOffset: number, length: number): string {
    const absOffset = this.idTableOffset + relativeOffset;
    return this.decoder.decode(
      this.u8.subarray(absOffset, absOffset + length),
    );
  }

  // ── Writing ────────────────────────────────────────────────

  /**
   * Replace the entire graph in one atomic write. Convenience for the
   * setGraph path — matches today's SET_GRAPH message.
   */
  writeGraph(nodes: PackedNodeInput[], edges: PackedEdgeInput[]): void {
    if (nodes.length > this.capacity.nodes) {
      throw new Error(
        `SharedDagBuffer: too many nodes (${nodes.length} > ${this.capacity.nodes})`,
      );
    }
    if (edges.length > this.capacity.edges) {
      throw new Error(
        `SharedDagBuffer: too many edges (${edges.length} > ${this.capacity.edges})`,
      );
    }

    if (!this.beginWrite()) {
      throw new Error('SharedDagBuffer: timed out acquiring writer lock');
    }
    try {
      // Reset the ID table
      this.view.setUint32(H_ID_BYTES, 0, true);

      // Write nodes
      for (let i = 0; i < nodes.length; i++) {
        this.writeNodeAt(i, nodes[i]!);
      }
      this.view.setUint32(H_NODE_COUNT, nodes.length, true);

      // Write edges
      for (let i = 0; i < edges.length; i++) {
        this.writeEdgeAt(i, edges[i]!);
      }
      this.view.setUint32(H_EDGE_COUNT, edges.length, true);
    } finally {
      this.endWrite();
    }
  }

  private writeNodeAt(index: number, node: PackedNodeInput): void {
    const { offset, length } = this.writeId(node.id);
    const rec = this.nodesOffset + index * NODE_RECORD_BYTES;
    this.view.setUint32(rec + N_ID_OFFSET, offset, true);
    this.view.setUint16(rec + N_ID_LEN, length, true);
    this.view.setUint8(rec + N_TYPE, NODE_TYPE[node.type]);
    this.view.setUint8(rec + N_SYSTEM, SYSTEM_TYPE[node.system]);
    this.view.setUint8(rec + N_FIX_SUB,
      node.fixtureSubtype ? FIXTURE_SUBTYPE[node.fixtureSubtype] : FIXTURE_SUBTYPE_NONE,
    );
    this.view.setFloat32(rec + N_DFU, node.dfu, true);
    this.view.setFloat32(rec + N_TRAP, node.trapSize, true);
    this.view.setFloat32(rec + N_ELEV, node.elevation, true);
    this.view.setFloat32(rec + N_COLD, node.coldWSFU, true);
    this.view.setFloat32(rec + N_HOT, node.hotWSFU, true);
  }

  private writeEdgeAt(index: number, edge: PackedEdgeInput): void {
    const { offset, length } = this.writeId(edge.id);
    const rec = this.edgesOffset + index * EDGE_RECORD_BYTES;
    this.view.setUint32(rec + E_ID_OFFSET, offset, true);
    this.view.setUint16(rec + E_ID_LEN, length, true);
    this.view.setUint16(rec + E_FROM_IDX, edge.fromNodeIdx, true);
    this.view.setUint16(rec + E_TO_IDX, edge.toNodeIdx, true);
    this.view.setUint8(rec + E_MATERIAL, PIPE_MATERIAL[edge.material]);
    this.view.setFloat32(rec + E_DIAM, edge.diameter, true);
    this.view.setFloat32(rec + E_LEN, edge.length, true);
    this.view.setFloat32(rec + E_SLOPE, edge.slope, true);
    this.view.setFloat32(rec + E_ELEV_D, edge.elevationDelta, true);
  }

  // ── Reading (sequence-lock) ────────────────────────────────

  readNodeAt(index: number): ReadNode {
    const n = this.nodeCount;
    if (index < 0 || index >= n) {
      throw new RangeError(`SharedDagBuffer.readNodeAt: index ${index} out of range (count=${n})`);
    }
    const rec = this.nodesOffset + index * NODE_RECORD_BYTES;
    const idOffset = this.view.getUint32(rec + N_ID_OFFSET, true);
    const idLen = this.view.getUint16(rec + N_ID_LEN, true);
    const fixSubByte = this.view.getUint8(rec + N_FIX_SUB);
    return {
      index,
      id: this.readId(idOffset, idLen),
      type: NODE_TYPE_NAMES[this.view.getUint8(rec + N_TYPE)]!,
      system: SYSTEM_TYPE_NAMES[this.view.getUint8(rec + N_SYSTEM)]!,
      fixtureSubtype: fixSubByte === FIXTURE_SUBTYPE_NONE
        ? undefined
        : FIXTURE_SUBTYPE_NAMES[fixSubByte],
      dfu: this.view.getFloat32(rec + N_DFU, true),
      trapSize: this.view.getFloat32(rec + N_TRAP, true),
      elevation: this.view.getFloat32(rec + N_ELEV, true),
      coldWSFU: this.view.getFloat32(rec + N_COLD, true),
      hotWSFU: this.view.getFloat32(rec + N_HOT, true),
    };
  }

  readEdgeAt(index: number): ReadEdge {
    const n = this.edgeCount;
    if (index < 0 || index >= n) {
      throw new RangeError(`SharedDagBuffer.readEdgeAt: index ${index} out of range (count=${n})`);
    }
    const rec = this.edgesOffset + index * EDGE_RECORD_BYTES;
    const idOffset = this.view.getUint32(rec + E_ID_OFFSET, true);
    const idLen = this.view.getUint16(rec + E_ID_LEN, true);
    return {
      index,
      id: this.readId(idOffset, idLen),
      fromNodeIdx: this.view.getUint16(rec + E_FROM_IDX, true),
      toNodeIdx: this.view.getUint16(rec + E_TO_IDX, true),
      material: PIPE_MATERIAL_NAMES[this.view.getUint8(rec + E_MATERIAL)]!,
      diameter: this.view.getFloat32(rec + E_DIAM, true),
      length: this.view.getFloat32(rec + E_LEN, true),
      slope: this.view.getFloat32(rec + E_SLOPE, true),
      elevationDelta: this.view.getFloat32(rec + E_ELEV_D, true),
    };
  }

  /**
   * Read the entire graph consistent-snapshot style using the
   * sequence-lock pattern. Retries if the writer committed mid-read.
   * maxRetries protects against a pathological writer storm.
   */
  readGraph(maxRetries: number = 8): { nodes: ReadNode[]; edges: ReadEdge[]; generation: bigint } {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const genBefore = this.generation;
      const nodeCount = this.nodeCount;
      const edgeCount = this.edgeCount;
      const nodes: ReadNode[] = new Array(nodeCount);
      const edges: ReadEdge[] = new Array(edgeCount);

      for (let i = 0; i < nodeCount; i++) nodes[i] = this.readNodeAt(i);
      for (let i = 0; i < edgeCount; i++) edges[i] = this.readEdgeAt(i);

      const genAfter = this.generation;
      if (genAfter === genBefore) {
        return { nodes, edges, generation: genAfter };
      }
      // Writer committed mid-read; retry.
    }
    throw new Error(
      `SharedDagBuffer.readGraph: ${maxRetries + 1} retries exhausted — writer storm`,
    );
  }
}

// ── Byte-size calculator (for buffer provisioning before construct) ──

/**
 * Compute the buffer byte size needed for a given capacity WITHOUT
 * allocating. Useful for pre-allocation in the main thread before
 * handing the SharedArrayBuffer to the worker.
 */
export function dagBufferSize(capacity: DagBufferCapacity): number {
  const requested = capacity.idTableBytes
    ?? Math.max(1024, 32 * (capacity.nodes + capacity.edges));
  const idTable = Math.ceil(requested / 4) * 4;
  return (
    HEADER_BYTES +
    capacity.nodes * NODE_RECORD_BYTES +
    capacity.edges * EDGE_RECORD_BYTES +
    idTable
  );
}
