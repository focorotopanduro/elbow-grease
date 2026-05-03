// @vitest-environment jsdom
/**
 * SceneElement — contract tests.
 *
 * Locks the SVG-fallback / PNG-override decision logic. The component
 * is the keystone of the artist round-trip: paint a PNG → manifest gets
 * the entry → runtime swaps the SVG <use> for an <image> overlay.
 *
 * If any of these tests regress:
 *   • The artist's painted PNGs would stop showing (raster path broken)
 *   • OR the SVG fallback would stop showing for unpainted elements
 *     (default scene visually breaks)
 *
 * Either way the visualizer ships visibly broken to the user, so these
 * tests are worth the boilerplate.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { setRasterMode } from './useRasterMode';

// Mock the auto-generated manifest BEFORE importing SceneElement so
// the component picks up our test fixtures rather than the live
// scene-manifest.ts (which would change between test runs as the
// artist edits PNGs).
vi.mock('../../../data/scene-manifest', () => ({
  SCENE_RASTER_INDEX: {
    'foreground/painted-element': {
      category: 'foreground',
      name: 'painted-element',
      href: '/images/scene/foreground/painted-element.png',
    },
    'sky/cloud-bg-1': {
      category: 'sky',
      name: 'cloud-bg-1',
      href: '/images/scene/sky/cloud-bg-1.png',
    },
  },
  hasRaster: (cat: string, name: string) =>
    `${cat}/${name}` in {
      'foreground/painted-element': true,
      'sky/cloud-bg-1': true,
    },
}));

import { SceneElement } from './SceneElement';

/** Helper — render the component inside a real <svg> root since
 *  <use>/<image> are SVG-only elements. */
function renderInSvg(node: React.ReactNode) {
  return render(<svg xmlns="http://www.w3.org/2000/svg">{node}</svg>);
}

describe('SceneElement — raster mode (manifest entry exists)', () => {
  it('renders <image> instead of <use> when the id is registered', () => {
    const { container } = renderInSvg(
      <SceneElement
        id="foreground/painted-element"
        symbolHref="#rh-fake"
        x={10} y={20} w={50} h={60}
      />,
    );
    expect(container.querySelector('image')).not.toBeNull();
    expect(container.querySelector('use')).toBeNull();
  });

  it('uses the manifest href, not the symbolHref, for the image', () => {
    const { container } = renderInSvg(
      <SceneElement
        id="foreground/painted-element"
        symbolHref="#rh-completely-different"
        x={0} y={0} w={1} h={1}
      />,
    );
    const img = container.querySelector('image');
    expect(img?.getAttribute('href')).toBe('/images/scene/foreground/painted-element.png');
  });

  it('renders <image> at full canvas (800×480) regardless of element bbox', () => {
    // Even a tiny element (e.g. hibiscus 9×9 in scene coords) gets a
    // full-canvas overlay. The painted PNG itself has the element
    // positioned correctly within that canvas; resizing the <image>
    // to the element bbox would mis-position the painted pixels.
    const { container } = renderInSvg(
      <SceneElement
        id="foreground/painted-element"
        symbolHref="#rh-fake"
        x={304} y={416} w={9} h={9}
      />,
    );
    const img = container.querySelector('image')!;
    expect(img.getAttribute('width')).toBe('800');
    expect(img.getAttribute('height')).toBe('480');
    expect(img.getAttribute('x')).toBe('0');
    expect(img.getAttribute('y')).toBe('0');
  });

  it('preserves aspect ratio so the painted element stays at the right scene position', () => {
    // xMidYMid meet keeps the artist's canvas centered + uniformly
    // scaled when the SVG viewport is non-1:1. Without it, the painted
    // element would stretch + drift off its scene anchor.
    const { container } = renderInSvg(
      <SceneElement
        id="foreground/painted-element"
        symbolHref="#rh-fake"
        x={0} y={0} w={1} h={1}
      />,
    );
    expect(container.querySelector('image')?.getAttribute('preserveAspectRatio'))
      .toBe('xMidYMid meet');
  });

  it('passes className + style through to the <image>', () => {
    const { container } = renderInSvg(
      <SceneElement
        id="foreground/painted-element"
        symbolHref="#rh-fake"
        x={0} y={0} w={1} h={1}
        className="rh-test-class"
        style={{ opacity: 0.5 }}
      />,
    );
    const img = container.querySelector('image')!;
    expect(img.getAttribute('class')).toBe('rh-test-class');
    expect(img.getAttribute('style')).toContain('opacity: 0.5');
  });
});

