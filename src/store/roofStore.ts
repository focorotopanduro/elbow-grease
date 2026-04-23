/**
 * Roof Store — Phase 14.R.1.
 *
 * Zustand store matching the `RoofGraph` class in AROYH's
 * `roof_graph.py`. Holds sections, vertices, measures, layers, and
 * the PDF underlay; exposes CRUD + undo + batching actions.
 *
 * Observer pattern from the Python version is replaced by Zustand
 * subscriptions — components using `useRoofStore((s) => s.sections)`
 * re-render automatically when sections change.
 *
 * Mirrors the existing `pipeStore.ts` pattern so roofing and
 * plumbing data live in parallel stores with identical ergonomics.
 */

import { create } from 'zustand';
import {
  type RoofSection,
  type RoofVertex,
  type MeasureLine,
  type LayerInfo,
  type PDFLayer,
  type RoofGraphSnapshot,
  type RoofView,
  type RoofType,
  type SectionType,
  type RoofPenetration,
  type PenetrationKind,
  DEFAULT_LAYERS,
  emptyPdfLayer,
  totalAreaNet,
  totalAreaPlan,
  totalPerimeter,
  sectionAt as sectionAtInList,
  calibratePdf,
  rescaleFromWorldPoints,
  rotatePolygon,
  polygonCentroid,
  createPenetration,
} from '../engine/roofing/RoofGraph';

// ── ID generators ───────────────────────────────────────────────

