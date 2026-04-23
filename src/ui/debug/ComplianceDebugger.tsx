/**
 * ComplianceDebugger — inference-chain panel for compliance violations.
 *
 * Structure (from top to bottom):
 *
 *   ┌─────────────────────────────────────────────────────────┐
 *   │ ⚠ COMPLIANCE TRACE                            [×] close │
 *   │ complianceTrace flag · N violations · Xms last solve    │
 *   ├─────────────────────────────────────────────────────────┤
 *   │ Entity list (left, ~160px)  │  Trace tree (right)       │
 *   │ ─────────                   │  ─────────────            │
 *   │ ⨯ IPC 704.1 · edge-p1-0     │  IPC 704.1                │
 *   │ ⚠ IPC 604.5 · edge-p2-0     │  Slope below 0.25"/ft min │
 *   │                             │                           │
 *   │                             │  ▸ Applied conditions (1) │
 *   │                             │  ▸ Failed constraint      │
 *   │                             │  ▸ Source triples (8)     │
 *   │                             │  ▸ Variable values (2)    │
 *   │                             │  ▸ IPC 704.1 → link       │
 *   │                             │  [Copy JSON]              │
 *   └─────────────────────────────────────────────────────────┘
 *
 * Keyboard:
 *   Ctrl+Shift+D  toggle panel AND complianceTrace flag (synchronized)
 *   Esc           close
 *
 * Performance:
 *   - Subscribes to usePlumbingComplianceStore only. No per-frame ticks.
 *   - Tree rendering uses native <details>/<summary> — no JS animation.
 *   - When the trace flag is off, the store is empty and the panel
 *     shows a helpful "flag is off" message. Rendered DOM is ~100 nodes.
 */

import { useEffect, useState } from 'react';
import { useFeatureFlagStore } from '@store/featureFlagStore';
import { usePlumbingComplianceStore, type TracedViolation } from '@store/plumbingComplianceStore';
import type { Triple } from '../../engine/compliance/KnowledgeGraph';
import { useFocusTrap } from '@core/a11y/useFocusTrap';

// ── Shortcut hook ───────────────────────────────────────────────

function useComplianceShortcut() {
  const setFlag = useFeatureFlagStore((s) => s.set);
  const debugPanelOpen = useFeatureFlagStore((s) => s.complianceTrace);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
        // Only fire when not focused in an input
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        // Toggling the flag also toggles the panel (same flag controls both).
        setFlag('complianceTrace', !debugPanelOpen);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [debugPanelOpen, setFlag]);
}

// ── Main component ─────────────────────────────────────────────

export function ComplianceDebugger() {
  useComplianceShortcut();
  const isOpen = useFeatureFlagStore((s) => s.complianceTrace);
  const setFlag = useFeatureFlagStore((s) => s.set);

  // Phase 10.C — Tab/Shift+Tab contained; focus restores to prior
  // element on close. See @core/a11y/useFocusTrap.
  const trapRef = useFocusTrap<HTMLDivElement>(isOpen);

  const all = usePlumbingComplianceStore((s) => s.all);
  const lastSolvedAt = usePlumbingComplianceStore((s) => s.lastSolvedAt);

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const selected = selectedIdx !== null ? all[selectedIdx] ?? null : null;

  // Auto-select first violation when the list changes
  useEffect(() => {
    if (all.length > 0 && (selectedIdx === null || selectedIdx >= all.length)) {
      setSelectedIdx(0);
    } else if (all.length === 0) {
      setSelectedIdx(null);
    }
  }, [all, selectedIdx]);

  // Phase 10.C — Escape closes the panel. Only attached while open
  // so other components can own Escape when we're hidden.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setFlag('complianceTrace', false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, setFlag]);

  if (!isOpen) return null;

  return (
    <div
      ref={trapRef}
      style={styles.panel}
      role="dialog"
      aria-modal="true"
      aria-label="Compliance Trace Debugger"
    >
      <div style={styles.header}>
        <span style={styles.title}>⚠ COMPLIANCE TRACE</span>
        <span style={styles.meta}>
          {all.length === 0 ? 'no violations' : `${all.length} violation${all.length > 1 ? 's' : ''}`}
          {lastSolvedAt > 0 && ` · solved ${formatAgeSec(lastSolvedAt)}`}
        </span>
        <button
          style={styles.closeBtn}
          aria-label="Close compliance trace debugger"
          onClick={() => setFlag('complianceTrace', false)}
        >
          ×
        </button>
      </div>

      <div style={styles.body}>
        <EntityList
          violations={all}
          selectedIdx={selectedIdx}
          onSelect={setSelectedIdx}
        />
        <TraceTree violation={selected} />
      </div>
    </div>
  );
}

