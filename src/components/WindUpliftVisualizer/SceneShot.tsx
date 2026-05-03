import { useState } from 'react';
import { captureSceneToPng } from './effects/captureScene';

interface Props {
  /** Slug-safe context tokens encoded into the filename (e.g. "145mph-night-iso") */
  filenameContext?: string;
}

/**
 * SceneShot — a small camera button that captures the current SVG scene
 * as a PNG and triggers a download. Lives at the bottom-right of the
 * scene (LEFT of the StormReplay pod) so the four canonical corners stay
 * occupied by the four primary HUD pods.
 *
 * UX:
 *   1. Tap the camera → button enters "busy" state (icon → ellipsis)
 *   2. Brief white shutter flash overlays the scene (~380ms)
 *   3. PNG saves with filename like `beit-roof-145mph-night-iso-1714000000000.png`
 *   4. Errors swallowed silently (logged to console) — never break the page
 *
 * Mobile: same behavior; iOS Safari uses native download via the temporary
 * <a download> element. On older Safari versions the file may open in a
 * new tab instead — user long-presses to save.
 */
export default function SceneShot({ filenameContext }: Props) {
  const [busy, setBusy] = useState(false);
  const [flashing, setFlashing] = useState(false);

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    setFlashing(true);
    // Auto-clear flash even if capture fails
    window.setTimeout(() => setFlashing(false), 380);

    try {
      const svg = document.querySelector('.wuv__viz .rh-svg') as SVGSVGElement | null;
      if (!svg) throw new Error('Scene SVG not found in document');
      const ts = Date.now();
      const ctx = filenameContext ? `-${filenameContext}` : '';
      const filename = `beit-roof${ctx}-${ts}.png`;
      await captureSceneToPng({ svg, filename });
    } catch (err) {
      console.error('Scene capture failed:', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`hud-camera ${busy ? 'is-busy' : ''}`}
        onClick={onClick}
        disabled={busy}
        aria-label={busy ? 'Capturing scene…' : 'Save scene as PNG image'}
        title="Save scene as PNG"
      >
        <span className="hud-camera__icon" aria-hidden="true">
          {busy ? (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <circle cx="6" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="18" cy="12" r="2" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              {/* Camera body with shutter */}
              <path d="M9 4l-1.5 2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-2.5L15 4H9z" />
              <circle cx="12" cy="13" r="3.4" fill="#1a1715" />
              <circle cx="12" cy="13" r="2" fill="currentColor" />
            </svg>
          )}
        </span>
      </button>
      {flashing && <div className="scene-flash" aria-hidden="true" />}
    </>
  );
}
