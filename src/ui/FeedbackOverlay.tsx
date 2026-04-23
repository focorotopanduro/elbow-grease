/**
 * FeedbackOverlay — 2D HUD layer rendered on top of the 3D canvas.
 *
 * Displays contextual text prompts driven by the FSM state and
 * CueRoutineReward system. Fades messages in/out so they never
 * feel like static error dialogs — always fluid, always responsive.
 */

import { useState, useEffect, useRef } from 'react';
import { useEvent } from '@hooks/useEventBus';
import { useFSM } from '@hooks/useFSM';
import { EV, type CuePayload, type RewardPayload } from '@core/events';
import { userFSM, type UserState } from '@core/UserProgressFSM';

// ── State label colors ──────────────────────────────────────────

const STATE_COLORS: Record<UserState, string> = {
  idle:        '#555',
  selecting:   '#00e5ff',
  routing:     '#ffc107',
  previewing:  '#7c4dff',
  confirming:  '#00e676',
  violation:   '#ff1744',
};

const STATE_LABELS: Record<UserState, string> = {
  idle:        'READY',
  selecting:   'FIXTURE SELECTED',
  routing:     'ROUTING',
  previewing:  'PREVIEW',
  confirming:  'CONFIRMED',
  violation:   'VIOLATION',
};

// ── Toast message queue ─────────────────────────────────────────

interface Toast {
  id: number;
  text: string;
  color: string;
  born: number;
}

let nextId = 0;

export function FeedbackOverlay() {
  const { state } = useFSM(userFSM);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const rafRef = useRef<number>(0);

  // Cue messages → blue/cyan toasts
  useEvent<CuePayload>(EV.CUE, (p) => {
    if (!p.message) return;
    setToasts((prev) => [
      ...prev,
      { id: nextId++, text: p.message!, color: '#00e5ff', born: Date.now() },
    ]);
  });

  // Reward messages → green toasts
  useEvent<RewardPayload>(EV.REWARD, (p) => {
    const labels: Record<string, string> = {
      snap: 'Snapped!',
      complete: 'Route Complete!',
      compliant: 'Code Compliant',
      milestone: 'Milestone Reached!',
    };
    setToasts((prev) => [
      ...prev,
      { id: nextId++, text: labels[p.type] ?? '', color: '#00e676', born: Date.now() },
    ]);
  });

  // Garbage-collect expired toasts every frame
  useEffect(() => {
    function tick() {
      setToasts((prev) => prev.filter((t) => Date.now() - t.born < 2500));
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <div style={styles.root}>
      {/* State badge — top-left.
          role="status" + aria-live="polite" so screen readers announce
          FSM transitions (IDLE → ROUTING → CONFIRMED …) without
          interrupting the user mid-speech. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={`Mode: ${STATE_LABELS[state]}`}
        style={{ ...styles.badge, borderColor: STATE_COLORS[state] }}
      >
        <div style={{ ...styles.dot, backgroundColor: STATE_COLORS[state] }} />
        {STATE_LABELS[state]}
      </div>

      {/* Toast stack — bottom-center.
          role="log" + aria-live="polite" so the queue of cues and
          rewards is announced as it grows. */}
      <div
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Feedback messages"
        style={styles.toastStack}
      >
        {toasts.map((t) => {
          const age = (Date.now() - t.born) / 2500;
          const opacity = age < 0.1 ? age / 0.1 : age > 0.7 ? (1 - age) / 0.3 : 1;
          return (
            <div
              key={t.id}
              style={{
                ...styles.toast,
                color: t.color,
                borderColor: t.color,
                opacity: Math.max(0, opacity),
              }}
            >
              {t.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    zIndex: 10,
  },
  badge: {
    position: 'absolute',
    top: 16,
    left: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 14px',
    borderRadius: 6,
    border: '1px solid',
    background: 'rgba(10,10,15,0.8)',
    color: '#eee',
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
  },
  toastStack: {
    position: 'absolute',
    bottom: 32,
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
  },
  toast: {
    padding: '8px 20px',
    borderRadius: 8,
    border: '1px solid',
    background: 'rgba(10,10,15,0.85)',
    fontSize: 14,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    transition: 'opacity 0.15s',
  },
};
