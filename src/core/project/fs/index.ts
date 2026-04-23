/**
 * Factory that picks the right FsAdapter based on runtime.
 *
 *   Tauri webview     → TauriFsAdapter (real filesystem)
 *   plain browser/dev → MemoryFsAdapter (in-memory, session-only)
 *
 * Consumers should NOT import TauriFsAdapter directly — use this
 * factory so Vite can tree-shake the Tauri plugin import out of web
 * preview bundles.
 */

import type { FsAdapter } from './FsAdapter';
import { MemoryFsAdapter } from './MemoryFsAdapter';

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export async function createFsAdapter(): Promise<FsAdapter> {
  if (isTauri()) {
    const mod = await import('./TauriFsAdapter');
    return new mod.TauriFsAdapter();
  }
  return new MemoryFsAdapter();
}

export { MemoryFsAdapter } from './MemoryFsAdapter';
export * from './FsAdapter';
