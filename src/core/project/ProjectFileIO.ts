/**
 * Project File I/O — export .elbow files and import via file picker.
 *
 * Uses the browser File API for import and Blob download for export.
 * No server required — all operations are client-side.
 */

import {
  serializeToJSON,
  deserializeProject,
  validateProjectFile,
  FILE_EXTENSION,
  MIME_TYPE,
  type SerializeInput,
  type DeserializeResult,
} from './ProjectSerializer';

// ── Export (save to file) ───────────────────────────────────────

/**
 * Export the current design as a downloadable .elbow file.
 */
export function exportProjectFile(
  state: SerializeInput,
  filename?: string,
): void {
  const json = serializeToJSON(state);
  const name = filename ?? `${state.projectName ?? 'untitled'}${FILE_EXTENSION}`;

  const blob = new Blob([json], { type: MIME_TYPE });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Import (load from file) ─────────────────────────────────────

/**
 * Open a file picker and import a .elbow project file.
 * Returns a Promise that resolves with the deserialized project
 * or rejects if the user cancels or the file is invalid.
 */
export function importProjectFile(): Promise<DeserializeResult> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = `${FILE_EXTENSION},application/json,.json`;

    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        reject(new Error('No file selected'));
        return;
      }

      const reader = new FileReader();

      reader.onload = () => {
        const text = reader.result as string;

        // Validate before deserializing
        const validation = validateProjectFile(text);
        if (!validation.valid) {
          reject(new Error(`Invalid project file: ${validation.error}`));
          return;
        }

        try {
          const result = deserializeProject(text);
          resolve(result);
        } catch (err) {
          reject(err);
        }
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    };

    // User canceled the picker
    input.oncancel = () => reject(new Error('File selection canceled'));

    input.click();
  });
}

// ── Quick save/load from clipboard (for sharing) ────────────────

/**
 * Copy the current design to clipboard as JSON.
 */
export async function copyProjectToClipboard(state: SerializeInput): Promise<boolean> {
  try {
    const json = serializeToJSON(state);
    await navigator.clipboard.writeText(json);
    return true;
  } catch {
    return false;
  }
}

/**
 * Paste a design from clipboard.
 */
export async function pasteProjectFromClipboard(): Promise<DeserializeResult | null> {
  try {
    const text = await navigator.clipboard.readText();
    const validation = validateProjectFile(text);
    if (!validation.valid) return null;
    return deserializeProject(text);
  } catch {
    return null;
  }
}
