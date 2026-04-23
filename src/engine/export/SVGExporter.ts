/**
 * SVGExporter — vectorized 2D export for print-ready PDFs.
 *
 * Rather than screenshot the WebGL canvas (which pixelates), this
 * exporter projects the 3D scene through a deterministic camera
 * and emits pure SVG path data. The resulting vectors stay crisp
 * at any zoom level — perfect for blueprints printed at 24×36"
 * architectural scales.
 *
 * Pipeline:
 *   1. Choose projection (plan / front / side / iso)
 *   2. Walk committed pipes and fixtures
 *   3. Project each 3D point to 2D screen space
 *   4. Apply line weights by system type + pipe diameter
 *   5. Generate <path> elements with dash patterns for hidden lines
 *   6. Add dimension lines, labels, callouts, title block
 *   7. Return SVG document as a string
 *
 * The output SVG can then be:
 *   - Downloaded directly
 *   - Embedded in a PDF via jsPDF (vector path-level, not rasterized)
 *   - Printed via browser's native SVG rendering (high quality)
 *
 * All dimensions are in pixels at a specified scale (e.g. 1/4" = 1ft
 * means 1 foot → 48 pixels at 192 DPI which is standard CAD print).
 */

import type { CommittedPipe } from '@store/pipeStore';
import type { Vec3 } from '@core/events';
import type { SystemType } from '../graph/GraphNode';
import { ISO_TILT_EXACT } from '../../ui/cameras/IsoCamera';

// ── Export options ──────────────────────────────────────────────

export type ProjectionMode = 'plan' | 'front' | 'side' | 'iso_true' | 'iso_cabinet';

export interface SVGExportOptions {
  projection: ProjectionMode;
  /** Page size in points (72 pt/inch). Default = 24×36" arch D. */
  pageWidthPt: number;
  pageHeightPt: number;
  /** Drawing scale: how many SVG pixels per foot. */
  scalePxPerFt: number;
  /** Include title block. */
  titleBlock: boolean;
  /** Title block metadata. */
  projectName: string;
  drawingTitle: string;
  drawingNumber: string;
  revision: string;
  drawn: string;
  date: string;
  /** Show dimensions. */
  showDimensions: boolean;
  /** Show system labels. */
  showLabels: boolean;
  /** Show grid. */
  showGrid: boolean;
  /** Grid spacing (feet). */
  gridFt: number;
}

export const DEFAULT_EXPORT_OPTIONS: SVGExportOptions = {
  projection: 'iso_true',
  pageWidthPt: 2592,   // 36" × 72 pt/in
  pageHeightPt: 1728,  // 24" × 72 pt/in
  scalePxPerFt: 48,    // 1/4" = 1'
  titleBlock: true,
  projectName: 'ELBOW GREASE Project',
  drawingTitle: 'Plumbing Plan',
  drawingNumber: 'P-1.1',
  revision: 'A',
  drawn: 'Plumber',
  date: new Date().toLocaleDateString(),
  showDimensions: true,
  showLabels: true,
  showGrid: true,
  gridFt: 2,
};

// ── System → line weight/color (ANSI ASME Y14.2M) ──────────────

const SYSTEM_STYLES: Record<SystemType, { color: string; strokeWidth: number; dashArray: string }> = {
  waste:       { color: '#1f2937', strokeWidth: 2.5, dashArray: 'none' },
  vent:        { color: '#1f2937', strokeWidth: 1.8, dashArray: '8 4' }, // dashed = vent
  cold_supply: { color: '#1e40af', strokeWidth: 2.0, dashArray: 'none' },
  hot_supply:  { color: '#991b1b', strokeWidth: 2.0, dashArray: 'none' },
  storm:       { color: '#1f2937', strokeWidth: 2.5, dashArray: '2 3' }, // dotted
  // Phase 14.AA.3 — condensate. Purple with mid-dash to separate
  // from vent (8-4) and storm (2-3). ANSI doesn't specify a
  // condensate convention so we pick one distinct from the others.
  condensate:  { color: '#6b46c1', strokeWidth: 1.6, dashArray: '4 2' },
};