describe('SceneElement — SVG fallback (no manifest entry)', () => {
  it('renders <use> at the canonical position when the id is not registered', () => {
    const { container } = renderInSvg(
      <SceneElement
        id="foreground/no-png-here-yet"
        symbolHref="#rh-bush"
        x={290} y={406} w={80} h={32}
      />,
    );
    expect(container.querySelector('use')).not.toBeNull();
    expect(container.querySelector('image')).toBeNull();
  });

  it('places <use> at the exact x/y/w/h passed in', () => {
    const { container } = renderInSvg(
      <SceneElement
        id="foreground/missing"
        symbolHref="#rh-test"
        x={290} y={406} w={80} h={32}
      />,
    );
    const use = container.querySelector('use')!;
    expect(use.getAttribute('href')).toBe('#rh-test');
    expect(use.getAttribute('x')).toBe('290');
    expect(use.getAttribute('y')).toBe('406');
    expect(use.getAttribute('width')).toBe('80');
    expect(use.getAttribute('height')).toBe('32');
  });

  it('passes className + style through to the <use>', () => {
    const { container } = renderInSvg(
      <SceneElement
        id="foreground/missing"
        symbolHref="#rh-test"
        x={0} y={0} w={1} h={1}
        className="rh-fallback-class"
        style={{ opacity: 0.7 }}
      />,
    );
    const use = container.querySelector('use')!;
    expect(use.getAttribute('class')).toBe('rh-fallback-class');
    expect(use.getAttribute('style')).toContain('opacity: 0.7');
  });
});

describe('SceneElement — raster-mode toggle (Alt+R / ?raster=off)', () => {
  beforeEach(() => setRasterMode('on'));
  afterEach(() => setRasterMode('on')); // reset between tests

  it('falls back to <use> when toggle is off, even if manifest has the entry', () => {
    setRasterMode('off');
    const { container } = renderInSvg(
      <SceneElement
        id="foreground/painted-element"   // IS in the manifest
        symbolHref="#rh-fallback"
        x={10} y={20} w={50} h={60}
      />,
    );
    // Expect SVG fallback, NOT the painted PNG
    expect(container.querySelector('use')).not.toBeNull();
    expect(container.querySelector('image')).toBeNull();
  });

  it('returns to <image> when toggle flips back on', () => {
    setRasterMode('off');
    const { container, rerender } = renderInSvg(
      <SceneElement
        id="foreground/painted-element"
        symbolHref="#rh-fallback"
        x={0} y={0} w={1} h={1}
      />,
    );
    expect(container.querySelector('use')).not.toBeNull();

    setRasterMode('on');
    rerender(
      <svg xmlns="http://www.w3.org/2000/svg">
        <SceneElement
          id="foreground/painted-element"
          symbolHref="#rh-fallback"
          x={0} y={0} w={1} h={1}
        />
      </svg>,
    );
    expect(container.querySelector('image')).not.toBeNull();
    expect(container.querySelector('use')).toBeNull();
  });

  it('does not affect SVG fallback path (toggle is moot when no manifest entry)', () => {
    setRasterMode('off');
    const { container } = renderInSvg(
      <SceneElement
        id="foreground/no-png-here-at-all"  // NOT in the manifest
        symbolHref="#rh-bush"
        x={0} y={0} w={1} h={1}
      />,
    );
    // Toggle off + no manifest entry → still SVG (only path that makes sense)
    expect(container.querySelector('use')).not.toBeNull();
    expect(container.querySelector('image')).toBeNull();
  });
});

describe('SceneElement — id discrimination', () => {
  it('only matches the exact manifest key (no partial matching)', () => {
    // 'foreground/painted-element' is in the manifest. A partial
    // string like 'painted' should NOT match — we'd get the SVG
    // fallback. Pinning this prevents future code from "helpfully"
    // doing fuzzy matching that could leak the wrong PNG to the wrong
    // element.
    const { container } = renderInSvg(
      <SceneElement
        id="foreground/painted"
        symbolHref="#rh-test"
        x={0} y={0} w={1} h={1}
      />,
    );
    expect(container.querySelector('use')).not.toBeNull();
    expect(container.querySelector('image')).toBeNull();
  });

  it('treats different categories as distinct (foreground/x ≠ background/x)', () => {
    // Same name in different category is a different element. Make
    // sure the resolver respects the full category/name pair.
    const { container } = renderInSvg(
      <SceneElement
        id="background/painted-element"
        symbolHref="#rh-test"
        x={0} y={0} w={1} h={1}
      />,
    );
    // 'background/painted-element' is NOT in the mock manifest;
    // only 'foreground/painted-element' is. Should fall back.
    expect(container.querySelector('use')).not.toBeNull();
    expect(container.querySelector('image')).toBeNull();
  });
});
