/**
 * fsAdapter — environment-aware save/open for .elbow bundles.
 *
 * Two runtimes are supported, with the same shape:
 *
 *   1. TAURI (desktop):
 *      - `requestSavePath` / `requestOpenPath` use native OS dialogs.
 *      - `writeToPath` / `readFromPath` hit the real file system.
 *      - Returned paths are absolute and persistent across reloads.
 *
 *   2. BROWSER (dev server, preview, embedded webview without the
 *      Tauri bridge):
 *      - `requestSavePath` returns a synthetic "browser-download"
 *        token; `writeToPath` then triggers a blob download.
 *      - `requestOpenPath` uses a hidden <input type=file>; the
 *        resolved "path" is actually the File name.
 *      - `readFromPath` after a browser open reads from an in-memory
 *        map keyed on the synthetic token. Re-reading a browser path
 *        after reload is not possible — the file reference is ephemeral.
 *
 * The calling code doesn't branch on environment. It calls these
 * functions and gets back a path string + read/write ops that either
 * do real fs work or simulate it for the browser.
 *
 * Tauri plugins are loaded via dynamic `import()` so the browser
 * bundle doesn't pay for them. The import errors gracefully if the
 * Tauri runtime isn't present, falling through to the browser path.
 */

import { logger } from '@core/logger/Logger';

const log = logger('FsAdapter');

// ── Runtime detection ──────────────────────────────────────────

/**
 * True when the app is running inside the Tauri webview with its
 * bridge available. Cached after first probe — the answer doesn't
 * change within a session.
 */
let tauriProbe: boolean | null = null;

export function isTauri(): boolean {
  if (tauriProbe !== null) return tauriProbe;
  if (typeof window === 'undefined') { tauriProbe = false; return false; }
  // Tauri v2 injects `__TAURI_INTERNALS__`; older builds used `__TAURI__`.
  // Checking both keeps us forward + backward compatible.
  const w = window as unknown as Record<string, unknown>;
  tauriProbe = Boolean(w.__TAURI_INTERNALS__ || w.__TAURI__);
  return tauriProbe;
}

/**
 * Test override — lets adapter.spec.ts force a specific environment
 * without patching globalThis.
 */
export function __setTauriProbeForTest(value: boolean | null): void {
  tauriProbe = value;
}

// ── Save-path request ──────────────────────────────────────────

const BROWSER_SAVE_TOKEN = '__browser_download__';

export interface SavePathRequest {
  /** Suggested filename shown in the dialog. */
  defaultName: string;
  /** Extension without the dot. */
  extension: string;
}

/**
 * Ask the user where to save. In Tauri, spawns a native Save dialog
 * and returns the absolute path (or null if cancelled). In the browser,
 * returns a synthetic token — the caller uses `writeToPath` which
 * triggers a blob download with the default name.
 */
export async function requestSavePath(req: SavePathRequest): Promise<string | null> {
  if (isTauri()) {
    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const result = await save({
        defaultPath: req.defaultName,
        filters: [{ name: 'ELBOW GREASE Project', extensions: [req.extension] }],
      });
      return typeof result === 'string' ? result : null;
    } catch (err) {
      log.warn('tauri save dialog failed, falling back to browser download', err);
      return BROWSER_SAVE_TOKEN;
    }
  }
  // Browser: no real dialog; we'll trigger a download in writeToPath.
  return BROWSER_SAVE_TOKEN;
}

// ── Write ──────────────────────────────────────────────────────

export interface WriteOptions {
  /** Filename to suggest when falling through to browser download. */
  browserFilename?: string;
  /** Mime type for the browser blob. */
  browserMime?: string;
}

export async function writeToPath(
  path: string,
  content: string,
  opts: WriteOptions = {},
): Promise<void> {
  if (path === BROWSER_SAVE_TOKEN || !isTauri()) {
    browserDownload(content, opts.browserFilename ?? 'project.elbow', opts.browserMime ?? 'application/octet-stream');
    return;
  }
  try {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, content);
  } catch (err) {
    log.error('tauri writeTextFile failed', err);
    throw err;
  }
}