function randHex(len: number): string {
  const chars = '0123456789ABCDEF';
  let out = '';
  for (let i = 0; i < len; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function newSectionId(): string { return `SEC-${randHex(6)}`; }
function newVertexId():  string { return `VTX-${randHex(6)}`; }
function newMeasureId(): string { return `MSR-${randHex(6)}`; }
function newPenetrationId(): string { return `PEN-${randHex(6)}`; }

// ── Store shape ─────────────────────────────────────────────────

interface RoofState {
  sections: Record<string, RoofSection>;
  /** Insertion order — mirrors `pipeOrder` in pipeStore. */
  sectionOrder: string[];
  vertices: Record<string, RoofVertex>;
  measures: Record<string, MeasureLine>;
  layers: LayerInfo[];
  pdf: PDFLayer;
  selectedSectionId: string | null;

  /**
   * Phase 14.R.27 — spatial roof penetrations (chimneys, skylights,
   * plumbing vents). Placement drives the FL estimator's scalar
   * counts automatically; see `RoofingAggregator` for the sync.
   */
  penetrations: Record<string, RoofPenetration>;
  /** Insertion order for deterministic rendering + list UIs. */
  penetrationOrder: string[];

  // Internal
  undoStack: RoofGraphSnapshot[];
  redoStack: RoofGraphSnapshot[];
  batchDepth: number;
  dirtyDuringBatch: boolean;

  // ── Section CRUD ───────────────────────────────────────
  addSection: (
    opts: {
      x: number;
      y: number;
      length?: number;
      run?: number;
      slope?: number;
      label?: string;
      roofType?: RoofType;
      sectionType?: SectionType;
      overhang?: number;
      rotation?: number;
      z?: number;
      /** Phase 14.R.9 — polygon footprint. When provided:
       *   - `roofType` is passed through. R.11 added support for
       *     polygon + hip (pyramidal, apex at centroid) when the
       *     polygon is convex. Polygon + gable / shed currently
       *     degrades to a flat surface in both renderer + estimator
       *     (explicit ridge-axis / slope-direction choice is future
       *     work). Polygon + flat is the R.9 baseline.
       *   - `x / y / length / run / rotation` are auto-derived from
       *     the polygon's axis-aligned bounding box so rect-only code
       *     paths (thumbnails, legacy serialization) still produce
       *     something reasonable.
       */
      polygon?: ReadonlyArray<readonly [number, number]>;
    },
  ) => string;
  updateSection: (sid: string, patch: Partial<RoofSection>) => void;
  removeSection: (sid: string) => void;
  moveSection: (sid: string, x: number, y: number) => void;
  selectSection: (sid: string | null) => void;

  // ── Vertex CRUD ────────────────────────────────────────
  addVertex: (x: number, y: number, label?: string) => string;
  removeVertex: (vid: string) => void;

  // ── Measure CRUD ───────────────────────────────────────
  addMeasure: (x1: number, y1: number, x2: number, y2: number, label?: string) => string;
  removeMeasure: (mid: string) => void;

  // ── Phase 14.R.27 — Penetration CRUD ────────────────────
  /** Drop a chimney / skylight / vent at (x, y). Uses the kind's
   *  default footprint unless overridden. Auto-labels as "Skylight 1",
   *  "Skylight 2", etc. within its kind. Pushes one undo entry. */
  addPenetration: (opts: {
    kind: PenetrationKind;
    x: number;
    y: number;
    widthFt?: number;
    lengthFt?: number;
    label?: string;
  }) => string;
  /** Mutate a penetration via a partial patch. Pushes one undo entry.
   *  Use `updatePenetrationLive` for drag-to-move / drag-to-resize
   *  where you don't want a snapshot per pointer-move frame. */
  updatePenetration: (pid: string, patch: Partial<RoofPenetration>) => void;
  /** Live patch — no undo push. Pair with `pushUndoSnapshot` at
   *  drag end for single-entry undo, matching the R.18 / R.23
   *  drag-session pattern. */
  updatePenetrationLive: (pid: string, patch: Partial<RoofPenetration>) => void;
  removePenetration: (pid: string) => void;

  // ── Layers ─────────────────────────────────────────────
  setLayerVisible: (idx: number, visible: boolean) => void;
  setLayerOpacity: (idx: number, opacity: number) => void;
  setLayerLocked: (idx: number, locked: boolean) => void;

  // ── PDF underlay ───────────────────────────────────────
  setPdf: (path: string, page?: number) => void;
  setPdfOpacity: (opacity: number) => void;
  setPdfVisible: (visible: boolean) => void;
  calibratePdfWith: (x1: number, y1: number, x2: number, y2: number, realFt: number) => void;
  /** Phase 14.R.5 — two world-space anchor points + a known distance
   *  (ft). Converts to the equivalent `scale` under the existing
   *  pixel-based `calibratePdf` logic without requiring the UI to
   *  map world → pixels itself. */
  calibratePdfFromWorld: (
    w1: readonly [number, number],
    w2: readonly [number, number],
    realFt: number,
  ) => void;
  // Phase 14.R.5 — rendered-image management + free-form transforms.
  updatePdf: (patch: Partial<PDFLayer>) => void;
  /** Load a freshly rendered PDF page image. Resets the transform so
   *  a new PDF is centered at origin with scale = 1 px/ft until the
   *  user calibrates. */
  loadPdfImage: (args: {
    imageDataUrl: string;
    widthPx: number;
    heightPx: number;
    fileName: string;
    page?: number;
  }) => void;
  setPdfOffset: (x: number, y: number) => void;
  setPdfRotation: (deg: number) => void;
  setPdfScale: (pxPerFt: number) => void;
  setPdfLocked: (locked: boolean) => void;
  /** Reset the PDF slot to an empty layer (drops the image). */
  clearPdf: () => void;

  // ── Phase 14.R.19 rotation ─────────────────────────────
  /** Rotate a section's geometry to a specific `angleDeg`, measured
   *  from the `anchor` state. No undo push — used for high-frequency
   *  pointer-move updates during a rotation drag. For rect sections,
   *  writes `rotation = anchor.rotation + angleDeg`. For polygon
   *  sections, rebuilds polygon from `anchor.polygon` rotated by
   *  `angleDeg` around `center`, then recomputes bbox fields.
   *  The drag UI captures `anchor` at drag start and calls this many
   *  times with growing `angleDeg`. */
  rotateSectionLive: (
    sid: string,
    angleDeg: number,
    anchor: {
      rotation: number;
      polygon: ReadonlyArray<readonly [number, number]> | null;
      center: readonly [number, number];
    },
  ) => void;
  /** One-shot rotation that adjusts a section's geometry by `deltaDeg`
   *  from its CURRENT state AND pushes ONE undo entry. Used by the
   *  keyboard shortcuts ([ / ] / Shift / Ctrl) where each key press is
   *  its own discrete edit. */
  rotateSectionByDelta: (sid: string, deltaDeg: number) => void;

  // ── Phase 14.R.23 live section update (no-undo variant) ─
  /** Mutate a section via a partial patch WITHOUT pushing an undo
   *  entry. Designed for high-frequency drag sessions (e.g. the R.23
   *  axis-rotation gizmo) where the UI captures a pre-drag snapshot
   *  once and pushes it via `pushUndoSnapshot` at drag end. No-ops
   *  on missing or locked sections. */
  updateSectionLive: (sid: string, patch: Partial<RoofSection>) => void;

  // ── Phase 14.R.18 vertex editing ───────────────────────
  /** Mutate `polygon[idx]` on section `sid` to the new (x, y) point
   *  AND recompute the bbox-derived rect fields. Does NOT push an
   *  undo entry — designed for high-frequency pointer-move callbacks
   *  during a drag session. The drag UI layer captures a single
   *  snapshot at drag START and pushes it via `pushUndoSnapshot`
   *  at drag END, so Ctrl+Z rolls back the entire drag in one step.
   *  No-ops if the section is missing, non-polygon, locked, or if
   *  `idx` is out of bounds. */
  updatePolygonVertexLive: (
    sid: string,
    idx: number,
    pos: readonly [number, number],
  ) => void;
  /** Push a pre-captured `RoofGraphSnapshot` onto the undo stack and
   *  clear the redo stack. Used by the R.18 drag UI to commit ONE
   *  undo entry at drag end. */
  pushUndoSnapshot: (snap: RoofGraphSnapshot) => void;

  // ── Undo / redo / batching ─────────────────────────────
  undo: () => boolean;
  redo: () => boolean;
  beginBatch: () => void;
  endBatch: () => void;
  clear: () => void;

  // ── Persistence ────────────────────────────────────────
  serialize: () => RoofGraphSnapshot;
  loadSnapshot: (snap: RoofGraphSnapshot) => void;
}

// ── Helpers ─────────────────────────────────────────────────────

const MAX_UNDO = 60;

function snapshotOf(state: RoofState): RoofGraphSnapshot {
  return {
    // Deep-ish clone via plain-object spread per section — enough
    // to isolate the snapshot from future mutations since all
    // values are primitives (no nested objects in RoofSection).
    sections: Object.fromEntries(
      Object.entries(state.sections).map(([k, v]) => [k, { ...v }]),
    ),
    vertices: Object.fromEntries(
      Object.entries(state.vertices).map(([k, v]) => [k, { ...v }]),
    ),
    measures: Object.fromEntries(
      Object.entries(state.measures).map(([k, v]) => [k, { ...v }]),
    ),
    layers: state.layers.map((l) => ({ ...l })),
    pdf: { ...state.pdf },
    // Phase 14.R.27 — penetrations participate in undo/redo and
    // bundle persistence. Same shallow-spread clone is sufficient
    // since RoofPenetration is all primitives.
    penetrations: Object.fromEntries(
      Object.entries(state.penetrations).map(([k, v]) => [k, { ...v }]),
    ),
    penetrationOrder: [...state.penetrationOrder],
  };
}

// ── Store ───────────────────────────────────────────────────────

export const useRoofStore = create<RoofState>((set, get) => ({
  sections: {},
  sectionOrder: [],
  vertices: {},
  measures: {},
  layers: DEFAULT_LAYERS.map((l) => ({ ...l })),
  pdf: emptyPdfLayer(),
  selectedSectionId: null,
  penetrations: {},
  penetrationOrder: [],
  undoStack: [],
  redoStack: [],
  batchDepth: 0,
  dirtyDuringBatch: false,

  addSection: (opts) => {
    const sid = newSectionId();
    set((s) => {
      const existingCount = s.sectionOrder.length;
      const label = opts.label || `Section ${existingCount + 1}`;

      // Phase 14.R.9 — polygon-overrides branch. When a polygon is
      // supplied, derive the bbox + force flat roof, then store BOTH
      // the polygon and the rect fields. Downstream code that reads
      // the rect (legacy selectors, undo/redo snapshots) stays happy
      // and the new polygon-aware helpers (areaPlan, corners, etc.)
      // pick up the polygon via `hasPolygon()`.
      let x = opts.x;
      let y = opts.y;
      let length = opts.length ?? 30;
      let run = opts.run ?? 15;
      let rotation = opts.rotation ?? 0;
      let roofType: RoofType = opts.roofType ?? 'gable';
      const polygonClone: ReadonlyArray<readonly [number, number]> | undefined =
        opts.polygon && opts.polygon.length >= 3
          ? opts.polygon.map(([px, py]) => [px, py] as [number, number])
          : undefined;
      if (polygonClone) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [px, py] of polygonClone) {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
        x = minX;
        y = minY;
        length = maxX - minX;
        run = maxY - minY;
        rotation = 0; // polygon carries absolute coords
        // Phase 14.R.11 — roofType is NO LONGER forced to 'flat'.
        // The renderer + aggregator gracefully degrade to flat when
        // the combo isn't supported (polygon + concave + hip, or
        // polygon + gable / shed). roofType flows through from opts
        // so the user's choice in the toolbar is honored.
      }

      const section: RoofSection = {
        sectionId: sid,
        label,
        x,
        y,
        length,
        run,
        rotation,
        slope: opts.slope ?? 6,
        roofType,
        sectionType: opts.sectionType ?? 'main_roof',
        overhang: opts.overhang ?? 1,
        z: opts.z ?? 0,
        wastePct: 15,
        colorIdx: existingCount % 8,
        locked: false,
        ...(polygonClone ? { polygon: polygonClone } : {}),
      };
      const snap = snapshotOf(s);
      return {
        sections: { ...s.sections, [sid]: section },
        sectionOrder: [...s.sectionOrder, sid],
        undoStack: pushUndo(s.undoStack, snap),
        redoStack: [], // any mutation clears redo
      };
    });
    return sid;
  },

  updateSection: (sid, patch) => {
    set((s) => {
      const cur = s.sections[sid];
      if (!cur) return s;
      const snap = snapshotOf(s);
      return {
        sections: { ...s.sections, [sid]: { ...cur, ...patch } },
        undoStack: pushUndo(s.undoStack, snap),
        redoStack: [],
      };
    });
  },

  removeSection: (sid) => {
    set((s) => {
      if (!s.sections[sid]) return s;
      const { [sid]: _removed, ...rest } = s.sections;
      void _removed;
      const snap = snapshotOf(s);
      return {
        sections: rest,
        sectionOrder: s.sectionOrder.filter((id) => id !== sid),
        selectedSectionId: s.selectedSectionId === sid ? null : s.selectedSectionId,
        undoStack: pushUndo(s.undoStack, snap),
        redoStack: [],
      };
    });
  },

  moveSection: (sid, x, y) => {
    set((s) => {
      const cur = s.sections[sid];
      if (!cur || cur.locked) return s;
      const snap = snapshotOf(s);
      return {
        sections: { ...s.sections, [sid]: { ...cur, x, y } },
        undoStack: pushUndo(s.undoStack, snap),
        redoStack: [],
      };
    });
  },

  selectSection: (sid) => {
    set({ selectedSectionId: sid });
  },

  addVertex: (x, y, label = '') => {
    const vid = newVertexId();
    set((s) => ({
      vertices: { ...s.vertices, [vid]: { vertexId: vid, x, y, label } },
    }));
    return vid;
  },

  removeVertex: (vid) => {
    set((s) => {
      if (!s.vertices[vid]) return s;
      const { [vid]: _removed, ...rest } = s.vertices;
      void _removed;
      return { vertices: rest };
    });
  },

  addMeasure: (x1, y1, x2, y2, label = '') => {
    const mid = newMeasureId();
    set((s) => ({
      measures: {
        ...s.measures,
        [mid]: { lineId: mid, x1, y1, x2, y2, label },
      },
    }));
    return mid;
  },

  removeMeasure: (mid) => {
    set((s) => {
      if (!s.measures[mid]) return s;
      const { [mid]: _removed, ...rest } = s.measures;
      void _removed;
      return { measures: rest };
    });
  },

  // ── Phase 14.R.27 — penetration CRUD ────────────────────
  addPenetration: (opts) => {
    const pid = newPenetrationId();
    set((s) => {
      const kindCountBefore = Object.values(s.penetrations)
        .filter((p) => p.kind === opts.kind).length;
      const pen = createPenetration({
        id: pid,
        kind: opts.kind,
        x: opts.x,
        y: opts.y,
        ...(opts.widthFt !== undefined ? { widthFt: opts.widthFt } : {}),
        ...(opts.lengthFt !== undefined ? { lengthFt: opts.lengthFt } : {}),
        // Default label: "Skylight 1", "Chimney 2", etc. — scoped per kind.
        label: opts.label ?? `${createPenetration({
          id: '',
          kind: opts.kind,
          x: 0,
          y: 0,
        }).label} ${kindCountBefore + 1}`,
      });
      const snap = snapshotOf(s);
      return {
        penetrations: { ...s.penetrations, [pid]: pen },
        penetrationOrder: [...s.penetrationOrder, pid],
        undoStack: pushUndo(s.undoStack, snap),
        redoStack: [],
      };
    });
    return pid;
  },

  updatePenetration: (pid, patch) => {
    set((s) => {
      const cur = s.penetrations[pid];
      if (!cur) return s;
      const snap = snapshotOf(s);
      return {
        penetrations: { ...s.penetrations, [pid]: { ...cur, ...patch } },
        undoStack: pushUndo(s.undoStack, snap),
        redoStack: [],
      };
    });
  },

  updatePenetrationLive: (pid, patch) => {
    set((s) => {
      const cur = s.penetrations[pid];
      if (!cur) return s;
      return {
        penetrations: { ...s.penetrations, [pid]: { ...cur, ...patch } },
      };
    });
  },

  removePenetration: (pid) => {
    set((s) => {
      if (!s.penetrations[pid]) return s;
      const { [pid]: _removed, ...rest } = s.penetrations;
      void _removed;
      const snap = snapshotOf(s);
      return {
        penetrations: rest,
        penetrationOrder: s.penetrationOrder.filter((id) => id !== pid),
        undoStack: pushUndo(s.undoStack, snap),
        redoStack: [],
      };
    });
  },

  setLayerVisible: (idx, visible) => {
    set((s) => {
      if (idx < 0 || idx >= s.layers.length) return s;
      const layers = s.layers.map((l, i) => (i === idx ? { ...l, visible } : l));
      return { layers };
    });
  },

  setLayerOpacity: (idx, opacity) => {
    set((s) => {
      if (idx < 0 || idx >= s.layers.length) return s;
      const clamped = Math.max(0, Math.min(1, opacity));
      const layers = s.layers.map((l, i) =>
        i === idx ? { ...l, opacity: clamped } : l,
      );
      return { layers };
    });
  },

  setLayerLocked: (idx, locked) => {
    set((s) => {
      if (idx < 0 || idx >= s.layers.length) return s;
      const layers = s.layers.map((l, i) => (i === idx ? { ...l, locked } : l));
      return { layers };
    });
  },

  setPdf: (path, page = 0) => {
    set((s) => ({ pdf: { ...s.pdf, pdfPath: path, page } }));
  },

  setPdfOpacity: (opacity) => {
    set((s) => ({
      pdf: { ...s.pdf, opacity: Math.max(0, Math.min(1, opacity)) },
    }));
  },

  setPdfVisible: (visible) => {
    set((s) => ({ pdf: { ...s.pdf, visible } }));
  },

  calibratePdfWith: (x1, y1, x2, y2, realFt) => {
    set((s) => ({ pdf: calibratePdf(s.pdf, x1, y1, x2, y2, realFt) }));
  },

  calibratePdfFromWorld: (w1, w2, realFt) => {
    set((s) => {
      const newScale = rescaleFromWorldPoints(s.pdf.scale, w1, w2, realFt);
      // Stamp the anchors in world coords so the UI can visualize
      // the calibration the user committed to. Scale is the primary
      // payload — it drives physical plane dimensions.
      return {
        pdf: {
          ...s.pdf,
          scale: newScale,
          calX1: w1[0], calY1: w1[1],
          calX2: w2[0], calY2: w2[1],
          calDistanceFt: realFt,
        },
      };
    });
  },

  updatePdf: (patch) => {
    set((s) => ({ pdf: { ...s.pdf, ...patch } }));
  },

  loadPdfImage: ({ imageDataUrl, widthPx, heightPx, fileName, page = 1 }) => {
    set((s) => ({
      pdf: {
        ...s.pdf,
        imageDataUrl,
        widthPx,
        heightPx,
        fileName,
        pdfPath: fileName, // surface something meaningful when no path exists (web file picker)
        page,
        // Seed a usable default scale so the PDF is IMMEDIATELY visible
        // at a sane size even before calibration. 10 px/ft ≈ a 30-ft-wide
        // blueprint showing up as a 300-px-wide quadrilateral — readable
        // at the default camera distance without being overwhelming.
        scale: s.pdf.scale > 0 && s.pdf.widthPx ? s.pdf.scale : 10,
        // Recenter the plane on origin so the user's first view has the
        // PDF framed by the camera. They can drag/offset afterwards.
        offsetX: 0,
        offsetY: 0,
        rotationDeg: 0,
        visible: true,
        locked: false,
      },
    }));
  },

  setPdfOffset: (x, y) => {
    set((s) => ({ pdf: { ...s.pdf, offsetX: x, offsetY: y } }));
  },

  setPdfRotation: (deg) => {
    set((s) => ({ pdf: { ...s.pdf, rotationDeg: deg } }));
  },

  setPdfScale: (pxPerFt) => {
    set((s) => ({
      pdf: { ...s.pdf, scale: Math.max(0.01, pxPerFt) },
    }));
  },

  setPdfLocked: (locked) => {
    set((s) => ({ pdf: { ...s.pdf, locked } }));
  },

  clearPdf: () => {
    set(() => ({ pdf: emptyPdfLayer() }));
  },

  // Phase 14.R.19 — live rotation update, no undo push.
  rotateSectionLive: (sid, angleDeg, anchor) => {
    set((s) => {
      const sec = s.sections[sid];
      if (!sec || sec.locked) return s;
      // Polygon sections: rotate the anchor polygon around `center`
      // and re-derive bbox. Rect sections: write `rotation` directly.
      if (sec.polygon && anchor.polygon) {
        const newPolygon = rotatePolygon(anchor.polygon, anchor.center, angleDeg);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [px, py] of newPolygon) {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
        return {
          sections: {
            ...s.sections,
            [sid]: {
              ...sec,
              polygon: newPolygon,
              x: minX, y: minY,
              length: maxX - minX,
              run: maxY - minY,
            },
          },
        };
      }
      return {
        sections: {
          ...s.sections,
          [sid]: { ...sec, rotation: anchor.rotation + angleDeg },
        },
      };
    });
  },

  // Phase 14.R.19 — one-shot rotation via keyboard ([ / ] / Shift / Ctrl).
  // Pushes ONE undo entry for the discrete press.
  rotateSectionByDelta: (sid, deltaDeg) => {
    set((s) => {
      const sec = s.sections[sid];
      if (!sec || sec.locked) return s;
      const snap = snapshotOf(s);
      if (sec.polygon) {
        const center = polygonCentroid(sec.polygon);
        const newPolygon = rotatePolygon(sec.polygon, center, deltaDeg);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [px, py] of newPolygon) {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
        return {
          sections: {
            ...s.sections,
            [sid]: {
              ...sec,
              polygon: newPolygon,
              x: minX, y: minY,
              length: maxX - minX,
              run: maxY - minY,
            },
          },
          undoStack: pushUndo(s.undoStack, snap),
          redoStack: [],
        };
      }
      return {
        sections: {
          ...s.sections,
          [sid]: { ...sec, rotation: sec.rotation + deltaDeg },
        },
        undoStack: pushUndo(s.undoStack, snap),
        redoStack: [],
      };
    });
  },

  // Phase 14.R.23 — live partial patch, no undo push. Used by the
  // axis-rotation gizmo and any other drag UI that needs to mutate
  // a section field at 60fps without flooding the undo stack.
  updateSectionLive: (sid, patch) => {
    set((s) => {
      const sec = s.sections[sid];
      if (!sec || sec.locked) return s;
      return {
        sections: { ...s.sections, [sid]: { ...sec, ...patch } },
      };
    });
  },

  // Phase 14.R.18 — live polygon vertex update, no undo push.
  // Locked sections are NOT editable (matches R.8 section-drag rule).
  updatePolygonVertexLive: (sid, idx, pos) => {
    set((s) => {
      const sec = s.sections[sid];
      if (!sec || !sec.polygon || sec.locked) return s;
      if (idx < 0 || idx >= sec.polygon.length) return s;
      const newPolygon: [number, number][] = sec.polygon.map(
        (p, i) => (i === idx
          ? ([pos[0], pos[1]] as [number, number])
          : ([p[0], p[1]] as [number, number])),
      );
      // Recompute bbox-derived rect fields so rect-only legacy code
      // (thumbnails, FL estimator equivalent-rect math, hit tests
      // cached on x/y/length/run) stays in sync.
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [px, py] of newPolygon) {
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      return {
        sections: {
          ...s.sections,
          [sid]: {
            ...sec,
            polygon: newPolygon,
            x: minX,
            y: minY,
            length: maxX - minX,
            run: maxY - minY,
          },
        },
      };
    });
  },

  pushUndoSnapshot: (snap) => {
    set((s) => ({
      undoStack: pushUndo(s.undoStack, snap),
      redoStack: [],
    }));
  },

  undo: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return false;
    const prev = undoStack[undoStack.length - 1]!;
    set((s) => {
      const current = snapshotOf(s);
      return applySnapshot(prev, {
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, current],
      });
    });
    return true;
  },

  redo: () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return false;
    const next = redoStack[redoStack.length - 1]!;
    set((s) => {
      const current = snapshotOf(s);
      return applySnapshot(next, {
        undoStack: [...s.undoStack, current].slice(-MAX_UNDO),
        redoStack: s.redoStack.slice(0, -1),
      });
    });
    return true;
  },

  beginBatch: () => {
    set((s) => ({ batchDepth: s.batchDepth + 1 }));
  },

  endBatch: () => {
    set((s) => ({
      batchDepth: Math.max(0, s.batchDepth - 1),
      dirtyDuringBatch: s.batchDepth > 1 ? s.dirtyDuringBatch : false,
    }));
  },

  clear: () => {
    set((s) => {
      const snap = snapshotOf(s);
      return {
        sections: {},
        sectionOrder: [],
        vertices: {},
        measures: {},
        pdf: emptyPdfLayer(),
        selectedSectionId: null,
        // Phase 14.R.27 — wipe penetrations along with everything else.
        penetrations: {},
        penetrationOrder: [],
        undoStack: pushUndo(s.undoStack, snap),
        redoStack: [],
      };
    });
  },

  serialize: () => snapshotOf(get()),

  loadSnapshot: (snap) => {
    set((s) => {
      const current = snapshotOf(s);
      return applySnapshot(snap, {
        undoStack: pushUndo(s.undoStack, current),
        redoStack: [],
      });
    });
  },
}));

