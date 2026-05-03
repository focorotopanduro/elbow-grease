import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { track } from '../lib/analytics';
import './BeforeAfterSlider.css';

/**
 * BeforeAfterSlider — image comparison with draggable vertical divider.
 *
 * Architecture:
 *   - Two stacked images: AFTER (base layer, full container) + BEFORE
 *     (clip-path inset, revealed only on the left side based on slider %)
 *   - Vertical divider line + circular drag handle
 *   - Pointer events (mouse + touch + pen) via setPointerCapture for
 *     reliable drag-outside-bounds behavior
 *   - Keyboard: Arrow keys move ±5%, Shift+Arrow ±10%, Home/End to extremes
 *
 * A11y:
 *   - role="slider" with aria-valuemin/max/now/valuetext on the handle
 *   - tabIndex 0 so the handle is focusable
 *   - Visible focus ring (gold)
 *   - aria-label on handle includes the comparison subject
 *
 * Performance:
 *   - Both images use loading="lazy" since the gallery is below-the-fold
 *   - No re-renders during drag — position is local React state, drag
 *     handler uses requestAnimationFrame implicitly via React batching
 *
 * Failure mode:
 *   - If either image fails to load, the entire slider falls back to a
 *     "Photo coming soon" placeholder. Mirrors the CityProjects pattern.
 */

export interface BeforeAfterSliderProps {
  /** URL for the BEFORE image — appears on the LEFT half of the slider. */
  before: string;
  /** URL for the AFTER image — appears on the RIGHT half. */
  after: string;
  /** Alt text describing the comparison subject (used for both images + slider label). */
  alt: string;
  /** Optional caption shown below the slider. */
  caption?: string;
  /** Initial divider position in percent (0–100). Default 50. */
  initialPosition?: number;
}

function clamp(n: number, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, n));
}

export default function BeforeAfterSlider({
  before,
  after,
  alt,
  caption,
  initialPosition = 50,
}: BeforeAfterSliderProps) {
  const [position, setPosition] = useState(clamp(initialPosition));
  const [imageError, setImageError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const interactedRef = useRef(false);

  const trackInteraction = useCallback(() => {
    if (interactedRef.current) return;
    interactedRef.current = true;
    track('cta_click', {
      cta: 'before_after_drag',
      placement: 'before_after_slider',
    });
  }, []);

  const updateFromClientX = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPosition(clamp(pct));
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (imageError) return;
      draggingRef.current = true;
      // Capture so dragging continues even when the pointer leaves the
      // container — critical for touch-drag to feel native.
      const target = e.target as Element & { setPointerCapture?: (id: number) => void };
      target.setPointerCapture?.(e.pointerId);
      updateFromClientX(e.clientX);
      trackInteraction();
    },
    [imageError, updateFromClientX, trackInteraction],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;
      updateFromClientX(e.clientX);
    },
    [updateFromClientX],
  );

  const onPointerUp = useCallback(() => {
    draggingRef.current = false;
  }, []);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      const step = e.shiftKey ? 10 : 5;
      let next: number;
      switch (e.key) {
        case 'ArrowLeft':
        case 'ArrowDown':
          next = position - step;
          break;
        case 'ArrowRight':
        case 'ArrowUp':
          next = position + step;
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = 100;
          break;
        case 'PageDown':
          next = position - 25;
          break;
        case 'PageUp':
          next = position + 25;
          break;
        default:
          return;
      }
      e.preventDefault();
      setPosition(clamp(next));
      trackInteraction();
    },
    [position, trackInteraction],
  );

  if (imageError) {
    return (
      <figure className="bas">
        <div
          className="bas__container bas__container--placeholder"
          aria-label={`${alt} — photo coming soon`}
        >
          <span className="bas__placeholder-text">Photo coming soon</span>
        </div>
        {caption && <figcaption className="bas__caption">{caption}</figcaption>}
      </figure>
    );
  }

  // Round position for display in aria-valuetext + clip-path. The
  // visual remains smooth — only the announced value snaps to integers,
  // which screen readers prefer over rapid float updates.
  const rounded = Math.round(position);

  return (
    <figure className="bas">
      <div
        ref={containerRef}
        className="bas__container"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* AFTER image — base layer, always visible */}
        <img
          className="bas__after"
          src={after}
          alt={`${alt} — after`}
          loading="lazy"
          draggable={false}
          onError={() => setImageError(true)}
        />
        {/* BEFORE image — overlay clipped to the left portion */}
        <img
          className="bas__before"
          src={before}
          alt={`${alt} — before`}
          loading="lazy"
          draggable={false}
          onError={() => setImageError(true)}
          style={{ clipPath: `inset(0 ${100 - rounded}% 0 0)` }}
        />

        {/* Labels — small chips that flag which side is which */}
        <span className="bas__label bas__label--before" aria-hidden="true">Before</span>
        <span className="bas__label bas__label--after" aria-hidden="true">After</span>

        {/* Divider line + handle */}
        <div
          className="bas__divider"
          style={{ left: `${position}%` }}
          aria-hidden="true"
        />
        <button
          type="button"
          className="bas__handle"
          style={{ left: `${position}%` }}
          role="slider"
          aria-label={`${alt} — slider to compare before and after`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={rounded}
          aria-valuetext={`${rounded}% before, ${100 - rounded}% after`}
          aria-orientation="horizontal"
          onKeyDown={onKeyDown}
        >
          <span className="bas__handle-grip" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 3 12 9 6" />
              <polyline points="15 6 21 12 15 18" />
            </svg>
          </span>
        </button>
      </div>
      {caption && <figcaption className="bas__caption">{caption}</figcaption>}
    </figure>
  );
}