// ── Entity list ────────────────────────────────────────────────

function EntityList(props: {
  violations: TracedViolation[];
  selectedIdx: number | null;
  onSelect: (idx: number) => void;
}) {
  if (props.violations.length === 0) {
    return (
      <div style={styles.emptyList}>
        <div style={{ color: '#66bb6a' }}>✓ No violations traced.</div>
        <div style={{ marginTop: 8, color: '#7a8592', fontSize: 10 }}>
          If you expect some, draw a pipe to trigger a solve. Tracing is
          enabled automatically while this panel is open.
        </div>
      </div>
    );
  }
  return (
    <div style={styles.list}>
      {props.violations.map((v, i) => (
        <button
          key={`${v.entityId}::${v.ruleId}`}
          onClick={() => props.onSelect(i)}
          style={{
            ...styles.listRow,
            ...(i === props.selectedIdx ? styles.listRowSelected : null),
          }}
        >
          <span style={styles.listGlyph}>{severityGlyph(v.severity)}</span>
          <span style={styles.listCode}>IPC {v.codeRefSection}</span>
          <span style={styles.listEntity}>{v.entityId}</span>
        </button>
      ))}
    </div>
  );
}

// ── Trace tree ─────────────────────────────────────────────────

function TraceTree({ violation }: { violation: TracedViolation | null }) {
  if (!violation) {
    return (
      <div style={styles.treeEmpty}>Select a violation to inspect its trace.</div>
    );
  }
  const trace = violation.trace;
  return (
    <div style={styles.tree}>
      <div style={styles.treeHeader}>
        <div style={styles.ruleCode}>
          IPC {violation.codeRefSection}
        </div>
        <div style={styles.ruleMsg}>{violation.message}</div>
        <div style={styles.ruleMeta}>
          {violation.severity.toUpperCase()} · cost {violation.cost.toFixed(2)} ·{' '}
          entity <code>{violation.entityId}</code> ({violation.entityType})
        </div>
      </div>

      <details style={styles.section} open>
        <summary style={styles.sectionSummary}>
          Failed constraint · {trace.failedConstraint.id}
        </summary>
        <dl style={styles.dl}>
          <Row k="name" v={trace.failedConstraint.name} />
          <Row k="message" v={trace.failedConstraint.message} />
          <Row k="weight" v={String(trace.failedConstraint.weight)} />
          <Row k="hard" v={trace.failedConstraint.hard ? 'yes (must-satisfy)' : 'no (preference)'} />
          <Row
            k="cost"
            v={`${trace.failedConstraint.cost.toFixed(3)} (raw ${trace.failedConstraint.rawCost.toFixed(3)} × weight ${trace.failedConstraint.weight})`}
          />
          <Row k="phase" v={trace.phase} />
        </dl>
      </details>

      <details style={styles.section}>
        <summary style={styles.sectionSummary}>
          Applied conditions ({trace.appliedConditions.length})
        </summary>
        <ul style={styles.conditionList}>
          {trace.appliedConditions.map((c, i) => (
            <li key={i} style={styles.conditionRow}>
              <span style={{ color: c.matched ? '#66bb6a' : '#7a8592' }}>
                {c.matched ? '✓' : '—'}
              </span>{' '}
              <strong>{c.ruleName}</strong>
              <span style={styles.conditionBound}>
                {' '}bound to {c.boundEntities.join(', ')}
              </span>
            </li>
          ))}
        </ul>
      </details>

      <details style={styles.section}>
        <summary style={styles.sectionSummary}>
          Source triples ({trace.sourceTriples.length})
        </summary>
        <TripleTable triples={trace.sourceTriples} />
      </details>

      <details style={styles.section}>
        <summary style={styles.sectionSummary}>
          Variable values ({Object.keys(trace.variableValues).length})
        </summary>
        <dl style={styles.dl}>
          {Object.entries(trace.variableValues).map(([k, v]) => (
            <Row key={k} k={k} v={String(v)} />
          ))}
        </dl>
      </details>

      <div style={styles.footer}>
        {trace.sourceCode.url && (
          <a
            href={trace.sourceCode.url}
            target="_blank"
            rel="noreferrer"
            style={styles.extLink}
            onClick={(e) => {
              // In Tauri, navigate externally via the shell plugin to
              // avoid opening in-webview.
              e.preventDefault();
              openExternal(trace.sourceCode.url!);
            }}
          >
            View IPC {trace.sourceCode.section} ↗
          </a>
        )}
        <button
          style={styles.copyBtn}
          onClick={() => {
            const blob = JSON.stringify(violation, null, 2);
            navigator.clipboard?.writeText(blob).catch(() => {});
          }}
        >
          Copy JSON
        </button>
      </div>
    </div>
  );
}

