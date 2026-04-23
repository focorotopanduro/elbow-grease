/**
 * Inspector panel accents — regression tests for the
 * workspace-accent borders added to panels that face the canvas.
 *
 * Pattern:
 *   • Plumbing panels (PipeInspector, LayerPanel) get a 3px
 *     cyan border on the edge that faces the 3D canvas.
 *   • Roofing panel (RoofingInspector) gets a 3px orange border
 *     on its canvas-facing edge.
 *
 * These aren't exhaustive component tests — each panel has its
 * own deep-integration surface. The assertion here is ONLY that
 * the accent border is declared, so a future style-refactor that
 * accidentally drops it trips the spec.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { PipeInspector } from '../PipeInspector';
import { LayerPanel } from '../LayerPanel';
import { APP_MODE_ACCENTS } from '@store/appModeStore';
import { usePipeStore } from '@store/pipeStore';

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

beforeEach(() => {
  // Seed a single pipe + select it so PipeInspector actually
  // renders its panel rather than returning null on no-selection.
  usePipeStore.setState({
    pipes: {
      p1: {
        id: 'p1',
        points: [[0, 0, 0], [5, 0, 0]],
        diameter: 2,
        material: 'pvc_sch40',
        system: 'waste',
        color: '#ef5350',
        visible: true,
        selected: true,
      },
    },
    pipeOrder: ['p1'],
    selectedId: 'p1',
    undoStack: [], redoStack: [], pivotSession: null,
  });
});

afterEach(() => {
  cleanup();
});

describe('PipeInspector — plumbing accent border', () => {
  it('panel root has a 3px cyan left border (canvas-facing edge)', () => {
    const { container } = render(<PipeInspector />);
    const panel = container.firstElementChild as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel!.style.borderLeft).toBe(`3px solid ${hexToRgb(APP_MODE_ACCENTS.plumbing)}`);
  });
});

describe('LayerPanel — plumbing accent border', () => {
  it('panel root has a 3px cyan right border (canvas-facing edge)', () => {
    const { container } = render(<LayerPanel />);
    const panel = container.firstElementChild as HTMLElement | null;
    expect(panel).not.toBeNull();
    expect(panel!.style.borderRight).toBe(`3px solid ${hexToRgb(APP_MODE_ACCENTS.plumbing)}`);
  });
});
