import { describe, it, expect } from 'vitest';
import { ACHIEVEMENTS, ACHIEVEMENT_ORDER, TIER_COLOR } from './achievements';

describe('achievement catalog', () => {
  it('every achievement has all required fields', () => {
    Object.values(ACHIEVEMENTS).forEach((a) => {
      expect(a.id).toBeTruthy();
      expect(a.title.length).toBeGreaterThan(0);
      expect(a.description.length).toBeGreaterThan(10);
      expect(a.emoji.length).toBeGreaterThan(0);
      expect(['bronze', 'silver', 'gold']).toContain(a.tier);
      expect(a.shareText.length).toBeGreaterThan(10);
    });
  });

  it('achievement ids are unique', () => {
    const ids = Object.values(ACHIEVEMENTS).map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('order array matches catalog (no orphans)', () => {
    expect(ACHIEVEMENT_ORDER.length).toBe(Object.keys(ACHIEVEMENTS).length);
    ACHIEVEMENT_ORDER.forEach((id) => {
      expect(ACHIEVEMENTS[id]).toBeDefined();
    });
  });

  it('every tier has a color', () => {
    expect(TIER_COLOR.bronze).toBeTruthy();
    expect(TIER_COLOR.silver).toBeTruthy();
    expect(TIER_COLOR.gold).toBeTruthy();
  });

  it('hurricane_pro is gold (it is the meta-achievement)', () => {
    expect(ACHIEVEMENTS.hurricane_pro.tier).toBe('gold');
  });
});