// ── Projection math ─────────────────────────────────────────────

/**
 * Project a 3D world point onto 2D canvas coordinates.
 */
function project(p: Vec3, mode: ProjectionMode, scale: number): [number, number] {
  const [x, y, z] = p;
  switch (mode) {
    case 'plan':
      // Top-down: X→screenX, Z→screenY (Y ignored)
      return [x * scale, -z * scale]; // -z because screen Y grows down
    case 'front':
      // Look along +Z: X→screenX, Y→screenY
      return [x * scale, -y * scale];
    case 'side':
      // Look along +X: Z→screenX, Y→screenY
      return [-z * scale, -y * scale];
    case 'iso_true': {
      // True isometric: 45° azimuth, -35.264° elevation
      const ang = Math.PI / 4;
      const tilt = ISO_TILT_EXACT;
      const sx = x * Math.cos(ang) - z * Math.sin(ang);
      const sy = (x * Math.sin(ang) + z * Math.cos(ang)) * Math.sin(tilt) - y * Math.cos(tilt);
      return [sx * scale, -sy * scale];
    }
    case 'iso_cabinet': {
      // 30° × 45°
      const ang = Math.PI / 4;
      const tilt = Math.PI / 6;
      const sx = x * Math.cos(ang) - z * Math.sin(ang);
      const sy = (x * Math.sin(ang) + z * Math.cos(ang)) * Math.sin(tilt) - y * Math.cos(tilt);
      return [sx * scale, -sy * scale];
    }
  }
}

// ── Bounding box helper ─────────────────────────────────────────

function computeBounds(
  pipes: CommittedPipe[],
  mode: ProjectionMode,
  scale: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pipe of pipes) {
    for (const pt of pipe.points) {
      const [x, y] = project(pt, mode, scale);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (!isFinite(minX)) { minX = -100; minY = -100; maxX = 100; maxY = 100; }
  return { minX, minY, maxX, maxY };
}

// ── SVG building blocks ─────────────────────────────────────────

function svgPath(points: [number, number][], style: { color: string; strokeWidth: number; dashArray: string }): string {
  if (points.length === 0) return '';
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  return `<path d="${d}" stroke="${style.color}" stroke-width="${style.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${style.dashArray}" />`;
}

function svgText(x: number, y: number, text: string, size: number = 8, color: string = '#222'): string {
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-family="Arial, sans-serif" font-size="${size}" fill="${color}" text-anchor="middle" dominant-baseline="middle">${escapeXml(text)}</text>`;
}

function svgRect(x: number, y: number, w: number, h: number, stroke: string, fill: string = 'none'): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${stroke}" stroke-width="1" fill="${fill}" />`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]!));
}

// ── Title block ─────────────────────────────────────────────────

function buildTitleBlock(opts: SVGExportOptions): string {
  const bx = opts.pageWidthPt - 250 - 20;
  const by = opts.pageHeightPt - 160 - 20;
  const w = 250;
  const h = 160;

  return `<g>
    ${svgRect(bx, by, w, h, '#111', '#fafafa')}
    ${svgText(bx + w / 2, by + 18, opts.projectName, 12, '#111')}
    ${svgText(bx + w / 2, by + 36, opts.drawingTitle, 10, '#555')}
    <line x1="${bx + 10}" y1="${by + 48}" x2="${bx + w - 10}" y2="${by + 48}" stroke="#aaa" stroke-width="0.5" />
    ${svgText(bx + 30, by + 64, 'DRAWN', 7, '#888')}
    ${svgText(bx + 30, by + 76, opts.drawn, 9, '#111')}
    ${svgText(bx + 100, by + 64, 'DATE', 7, '#888')}
    ${svgText(bx + 100, by + 76, opts.date, 9, '#111')}
    ${svgText(bx + 180, by + 64, 'REV', 7, '#888')}
    ${svgText(bx + 180, by + 76, opts.revision, 9, '#111')}
    <line x1="${bx + 10}" y1="${by + 92}" x2="${bx + w - 10}" y2="${by + 92}" stroke="#aaa" stroke-width="0.5" />
    ${svgText(bx + w / 2, by + 110, 'DRAWING NUMBER', 7, '#888')}
    ${svgText(bx + w / 2, by + 130, opts.drawingNumber, 16, '#111')}
    ${svgText(bx + w / 2, by + 150, `Scale: ${opts.scalePxPerFt === 48 ? '1/4" = 1\'' : `${opts.scalePxPerFt}px/ft`}`, 8, '#666')}
  </g>`;
}

