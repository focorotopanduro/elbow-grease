/**
 * ModeTabs — Phase 14.R.3 (redesigned).
 *
 * Top-center workspace tab switcher between Plumbing and Roofing.
 *
 * The design goal is instant mode legibility during high-tempo
 * mixed-trade sessions. The redesign lands on:
 *
 *   • **Sliding pill** — a solid-accent-colored pill sits behind
 *     the active tab and animates (280ms ease) to the clicked tab
 *     when the mode changes. Color cross-fades cyan ↔ orange during
 *     the slide so the transition doubles as an accent-color
 *     announcement.
 *   • **Big hit area** — each tab is 150×44 px (up from ~100×32).
 *     Friendly to tablet, gloved clicks, fast mouse work.
 *   • **Strong active / inactive contrast** — active text is
 *     `#0a0a0f` on the saturated accent pill (WCAG AA on both
 *     cyan and orange); inactive text sits muted at `#777`,
 *     brightens on hover.
 *   • **Subtle glow ring** — the container picks up a 16px
 *     shadow in the active accent color at low opacity, so the
 *     workspace color bleeds faintly into the surrounding chrome.
 *   • **Hotkey hint** — "⇧ M" chip below the container for the
 *     keyboard user who hasn't found Shift+M yet.
 *   • **Accessibility** — `role="tablist"` / `role="tab"` /
 *     `aria-selected` / roving `tabindex`, plus arrow-key
 *     navigation when a tab has focus. Home / End jump to first
 *     and last.
 *
 * Shift+M still toggles from anywhere (handled in KeyboardHandler).
 */

import { useRef } from 'react';
import {
  useAppModeStore,
  APP_MODE_LABELS,
  APP_MODE_ICONS,
  APP_MODE_ACCENTS,
  type AppMode,
} from '@store/appModeStore';

const MODES: AppMode[] = ['plumbing', 'roofing'];
const TAB_WIDTH_PX = 150;
const TAB_HEIGHT_PX = 44;
const CONTAINER_PAD_PX = 4;
const CONTAINER_WIDTH_PX = TAB_WIDTH_PX * MODES.length + CONTAINER_PAD_PX * 2;

export function ModeTabs() {
  const mode = useAppModeStore((s) => s.mode);
  const setMode = useAppModeStore((s) => s.setMode);
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const activeIdx = MODES.indexOf(mode);
  const activeAccent = APP_MODE_ACCENTS[mode];

  /** Pointer/keyboard: move focus to `idx` and activate that mode.
   *  "Automatic activation" is conventional for tablists where
   *  selection is cheap — here the workspace flip is effectively
   *  free. */
  const focusAndSet = (idx: number) => {
    const clamped = (idx + MODES.length) % MODES.length;
    const nextMode = MODES[clamped];
    if (!nextMode) return;
    setMode(nextMode);
    buttonRefs.current[clamped]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
    // Let the outer window-level KeyboardHandler keep its bindings;
    // we only intercept navigation within the tablist.
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        focusAndSet(idx + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        focusAndSet(idx - 1);
        break;
      case 'Home':
        e.preventDefault();
        e.stopPropagation();
        focusAndSet(0);
        break;
      case 'End':
        e.preventDefault();
        e.stopPropagation();
        focusAndSet(MODES.length - 1);
        break;
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 10,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 35,
        userSelect: 'none',
        fontFamily: 'system-ui, sans-serif',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <div
        role="tablist"
        aria-label="Workspace"
        aria-orientation="horizontal"
        style={{
          position: 'relative',
          width: CONTAINER_WIDTH_PX,
          height: TAB_HEIGHT_PX + CONTAINER_PAD_PX * 2,
          padding: CONTAINER_PAD_PX,
          background: '#0a0a0f',
          border: '1px solid #222',
          borderRadius: 12,
          // Subtle accent-colored glow bleeds the workspace colour
          // into the chrome around the tabs. Drops intensity on the
          // way out so it's atmospheric, not loud.
          boxShadow: `0 2px 14px rgba(0,0,0,0.5), 0 0 16px ${activeAccent}33`,
          transition: 'box-shadow 280ms ease',
          boxSizing: 'content-box',
        }}
      >
        {/* Sliding-pill indicator behind the active tab. */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: CONTAINER_PAD_PX,
            left: CONTAINER_PAD_PX,
            width: TAB_WIDTH_PX,
            height: TAB_HEIGHT_PX,
            borderRadius: 8,
            background: activeAccent,
            transform: `translateX(${activeIdx * TAB_WIDTH_PX}px)`,
            transition: 'transform 280ms cubic-bezier(0.4, 0, 0.2, 1), background 280ms ease',
            boxShadow: `0 1px 6px ${activeAccent}66`,
            pointerEvents: 'none',
          }}
        />

        {MODES.map((m, idx) => {
          const active = mode === m;
          return (
            <button
              key={m}
              ref={(el) => { buttonRefs.current[idx] = el; }}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => setMode(m)}
              onKeyDown={(e) => onKeyDown(e, idx)}
              title={`${APP_MODE_LABELS[m]} workspace — Shift+M to toggle, ← / → to navigate`}
              style={{
                position: 'relative',
                zIndex: 1,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: TAB_WIDTH_PX,
                height: TAB_HEIGHT_PX,
                background: 'transparent',
                border: 'none',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: active ? 700 : 500,
                // Dark text on the accent pill reads WCAG AA on both
                // cyan and orange; inactive text is deliberately
                // low-contrast so the active tab pops.
                color: active ? '#0a0a0f' : '#777',
                cursor: 'pointer',
                letterSpacing: active ? 0.3 : 0,
                transition: 'color 200ms ease, font-weight 200ms ease',
                outline: 'none',
                fontFamily: 'inherit',
              }}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.color = '#ccc';
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.color = '#777';
              }}
              onFocus={(e) => {
                // Visible focus ring that doesn't compete with the
                // accent pill — thin white halo around the button.
                e.currentTarget.style.boxShadow = '0 0 0 2px rgba(255,255,255,0.4)';
              }}
              onBlur={(e) => {
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>
                {APP_MODE_ICONS[m]}
              </span>
              <span>{APP_MODE_LABELS[m]}</span>
            </button>
          );
        })}
      </div>

      {/* Hotkey hint. Small, low-contrast — learnable without being
          loud. */}
      <div
        style={{
          fontSize: 10,
          color: '#555',
          letterSpacing: 0.5,
        }}
      >
        <kbd style={kbdStyle}>⇧</kbd>
        <kbd style={kbdStyle}>M</kbd>
        <span style={{ marginLeft: 4 }}>to toggle</span>
      </div>
    </div>
  );
}

const kbdStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '1px 5px',
  margin: '0 2px',
  background: '#14141a',
  border: '1px solid #2a2a30',
  borderRadius: 3,
  fontFamily: 'monospace',
  fontSize: 10,
  color: '#999',
};
