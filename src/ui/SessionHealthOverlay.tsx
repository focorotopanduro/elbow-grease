/**
 * Session Health Overlay — compact HUD showing engagement zone,
 * fatigue level, session health score, and break reminders.
 *
 * Positioned bottom-left to stay out of the primary work area.
 * Expands on hover to show full metrics, collapses to a small
 * indicator during active work.
 */

import { useState, useEffect } from 'react';
import { useEvent, useEventState } from '@hooks/useEventBus';
import {
  ENGAGE_EV,
  type EngagementZone,
  type EngagementState,
} from '@core/neuro/EngagementMetrics';
import { FATIGUE_EV, type FatigueState, type FatigueLevel } from '@core/neuro/VisualFatigueGuard';
import { HEALTH_EV, type SessionHealth, type PerformanceTrend } from '@core/neuro/SessionHealthMonitor';

// ── Colors ──────────────────────────────────────────────────────

const ZONE_COLORS: Record<EngagementZone, string> = {
  flow:       '#00e676',
  focused:    '#00e5ff',
  exploring:  '#ffc107',
  disengaged: '#777',
};

const ZONE_LABELS: Record<EngagementZone, string> = {
  flow:       'FLOW',
  focused:    'FOCUSED',
  exploring:  'EXPLORING',
  disengaged: 'IDLE',
};

const FATIGUE_COLORS: Record<FatigueLevel, string> = {
  fresh:    '#00e676',
  normal:   '#00e5ff',
  tired:    '#ffc107',
  strained: '#ff1744',
};

const TREND_ICONS: Record<PerformanceTrend, string> = {
  improving: '↑',
  stable:    '→',
  declining: '↓',
};

// ── Break reminder banner ───────────────────────────────────────

function BreakReminder({ onDismiss }: { onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);

  useEvent(FATIGUE_EV.BREAK_SUGGESTED, () => setVisible(true));

  if (!visible) return null;

  return (
    <div style={styles.breakBanner}>
      <span>Time for a short break — your eyes will thank you</span>
      <button
        style={styles.breakButton}
        onClick={() => {
          setVisible(false);
          onDismiss();
        }}
      >
        OK
      </button>
    </div>
  );
}

// ── Main overlay ────────────────────────────────────────────────

interface SessionHealthOverlayProps {
  onBreakTaken: () => void;
}

export function SessionHealthOverlay({ onBreakTaken }: SessionHealthOverlayProps) {
  const [expanded, setExpanded] = useState(false);

  const engage = useEventState<EngagementState | null>(ENGAGE_EV.METRICS_UPDATED, null);
  const fatigue = useEventState<FatigueState | null>(FATIGUE_EV.FATIGUE_UPDATED, null);
  const health = useEventState<SessionHealth | null>(HEALTH_EV.HEALTH_UPDATED, null);

  if (!engage || !fatigue || !health) return null;

  const zone = engage.zone;
  const zoneColor = ZONE_COLORS[zone];

  return (
    <>
      <BreakReminder onDismiss={onBreakTaken} />

      <div
        style={styles.container}
        onMouseEnter={() => setExpanded(true)}
        onMouseLeave={() => setExpanded(false)}
      >
        {/* Collapsed: just the health score dot */}
        <div style={styles.compact}>
          <div style={{ ...styles.zoneDot, backgroundColor: zoneColor }} />
          <span style={{ ...styles.zoneLabel, color: zoneColor }}>
            {ZONE_LABELS[zone]}
          </span>
          <span style={styles.healthScore}>{health.healthScore}</span>
        </div>

        {/* Expanded: full metrics */}
        {expanded && (
          <div style={styles.details}>
            {/* Engagement */}
            <div style={styles.row}>
              <span style={styles.label}>Engagement</span>
              <div style={styles.barTrack}>
                <div style={{
                  ...styles.barFill,
                  width: `${engage.engagement * 100}%`,
                  backgroundColor: zoneColor,
                }} />
              </div>
              <span style={styles.value}>{(engage.engagement * 100).toFixed(0)}%</span>
            </div>

            {/* Beta (Focus) */}
            <div style={styles.row}>
              <span style={styles.label}>Focus</span>
              <div style={styles.barTrack}>
                <div style={{
                  ...styles.barFill,
                  width: `${engage.betaProxy * 100}%`,
                  backgroundColor: '#00e5ff',
                }} />
              </div>
              <span style={styles.value}>{(engage.betaProxy * 100).toFixed(0)}%</span>
            </div>

            {/* Theta (Creativity) */}
            <div style={styles.row}>
              <span style={styles.label}>Creativity</span>
              <div style={styles.barTrack}>
                <div style={{
                  ...styles.barFill,
                  width: `${engage.thetaProxy * 100}%`,
                  backgroundColor: '#ffc107',
                }} />
              </div>
              <span style={styles.value}>{(engage.thetaProxy * 100).toFixed(0)}%</span>
            </div>

            {/* Fatigue */}
            <div style={styles.row}>
              <span style={styles.label}>Fatigue</span>
              <div style={styles.barTrack}>
                <div style={{
                  ...styles.barFill,
                  width: `${fatigue.score * 100}%`,
                  backgroundColor: FATIGUE_COLORS[fatigue.level],
                }} />
              </div>
              <span style={styles.value}>{fatigue.level}</span>
            </div>

            {/* Accuracy */}
            <div style={styles.row}>
              <span style={styles.label}>Accuracy</span>
              <span style={styles.value}>
                {(health.accuracy * 100).toFixed(0)}%
                {' '}{TREND_ICONS[health.trend]}
              </span>
            </div>

            {/* Session time */}
            <div style={styles.row}>
              <span style={styles.label}>Session</span>
              <span style={styles.value}>
                {Math.round(health.totalMinutes)}m
                {health.breaksTaken > 0 && ` (${health.breaksTaken} breaks)`}
              </span>
            </div>

            {/* Routes */}
            <div style={styles.row}>
              <span style={styles.label}>Routes</span>
              <span style={styles.value}>
                {health.routesCompleted} done / {health.routesCanceled} canceled
              </span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    bottom: 16,
    left: 16,
    pointerEvents: 'auto',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    zIndex: 20,
    cursor: 'default',
  },
  compact: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 12px',
    borderRadius: 6,
    border: '1px solid #333',
    background: 'rgba(10,10,15,0.85)',
  },
  zoneDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  zoneLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 1.5,
  },
  healthScore: {
    fontSize: 14,
    fontWeight: 700,
    color: '#eee',
    marginLeft: 8,
  },
  details: {
    marginTop: 6,
    padding: 10,
    borderRadius: 8,
    border: '1px solid #333',
    background: 'rgba(10,10,15,0.92)',
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    minWidth: 220,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    width: 65,
    fontSize: 10,
    color: '#888',
  },
  barTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#222',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.5s',
  },
  value: {
    width: 55,
    fontSize: 10,
    color: '#ccc',
    textAlign: 'right' as const,
  },
  breakBanner: {
    position: 'absolute',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    padding: '16px 28px',
    borderRadius: 12,
    border: '1px solid #ffc107',
    background: 'rgba(10,10,15,0.95)',
    color: '#ffc107',
    fontSize: 15,
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    zIndex: 50,
    pointerEvents: 'auto',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  breakButton: {
    padding: '6px 16px',
    borderRadius: 6,
    border: '1px solid #ffc107',
    background: 'transparent',
    color: '#ffc107',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  },
};