function TripleTable({ triples }: { triples: Triple[] }) {
  if (triples.length === 0) {
    return <div style={styles.tripleEmpty}>no related triples</div>;
  }
  return (
    <div style={styles.tripleTable}>
      {triples.map((t, i) => (
        <div key={i} style={styles.tripleRow}>
          <code style={styles.subj}>{t.subject}</code>
          <code style={styles.pred}>{t.predicate}</code>
          <code style={styles.obj}>{String(t.object)}</code>
        </div>
      ))}
    </div>
  );
}

// ── Shared helpers ─────────────────────────────────────────────

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt style={styles.dt}>{k}</dt>
      <dd style={styles.dd}>{v}</dd>
    </>
  );
}

function severityGlyph(s: TracedViolation['severity']): string {
  switch (s) {
    case 'error':   return '⨯';
    case 'warning': return '⚠';
    default:        return 'ⓘ';
  }
}

function formatAgeSec(ts: number): string {
  const ageSec = (performance.now() - ts) / 1000;
  if (ageSec < 60) return `${ageSec.toFixed(0)}s ago`;
  if (ageSec < 3600) return `${(ageSec / 60).toFixed(0)}m ago`;
  return `${(ageSec / 3600).toFixed(1)}h ago`;
}

/**
 * Open an external URL in the system browser (Tauri shell plugin if
 * available, otherwise window.open). The plugin handle is cached after
 * first successful dynamic import so subsequent clicks are instant.
 */
let shellOpenCached: ((url: string) => Promise<void>) | null = null;
async function openExternal(url: string): Promise<void> {
  try {
    if (!shellOpenCached) {
      const mod = await import('@tauri-apps/plugin-shell').catch(() => null);
      if (mod?.open) shellOpenCached = mod.open;
    }
    if (shellOpenCached) {
      await shellOpenCached(url);
      return;
    }
  } catch {
    /* fall through */
  }
  window.open(url, '_blank');
}

