/**
 * MemoryFsAdapter — synchronous, in-memory implementation of FsAdapter.
 *
 * Purposes:
 *   1. Unit tests: no disk IO, deterministic, parallelizable.
 *   2. Crash-point fuzz: we can model "kill mid-write" by deciding how
 *      far a write got before the process "died". The adapter exposes
 *      a `simulateWriteFailure()` hook that the fuzz test uses.
 *   3. Non-Tauri fallback: on a web preview of the app, AutoSave stays
 *      in localStorage; a MemoryFsAdapter keeps the bundle format
 *      consistent with production so the code path is the same.
 *
 * Not designed to persist across reloads. Used as a harness.
 */

import type { FsAdapter, FsStat } from './FsAdapter';

type Entry =
  | { kind: 'file'; contents: string }
  | { kind: 'dir' };

/**
 * Failure mode for crash-fuzz tests:
 *   'none'           — ordinary write
 *   'truncate-at'    — write stops after N bytes; observer sees the prefix
 *   'pre-rename'     — rename fails silently (oldPath and newPath both exist/don't)
 */
export interface WriteFailure {
  mode: 'none' | 'truncate-at' | 'pre-rename';
  truncateBytes?: number;
}

export class MemoryFsAdapter implements FsAdapter {
  private files = new Map<string, Entry>();
  /** Next write's failure mode; consumed & reset after one call. */
  private nextFailure: WriteFailure = { mode: 'none' };

  constructor() {
    // Root exists implicitly
    this.files.set('/', { kind: 'dir' });
  }

  /** Configure the failure mode for the NEXT write (single-shot). */
  simulateWriteFailure(failure: WriteFailure): void {
    this.nextFailure = failure;
  }

  /** Peek at the raw store (for tests). */
  __snapshot(): Record<string, string | '<dir>'> {
    const out: Record<string, string | '<dir>'> = {};
    for (const [k, v] of this.files) {
      out[k] = v.kind === 'dir' ? '<dir>' : v.contents;
    }
    return out;
  }

  // ── FsAdapter implementation ──────────────────────────────

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async stat(path: string): Promise<FsStat> {
    const e = this.files.get(path);
    if (!e) throw new Error(`MemoryFs: not found: ${path}`);
    return {
      isFile: e.kind === 'file',
      isDirectory: e.kind === 'dir',
      sizeBytes: e.kind === 'file' ? byteLen(e.contents) : 0,
    };
  }

  async readText(path: string): Promise<string> {
    const e = this.files.get(path);
    if (!e) throw new Error(`MemoryFs: not found: ${path}`);
    if (e.kind !== 'file') throw new Error(`MemoryFs: not a file: ${path}`);
    return e.contents;
  }

  async writeText(path: string, contents: string): Promise<void> {
    this.ensureParentExists(path);
    const actual = this.applyFailure(contents);
    this.files.set(path, { kind: 'file', contents: actual });
  }

  async appendText(path: string, contents: string): Promise<void> {
    this.ensureParentExists(path);
    const existing = this.files.get(path);
    const prefix = existing?.kind === 'file' ? existing.contents : '';
    const appendActual = this.applyFailure(contents);
    this.files.set(path, { kind: 'file', contents: prefix + appendActual });
  }

  async fsync(_path: string): Promise<void> {
    // Nothing to flush — memory writes are immediately visible.
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    // pre-rename failure: silently do nothing
    if (this.nextFailure.mode === 'pre-rename') {
      this.nextFailure = { mode: 'none' };
      return;
    }
    const e = this.files.get(oldPath);
    if (!e) throw new Error(`MemoryFs: cannot rename, not found: ${oldPath}`);
    this.ensureParentExists(newPath);
    this.files.set(newPath, e);
    this.files.delete(oldPath);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async mkdir(path: string): Promise<void> {
    // Create all missing parent directories too.
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : `/${part}`;
      if (!this.files.has(current)) {
        this.files.set(current, { kind: 'dir' });
      }
    }
  }

  async readDir(path: string): Promise<string[]> {
    const e = this.files.get(path);
    if (!e) throw new Error(`MemoryFs: not found: ${path}`);
    if (e.kind !== 'dir') throw new Error(`MemoryFs: not a directory: ${path}`);
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const children = new Set<string>();
    for (const key of this.files.keys()) {
      if (key === path) continue;
      if (key.startsWith(prefix)) {
        const rest = key.slice(prefix.length);
        const head = rest.split('/')[0]!;
        if (head) children.add(head);
      }
    }
    return [...children];
  }

  // ── Internal helpers ─────────────────────────────────────

  private ensureParentExists(path: string): void {
    const idx = path.lastIndexOf('/');
    if (idx <= 0) return;
    const parent = path.slice(0, idx);
    if (!this.files.has(parent)) {
      // Auto-mkdir; matches Tauri's plugin-fs behavior when writing
      // to a file whose parent dir exists but nested dirs don't.
      this.files.set(parent, { kind: 'dir' });
    }
  }

  private applyFailure(contents: string): string {
    const f = this.nextFailure;
    this.nextFailure = { mode: 'none' };
    if (f.mode === 'truncate-at' && typeof f.truncateBytes === 'number') {
      return contents.slice(0, Math.max(0, f.truncateBytes));
    }
    return contents;
  }
}

function byteLen(s: string): number {
  return new TextEncoder().encode(s).byteLength;
}
