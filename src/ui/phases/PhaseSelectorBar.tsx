/**
 * PhaseSelectorBar — top-center horizontal HUD for choosing the active
 * construction phase and visibility mode.
 *
 * ┌───────────────────────────────────────────────────────────┐
 * │  ⛏ UG  │  🔧 RI  │  ✨ TR    ···    [Single ▾] [Tint ○]    │
 * └───────────────────────────────────────────────────────────┘
 *
 * Clicks:
 *   - Phase tile → setActivePhase (and visibility to 'single' if shift)
 *   - Mode pill  → cycleVisibilityMode
 *   - Tint toggle → toggleTint
 *
 * Color accents come from PHASE_META.
 */

import { usePlumbingPhaseStore } from '@store/plumbingPhaseStore';
import { PHASE_META, PHASE_ORDER, type ConstructionPhase } from '@core/phases/PhaseTypes';
import { usePipeStore } from '@store/pipeStore';
import { useFixtureStore } from '@store/fixtureStore';
import { classifyPipe, classifyFixture } from '@core/phases/PhaseClassifier';
import { useMemo } from 'react';

export function PhaseSelectorBar() {
  const activePhase = usePlumbingPhaseStore((s) => s.activePhase);
  const mode = usePlumbingPhaseStore((s) => s.visibilityMode);
  const tintByPhase = usePlumbingPhaseStore((s) => s.tintByPhase);
  const showHalo = usePlumbingPhaseStore((s) => s.showPhaseHalo);
  const setActive = usePlumbingPhaseStore((s) => s.setActivePhase);
  const setMode = usePlumbingPhaseStore((s) => s.setVisibilityMode);
  const cycle = usePlumbingPhaseStore((s) => s.cycleVisibilityMode);
  const toggleTint = usePlumbingPhaseStore((s) => s.toggleTint);
  const toggleHalo = usePlumbingPhaseStore((s) => s.toggleHalo);
  const pipeOverrides = usePlumbingPhaseStore((s) => s.pipeOverrides);
  const fixtureOverrides = usePlumbingPhaseStore((s) => s.fixtureOverrides);
  const pipes = usePipeStore((s) => s.pipes);
  const fixtures = useFixtureStore((s) => s.fixtures);

  // Count per-phase objects for tile badges
  const counts = useMemo(() => {
    const m: Record<ConstructionPhase, number> = { underground: 0, rough_in: 0, trim: 0 };
    for (const p of Object.values(pipes)) {
      const phase = pipeOverrides[p.id] ?? classifyPipe(p);
      m[phase]++;
    }
    for (const f of Object.values(fixtures)) {
      const phase = fixtureOverrides[f.id] ?? classifyFixture(f);
      m[phase]++;
    }
    return m;
  }, [pipes, fixtures, pipeOverrides, fixtureOverrides]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 42,
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'stretch',
        gap: 2,
        padding: 4,
        background: 'linear-gradient(180deg, rgba(6,12,20,0.96) 0%, rgba(14,22,34,0.9) 100%)',
        border: '1px solid rgba(120, 180, 220, 0.28)',
        borderRadius: 10,
        backdropFilter: 'blur(6px)',
        boxShadow: '0 4px 12px rgba(0,0,0,0.45)',
        fontFamily: '"Segoe UI", system-ui, sans-serif',
      }}
      title="Construction Phase Selector"
    >
      {PHASE_ORDER.map((phase) => {
        const meta = PHASE_META[phase];
        const isActive = phase === activePhase;
        const visible =
          mode === 'all' ? true :
          mode === 'single' ? phase === activePhase :
          PHASE_ORDER.indexOf(phase) <= PHASE_ORDER.indexOf(activePhase);

        return (
          <div
            key={phase}
            onClick={(e) => {
              setActive(phase);
              if (e.shiftKey) setMode('single');
            }}
            title={`${meta.label} — ${meta.description}\n[${meta.hotkey}] to activate, Shift+click = Solo`}
            style={{
              cursor: 'pointer',
              padding: '6px 14px',
              borderRadius: 6,
              background: isActive
                ? `linear-gradient(135deg, ${meta.color}dd 0%, ${meta.color}99 100%)`
                : visible ? 'rgba(30,45,60,0.7)' : 'rgba(30,45,60,0.3)',
              border: `1px solid ${isActive ? meta.color : visible ? 'rgba(120,180,220,0.25)' : 'rgba(60,80,100,0.4)'}`,
              color: isActive ? '#fff' : visible ? meta.color : '#4a5a6a',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 78,
              transition: 'all 120ms',
              boxShadow: isActive ? `0 0 12px ${meta.color}55` : 'none',
              position: 'relative',
              userSelect: 'none',
            }}
          >
            <div style={{ fontSize: 16, filter: isActive ? `drop-shadow(0 0 3px ${meta.color})` : 'none' }}>{meta.icon}</div>
            <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.1 }}>
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: 1,
                textShadow: isActive ? `0 0 6px ${meta.color}` : 'none',
              }}>{meta.shortLabel}</span>
              <span style={{
                fontSize: 9,
                opacity: 0.85,
                fontFamily: 'Consolas, monospace',
              }}>
                {counts[phase]} items
              </span>
            </div>
            {/* Hotkey badge */}
            <div style={{
              position: 'absolute',
              top: 2,
              right: 4,
              fontSize: 8,
              color: isActive ? '#fff' : '#8aa0b1',
              fontFamily: 'Consolas, monospace',
              opacity: 0.7,
            }}>{meta.hotkey}</div>
          </div>
        );
      })}

      {/* Divider */}
      <div style={{ width: 1, background: 'rgba(120,180,220,0.2)', margin: '0 6px' }} />

      {/* Visibility mode */}
      <button
        onClick={cycle}
        title="Cycle visibility mode (All / Single / Cumulative)\n[P] to cycle"
        style={{
          padding: '4px 10px',
          background: 'rgba(30,45,60,0.6)',
          border: '1px solid rgba(120,180,220,0.3)',
          borderRadius: 5,
          color: '#7fb8d0',
          fontSize: 10,
          fontFamily: 'Consolas, monospace',
          letterSpacing: 1,
          cursor: 'pointer',
          minWidth: 90,
        }}
      >
        <div style={{ fontSize: 8, color: '#4a5a6a', marginBottom: 2 }}>MODE</div>
        <div style={{ color: '#4dd0e1', fontWeight: 600 }}>
          {mode === 'all' ? '▦ ALL' : mode === 'single' ? '◉ SOLO' : '◧ CUMUL'}
        </div>
      </button>

      {/* Tint toggle */}
      <button
        onClick={toggleTint}
        title="Tint pipes by phase color"
        style={smallToggleStyle(tintByPhase)}
      >
        {tintByPhase ? '◉' : '○'} TINT
      </button>

      {/* Halo toggle */}
      <button
        onClick={toggleHalo}
        title="Show phase-colored halo on fixtures"
        style={smallToggleStyle(showHalo)}
      >
        {showHalo ? '◉' : '○'} HALO
      </button>
    </div>
  );
}

function smallToggleStyle(on: boolean): React.CSSProperties {
  return {
    padding: '5px 8px',
    background: on ? 'rgba(38,198,218,0.15)' : 'rgba(30,45,60,0.6)',
    border: `1px solid ${on ? '#4dd0e1' : 'rgba(120,180,220,0.25)'}`,
    borderRadius: 5,
    color: on ? '#4dd0e1' : '#7fb8d0',
    fontSize: 10,
    fontFamily: 'Consolas, monospace',
    letterSpacing: 1,
    cursor: 'pointer',
  };
}
