/**
 * PerfHUD — live performance overlay.
 *
 * Layout (top-right, compact):
 *
 *   ┌─────────────────────────────────┐
 *   │ 59 FPS     │ mean 16.9 p95 22.4 │
 *   │ ▁▁▂▂▃▃▄▄▅▅ sparkline             │
 *   │ worker 8.2ms (p95 14.1)         │
 *   │ 34 draws · 128k tris            │
 *   │ heap 48 / 2048 MB                │
 *   └─────────────────────────────────┘
 *
 * The FPS readout is colored green ≥ 55, yellow 30–55, red < 30.
 *
 * Visibility:
 *   • Ctrl+Shift+P toggles the `perfHud` feature flag.
 *   • Esc closes when open.
 *
 * Implementation notes:
 *   • Polls `PerfStats.getSample()` at 10 Hz via setInterval — does NOT
 *     re-render on every frame (60 Hz would be wasteful and the data
 *     doesn't change fast enough to warrant it).
 *   • Sparkline drawn via inline SVG — 120 frames × ~2px wide fits in
 *     a ~240px strip at 1 sample per pixel. Crisp without a canvas
 *     context.
 *   • Respects prefers-reduced-motion by skipping the color-pulse on
 *     the FPS digits (see Phase 10.C).
 */

import { useEffect, useState } from 'react';
import { useFeatureFlagStore } from '@store/featureFlagStore';
import { getSample, type PerfSample } from '@core/perf/PerfStats';

// ── Shortcut hook ──────────────────────────────────────────────

function usePerfHudShortcut(): void {
  const setFlag = useFeatureFlagStore((s) => s.set);
  const current = useFeatureFlagStore((s) => s.perfHud);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        // Ignore if typing.
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        setFlag('perfHud', !current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, setFlag]);
}

// ── Main component ─────────────────────────────────────────────

