/**
 * dxfLoader — Phase 14.R.25.
 *
 * Minimal ASCII DXF underlay loader. Parses the common architectural
 * entities a roofing contractor's blueprint is built from — LINE,
 * LWPOLYLINE, CIRCLE, ARC — and rasterizes them to a PNG data URL
 * that feeds the same `roofStore.loadPdfImage()` path as PDFs and
 * images.
 *
 * What's IN scope:
 *   • ASCII DXF (text) — the format most CAD exporters produce
 *   • LINE       — two-point line segments
 *   • LWPOLYLINE — lightweight polyline (most common in modern CAD)
 *   • CIRCLE     — full circle
 *   • ARC        — circular arc with start + end angles
 *
 * What's NOT (yet):
 *   • Binary DXF — detected and rejected with a clear error message
 *   • SPLINE, TEXT, MTEXT, INSERT, BLOCKS — not parsed, silently
 *     skipped during entity iteration
 *   • Layers beyond "draw them all in black" — the underlay's only
 *     job is "show me the shapes so I can trace the roof"
 *
 * Split deliberately into a PURE parser (text → entity list) and a
 * browser-only rasterizer (entities → canvas → data URL) so the
 * parser is fully unit-testable without a DOM.
 */

// ── Entity types ────────────────────────────────────────────────

export type DxfEntity =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'polyline'; closed: boolean; points: ReadonlyArray<readonly [number, number]> }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'arc'; cx: number; cy: number; r: number; startDeg: number; endDeg: number };

export interface ParsedDxf {
  entities: DxfEntity[];
  /** Axis-aligned bounding box across every drawn entity, in DXF
   *  world coordinates. `null` when the file has no drawable
   *  entities. */
  bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

// ── File-type detection ────────────────────────────────────────

/** True for files the DXF loader handles (ASCII DXF only). */
export function isDxfFile(file: { name?: string; type?: string }): boolean {
  const name = (file.name ?? '').toLowerCase();
  if (name.endsWith('.dxf')) return true;
  // MIME is rarely set for DXF; most browsers emit empty / octet-stream.
  const type = (file.type ?? '').toLowerCase();
  return type === 'application/dxf' || type === 'image/vnd.dxf';
}

// ── Pure parser ─────────────────────────────────────────────────

/**
 * Parse ASCII DXF text into an entity list + bbox. Returns an empty
 * entity list for files that parse but contain no supported entities.
 *
 * Detects binary DXF (starts with "AutoCAD Binary DXF") and throws a
 * clear error rather than producing garbage.
 */
export function parseDxf(text: string): ParsedDxf {
  if (text.startsWith('AutoCAD Binary DXF')) {
    throw new Error(
      'Binary DXF is not supported. Re-export as ASCII DXF from your CAD tool.',
    );
  }
  const pairs = tokenizePairs(text);
  const entities: DxfEntity[] = [];
  // Walk pairs looking for "0 ENTITIES" section start, then parse
  // entities until "0 ENDSEC".
  let i = 0;
  let inEntities = false;
  while (i < pairs.length) {
    const [code, value] = pairs[i]!;
    if (!inEntities) {
      if (code === 0 && value === 'SECTION') {
        // Next pair is (2, <section-name>)
        if (i + 1 < pairs.length && pairs[i + 1]![0] === 2
            && pairs[i + 1]![1] === 'ENTITIES') {
          inEntities = true;
          i += 2;
          continue;
        }
      }
      i += 1;
      continue;
    }
    // Inside ENTITIES — dispatch on entity type.
    if (code === 0) {
      if (value === 'ENDSEC' || value === 'EOF') break;
      const [nextI, entity] = parseEntity(value, pairs, i + 1);
      if (entity) entities.push(entity);
      i = nextI;
      continue;
    }
    i += 1;
  }
  return { entities, bbox: computeBbox(entities) };
}

/**
 * Split DXF text into (code, value) pairs. Each group occupies two
 * lines: a numeric code followed by a string value. Handles CRLF
 * + LF + CR line endings and trims whitespace.
 */
function tokenizePairs(text: string): Array<readonly [number, string]> {
  const lines = text.split(/\r\n|\n|\r/).map((s) => s.trim());
  const out: Array<readonly [number, string]> = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const codeStr = lines[i]!;
    if (codeStr === '') continue;
    const code = Number.parseInt(codeStr, 10);
    if (!Number.isFinite(code)) continue;
    out.push([code, lines[i + 1] ?? '']);
  }
  return out;
}

/**
 * Parse a single entity given its type name and the pair list
 * starting at index `start`. Returns the next index to resume from
 * + the entity (or null if the type isn't supported — pairs are
 * still consumed up to the next group-0 boundary).
 */
