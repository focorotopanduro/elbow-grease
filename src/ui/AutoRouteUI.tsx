/**
 * AutoRouteUI — click-two-fixtures interaction for automatic routing.
 *
 * UX flow:
 *   1. User presses 'R' to enter auto-route mode
 *   2. First fixture click → glowing "start" marker
 *   3. Second fixture click → auto-route runs, progress animation plays
 *   4. Route appears as committed pipe (or HILO alternatives)
 *   5. Press Escape to cancel
 *
 * Also shows a mode indicator in the HUD and a dashed line between
 * the start fixture and the cursor while selecting the second fixture.
 */

import { useState, useCallback, useEffect } from 'react';
import { Line } from '@react-three/drei';
import { useEvent, useEmit } from '@hooks/useEventBus';
import { EV, type Vec3 } from '@core/events';
import { usePipeStore } from '@store/pipeStore';
import {
  getAutoRouter,
  AUTOROUTE_EV,
  type AutoRouteResult,
  type RoutingMode,
} from '@core/pathfinding/AutoRouter';
import type { SystemType, FixtureSubtype } from '../engine/graph/GraphNode';

// ── AutoRoute mode state ────────────────────────────────────────

export type AutoRoutePhase = 'inactive' | 'select_start' | 'select_end' | 'routing' | 'done';

interface AutoRouteState {
  phase: AutoRoutePhase;
  startPos: Vec3 | null;
  startFixtureId: string | null;
  endPos: Vec3 | null;
  system: SystemType;
  mode: RoutingMode;
  progressMessage: string;
}

// ── 3D scene component (dashed guide line) ──────────────────────

interface AutoRouteGuideProps {
  startPos: Vec3 | null;
  cursorPos: Vec3 | null;
  phase: AutoRoutePhase;
}

