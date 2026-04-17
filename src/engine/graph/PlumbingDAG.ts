/**
 * Plumbing DAG — directed acyclic graph of the plumbing network.
 *
 * This is THE canonical data structure for the simulation engine.
 * All engineering calculations operate on this graph, never on
 * 3D geometry. The visual engine receives computed results via
 * the MessageBus.
 *
 * Key operations:
 *   - addNode / removeNode / getNode
 *   - addEdge / removeEdge / getEdge
 *   - topologicalSort (Kahn's algorithm — O(V+E))
 *   - reverseTopologicalSort (for backward propagation)
 *   - detectCycles (rejects invalid plumbing networks)
 *   - getUpstream / getDownstream (neighbor queries)
 *   - getPath (trace from any node to source/drain)
 *   - subgraph (extract waste-only, supply-only, etc.)
 */

import type { GraphNode, SystemType } from './GraphNode';
import type { GraphEdge } from './GraphEdge';

// ── Adjacency representation ────────────────────────────────────

export class PlumbingDAG {
  private nodes = new Map<string, GraphNode>();
  private edges = new Map<string, GraphEdge>();

  /** node ID → outgoing edge IDs. */
  private outgoing = new Map<string, Set<string>>();
  /** node ID → incoming edge IDs. */
  private incoming = new Map<string, Set<string>>();

  /** Cached topological order (invalidated on mutation). */
  private topoCache: string[] | null = null;

  // ── Mutation ────────────────────────────────────────────────

  addNode(node: GraphNode): void {
    this.nodes.set(node.id, node);
    if (!this.outgoing.has(node.id)) this.outgoing.set(node.id, new Set());
    if (!this.incoming.has(node.id)) this.incoming.set(node.id, new Set());
    this.topoCache = null;
  }

  removeNode(id: string): void {
    // Remove all connected edges first
    const out = this.outgoing.get(id);
    const inc = this.incoming.get(id);
    if (out) for (const eId of out) this.edges.delete(eId);
    if (inc) for (const eId of inc) this.edges.delete(eId);
    this.outgoing.delete(id);
    this.incoming.delete(id);
    this.nodes.delete(id);
    // Clean up edge references in other nodes' adjacency sets
    for (const [, s] of this.outgoing) for (const eId of [...s]) {
      if (!this.edges.has(eId)) s.delete(eId);
    }
    for (const [, s] of this.incoming) for (const eId of [...s]) {
      if (!this.edges.has(eId)) s.delete(eId);
    }
    this.topoCache = null;
  }

  addEdge(edge: GraphEdge): void {
    if (!this.nodes.has(edge.from) || !this.nodes.has(edge.to)) {
      throw new Error(`Edge ${edge.id}: both nodes must exist (${edge.from} → ${edge.to})`);
    }
    this.edges.set(edge.id, edge);
    this.outgoing.get(edge.from)!.add(edge.id);
    this.incoming.get(edge.to)!.add(edge.id);
    this.topoCache = null;
  }

  removeEdge(id: string): void {
    const edge = this.edges.get(id);
    if (!edge) return;
    this.outgoing.get(edge.from)?.delete(id);
    this.incoming.get(edge.to)?.delete(id);
    this.edges.delete(id);
    this.topoCache = null;
  }

  // ── Queries ─────────────────────────────────────────────────

