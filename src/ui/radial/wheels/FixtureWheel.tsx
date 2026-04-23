/**
 * FIXTURE Wheel — CTRL+F activates this wheel.
 *
 * 10 sectors arranged clockwise starting from 12 o'clock:
 *   1. Toilet        2. Washer         3. Laundry Tub
 *   4. Misc          5. Urinal         6. Water Heater
 *   7. Water Fixtures  8. Shower       9. Tub          10. Lavatory
 *
 * Left-click selects the fixture type and closes the wheel. The next
 * canvas click places that fixture. The CustomerStore determines the
 * specific fixture model dropped (per the active customer profile).
 *
 * Subtypes within each sector are variations (e.g. floor-mount toilet
 * vs wall-hung urinal) cycled via mouse scroll.
 */

import { useMemo } from 'react';
import { RadialMenu, type WheelConfig } from '../RadialMenu';
import { useCustomerStore } from '@store/customerStore';
import type { FixtureSubtype } from '../../../engine/graph/GraphNode';

// ── Fixture categories ──────────────────────────────────────────

interface FixtureSectorDef {
  id: string;
  label: string;
  icon: string;
  color: string;
  subtypes: { id: FixtureSubtype; label: string; icon: string }[];
}

const FIXTURE_CATEGORIES: FixtureSectorDef[] = [
  {
    id: 'toilet',
    label: 'Toilet',
    icon: '🚽',
    color: '#90caf9',
    subtypes: [
      { id: 'water_closet', label: 'Floor-Mount WC', icon: '🚽' },
      { id: 'water_closet', label: 'Wall-Hung WC',   icon: '🚽' },
    ],
  },
  {
    id: 'washer',
    label: 'Washer',
    icon: '🌀',
    color: '#ce93d8',
    subtypes: [
      { id: 'clothes_washer', label: 'Top-Load',   icon: '🌀' },
      { id: 'clothes_washer', label: 'Front-Load', icon: '🌀' },
    ],
  },
  {
    id: 'laundry_tub',
    label: 'Laundry',
    icon: '🧺',
    color: '#b39ddb',
    subtypes: [
      { id: 'laundry_standpipe', label: 'Standpipe',    icon: '🧺' },
      { id: 'laundry_tub',       label: 'Laundry Tub',  icon: '🧺' },
      { id: 'utility_sink',      label: 'Utility Sink', icon: '🪣' },
    ],
  },
  {
    id: 'misc',
    label: 'Misc',
    icon: '🔧',
    color: '#a1887f',
    subtypes: [
      { id: 'hose_bibb',         label: 'Hose Bibb',         icon: '🚿' },
      { id: 'floor_drain',       label: 'Floor Drain',       icon: '⚫' },
      { id: 'drinking_fountain', label: 'Drinking Fountain', icon: '🚰' },
      // Phase 14.Y.2 — DWV access + specialty fixtures
      { id: 'cleanout_access',   label: 'Cleanout',          icon: '🔧' },
      { id: 'bidet',             label: 'Bidet',             icon: '🚻' },
    ],
  },
  {
    id: 'urinal',
    label: 'Urinal',
    icon: '🚹',
    color: '#80cbc4',
    subtypes: [
      { id: 'urinal', label: 'Wall-Hung',  icon: '🚹' },
      { id: 'urinal', label: 'Floor-Mount', icon: '🚹' },
    ],
  },
  {
    id: 'water_heater',
    label: 'WH',
    icon: '🔥',
    color: '#ff7043',
    subtypes: [
      // Phase 14.Y.2 — real water heater subtypes (no more WC placeholder)
      { id: 'water_heater',          label: 'Tank 50gal', icon: '🔥' },
      { id: 'tankless_water_heater', label: 'Tankless',   icon: '⚡' },
      { id: 'expansion_tank',        label: 'Expansion',  icon: '🫧' },
    ],
  },
  {
    id: 'valves',
    label: 'Valves',
    icon: '⚙',
    color: '#ffb74d',
    subtypes: [
      // Phase 14.Y.2 — inline valves
      { id: 'backflow_preventer',      label: 'Backflow', icon: '⛔' },
      { id: 'pressure_reducing_valve', label: 'PRV',      icon: '⚙' },
    ],
  },
  {
    id: 'water_fixtures',
    label: 'Water Fix',
    icon: '🚰',
    color: '#4dd0e1',
    subtypes: [
      { id: 'hose_bibb',  label: 'Hose Bibb',  icon: '🚿' },
      { id: 'dishwasher', label: 'Dishwasher', icon: '🍽' },
    ],
  },
  {
    id: 'shower',
    label: 'Shower',
    icon: '🚿',
    color: '#4fc3f7',
    subtypes: [
      { id: 'shower', label: 'Standard',  icon: '🚿' },
      { id: 'shower', label: 'Corner',    icon: '🚿' },
      { id: 'shower', label: 'Accessible', icon: '♿' },
    ],
  },
  {
    id: 'tub',
    label: 'Tub',
    icon: '🛁',
    color: '#81d4fa',
    subtypes: [
      { id: 'bathtub', label: 'Alcove',       icon: '🛁' },
      { id: 'bathtub', label: 'Freestanding', icon: '🛁' },
      { id: 'bathtub', label: 'Corner',       icon: '🛁' },
    ],
  },
  {
    id: 'lavatory',
    label: 'Lavatory',
    icon: '🧼',
    color: '#aed581',
    subtypes: [
      { id: 'lavatory',     label: 'Drop-In',        icon: '🧼' },
      { id: 'lavatory',     label: 'Pedestal',       icon: '🧼' },
      { id: 'lavatory',     label: 'Wall-Hung',      icon: '🧼' },
      { id: 'kitchen_sink', label: 'Kitchen Sink',    icon: '🍴' },
    ],
  },
];

