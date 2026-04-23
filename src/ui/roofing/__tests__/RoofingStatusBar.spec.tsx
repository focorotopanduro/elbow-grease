/**
 * RoofingStatusBar tests — domain-scoped status strip for the
 * roofing workspace.
 *
 * Covers:
 *   • Idle baseline renders with no selection, no counts.
 *   • Seeded sections + penetrations surface as counts.
 *   • Active draw mode flips the mode badge label.
 *   • Mid-polygon draw rewrites the hint with vertex count +
 *     "need ≥ 3 to close" until the third vertex lands.
 *   • Selected section shows label + area + slope.
 *   • The orange workspace-accent 2px top border is applied.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { RoofingStatusBar } from '../RoofingStatusBar';
import { useRoofStore } from '@store/roofStore';
import { useRoofingDrawStore } from '@store/roofingDrawStore';
import { APP_MODE_ACCENTS } from '@store/appModeStore';
import { emptyRoofSnapshot } from '@engine/roofing/RoofGraph';

/** jsdom normalises CSS hex colors to `rgb(r, g, b)`. Convert the
 *  APP_MODE_ACCENTS entries so style-attribute assertions work. */
function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

function resetRoofingStores() {
  useRoofStore.setState({
    sections: {}, sectionOrder: [],
    vertices: {}, measures: {},
    layers: emptyRoofSnapshot().layers.map((l) => ({ ...l })),
    pdf: emptyRoofSnapshot().pdf,
    selectedSectionId: null,
    penetrations: {}, penetrationOrder: [],
    undoStack: [], redoStack: [],
    batchDepth: 0, dirtyDuringBatch: false,
  });
  useRoofingDrawStore.setState({
    mode: 'idle',
    draftStart: null,
    draftEnd: null,
    polygonVertices: [],
    penetrationKind: 'plumbing_vent',
  });
}

beforeEach(() => resetRoofingStores());
afterEach(() => cleanup());

describe('RoofingStatusBar — baseline render', () => {
  it('empty scene: IDLE badge + hint, no counts', () => {
    const { container } = render(<RoofingStatusBar />);
    const text = container.textContent ?? '';
    expect(text).toContain('IDLE');
    expect(text).toContain('Pick a tool in the toolbar');
    // Counts show as "N section" or "N penetration" — match the
    // digit-prefixed form so the word "penetration" in the idle-hint
    // text doesn't false-positive.
    expect(text).not.toMatch(/\d+\s+section/);
    expect(text).not.toMatch(/\d+\s+penetration/);
  });

  it('carries the orange workspace-accent 2px top border', () => {
    const { container } = render(<RoofingStatusBar />);
    const bar = container.firstElementChild as HTMLElement | null;
    expect(bar).not.toBeNull();
    expect(bar!.style.borderTop).toBe(`2px solid ${hexToRgb(APP_MODE_ACCENTS.roofing)}`);
  });
});

describe('RoofingStatusBar — counts', () => {
  it('section count only: "3 sections"', () => {
    useRoofStore.getState().addSection({ x: 0, y: 0, length: 10, run: 5 });
    useRoofStore.getState().addSection({ x: 20, y: 0, length: 10, run: 5 });
    useRoofStore.getState().addSection({ x: 40, y: 0, length: 10, run: 5 });

    const { container } = render(<RoofingStatusBar />);
    expect(container.textContent).toContain('3 sections');
    // The IDLE hint itself contains the literal word "penetration"
    // ("…rectangle, polygon, or penetration marker"), so match the
    // digit-prefixed count form instead.
    expect(container.textContent).not.toMatch(/\d+\s+penetration/);
  });

  it('single section prints "1 section" (no plural s)', () => {
    useRoofStore.getState().addSection({ x: 0, y: 0, length: 10, run: 5 });
    const { container } = render(<RoofingStatusBar />);
    expect(container.textContent).toContain('1 section');
    expect(container.textContent).not.toContain('sections');
  });

  it('mixed sections + penetrations format with separator', () => {
    useRoofStore.getState().addSection({ x: 0, y: 0, length: 10, run: 5 });
    useRoofStore.getState().addPenetration({ kind: 'chimney', x: 5, y: 2.5 });
    useRoofStore.getState().addPenetration({ kind: 'skylight', x: 3, y: 1 });

    const { container } = render(<RoofingStatusBar />);
    const text = container.textContent ?? '';
    expect(text).toContain('1 section');
    expect(text).toContain('2 penetrations');
    expect(text).toContain('·'); // separator between counts
  });
});

describe('RoofingStatusBar — draw mode badge', () => {
  it('draw-rect mode shows "DRAW RECT" and a rect-specific hint', () => {
    useRoofingDrawStore.setState({ mode: 'draw-rect' });
    const { container } = render(<RoofingStatusBar />);
    const text = container.textContent ?? '';
    expect(text).toContain('DRAW RECT');
    expect(text).toContain('Click two corners');
  });

  it('draw-polygon mode shows "DRAW POLY" and inlines vertex count when mid-draw', () => {
    useRoofingDrawStore.setState({
      mode: 'draw-polygon',
      polygonVertices: [[0, 0], [5, 0]],
    });
    const { container } = render(<RoofingStatusBar />);
    const text = container.textContent ?? '';
    expect(text).toContain('DRAW POLY');
    expect(text).toContain('2 vertexes placed');
    expect(text).toContain('need ≥ 3 to close');
  });

  it('polygon at 3 vertices flips hint to "Enter or click vertex 1 to close"', () => {
    useRoofingDrawStore.setState({
      mode: 'draw-polygon',
      polygonVertices: [[0, 0], [5, 0], [5, 5]],
    });
    const { container } = render(<RoofingStatusBar />);
    expect(container.textContent).toContain('Enter or click vertex 1 to close');
  });

  it('place-penetration mode shows PLACE badge + the armed kind', () => {
    useRoofingDrawStore.setState({
      mode: 'place-penetration',
      penetrationKind: 'skylight',
    });
    const { container } = render(<RoofingStatusBar />);
    const text = container.textContent ?? '';
    expect(text).toContain('PLACE');
    expect(text).toContain('SKYLIGHT');
    expect(text).toContain('Click on the roof');
  });
});

describe('RoofingStatusBar — selected section readout', () => {
  it('selected section: shows label + sqft + slope', () => {
    const sid = useRoofStore.getState().addSection({
      x: 0, y: 0, length: 40, run: 20, slope: 6, label: 'Main Roof',
    });
    useRoofStore.getState().selectSection(sid);

    const { container } = render(<RoofingStatusBar />);
    const text = container.textContent ?? '';
    expect(text).toContain('Main Roof');
    expect(text).toContain('sqft');
    expect(text).toContain('slope 6:12');
  });

  it('no selection: the selected-section badge is absent', () => {
    useRoofStore.getState().addSection({
      x: 0, y: 0, length: 40, run: 20, label: 'Main Roof',
    });
    // Deliberately DO NOT select.
    const { container } = render(<RoofingStatusBar />);
    expect(container.textContent).not.toContain('Main Roof');
  });
});
