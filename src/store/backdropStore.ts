/**
 * BackdropStore — raster blueprints pinned into the 3D scene as
 * reference images for tracing.
 *
 * Common workflow: plumber uploads a PDF or PNG blueprint from their
 * architect, the app drops it on the floor of the current level,
 * scales/rotates so walls line up with the grid, then traces pipes
 * over it.
 *
 * Each backdrop is stored as a data URL (base64) so projects save as
 * a single JSON file. This bloats file size on purpose — plumbers
 * need self-contained deliverables they can email to a colleague.
 *
 * Phase 14.E:
 *   • PDF upload: renders page(s) via the lazy-loaded PDFRenderer.
 *   • `floorId` field associates a backdrop with a specific floor
 *     (basement / slab / 1st / 2nd / …). BackdropLayer filters
 *     by the active floor's visibility mode.
 */

import { create } from 'zustand';
import { useFloorStore } from './floorStore';
import { loadPdfRenderer } from '@core/lazy/loaders';

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
  /**
   * Phase 14.E — floor this backdrop belongs to (e.g. 'floor_1',
   * 'basement'). Optional for backward compat: backdrops saved
   * before 14.E have no floorId and are always visible. New
   * uploads default to the active floor at upload time.
   */
  floorId?: string;
  /**
   * Phase 14.E — source page metadata for PDF-origin backdrops.
   * Lets us re-render at higher DPI later, and shows provenance in
   * the manage panel.
   */
  source?: {
    kind: 'image' | 'pdf';
    /** Original filename (without extension) — shown in UI. */
    originalName: string;
    /** 1-indexed page number if source is a PDF. */
    pageNumber?: number;
    /** Total pages in the original PDF. */
    totalPages?: number;
    /** DPI used when the PDF was rasterized. */
    dpi?: number;
  };
}

interface BackdropState {
  backdrops: Record<string, Backdrop>;
  selectedId: string | null;

  addBackdrop: (
    name: string,
    dataUrl: string,
    pixelWidth: number,
    pixelHeight: number,
    opts?: {
      floorY?: number;
      floorId?: string;
      source?: Backdrop['source'];
    },
  ) => string;
  removeBackdrop: (id: string) => void;
  selectBackdrop: (id: string | null) => void;
  updateBackdrop: (id: string, patch: Partial<Backdrop>) => void;
  /** Scale both width/depth by a factor (keeps aspect). */
  scaleBackdrop: (id: string, factor: number) => void;
  toggleLock: (id: string) => void;
  toggleHidden: (id: string) => void;
  /** Phase 14.E — reassign to a specific floor. Updates position Y
   *  to sit just below that floor's elevation base. */
  assignToFloor: (id: string, floorId: string) => void;
}

let seq = 0;
function bid(): string {
  seq = (seq + 1) & 0xffff;
  return `bd_${Date.now().toString(36)}_${seq.toString(36)}`;
}

/** Resolve "sit on this floor" to a Y coordinate: 1 cm below the
 *  elevation base so pipes drawn at floor level sit visibly on top
 *  without Z-fighting against the grid / floor outlines. */
function floorYFor(floorId: string): number {
  const floor = useFloorStore.getState().floors[floorId];
  if (!floor) return 0;
  return floor.elevationBase - 0.01;
}

export const useBackdropStore = create<BackdropState>((set, get) => ({
  backdrops: {},
  selectedId: null,

  addBackdrop: (name, dataUrl, pixelWidth, pixelHeight, opts = {}) => {
    const id = bid();
    // Default: 1 pixel = 1/96 foot. User calibrates with scale tool.
    const widthFt = pixelWidth / 96; // assume 96 dpi scanned
    const aspect = pixelHeight / pixelWidth;
    const depthFt = widthFt * aspect;

    // Resolve floor / Y. Priority: explicit floorId > explicit floorY
    // > active floor in floorStore > world origin.
    let floorId: string | undefined = opts.floorId;
    let y: number;
    if (floorId) {
      y = floorYFor(floorId);
    } else if (opts.floorY !== undefined) {
      y = opts.floorY - 0.01;
      // Derive floorId from Y for back-association.
      const resolved = useFloorStore.getState().getFloorForElevation(opts.floorY);
      if (resolved) floorId = resolved.id;
    } else {
      const activeId = useFloorStore.getState().activeFloorId;
      if (activeId) {
        floorId = activeId;
        y = floorYFor(activeId);
      } else {
        y = -0.003;
      }
    }

    const backdrop: Backdrop = {
      id,
      name,
      dataUrl,
      pixelWidth,
      pixelHeight,
      widthFt,
      depthFt,
      position: [0, y, 0],
      rotationY: 0,
      opacity: 0.6,
      locked: false,
      hidden: false,
      ...(floorId ? { floorId } : {}),
      ...(opts.source ? { source: opts.source } : {}),
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

  assignToFloor: (id, floorId) => {
    const b = get().backdrops[id];
    if (!b) return;
    const y = floorYFor(floorId);
    get().updateBackdrop(id, {
      floorId,
      position: [b.position[0], y, b.position[2]],
    });
  },
}));

// ── Upload helpers ───────────────────────────────────────────

/** Image upload (unchanged from Phase 10.B). */
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
          {
            source: {
              kind: 'image',
              originalName: file.name.replace(/\.[^.]+$/, ''),
            },
          },
        );
        resolve(id);
      };
      img.onerror = () => reject(new Error('Failed to decode image'));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

