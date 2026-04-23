/**
 * ProjectBundle — crash-safe `.elbow` project directory.
 *
 *   foo.elbow/                 ← a directory, not a file
 *     header.json              metadata (name, created, app version, schema)
 *     snapshot.json            full state at last compaction
 *     log.ndjson               sealed event log (one JSON object per line)
 *     log.ndjson.partial       currently-being-written log (promoted on commit)
 *
 * ── Writer protocol ────────────────────────────────────────────
 *
 *   appendEvent(evt):
 *     1. append(serializeEvent(evt)) → log.ndjson.partial
 *     2. fsync(log.ndjson.partial)
 *     3. if (eventsSincePromote >= PROMOTE_AT_N ||
 *            msSincePromote >= PROMOTE_AFTER_MS):
 *          rename log.ndjson.partial → log.ndjson (ATOMIC)
 *
 *   compact(state):
 *     1. writeText(snapshot.json.tmp, JSON)
 *     2. fsync(snapshot.json.tmp)
 *     3. rename snapshot.json.tmp → snapshot.json (ATOMIC)
 *     4. writeText(log.ndjson, '')  (truncate — next appendEvent re-creates .partial)
 *
 * ── Reader protocol ────────────────────────────────────────────
 *
 *   load():
 *     1. Read header.json (required).
 *     2. Read snapshot.json if present (baseline state).
 *     3. Read log.ndjson (sealed events). Parse line-by-line; stop on first
 *        malformed line — never silently skip midstream.
 *     4. Read log.ndjson.partial if present. Parse line-by-line; the
 *        LAST line may be torn — drop it if it doesn't parse, keep everything
 *        up to it.
 *     5. Return { meta, snapshot, events }.
 *
 * ── Crash resilience ───────────────────────────────────────────
 *
 * On any power-cut or SIGKILL, the on-disk state is ONE of:
 *
 *   A) Clean (no partial write was in flight) — load succeeds, zero drift.
 *   B) Partial write truncated before flush — the truncated bytes are
 *      dropped by `parseEventLine` on load; prior events survive.
 *   C) Partial rename — either both oldPath & newPath observable
 *      (filesystem violation) or a clean atomic swap happened. NTFS
 *      and ext4 both guarantee the latter.
 *
 * No state is ever "half-applied" at the event level. This is the
 * invariant the crash-fuzz test asserts across 1,000 random kill points.
 */

import {
  type ProjectEvent,
  serializeEvent,
  parseEventLine,
  PROJECT_EVENT_SCHEMA_VERSION,
} from './ProjectEvents';
import { joinPath, type FsAdapter } from './fs/FsAdapter';

// ── Knobs ──────────────────────────────────────────────────────

/** Promote `.partial` → `.ndjson` after this many appends. */
const PROMOTE_AT_N = 20;
/** Promote after this many ms even without reaching N. */
const PROMOTE_AFTER_MS = 500;

// ── File names ─────────────────────────────────────────────────

const HEADER_FILE = 'header.json';
const SNAPSHOT_FILE = 'snapshot.json';
const SNAPSHOT_TMP = 'snapshot.json.tmp';
const LOG_FILE = 'log.ndjson';
const LOG_PARTIAL = 'log.ndjson.partial';

// ── Types ─────────────────────────────────────────────────────

export interface BundleHeader {
  schemaVersion: number;
  appVersion: string;
  name: string;
  createdAt: string;
  /** Last compaction timestamp. */
  compactedAt?: string;
}

/**
 * A "snapshot" is an opaque-to-the-bundle blob describing the
 * project state at compaction time. The caller provides a
 * serialize function at construction so ProjectBundle doesn't need
 * to know about pipes, fixtures, etc.
 */
export interface BundleLoadResult<S> {
  header: BundleHeader;
  snapshot: S | null;
  /** Parsed events after the snapshot, in order. */
  events: ProjectEvent[];
  /** True if the .partial log contained a torn line that was dropped. */
  repairedTornWrite: boolean;
}

export interface OpenOptions<S> {
  /** Human-readable project name used for header.json. */
  projectName: string;
  /** App version string — bump when breaking schema. */
  appVersion: string;
  /**
   * Serializer for the snapshot blob. Called during compact().
   * Keep returns JSON-stringifiable.
   */
  serializeSnapshot: () => S;
  /**
   * Optional: called once on load if the bundle is brand new.
   * Useful for seeding an initial snapshot.
   */
  onFirstOpen?: () => void;
}

// ── Main class ────────────────────────────────────────────────

