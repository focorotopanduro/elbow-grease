/**
 * Achievement catalog.
 *
 * Each achievement is a discrete unlock the user earns through interaction.
 * Tier drives the toast color:
 *   bronze = common (most people unlock these)
 *   silver = milestone (notable progression)
 *   gold   = rare (you really engaged with the tool)
 *
 * shareText is what gets baked into the share URL message — Facebook-bait.
 */

export type AchievementId =
  | 'first_gust'
  | 'shutters_slammed'
  | 'lightning_witnessed'
  | 'roof_lost'
  | 'survived_milton'
  | 'survived_ian'
  | 'survived_charley'
  | 'survived_andrew'
  | 'hurricane_pro'
  | 'engineer_mode'
  | 'quiz_complete'
  | 'max_wind';

export type Tier = 'bronze' | 'silver' | 'gold';

export interface Achievement {
  id: AchievementId;
  title: string;
  description: string;
  emoji: string;
  tier: Tier;
  shareText: string;
}

export const ACHIEVEMENTS: Record<AchievementId, Achievement> = {
  first_gust: {
    id: 'first_gust',
    title: 'First Gust',
    description: 'You moved the wind. Welcome to the storm.',
    emoji: '💨',
    tier: 'bronze',
    shareText: 'Just started the Beit Building hurricane visualizer.',
  },
  shutters_slammed: {
    id: 'shutters_slammed',
    title: 'Batten the Hatches',
    description: 'You crossed 140 mph. The hurricane shutters slammed shut.',
    emoji: '🪟',
    tier: 'bronze',
    shareText: 'The hurricane shutters just slammed shut on my Florida ranch.',
  },
  lightning_witnessed: {
    id: 'lightning_witnessed',
    title: 'Lightning Witness',
    description: 'You saw a bolt strike. Crossed 130 mph and the sky cracked.',
    emoji: '⚡',
    tier: 'bronze',
    shareText: 'Saw lightning crack across my virtual roof in the storm.',
  },
  roof_lost: {
    id: 'roof_lost',
    title: 'Total Loss',
    description: 'A sheathing panel tore free. The roof is open to sky.',
    emoji: '🏚️',
    tier: 'silver',
    shareText: 'I lost my roof in the Beit Building hurricane simulator. Try it.',
  },
  survived_milton: {
    id: 'survived_milton',
    title: 'Milton (2024)',
    description: 'You replayed Hurricane Milton. Cat 3 at landfall.',
    emoji: '🌀',
    tier: 'bronze',
    shareText: 'I just replayed Hurricane Milton on my virtual roof.',
  },
  survived_ian: {
    id: 'survived_ian',
    title: 'Ian (2022)',
    description: 'You replayed Hurricane Ian. 140 mph at landfall.',
    emoji: '🌀',
    tier: 'silver',
    shareText: 'I just replayed Hurricane Ian on my virtual roof.',
  },
  survived_charley: {
    id: 'survived_charley',
    title: 'Charley (2004)',
    description: 'You replayed Hurricane Charley — the storm that crossed Orlando.',
    emoji: '🌀',
    tier: 'silver',
    shareText: 'I just relived Charley’s ride across Central Florida.',
  },
  survived_andrew: {
    id: 'survived_andrew',
    title: 'Andrew (1992)',
    description: 'You replayed Andrew at peak — 175 mph. Still the benchmark.',
    emoji: '🌀',
    tier: 'gold',
    shareText: 'I just witnessed Andrew’s 175 mph peak on a Florida roof.',
  },
  hurricane_pro: {
    id: 'hurricane_pro',
    title: 'Hurricane Pro',
    description: 'You replayed every named storm. You know what these things do.',
    emoji: '🏆',
    tier: 'gold',
    shareText: 'I replayed every Florida hurricane on the Beit Building tool.',
  },
  engineer_mode: {
    id: 'engineer_mode',
    title: 'Engineer Mode',
    description: 'You opened the engineering details. Respect the math.',
    emoji: '⚙️',
    tier: 'silver',
    shareText: 'Just dove into the ASCE 7-22 wind-load math on my roof.',
  },
  quiz_complete: {
    id: 'quiz_complete',
    title: 'Know Thy Roof',
    description: 'You answered all three quiz questions about your home.',
    emoji: '🎯',
    tier: 'bronze',
    shareText: 'I just diagnosed my Florida roof in three questions.',
  },
  max_wind: {
    id: 'max_wind',
    title: 'Wind Maximalist',
    description: 'You pushed the slider to 200 mph. Cat 5 territory.',
    emoji: '🔥',
    tier: 'gold',
    shareText: 'I just pushed wind to 200 mph in the visualizer.',
  },
};

export const ACHIEVEMENT_ORDER: AchievementId[] = [
  'first_gust',
  'lightning_witnessed',
  'shutters_slammed',
  'roof_lost',
  'survived_milton',
  'survived_ian',
  'survived_charley',
  'survived_andrew',
  'hurricane_pro',
  'engineer_mode',
  'quiz_complete',
  'max_wind',
];

export const TIER_COLOR: Record<Tier, string> = {
  bronze: '#c45a1a',
  silver: '#9b9492',
  gold: '#d4a04a',
};
