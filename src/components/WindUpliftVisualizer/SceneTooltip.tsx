import { useEffect, useState } from 'react';
import { ELEMENT_LABELS } from '../../data/elementLabels';
import type { CascadeResult } from '../../physics/cascade';

interface Props {
  /** Active label id (which element is being hovered). null = hide. */
  activeId: string | null;
  /** Cursor X in viewport coordinates */
  x: number;
  /** Cursor Y in viewport coordinates */
  y: number;
  /** Cascade result (drives dynamic state per label) */
  cascade: CascadeResult;
  /** Current wind speed (drives dynamic state for some labels) */
  windSpeed: number;
}

/**
 * SceneTooltip — floating educational card that follows the cursor when
 * Labels mode is on and the user is hovering a `[data-label]` element.
 *
 * Position auto-flips near the right + bottom edges of the viewport so the
 * card never gets clipped. Always offset by 14px from the cursor so it
 * doesn't sit ON the pointed element.
 *
 * Renders nothing when `activeId` is null. Each label may surface a live
 * dynamic-state line (e.g., "fluttering loose at 95 mph") computed from
 * the cascade result.
 */
const TOOLTIP_W = 248;   // matches CSS max-width
const TOOLTIP_H_EST = 110;

export default function SceneTooltip({ activeId, x, y, cascade, windSpeed }: Props) {
  // Track viewport dims for edge-flip math
  const [vp, setVp] = useState(() => ({
    w: typeof window !== 'undefined' ? window.innerWidth : 1024,
    h: typeof window !== 'undefined' ? window.innerHeight : 768,
  }));

  useEffect(() => {
    const onResize = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!activeId) return null;
  const label = ELEMENT_LABELS[activeId];
  if (!label) return null;

  // Edge-flip: if the tooltip would overflow, anchor on the opposite side
  const flipX = x + 14 + TOOLTIP_W > vp.w;
  const flipY = y + TOOLTIP_H_EST > vp.h;
  const left = flipX ? x - 14 - TOOLTIP_W : x + 14;
  const top  = flipY ? y - TOOLTIP_H_EST - 8 : y + 8;

  const dynamic = label.dynamicState?.(cascade, windSpeed);

  return (
    <div
      className="scene-tooltip"
      role="tooltip"
      style={{ left: `${left}px`, top: `${top}px` }}
    >
      <header className="scene-tooltip__head">
        <span className="scene-tooltip__name">{label.name}</span>
        {dynamic && (
          <span className={`scene-tooltip__state ${
            /(GONE|TORN|CRITICAL|DOWN|SNAPPED|CATASTROPHIC|BUCKLING)/i.test(dynamic) ? 'is-danger'
            : /(intact|covered|normal|open)/i.test(dynamic) ? 'is-ok'
            : 'is-warn'
          }`}>
            {dynamic}
          </span>
        )}
      </header>
      <p className="scene-tooltip__desc">{label.description}</p>
      {label.codeRef && (
        <div className="scene-tooltip__code">{label.codeRef}</div>
      )}
    </div>
  );
}
