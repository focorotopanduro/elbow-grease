/**
 * fittingCache — Phase 14.T
 *
 * Per-pipe memoization for the `generateBendFittings` pipeline.
 *
 * Problem:
 *   `generateAllFittings(pipes)` did a full O(P·M) pass on every
 *   pipe-store tick. With 500+ pipes + group edits (14.M/N/O that
 *   touch many pipes at once), the cost showed up as frame hitches
 *   during multi-select rotations and mass-edit commits.
 *
 * Key insight:
 *   Bend fitting generation is **pure per pipe** — the fittings for
 *   pipe A don't depend on pipe B. Only junction fittings cross pipes
 *   (and those we still regenerate each time because they're
 *   cheap O(J) where J is the junction count, much smaller than
 *   O(P·M) bends).
 *
 * Approach:
 *   Content-addressed per-pipe cache keyed on `{pipe.id, hash}`.
 *   Hash covers the fields that affect bend output: points, diameter,
 *   material. Everything else (selected, color, visibility, system)
 *   is irrelevant to bend generation — so a pipe flipped to
 *   `selected: true` scores a cache HIT.
 *
 * Non-goals:
 *   • Cross-pipe caching. Junctions still recompute each call.
 *   • LRU eviction. Cache scales with pipe count, which scales with
 *     project size. A 10K-pipe project would use ~2–4 MB of cached
 *     fitting arrays — well within budget. If we ever care we can
 *     cap + evict later.
 *   • Async regeneration. `generateBendFittings` is cheap per pipe
 *     (< 1 ms). Staying sync keeps the data flow simple.
 */

import type { CommittedPipe } from '../../store/pipeStore';
import {
  generateBendFittings,
  generateFlexibleBendWarnings,
  type FittingInstance,
} from '@ui/pipe/FittingGenerator';

// ── Hashing ───────────────────────────────────────────────────

/**
 * Serialize the fields of a pipe that affect bend + flex-warning
 * output. Joined with delimiters that can't appear in the values, so
 * collision risk is only from mathematically-identical inputs (which
 * SHOULD return identical fittings anyway).
 *
 * Coordinate precision: fixed-6 decimals. Float drift below 1µft is
 * below a reasonable snap tolerance and won't affect fitting output,
 * so we trade a tiny quantization for cache stability under
 * re-serialized (e.g. bundle-reloaded) points.
 */
