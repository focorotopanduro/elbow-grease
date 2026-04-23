/**
 * PerfSampler — samples `gl.info` every frame and forwards to PerfStats.
 *
 * Separate from `AdaptiveQuality` because:
 *   • AdaptiveQuality runs regardless of the HUD's visibility and
 *     owns the frame-time ring (which we read from there).
 *   • PerfSampler specifically needs `useThree().gl.info` to fetch
 *     draw-call + triangle counts, and only mounts when the HUD is
 *     requested — no cost when the HUD is off.
 *
 * Mount this INSIDE the `<Canvas>` and conditionally (via the perfHud
 * flag) so it doesn't run when the user isn't looking.
 */

import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { recordRenderInfo } from '@core/perf/PerfStats';
import { useFeatureFlagStore } from '@store/featureFlagStore';

/**
 * Public entry — conditionally mounts the inner sampler only when the
 * HUD is actually on, so useFrame isn't registered during normal use.
 * The flag check is a cheap selector; when it flips the inner sampler
 * mounts/unmounts cleanly.
 */
export function PerfSampler() {
  const enabled = useFeatureFlagStore((s) => s.perfHud);
  if (!enabled) return null;
  return <ActiveSampler />;
}

function ActiveSampler() {
  const { gl } = useThree();

  // Ensure gl.info.autoReset is TRUE (it is by default), so draw call /
  // triangle counts reflect the just-rendered frame rather than a
  // monotonic tally.
  useEffect(() => {
    gl.info.autoReset = true;
    // Reset once on mount so the first sample is clean.
    gl.info.reset();
  }, [gl]);

  useFrame(() => {
    // gl.info.render is populated after each render call. autoReset
    // resets on the NEXT frame's first render, so reading here (in a
    // useFrame that happens after rendering) captures the last frame.
    recordRenderInfo(gl.info.render.calls, gl.info.render.triangles);
  });

  return null;
}
