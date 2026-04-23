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
 *     and last. Respects `prefers-reduced-motion`.
 *
 * Shift+M still toggles from anywhere (handled in KeyboardHandler).
 *
 * ─── Interaction state: useInteractiveButton hook ──────────────
 *
 * Per-tab hover / pressed / focused state is owned by
 * `useInteractiveButton` (see `src/ui/shared/`). The hook returns the
 * three booleans plus a `bindings` object that spreads onto the
 * native `<button>`. That hook gets the tricky edge cases right:
 *
 *   • Mouseleave during a press releases BOTH hovered and pressed
 *     (users drag off a button to abort a click).
 *   • Binding identity is stable across renders — React doesn't
 *     re-attach handlers on every parent re-render.
 *
 * Because hooks can't be called in a map, the tab body is extracted
 * into a `<ModeTab>` subcomponent that calls the hook once per
 * instance.
 *
 * ─── Edge cases handled ──────────────────────────────────────
 *
 * `activeIdx` is clamped to 0 when `mode` somehow isn't in `MODES`
 * (e.g. corrupt localStorage value) — the pill stays visually
 * on-screen instead of sliding off to the left.
 *
 * Clicking the already-active tab is a no-op instead of a redundant
 * `setMode` that would re-persist the same value to localStorage.
 */

import {
  useAppModeStore,
  APP_MODE_LABELS,
  APP_MODE_ICONS,
  APP_MODE_ACCENTS,
  type AppMode,
} from '@store/appModeStore';
import { useReducedMotion } from '@core/a11y/useReducedMotion';
import { useInteractiveButton } from '@ui/shared/useInteractiveButton';
import { getReadableText } from '@ui/shared/accentContrast';

const MODES: AppMode[] = ['plumbing', 'roofing'];
const TAB_WIDTH_PX = 150;
const TAB_HEIGHT_PX = 44;
const CONTAINER_PAD_PX = 4;
const CONTAINER_WIDTH_PX = TAB_WIDTH_PX * MODES.length + CONTAINER_PAD_PX * 2;

export function ModeTabs() {
  const mode = useAppModeStore((s) => s.mode);
  const setMode = useAppModeStore((s) => s.setMode);
  const reducedMotion = useReducedMotion();

  // Defensive clamp: if `mode` somehow isn't in MODES (rare but
  // possible with a stale / corrupted localStorage value), keep
  // the pill on-screen at index 0 rather than animating off-canvas.
  const rawActiveIdx = MODES.indexOf(mode);
  const activeIdx = rawActiveIdx >= 0 ? rawActiveIdx : 0;
  const resolvedMode = MODES[activeIdx]!;
  const activeAccent = APP_MODE_ACCENTS[resolvedMode];

  // Transition strings honour prefers-reduced-motion. Users with
  // vestibular disorders see instantaneous state flips.
  const pillTransition = reducedMotion
    ? 'none'
    : 'transform 280ms cubic-bezier(0.4, 0, 0.2, 1), background 280ms ease, box-shadow 280ms ease';
  const containerGlowTransition = reducedMotion ? 'none' : 'box-shadow 280ms ease';

  /** Pointer / keyboard: move focus to `idx` and activate that
   *  mode. Wraps at both ends. No-ops if the target mode is
   *  already active so we don't burn a localStorage write on
   *  clicking the tab that's already selected. */
  const focusAndSet = (idx: number) => {
    const clamped = (idx + MODES.length) % MODES.length;
    const nextMode = MODES[clamped];
    if (!nextMode) return;
    if (nextMode !== mode) setMode(nextMode);
    // Focus the target tab regardless of mode change so arrow
    // nav feels responsive when pressed repeatedly on the end tab.
    const btn = document.querySelector<HTMLButtonElement>(
      `[data-mode-tab="${nextMode}"]`,
    );
    btn?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, idx: number) => {
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
      // Space + Enter handled natively by <button> — they fire
      // onClick, which routes through the no-op guard below.
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
          transition: containerGlowTransition,
          boxSizing: 'content-box',
        }}
      >
        {/* Sliding-pill indicator behind the active tab. */}
        <div
          aria-hidden="true"
          data-testid="mode-pill"
          style={{
            position: 'absolute',
            top: CONTAINER_PAD_PX,
            left: CONTAINER_PAD_PX,
            width: TAB_WIDTH_PX,
            height: TAB_HEIGHT_PX,
            borderRadius: 8,
            background: activeAccent,
            transform: `translateX(${activeIdx * TAB_WIDTH_PX}px)`,
            transition: pillTransition,
            boxShadow: `0 1px 6px ${activeAccent}66`,
            pointerEvents: 'none',
          }}
        />

        {MODES.map((m, idx) => (
          <ModeTab
            key={m}
            mode={m}
            active={resolvedMode === m}
            idx={idx}
            reducedMotion={reducedMotion}
            onActivate={() => {
              if (m !== mode) setMode(m);
            }}
            onKeyDown={(e) => onKeyDown(e, idx)}
          />
        ))}
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