// ── Wheel builder ───────────────────────────────────────────────

/**
 * Build the FIXTURE wheel. If isEditMode is true, sectors will trigger
 * the parameter editor instead of placing a fixture.
 */
export function getFixtureWheelConfig(isEditMode: boolean = false): WheelConfig {
  const customerStore = useCustomerStore.getState();

  const sliceAngle = (Math.PI * 2) / FIXTURE_CATEGORIES.length;
  const halfSlice = sliceAngle / 2;

  // Start at 12 o'clock (π/2) and go clockwise
  return {
    id: isEditMode ? 'customer_edit' : 'fixture',
    title: isEditMode ? 'EDIT FIXTURE' : 'FIXTURE',
    accentColor: isEditMode ? '#ff1744' : '#ffc107',
    outerRadiusPx: 240,
    innerRadiusPx: 75,
    tapToSelect: true,
    sectors: FIXTURE_CATEGORIES.map((cat, i) => ({
      id: cat.id,
      label: cat.label,
      icon: cat.icon,
      color: cat.color,
      centerAngleRad: Math.PI / 2 - i * sliceAngle, // clockwise from top
      halfWidthRad: halfSlice - 0.01,
      description: `${cat.subtypes.length} variant${cat.subtypes.length !== 1 ? 's' : ''}`,
      subtypes: cat.subtypes.map((s) => ({ id: s.id + '-' + s.label, label: s.label, icon: s.icon })),
      onSelect: (subtypeIdx) => {
        const subtype = cat.subtypes[subtypeIdx];
        if (!subtype) return;

        if (isEditMode) {
          // Open the parameter editor for this fixture under the active customer
          customerStore.beginEditFixture(subtype.id, subtype.label);
        } else {
          // Stage this fixture for placement on next canvas click
          customerStore.setPendingFixture({
            subtype: subtype.id,
            variant: subtype.label,
            category: cat.id,
          });
        }
      },
    })),
  };
}

export function FixtureWheel() {
  const config = useMemo(() => getFixtureWheelConfig(false), []);
  return <RadialMenu config={config} />;
}

export function CustomerEditWheel() {
  const config = useMemo(() => getFixtureWheelConfig(true), []);
  return <RadialMenu config={config} />;
}