export function AutoRouteGuide({ startPos, cursorPos, phase }: AutoRouteGuideProps) {
  if (phase !== 'select_end' || !startPos || !cursorPos) return null;

  return (
    <group>
      {/* Dashed guide line from start to cursor */}
      <Line
        points={[startPos, cursorPos]}
        color="#ffc107"
        lineWidth={2}
        dashed
        dashSize={0.3}
        gapSize={0.15}
      />

      {/* Start marker */}
      <mesh position={startPos}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial
          color="#00e676"
          emissive="#00e676"
          emissiveIntensity={1.5}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ── 2D HUD overlay ──────────────────────────────────────────────

interface AutoRouteHUDProps {
  phase: AutoRoutePhase;
  system: SystemType;
  mode: RoutingMode;
  progressMessage: string;
  onCancel: () => void;
  onModeChange: (mode: RoutingMode) => void;
  onSystemChange: (system: SystemType) => void;
}

export function AutoRouteHUD({
  phase,
  system,
  mode,
  progressMessage,
  onCancel,
  onModeChange,
  onSystemChange,
}: AutoRouteHUDProps) {
  if (phase === 'inactive') return null;

  const SYSTEMS: { key: SystemType; label: string; color: string }[] = [
    { key: 'waste', label: 'Waste', color: '#ef5350' },
    { key: 'vent', label: 'Vent', color: '#66bb6a' },
    { key: 'cold_supply', label: 'Cold', color: '#29b6f6' },
    { key: 'hot_supply', label: 'Hot', color: '#ff7043' },
  ];

  const MODES: { key: RoutingMode; label: string }[] = [
    { key: 'single', label: 'Best' },
    { key: 'hilo', label: 'Options' },
    { key: 'multi', label: 'Full System' },
  ];

  const phaseMessages: Record<AutoRoutePhase, string> = {
    inactive: '',
    select_start: 'Click the START fixture',
    select_end: 'Click the END fixture',
    routing: progressMessage || 'Computing route...',
    done: 'Route complete!',
  };

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>AUTO-ROUTE</span>
        <button style={styles.cancelBtn} onClick={onCancel}>ESC</button>
      </div>

      <div style={styles.message}>{phaseMessages[phase]}</div>

      {/* System selector */}
      {(phase === 'select_start' || phase === 'select_end') && (
        <div style={styles.selectorRow}>
          {SYSTEMS.map((s) => (
            <button
              key={s.key}
              style={{
                ...styles.chip,
                borderColor: system === s.key ? s.color : '#333',
                color: system === s.key ? s.color : '#666',
              }}
              onClick={() => onSystemChange(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Mode selector */}
      {phase === 'select_start' && (
        <div style={styles.selectorRow}>
          {MODES.map((m) => (
            <button
              key={m.key}
              style={{
                ...styles.chip,
                borderColor: mode === m.key ? '#00e5ff' : '#333',
                color: mode === m.key ? '#00e5ff' : '#666',
              }}
              onClick={() => onModeChange(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {/* Progress bar during routing */}
      {phase === 'routing' && (
        <div style={styles.progressTrack}>
          <div style={styles.progressFill} />
        </div>
      )}
    </div>
  );
}

// ── Controller hook ─────────────────────────────────────────────

export function useAutoRoute() {
  const [state, setState] = useState<AutoRouteState>({
    phase: 'inactive',
    startPos: null,
    startFixtureId: null,
    endPos: null,
    system: 'waste',
    mode: 'single',
    progressMessage: '',
  });

  const pipes = usePipeStore((s) => s.pipes);

  // Keyboard: R to enter mode, Escape to cancel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && state.phase === 'inactive') {
        setState((s) => ({ ...s, phase: 'select_start' }));
      }
      if (e.key === 'Escape' && state.phase !== 'inactive') {
        setState((s) => ({ ...s, phase: 'inactive', startPos: null, endPos: null }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.phase]);

  // Listen for auto-route progress
  useEvent(AUTOROUTE_EV.PROGRESS, (payload: { phase: string }) => {
    setState((s) => ({ ...s, progressMessage: payload.phase.replace(/_/g, ' ') }));
  });

  // Listen for auto-route result → commit the pipe
  useEvent<AutoRouteResult>(AUTOROUTE_EV.RESULT, (result) => {
    // Emit PIPE_COMPLETE to commit the route
    eventBus.emit(EV.PIPE_COMPLETE, {
      id: `auto-${Date.now()}`,
      points: result.path,
      diameter: 2,
      material: 'pvc_sch40',
    });
    setState((s) => ({ ...s, phase: 'done' }));
    setTimeout(() => {
      setState((s) => ({ ...s, phase: 'inactive', startPos: null, endPos: null }));
    }, 1000);
  });

  const handleFixtureClick = useCallback((position: Vec3, fixtureId: string) => {
    if (state.phase === 'select_start') {
      setState((s) => ({
        ...s,
        phase: 'select_end',
        startPos: position,
        startFixtureId: fixtureId,
      }));
    } else if (state.phase === 'select_end' && state.startPos) {
      setState((s) => ({ ...s, phase: 'routing', endPos: position }));

      // Run auto-router
      const router = getAutoRouter();
      router.setExistingPipes(Object.values(pipes));

      const request = {
        startFixtureId: state.startFixtureId ?? '',
        endFixtureId: fixtureId,
        startPos: state.startPos,
        endPos: position,
        system: state.system,
        mode: state.mode,
      };

      // Run async (setTimeout to let UI update)
      setTimeout(() => {
        if (state.mode === 'multi') {
          router.routeMultiSystem(request);
        } else if (state.mode === 'hilo') {
          router.routeWithAlternatives(request);
        } else {
          router.route(request);
        }
      }, 50);
    }
  }, [state, pipes]);

  const cancel = useCallback(() => {
    setState((s) => ({ ...s, phase: 'inactive', startPos: null, endPos: null }));
  }, []);

  return {
    state,
    handleFixtureClick,
    cancel,
    setSystem: (system: SystemType) => setState((s) => ({ ...s, system })),
    setMode: (mode: RoutingMode) => setState((s) => ({ ...s, mode })),
  };
}

// We need to import eventBus for the PIPE_COMPLETE emit
import { eventBus } from '@core/EventBus';

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    top: '50%',
    left: 16,
    transform: 'translateY(-50%)',
    width: 200,
    padding: 12,
    borderRadius: 10,
    border: '1px solid #ffc107',
    background: 'rgba(10,10,15,0.95)',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    pointerEvents: 'auto',
    zIndex: 30,
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 11,
    fontWeight: 700,
    color: '#ffc107',
    letterSpacing: 1.5,
  },
  cancelBtn: {
    fontSize: 9,
    color: '#888',
    background: 'none',
    border: '1px solid #444',
    borderRadius: 4,
    padding: '2px 8px',
    cursor: 'pointer',
  },
  message: {
    fontSize: 13,
    color: '#eee',
    marginBottom: 10,
    fontWeight: 500,
  },
  selectorRow: {
    display: 'flex',
    gap: 4,
    marginBottom: 8,
    flexWrap: 'wrap' as const,
  },
  chip: {
    fontSize: 10,
    fontWeight: 600,
    padding: '3px 8px',
    borderRadius: 4,
    border: '1px solid',
    background: 'none',
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: '#222',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    width: '60%',
    borderRadius: 2,
    backgroundColor: '#ffc107',
    animation: 'pulse 1s ease-in-out infinite',
  },
};
