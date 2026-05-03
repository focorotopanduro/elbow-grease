/**
 * captureScene — serialize a live SVG element into a PNG file and trigger a
 * browser download. Used by SceneShot to give homeowners + contractors a
 * one-tap "save the moment" affordance.
 *
 * Pipeline:
 *   1. Clone the live SVG (so we don't disturb running animations)
 *   2. Set explicit width/height on the clone (the original uses CSS sizing)
 *   3. Serialize via XMLSerializer
 *   4. Wrap in a Blob → object URL → load into <img>
 *   5. Draw the image to an offscreen <canvas>
 *   6. canvas.toBlob → download via temporary <a download>
 *
 * Mobile Safari quirks handled:
 *   - SVG must declare xmlns explicitly when loaded standalone (not inline)
 *   - canvas.toBlob may be missing → fall back to canvas.toDataURL
 *   - URL.createObjectURL may not be revocable instantly → defer revoke
 */

export interface CaptureOpts {
  /** Live SVG element to capture */
  svg: SVGSVGElement;
  /** Output width in pixels (defaults to 2× viewBox width for retina) */
  width?: number;
  /** Output height in pixels (defaults to 2× viewBox height for retina) */
  height?: number;
  /** PNG filename (no extension required; .png appended if missing) */
  filename?: string;
  /** Background color painted under the SVG (defaults to scene's dark navy) */
  background?: string;
}

const DEFAULT_BG = '#1a1715';

/**
 * Trigger a browser download of `blob` with the given filename.
 * Uses a temporary anchor element + click. Cleans up after itself.
 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Defer revoke so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Convert a data URL (base64 PNG) into a Blob. Used as fallback when
 * canvas.toBlob is unavailable (older mobile Safari).
 */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',');
  const mime = head.match(/:(.*?);/)?.[1] ?? 'image/png';
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

export async function captureSceneToPng(opts: CaptureOpts): Promise<void> {
  const { svg, filename = 'scene.png', background = DEFAULT_BG } = opts;

  // Default output to 2× the SVG's viewBox for retina-crisp PNGs
  const viewBox = svg.getAttribute('viewBox')?.split(/\s+/).map(Number) ?? [0, 0, 800, 480];
  const vbW = viewBox[2] || 800;
  const vbH = viewBox[3] || 480;
  const outW = opts.width ?? vbW * 2;
  const outH = opts.height ?? vbH * 2;

  // Clone deeply so animations on the live SVG aren't disturbed
  const clone = svg.cloneNode(true) as SVGSVGElement;

  // Strip CSS animations / transitions on the clone so the captured frame is
  // exactly what was on screen at click time (browsers serialize the current
  // computed transform; animation classes would re-apply post-render).
  // We don't actually inline computed styles here — the static fills/strokes
  // already in the SVG markup carry the visual; transitions can stay.

  // Explicit dimensions + namespace are required for standalone load
  clone.setAttribute('width', String(outW));
  clone.setAttribute('height', String(outH));
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!clone.getAttribute('xmlns:xlink')) {
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  }

  // Serialize → Blob → object URL
  const svgString = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = outW;
          canvas.height = outH;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('canvas 2d context unavailable'));
            return;
          }
          // Paint background first so the PNG isn't transparent
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, outW, outH);
          ctx.drawImage(img, 0, 0, outW, outH);

          // Prefer toBlob (smaller memory) → fall back to toDataURL
          if (typeof canvas.toBlob === 'function') {
            canvas.toBlob(
              (blob) => {
                if (!blob) {
                  reject(new Error('canvas.toBlob returned null'));
                  return;
                }
                triggerDownload(blob, filename);
                resolve();
              },
              'image/png',
              0.95,
            );
          } else {
            const dataUrl = canvas.toDataURL('image/png', 0.95);
            triggerDownload(dataUrlToBlob(dataUrl), filename);
            resolve();
          }
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('SVG image failed to load (likely tainted by external resource)'));
      img.src = svgUrl;
    });
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