// ── Styles ─────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'fixed',
    right: 16,
    top: 112,
    width: 460,
    maxHeight: 'calc(100vh - 140px)',
    background: 'rgba(8,12,20,0.96)',
    border: '1px solid #2a3a54',
    borderRadius: 8,
    boxShadow: '0 14px 40px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,193,7,0.08)',
    color: '#cfd8e3',
    fontFamily: 'Consolas, "JetBrains Mono", monospace',
    fontSize: 12,
    zIndex: 600,
    display: 'flex',
    flexDirection: 'column',
    pointerEvents: 'auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 12px',
    borderBottom: '1px solid #1a2334',
    background: 'rgba(0,0,0,0.3)',
  },
  title: { color: '#ffc107', fontWeight: 700, letterSpacing: 1.5 },
  meta: { color: '#7a8592', fontSize: 10, flex: 1 },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#7a8592',
    fontSize: 18,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0 4px',
  },
  body: {
    display: 'grid',
    gridTemplateColumns: '180px 1fr',
    flex: 1,
    minHeight: 0,
  },
  list: { overflowY: 'auto', borderRight: '1px solid #1a2334' },
  emptyList: {
    padding: 16,
    fontSize: 11,
    textAlign: 'center' as const,
    borderRight: '1px solid #1a2334',
  },
  listRow: {
    display: 'grid',
    gridTemplateColumns: '20px 70px 1fr',
    gap: 4,
    padding: '6px 8px',
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
  listRowSelected: {
    background: 'rgba(255,193,7,0.10)',
    borderLeft: '2px solid #ffc107',
  },
  listGlyph: { fontWeight: 700 },
  listCode: { color: '#ffc107', fontSize: 10 },
  listEntity: { color: '#aebbc9', fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis' },
  tree: { overflowY: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 },
  treeEmpty: { padding: 20, color: '#555', textAlign: 'center' as const },
  treeHeader: { borderBottom: '1px solid #1a2334', paddingBottom: 8 },
  ruleCode: { color: '#ffc107', fontWeight: 700, fontSize: 13 },
  ruleMsg: { color: '#e0e6ef', fontSize: 12, marginTop: 2 },
  ruleMeta: { color: '#7a8592', fontSize: 10, marginTop: 4 },
  section: {
    border: '1px solid #1a2334',
    borderRadius: 4,
    padding: 0,
    background: 'rgba(255,255,255,0.01)',
  },
  sectionSummary: {
    padding: '6px 10px',
    cursor: 'pointer',
    color: '#aebbc9',
    fontSize: 11,
    userSelect: 'none' as const,
  },
  dl: {
    margin: 0,
    padding: '4px 10px 8px',
    display: 'grid',
    gridTemplateColumns: 'minmax(100px, auto) 1fr',
    gap: '2px 8px',
    fontSize: 11,
  },
  dt: { color: '#7a8592' },
  dd: { color: '#e0e6ef', margin: 0, wordBreak: 'break-word' as const },
  conditionList: { margin: 0, padding: '0 10px 8px 24px', listStyle: 'none' },
  conditionRow: { fontSize: 11, padding: '2px 0', color: '#cfd8e3' },
  conditionBound: { color: '#7a8592', fontSize: 10 },
  tripleTable: { padding: '4px 10px 8px', display: 'flex', flexDirection: 'column', gap: 3 },
  tripleRow: {
    display: 'grid',
    gridTemplateColumns: '1.1fr 1fr 1fr',
    gap: 6,
    fontSize: 10,
    padding: '2px 0',
    borderBottom: '1px dashed #1a2334',
  },
  subj: { color: '#a8dadc', background: 'rgba(168,218,220,0.06)', padding: '1px 4px', borderRadius: 2 },
  pred: { color: '#ffc107', background: 'rgba(255,193,7,0.06)', padding: '1px 4px', borderRadius: 2 },
  obj: { color: '#66bb6a', background: 'rgba(102,187,106,0.06)', padding: '1px 4px', borderRadius: 2 },
  tripleEmpty: { color: '#555', padding: '4px 10px 8px', fontSize: 10, fontStyle: 'italic' as const },
  footer: {
    display: 'flex',
    gap: 8,
    paddingTop: 8,
    borderTop: '1px solid #1a2334',
    marginTop: 4,
  },
  extLink: {
    flex: 1,
    padding: '6px 10px',
    background: 'rgba(0,229,255,0.08)',
    border: '1px solid #00e5ff',
    borderRadius: 4,
    color: '#00e5ff',
    textDecoration: 'none',
    fontSize: 11,
    textAlign: 'center' as const,
    cursor: 'pointer',
  },
  copyBtn: {
    padding: '6px 10px',
    background: '#1a2334',
    border: '1px solid #2a3a54',
    color: '#e0e6ef',
    fontSize: 11,
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};
