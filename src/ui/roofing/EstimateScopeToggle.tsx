/**
 * EstimateScopeToggle — Phase 14.R.6.
 *
 * Two-button pill inside the RoofingInspector letting the user pick
 * whether the live estimate reflects just the selected section
 * ("Selected") or the full whole-house aggregate of every drawn
 * section ("All"). Sits above the Project input row so it reads
 * before the BOM shown below it updates.
 *
 * When no sections have been drawn yet, "All" is disabled — there
 * is nothing to aggregate, and falling through to the flat form-
 * input estimate is the expected behavior.
 */

import {
  useRoofingEstimateScopeStore,
  type EstimateScope,
} from '@store/roofingEstimateScopeStore';
import { useRoofStore } from '@store/roofStore';

interface Option {
  value: EstimateScope;
  label: string;
  icon: string;
  title: string;
}

const OPTIONS: Option[] = [
  {
    value: 'selected',
    label: 'Selected',
    icon: '◉',
    title: 'Estimate only the currently selected section (or the inspector form when none is selected).',
  },
  {
    value: 'all',
    label: 'All',
    icon: '◈',
    title: 'Aggregate every drawn section into a single whole-house BOM.',
  },
];

const ACCENT = '#ff9800';

export function EstimateScopeToggle() {
  const scope = useRoofingEstimateScopeStore((s) => s.scope);
  const setScope = useRoofingEstimateScopeStore((s) => s.setScope);
  const sectionCount = useRoofStore((s) => s.sectionOrder.length);
  const aggregateDisabled = sectionCount === 0;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 600,
        color: ACCENT,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        marginBottom: 6,
      }}>
        Estimate scope
      </div>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 4,
        padding: 3,
        background: '#0e0e16',
        border: '1px solid #222',
        borderRadius: 6,
      }}>
        {OPTIONS.map((opt) => {
          const active = scope === opt.value;
          const disabled = opt.value === 'all' && aggregateDisabled;
          return (
            <button
              key={opt.value}
              onClick={() => { if (!disabled) setScope(opt.value); }}
              title={disabled
                ? 'Draw at least one roof section to enable aggregate totals'
                : opt.title}
              disabled={disabled}
              style={{
                background: active ? `${ACCENT}22` : 'transparent',
                border: `1px solid ${active ? ACCENT : 'transparent'}`,
                color: active ? ACCENT : disabled ? '#555' : '#bbb',
                padding: '5px 10px',
                borderRadius: 4,
                fontSize: 12,
                fontFamily: 'system-ui, sans-serif',
                fontWeight: active ? 600 : 500,
                cursor: disabled ? 'not-allowed' : 'pointer',
                transition: 'background 120ms, border-color 120ms, color 120ms',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
              }}
            >
              <span>{opt.icon}</span>
              <span>{opt.label}</span>
              {opt.value === 'all' && sectionCount > 0 && (
                <span style={{
                  fontSize: 10,
                  opacity: 0.7,
                  marginLeft: 2,
                }}>
                  ({sectionCount})
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