export function PerfHUD() {
  usePerfHudShortcut();
  const isOpen = useFeatureFlagStore((s) => s.perfHud);
  const setFlag = useFeatureFlagStore((s) => s.set);
  const [sample, setSample] = useState<PerfSample>(() => getSample());

  // Poll at 10 Hz. Nothing more frequent — the human eye can't parse
  // 60 FPS text updates meaningfully, and it would thrash the renderer.
  useEffect(() => {
    if (!isOpen) return;
    const id = window.setInterval(() => {
      setSample(getSample());
    }, 100);
    return () => window.clearInterval(id);
  }, [isOpen]);

  // Escape to close (only while open).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setFlag('perfHud', false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, setFlag]);

  if (!isOpen) return null;

  const fps = Math.round(sample.fps);
  const fpsColor = fps >= 55 ? '#66bb6a' : fps >= 30 ? '#ffc107' : '#ff1744';

  return (
    <div
      style={styles.panel}
      role="status"
      aria-live="off"
      aria-label="Performance telemetry"
    >
      <div style={styles.header}>
        <span style={styles.title}>⚡ PERF</span>
        <button
          style={styles.closeBtn}
          aria-label="Close performance HUD"
          onClick={() => setFlag('perfHud', false)}
        >
          ×
        </button>
      </div>

      {/* FPS + frame times */}
      <div style={styles.row}>
        <span style={{ ...styles.fps, color: fpsColor }}>
          {fps} <span style={styles.unit}>FPS</span>
        </span>
        <span style={styles.frameStats}>
          <span>last {sample.frameTimeMs.toFixed(1)}ms</span>
          <span style={styles.sep}>·</span>
          <span>mean {sample.meanFrameTimeMs.toFixed(1)}</span>
          <span style={styles.sep}>·</span>
          <span>p95 {sample.p95FrameTimeMs.toFixed(1)}</span>
        </span>
      </div>

      {/* Sparkline */}
      <Sparkline history={sample.frameTimeHistory} />

      {/* Worker latency */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>worker</span>
        <span style={styles.rowValue}>
          {sample.workerLatencyMs > 0
            ? `${sample.workerLatencyMs.toFixed(1)}ms (p95 ${sample.workerLatencyP95.toFixed(1)})`
            : '— no solves'}
        </span>
      </div>

      {/* Draw calls + triangles */}
      <div style={styles.row}>
        <span style={styles.rowLabel}>gpu</span>
        <span style={styles.rowValue}>
          {sample.drawCalls} draws · {formatTris(sample.triangles)} tris
        </span>
      </div>

      {/* Heap (if available) */}
      {sample.heapUsedMB !== null && sample.heapLimitMB !== null && (
        <div style={styles.row}>
          <span style={styles.rowLabel}>heap</span>
          <span style={styles.rowValue}>
            {sample.heapUsedMB.toFixed(0)} / {sample.heapLimitMB.toFixed(0)} MB
          </span>
        </div>
      )}

      {/* Pipe loop telemetry (Phase 14.AC.4). Hidden until any activity. */}
      <PipeLoopPanel metrics={sample.pipeLoop} />

      <div style={styles.footer}>
        <kbd style={styles.kbd}>Ctrl</kbd>+<kbd style={styles.kbd}>Shift</kbd>+<kbd style={styles.kbd}>P</kbd> to toggle · <kbd style={styles.kbd}>Esc</kbd> to close
      </div>
    </div>
  );
}

// ── Pipe loop section ──────────────────────────────────────────

/**
 * Three-line pipe-hot-path readout. Hidden entirely until the user
 * has actually touched a pipe — an empty scene shouldn't show zeros
 * that imply something is wrong.
 */
function PipeLoopPanel({ metrics }: { metrics: import('@core/perf/PerfStats').PipeLoopMetrics }) {
  const anyActivity =
    metrics.cacheHits > 0
    || metrics.cacheMisses > 0
    || metrics.rafEmissionsReceived > 0
    || metrics.lastBatchOps > 0;
  if (!anyActivity) return null;

  const hitPct = Math.round(metrics.cacheHitRate * 100);
  const dropPct = Math.round(metrics.rafDropRate * 100);

  // Color cues: cache hit rate is green if it's earning its keep,
  // yellow if it's marginal, red if the cache is thrashing (which
  // would signal a ref-stability regression).
  const hitColor = hitPct >= 80 ? '#66bb6a' : hitPct >= 40 ? '#ffc107' : '#ff1744';
  // Drop rate: green high (coalescer is working), grey low (no bursts
  // happening, which is fine — not a problem, just no savings to show).
  const dropColor = dropPct >= 30 ? '#66bb6a' : '#7f8c9a';

  return (
    <>
      <div style={styles.sectionDivider} />
      <div style={styles.row}>
        <span style={styles.rowLabel}>cache</span>
        <span style={styles.rowValue}>
          <span style={{ color: hitColor }}>{hitPct}%</span>
          <span style={styles.sep}>·</span>
          {metrics.cacheHits} hits · {metrics.cacheMisses} miss
        </span>
      </div>
      <div style={styles.row}>
        <span style={styles.rowLabel}>batch</span>
        <span style={styles.rowValue}>
          last {metrics.lastBatchOps} ops
        </span>
      </div>
      {metrics.rafEmissionsReceived > 0 && (
        <div style={styles.row}>
          <span style={styles.rowLabel}>rAF</span>
          <span style={styles.rowValue}>
            <span style={{ color: dropColor }}>{dropPct}%</span>
            <span style={styles.sep}>·</span>
            {metrics.rafInvocationsFired} / {metrics.rafEmissionsReceived} fired
          </span>
        </div>
      )}
    </>
  );
}

// ── Sparkline ──────────────────────────────────────────────────

/**
 * Inline SVG — 240 × 28 px — paints each frame-time as a vertical bar.
 * Bar height scales to max(50, observed max) ms so a sudden spike is
 * visible but normal frames (~16ms) fill about a third of the strip.
 */
function Sparkline({ history }: { history: Float32Array }) {
  const w = 240;
  const h = 28;
  const n = history.length;
  const barW = w / n;

  // Scale: max of observed vs. a 50ms floor so normal variation isn't
  // amplified past readable range.
  let max = 50;
  for (let i = 0; i < n; i++) if (history[i]! > max) max = history[i]!;

  // Build a single <path> instead of N <rect>s — 120 children is fine
  // but a single path is fewer nodes and paints faster.
  let d = '';
  for (let i = 0; i < n; i++) {
    const v = history[i]!;
    if (v <= 0) continue;
    const barH = Math.max(1, (v / max) * h);
    const x = i * barW;
    d += `M${x.toFixed(2)} ${h} L${x.toFixed(2)} ${(h - barH).toFixed(2)} `;
  }

  // Reference line at 16.67ms (60 FPS) — tells the eye where "good" is.
  const goodY = h - (16.67 / max) * h;

  return (
    <svg width={w} height={h} style={styles.sparkline} aria-hidden="true">
      <line x1={0} y1={goodY} x2={w} y2={goodY} stroke="#2a3a54" strokeDasharray="2 3" />
      <path d={d} stroke="#00e5ff" strokeWidth={1.5} fill="none" opacity={0.85} />
    </svg>
  );
}

// ── Helpers ────────────────────────────────────────────────────

function formatTris(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

// ── Styles ─────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'fixed',
    top: 16,
    right: 16,
    width: 280,
    background: 'rgba(8,12,20,0.96)',
    border: '1px solid #2a3a54',
    borderRadius: 8,
    boxShadow: '0 10px 30px rgba(0,0,0,0.6)',
    color: '#cfd8e3',
    fontFamily: 'Consolas, "JetBrains Mono", monospace',
    fontSize: 11,
    padding: '8px 12px 10px',
    zIndex: 900,
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    marginBottom: 2,
    paddingBottom: 4,
    borderBottom: '1px solid #1a2334',
  },
  title: {
    color: '#00e5ff',
    fontWeight: 700,
    letterSpacing: 2,
    fontSize: 10,
    flex: 1,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#7a8592',
    fontSize: 16,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0 4px',
  },
  row: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: 11,
  },
  fps: {
    fontSize: 22,
    fontWeight: 700,
    fontVariantNumeric: 'tabular-nums',
    minWidth: 72,
  },
  unit: {
    fontSize: 10,
    color: '#7a8592',
    fontWeight: 500,
  },
  frameStats: {
    fontSize: 10,
    color: '#aebbc9',
    display: 'flex',
    gap: 4,
    fontVariantNumeric: 'tabular-nums',
    flexWrap: 'wrap',
  },
  sep: { color: '#4a5668' },
  rowLabel: {
    color: '#7a8592',
    fontSize: 10,
    width: 56,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  rowValue: {
    color: '#e0e6ef',
    fontVariantNumeric: 'tabular-nums',
    flex: 1,
  },
  sparkline: {
    display: 'block',
    marginTop: 2,
    marginBottom: 2,
    background: 'rgba(0,0,0,0.3)',
    border: '1px solid #1a2334',
    borderRadius: 3,
  },
  sectionDivider: {
    marginTop: 4,
    marginBottom: 2,
    borderTop: '1px dashed #1a2334',
  },
  footer: {
    marginTop: 4,
    paddingTop: 4,
    borderTop: '1px solid #1a2334',
    fontSize: 9,
    color: '#7a8592',
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap',
    alignItems: 'center',
  },
  kbd: {
    display: 'inline-block',
    fontFamily: 'Consolas, monospace',
    fontSize: 9,
    color: '#e0e6ef',
    background: '#1a2334',
    border: '1px solid #2a3a54',
    borderRadius: 2,
    padding: '0 4px',
    marginInline: 1,
  },
};
