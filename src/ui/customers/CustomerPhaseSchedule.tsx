/**
 * CustomerPhaseSchedule — per-phase schedule widget for a customer.
 *
 * Renders three phase rows (Underground / Rough-in / Trim). Each row:
 *
 *   [Icon]  [Phase name]  [Status pill ▾]  [Scheduled date]  [Note ✎]
 *
 * Editing a row emits updatePhaseStatus on the customer store.
 * Status changes auto-stamp timestamps:
 *   in_progress → startedDate
 *   completed   → completedDate
 *
 * The widget is reusable — drop into CustomerManager detail panel
 * or a future project-specific window.
 */

import { useCustomerStore } from '@store/customerStore';
import { PHASE_META, PHASE_ORDER } from '@core/phases/PhaseTypes';
import { PHASE_STATUS_META, emptyPhaseSchedule, type PhaseStatus } from '@core/customers/CustomerTypes';
import type { ConstructionPhase } from '@core/phases/PhaseTypes';

interface Props {
  customerId: string;
}

const STATUS_OPTIONS: PhaseStatus[] = [
  'not_started',
  'scheduled',
  'in_progress',
  'inspection_pending',
  'passed',
  'failed',
  'completed',
];

export function CustomerPhaseSchedule({ customerId }: Props) {
  const profile = useCustomerStore((s) => s.profiles[customerId]);
  const updatePhaseStatus = useCustomerStore((s) => s.updatePhaseStatus);

  if (!profile) return null;
  const schedule = profile.phaseSchedule ?? emptyPhaseSchedule();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {PHASE_ORDER.map((phase) => {
        const meta = PHASE_META[phase];
        const row = schedule[phase];
        const statusMeta = PHASE_STATUS_META[row.status];

        const onStatusChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
          const next = e.target.value as PhaseStatus;
          const patch: Record<string, string> = { status: next };
          const today = new Date().toISOString().slice(0, 10);
          if (next === 'in_progress' && !row.startedDate) patch.startedDate = today;
          if (next === 'completed' && !row.completedDate) patch.completedDate = today;
          updatePhaseStatus(customerId, phase, patch);
        };

        return (
          <div
            key={phase}
            style={{
              display: 'grid',
              gridTemplateColumns: '24px 80px 1fr 110px',
              gap: 6,
              alignItems: 'center',
              padding: '6px 8px',
              background: `${meta.color}12`,
              border: `1px solid ${meta.color}33`,
              borderRadius: 4,
            }}
          >
            <span style={{ fontSize: 14 }}>{meta.icon}</span>
            <span style={{ fontSize: 10, color: meta.color, fontWeight: 600, letterSpacing: 1 }}>
              {meta.shortLabel}
            </span>
            <select
              value={row.status}
              onChange={onStatusChange}
              style={{
                background: `${statusMeta.color}22`,
                border: `1px solid ${statusMeta.color}66`,
                color: statusMeta.color,
                padding: '3px 6px',
                fontSize: 10,
                borderRadius: 3,
                fontFamily: 'Consolas, monospace',
                fontWeight: 600,
              }}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{PHASE_STATUS_META[s].icon} {PHASE_STATUS_META[s].label}</option>
              ))}
            </select>
            <input
              type="date"
              value={row.scheduledDate ?? ''}
              onChange={(e) => updatePhaseStatus(customerId, phase, { scheduledDate: e.target.value })}
              title="Scheduled date"
              style={{
                background: 'rgba(8,14,22,0.85)',
                border: '1px solid rgba(120,180,220,0.25)',
                color: '#cfe4ef',
                padding: '3px 6px',
                fontSize: 10,
                fontFamily: 'Consolas, monospace',
                borderRadius: 3,
              }}
            />
          </div>
        );
      })}
      <PhaseTimeline schedule={schedule} />
    </div>
  );
}

// ── Visual timeline bar ────────────────────────────────────────

function PhaseTimeline({ schedule }: { schedule: ReturnType<typeof emptyPhaseSchedule> }) {
  const order = PHASE_ORDER;
  return (
    <div style={{ display: 'flex', alignItems: 'center', marginTop: 4, padding: '4px 0' }}>
      {order.map((phase, i) => {
        const row = schedule[phase];
        const meta = PHASE_META[phase];
        const statusMeta = PHASE_STATUS_META[row.status];
        const isDone = row.status === 'completed' || row.status === 'passed';
        return (
          <div key={phase} style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
            <div
              title={`${meta.label}: ${statusMeta.label}`}
              style={{
                width: 20, height: 20, borderRadius: 10,
                background: isDone ? meta.color : statusMeta.color,
                opacity: row.status === 'not_started' ? 0.35 : 1,
                display: 'grid', placeItems: 'center',
                color: '#fff',
                fontSize: 10,
                boxShadow: isDone ? `0 0 8px ${meta.color}66` : 'none',
              }}
            >
              {isDone ? '✓' : i + 1}
            </div>
            {i < order.length - 1 && (
              <div style={{
                flex: 1, height: 2,
                background: isDone ? meta.color : 'rgba(120,180,220,0.2)',
                opacity: isDone ? 0.6 : 1,
                margin: '0 4px',
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
