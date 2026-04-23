/**
 * ModeTabs — Phase 14.R.3.
 *
 * Top-center tab switcher between Plumbing and Roofing workspaces.
 * Clicking a tab calls `useAppModeStore.setMode()` — all mode-gated
 * UI re-renders via normal Zustand subscriptions. Shift+M toggles
 * between the modes from anywhere.
 *
 * Deliberately minimal — no animations, no labels beyond the mode
 * name + icon. Sits at z-index 35 (above the Toolbar's 30) so it
 * can't be visually overlapped by the left rail.
 */

import {
  useAppModeStore,
  APP_MODE_LABELS,
  APP_MODE_ICONS,
  APP_MODE_ACCENTS,
  type AppMode,
} from '@store/appModeStore';

const MODES: AppMode[] = ['plumbing', 'roofing'];

export function ModeTabs() {
  const mode = useAppModeStore((s) => s.mode);
  const setMode = useAppModeStore((s) => s.setMode);

  return (
    <div
      style={{
        position: 'fixed',
        top: 10,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 2,
        padding: 3,
        background: '#0a0a0f',
        border: '1px solid #222',
        borderRadius: 10,
        zIndex: 35,
        userSelect: 'none',
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
      }}
    >
      {MODES.map((m) => {
        const active = mode === m;
        const accent = APP_MODE_ACCENTS[m];
        return (
          <button
            key={m}
            onClick={() => setMode(m)}
            title={`${APP_MODE_LABELS[m]} workspace — Shift+M to toggle`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              background: active ? `${accent}22` : 'transparent',
              color: active ? accent : '#666',
              border: 'none',
              borderRadius: 7,
              fontSize: 13,
              fontWeight: active ? 600 : 500,
              cursor: 'pointer',
              transition: 'color 120ms, background 120ms',
            }}
          >
            <span style={{ fontSize: 15 }}>{APP_MODE_ICONS[m]}</span>
            <span>{APP_MODE_LABELS[m]}</span>
          </button>
        );
      })}
    </div>
  );
}
