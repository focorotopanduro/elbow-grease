/**
 * FsAdapter — abstraction over the filesystem primitives ProjectBundle
 * needs, so the same bundle code can run against:
 *
 *   • TauriFsAdapter  — @tauri-apps/plugin-fs (production)
 *   • MemoryFsAdapter — in-memory map (tests, dev without Tauri)
 *
 * Deliberate minimalism: we expose only the calls ProjectBundle uses.
 * No streaming, no chunked reads, no watch APIs. Fewer primitives =
 * smaller surface to reason about during crash-recovery analysis.
 *
 * Atomicity contract:
 *   `rename` MUST be atomic within one filesystem — both adapters
 *   guarantee this. On NTFS/ext4 this is free; MemoryFsAdapter
 *   implements it by swapping map entries without partial state.
 *
 * fsync contract:
 *   `fsync(path)` is best-effort durability. On Tauri it translates
 *   to plugin-fs's `flush`; on MemoryFsAdapter it's a no-op (there's
 *   nothing to flush).
 */

/** Minimal stat shape — only what ProjectBundle reads. */
export interface FsStat {
  isFile: boolean;
  isDirectory: boolean;
  sizeBytes: number;
}

/** The only FS primitives ProjectBundle uses. */
export interface FsAdapter {
  /** True if a file OR directory exists at path. */
  exists(path: string): Promise<boolean>;

  /** Stat; throws if not found. */
  stat(path: string): Promise<FsStat>;

  /** Read an entire file as UTF-8 text. */
  readText(path: string): Promise<string>;

  /**
   * Write a file atomically: caller-provided contents replace whatever
   * was there. On a real FS this usually translates to writeFile.
   *
   * Adapters should buffer internally — no partial write should be
   * observable to another reader.
   */
  writeText(path: string, contents: string): Promise<void>;

  /**
   * Append UTF-8 text to an existing file (or create if missing).
   * Critical for the NDJSON log path — we don't want to re-read and
   * re-write the whole log on every event.
   */
  appendText(path: string, contents: string): Promise<void>;

  /**
   * Best-effort durability: flush OS-level buffers to disk for this
   * file. After `fsync(p)` returns, contents written via writeText
   * or appendText are expected to survive a power cut.
   */
  fsync(path: string): Promise<void>;

  /**
   * Atomic rename WITHIN the same filesystem. After the call:
   *   • `oldPath` no longer exists
   *   • `newPath` contains what `oldPath` contained
   * Either both are true, or neither (no partial state).
   *
   * Used for the `log.ndjson.partial` → `log.ndjson` promotion and
   * the `snapshot.json.tmp` → `snapshot.json` swap.
   */
  rename(oldPath: string, newPath: string): Promise<void>;

  /** Remove a file OR empty directory. Silent if not present. */
  remove(path: string): Promise<void>;

  /** Create a directory (and all missing parents). */
  mkdir(path: string): Promise<void>;

  /** List direct children of a directory. Filenames only, no paths. */
  readDir(path: string): Promise<string[]>;
}

// ── Path helpers (adapter-independent) ──────────────────────────

/** Join path segments with '/' normalized. */
export function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p : p.replace(/^[\\/]+/, '')))
    .map((p) => p.replace(/\\/g, '/'))
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
}

/** Return the parent directory of a path. */
export function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx <= 0 ? '/' : path.slice(0, idx);
}

/** Return the last segment of a path (file or dir name). */
export function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx < 0 ? path : path.slice(idx + 1);
}