// ── Phase 14.G — Calibrate: level + origin helpers ──────────
//
// Both operate on every backdrop on the currently-active floor. That's
// what "calibrate my blueprints" means: the user aligns the paper
// reference frame to the app's world frame, and every blueprint on
// that floor moves together.
//
// These are exported as top-level functions (not Zustand actions) so
// the measureStore can call them without a cyclic import cycle.

function backdropsOnActiveFloor(): Backdrop[] {
  const activeFloorId = useFloorStore.getState().activeFloorId;
  return Object.values(useBackdropStore.getState().backdrops)
    .filter((b) => b.floorId === activeFloorId || !b.floorId);
}

/**
 * Rotate every active-floor backdrop so that the segment p1→p2 becomes
 * aligned with world +X (horizontal). Pivots around the midpoint of
 * (p1, p2) so the clicked segment stays in approximately the same
 * on-screen location.
 */
export function rotateActiveFloorBackdropsToLevel(p1: [number, number, number], p2: [number, number, number]): void {
  const dx = p2[0] - p1[0];
  const dz = p2[2] - p1[2];
  if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return; // zero-length
  // Current angle in XZ plane. We want to rotate BY -currentAngle so
  // (p2 - p1) becomes parallel to +X.
  const currentAngle = Math.atan2(dz, dx);
  const rotateBy = -currentAngle;
  const cx = (p1[0] + p2[0]) / 2;
  const cz = (p1[2] + p2[2]) / 2;
  const cos = Math.cos(rotateBy);
  const sin = Math.sin(rotateBy);

  const { updateBackdrop } = useBackdropStore.getState();
  for (const b of backdropsOnActiveFloor()) {
    // Rotate position around (cx, cz).
    const rx = b.position[0] - cx;
    const rz = b.position[2] - cz;
    const nx = rx * cos - rz * sin + cx;
    const nz = rx * sin + rz * cos + cz;
    updateBackdrop(b.id, {
      position: [nx, b.position[1], nz],
      rotationY: b.rotationY + rotateBy,
    });
  }
}

/**
 * Shift every active-floor backdrop so that `worldPoint` maps to
 * (0, y, 0). Useful for aligning the blueprint's "NW corner of slab"
 * with the world origin so elevations and cross-floor stacks agree.
 */
export function shiftActiveFloorBackdropsOrigin(worldPoint: [number, number, number]): void {
  const dx = -worldPoint[0];
  const dz = -worldPoint[2];
  if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return; // no-op
  const { updateBackdrop } = useBackdropStore.getState();
  for (const b of backdropsOnActiveFloor()) {
    updateBackdrop(b.id, {
      position: [b.position[0] + dx, b.position[1], b.position[2] + dz],
    });
  }
}

/**
 * Phase 14.E — Upload a specific page of a PDF as a backdrop.
 *
 * Lazy-loads pdfjs on first call; subsequent uploads hit the cached
 * module. `totalPages` is carried through to the backdrop's `source`
 * metadata so the UI can display "page 2 of 5" in the manage panel.
 */
export async function uploadBackdropPdfPage(
  file: File,
  pageNumber: number,
  opts: { totalPages?: number; dpi?: number } = {},
): Promise<string> {
  const mod = await loadPdfRenderer.get();
  const img = await mod.renderPdfPage(file, pageNumber, opts.dpi ?? 200);
  const baseName = file.name.replace(/\.[^.]+$/, '');
  const displayName = opts.totalPages && opts.totalPages > 1
    ? `${baseName} (p.${pageNumber})`
    : baseName;
  const id = useBackdropStore.getState().addBackdrop(
    displayName,
    img.dataUrl,
    img.widthPx,
    img.heightPx,
    {
      source: {
        kind: 'pdf',
        originalName: baseName,
        pageNumber,
        ...(opts.totalPages !== undefined ? { totalPages: opts.totalPages } : {}),
        dpi: img.dpi,
      },
    },
  );
  return id;
}