// ── Grid ────────────────────────────────────────────────────────

function buildGrid(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  opts: SVGExportOptions,
): string {
  const step = opts.gridFt * opts.scalePxPerFt;
  const pad = step;
  let out = '<g>';
  for (let x = Math.floor(bounds.minX / step) * step - pad; x <= bounds.maxX + pad; x += step) {
    out += `<line x1="${x}" y1="${bounds.minY - pad}" x2="${x}" y2="${bounds.maxY + pad}" stroke="#e0e0e0" stroke-width="0.3" />`;
  }
  for (let y = Math.floor(bounds.minY / step) * step - pad; y <= bounds.maxY + pad; y += step) {
    out += `<line x1="${bounds.minX - pad}" y1="${y}" x2="${bounds.maxX + pad}" y2="${y}" stroke="#e0e0e0" stroke-width="0.3" />`;
  }
  out += '</g>';
  return out;
}

// ── Pipe rendering ──────────────────────────────────────────────

function renderPipes(pipes: CommittedPipe[], opts: SVGExportOptions): string {
  let out = '<g>';
  for (const pipe of pipes) {
    if (!pipe.visible) continue;
    const style = SYSTEM_STYLES[pipe.system] ?? SYSTEM_STYLES.waste;
    // Stroke weight also scales mildly with diameter
    const adjustedStyle = {
      ...style,
      strokeWidth: style.strokeWidth * (0.8 + pipe.diameter * 0.15),
    };
    const projected = pipe.points.map((p) => project(p, opts.projection, opts.scalePxPerFt));
    out += svgPath(projected, adjustedStyle);

    // Label at midpoint if enabled
    if (opts.showLabels && pipe.points.length >= 2) {
      const mid = pipe.points[Math.floor(pipe.points.length / 2)]!;
      const [lx, ly] = project(mid, opts.projection, opts.scalePxPerFt);
      out += svgText(lx, ly - 10, `${pipe.diameter}" ${pipe.material.replace('_', ' ')}`, 7, style.color);
    }
  }
  out += '</g>';
  return out;
}

// ── Dimension line ──────────────────────────────────────────────

function renderDimensions(
  pipes: CommittedPipe[],
  opts: SVGExportOptions,
): string {
  if (!opts.showDimensions) return '';
  let out = '<g>';
  for (const pipe of pipes.slice(0, 50)) {
    for (let i = 1; i < pipe.points.length; i++) {
      const a = pipe.points[i - 1]!;
      const b = pipe.points[i]!;
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 1) continue;
      const [x1, y1] = project(a, opts.projection, opts.scalePxPerFt);
      const [x2, y2] = project(b, opts.projection, opts.scalePxPerFt);
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const offsetX = 0;
      const offsetY = 15;
      out += `<line x1="${x1}" y1="${y1 + offsetY}" x2="${x2}" y2="${y2 + offsetY}" stroke="#666" stroke-width="0.5" />`;
      out += `<line x1="${x1}" y1="${y1 + offsetY - 3}" x2="${x1}" y2="${y1 + offsetY + 3}" stroke="#666" stroke-width="0.5" />`;
      out += `<line x1="${x2}" y1="${y2 + offsetY - 3}" x2="${x2}" y2="${y2 + offsetY + 3}" stroke="#666" stroke-width="0.5" />`;
      out += svgText(mx, my + offsetY + 10, `${len.toFixed(1)}'`, 6, '#666');
    }
  }
  out += '</g>';
  return out;
}

// ── Legend ──────────────────────────────────────────────────────