// ── Single tab button ────────────────────────────────────────────

interface ModeTabProps {
  mode: AppMode;
  active: boolean;
  idx: number;
  reducedMotion: boolean;
  onActivate: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
}

/**
 * One tab button inside ModeTabs. Owns its own hover / pressed /
 * focused state via `useInteractiveButton` and composes the visual
 * language (hover halo, focus ring, press-scale) from those three
 * flags.
 *
 * Extracting this into a subcomponent is required because
 * `useInteractiveButton` is a hook, and hooks can't be called in a
 * map. Each tab renders as its own component with its own hook call.
 */
function ModeTab({ mode: m, active, reducedMotion, onActivate, onKeyDown }: ModeTabProps) {
  const { hovered, pressed, focused, bindings } = useInteractiveButton();

  // Transition text colour AND the hover glow/background on the
  // same 200ms curve. Keeps the affordance feeling like a single
  // coordinated move rather than a staggered fade. The pressure
  // feedback rides on a faster 100ms curve so the press feels
  // immediately tactile — the pill's 280ms slide then takes over.
  const tabTextTransition = reducedMotion
    ? 'none'
    : 'color 200ms ease, background 200ms ease, box-shadow 200ms ease, transform 100ms ease';

  // Active-tab text sits on the accent-colored pill. Use
  // `getReadableText` rather than hardcoding `#0a0a0f` so that if a
  // future workspace ships a dim accent (navy, forest, maroon) the
  // text flips to white automatically. No-op for cyan + orange —
  // both are bright enough that dark text wins the contrast check
  // (and the spec tests pin that equivalence).
  const color = active
    ? getReadableText(APP_MODE_ACCENTS[m])
    : hovered ? '#ccc' : '#777';

  // Hover affordance on the INACTIVE tab: the tab picks up
  // a faint halo in its OWN accent colour — a preview of
  // the workspace the user is about to land in. When
  // hovering the roofing tab from plumbing mode, the halo
  // is orange (destination), not cyan (current). When
  // active, no hover accent — the pill already owns that
  // tab's visual space.
  const hoverAccent = !active && hovered ? APP_MODE_ACCENTS[m] : null;
  const tabBackground = hoverAccent ? `${hoverAccent}1A` : 'transparent';
  const hoverShadow = hoverAccent ? `0 0 12px ${hoverAccent}55` : '';
  const focusShadow = focused ? '0 0 0 2px rgba(255,255,255,0.7)' : '';
  // Stack focus + hover if both apply — focused-and-hovered
  // gets white focus ring AND accent glow.
  const boxShadow = [focusShadow, hoverShadow].filter(Boolean).join(', ') || 'none';

  return (
    <button
      data-mode-tab={m}
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      onClick={onActivate}
      onKeyDown={onKeyDown}
      {...bindings}
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
        background: tabBackground,
        border: 'none',
        borderRadius: 8,
        fontSize: 14,
        fontWeight: active ? 700 : 500,
        color,
        boxShadow,
        // Tactile scale-down on press. 4% smaller reads
        // as a deliberate "click landed" tap without
        // looking buggy. Snaps back on release.
        transform: pressed ? 'scale(0.96)' : 'scale(1)',
        cursor: 'pointer',
        letterSpacing: active ? 0.3 : 0,
        // `font-weight` removed from the transition list —
        // CSS doesn't interpolate discrete font-weights, so
        // listing it was a lie that didn't animate anything.
        transition: tabTextTransition,
        outline: 'none',
        fontFamily: 'inherit',
      }}
    >
      <span style={{ fontSize: 18, lineHeight: 1 }}>
        {APP_MODE_ICONS[m]}
      </span>
      <span>{APP_MODE_LABELS[m]}</span>
    </button>
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
