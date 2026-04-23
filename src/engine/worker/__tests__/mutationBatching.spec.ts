/**
 * mutationBatching — Phase 14.AC.3 tests.
 *
 * The pure builder. Verifies node/edge shape, ID conventions, and
 * batch composition including the add-then-remove cancellation rule.
 */

import { describe, it, expect } from 'vitest';
import {
  pipeToMutations,
  pipeGraphIds,
  composeMutationBatch,
  isEmptyBatch,
  nodeIdAt,
  edgeIdAt,
  type PipeCommit,
} from '../mutationBatching';

// ── Helpers ──────────────────────────────────────────────────

function makeCommit(id: string, pts: number): PipeCommit {
  return {
    id,
    points: Array.from({ length: pts }, (_, i) => [i, 0, 0] as [number, number, number]),
    diameter: 2,
    material: 'pvc_sch40',
  };
}

// ── pipeToMutations ──────────────────────────────────────────

describe('pipeToMutations — shape', () => {
  it('2-point pipe → 2 nodes + 1 edge', () => {
    const { nodes, edges } = pipeToMutations(makeCommit('p', 2));
    expect(nodes).toHaveLength(2);
    expect(edges).toHaveLength(1);
  });

  it('5-point pipe → 5 nodes + 4 edges', () => {
    const { nodes, edges } = pipeToMutations(makeCommit('p', 5));
    expect(nodes).toHaveLength(5);
    expect(edges).toHaveLength(4);
  });

  it('node IDs follow wp-{pipeId}-{index}', () => {
    const { nodes } = pipeToMutations(makeCommit('abc', 3));
    expect(nodes.map((n) => n.id)).toEqual(['wp-abc-0', 'wp-abc-1', 'wp-abc-2']);
  });

  it('edge IDs follow edge-{pipeId}-{index-from-1}', () => {
    const { edges } = pipeToMutations(makeCommit('abc', 3));
    expect(edges.map((e) => e.id)).toEqual(['edge-abc-1', 'edge-abc-2']);
  });

  it('edge from/to reference the correct waypoint nodes', () => {
    const { edges } = pipeToMutations(makeCommit('r', 4));
    expect(edges[0]!.from).toBe('wp-r-0');
    expect(edges[0]!.to).toBe('wp-r-1');
    expect(edges[2]!.from).toBe('wp-r-2');
    expect(edges[2]!.to).toBe('wp-r-3');
  });

  it('preserves material + diameter on every edge', () => {
    const commit: PipeCommit = {
      id: 'p', points: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], diameter: 3, material: 'copper_type_l',
    };
    const { edges } = pipeToMutations(commit);
    for (const e of edges) {
      expect(e.material).toBe('copper_type_l');
      expect(e.diameter).toBe(3);
    }
  });

  it('edge length is Euclidean', () => {
    const commit: PipeCommit = {
      id: 'p', points: [[0, 0, 0], [3, 4, 0]], diameter: 2, material: 'pvc_sch40',
    };
    const { edges } = pipeToMutations(commit);
    expect(edges[0]!.length).toBeCloseTo(5.0, 5);
  });

  it('vertical drop produces non-zero slope', () => {
    const commit: PipeCommit = {
      id: 'p', points: [[0, 10, 0], [10, 9.75, 0]], diameter: 2, material: 'pvc_sch40',
    };
    const { edges } = pipeToMutations(commit);
    // 0.25 / 10 = 2.5% → ×12 = 0.30 in/ft
    expect(edges[0]!.slope).toBeGreaterThan(0.25);
    expect(edges[0]!.slope).toBeLessThan(0.35);
    expect(edges[0]!.elevationDelta).toBeCloseTo(-0.25, 5);
  });

  it('default system is waste (solver reassigns)', () => {
    const { nodes } = pipeToMutations(makeCommit('p', 2));
    expect(nodes[0]!.system).toBe('waste');
  });

  it('explicit system is preserved', () => {
    const { nodes } = pipeToMutations({
      ...makeCommit('p', 2),
      system: 'cold_supply',
    });
    expect(nodes[0]!.system).toBe('cold_supply');
  });
});

// ── pipeGraphIds ─────────────────────────────────────────────

describe('pipeGraphIds', () => {
  it('enumerates the node + edge IDs a committed pipe owns', () => {
    const { nodeIds, edgeIds } = pipeGraphIds('p', 4);
    expect(nodeIds).toEqual(['wp-p-0', 'wp-p-1', 'wp-p-2', 'wp-p-3']);
    expect(edgeIds).toEqual(['edge-p-1', 'edge-p-2', 'edge-p-3']);
  });

  it('0 points → no ids', () => {
    const { nodeIds, edgeIds } = pipeGraphIds('p', 0);
    expect(nodeIds).toEqual([]);
    expect(edgeIds).toEqual([]);
  });

  it('1 point → 1 node, 0 edges (degenerate but well-defined)', () => {
    const { nodeIds, edgeIds } = pipeGraphIds('p', 1);
    expect(nodeIds).toEqual(['wp-p-0']);
    expect(edgeIds).toEqual([]);
  });
});

