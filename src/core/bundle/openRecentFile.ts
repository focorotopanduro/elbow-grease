/**
 * openRecentFile — open a bundle directly from a stored path.
 *
 * The Ctrl+O flow uses a file picker dialog. The Recent Files panel
 * skips the picker and reads from the path it already knows. Both
 * converge on `applyBundle` + `setCurrent`; this module is the "read
 * from path, apply, handle failures" wrapper.
 *
 * Failure handling:
 *   If `readFromPath` throws (file moved / deleted / permission
 *   revoked), we surface a short error string AND remove the entry
 *   from the recents list so the user isn't stuck clicking a dead
 *   link. `parseBundle` failures (malformed JSON, future-version
 *   bundle) surface a similar error but DO NOT remove the entry — the
 *   file still exists, it's just corrupt; the user might want to
 *   inspect it.
 */

import { readFromPath } from './fsAdapter';
import { applyBundle, parseBundle, type ApplyResult } from './Bundle';
import { useCurrentFileStore } from './currentFileStore';
import { clearAutosave, markClean } from './autosave';
import { logger } from '@core/logger/Logger';

const log = logger('OpenRecent');

export type OpenRecentResult =
  | { ok: true; applyResult: ApplyResult }
  | { ok: false; error: string; removedFromRecents: boolean };

export async function openRecentFile(path: string): Promise<OpenRecentResult> {
  let content: string;
  try {
    content = await readFromPath(path);
  } catch (err) {
    // File-system error (not-found, permission, etc.) — the path is
    // almost certainly stale. Clean it out of recents so the user
    // doesn't keep trying.
    useCurrentFileStore.getState().removeRecent(path);
    const msg = err instanceof Error ? err.message : String(err);
    log.warn('recent file unreadable, removed from list', { path, error: msg });
    return {
      ok: false,
      error: `File could not be read (${truncate(msg, 100)}). Removed from recents.`,
      removedFromRecents: true,
    };
  }

  let bundle;
  try {
    bundle = parseBundle(content);
  } catch (err) {
    // Parse failure — bundle file is corrupt or from a newer version.
    // Keep it in recents; the user may want to repair or reconvert.
    const msg = err instanceof Error ? err.message : String(err);
    log.error('recent file parse failed', { path, error: msg });
    return {
      ok: false,
      error: `Bundle is invalid: ${truncate(msg, 120)}`,
      removedFromRecents: false,
    };
  }

  const applyResult = applyBundle(bundle);

  useCurrentFileStore.getState().setCurrent(
    path,
    /* displayName */ undefined,
    applyResult.project?.customerName,
  );

  markClean();
  clearAutosave();

  log.info('recent file opened', {
    path,
    pipes: applyResult.counts.pipes,
    fixtures: applyResult.counts.fixtures,
    migrated: applyResult.migrated,
  });

  return { ok: true, applyResult };
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
