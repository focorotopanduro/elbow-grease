/**
 * NeuroStatusOrb — live neuro-adaptive status indicator.
 *
 * A small animated orb in the top-right corner that pulses at a rate
 * reflecting the user's cognitive/engagement state. It's the visible
 * surface of the neuro tracking layer:
 *
 *   Color    → engagement zone (flow=green, focused=cyan, exploring=yellow, disengaged=grey)
 *   Pulse    → cognitive load (calm pulse=low, fast pulse=high, strained=red strobe)
 *   Size     → fatigue (grows with session duration, drops after breaks)
 *
 * Clicking the orb opens a detailed popover with metrics:
 *   - Session time
 *   - Engagement zone transitions
 *   - Cognitive load trajectory
 *   - Break recommendation timer
 *
 * Subscribes to the EventBus events emitted by the neuro systems
 * (EngagementMetrics, CognitiveLoadMonitor, VisualFatigueGuard).
 */

import { useState, useEffect } from 'react';
import { useEvent, useEventState } from '@hooks/useEventBus';
import { ENGAGE_EV, type EngagementState, type EngagementZone } from '@core/neuro/EngagementMetrics';
import { LOAD_EV, type LoadState, type LoadLevel } from '@core/spatial/CognitiveLoadMonitor';
import { FATIGUE_EV, type FatigueState, type FatigueLevel } from '@core/neuro/VisualFatigueGuard';

// ── Zone → visual mapping ───────────────────────────────────────

const ZONE_COLORS: Record<EngagementZone, string> = {
  flow:       '#66bb6a',
  focused:    '#00e5ff',
  exploring:  '#ffc107',
  disengaged: '#666',
};

const ZONE_LABELS: Record<EngagementZone, string> = {
  flow:       'Flow',
  focused:    'Focused',
  exploring:  'Exploring',
  disengaged: 'Idle',
};

const LOAD_COLORS: Record<LoadLevel, string> = {
  low:        '#66bb6a',
  moderate:   '#ffc107',
  high:       '#ff7043',
  overloaded: '#ff1744',
};

const FATIGUE_COLORS: Record<FatigueLevel, string> = {
  fresh:    '#66bb6a',
  normal:   '#00e5ff',
  tired:    '#ffc107',
  strained: '#ff1744',
};

// ── Component ───────────────────────────────────────────────────