// ── composeMutationBatch ─────────────────────────────────────

describe('composeMutationBatch — simple cases', () => {
  it('one pipe → nodes + edges, no removals', () => {
    const b = composeMutationBatch([makeCommit('a', 3)], [], []);
    expect(b.nodesToAdd).toHaveLength(3);
    expect(b.edgesToAdd).toHaveLength(2);
    expect(b.nodeIdsToRemove).toHaveLength(0);
    expect(b.edgeIdsToRemove).toHaveLength(0);
  });

  it('three pipes concatenate', () => {
    const b = composeMutationBatch(
      [makeCommit('a', 2), makeCommit('b', 2), makeCommit('c', 2)],
      [],
      [],
    );
    expect(b.nodesToAdd).toHaveLength(6);
    expect(b.edgesToAdd).toHaveLength(3);
  });

  it('removal IDs pass through when no adds conflict', () => {
    const b = composeMutationBatch([], ['wp-x-0', 'wp-x-1'], ['edge-x-1']);
    expect(b.nodeIdsToRemove).toEqual(['wp-x-0', 'wp-x-1']);
    expect(b.edgeIdsToRemove).toEqual(['edge-x-1']);
  });
});

describe('composeMutationBatch — add+remove cancellation', () => {
  it('pipe added AND removed in same batch cancels net → empty adds, empty removes', () => {
    const added = makeCommit('x', 3);
    const b = composeMutationBatch(
      [added],
      ['wp-x-0', 'wp-x-1', 'wp-x-2'],
      ['edge-x-1', 'edge-x-2'],
    );
    expect(b.nodesToAdd).toHaveLength(0);
    expect(b.edgesToAdd).toHaveLength(0);
    expect(b.nodeIdsToRemove).toHaveLength(0);
    expect(b.edgeIdsToRemove).toHaveLength(0);
  });

  it('partial overlap: some add IDs match some remove IDs, rest survive', () => {
    const b = composeMutationBatch(
      [makeCommit('x', 2), makeCommit('y', 2)],
      ['wp-x-0', 'wp-x-1'], // cancels x only
      ['edge-x-1'],         // cancels x edge
    );
    // y's nodes + edges remain; x is fully cancelled
    expect(b.nodesToAdd.map((n) => n.id)).toEqual(['wp-y-0', 'wp-y-1']);
    expect(b.edgesToAdd.map((e) => e.id)).toEqual(['edge-y-1']);
    expect(b.nodeIdsToRemove).toEqual([]);
    expect(b.edgeIdsToRemove).toEqual([]);
  });

  it('removal ID that does NOT match any added pipe survives', () => {
    const b = composeMutationBatch(
      [makeCommit('y', 2)],
      ['wp-stranger-0'],
      ['edge-stranger-1'],
    );
    expect(b.nodeIdsToRemove).toEqual(['wp-stranger-0']);
    expect(b.edgeIdsToRemove).toEqual(['edge-stranger-1']);
  });
});

// ── isEmptyBatch ─────────────────────────────────────────────

describe('isEmptyBatch', () => {
  it('true on a blank batch', () => {
    expect(isEmptyBatch({ nodesToAdd: [], edgesToAdd: [], nodeIdsToRemove: [], edgeIdsToRemove: [] })).toBe(true);
  });

  it('false on any non-empty list', () => {
    const b = composeMutationBatch([makeCommit('a', 2)], [], []);
    expect(isEmptyBatch(b)).toBe(false);
  });
});

// ── ID conventions ───────────────────────────────────────────

describe('ID helpers stay stable', () => {
  it('nodeIdAt follows wp-{pipeId}-{i}', () => {
    expect(nodeIdAt('route-1', 0)).toBe('wp-route-1-0');
  });
  it('edgeIdAt follows edge-{pipeId}-{i}', () => {
    expect(edgeIdAt('route-1', 3)).toBe('edge-route-1-3');
  });
});

// ── Realism ──────────────────────────────────────────────────

describe('mutationBatching — realistic scenarios', () => {
  it('riser-drop: 4 pipes × 3 points produces 1 batch with 12 nodes + 8 edges', () => {
    const commits = [makeCommit('r1', 3), makeCommit('r2', 3), makeCommit('r3', 3), makeCommit('r4', 3)];
    const b = composeMutationBatch(commits, [], []);
    expect(b.nodesToAdd).toHaveLength(12);
    expect(b.edgesToAdd).toHaveLength(8);
  });

  it('paste-20-pipes: 20 × 4 points = 80 nodes + 60 edges in one batch', () => {
    const commits = Array.from({ length: 20 }, (_, i) => makeCommit(`p${i}`, 4));
    const b = composeMutationBatch(commits, [], []);
    expect(b.nodesToAdd).toHaveLength(80);
    expect(b.edgesToAdd).toHaveLength(60);
    // The whole point: pre-14.AC.3 this was 160 postMessages.
    // Now it's 1 + 1 response. Not directly testable here, but the
    // SimulationBridge spec covers that end.
  });
});
