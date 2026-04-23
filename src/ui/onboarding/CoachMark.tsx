/**
 * CoachMark — the floating instructional card.
 *
 * Rendered by OnboardingOverlay with the currently-active step. The
 * card positions itself against `step.targetSelector` when available,
 * otherwise falls back to a fixed-placement centered variant.
 *
 * A11y:
 *   role="dialog" aria-modal="true" aria-labelledby={titleId}
 *   Focus trap via @core/a11y/useFocusTrap
 *   Escape = dismiss (overlay handler)
 */

import { useEffect, useMemo, useState } from 'react';
import type { OnboardingStep } from '@core/onboarding/steps';
import { useFocusTrap } from '@core/a11y/useFocusTrap';

// ── Props ──────────────────────────────────────────────────────

interface CoachMarkProps {
  step: OnboardingStep;
  /** 1-based index, shown as "Step N of M". */
  stepNumber: number;
  totalSteps: number;
  /** Called when the user clicks the primary (Next / Got it) button. */
  onNext: () => void;
  /** Called when the user clicks Skip / closes. */
  onDismiss: () => void;
}

// ── Component ──────────────────────────────────────────────────

export function CoachMark({ step, stepNumber, totalSteps, onNext, onDismiss }: CoachMarkProps) {
  const trapRef = useFocusTrap<HTMLDivElement>(true);
  const targetRect = useTargetRect(step.targetSelector);

  const cardStyle = useMemo(
    () => computeCardPlacement(step.placement, targetRect),
    [step.placement, targetRect],
  );

  const titleId = `onboarding-step-${step.id}-title`;

  const isFinal = step.isFinal === true;
  const primaryLabel = step.primaryLabel ?? (isFinal ? 'Got it' : 'Next');

  const bodyParagraphs = step.body.split('\n').filter((p) => p.trim().length > 0);

  return (
    <>
      {/* Backdrop — dims the app so the card stands out. Click = dismiss. */}
      <div style={styles.backdrop} onClick={onDismiss} aria-hidden="true" />

      {/* Target-highlight outline. Drawn only when the target is
          resolvable. A bordered <div> on top of the target with
          pointer-events:none so it doesn't block clicks. */}
      {targetRect && (
        <div
          aria-hidden="true"
          style={{
            ...styles.highlight,
            top: targetRect.top - 6,
            left: targetRect.left - 6,
            width: targetRect.width + 12,
            height: targetRect.height + 12,
          }}
        />
      )}

      {/* The card itself */}
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ ...styles.card, ...cardStyle }}
      >
        <div style={styles.header}>
          <span style={styles.progress}>
            Step {stepNumber} of {totalSteps}
          </span>
          <button
            type="button"
            aria-label="Dismiss walkthrough"
            style={styles.closeBtn}
            onClick={onDismiss}
          >
            ×
          </button>
        </div>

        <h2 id={titleId} style={styles.title}>{step.title}</h2>

        <div style={styles.body}>
          {bodyParagraphs.map((p, i) => (
            <p key={i} style={styles.paragraph}>{p}</p>
          ))}
        </div>

        <div style={styles.footer}>
          {!isFinal && (
            <button type="button" style={styles.skipBtn} onClick={onDismiss}>
              Skip tutorial
            </button>
          )}
          <button type="button" style={styles.primaryBtn} onClick={onNext} autoFocus>
            {primaryLabel}
          </button>
        </div>
      </div>
    </>
  );
}

// ── Target positioning ────────────────────────────────────────

/**
 * Read a target element's bounding rect and keep it in sync with
 * window resize / scroll. Returns null if the selector can't be found.
 */
