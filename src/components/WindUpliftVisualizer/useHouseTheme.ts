import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_HOUSE_THEME,
  WALL_TONES,
  ROOF_TONES,
  DOOR_COLORS,
  type HouseTheme,
  type WallToneId,
  type RoofToneId,
  type DoorColorId,
} from '../../data/houseThemes';

const STORAGE_KEY = 'wuv:house-theme:v1';

const isWall = (v: string): v is WallToneId => WALL_TONES.some((t) => t.id === v);
const isRoof = (v: string): v is RoofToneId => ROOF_TONES.some((t) => t.id === v);
const isDoor = (v: string): v is DoorColorId => DOOR_COLORS.some((c) => c.id === v);

function readStored(): HouseTheme {
  if (typeof window === 'undefined') return DEFAULT_HOUSE_THEME;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_HOUSE_THEME;
    const parsed = JSON.parse(raw) as Partial<HouseTheme>;
    return {
      wall: parsed.wall && isWall(parsed.wall) ? parsed.wall : DEFAULT_HOUSE_THEME.wall,
      roof: parsed.roof && isRoof(parsed.roof) ? parsed.roof : DEFAULT_HOUSE_THEME.roof,
      door: parsed.door && isDoor(parsed.door) ? parsed.door : DEFAULT_HOUSE_THEME.door,
    };
  } catch {
    return DEFAULT_HOUSE_THEME;
  }
}

/**
 * useHouseTheme — persisted user choice of wall / roof / door palette.
 *
 * Stored in localStorage under `wuv:house-theme:v1` so a homeowner who
 * picks "Coastal White + Terracotta + Gulf Teal" sees the same house when
 * they share the link with their spouse.
 */
export function useHouseTheme() {
  const [theme, setTheme] = useState<HouseTheme>(readStored);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
    } catch { /* private mode / quota */ }
  }, [theme]);

  const setWall = useCallback((id: WallToneId) => setTheme((t) => ({ ...t, wall: id })), []);
  const setRoof = useCallback((id: RoofToneId) => setTheme((t) => ({ ...t, roof: id })), []);
  const setDoor = useCallback((id: DoorColorId) => setTheme((t) => ({ ...t, door: id })), []);
  const reset = useCallback(() => setTheme(DEFAULT_HOUSE_THEME), []);

  return { theme, setWall, setRoof, setDoor, reset };
}