// ── Snapshot application ────────────────────────────────────────

function applySnapshot(
  snap: RoofGraphSnapshot,
  extras: Partial<RoofState>,
): Partial<RoofState> {
  // Rebuild sectionOrder from the snapshot's section keys. If the
  // snapshot was from an older version that didn't preserve order,
  // fall back to Object.keys insertion order (the best we can do).
  const sectionOrder = Object.keys(snap.sections);
  // Phase 14.R.27 — penetrations are an OPTIONAL field on
  // RoofGraphSnapshot (older snapshots / undo entries created
  // before R.27 landed may not carry them). Coerce missing to
  // empty so downstream code never has to null-check.
  const penetrations = snap.penetrations ?? {};
  const penetrationOrder = snap.penetrationOrder && snap.penetrationOrder.length > 0
    ? snap.penetrationOrder
    : Object.keys(penetrations);
  return {
    sections: snap.sections,
    sectionOrder,
    vertices: snap.vertices,
    measures: snap.measures,
    layers: snap.layers.map((l) => ({ ...l })),
    pdf: { ...snap.pdf },
    penetrations,
    penetrationOrder,
    ...extras,
  };
}

function pushUndo(
  stack: RoofGraphSnapshot[],
  snap: RoofGraphSnapshot,
): RoofGraphSnapshot[] {
  const next = [...stack, snap];
  if (next.length > MAX_UNDO) next.shift();
  return next;
}