// ── Open-path request ──────────────────────────────────────────

export interface OpenPathRequest {
  /** Extension filters to show in the native dialog. */
  extensions: string[];
  /** Label for the filter (shown in dialog's filter dropdown). */
  filterLabel?: string;
}

export interface OpenResult {
  /** Absolute path (Tauri) or synthetic "browser-upload:{filename}" token. */
  path: string;
  /** Already-read content — both environments surface the text immediately. */
  content: string;
}

/**
 * Ask the user to open a file, returning both the path + content.
 * Returns null if the user cancelled.
 *
 * We bundle path+content into one result because the browser path
 * cannot re-read a File by name later — the File handle is ephemeral
 * to the dialog interaction. Reading here eliminates a class of bugs
 * where the caller captures the path and tries to read it "later".
 */
export async function requestOpenPath(req: OpenPathRequest): Promise<OpenResult | null> {
  if (isTauri()) {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{
          name: req.filterLabel ?? 'File',
          extensions: req.extensions,
        }],
      });
      if (!picked || typeof picked !== 'string') return null;
      const content = await readTextFile(picked);
      return { path: picked, content };
    } catch (err) {
      log.warn('tauri open dialog failed, falling back to browser upload', err);
      return browserOpen(req.extensions);
    }
  }
  return browserOpen(req.extensions);
}

/**
 * Read a file by path. Only works reliably in Tauri — in the browser,
 * a synthetic `browser-upload:{filename}` path cannot be re-read
 * across sessions (there's no File handle to re-access). Callers that
 * need persistent file tracking should prefer `requestOpenPath` and
 * cache the returned content alongside the path.
 */
export async function readFromPath(path: string): Promise<string> {
  if (isTauri()) {
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return readTextFile(path);
  }
  throw new Error(
    `Cannot read from browser path "${path}" — in the browser runtime, ` +
    `file handles do not persist. Use requestOpenPath() to prompt for a fresh upload.`,
  );
}

/**
 * True if `writeToPath(path, ...)` would write to a real on-disk file
 * (Tauri) vs. triggering a browser download (token or non-Tauri).
 */
export function isRealPath(path: string | null): boolean {
  if (!path) return false;
  if (path === BROWSER_SAVE_TOKEN) return false;
  if (path.startsWith('browser-upload:')) return false;
  return isTauri();
}

/**
 * True if the current environment can persist file references across
 * app reloads (e.g. a "Recent Files" list that re-opens on startup).
 * Only Tauri qualifies — browser File handles are single-use.
 */
export function supportsRecentFiles(): boolean {
  return isTauri();
}

// ── Browser fallbacks ──────────────────────────────────────────

function browserDownload(content: string, filename: string, mime: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

function browserOpen(extensions: string[]): Promise<OpenResult | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);

  return new Promise<OpenResult | null>((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    // Accept attribute — prefix extensions with a dot.
    input.accept = extensions.map((e) => (e.startsWith('.') ? e : `.${e}`)).join(',');
    input.style.display = 'none';
    document.body.appendChild(input);

    const cleanup = () => { try { input.remove(); } catch { /* ignore */ } };

    input.addEventListener('cancel', () => { cleanup(); resolve(null); });
    input.addEventListener('change', async () => {
      try {
        const file = input.files?.[0];
        if (!file) { cleanup(); resolve(null); return; }
        const content = await file.text();
        cleanup();
        resolve({ path: `browser-upload:${file.name}`, content });
      } catch (err) {
        cleanup();
        reject(err);
      }
    });

    input.click();
  });
}

// ── Test hooks ─────────────────────────────────────────────────

export const __testables = {
  BROWSER_SAVE_TOKEN,
};
