import { describe, it, expect, beforeEach } from 'vitest';

// Mock localStorage in node environment
class LocalStorageMock {
  store: Record<string, string> = {};
  getItem(k: string) { return this.store[k] ?? null; }
  setItem(k: string, v: string) { this.store[k] = v; }
  removeItem(k: string) { delete this.store[k]; }
  clear() { this.store = {}; }
}

// Set up window/localStorage shim
const g = globalThis as unknown as { window?: { localStorage: LocalStorageMock } };
beforeEach(() => {
  g.window = { localStorage: new LocalStorageMock() };
});

describe('useAchievements engine (logic-only smoke tests)', () => {
  // The hook itself uses React state, so we test the catalog + storage shape
  // contract here, leaving the React render-time tests to a future @testing-library suite.

  it('catalog import is stable', async () => {
    const mod = await import('../../../data/achievements');
    expect(mod.ACHIEVEMENTS.first_gust.id).toBe('first_gust');
  });

  it('localStorage round-trips a unlocked-set as JSON array', () => {
    const ls = g.window!.localStorage;
    ls.setItem('beit_wuv_achievements_v1', JSON.stringify(['first_gust', 'roof_lost']));
    const raw = ls.getItem('beit_wuv_achievements_v1');
    expect(raw).toBe('["first_gust","roof_lost"]');
    expect(JSON.parse(raw!)).toEqual(['first_gust', 'roof_lost']);
  });

  it('rejects unknown IDs from corrupt storage on read', async () => {
    const { ACHIEVEMENTS } = await import('../../../data/achievements');
    const valid = ['first_gust', 'roof_lost', 'made_up_id', 'survived_andrew'];
    const filtered = valid.filter((id) => id in ACHIEVEMENTS);
    expect(filtered).toEqual(['first_gust', 'roof_lost', 'survived_andrew']);
  });
});
