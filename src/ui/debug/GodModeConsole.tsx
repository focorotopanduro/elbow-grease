/**
 * GodModeConsole — slide-up developer panel driven by the CommandBus.
 *
 * Columns:
 *   1. Stream   — live list of dispatched commands, newest at top,
 *                 filterable by type prefix and by rejected-only.
 *   2. Detail   — click any stream row to inspect: full payload,
 *                 correlation chain, apply-ms, reject reason.
 *   3. Controls — Clear log · Copy log JSON · Feature flag toggles ·
 *                 Replay (stretch goal, gated by an inner flag since
 *                 time-travel replay requires store reset hooks not
 *                 yet in place).
 *
 * Keyboard:
 *   Ctrl+Shift+G   toggle console + godMode flag
 *   Esc            close when focused inside console
 *
 * Performance:
 *   - Stream list is windowed via slice (top 200 only visible).
 *     500-entry ring buffer enforces the memory cap.
 *   - Subscribes via commandBus.subscribe — no polling.
 *   - Render-gated by `godMode` flag; when off this component
 *     returns null immediately (zero cost).
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { commandBus } from '@core/commands/CommandBus';
import type { CommandLogEntry } from '@core/commands/types';
import { useFeatureFlagStore } from '@store/featureFlagStore';
// Phase 10.A — Logger integration
import {
  subscribe as subscribeLog,
  getLog as getLoggerEntries,
  clearLog as clearLoggerLog,
  type LogEntry,
  type LogLevel,
} from '@core/logger/Logger';
// Phase 10.C — Focus trap for modal a11y.
import { useFocusTrap } from '@core/a11y/useFocusTrap';
// Phase 10.E — telemetry export controls.
import {
  exportJSON as exportTelemetryJSON,
  exportJSONL as exportTelemetryJSONL,
  reset as resetTelemetry,
  getSession as getTelemetrySession,
  flushBucket as flushTelemetryBucket,
  isCollecting as isTelemetryCollecting,
} from '@core/telemetry/SessionTelemetry';

const VISIBLE_LIMIT = 200;

// ── Shortcut hook ───────────────────────────────────────────────

function useGodModeShortcut(): void {
  const setFlag = useFeatureFlagStore((s) => s.set);
  const current = useFeatureFlagStore((s) => s.godMode);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'G' || e.key === 'g')) {
        e.preventDefault();
        setFlag('godMode', !current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [current, setFlag]);
}

// ── Component ──────────────────────────────────────────────────

export function GodModeConsole() {
  useGodModeShortcut();
  const isOpen = useFeatureFlagStore((s) => s.godMode);
  const setFlag = useFeatureFlagStore((s) => s.set);

  // Phase 10.C — Keep Tab/Shift+Tab inside the console while open and
  // restore focus to whatever had it before we took over.
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen);

  // Subscribe to the bus regardless of open state so when the user
  // opens the console after something interesting happened, the log
  // is already filled. The console itself still returns null when
  // closed — this is just bookkeeping for the `entries` state.
  const [entries, setEntries] = useState<CommandLogEntry[]>(() =>
    commandBus.getLog(),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [rejectedOnly, setRejectedOnly] = useState(false);
  const bottomAnchor = useRef<HTMLDivElement>(null);

  // Phase 10.C — Escape closes (by flipping the godMode flag). Only
  // installed while open so we don't steal Escape from other UI.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setFlag('godMode', false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, setFlag]);

  // Phase 10.A — Logs tab state (independent of Commands tab).
  const [activeTab, setActiveTab] = useState<'commands' | 'logs'>('commands');
  const [logEntries, setLogEntries] = useState<LogEntry[]>(() => getLoggerEntries());
  const [logMinLevel, setLogMinLevel] = useState<LogLevel>('info');
  const [logSourceFilter, setLogSourceFilter] = useState('');
  const [logTextFilter, setLogTextFilter] = useState('');
  useEffect(() => subscribeLog((e) => {
    setLogEntries((prev) => {
      const next = [...prev, e];
      return next.length > 1000 ? next.slice(next.length - 1000) : next;
    });
  }), []);

  useEffect(() => {
    return commandBus.subscribe((entry) => {
      setEntries((prev) => {
        // Ring-buffer bounded: take last 500 from bus.
        const next = [...prev, entry];
        return next.length > 500 ? next.slice(next.length - 500) : next;
      });
    });
  }, []);

  const filtered = useMemo(() => {
    let list = entries;
    if (typeFilter) list = list.filter((e) => e.command.type.includes(typeFilter));
    if (rejectedOnly) list = list.filter((e) => !e.result.ok);
    // Newest first; window to VISIBLE_LIMIT
    list = list.slice().reverse().slice(0, VISIBLE_LIMIT);
    return list;
  }, [entries, typeFilter, rejectedOnly]);

  const selectedEntry = useMemo(
    () =>
      selectedId
        ? entries.find((e) => e.command.correlationId === selectedId) ?? null
        : null,
    [entries, selectedId],
  );

  if (!isOpen) return null;

  return (
    <div
      ref={trapRef}
      style={styles.panel}
      role="dialog"
      aria-modal="true"
      aria-label="God Mode Console"
    >
      <Header
        totalCount={entries.length}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        rejectedOnly={rejectedOnly}
        onRejectedToggle={() => setRejectedOnly((v) => !v)}
        onClear={() => {
          commandBus.clearLog();
          setEntries([]);
          setSelectedId(null);
        }}
        onCopy={() => {
          const blob = JSON.stringify(entries, replacer, 2);
          navigator.clipboard?.writeText(blob).catch(() => {});
        }}
      />

      {/* Phase 10.A — tab strip */}
      <div style={styles.tabStrip}>
        <button
          style={{ ...styles.tab, ...(activeTab === 'commands' ? styles.tabActive : null) }}
          onClick={() => setActiveTab('commands')}
        >
          Commands
          <span style={styles.tabCount}>{entries.length}</span>
        </button>
        <button
          style={{ ...styles.tab, ...(activeTab === 'logs' ? styles.tabActive : null) }}
          onClick={() => setActiveTab('logs')}
        >
          Logs
          <span style={styles.tabCount}>{logEntries.length}</span>
        </button>
      </div>

      <div style={styles.body}>
        {activeTab === 'commands' ? (
          <>
            <Stream entries={filtered} selectedId={selectedId} onSelect={setSelectedId} />
            <Detail entry={selectedEntry} />
          </>
        ) : (
          <LogsView
            entries={logEntries}
            minLevel={logMinLevel}
            sourceFilter={logSourceFilter}
            textFilter={logTextFilter}
            onMinLevel={setLogMinLevel}
            onSourceFilter={setLogSourceFilter}
            onTextFilter={setLogTextFilter}
            onClear={() => { clearLoggerLog(); setLogEntries([]); }}
          />
        )}
        <Controls />
      </div>

      <div ref={bottomAnchor} />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────