function buildLegend(opts: SVGExportOptions): string {
  const bx = 30;
  const by = opts.pageHeightPt - 180;
  const items: { label: string; style: typeof SYSTEM_STYLES[SystemType] }[] = [
    { label: 'Waste / Drain', style: SYSTEM_STYLES.waste },
    { label: 'Vent',          style: SYSTEM_STYLES.vent },
    { label: 'Cold Supply',   style: SYSTEM_STYLES.cold_supply },
    { label: 'Hot Supply',    style: SYSTEM_STYLES.hot_supply },
    { label: 'Storm',         style: SYSTEM_STYLES.storm },
  ];
  let out = `<g>${svgRect(bx, by, 180, 130, '#111', '#fafafa')}`;
  out += svgText(bx + 90, by + 16, 'LEGEND', 10, '#111');
  items.forEach((item, i) => {
    const yy = by + 36 + i * 18;
    out += `<line x1="${bx + 10}" y1="${yy}" x2="${bx + 50}" y2="${yy}" stroke="${item.style.color}" stroke-width="${item.style.strokeWidth}" stroke-dasharray="${item.style.dashArray}" />`;
    out += svgText(bx + 110, yy, item.label, 8, '#333');
  });
  out += '</g>';
  return out;
}

// ── Main export ─────────────────────────────────────────────────

export function exportToSVG(
  pipes: CommittedPipe[],
  options: Partial<SVGExportOptions> = {},
): string {
  const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options };

  const bounds = computeBounds(pipes, opts.projection, opts.scalePxPerFt);

  // Center drawing on page, leave margin for title block (right) and legend (bottom-left)
  const marginX = 40;
  const marginY = 40;
  const pageW = opts.pageWidthPt;
  const pageH = opts.pageHeightPt;
  const drawW = bounds.maxX - bounds.minX || 100;
  const drawH = bounds.maxY - bounds.minY || 100;

  const availW = pageW - 2 * marginX - 260; // reserve for title block
  const availH = pageH - 2 * marginY - 200; // reserve for legend
  const offsetX = marginX + (availW - drawW) / 2 - bounds.minX;
  const offsetY = marginY + (availH - drawH) / 2 - bounds.minY;

  const viewBox = `0 0 ${pageW} ${pageH}`;

  let body = '';
  if (opts.showGrid) body += buildGrid(bounds, opts);
  body += renderPipes(pipes, opts);
  if (opts.showDimensions) body += renderDimensions(pipes, opts);

  let doc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${pageW}" height="${pageH}">`;
  doc += '<rect x="0" y="0" width="100%" height="100%" fill="white" />';

  // Translate the drawing body
  doc += `<g transform="translate(${offsetX},${offsetY})">${body}</g>`;

  // Static elements (title block, legend)
  if (opts.titleBlock) doc += buildTitleBlock(opts);
  doc += buildLegend(opts);

  // Sheet border
  doc += svgRect(10, 10, pageW - 20, pageH - 20, '#111', 'none');
  doc += svgRect(20, 20, pageW - 40, pageH - 40, '#111', 'none');

  doc += '</svg>';
  return doc;
}

// ── Download helpers ────────────────────────────────────────────

export function downloadSVG(svgContent: string, filename: string = 'plumbing-plan.svg'): void {
  const blob = new Blob([svgContent], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Wrap SVG in a printable HTML page for browser-print-to-PDF.
 * This is the simplest cross-browser path to vectorized PDF —
 * Chromium prints SVG directly as vector content.
 */
export function openPrintableSVG(svgContent: string, title: string = 'Plumbing Plan'): void {
  const win = window.open('', '_blank');
  if (!win) return;
  win.document.write(`
    <!DOCTYPE html>
    <html><head><title>${title}</title>
    <style>
      @page { size: auto; margin: 0; }
      body { margin: 0; padding: 0; background: white; }
      svg { display: block; width: 100%; height: auto; }
    </style>
    </head><body>${svgContent}</body></html>
  `);
  win.document.close();
  setTimeout(() => win.print(), 500);
}
