/**
 * roofingCalibrationStore — Phase 14.R.5 tests.
 *
 * Covers the four calibration-mode transitions:
 *   idle → calibrate-1 → calibrate-2 → enter-distance → idle
 * plus the reset-from-any-step guarantee.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useRoofingCalibrationStore } from '../roofingCalibrationStore';

beforeEach(() => {
  useRoofingCalibrationStore.setState({
    mode: 'idle',
    firstPoint: null,
    secondPoint: null,
  });
});

describe('mode progression', () => {
  it('defaults to idle with no anchors', () => {
    const s = useRoofingCalibrationStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.firstPoint).toBeNull();
    expect(s.secondPoint).toBeNull();
  });

  it('beginCalibrate → calibrate-1 with cleared anchors', () => {
    // Stuff stale state in first to confirm the begin() clears it.
    useRoofingCalibrationStore.setState({
      firstPoint: [1, 1],
      secondPoint: [2, 2],
    });
    useRoofingCalibrationStore.getState().beginCalibrate();
    const s = useRoofingCalibrationStore.getState();
    expect(s.mode).toBe('calibrate-1');
    expect(s.firstPoint).toBeNull();
    expect(s.secondPoint).toBeNull();
  });

  it('setFirstPoint advances to calibrate-2', () => {
    useRoofingCalibrationStore.getState().beginCalibrate();
    useRoofingCalibrationStore.getState().setFirstPoint([3, 4]);
    const s = useRoofingCalibrationStore.getState();
    expect(s.mode).toBe('calibrate-2');
    expect(s.firstPoint).toEqual([3, 4]);
    expect(s.secondPoint).toBeNull();
  });

  it('setSecondPoint advances to enter-distance', () => {
    useRoofingCalibrationStore.getState().beginCalibrate();
    useRoofingCalibrationStore.getState().setFirstPoint([0, 0]);
    useRoofingCalibrationStore.getState().setSecondPoint([10, 0]);
    const s = useRoofingCalibrationStore.getState();
    expect(s.mode).toBe('enter-distance');
    expect(s.firstPoint).toEqual([0, 0]);
    expect(s.secondPoint).toEqual([10, 0]);
  });
});

describe('reset() from any step', () => {
  it('from calibrate-1', () => {
    useRoofingCalibrationStore.getState().beginCalibrate();
    useRoofingCalibrationStore.getState().reset();
    expect(useRoofingCalibrationStore.getState().mode).toBe('idle');
  });

  it('from calibrate-2', () => {
    useRoofingCalibrationStore.getState().beginCalibrate();
    useRoofingCalibrationStore.getState().setFirstPoint([1, 1]);
    useRoofingCalibrationStore.getState().reset();
    const s = useRoofingCalibrationStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.firstPoint).toBeNull();
  });

  it('from enter-distance', () => {
    useRoofingCalibrationStore.getState().beginCalibrate();
    useRoofingCalibrationStore.getState().setFirstPoint([0, 0]);
    useRoofingCalibrationStore.getState().setSecondPoint([1, 1]);
    useRoofingCalibrationStore.getState().reset();
    const s = useRoofingCalibrationStore.getState();
    expect(s.mode).toBe('idle');
    expect(s.firstPoint).toBeNull();
    expect(s.secondPoint).toBeNull();
  });
});