function Header(props: {
  totalCount: number;
  typeFilter: string;
  onTypeFilterChange: (s: string) => void;
  rejectedOnly: boolean;
  onRejectedToggle: () => void;
  onClear: () => void;
  onCopy: () => void;
}) {
  return (
    <div style={styles.header}>
      <span style={styles.title}>⚡ GOD MODE</span>
      <span style={styles.count}>{props.totalCount} logged</span>
      <input
        type="text"
        placeholder="filter: pipe.add, fixture.*…"
        value={props.typeFilter}
        onChange={(e) => props.onTypeFilterChange(e.target.value)}
        style={styles.filter}
      />
      <label style={styles.toggleLabel}>
        <input
          type="checkbox"
          checked={props.rejectedOnly}
          onChange={props.onRejectedToggle}
        />
        rejected only
      </label>
      <button style={styles.btn} onClick={props.onCopy}>Copy JSON</button>
      <button style={styles.btn} onClick={props.onClear}>Clear</button>
    </div>
  );
}

function Stream(props: {
  entries: CommandLogEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div style={styles.stream}>
      {props.entries.length === 0 && (
        <div style={styles.emptyRow}>— log empty —</div>
      )}
      {props.entries.map((entry) => {
        const id = entry.command.correlationId;
        const isSelected = id === props.selectedId;
        const isRejected = !entry.result.ok;
        return (
          <button
            key={`${id}:${entry.command.timestamp}`}
            onClick={() => props.onSelect(id)}
            style={{
              ...styles.row,
              ...(isSelected ? styles.rowSelected : null),
              ...(isRejected ? styles.rowRejected : null),
            }}
          >
            <span style={styles.rowMs}>
              {entry.applyMs < 10 ? entry.applyMs.toFixed(2) : entry.applyMs.toFixed(1)}ms
            </span>
            <span style={styles.rowType}>{entry.command.type}</span>
            <span style={styles.rowOrigin}>{entry.command.issuedBy}</span>
            {isRejected && (
              <span style={styles.rowReject}>
                {(entry.result as { reason: string }).reason.slice(0, 36)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Phase 10.A — Logs view ─────────────────────────────────────

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0, debug: 1, info: 2, warn: 3, error: 4, fatal: 5,
};
const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  trace: '#4a5668',
  debug: '#7a8592',
  info: '#a0aec0',
  warn: '#ffa726',
  error: '#ef5350',
  fatal: '#ff1744',
};

function LogsView(props: {
  entries: LogEntry[];
  minLevel: LogLevel;
  sourceFilter: string;
  textFilter: string;
  onMinLevel: (l: LogLevel) => void;
  onSourceFilter: (s: string) => void;
  onTextFilter: (s: string) => void;
  onClear: () => void;
}) {
  const minOrder = LOG_LEVEL_ORDER[props.minLevel];
  const filtered = useMemo(() => {
    let list = props.entries.filter((e) => LOG_LEVEL_ORDER[e.level] >= minOrder);
    if (props.sourceFilter) {
      const q = props.sourceFilter.toLowerCase();
      list = list.filter((e) => e.source.toLowerCase().includes(q));
    }
    if (props.textFilter) {
      const q = props.textFilter.toLowerCase();
      list = list.filter((e) => e.message.toLowerCase().includes(q));
    }
    return list.slice().reverse().slice(0, 400);
  }, [props.entries, minOrder, props.sourceFilter, props.textFilter]);

  // All sources seen so far — for the autocomplete-ish hint.
  const sources = useMemo(() => {
    const s = new Set<string>();
    for (const e of props.entries) s.add(e.source);
    return [...s].sort();
  }, [props.entries]);

  return (
    <div style={styles.logsPanel}>
      <div style={styles.logsHeader}>
        <select
          value={props.minLevel}
          onChange={(e) => props.onMinLevel(e.target.value as LogLevel)}
          style={styles.logLevelSelect}
        >
          {(['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as LogLevel[]).map((l) => (
            <option key={l} value={l}>≥ {l}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder="source…"
          value={props.sourceFilter}
          onChange={(e) => props.onSourceFilter(e.target.value)}
          list="log-sources"
          style={styles.logFilterInput}
        />
        <datalist id="log-sources">
          {sources.map((s) => <option key={s} value={s} />)}
        </datalist>
        <input
          type="text"
          placeholder="text…"
          value={props.textFilter}
          onChange={(e) => props.onTextFilter(e.target.value)}
          style={styles.logFilterInput}
        />
        <button style={styles.btn} onClick={props.onClear}>Clear</button>
      </div>
      <div style={styles.logsList}>
        {filtered.length === 0 && (
          <div style={styles.emptyRow}>— nothing matches the filter —</div>
        )}
        {filtered.map((e, i) => (
          <div
            key={`${e.timestamp}-${i}`}
            style={styles.logRow}
          >
            <span style={{ ...styles.logLevel, color: LOG_LEVEL_COLORS[e.level] }}>
              {e.level.toUpperCase()}
            </span>
            <span style={styles.logSource}>{e.source}</span>
            <span style={styles.logMessage}>{e.message}</span>
            {e.correlationId && (
              <span style={styles.logCorr} title={e.correlationId}>
                {e.correlationId.slice(0, 10)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Detail({ entry }: { entry: CommandLogEntry | null }) {
  if (!entry) {
    return (
      <div style={styles.detail}>
        <div style={styles.detailEmpty}>Select a command to inspect</div>
      </div>
    );
  }
  const correlationChain = entry.command.correlationId.split('>');
  return (
    <div style={styles.detail}>
      <section>
        <h4 style={styles.detailH}>{entry.command.type}</h4>
        <div style={styles.detailMeta}>
          {entry.command.issuedBy} · {entry.applyMs.toFixed(2)}ms ·{' '}
          {new Date(performance.timeOrigin + entry.command.timestamp).toLocaleTimeString()}
        </div>
      </section>

      <section>
        <h5 style={styles.detailH5}>Correlation chain</h5>
        <div style={styles.corrChain}>
          {correlationChain.map((id, i) => (
            <span key={id}>
              {i > 0 && <span style={styles.corrArrow}> → </span>}
              <span style={styles.corrSegment}>{id}</span>
            </span>
          ))}
        </div>
      </section>

      <section>
        <h5 style={styles.detailH5}>Payload</h5>
        <pre style={styles.codeBlock}>
          {JSON.stringify(entry.command.payload, replacer, 2)}
        </pre>
      </section>

      {!entry.result.ok && (
        <section>
          <h5 style={styles.detailH5}>Rejection reason</h5>
          <div style={styles.rejectMsg}>
            {(entry.result as { reason: string }).reason}
          </div>
        </section>
      )}

      {entry.result.ok && (entry.result as { snapshot?: unknown }).snapshot !== undefined && (
        <section>
          <h5 style={styles.detailH5}>Undo snapshot</h5>
          <pre style={styles.codeBlock}>
            {JSON.stringify((entry.result as { snapshot?: unknown }).snapshot, replacer, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}

function Controls() {
  const flags = useFeatureFlagStore();
  return (
    <div style={styles.controls}>
      <h5 style={styles.detailH5}>Feature flags</h5>
      <FlagRow
        label="commandBus"
        hint="All mutations via dispatch()"
        value={flags.commandBus}
        onChange={(v) => flags.set('commandBus', v)}
      />
      <FlagRow
        label="godMode"
        hint="This panel"
        value={flags.godMode}
        onChange={(v) => flags.set('godMode', v)}
      />
      <FlagRow
        label="sabIpc"
        hint="Zero-copy IPC via SharedArrayBuffer (Phase 3)"
        value={flags.sabIpc}
        onChange={(v) => flags.set('sabIpc', v)}
      />
      <FlagRow
        label="projectBundle"
        hint="Crash-safe .elbow bundle format (Phase 4)"
        value={flags.projectBundle}
        onChange={(v) => flags.set('projectBundle', v)}
      />
      <FlagRow
        label="complianceTrace"
        hint="Inference chain per violation — also opens via Ctrl+Shift+D (Phase 2)"
        value={flags.complianceTrace}
        onChange={(v) => flags.set('complianceTrace', v)}
      />
      <FlagRow
        label="pipeExtendDrag"
        hint="+ glyphs at pipe endpoints + drag-from-body tee insert (Phase 6/7.A)"
        value={flags.pipeExtendDrag}
        onChange={(v) => flags.set('pipeExtendDrag', v)}
      />
      <FlagRow
        label="spatialAudio"
        hint="3D positional audio — requires app restart to apply"
        value={flags.spatialAudio}
        onChange={(v) => flags.set('spatialAudio', v)}
      />
      <FlagRow
        label="perfHud"
        hint="Live FPS + worker latency HUD (Ctrl+Shift+P)"
        value={flags.perfHud}
        onChange={(v) => flags.set('perfHud', v)}
      />
      <FlagRow
        label="telemetryEnabled"
        hint="Phase 10.E — local session buckets (1-min). NO network, export-only."
        value={flags.telemetryEnabled}
        onChange={(v) => flags.set('telemetryEnabled', v)}
      />
      <FlagRow
        label="springArmCamera"
        hint="Phase 12.E — collision-aware camera boom (best for close fixture inspection)"
        value={flags.springArmCamera}
        onChange={(v) => flags.set('springArmCamera', v)}
      />
      <hr style={styles.sep} />
      <TelemetryControls />
      <hr style={styles.sep} />
      <button style={styles.btn} onClick={() => flags.reset()}>
        Reset all flags to defaults
      </button>
    </div>
  );
}

// ── Phase 10.E — Telemetry export row ─────────────────────────

function TelemetryControls() {
  const enabled = useFeatureFlagStore((s) => s.telemetryEnabled);
  const [summary, setSummary] = useState(() => describeSession());

  // Refresh the summary once per second while the panel is open so
  // bucket counts tick visibly. Cheap (one getSession call, no DOM
  // churn unless numbers changed).
  useEffect(() => {
    const id = setInterval(() => setSummary(describeSession()), 1000);
    return () => clearInterval(id);
  }, []);

  const doDownload = (data: string, filename: string, mime: string) => {
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const onExportJSON = () => {
    flushTelemetryBucket();
    doDownload(
      exportTelemetryJSON(),
      `elbow-grease-telemetry-${new Date().toISOString().replace(/:/g, '-')}.json`,
      'application/json',
    );
  };

  const onExportJSONL = () => {
    flushTelemetryBucket();
    doDownload(
      exportTelemetryJSONL(),
      `elbow-grease-telemetry-${new Date().toISOString().replace(/:/g, '-')}.jsonl`,
      'application/x-jsonlines',
    );
  };

  const onCopy = () => {
    flushTelemetryBucket();
    navigator.clipboard?.writeText(exportTelemetryJSON()).catch(() => {});
  };

  const onClear = () => {
    if (!confirm('Clear all telemetry history? This cannot be undone.')) return;
    resetTelemetry();
    setSummary(describeSession());
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <h5 style={styles.detailH5}>Telemetry</h5>
      <div style={{ fontSize: 10, color: enabled ? '#66bb6a' : '#7a8592' }}>
        {enabled ? (isTelemetryCollecting() ? '● collecting' : '○ paused') : '○ disabled'}
        {' · '}{summary}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button style={styles.btn} onClick={onExportJSON} disabled={!getTelemetrySession()}>
          Export JSON
        </button>
        <button style={styles.btn} onClick={onExportJSONL} disabled={!getTelemetrySession()}>
          Export JSONL
        </button>
        <button style={styles.btn} onClick={onCopy} disabled={!getTelemetrySession()}>
          Copy
        </button>
        <button style={styles.btn} onClick={onClear} disabled={!getTelemetrySession()}>
          Clear
        </button>
      </div>
      <div style={{ fontSize: 9, color: '#7a8592' }}>
        Exports contain performance + command counts only. No pipe geometry,
        fixture parameters, or customer data. No automatic network submission.
      </div>
    </div>
  );
}

function describeSession(): string {
  const s = getTelemetrySession();
  if (!s) return 'no session';
  return `${s.buckets.length} bucket${s.buckets.length === 1 ? '' : 's'} · ${s.sessionId.slice(0, 8)}`;
}

function FlagRow(props: {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      style={{
        ...styles.flagRow,
        opacity: props.disabled ? 0.4 : 1,
        cursor: props.disabled ? 'not-allowed' : 'pointer',
      }}
    >
      <input
        type="checkbox"
        checked={props.value}
        onChange={(e) => props.onChange(e.target.checked)}
        disabled={props.disabled}
      />
      <span style={styles.flagLabel}>{props.label}</span>
      <span style={styles.flagHint}>{props.hint}</span>
    </label>
  );
}

// ── JSON replacer (avoid serializing recursive / non-JSONable values) ──

function replacer(_key: string, value: unknown) {
  if (typeof value === 'function') return '[Function]';
  if (value instanceof Error) return { message: value.message, stack: value.stack };
  return value;
}

// ── Styles ─────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'fixed',
    left: 0, right: 0, bottom: 0,
    height: '45vh',
    minHeight: 340,
    background: 'rgba(6,10,18,0.97)',
    borderTop: '1px solid #2a3a54',
    boxShadow: '0 -10px 30px rgba(0,0,0,0.6)',
    color: '#cfd8e3',
    fontFamily: 'Consolas, "JetBrains Mono", monospace',
    fontSize: 12,
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column',
    pointerEvents: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '6px 10px',
    borderBottom: '1px solid #1a2334',
    background: 'rgba(0,0,0,0.3)',
  },
  title: { color: '#00e5ff', fontWeight: 700, letterSpacing: 2 },
  count: { color: '#7a8592', fontSize: 11 },
  filter: {
    flex: '0 0 220px',
    background: '#0a1220',
    border: '1px solid #2a3a54',
    color: '#e0e6ef',
    fontFamily: 'inherit',
    fontSize: 11,
    padding: '4px 6px',
    borderRadius: 3,
  },
  toggleLabel: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#aebbc9' },
  btn: {
    background: '#1a2334',
    border: '1px solid #2a3a54',
    color: '#e0e6ef',
    padding: '4px 10px',
    fontSize: 11,
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  body: { display: 'grid', gridTemplateColumns: '1fr 1.3fr 260px', flex: 1, minHeight: 0 },
  // Phase 10.A — tab strip + logs styles
  tabStrip: {
    display: 'flex',
    gap: 2,
    padding: '4px 10px 0',
    borderBottom: '1px solid #1a2334',
    background: 'rgba(0,0,0,0.2)',
  },
  tab: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '5px 12px',
    background: 'transparent',
    border: '1px solid transparent',
    borderBottom: 'none',
    borderRadius: '3px 3px 0 0',
    color: '#7a8592',
    fontFamily: 'inherit',
    fontSize: 11,
    cursor: 'pointer',
  },
  tabActive: {
    color: '#00e5ff',
    background: 'rgba(6,10,18,0.97)',
    borderColor: '#2a3a54',
  },
  tabCount: {
    background: 'rgba(0,229,255,0.1)',
    color: '#00e5ff',
    fontSize: 9,
    padding: '1px 5px',
    borderRadius: 8,
  },
  logsPanel: {
    display: 'flex',
    flexDirection: 'column',
    borderRight: '1px solid #1a2334',
    overflow: 'hidden',
    gridColumn: '1 / span 2', // spans Stream+Detail columns
  },
  logsHeader: {
    display: 'flex',
    gap: 6,
    padding: '6px 10px',
    borderBottom: '1px solid #1a2334',
    alignItems: 'center',
  },
  logLevelSelect: {
    background: '#0a1220',
    border: '1px solid #2a3a54',
    color: '#e0e6ef',
    fontFamily: 'inherit',
    fontSize: 11,
    padding: '3px 6px',
    borderRadius: 3,
  },
  logFilterInput: {
    flex: '1 1 0',
    minWidth: 80,
    background: '#0a1220',
    border: '1px solid #2a3a54',
    color: '#e0e6ef',
    fontFamily: 'inherit',
    fontSize: 11,
    padding: '3px 6px',
    borderRadius: 3,
  },
  logsList: {
    flex: 1,
    overflowY: 'auto',
    padding: 0,
  },
  logRow: {
    display: 'grid',
    gridTemplateColumns: '55px 120px 1fr 80px',
    gap: 8,
    padding: '3px 10px',
    borderBottom: '1px solid #0f1624',
    fontSize: 11,
    alignItems: 'baseline',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  logLevel: {
    fontWeight: 700,
    fontSize: 9,
    letterSpacing: 0.5,
  },
  logSource: {
    color: '#66bb6a',
    fontSize: 10,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  logMessage: {
    color: '#e0e6ef',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  logCorr: {
    color: '#7a8592',
    fontSize: 9,
    textAlign: 'right' as const,
  },
  stream: {
    overflowY: 'auto',
    borderRight: '1px solid #1a2334',
    display: 'flex',
    flexDirection: 'column',
  },
  emptyRow: { padding: 20, color: '#555', textAlign: 'center' as const },
  row: {
    display: 'grid',
    gridTemplateColumns: '48px 1fr 60px',
    gap: 8,
    padding: '4px 8px',
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid #0f1624',
    color: '#cfd8e3',
    fontFamily: 'inherit',
    fontSize: 11,
    cursor: 'pointer',
    textAlign: 'left',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    alignItems: 'center' as const,
  },
  rowSelected: { background: 'rgba(0,229,255,0.08)', borderLeft: '2px solid #00e5ff' },
  rowRejected: { color: '#ff8a80' },
  rowMs: { color: '#7a8592', fontVariantNumeric: 'tabular-nums' as const },
  rowType: { color: '#e0e6ef' },
  rowOrigin: { color: '#66bb6a', fontSize: 10 },
  rowReject: {
    gridColumn: '2 / 4',
    color: '#ff8a80',
    fontSize: 10,
    fontStyle: 'italic' as const,
  },
  detail: {
    overflowY: 'auto',
    padding: 12,
    borderRight: '1px solid #1a2334',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  detailEmpty: { color: '#555', padding: 20, textAlign: 'center' as const },
  detailH: { color: '#00e5ff', margin: 0, fontSize: 13, fontWeight: 700 },
  detailH5: { color: '#7a8592', fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: 1.5, margin: '4px 0' },
  detailMeta: { color: '#7a8592', fontSize: 10, marginTop: 2 },
  corrChain: { fontSize: 10, lineHeight: 1.6, color: '#aebbc9' },
  corrArrow: { color: '#4a5668' },
  corrSegment: { background: 'rgba(0,229,255,0.06)', padding: '1px 4px', borderRadius: 2 },
  codeBlock: {
    background: '#0a1220',
    border: '1px solid #1a2334',
    borderRadius: 3,
    padding: 8,
    fontSize: 10,
    lineHeight: 1.4,
    overflowX: 'auto',
    color: '#a8dadc',
    margin: 0,
  },
  rejectMsg: { color: '#ff8a80', padding: '6px 8px', background: 'rgba(255,0,0,0.06)', borderRadius: 3, fontSize: 11 },
  controls: { overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 4 },
  flagRow: { display: 'flex', alignItems: 'center', gap: 8, padding: '4px 2px', fontSize: 11 },
  flagLabel: { color: '#e0e6ef', minWidth: 96 },
  flagHint: { color: '#7a8592', fontSize: 10 },
  sep: { border: 'none', borderTop: '1px solid #1a2334', margin: '8px 0' },
};