export function NeuroStatusOrb() {
  const [expanded, setExpanded] = useState(false);
  const engagement = useEventState<EngagementState | null>(ENGAGE_EV.METRICS_UPDATED, null);
  const load = useEventState<LoadState | null>(LOAD_EV.LOAD_UPDATED, null);
  const fatigue = useEventState<FatigueState | null>(FATIGUE_EV.FATIGUE_UPDATED, null);

  // Pulse rate based on cognitive load
  const pulseRateSec = load
    ? load.level === 'low'       ? 3.0
    : load.level === 'moderate'  ? 1.8
    : load.level === 'high'      ? 1.0
    : 0.5
    : 3.0;

  // Orb color reflects engagement zone
  const zoneColor = engagement ? ZONE_COLORS[engagement.zone] : '#555';
  const zoneLabel = engagement ? ZONE_LABELS[engagement.zone] : '—';

  // Orb size scales with session duration (max +30% after 2h)
  const sessionH = fatigue ? fatigue.sessionMinutes / 60 : 0;
  const sizeScale = 1 + Math.min(0.3, sessionH * 0.15);

  return (
    <>
      <button
        style={{
          ...styles.orb,
          transform: `scale(${sizeScale})`,
          borderColor: zoneColor,
          boxShadow: `0 0 ${12 * sizeScale}px ${zoneColor}60`,
        }}
        onClick={() => setExpanded(!expanded)}
        title={`${zoneLabel} · ${load?.level ?? 'unknown'}`}
      >
        <div
          style={{
            ...styles.orbInner,
            background: `radial-gradient(circle, ${zoneColor} 0%, ${zoneColor}80 60%, transparent 100%)`,
            animation: `elbow-neuro-pulse ${pulseRateSec}s ease-in-out infinite`,
          }}
        />
      </button>

      {expanded && (
        <div style={styles.popover}>
          <div style={styles.popHeader}>
            <span>NEURO STATUS</span>
            <button onClick={() => setExpanded(false)} style={styles.closeBtn}>×</button>
          </div>

          {/* Engagement */}
          <Section title="Engagement">
            <Row label="Zone" value={zoneLabel} color={zoneColor} />
            {engagement && (
              <>
                <Row label="Beta (focus)" value={`${(engagement.betaProxy * 100).toFixed(0)}%`} color="#00e5ff" />
                <Row label="Theta (explore)" value={`${(engagement.thetaProxy * 100).toFixed(0)}%`} color="#ffc107" />
                <Row label="Composite" value={`${(engagement.engagement * 100).toFixed(0)}%`} color={zoneColor} />
                <Row label="Zone time" value={`${Math.round(engagement.zoneDuration)}s`} color="#888" />
              </>
            )}
          </Section>

          {/* Cognitive Load */}
          <Section title="Cognitive Load">
            {load ? (
              <>
                <Row label="Level" value={load.level} color={LOAD_COLORS[load.level]} />
                <Row label="Score" value={`${(load.score * 100).toFixed(0)}%`} color={LOAD_COLORS[load.level]} />
                <Row label="Actions/min" value={`${load.actionsPerMinute}`} color="#888" />
                <Row label="Cancel rate" value={`${(load.cancelRate * 100).toFixed(0)}%`} color={load.cancelRate > 0.3 ? '#ff7043' : '#888'} />
                <Row label="Idle" value={`${load.idleSeconds.toFixed(0)}s`} color="#888" />
              </>
            ) : <div style={styles.empty}>gathering…</div>}
          </Section>

          {/* Fatigue */}
          <Section title="Fatigue Guard">
            {fatigue ? (
              <>
                <Row label="Level" value={fatigue.level} color={FATIGUE_COLORS[fatigue.level]} />
                <Row label="Session" value={`${fatigue.sessionMinutes.toFixed(0)} min`} color="#888" />
                <Row label="Since break" value={`${fatigue.minutesSinceBreak.toFixed(0)} min`} color={fatigue.breakPending ? '#ffc107' : '#888'} />
                <Row label="Flow total" value={`${fatigue.flowMinutes.toFixed(0)} min`} color="#66bb6a" />
                <Row label="Render cap" value={`${(fatigue.intensityCap * 100).toFixed(0)}%`} color={fatigue.intensityCap < 0.8 ? '#ffc107' : '#66bb6a'} />
                {fatigue.breakPending && (
                  <div style={styles.breakNotice}>☕ Take a break!</div>
                )}
              </>
            ) : <div style={styles.empty}>gathering…</div>}
          </Section>
        </div>
      )}

      <style>{`
        @keyframes elbow-neuro-pulse {
          0%, 100% { transform: scale(1);   opacity: 0.85; }
          50%      { transform: scale(1.2); opacity: 0.6; }
        }
      `}</style>
    </>
  );
}

// ── Subcomponents ───────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <div style={styles.sectionTitle}>{title}</div>
      <div style={styles.sectionBody}>{children}</div>
    </div>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={styles.row}>
      <span style={styles.rowLabel}>{label}</span>
      <span style={{ ...styles.rowValue, color }}>{value}</span>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  orb: {
    position: 'absolute',
    top: 16,
    right: 170, // clears VRToggleButton
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: '2px solid',
    background: 'rgba(10,10,15,0.85)',
    cursor: 'pointer',
    pointerEvents: 'auto',
    padding: 0,
    zIndex: 25,
    transition: 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.3s',
  },
  orbInner: {
    width: '100%',
    height: '100%',
    borderRadius: '50%',
  },
  popover: {
    position: 'absolute',
    top: 56,
    right: 16,
    width: 250,
    padding: 12,
    borderRadius: 10,
    border: '1px solid #333',
    background: 'rgba(10,10,15,0.95)',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    pointerEvents: 'auto',
    zIndex: 50,
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
  },
  popHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 10,
    fontWeight: 800,
    color: '#eee',
    letterSpacing: 2,
    marginBottom: 8,
    paddingBottom: 6,
    borderBottom: '1px solid #222',
  },
  closeBtn: {
    fontSize: 14,
    color: '#666',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    lineHeight: 1,
  },
  section: {
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 700,
    color: '#555',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  sectionBody: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  row: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    fontSize: 10,
    color: '#888',
  },
  rowValue: {
    fontSize: 10,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    textTransform: 'capitalize',
  },
  empty: {
    fontSize: 10,
    color: '#555',
    fontStyle: 'italic',
  },
  breakNotice: {
    marginTop: 6,
    padding: 6,
    fontSize: 10,
    color: '#ffc107',
    textAlign: 'center',
    border: '1px solid #ffc107',
    borderRadius: 4,
    background: 'rgba(255,193,7,0.08)',
  },
};
