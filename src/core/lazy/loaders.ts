/**
 * Declared lazy loaders for every one-shot heavy module the user
 * touches at click-time — NOT at app boot.
 *
 * Add here; import `load*` from the call site. Never import the heavy
 * module directly from a component — that forces it into the main
 * chunk defeating the purpose.
 *
 * The chunk-name comment inside each dynamic import steers Rollup/Vite
 * to a predictable filename so:
 *   • Network tab shows `svg-exporter-Xhash.js` not `index-NNN.js`
 *   • Regression test can assert specific chunks exist
 *   • Users on poor networks get deterministic retry targets
 */

import { makeLazyLoader } from './lazyImport';

/**
 * SVG exporter — invoked from the Ctrl+Shift+E chord.
 * ~11 KB gzipped (373 lines of SVG geometry + export logic).
 */
export const loadSvgExporter = makeLazyLoader(
  'svg-exporter',
  () => import(
    /* webpackChunkName: "svg-exporter" */
    /* @vite-ignore */
    '../../engine/export/SVGExporter'
  ),
);

/**
 * IFC serializer — invoked from the ExportPanel's BIM button.
 * ~9 KB gzipped (303 lines). Loads with a ~150ms debounce so the
 * Export panel can render instantly on project open.
 */
export const loadIfcSerializer = makeLazyLoader(
  'ifc-serializer',
  () => import(
    /* webpackChunkName: "ifc-serializer" */
    /* @vite-ignore */
    '../../engine/export/IFCSerializer'
  ),
);

/**
 * DXF exporter — invoked from the ExportPanel's DXF button.
 * Pure module (~250 LOC), serializes scene → AutoCAD DXF R12+ ASCII.
 * Used for contractor hand-offs to GCs running AutoCAD / Revit /
 * BricsCAD. Phase 14.AA.1.
 */
export const loadDxfExporter = makeLazyLoader(
  'dxf-exporter',
  () => import(
    /* webpackChunkName: "dxf-exporter" */
    /* @vite-ignore */
    '../../engine/export/DXFExporter'
  ),
);

/**
 * PDF renderer — invoked from the MeasureToolbar when the user
 * uploads a PDF as a blueprint backdrop. ~300 KB gzipped (pdfjs-dist
 * core + our thin wrapper). The worker file itself is a separate
 * chunk loaded only when pdfjs first spins up a page render.
 * Phase 14.E.
 */
export const loadPdfRenderer = makeLazyLoader(
  'pdf-renderer',
  () => import(
    /* webpackChunkName: "pdf-renderer" */
    /* @vite-ignore */
    '../../engine/pdf/PDFRenderer'
  ),
);
