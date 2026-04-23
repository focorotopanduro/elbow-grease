/**
 * InteractiveButton — smoke tests for the shared button wrapper.
 *
 * The underlying hook has full coverage in `useInteractiveButton.spec`.
 * This file verifies that the wrapper:
 *
 *   1. Renders a native <button> with caller-provided children + style.
 *   2. Applies the press-scale on mousedown and releases on mouseup.
 *   3. Applies the focus-ring on focus and clears on blur.
 *   4. Drag-off during press releases the scale (hook-level behavior
 *      propagating through).
 *   5. Accepts arbitrary native button props (onClick, title, etc.).
 *   6. Caller's style is preserved alongside the interaction overlay.
 *   7. `focusRingColor` + `pressScale` overrides land in the output.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { InteractiveButton } from '../InteractiveButton';

afterEach(() => {
  cleanup();
});

describe('InteractiveButton — rendering', () => {
  it('renders children inside a native <button>', () => {
    const { getByRole } = render(
      <InteractiveButton>Click me</InteractiveButton>,
    );
    const btn = getByRole('button');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe('Click me');
  });

  it('preserves caller-provided inline style alongside the interaction overlay', () => {
    const { getByRole } = render(
      <InteractiveButton style={{ background: 'red', padding: 8 }}>x</InteractiveButton>,
    );
    const btn = getByRole('button') as HTMLButtonElement;
    expect(btn.style.background).toBe('red');
    expect(btn.style.padding).toBe('8px');
    // Default rest-state scale + no focus ring.
    expect(btn.style.transform).toBe('scale(1)');
    expect(btn.style.boxShadow).toBe('none');
    expect(btn.style.outline).toBe('none');
  });
});

describe('InteractiveButton — press feedback', () => {
  it('mousedown applies the default 0.96 press-scale', () => {
    const { getByRole } = render(<InteractiveButton>x</InteractiveButton>);
    const btn = getByRole('button') as HTMLButtonElement;
    fireEvent.mouseDown(btn);
    expect(btn.style.transform).toBe('scale(0.96)');
  });

  it('mouseup releases the press-scale', () => {
    const { getByRole } = render(<InteractiveButton>x</InteractiveButton>);
    const btn = getByRole('button') as HTMLButtonElement;
    fireEvent.mouseDown(btn);
    fireEvent.mouseUp(btn);
    expect(btn.style.transform).toBe('scale(1)');
  });

  it('drag-off during press releases the scale (hook-level behavior)', () => {
    const { getByRole } = render(<InteractiveButton>x</InteractiveButton>);
    const btn = getByRole('button') as HTMLButtonElement;
    fireEvent.mouseEnter(btn);
    fireEvent.mouseDown(btn);
    expect(btn.style.transform).toBe('scale(0.96)');
    fireEvent.mouseLeave(btn);
    expect(btn.style.transform).toBe('scale(1)');
  });

  it('honors pressScale prop override', () => {
    const { getByRole } = render(
      <InteractiveButton pressScale={0.9}>x</InteractiveButton>,
    );
    const btn = getByRole('button') as HTMLButtonElement;
    fireEvent.mouseDown(btn);
    expect(btn.style.transform).toBe('scale(0.9)');
  });
});

describe('InteractiveButton — focus ring', () => {
  it('focus applies the default white focus ring', () => {
    const { getByRole } = render(<InteractiveButton>x</InteractiveButton>);
    const btn = getByRole('button') as HTMLButtonElement;
    fireEvent.focus(btn);
    expect(btn.style.boxShadow).toMatch(/rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*0\.6\s*\)/);
  });

  it('blur clears the focus ring', () => {
    const { getByRole } = render(<InteractiveButton>x</InteractiveButton>);
    const btn = getByRole('button') as HTMLButtonElement;
    fireEvent.focus(btn);
    fireEvent.blur(btn);
    expect(btn.style.boxShadow).toBe('none');
  });

  it('honors focusRingColor prop override', () => {
    const { getByRole } = render(
      <InteractiveButton focusRingColor="rgb(255, 0, 0)">x</InteractiveButton>,
    );
    const btn = getByRole('button') as HTMLButtonElement;
    fireEvent.focus(btn);
    expect(btn.style.boxShadow).toBe('0 0 0 2px rgb(255, 0, 0)');
  });
});

describe('InteractiveButton — passthrough', () => {
  it('onClick prop fires on click', () => {
    const onClick = vi.fn();
    const { getByRole } = render(
      <InteractiveButton onClick={onClick}>x</InteractiveButton>,
    );
    fireEvent.click(getByRole('button'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('title, aria-label, and disabled props pass through', () => {
    const { getByRole } = render(
      <InteractiveButton
        title="A tooltip"
        aria-label="semantic label"
        disabled
      >
        x
      </InteractiveButton>,
    );
    const btn = getByRole('button') as HTMLButtonElement;
    expect(btn.getAttribute('title')).toBe('A tooltip');
    expect(btn.getAttribute('aria-label')).toBe('semantic label');
    expect(btn.disabled).toBe(true);
  });

  it('onDoubleClick still fires (used by LayerPanel solo-toggle)', () => {
    const onDoubleClick = vi.fn();
    const { getByRole } = render(
      <InteractiveButton onDoubleClick={onDoubleClick}>x</InteractiveButton>,
    );
    fireEvent.doubleClick(getByRole('button'));
    expect(onDoubleClick).toHaveBeenCalledOnce();
  });
});