function useTargetRect(selector: string | undefined): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    if (!selector) { setRect(null); return; }

    const read = () => {
      const el = document.querySelector(selector);
      if (!el) { setRect(null); return; }
      setRect(el.getBoundingClientRect());
    };

    // Initial read (defer one tick so R3F / late-mounting UI is present).
    const t = window.setTimeout(read, 50);

    // Keep in sync with viewport changes.
    window.addEventListener('resize', read);
    window.addEventListener('scroll', read, true);
    const interval = window.setInterval(read, 500); // cheap catch-all for animated UI

    return () => {
      window.clearTimeout(t);
      window.removeEventListener('resize', read);
      window.removeEventListener('scroll', read, true);
      window.clearInterval(interval);
    };
  }, [selector]);

  return rect;
}

function computeCardPlacement(
  placement: OnboardingStep['placement'],
  targetRect: DOMRect | null,
): React.CSSProperties {
  // No target → use placement as an absolute anchor.
  if (!targetRect) {
    switch (placement) {
      case 'top-right':      return { top: 80, right: 24 };
      case 'top-left':       return { top: 80, left: 24 };
      case 'bottom-right':   return { bottom: 24, right: 24 };
      case 'bottom-center':  return { bottom: 24, left: '50%', transform: 'translateX(-50%)' };
      default:
      case 'center':         return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
    }
  }

  // Target present → offset relative to it.
  const GAP = 16;
  const card = { top: 0, left: 0 }; // absolute px
  // Try below → right → above → left of the target.
  if (targetRect.bottom + GAP + 220 < window.innerHeight) {
    card.top = targetRect.bottom + GAP;
    card.left = Math.min(window.innerWidth - 360, Math.max(16, targetRect.left));
  } else if (targetRect.top - GAP - 220 > 0) {
    card.top = targetRect.top - GAP - 220;
    card.left = Math.min(window.innerWidth - 360, Math.max(16, targetRect.left));
  } else {
    // Fallback to side-by-side.
    card.top = Math.min(window.innerHeight - 240, Math.max(16, targetRect.top));
    card.left = targetRect.right + GAP + 340 < window.innerWidth
      ? targetRect.right + GAP
      : Math.max(16, targetRect.left - 340 - GAP);
  }
  return { top: card.top, left: card.left };
}

// ── Styles ─────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0, 0, 0, 0.55)',
    zIndex: 1800,
    cursor: 'default',
  },
  highlight: {
    position: 'fixed',
    border: '2px solid #00e5ff',
    borderRadius: 8,
    boxShadow: '0 0 0 4px rgba(0, 229, 255, 0.25), 0 0 24px rgba(0, 229, 255, 0.5)',
    pointerEvents: 'none',
    zIndex: 1850,
    transition: 'top 150ms, left 150ms, width 150ms, height 150ms',
  },
  card: {
    position: 'fixed',
    width: 340,
    maxWidth: 'calc(100vw - 32px)',
    padding: 18,
    background: 'rgba(10, 14, 22, 0.98)',
    border: '1px solid #2a3a54',
    borderRadius: 10,
    boxShadow: '0 20px 60px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(0, 229, 255, 0.08)',
    color: '#e0e6ef',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    fontSize: 13,
    lineHeight: 1.5,
    zIndex: 1900,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  progress: {
    fontSize: 10,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: '#00e5ff',
    fontWeight: 700,
  },
  closeBtn: {
    background: 'none',
    border: 'none',
    color: '#7a8592',
    fontSize: 20,
    lineHeight: 1,
    cursor: 'pointer',
    padding: '0 6px',
  },
  title: {
    margin: 0,
    fontSize: 16,
    fontWeight: 700,
    color: '#ffffff',
  },
  body: {
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  paragraph: {
    margin: 0,
    color: '#aebbc9',
  },
  footer: {
    marginTop: 6,
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
  },
  skipBtn: {
    padding: '7px 12px',
    background: 'transparent',
    border: '1px solid #2a3a54',
    borderRadius: 5,
    color: '#7a8592',
    fontFamily: 'inherit',
    fontSize: 12,
    cursor: 'pointer',
  },
  primaryBtn: {
    padding: '7px 16px',
    background: 'linear-gradient(180deg, #00e5ff 0%, #00b8d4 100%)',
    border: 'none',
    borderRadius: 5,
    color: '#0a0e18',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: 0.5,
  },
};