export function pipeFittingHash(pipe: CommittedPipe): string {
  const pts = pipe.points
    .map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)},${p[2].toFixed(6)}`)
    .join(';');
  return `${pipe.material}|${pipe.diameter}|${pts}`;
}

// ── Cache ─────────────────────────────────────────────────────

interface CacheEntry {
  /**
   * Phase 14.AD.2 — object-reference fast path. Zustand immutable
   * updates mean an unchanged pipe keeps its object identity across
   * renders, so `pipe === entry.pipeRef` is a zero-allocation O(1)
   * cache hit. The hash fallback below still runs when the ref
   * differs (serialized-reloaded bundles, fresh-constructed test
   * pipes) so behaviour is never regressed.
   */
  pipeRef: CommittedPipe;
  hash: string;
  bends: FittingInstance[];
  flexWarnings: FittingInstance[];
}

export interface FittingCacheStats {
  /** Total cache hits = fastHits + slowHits. Kept for back-compat. */
  hits: number;
  /** Phase 14.AD.2 — hits via `pipe === entry.pipeRef` (no hashing). */
  fastHits: number;
  /** Hits via content-hash fallback (unchanged pipe with new object ref). */
  slowHits: number;
  misses: number;
  evictions: number;
  size: number;
}

export class FittingCache {
  private entries = new Map<string, CacheEntry>();
  private _fastHits = 0;
  private _slowHits = 0;
  private _misses = 0;
  private _evictions = 0;

  /**
   * Bend + flex-warning fittings for a single pipe. Returns cached
   * arrays on hit (direct identity, no copy — caller MUST NOT mutate).
   *
   * Hit path (14.AD.2):
   *   1. Object-identity match (pipe === entry.pipeRef) → O(1) hit.
   *   2. Content-hash match (same points/material/diameter under
   *      a different object ref) → promotes entry.pipeRef to the
   *      new object so next call hits fast. Backward-compat for
   *      serialized reloads and tests that construct fresh pipes
   *      with identical content.
   *   3. Neither → recompute and store.
   */
  getPerPipe(pipe: CommittedPipe): {
    bends: FittingInstance[];
    flexWarnings: FittingInstance[];
  } {
    const existing = this.entries.get(pipe.id);

    // Fast path — Zustand's common case
    if (existing && existing.pipeRef === pipe) {
      this._fastHits++;
      return { bends: existing.bends, flexWarnings: existing.flexWarnings };
    }

    // Slow path — content-addressed fallback
    const hash = pipeFittingHash(pipe);
    if (existing && existing.hash === hash) {
      // Same content, different ref — upgrade the ref pointer so
      // the next call gets the fast path.
      existing.pipeRef = pipe;
      this._slowHits++;
      return { bends: existing.bends, flexWarnings: existing.flexWarnings };
    }

    this._misses++;
    const bends = generateBendFittings(pipe);
    const flexWarnings = generateFlexibleBendWarnings(pipe);
    this.entries.set(pipe.id, { pipeRef: pipe, hash, bends, flexWarnings });
    return { bends, flexWarnings };
  }

  /**
   * Drop cache entries for pipes that aren't in `currentPipeIds`.
   * Called by the renderer on every update so deleted pipes' fittings
   * don't linger (avoiding memory bloat across a long session).
   */
  pruneMissing(currentPipeIds: ReadonlySet<string>): number {
    let count = 0;
    for (const id of this.entries.keys()) {
      if (!currentPipeIds.has(id)) {
        this.entries.delete(id);
        this._evictions++;
        count++;
      }
    }
    return count;
  }

  /** Fully reset. Used by integration tests + Ctrl+Alt+R recovery. */
  clear(): void {
    this.entries.clear();
    this._fastHits = 0;
    this._slowHits = 0;
    this._misses = 0;
    this._evictions = 0;
  }

  /** Drop a single pipe's cache entry. Useful for direct invalidation. */
  invalidate(pipeId: string): boolean {
    const had = this.entries.delete(pipeId);
    if (had) this._evictions++;
    return had;
  }

  stats(): FittingCacheStats {
    return {
      hits: this._fastHits + this._slowHits,
      fastHits: this._fastHits,
      slowHits: this._slowHits,
      misses: this._misses,
      evictions: this._evictions,
      size: this.entries.size,
    };
  }

  /**
   * Convenience: aggregate bend + flex fittings across a pipe list,
   * pruning entries for absent pipes at the end. Used by
   * FittingRenderer to replace the old `generateAllFittings` for the
   * per-pipe portion.
   */
  collectPerPipe(pipes: readonly CommittedPipe[]): FittingInstance[] {
    const out: FittingInstance[] = [];
    const seen = new Set<string>();
    for (const p of pipes) {
      seen.add(p.id);
      const { bends, flexWarnings } = this.getPerPipe(p);
      for (const b of bends) out.push(b);
      for (const f of flexWarnings) out.push(f);
    }
    this.pruneMissing(seen);
    return out;
  }
}

// ── Singleton accessor ────────────────────────────────────────

let _instance: FittingCache | null = null;

/**
 * Shared cache. One instance per app so FittingRenderer, potential
 * export paths, and future diagnostic tooling hit the same memo.
 */
export function getFittingCache(): FittingCache {
  if (!_instance) _instance = new FittingCache();
  return _instance;
}

/** Reset the shared cache. Test helper. */
export function __resetFittingCache(): void {
  _instance = null;
}