// ── Derived / aggregate selectors ───────────────────────────────

export function selectSectionsArray(state: RoofState): RoofSection[] {
  return state.sectionOrder
    .map((id) => state.sections[id])
    .filter((s): s is RoofSection => Boolean(s));
}

export function selectTotalAreaNet(state: RoofState): number {
  return totalAreaNet(selectSectionsArray(state));
}

export function selectTotalAreaPlan(state: RoofState): number {
  return totalAreaPlan(selectSectionsArray(state));
}

export function selectTotalPerimeter(state: RoofState): number {
  return totalPerimeter(selectSectionsArray(state));
}

/**
 * Hit-test helper — find topmost section containing (wx, wy) in
 * the given view.
 */
export function sectionAt(
  state: RoofState,
  wx: number,
  wy: number,
  view: RoofView = 'top',
): string | null {
  return sectionAtInList(selectSectionsArray(state), wx, wy, view);
}

/**
 * Phase 14.R.27 — penetrations in insertion order. Mirrors the
 * sectionOrder-driven `selectSectionsArray` so consumers render
 * markers deterministically across re-renders.
 */
export function selectPenetrationsArray(state: RoofState): RoofPenetration[] {
  return state.penetrationOrder
    .map((id) => state.penetrations[id])
    .filter((p): p is RoofPenetration => Boolean(p));
}