function parseEntity(
  type: string,
  pairs: Array<readonly [number, string]>,
  start: number,
): [number, DxfEntity | null] {
  // Collect all pairs belonging to this entity until the next group 0.
  const end = nextGroupZero(pairs, start);
  const slice = pairs.slice(start, end);
  switch (type) {
    case 'LINE':       return [end, parseLine(slice)];
    case 'LWPOLYLINE': return [end, parseLwPolyline(slice)];
    case 'CIRCLE':     return [end, parseCircle(slice)];
    case 'ARC':        return [end, parseArc(slice)];
    default:           return [end, null];
  }
}

function nextGroupZero(
  pairs: Array<readonly [number, string]>,
  start: number,
): number {
  for (let i = start; i < pairs.length; i++) {
    if (pairs[i]![0] === 0) return i;
  }
  return pairs.length;
}

function getNum(pairs: Array<readonly [number, string]>, code: number): number | null {
  for (const [c, v] of pairs) {
    if (c === code) {
      const n = Number.parseFloat(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function parseLine(pairs: Array<readonly [number, string]>): DxfEntity | null {
  const x1 = getNum(pairs, 10);
  const y1 = getNum(pairs, 20);
  const x2 = getNum(pairs, 11);
  const y2 = getNum(pairs, 21);
  if (x1 === null || y1 === null || x2 === null || y2 === null) return null;
  return { kind: 'line', x1, y1, x2, y2 };
}

function parseLwPolyline(pairs: Array<readonly [number, string]>): DxfEntity | null {
  // Vertex list interleaved: (10, x1), (20, y1), (10, x2), (20, y2), ...
  // 70 = flags (bit 1 = closed). 90 = vertex count (informational).
  const points: [number, number][] = [];
  let pendingX: number | null = null;
  let closed = false;
  for (const [code, value] of pairs) {
    if (code === 70) {
      const f = Number.parseInt(value, 10);
      if (Number.isFinite(f) && (f & 1) !== 0) closed = true;
    } else if (code === 10) {
      pendingX = Number.parseFloat(value);
    } else if (code === 20) {
      const y = Number.parseFloat(value);
      if (pendingX !== null && Number.isFinite(y)) {
        points.push([pendingX, y]);
      }
      pendingX = null;
    }
  }
  if (points.length < 2) return null;
  return { kind: 'polyline', closed, points };
}

function parseCircle(pairs: Array<readonly [number, string]>): DxfEntity | null {
  const cx = getNum(pairs, 10);
  const cy = getNum(pairs, 20);
  const r = getNum(pairs, 40);
  if (cx === null || cy === null || r === null || r <= 0) return null;
  return { kind: 'circle', cx, cy, r };
}

function parseArc(pairs: Array<readonly [number, string]>): DxfEntity | null {
  const cx = getNum(pairs, 10);
  const cy = getNum(pairs, 20);
  const r = getNum(pairs, 40);
  const startDeg = getNum(pairs, 50);
  const endDeg = getNum(pairs, 51);
  if (cx === null || cy === null || r === null || r <= 0) return null;
  if (startDeg === null || endDeg === null) return null;
  return { kind: 'arc', cx, cy, r, startDeg, endDeg };
}

// ── Bbox ────────────────────────────────────────────────────────

/**
 * Compute the axis-aligned bounding box across a set of entities.
 * Handles negative or reversed coordinates cleanly. Returns null on
 * empty input so the rasterizer can report "no drawable entities"
 * without dividing by zero on the scale pass.
 */
export function computeBbox(entities: ReadonlyArray<DxfEntity>): ParsedDxf['bbox'] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const expand = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const e of entities) {
    if (e.kind === 'line') {
      expand(e.x1, e.y1);
      expand(e.x2, e.y2);
    } else if (e.kind === 'polyline') {
      for (const [x, y] of e.points) expand(x, y);
    } else if (e.kind === 'circle' || e.kind === 'arc') {
      // Conservative: bounding box of the full circle. Arcs never
      // extend beyond it, so we over-include at worst.
      expand(e.cx - e.r, e.cy - e.r);
      expand(e.cx + e.r, e.cy + e.r);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

// ── Rasterizer (browser-only) ───────────────────────────────────

export interface RasterizeOptions {
  /** Max canvas dimension in pixels. Default 2000 — balances clarity
   *  with memory cost; a contractor's monitor is rarely wider. */
  maxDim?: number;
  /** Stroke width in canvas pixels. Default 1. */
  strokeWidth?: number;
  /** Stroke color. Default solid black. */
  strokeColor?: string;
  /** Margin around content in canvas pixels. Default 20. */
  marginPx?: number;
}

export interface RasterizedDxf {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
}

/**
 * Browser-only rasterizer. Given a parsed DXF, produces a PNG data
 * URL at a sensible pixel resolution, fitting the content to the
 * canvas with margin. Canvas Y axis is flipped vs DXF Y (DXF is math
 * convention, up=+Y; canvas is up=−Y) so the output reads correctly.
 *
 * Throws when no drawable entities exist — the caller should show
 * the user "DXF has no supported entities" rather than a blank
 * underlay.
 */
export function rasterizeDxf(
  parsed: ParsedDxf,
  opts: RasterizeOptions = {},
): RasterizedDxf {
  if (!parsed.bbox) {
    throw new Error('DXF has no drawable entities (parser found none of LINE / LWPOLYLINE / CIRCLE / ARC).');
  }
  const maxDim = opts.maxDim ?? 2000;
  const strokeWidth = opts.strokeWidth ?? 1;
  const strokeColor = opts.strokeColor ?? '#000000';
  const marginPx = opts.marginPx ?? 20;

  const { minX, minY, maxX, maxY } = parsed.bbox;
  const worldW = maxX - minX;
  const worldH = maxY - minY;
  if (worldW <= 0 && worldH <= 0) {
    throw new Error('DXF content has zero-size bounding box.');
  }
  // Fit longest side to (maxDim - 2·margin), preserving aspect.
  const inner = Math.max(1, maxDim - 2 * marginPx);
  const scale = worldW >= worldH
    ? (worldW > 0 ? inner / worldW : 1)
    : (worldH > 0 ? inner / worldH : 1);
  const canvasW = Math.max(1, Math.round(worldW * scale + 2 * marginPx));
  const canvasH = Math.max(1, Math.round(worldH * scale + 2 * marginPx));

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable');

  // White background — calibration clicks land on white pixels, not
  // transparency-confusion alpha.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Transform: DXF world → canvas pixels with Y flip.
  //   canvasX = (worldX - minX) * scale + margin
  //   canvasY = canvasH - ((worldY - minY) * scale + margin)
  const toCx = (x: number) => (x - minX) * scale + marginPx;
  const toCy = (y: number) => canvasH - ((y - minY) * scale + marginPx);

  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const e of parsed.entities) {
    drawEntity(ctx, e, toCx, toCy, scale);
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    widthPx: canvasW,
    heightPx: canvasH,
  };
}

function drawEntity(
  ctx: CanvasRenderingContext2D,
  e: DxfEntity,
  toCx: (x: number) => number,
  toCy: (y: number) => number,
  scale: number,
): void {
  ctx.beginPath();
  if (e.kind === 'line') {
    ctx.moveTo(toCx(e.x1), toCy(e.y1));
    ctx.lineTo(toCx(e.x2), toCy(e.y2));
    ctx.stroke();
    return;
  }
  if (e.kind === 'polyline') {
    if (e.points.length === 0) return;
    const [firstX, firstY] = e.points[0]!;
    ctx.moveTo(toCx(firstX), toCy(firstY));
    for (let i = 1; i < e.points.length; i++) {
      const [px, py] = e.points[i]!;
      ctx.lineTo(toCx(px), toCy(py));
    }
    if (e.closed) ctx.closePath();
    ctx.stroke();
    return;
  }
  if (e.kind === 'circle') {
    ctx.arc(toCx(e.cx), toCy(e.cy), e.r * scale, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  if (e.kind === 'arc') {
    // DXF uses degrees CCW from +X. Canvas `arc` uses radians CW from
    // +X (because canvas Y is flipped). Combining the Y-flip with the
    // direction-flip: canvas start/end = -DXF start/end.
    const startRad = (-e.startDeg * Math.PI) / 180;
    const endRad = (-e.endDeg * Math.PI) / 180;
    // Pass anticlockwise=true so CCW in DXF stays visually CCW.
    ctx.arc(toCx(e.cx), toCy(e.cy), e.r * scale, startRad, endRad, true);
    ctx.stroke();
    return;
  }
}

// ── File-level loader ──────────────────────────────────────────

export interface LoadedDxf {
  dataUrl: string;
  widthPx: number;
  heightPx: number;
  fileName: string;
}

/**
 * Load a `.dxf` File, parse it, rasterize to PNG data URL. Rejects
 * with a clear error on binary DXF, unreadable files, or empty
 * entity lists.
 */
export async function loadDxfFile(file: File): Promise<LoadedDxf> {
  const text = await file.text();
  const parsed = parseDxf(text);
  const raster = rasterizeDxf(parsed);
  return { ...raster, fileName: file.name };
}
