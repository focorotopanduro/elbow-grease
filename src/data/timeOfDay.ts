/**
 * Time-of-Day palette presets — each preset re-tints the entire scene
 * (sky, sun position, ambient fill light, wall warm-shift, stars, interior
 * glow) without touching any geometry.
 *
 * Storm intensity is INDEPENDENT — a Cat 5 hurricane at sunset still looks
 * like sunset, just darker. The cascade physics is unchanged.
 */

export type TimeOfDayId = 'dawn' | 'midday' | 'dusk' | 'night';

export interface TimeOfDay {
  id: TimeOfDayId;
  label: string;
  /** Sky gradient (calm-day endpoints; storm darkens these) */
  skyTopCalm: [number, number, number];
  skyMidCalm: [number, number, number];
  skyHorizonCalm: [number, number, number];
  /** Storm-end sky (lerped to with `storm` intensity) */
  skyTopStorm: [number, number, number];
  skyMidStorm: [number, number, number];
  skyHorizonStorm: [number, number, number];
  /** Sun (or moon at night) position on the SVG canvas */
  sunX: number;
  sunY: number;
  /** Sun core + halo colors */
  sunCore: string;
  sunHalo: string;
  /** Multiplier on calm to get final sunOpacity (sun is dimmer at dusk/night) */
  sunOpacityMul: number;
  /** Warm fill-light tone — bounces up from the ground onto walls */
  ambientFill: string;
  /** Wall color warm-shift (added on top of theme wall colors) */
  wallTintCalm: [number, number, number];
  wallTintStorm: [number, number, number];
  /** Strength of the wall tint (0 = no shift, 1 = full TOD recolor) */
  wallTintStrength: number;
  /** Night-only: dark sky with stars + interior window glow */
  isDark: boolean;
  starOpacity: number;
  interiorGlowOpacity: number;
  /** Horizon line color (treeline silhouette) */
  horizonColor: [number, number, number];
}

export const TIME_OF_DAY: Record<TimeOfDayId, TimeOfDay> = {
  dawn: {
    id: 'dawn',
    label: 'Dawn',
    skyTopCalm: [120, 96, 130],
    skyMidCalm: [228, 158, 110],
    skyHorizonCalm: [255, 196, 138],
    skyTopStorm: [40, 28, 50],
    skyMidStorm: [88, 50, 48],
    skyHorizonStorm: [120, 70, 56],
    sunX: 680, sunY: 150,
    sunCore: 'rgba(255, 198, 140, 1)',
    sunHalo: 'rgba(255, 168, 100, 1)',
    sunOpacityMul: 0.78,
    ambientFill: 'rgba(255, 180, 120, 0.55)',
    wallTintCalm: [255, 198, 150],
    wallTintStorm: [180, 130, 100],
    wallTintStrength: 0.35,
    isDark: false,
    starOpacity: 0,
    interiorGlowOpacity: 0.25,
    horizonColor: [120, 70, 70],
  },
  midday: {
    id: 'midday',
    label: 'Midday',
    skyTopCalm: [54, 64, 88],
    skyMidCalm: [86, 96, 110],
    skyHorizonCalm: [196, 156, 124],
    skyTopStorm: [16, 14, 20],
    skyMidStorm: [28, 24, 30],
    skyHorizonStorm: [48, 40, 42],
    sunX: 640, sunY: 80,
    sunCore: 'rgba(255, 230, 180, 1)',
    sunHalo: 'rgba(255, 200, 130, 1)',
    sunOpacityMul: 0.85,
    ambientFill: 'rgba(255, 220, 165, 0.30)',
    wallTintCalm: [255, 250, 235],
    wallTintStorm: [220, 200, 180],
    wallTintStrength: 0,
    isDark: false,
    starOpacity: 0,
    interiorGlowOpacity: 0,
    horizonColor: [72, 60, 56],
  },
  dusk: {
    id: 'dusk',
    label: 'Dusk',
    skyTopCalm: [86, 50, 96],
    skyMidCalm: [200, 108, 88],
    skyHorizonCalm: [255, 138, 88],
    skyTopStorm: [30, 20, 40],
    skyMidStorm: [78, 42, 44],
    skyHorizonStorm: [120, 60, 50],
    sunX: 200, sunY: 130,
    sunCore: 'rgba(255, 152, 92, 1)',
    sunHalo: 'rgba(255, 122, 72, 1)',
    sunOpacityMul: 0.70,
    ambientFill: 'rgba(255, 140, 90, 0.50)',
    wallTintCalm: [255, 168, 128],
    wallTintStorm: [180, 110, 90],
    wallTintStrength: 0.40,
    isDark: false,
    starOpacity: 0.18,
    interiorGlowOpacity: 0.55,
    horizonColor: [110, 50, 50],
  },
  night: {
    id: 'night',
    label: 'Night',
    skyTopCalm: [10, 14, 30],
    skyMidCalm: [22, 28, 52],
    skyHorizonCalm: [38, 42, 68],
    skyTopStorm: [4, 6, 14],
    skyMidStorm: [10, 14, 28],
    skyHorizonStorm: [18, 22, 36],
    sunX: 500, sunY: 80,
    sunCore: 'rgba(232, 240, 255, 1)',
    sunHalo: 'rgba(180, 200, 240, 1)',
    sunOpacityMul: 0.45,
    ambientFill: 'rgba(70, 90, 130, 0.45)',
    wallTintCalm: [60, 80, 120],
    wallTintStorm: [30, 40, 70],
    wallTintStrength: 0.55,
    isDark: true,
    starOpacity: 0.85,
    interiorGlowOpacity: 0.92,
    horizonColor: [22, 28, 50],
  },
};

export const DEFAULT_TIME_OF_DAY: TimeOfDayId = 'midday';

export function getTimeOfDay(id: TimeOfDayId): TimeOfDay {
  return TIME_OF_DAY[id] ?? TIME_OF_DAY[DEFAULT_TIME_OF_DAY];
}
