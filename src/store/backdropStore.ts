/**
 * BackdropStore — raster blueprints pinned into the 3D scene as
 * reference images for tracing.
 *
 * Common workflow: plumber exports a PDF page from their architect to
 * PNG/JPG, uploads it here, drops it at floor-1 level, scales/rotates
 * so walls line up with the grid, then traces pipes over it.
 *
 * Each backdrop is stored as a data URL (base64) so projects save as a
 * single JSON file. This bloats file size on purpose — plumbers need
 * self-contained deliverables they can email to a colleague.
 *
 *   Backdrop {
 *     id, name,
 *     dataUrl,
 *     width/depth (ft) — world size after scale
 *     position [x, y, z]
 *     rotationY (radians)
 *     opacity
 *     locked (prevents accidental drag)
 *   }
 */

import { create } from 'zustand';

export interface Backdrop {
  id: string;
  name: string;
  /** Data URL (base64 image). */
  dataUrl: string;
  /** Source image pixel size. */
  pixelWidth: number;
  pixelHeight: number;
  /** World-space dimensions (ft) — aspect derived from pixel size × scale. */
  widthFt: number;
  depthFt: number;
  /** Floor position. */
  position: [number, number, number];
  /** Rotation about Y (radians). */
  rotationY: number;
  opacity: number;
  locked: boolean;
  hidden: boolean;
}

interface BackdropState {
  backdrops: Record<string, Backdrop>;
  selectedId: string | null;

  addBackdrop: (name: string, dataUrl: string, pixelWidth: number, pixelHeight: number, floorY?: number) => string;
  removeBackdrop: (id: string) => void;
  selectBackdrop: (id: string | null) => void;
  updateBackdrop: (id: string, patch: Partial<Backdrop>) => void;
  /** Scale both width/depth by a factor (keeps aspect). */
  scaleBackdrop: (id: string, factor: number) => void;
  toggleLock: (id: string) => void;
  toggleHidden: (id: string) => void;
}

let seq = 0;
function bid(): string {
  seq = (seq + 1) & 0xffff;
  return `bd_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export const useBackdropStore = create<BackdropState>((set, get) => ({
  backdrops: {},
  selectedId: null,

  addBackdrop: (name, dataUrl, pixelWidth, pixelHeight, floorY = 0) => {
    const id = bid();
    // Default: 1 pixel = 1 inch. User will calibrate with scale tool.
    const widthFt = pixelWidth / 96; // assume 96 dpi scanned
    const aspect = pixelHeight / pixelWidth;
    const depthFt = widthFt * aspect;
    const backdrop: Backdrop = {
      id,
      name,
      dataUrl,
      pixelWidth,
      pixelHeight,
      widthFt,
      depthFt,
      position: [0, floorY - 0.003, 0],
      rotationY: 0,
      opacity: 0.6,
      locked: false,
      hidden: false,
    };
    set((s) => ({ backdrops: { ...s.backdrops, [id]: backdrop }, selectedId: id }));
    return id;
  },

  removeBackdrop: (id) => {
    set((s) => {
      const copy = { ...s.backdrops };
      delete copy[id];
      return {
        backdrops: copy,
        selectedId: s.selectedId === id ? null : s.selectedId,
      };
    });
  },

  selectBackdrop: (id) => set({ selectedId: id }),

  updateBackdrop: (id, patch) => {
    set((s) => {
      const existing = s.backdrops[id];
      if (!existing) return s;
      return { backdrops: { ...s.backdrops, [id]: { ...existing, ...patch } } };
    });
  },

  scaleBackdrop: (id, factor) => {
    const b = get().backdrops[id];
    if (!b) return;
    get().updateBackdrop(id, {
      widthFt: b.widthFt * factor,
      depthFt: b.depthFt * factor,
    });
  },

  toggleLock: (id) => {
    const b = get().backdrops[id];
    if (!b) return;
    get().updateBackdrop(id, { locked: !b.locked });
  },

  toggleHidden: (id) => {
    const b = get().backdrops[id];
    if (!b) return;
    get().updateBackdrop(id, { hidden: !b.hidden });
  },
}));

// ── Upload helper ──────────────────────────────────────────────

export function uploadBackdropFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error(`Not an image: ${file.type}`));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const id = useBackdropStore.getState().addBackdrop(
          file.name.replace(/\.[^.]+$/, ''),
          dataUrl,
          img.width,
          img.height,
        );
        resolve(id);
      };
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}