  getNode(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  getEdge(id: string): GraphEdge | undefined {
    return this.edges.get(id);
  }

  getAllNodes(): GraphNode[] {
    return [...this.nodes.values()];
  }

  getAllEdges(): GraphEdge[] {
    return [...this.edges.values()];
  }

  get nodeCount(): number { return this.nodes.size; }
  get edgeCount(): number { return this.edges.size; }

  /** Get all edges leaving a node. */
  getOutgoingEdges(nodeId: string): GraphEdge[] {
    const eIds = this.outgoing.get(nodeId);
    if (!eIds) return [];
    return [...eIds].map((id) => this.edges.get(id)!).filter(Boolean);
  }

  /** Get all edges entering a node. */
  getIncomingEdges(nodeId: string): GraphEdge[] {
    const eIds = this.incoming.get(nodeId);
    if (!eIds) return [];
    return [...eIds].map((id) => this.edges.get(id)!).filter(Boolean);
  }

  /** Get downstream neighbor node IDs. */
  getDownstream(nodeId: string): string[] {
    return this.getOutgoingEdges(nodeId).map((e) => e.to);
  }

  /** Get upstream neighbor node IDs. */
  getUpstream(nodeId: string): string[] {
    return this.getIncomingEdges(nodeId).map((e) => e.from);
  }

  /** Get nodes with no incoming edges (sources / fixture terminals). */
  getRoots(): GraphNode[] {
    return [...this.nodes.values()].filter(
      (n) => (this.incoming.get(n.id)?.size ?? 0) === 0,
    );
  }

  /** Get nodes with no outgoing edges (drains / terminals). */
  getLeaves(): GraphNode[] {
    return [...this.nodes.values()].filter(
      (n) => (this.outgoing.get(n.id)?.size ?? 0) === 0,
    );
  }

  // ── Topological sort (Kahn's algorithm) ─────────────────────

  /**
   * Returns node IDs in topological order (upstream → downstream).
   * Throws if the graph contains a cycle.
   */
  topologicalSort(): string[] {
    if (this.topoCache) return this.topoCache;

    const inDegree = new Map<string, number>();
    for (const [id] of this.nodes) {
      inDegree.set(id, this.incoming.get(id)?.size ?? 0);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const sorted: string[] = [];

    while (queue.length > 0) {
      const nodeId = queue.shift()!;
      sorted.push(nodeId);

      for (const edge of this.getOutgoingEdges(nodeId)) {
        const deg = (inDegree.get(edge.to) ?? 1) - 1;
        inDegree.set(edge.to, deg);
        if (deg === 0) queue.push(edge.to);
      }
    }

    if (sorted.length !== this.nodes.size) {
      throw new Error(
        `Cycle detected: topological sort visited ${sorted.length} of ${this.nodes.size} nodes`,
      );
    }

    this.topoCache = sorted;
    return sorted;
  }

  /** Reverse topological order (downstream → upstream). */
  reverseTopologicalSort(): string[] {
    return [...this.topologicalSort()].reverse();
  }

  /** Check for cycles without throwing. */
  hasCycles(): boolean {
    try {
      this.topologicalSort();
      return false;
    } catch {
      return true;
    }
  }

  // ── Subgraph extraction ─────────────────────────────────────

  /** Extract a subgraph containing only nodes of a given system type. */
  subgraph(system: SystemType): PlumbingDAG {
    const sub = new PlumbingDAG();
    for (const node of this.nodes.values()) {
      if (node.system === system) sub.addNode(node);
    }
    for (const edge of this.edges.values()) {
      if (sub.getNode(edge.from) && sub.getNode(edge.to)) {
        sub.addEdge(edge);
      }
    }
    return sub;
  }

  // ── Path tracing ──────────────────────────────────────────────

  /** Trace from a node downstream to a terminal (BFS, first path found). */
  traceDownstream(startId: string): string[] {
    const path: string[] = [startId];
    const visited = new Set<string>([startId]);
    let current = startId;

    while (true) {
      const downstream = this.getDownstream(current).filter((id) => !visited.has(id));
      if (downstream.length === 0) break;
      current = downstream[0]!;
      visited.add(current);
      path.push(current);
    }

    return path;
  }

  /** Trace from a node upstream to a root (BFS, first path found). */
  traceUpstream(startId: string): string[] {
    const path: string[] = [startId];
    const visited = new Set<string>([startId]);
    let current = startId;

    while (true) {
      const upstream = this.getUpstream(current).filter((id) => !visited.has(id));
      if (upstream.length === 0) break;
      current = upstream[0]!;
      visited.add(current);
      path.push(current);
    }

    return path.reverse();
  }

  // ── Serialization ─────────────────────────────────────────────

  /** Serialize to a plain object (for Web Worker transfer). */
  serialize(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    return {
      nodes: this.getAllNodes(),
      edges: this.getAllEdges(),
    };
  }

  /** Deserialize from a plain object. */
  static deserialize(data: { nodes: GraphNode[]; edges: GraphEdge[] }): PlumbingDAG {
    const dag = new PlumbingDAG();
    for (const node of data.nodes) dag.addNode(node);
    for (const edge of data.edges) dag.addEdge(edge);
    return dag;
  }
}
