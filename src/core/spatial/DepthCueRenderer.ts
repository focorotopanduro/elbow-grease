/**
 * Depth Cue Configuration — visual parameters that enhance spatial
 * comprehension and reduce visuospatial translation load.
 *
 * Instead of forcing users to mentally decode flat 2D projections,
 * these depth cues provide automatic perceptual grounding:
 *
 *   Atmospheric fog   → distance perception
 *   SSAO              → surface contact / occlusion
 *   Depth-of-field    → focus hierarchy
 *   Edge highlighting → silhouette separation
 *   Grid fade         → ground plane anchoring
 *
 * Values are exported as a config object consumed by the R3F
 * post-processing pipeline in App.tsx.
 */

export interface DepthCueConfig {
  fog: {
    enabled: boolean;
    color: string;
    near: number;   // start distance
    far: number;    // full opacity distance
  };
  ssao: {
    enabled: boolean;
    radius: number;
    intensity: number;
    samples: number;
    rings: number;
  };
  depthOfField: {
    enabled: boolean;
    focusDistance: number;
    focalLength: number;
    bokehScale: number;
  };
  edgeHighlight: {
    enabled: boolean;
    color: string;
    thickness: number;
    threshold: number;
  };
  gridFade: {
    nearOpacity: number;
    farOpacity: number;
    fadeDistance: number;
  };
}

/** Default config tuned for plumbing CAD spatial comprehension. */
export const defaultDepthCues: DepthCueConfig = {
  fog: {
    enabled: true,
    color: '#0a0a0f',
    near: 8,
    far: 35,
  },
  ssao: {
    enabled: true,
    radius: 0.5,
    intensity: 1.5,
    samples: 16,
    rings: 4,
  },
  depthOfField: {
    enabled: false, // off by default, toggled by user or VR focus
    focusDistance: 5,
    focalLength: 0.02,
    bokehScale: 2,
  },
  edgeHighlight: {
    enabled: true,
    color: '#ffffff',
    thickness: 1,
    threshold: 0.1,
  },
  gridFade: {
    nearOpacity: 0.4,
    farOpacity: 0.0,
    fadeDistance: 20,
  },
};

/**
 * Adapt depth cues for VR (wider fog range, no DOF since HMD handles it).
 */
export function vrDepthCues(): DepthCueConfig {
  return {
    ...defaultDepthCues,
    fog: { ...defaultDepthCues.fog, near: 15, far: 60 },
    depthOfField: { ...defaultDepthCues.depthOfField, enabled: false },
    ssao: { ...defaultDepthCues.ssao, samples: 8 }, // perf budget
  };
}

/**
 * Adapt for AR passthrough (no fog, lighter SSAO, stronger edges).
 */
export function arDepthCues(): DepthCueConfig {
  return {
    ...defaultDepthCues,
    fog: { ...defaultDepthCues.fog, enabled: false },
    ssao: { ...defaultDepthCues.ssao, intensity: 0.8, samples: 8 },
    edgeHighlight: { ...defaultDepthCues.edgeHighlight, thickness: 2 },
  };
}
