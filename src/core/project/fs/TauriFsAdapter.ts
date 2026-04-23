/**
 * TauriFsAdapter — FsAdapter backed by @tauri-apps/plugin-fs.
 *
 * Only loaded lazily when a Tauri runtime is detected (see
 * `createFsAdapter()` in ./index.ts). In a non-Tauri build this file
 * is imported dynamically so Vite can tree-shake it out of the web
 * preview bundle.
 *
 * All paths are RELATIVE TO THE APP-DATA DIRECTORY. We resolve them
 * under `BaseDirectory.AppData` so the user never sees our internal
 * bundle structure alongside their actual project files.
 */

import type { FsAdapter, FsStat } from './FsAdapter';

// These imports use the plugin's typed surface. They only resolve in
// a Tauri runtime; the dynamic `createFsAdapter` call in index.ts
// guards this whole module.
import {
  exists as tauriExists,
  stat as tauriStat,
  readTextFile,
  writeTextFile,
  rename as tauriRename,
  remove as tauriRemove,
  mkdir as tauriMkdir,
  readDir as tauriReadDir,
  BaseDirectory,
} from '@tauri-apps/plugin-fs';

const BASE = BaseDirectory.AppData;

export class TauriFsAdapter implements FsAdapter {
  async exists(path: string): Promise<boolean> {
    return tauriExists(path, { baseDir: BASE });
  }

  async stat(path: string): Promise<FsStat> {
    const s = await tauriStat(path, { baseDir: BASE });
    return {
      isFile: s.isFile,
      isDirectory: s.isDirectory,
      sizeBytes: Number(s.size ?? 0),
    };
  }

  async readText(path: string): Promise<string> {
    return readTextFile(path, { baseDir: BASE });
  }

  async writeText(path: string, contents: string): Promise<void> {
    await writeTextFile(path, contents, { baseDir: BASE });
  }

  async appendText(path: string, contents: string): Promise<void> {
    // plugin-fs's writeTextFile has an `append: true` option. When the
    // file doesn't exist it's created fresh.
    await writeTextFile(path, contents, { baseDir: BASE, append: true });
  }

  async fsync(_path: string): Promise<void> {
    // plugin-fs doesn't expose an explicit sync entrypoint in its v2
    // high-level API; writeTextFile internally calls flush. Treat as
    // best-effort. If we need stronger durability later we can add a
    // Rust-side command via tauri::command.
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await tauriRename(oldPath, newPath, {
      oldPathBaseDir: BASE,
      newPathBaseDir: BASE,
    });
  }

  async remove(path: string): Promise<void> {
    try {
      await tauriRemove(path, { baseDir: BASE });
    } catch {
      // Silent if not present — matches MemoryFsAdapter semantics.
    }
  }

  async mkdir(path: string): Promise<void> {
    await tauriMkdir(path, { baseDir: BASE, recursive: true });
  }

  async readDir(path: string): Promise<string[]> {
    const entries = await tauriReadDir(path, { baseDir: BASE });
    return entries.map((e) => e.name).filter((n): n is string => !!n);
  }
}
