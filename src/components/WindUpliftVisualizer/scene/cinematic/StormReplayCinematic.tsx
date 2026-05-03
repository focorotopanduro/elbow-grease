import { useEffect, useState } from 'react';
import { FRAMES, FRAME_COUNT, HOLD_FINAL_SECONDS, FADE_MS } from './frames';
import { useReducedMotion } from '../../effects/useReducedMotion';

/**
 * StormReplayCinematic — photorealistic Blender flipbook overlay that
 * plays during the storm replay.
 *
 * Renders ONLY when:
 *   - the replay is currently playing,
 *   - the frames have all preloaded successfully,
 *   - the user has not requested reduced motion.
 *
 * If any frame fails to load (404, decode error), the component renders
 * nothing and the SVG cascade animation plays as it always has — no UI
 * regression, just a missing photoreal punctuation.
 *
 * Loaded lazily by the parent (React.lazy + Suspense) so the WebP fetch
 * never starts until the user actually hits "Play hurricane". Cold-start
 * page TTI is unchanged.
 */
interface Props {
  /** 0–1 from useStormReplay — drives which frame is shown */
  progress: number;
  /** Whether the replay is currently playing (for fade in/out timing) */
  isPlaying: boolean;
}

type LoadState = 'loading' | 'ready' | 'unavailable';

function preloadAll(srcs: string[]): Promise<void> {
  return Promise.all(
    srcs.map(
      (src) =>
        new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => reject(new Error(`failed to load ${src}`));
          img.src = src;
        }),
    ),
  ).then(() => undefined);
}

export default function StormReplayCinematic({ progress, isPlaying }: Props) {
  const reduced = useReducedMotion();
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let cancelled = false;
    preloadAll(FRAMES)
      .then(() => {
        if (!cancelled) setState('ready');
      })
      .catch(() => {
        if (!cancelled) setState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Don't render anything during load OR if frames aren't available OR if
  // user opted out of motion. The SVG cascade is the canonical source of
  // truth — this is just photoreal punctuation when assets are present.
  if (reduced || state !== 'ready' || !isPlaying) return null;

  // Map progress (0..1) to a frame index + sub-progress for crossfade
  const totalSlots = FRAME_COUNT - 1; // intervals between frames
  const slot = Math.min(totalSlots, progress * totalSlots);
  const frameIdx = Math.min(FRAME_COUNT - 1, Math.floor(slot));
  const nextIdx = Math.min(FRAME_COUNT - 1, frameIdx + 1);
  const subProgress = slot - frameIdx;

  return (
    <div
      className="src-cinematic"
      aria-hidden="true"
      style={{
        ['--src-fade-ms' as never]: `${FADE_MS}ms`,
      }}
    >
      <img
        src={FRAMES[frameIdx]}
        alt=""
        className="src-cinematic__frame"
        style={{ opacity: 1 - subProgress }}
      />
      <img
        src={FRAMES[nextIdx]}
        alt=""
        className="src-cinematic__frame"
        style={{ opacity: subProgress }}
      />
      {/* The "hold final frame" effect is handled by useStormReplay
          ramping progress to 1 and staying there for HOLD_FINAL_SECONDS
          before signalling isPlaying=false. We don't need anything extra
          here — the last frame is already shown at full opacity. */}
      <span hidden>{HOLD_FINAL_SECONDS}</span>
    </div>
  );
}
