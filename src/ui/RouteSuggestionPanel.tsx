/**
 * RouteSuggestionPanel — 2D HUD panel showing HILO route options.
 *
 * Displays the Pareto-ranked candidates with objective breakdowns
 * so the engineer can visually compare tradeoffs. Clicking a card
 * selects that route in the 3D view and updates the preference model.
 */

import { useState } from 'react';
import { useEvent } from '@hooks/useEventBus';
import type { RouteCandidate, ObjectiveVector } from '@core/optimizer/ParetoFrontier';
import {
  HILO_EV,
  type RoutesGeneratedPayload,
} from '@core/hilo/HILOCoordinator';

const ROUTE_COLORS = ['#00e5ff', '#7c4dff', '#ffc107', '#00e676'];

const OBJ_LABELS: Record<keyof ObjectiveVector, { label: string; unit: string; lower: boolean }> = {
  pipeLength:      { label: 'Length',       unit: 'ft',  lower: true },
  slopeCompliance: { label: 'Slope',        unit: '%',   lower: false },
  materialCost:    { label: 'Cost',         unit: '$',   lower: true },
  accessibility:   { label: 'Access',       unit: '%',   lower: false },
  violations:      { label: 'Violations',   unit: '',    lower: true },
};

const OBJ_KEYS = Object.keys(OBJ_LABELS) as (keyof ObjectiveVector)[];

// ── Objective bar ───────────────────────────────────────────────

function ObjectiveBar({
  label,
  value,
  unit,
  fraction,
  isBest,
}: {
  label: string;
  value: string;
  unit: string;
  fraction: number;
  isBest: boolean;
}) {
  return (
    <div style={styles.objRow}>
      <span style={styles.objLabel}>{label}</span>
      <div style={styles.barTrack}>
        <div
          style={{
            ...styles.barFill,
            width: `${Math.max(5, fraction * 100)}%`,
            backgroundColor: isBest ? '#00e676' : '#555',
          }}
        />
      </div>
      <span style={styles.objValue}>
        {value}
        {unit && <span style={styles.objUnit}>{unit}</span>}
      </span>
    </div>
  );
}

// ── Route card ──────────────────────────────────────────────────

function RouteCard({
  route,
  index,
  selected,
  ranges,
  onSelect,
  onHover,
}: {
  route: RouteCandidate;
  index: number;
  selected: boolean;
  ranges: Record<keyof ObjectiveVector, { min: number; max: number }>;
  onSelect: () => void;
  onHover: (h: boolean) => void;
}) {
  const color = ROUTE_COLORS[index % ROUTE_COLORS.length]!;

  return (
    <div
      style={{
        ...styles.card,
        borderColor: selected ? color : '#333',
        backgroundColor: selected ? 'rgba(255,255,255,0.05)' : 'rgba(10,10,15,0.9)',
      }}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      <div style={styles.cardHeader}>
        <div style={{ ...styles.colorDot, backgroundColor: color }} />
        <span style={styles.cardTitle}>Route {index + 1}</span>
        {route.wBound > 1 && (
          <span style={styles.wBadge}>w={route.wBound.toFixed(1)}</span>
        )}
      </div>

      {OBJ_KEYS.map((k) => {
        const r = ranges[k];
        const range = r.max - r.min || 1;
        const fraction = (route.objectives[k] - r.min) / range;
        const oriented = OBJ_LABELS[k].lower ? 1 - fraction : fraction;
        const isBest = OBJ_LABELS[k].lower
          ? route.objectives[k] === r.min
          : route.objectives[k] === r.max;

        let display: string;
        if (k === 'slopeCompliance' || k === 'accessibility') {
          display = (route.objectives[k] * 100).toFixed(0);
        } else if (k === 'materialCost') {
          display = route.objectives[k].toFixed(0);
        } else if (k === 'pipeLength') {
          display = route.objectives[k].toFixed(1);
        } else {
          display = route.objectives[k].toString();
        }

        return (
          <ObjectiveBar
            key={k}
            label={OBJ_LABELS[k].label}
            value={display}
            unit={OBJ_LABELS[k].unit}
            fraction={oriented}
            isBest={isBest}
          />
        );
      })}
    </div>
  );
}

// ── Panel ───────────────────────────────────────────────────────

interface RouteSuggestionPanelProps {
  onSelect: (routeId: string) => void;
}

export function RouteSuggestionPanel({ onSelect }: RouteSuggestionPanelProps) {
  const [routes, setRoutes] = useState<RouteCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEvent<RoutesGeneratedPayload>(HILO_EV.ROUTES_GENERATED, (payload) => {
    setRoutes(payload.ranked);
    setSelectedId(null);
  });

  if (routes.length === 0) return null;

  // Compute min/max for each objective across candidates
  const ranges = {} as Record<keyof ObjectiveVector, { min: number; max: number }>;
  for (const k of OBJ_KEYS) {
    const vals = routes.map((r) => r.objectives[k]);
    ranges[k] = { min: Math.min(...vals), max: Math.max(...vals) };
  }

  return (
    <div style={styles.panel}>
      <div style={styles.panelHeader}>
        ROUTE OPTIONS
        <span style={styles.subtitle}>{routes.length} Pareto-optimal</span>
      </div>
      {routes.map((route, i) => (
        <RouteCard
          key={route.id}
          route={route}
          index={i}
          selected={selectedId === route.id}
          ranges={ranges}
          onSelect={() => {
            setSelectedId(route.id);
            onSelect(route.id);
          }}
          onHover={() => {}}
        />
      ))}
      <div style={styles.hint}>Click a route to commit. AI learns your preferences.</div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 60,
    right: 16,
    width: 260,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    pointerEvents: 'auto',
    zIndex: 20,
  },
  panelHeader: {
    color: '#eee',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 2,
    textTransform: 'uppercase',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    padding: '0 4px',
  },
  subtitle: {
    fontSize: 10,
    fontWeight: 400,
    color: '#888',
    letterSpacing: 0,
    textTransform: 'none',
  },
  card: {
    padding: 10,
    borderRadius: 8,
    border: '1px solid #333',
    cursor: 'pointer',
    transition: 'border-color 0.15s, background 0.15s',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  cardHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: '50%',
    flexShrink: 0,
  },
  cardTitle: {
    color: '#eee',
    fontSize: 13,
    fontWeight: 600,
    flex: 1,
  },
  wBadge: {
    fontSize: 9,
    color: '#888',
    border: '1px solid #444',
    borderRadius: 4,
    padding: '1px 5px',
  },
  objRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3,
  },
  objLabel: {
    width: 55,
    fontSize: 10,
    color: '#999',
  },
  barTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#222',
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
    transition: 'width 0.3s',
  },
  objValue: {
    width: 45,
    fontSize: 10,
    color: '#ccc',
    textAlign: 'right' as const,
  },
  objUnit: {
    fontSize: 8,
    color: '#777',
    marginLeft: 2,
  },
  hint: {
    fontSize: 10,
    color: '#555',
    textAlign: 'center' as const,
    padding: '4px 0',
  },
};