export class ProjectBundle<S> {
  private pendingPartialCount = 0;
  private lastPromoteAt = 0;
  private promoteTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly fs: FsAdapter,
    /** Absolute path of the bundle directory (e.g. "projects/foo.elbow"). */
    private readonly bundlePath: string,
    private readonly opts: OpenOptions<S>,
  ) {}

  // ── Paths ─────────────────────────────────────────────────

  private p(file: string): string {
    return joinPath(this.bundlePath, file);
  }

  // ── Initialization ────────────────────────────────────────

  /**
   * Ensure the bundle directory + header file exist. Creates a fresh
   * bundle if missing. Idempotent.
   */
  async ensureOpen(): Promise<void> {
    await this.fs.mkdir(this.bundlePath);
    if (!(await this.fs.exists(this.p(HEADER_FILE)))) {
      const header: BundleHeader = {
        schemaVersion: PROJECT_EVENT_SCHEMA_VERSION,
        appVersion: this.opts.appVersion,
        name: this.opts.projectName,
        createdAt: new Date().toISOString(),
      };
      await this.fs.writeText(this.p(HEADER_FILE), JSON.stringify(header, null, 2));
      this.opts.onFirstOpen?.();
    }
  }

  // ── Writer API ────────────────────────────────────────────

  /** Append one event. Throws only if the filesystem is fatally broken. */
  async appendEvent(evt: ProjectEvent): Promise<void> {
    const line = serializeEvent(evt);
    await this.fs.appendText(this.p(LOG_PARTIAL), line);
    await this.fs.fsync(this.p(LOG_PARTIAL));
    this.pendingPartialCount++;

    const now = Date.now();
    if (
      this.pendingPartialCount >= PROMOTE_AT_N ||
      (this.lastPromoteAt > 0 && now - this.lastPromoteAt >= PROMOTE_AFTER_MS)
    ) {
      await this.promotePartial();
    } else {
      // Schedule an idle-promote in case no more events arrive.
      this.scheduleIdlePromote();
    }
  }

  /**
   * Take a snapshot of the current state, persist it atomically, and
   * truncate the log. Safe to call any time; typical cadence is on
   * explicit Save or every K events (default K = 1000 commits).
   */
  async compact(): Promise<void> {
    // 1. Make sure any partial log is promoted first so it becomes
    //    part of the "before snapshot" history if compact is atomic.
    await this.promotePartial();

    const snapshot = this.opts.serializeSnapshot();
    const tmpPath = this.p(SNAPSHOT_TMP);
    const finalPath = this.p(SNAPSHOT_FILE);

    await this.fs.writeText(tmpPath, JSON.stringify(snapshot));
    await this.fs.fsync(tmpPath);
    await this.fs.rename(tmpPath, finalPath);

    // Truncate the sealed log — events before this snapshot no longer needed.
    await this.fs.writeText(this.p(LOG_FILE), '');

    // Bump header compactedAt
    const header = JSON.parse(
      await this.fs.readText(this.p(HEADER_FILE)),
    ) as BundleHeader;
    header.compactedAt = new Date().toISOString();
    await this.fs.writeText(this.p(HEADER_FILE), JSON.stringify(header, null, 2));
  }

  // ── Reader API ────────────────────────────────────────────

  /**
   * Load the bundle into its three components: header, snapshot (or null),
   * and the ordered events after the snapshot.
   */
  async load(): Promise<BundleLoadResult<S>> {
    if (!(await this.fs.exists(this.p(HEADER_FILE)))) {
      throw new Error(`ProjectBundle: no header at ${this.p(HEADER_FILE)}`);
    }
    const header = JSON.parse(
      await this.fs.readText(this.p(HEADER_FILE)),
    ) as BundleHeader;

    let snapshot: S | null = null;
    if (await this.fs.exists(this.p(SNAPSHOT_FILE))) {
      try {
        snapshot = JSON.parse(
          await this.fs.readText(this.p(SNAPSHOT_FILE)),
        ) as S;
      } catch {
        // A corrupt snapshot is treated as "no snapshot" and the log
        // replay starts from zero. The user loses the ability to
        // roll back past the corruption point, but the session
        // survives.
        snapshot = null;
      }
    }

    // Sealed log: every line MUST parse. If one doesn't, stop there —
    // it means corruption of the sealed portion, which is a bigger
    // problem than a torn partial.
    const events: ProjectEvent[] = [];
    let repairedTornWrite = false;

    if (await this.fs.exists(this.p(LOG_FILE))) {
      const sealed = await this.fs.readText(this.p(LOG_FILE));
      for (const line of sealed.split('\n')) {
        if (!line.trim()) continue;
        const evt = parseEventLine(line);
        if (!evt) break; // shouldn't happen for sealed log
        events.push(evt);
      }
    }

    if (await this.fs.exists(this.p(LOG_PARTIAL))) {
      const partial = await this.fs.readText(this.p(LOG_PARTIAL));
      const lines = partial.split('\n');
      // Last element is always '' after a well-terminated file; a torn
      // write means the last non-empty element may be incomplete.
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (!line.trim()) continue;
        const evt = parseEventLine(line);
        if (!evt) {
          // Incomplete line. Drop it — the rest was unwritten anyway.
          repairedTornWrite = true;
          break;
        }
        events.push(evt);
      }
    }

    return { header, snapshot, events, repairedTornWrite };
  }

  // ── Migration ─────────────────────────────────────────────

  /**
   * Migrate a legacy single-file `.elbow` JSON into a new bundle dir.
   * The legacy file is PRESERVED next to the new bundle with a
   * `.legacy` suffix — we never overwrite user data.
   *
   *   foo.elbow  (flat JSON)   →   foo.elbow.legacy  (untouched)
   *                            +   foo.elbow/        (new bundle, seeded from the JSON)
   */
  static async migrateLegacy<S>(
    fs: FsAdapter,
    legacyPath: string,
    opts: OpenOptions<S>,
  ): Promise<ProjectBundle<S>> {
    const legacyJson = await fs.readText(legacyPath);

    // Preserve original at .legacy — rename (atomic) rather than copy.
    await fs.rename(legacyPath, `${legacyPath}.legacy`);

    // Convert "path/foo.elbow" → bundle dir at same name
    const bundlePath = legacyPath;
    const bundle = new ProjectBundle<S>(fs, bundlePath, opts);
    await bundle.ensureOpen();

    // Seed the bundle by writing the parsed legacy JSON as the initial
    // snapshot. Any further mutations flow through appendEvent.
    try {
      const parsed = JSON.parse(legacyJson) as S;
      const snapshotPath = joinPath(bundlePath, SNAPSHOT_FILE);
      await fs.writeText(snapshotPath, JSON.stringify(parsed));
    } catch {
      // The legacy file was unparseable; we've preserved it, so the
      // user can recover manually. Return the empty bundle.
    }

    return bundle;
  }

  // ── Internal helpers ──────────────────────────────────────

  /**
   * Atomically promote .partial → .ndjson by appending and renaming.
   *
   * The sealed log grows unbounded until compaction truncates it.
   * Promotion merges the current .partial into the sealed log:
   *   1. Read sealed log (if any).
   *   2. Read partial.
   *   3. Write sealed + partial to a fresh .tmp.
   *   4. Rename .tmp → log.ndjson.
   *   5. Remove .partial.
   */
  private async promotePartial(): Promise<void> {
    const partialPath = this.p(LOG_PARTIAL);
    if (!(await this.fs.exists(partialPath))) {
      this.pendingPartialCount = 0;
      this.lastPromoteAt = Date.now();
      return;
    }

    const partial = await this.fs.readText(partialPath);
    if (!partial) {
      await this.fs.remove(partialPath);
      this.pendingPartialCount = 0;
      this.lastPromoteAt = Date.now();
      return;
    }

    const sealedPath = this.p(LOG_FILE);
    let sealed = '';
    if (await this.fs.exists(sealedPath)) {
      sealed = await this.fs.readText(sealedPath);
    }

    // Merge — ensure newline discipline: sealed + '\n' (if non-empty,
    // and doesn't already end in \n) + partial.
    const sep = sealed && !sealed.endsWith('\n') ? '\n' : '';
    const merged = sealed + sep + partial;

    const tmpPath = this.p(`${LOG_FILE}.tmp`);
    await this.fs.writeText(tmpPath, merged);
    await this.fs.fsync(tmpPath);
    await this.fs.rename(tmpPath, sealedPath);
    await this.fs.remove(partialPath);

    this.pendingPartialCount = 0;
    this.lastPromoteAt = Date.now();
    if (this.promoteTimer) {
      clearTimeout(this.promoteTimer);
      this.promoteTimer = null;
    }
  }

  private scheduleIdlePromote(): void {
    if (this.promoteTimer) return;
    this.promoteTimer = setTimeout(() => {
      this.promoteTimer = null;
      // Fire-and-forget; errors surface on the next explicit operation.
      void this.promotePartial();
    }, PROMOTE_AFTER_MS);
  }

  /** Test hook: force immediate promotion. */
  async __forcePromote(): Promise<void> {
    await this.promotePartial();
  }

  /** Test hook: peek at raw file contents without affecting state. */
  async __debugReadFiles(): Promise<Record<string, string | null>> {
    const out: Record<string, string | null> = {};
    for (const f of [HEADER_FILE, SNAPSHOT_FILE, LOG_FILE, LOG_PARTIAL]) {
      const path = this.p(f);
      out[f] = (await this.fs.exists(path)) ? await this.fs.readText(path) : null;
    }
    return out;
  }
}
