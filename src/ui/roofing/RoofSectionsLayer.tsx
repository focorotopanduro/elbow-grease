/**
 * RoofSectionsLayer — Phase 14.R.4.
 *
 * Scene-level group that maps every committed `RoofSection` in
 * `roofStore` to a `<RoofSection3D />`. Kept thin on purpose so
 * `RoofSection3D` can memoize tightly (it only re-renders when its
 * single `section` prop changes reference, not when a sibling does).
 *
 * Selection:
 *   Clicking a section's mesh calls `selectSection(id)` on the store.
 *   Click on empty space won't clear — the user has to use the
 *   SectionsPanel or ESC. Matching plumbing UX would require a
 *   separate background catcher and we don't want to fight the draw
 *   ground-plane.
 *
 * Mount guard:
 *   Components are inside <Scene> already gated by `appMode === 'roofing'`
 *   in App.tsx, so this file doesn't need its own mode check.
 */

import { useShallow } from 'zustand/react/shallow';
import { useRoofStore, selectSectionsArray } from '@store/roofStore';
import { RoofSection3D } from './RoofSection3D';

export function RoofSectionsLayer() {
  // The prior comment claimed Zustand shallow-compares by default —
  // it doesn't. Default equality is `Object.is`. `selectSectionsArray`
  // returns a fresh array per call, so without `useShallow` every
  // unrelated store mutation re-renders this <group> + ALL its
  // `RoofSection3D` children. `useShallow` compares array contents
  // element-by-element so we only re-render when the section LIST
  // genuinely changes.
  const sections = useRoofStore(useShallow(selectSectionsArray));
  const selectSection = useRoofStore((s) => s.selectSection);

  return (
    <group>
      {sections.map((sec) => (
        <RoofSection3D
          key={sec.sectionId}
          section={sec}
          onClick={(id) => selectSection(id)}
        />
      ))}
    </group>
  );
}
