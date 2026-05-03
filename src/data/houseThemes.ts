/**
 * House theme presets — every visual property a homeowner might recognize on
 * their actual roof. Each preset is a pair of RGB endpoints (calm + storm)
 * plus an accent color, so the lerpRgb storm-darkening logic stays the same.
 *
 * Keep these grounded in real residential palettes for Orlando/Central FL —
 * the goal is a homeowner sees their house, not a cartoon.
 */

export type WallToneId = 'florida_stucco' | 'coastal_white' | 'desert_clay' | 'shadow_gray' | 'dobbin_sage';
export type RoofToneId = 'charcoal_asphalt' | 'weathered_wood' | 'terracotta_tile' | 'forest_slate';
export type DoorColorId = 'mahogany' | 'oxford_blue' | 'gulf_teal' | 'farmhouse_red';

export interface WallTone {
  id: WallToneId;
  label: string;
  /** Top of vertical wall gradient — calm-day */
  topCalm: [number, number, number];
  /** Top of vertical wall gradient — full-storm */
  topStorm: [number, number, number];
  /** Bottom of vertical wall gradient — calm-day */
  botCalm: [number, number, number];
  /** Bottom of vertical wall gradient — full-storm */
  botStorm: [number, number, number];
  /** Trim color (sills, frames) — calm-day */
  trimCalm: [number, number, number];
  /** Trim color (sills, frames) — full-storm */
  trimStorm: [number, number, number];
}

export interface RoofTone {
  id: RoofToneId;
  label: string;
  /** Three-tone shingle palette (light / mid / dark) */
  light: string;
  mid: string;
  dark: string;
  /** Underlying shadow tone (visible between courses) */
  shadow: string;
  /** Highlight along top course edge */
  highlight: string;
}

export interface DoorColor {
  id: DoorColorId;
  label: string;
  fill: string;
  /** Darker outline of recessed panels */
  panelStroke: string;
}

/* ─────────────────────────────────────────────────────────────────────── */

export const WALL_TONES: WallTone[] = [
  {
    id: 'florida_stucco',
    label: 'Florida Stucco',
    topCalm: [232, 215, 188],
    topStorm: [128, 110, 92],
    botCalm: [186, 162, 132],
    botStorm: [80, 68, 56],
    trimCalm: [248, 238, 220],
    trimStorm: [160, 140, 116],
  },
  {
    id: 'coastal_white',
    label: 'Coastal White',
    topCalm: [246, 244, 236],
    topStorm: [148, 144, 136],
    botCalm: [212, 206, 196],
    botStorm: [104, 100, 92],
    trimCalm: [255, 252, 244],
    trimStorm: [180, 170, 156],
  },
  {
    id: 'desert_clay',
    label: 'Desert Clay',
    topCalm: [222, 178, 142],
    topStorm: [120, 92, 70],
    botCalm: [176, 132, 96],
    botStorm: [80, 58, 40],
    trimCalm: [240, 218, 188],
    trimStorm: [148, 124, 98],
  },
  {
    id: 'shadow_gray',
    label: 'Shadow Gray',
    topCalm: [156, 158, 160],
    topStorm: [80, 82, 86],
    botCalm: [110, 112, 116],
    botStorm: [50, 52, 56],
    trimCalm: [196, 198, 200],
    trimStorm: [128, 130, 132],
  },
  {
    // Sandra's actual house at 2703 Dobbin Dr — sage-grey CMU block +
    // stucco with crisp white trim. Reads as the muted Florida ranch
    // green-grey you see all over Central FL.
    id: 'dobbin_sage',
    label: 'Dobbin Sage',
    topCalm: [178, 184, 168],
    topStorm: [98, 104, 92],
    botCalm: [148, 154, 138],
    botStorm: [76, 80, 70],
    trimCalm: [248, 246, 240],   // crisp white trim
    trimStorm: [168, 168, 162],
  },
];

export const ROOF_TONES: RoofTone[] = [
  {
    id: 'charcoal_asphalt',
    label: 'Charcoal Asphalt',
    light: '#3d342a',
    mid: '#352c23',
    dark: '#1c1812',
    shadow: '#0a0908',
    highlight: 'rgba(255, 235, 200, 0.08)',
  },
  {
    id: 'weathered_wood',
    label: 'Weathered Wood',
    light: '#6b5a44',
    mid: '#5a4a36',
    dark: '#2c2418',
    shadow: '#1a1410',
    highlight: 'rgba(255, 232, 196, 0.10)',
  },
  {
    id: 'terracotta_tile',
    label: 'Terracotta Tile',
    light: '#a85a30',
    mid: '#8c4824',
    dark: '#42201c',
    shadow: '#2a1410',
    highlight: 'rgba(255, 220, 180, 0.12)',
  },
  {
    id: 'forest_slate',
    label: 'Forest Slate',
    light: '#324438',
    mid: '#28362c',
    dark: '#141c18',
    shadow: '#0a0c0a',
    highlight: 'rgba(220, 240, 220, 0.08)',
  },
];

export const DOOR_COLORS: DoorColor[] = [
  { id: 'mahogany', label: 'Mahogany', fill: '#3d2818', panelStroke: '#1a1208' },
  { id: 'oxford_blue', label: 'Oxford Blue', fill: '#1c2c44', panelStroke: '#0a1422' },
  { id: 'gulf_teal', label: 'Gulf Teal', fill: '#1c4448', panelStroke: '#0a2226' },
  { id: 'farmhouse_red', label: 'Farmhouse Red', fill: '#6a1c20', panelStroke: '#3a0c10' },
];

export interface HouseTheme {
  wall: WallToneId;
  roof: RoofToneId;
  door: DoorColorId;
}

/* Default theme matches Sandra's real house at 2703 Dobbin Dr —
   sage-grey walls, charcoal asphalt shingles, mahogany front door.
   Visitors who know the area will recognize it as a 32817 Orlando ranch
   even before any geometry adaptation. */
export const DEFAULT_HOUSE_THEME: HouseTheme = {
  wall: 'dobbin_sage',
  roof: 'charcoal_asphalt',
  door: 'mahogany',
};

export function getWallTone(id: WallToneId): WallTone {
  return WALL_TONES.find((t) => t.id === id) ?? WALL_TONES[0];
}
export function getRoofTone(id: RoofToneId): RoofTone {
  return ROOF_TONES.find((t) => t.id === id) ?? ROOF_TONES[0];
}
export function getDoorColor(id: DoorColorId): DoorColor {
  return DOOR_COLORS.find((c) => c.id === id) ?? DOOR_COLORS[0];
}
