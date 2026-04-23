/**
 * RoofingInspector — Phase 14.R.3.
 *
 * Right-side DOM overlay panel. Driven by `roofingProjectStore`'s
 * flat input fields; re-runs `fl_roofing.estimate()` on every
 * field change to show a live BOM + pricing + warnings.
 *
 * Sections (top → bottom):
 *   1. Project ID header (customer, project ID)
 *   2. County + address
 *   3. Roof geometry (L, W, height, slope, type, complexity)
 *   4. System + install method + product family
 *   5. Environment (distance to saltwater, risk category, job type)
 *   6. Penetrations (vents, skylights, chimneys)
 *   7. Live readouts:
 *        - Wind profile (Vult, exposure, HVHZ, region)
 *        - Zones summary (a_dimension, sloped_area, perimeter_pct)
 *        - Sheathing spec (if resolved)
 *        - Confidence summary
 *        - Warnings list (color-coded by severity)
 *        - BOM (line items with confidence chip + fl_approval)
 *        - Pricing summary (if AROYH prices available via catalog)
 *
 * Only mounts when `appMode === 'roofing'` (see `App.tsx`).
 */

import { useEffect, useMemo } from 'react';
import {
  useRoofingProjectStore,
  selectProject,
} from '@store/roofingProjectStore';
import {
  type Confidence,
  type LineItem,
  type EstimateWarning,
  type RoofTypeFL,
  type SystemFL,
  type RoofComplexity,
  type JobType,
  type InstallMethod,
  computeConfidenceReport,
  quantityWithWaste,
} from '@engine/roofing/fl/core';
import { allWindZones } from '@engine/roofing/fl/data';
import { estimateMaterials, estimatePricing, type RoofSectionLike } from '@engine/roofing/calcEngine';
import { pricesFromCatalog } from '@engine/roofing/materialCatalog';
// Phase 14.R.4 — canvas-drawn sections. Selecting a section in the
// panel syncs its dims into `roofingProjectStore` so the live
// estimator below reflects "this section's quote".
import { useRoofStore, selectSectionsArray, selectPenetrationsArray } from '@store/roofStore';
import { SectionsPanel } from './SectionsPanel';
// Phase 14.R.6 — whole-house aggregation across all drawn sections.
// Phase 14.R.7 — sectionMeanHeightFt applies per-section wind-height
// correction (eave + roof-type offset) so the sync-on-select feeds
// the inspector's flat input with the same value the aggregator uses.
import {
  aggregateEstimate,
  resolvePenetrationCounts,
  sectionMeanHeightFt,
} from '@engine/roofing/fl/aggregate';
import { estimate as estimateFl } from '@engine/roofing/fl/estimator';
import { PENETRATION_LABELS } from '@engine/roofing/RoofGraph';
import { useRoofingEstimateScopeStore } from '@store/roofingEstimateScopeStore';
import { EstimateScopeToggle } from './EstimateScopeToggle';
import {
  areaActual,
  perimeterPlan,
  ridgeLength,
  type RoofSection,
} from '@engine/roofing/RoofGraph';

/** Phase 14.R.7 — default wall height (ft) used as the fallback
 *  eave elevation when a selected section has `z === 0`. 10 ft
 *  is the contractor convention in Florida residential work. */
const DEFAULT_WALL_HEIGHT_FT = 10;

// ── Helpers ─────────────────────────────────────────────────────

const CONFIDENCE_COLOR: Record<Confidence, string> = {
  verified: '#00e676',   // green
  published: '#29b6f6',  // blue
  computed: '#9575cd',   // purple
  inferred: '#ffa726',   // amber
  unverified: '#ef5350', // red
};

const SEVERITY_COLOR: Record<'info' | 'warning' | 'blocker', string> = {
  info: '#29b6f6',
  warning: '#ffa726',
  blocker: '#ef5350',
};

/** All 67 county names, sorted alphabetically for the dropdown. */
function useCountyOptions(): string[] {
  return useMemo(() => {
    const zones = allWindZones();
    return zones.map((z) => z.county).sort();
  }, []);
}

function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

function fmtNum(n: number, digits: number = 1): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

// ── Subcomponents ──────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 700,
        color: '#666',
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        marginBottom: 8,
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
      <span style={{ color: '#999', flex: '0 0 120px' }}>{label}</span>
      <span style={{ flex: 1 }}>{children}</span>
    </label>
  );
}

const INPUT_STYLE: React.CSSProperties = {
  background: '#111',
  color: '#eee',
  border: '1px solid #333',
  borderRadius: 4,
  padding: '4px 8px',
  fontSize: 12,
  width: '100%',
  fontFamily: 'system-ui, sans-serif',
  boxSizing: 'border-box',
};

function NumberInput({
  value, onChange, step = 1, min, max,
}: {
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <input
      type="number"
      step={step}
      min={min}
      max={max}
      value={value}
      onChange={(e) => {
        const n = parseFloat(e.target.value);
        if (Number.isFinite(n)) onChange(n);
      }}
      style={INPUT_STYLE}
    />
  );
}

function TextInput({
  value, onChange, placeholder,
}: {
  value: string;
  onChange: (s: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={INPUT_STYLE}
    />
  );
}

function Select<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: ReadonlyArray<{ value: T; label: string }>;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      style={INPUT_STYLE}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '1px 6px',
      background: `${CONFIDENCE_COLOR[confidence]}22`,
      color: CONFIDENCE_COLOR[confidence],
      borderRadius: 3,
      fontSize: 9,
      fontWeight: 700,
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    }}>
      {confidence}
    </span>
  );
}

function WarningCard({ w }: { w: EstimateWarning }) {
  const color = SEVERITY_COLOR[w.severity];
  return (
    <div style={{
      padding: 8,
      background: `${color}11`,
      borderLeft: `3px solid ${color}`,
      borderRadius: 3,
      fontSize: 11,
      lineHeight: 1.4,
      color: '#ddd',
    }}>
      <div style={{
        color,
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        marginBottom: 2,
      }}>
        {w.severity} · {w.category}
      </div>
      <div>{w.message}</div>
      {w.reference && (
        <div style={{ color: '#777', marginTop: 3, fontStyle: 'italic' }}>
          {w.reference}
        </div>
      )}
    </div>
  );
}

function LineItemRow({ li }: { li: LineItem }) {
  const qty = quantityWithWaste(li);
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr auto auto',
      gap: 6,
      padding: '3px 0',
      borderBottom: '1px solid #1a1a1a',
      fontSize: 11,
      alignItems: 'center',
    }}>
      <div style={{ color: '#ddd', minWidth: 0 }}>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {li.name}
        </div>
        {li.fl_approval && (
          <div style={{ fontSize: 9, color: '#666', marginTop: 1 }}>
            {li.fl_approval}{li.noa_number ? ` · ${li.noa_number}` : ''}
          </div>
        )}
      </div>
      <div style={{ color: '#aaa', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>
        {fmtNum(qty, 0)} {li.unit}
      </div>
      <ConfidenceChip confidence={li.confidence} />
    </div>
  );
}

// ── Options (labels + values for selects) ──────────────────────

const ROOF_TYPE_OPTIONS: Array<{ value: RoofTypeFL; label: string }> = [
  { value: 'hip',   label: 'Hip' },
  { value: 'gable', label: 'Gable' },
  { value: 'flat',  label: 'Flat' },
  { value: 'shed',  label: 'Shed' },
];

const COMPLEXITY_OPTIONS: Array<{ value: RoofComplexity; label: string }> = [
  { value: 'simple',   label: 'Simple' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'complex',  label: 'Complex' },
];

const SYSTEM_OPTIONS: Array<{ value: SystemFL; label: string }> = [
  { value: 'architectural_shingle', label: 'Architectural Shingle' },
  { value: '3tab_shingle',          label: '3-Tab Shingle' },
  { value: 'concrete_tile',         label: 'Concrete Tile' },
  { value: 'clay_tile',             label: 'Clay Tile' },
  { value: 'standing_seam_metal',   label: 'Standing Seam Metal' },
  { value: '5v_crimp_metal',        label: '5V-Crimp Metal' },
];

const JOB_TYPE_OPTIONS: Array<{ value: JobType; label: string }> = [
  { value: 'new_roof', label: 'New Roof' },
  { value: 'reroof',   label: 'Reroof' },
  { value: 'repair',   label: 'Repair' },
];

const INSTALL_METHOD_OPTIONS: Array<{ value: InstallMethod; label: string }> = [
  { value: 'direct_deck', label: 'Direct Deck' },
  { value: 'battened',    label: 'Battened' },
  { value: 'foam_set',    label: 'Foam Set' },
  { value: 'mortar_set',  label: 'Mortar Set' },
];

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Phase 14.R.6 — map a drawn `RoofSection` to the `RoofSectionLike`
 * shape AROYH's `calcEngine` consumes. `flat` isn't a calcEngine
 * enum member (it's gable/hip/shed only); we fold it into 'gable'
 * since flat roofs have 0 slope and the rafter math degenerates to
 * perimeter-only work either way.
 */
function sectionToPricingLike(sec: RoofSection): RoofSectionLike {
  return {
    sectionId: sec.sectionId,
    label: sec.label,
    x: sec.x,
    y: sec.y,
    length: sec.length,
    run: sec.run,
    slope: sec.slope,
    roofType: sec.roofType === 'flat' ? 'gable' : sec.roofType,
    overhang: sec.overhang,
    areaActual: areaActual(sec),
    perimeterPlan: perimeterPlan(sec),
    ridgeLength: ridgeLength(sec),
  };
}

// ── Main panel ─────────────────────────────────────────────────

export function RoofingInspector() {
  const input = useRoofingProjectStore((s) => s.input);
  const update = useRoofingProjectStore((s) => s.update);
  const reset = useRoofingProjectStore((s) => s.reset);
  const counties = useCountyOptions();

  // Phase 14.R.4 — when the user selects a drawn section, copy its
  // dimensions + roof type + slope into the flat estimator input so
  // the BOM reflects that section. One-way: select → populate.
  // Subsequent manual edits in the inspector are NOT pushed back to
  // the section (so an estimator-only tweak doesn't mutate drawn
  // geometry). A future iteration can add a "push to section" action.
  const selectedId = useRoofStore((s) => s.selectedSectionId);
  const selectedSection = useRoofStore((s) =>
    s.selectedSectionId ? s.sections[s.selectedSectionId] ?? null : null,
  );
  useEffect(() => {
    if (!selectedSection) return;
    // Map RoofGraph roofType → the FL estimator's RoofTypeFL domain.
    // RoofGraph has 'hip' | 'gable' | 'shed' | 'flat'; FL estimator
    // accepts those four plus 'complex' / etc. — the ones we draw
    // all map 1:1.
    const rtMap: Record<string, RoofTypeFL> = {
      hip: 'hip',
      gable: 'gable',
      shed: 'shed',
      flat: 'flat',
    };
    const fl_roof_type: RoofTypeFL = rtMap[selectedSection.roofType] ?? 'hip';
    // Phase 14.R.7 — use the same helper the aggregator uses so the
    // "select one section" flat-form path and the "aggregate all
    // sections" path agree on what mean_height_ft means for wind.
    // The DEFAULT_WALL_HEIGHT_FT fallback kicks in when the user
    // drew the section at z=0 (default) — i.e. ground-floor main
    // roof atop a standard 10-ft wall.
    const mean = sectionMeanHeightFt(selectedSection, DEFAULT_WALL_HEIGHT_FT);
    update({
      length_ft: selectedSection.length,
      width_ft: selectedSection.run,
      slope_pitch: `${selectedSection.slope}:12`,
      roof_type: fl_roof_type,
      mean_height_ft: Math.max(mean, 1),
    });
  }, [selectedId, selectedSection, update]);

  // Phase 14.R.6 — scope switch: estimate the selected section only
  // vs. the whole-house aggregate of every drawn section. Subscribe
  // via `getState()` to re-run on any input change, and explicitly
  // subscribe to the drawn-section list so the aggregate BOM updates
  // when the user draws/deletes/edits a section.
  const scope = useRoofingEstimateScopeStore((s) => s.scope);
  const sections = useRoofStore(selectSectionsArray);
  // Phase 14.R.27 — spatial penetration markers. When any markers
  // exist for a kind, they OVERRIDE the manual form count for that
  // kind; otherwise the manual count is still used. See
  // `resolvePenetrationCounts` for the exact rule.
  const penetrations = useRoofStore(selectPenetrationsArray);
  const removePenetration = useRoofStore((s) => s.removePenetration);
  const state = useRoofingProjectStore.getState();
  const aggregate = scope === 'all' && sections.length > 0;

  const { est, error, sectionCountForEstimate } = useMemo(() => {
    if (aggregate) {
      const baseProject = selectProject(state);
      const agg = aggregateEstimate(sections, baseProject, penetrations);
      return {
        est: agg.estimate,
        error: agg.error,
        sectionCountForEstimate: agg.sectionCount,
      };
    }
    // Single-section scope: still honor spatial penetrations by
    // resolving the counts up front and rebuilding the Project with
    // the overrides baked in. Keeps behaviour parity between the
    // two scopes so toggling "all vs single" never produces a
    // surprising jump in chimney / skylight / vent quantities.
    try {
      const baseProject = selectProject(state);
      const counts = resolvePenetrationCounts(baseProject, penetrations);
      const projectWithCounts = {
        ...baseProject,
        plumbing_vent_count: counts.plumbing_vent,
        skylight_count:      counts.skylight,
        chimney_count:       counts.chimney,
      };
      return {
        est: estimateFl(projectWithCounts),
        error: null,
        sectionCountForEstimate: 1,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { est: null, error: msg, sectionCountForEstimate: 1 };
    }
    // `state` is a fresh snapshot each render — its identity changes on
    // every input edit, which is exactly when we want to re-estimate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aggregate, sections, state.input, input, penetrations]);

  // Phase 14.R.27 — counts the estimator will actually use (after
  // per-kind override). Drives the "(from markers)" UI hints + the
  // penetration list readout under the form inputs.
  const effectivePenetrationCounts = useMemo(
    () => resolvePenetrationCounts(selectProject(state), penetrations),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.input, penetrations],
  );

  // Also compute the AROYH material + pricing view for the panel's
  // bottom summary. Uses the pipe-engine `calcEngine` as a parallel
  // source of SF-based totals (different abstraction from fl_roofing's
  // FL-code-compliant BOM — shown side by side).
  const aroyhPricing = useMemo(() => {
    if (!est) return null;
    const sectionsForPricing: RoofSectionLike[] = aggregate
      ? sections.map(sectionToPricingLike)
      : [{
          sectionId: 'fl-quick',
          label: 'Quick',
          x: 0, y: 0,
          length: input.length_ft, run: input.width_ft,
          slope: parseFloat(input.slope_pitch.split(':')[0] || '6'),
          roofType: input.roof_type === 'flat' ? 'gable' : input.roof_type,
          overhang: 1,
          areaActual: est.zones.sloped_area_sqft,
          perimeterPlan: 2 * (input.length_ft + input.width_ft),
          ridgeLength: input.length_ft,
        }];
    const mat = estimateMaterials(sectionsForPricing);
    const price = estimatePricing(mat, { prices: pricesFromCatalog() });
    return { mat, price };
  }, [est, aggregate, sections, input.length_ft, input.width_ft, input.slope_pitch, input.roof_type]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 50,
        right: 12,
        bottom: 44, // above StatusBar
        width: 420,
        background: 'rgba(10, 10, 15, 0.96)',
        border: '1px solid #222',
        borderRadius: 10,
        zIndex: 20,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
        color: '#eee',
        boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
        backdropFilter: 'blur(6px)',
      }}
    >
      {/* Header */}
      <div style={{
        padding: '10px 14px',
        borderBottom: '1px solid #222',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#ff9800' }}>
            🏠 Roofing Inspector
          </div>
          <div style={{ fontSize: 10, color: '#666', marginTop: 1 }}>
            FL code-compliant estimate · AROYH + fl_roofing
          </div>
        </div>
        <button
          onClick={reset}
          title="Reset all fields to defaults"
          style={{
            background: 'transparent',
            color: '#999',
            border: '1px solid #333',
            borderRadius: 4,
            padding: '3px 8px',
            fontSize: 10,
            cursor: 'pointer',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          Reset
        </button>
      </div>

      {/* Scrollable body */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '12px 14px',
      }}>
        {/* Phase 14.R.4 — drawn sections list. Shows a hint when
            empty; otherwise lists every section with color swatch +
            dims + delete. Clicking a section selects it and syncs
            the form fields below. */}
        <SectionsPanel />

        {/* Phase 14.R.6 — whole-house aggregate vs. selected-only.
            Appears above the inputs so the scope choice reads first.
            Disabled ("All") when no sections have been drawn. */}
        <EstimateScopeToggle />

        {aggregate && est && (
          <div style={{
            padding: '6px 10px',
            background: '#ff980011',
            border: '1px solid #ff980044',
            borderRadius: 6,
            color: '#ffb74d',
            fontSize: 11,
            lineHeight: 1.5,
            marginBottom: 12,
          }}>
            <span style={{ fontWeight: 600 }}>🏠 Whole-house aggregate</span>
            {' · '}
            <span>{sectionCountForEstimate} section{sectionCountForEstimate === 1 ? '' : 's'}</span>
            {' · '}
            <span>{Math.round(est.zones.sloped_area_sqft).toLocaleString('en-US')} sq ft total</span>
          </div>
        )}

        {/* ── INPUT ──────────────────────────────────────── */}
        <Section title="Project">
          <Row label="Customer">
            <TextInput
              value={input.customer_name}
              onChange={(v) => update({ customer_name: v })}
              placeholder="e.g. Acme Homes"
            />
          </Row>
          <Row label="Project ID">
            <TextInput
              value={input.project_id}
              onChange={(v) => update({ project_id: v })}
              placeholder="PROJ-001"
            />
          </Row>
          <Row label="Address">
            <TextInput
              value={input.address}
              onChange={(v) => update({ address: v })}
              placeholder="123 Ocean Dr, Miami, FL"
            />
          </Row>
        </Section>

        <Section title="Location">
          <Row label="County">
            <select
              value={input.county}
              onChange={(e) => update({ county: e.target.value })}
              style={INPUT_STYLE}
            >
              {counties.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Row>
          <Row label="Dist. to saltwater">
            <NumberInput
              value={input.distance_to_saltwater_ft}
              onChange={(n) => update({ distance_to_saltwater_ft: n })}
              step={100}
              min={0}
            />
          </Row>
        </Section>

        <Section title="Roof Geometry">
          <Row label="Length (ft)">
            <NumberInput value={input.length_ft} onChange={(n) => update({ length_ft: n })} step={1} min={1} />
          </Row>
          <Row label="Width (ft)">
            <NumberInput value={input.width_ft} onChange={(n) => update({ width_ft: n })} step={1} min={1} />
          </Row>
          <Row label="Mean height (ft)">
            <NumberInput value={input.mean_height_ft} onChange={(n) => update({ mean_height_ft: n })} step={1} min={1} />
          </Row>
          <Row label="Slope pitch">
            <TextInput
              value={input.slope_pitch}
              onChange={(v) => update({ slope_pitch: v })}
              placeholder="6:12"
            />
          </Row>
          <Row label="Roof type">
            <Select value={input.roof_type} onChange={(v) => update({ roof_type: v })} options={ROOF_TYPE_OPTIONS} />
          </Row>
          <Row label="Complexity">
            <Select value={input.complexity} onChange={(v) => update({ complexity: v })} options={COMPLEXITY_OPTIONS} />
          </Row>
        </Section>

        <Section title="System">
          <Row label="Covering">
            <Select value={input.system} onChange={(v) => update({ system: v })} options={SYSTEM_OPTIONS} />
          </Row>
          <Row label="Product family">
            <TextInput
              value={input.product_family}
              onChange={(v) => update({ product_family: v })}
              placeholder="GAF Timberline HDZ"
            />
          </Row>
          {(input.system === 'concrete_tile' || input.system === 'clay_tile') && (
            <Row label="Install method">
              <Select value={input.install_method} onChange={(v) => update({ install_method: v })} options={INSTALL_METHOD_OPTIONS} />
            </Row>
          )}
          <Row label="Job type">
            <Select value={input.job_type} onChange={(v) => update({ job_type: v })} options={JOB_TYPE_OPTIONS} />
          </Row>
        </Section>

        <Section title="Penetrations">
          {/* Phase 14.R.27 — form inputs stay editable for each kind,
              but when one or more spatial markers of that kind have
              been placed on the canvas the MARKER count wins at
              estimate time. Show a small hint so the user can tell
              at a glance which source is feeding the BOM. */}
          <Row label="Plumbing vents">
            <NumberInput
              value={input.plumbing_vent_count}
              onChange={(n) => update({ plumbing_vent_count: Math.max(0, Math.trunc(n)) })}
              step={1} min={0}
            />
          </Row>
          {effectivePenetrationCounts.plumbing_vent !== input.plumbing_vent_count && (
            <div style={{ fontSize: 10, color: '#8aa', marginTop: -4, marginBottom: 4 }}>
              Estimator using {effectivePenetrationCounts.plumbing_vent} from placed markers
            </div>
          )}
          <Row label="Skylights">
            <NumberInput
              value={input.skylight_count}
              onChange={(n) => update({ skylight_count: Math.max(0, Math.trunc(n)) })}
              step={1} min={0}
            />
          </Row>
          {effectivePenetrationCounts.skylight !== input.skylight_count && (
            <div style={{ fontSize: 10, color: '#8aa', marginTop: -4, marginBottom: 4 }}>
              Estimator using {effectivePenetrationCounts.skylight} from placed markers
            </div>
          )}
          <Row label="Chimneys">
            <NumberInput
              value={input.chimney_count}
              onChange={(n) => update({ chimney_count: Math.max(0, Math.trunc(n)) })}
              step={1} min={0}
            />
          </Row>
          {effectivePenetrationCounts.chimney !== input.chimney_count && (
            <div style={{ fontSize: 10, color: '#8aa', marginTop: -4, marginBottom: 4 }}>
              Estimator using {effectivePenetrationCounts.chimney} from placed markers
            </div>
          )}

          {/* Phase 14.R.27 — placed markers list. Appears only when at
              least one marker has been dropped, so the panel stays
              compact for users who only type counts. Each row has a
              remove button; inline editing of XY is intentionally
              deferred — clicking → Delete → click-again-in-toolbar
              is faster than a 3-field form for the common reposition. */}
          {penetrations.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{
                fontSize: 10,
                color: '#888',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                marginBottom: 4,
              }}>
                Placed markers ({penetrations.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                {penetrations.map((pen) => (
                  <div
                    key={pen.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '3px 6px',
                      background: '#10121a',
                      border: '1px solid #1c1f2a',
                      borderRadius: 4,
                      fontSize: 11,
                    }}
                  >
                    <span style={{ flex: 1, color: '#ccc' }}>
                      {pen.label}
                    </span>
                    <span style={{ color: '#666', fontSize: 10 }}>
                      {PENETRATION_LABELS[pen.kind]} · ({pen.x.toFixed(1)}, {pen.y.toFixed(1)})
                    </span>
                    <button
                      type="button"
                      onClick={() => removePenetration(pen.id)}
                      title={`Remove ${pen.label}`}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ef5350',
                        cursor: 'pointer',
                        padding: '0 4px',
                        fontSize: 12,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* ── OUTPUT ─────────────────────────────────────── */}
        {error && (
          <Section title="Error">
            <div style={{
              padding: 10,
              background: '#ef535022',
              color: '#ef5350',
              borderRadius: 4,
              fontSize: 12,
            }}>
              {error}
            </div>
          </Section>
        )}

        {est && (() => {
          const report = computeConfidenceReport(est);
          return (
            <>
              <Section title="Wind Profile">
                <Row label="Vult">
                  <span style={{ color: '#eee' }}>
                    {est.wind.vult_mph} mph · Exp {est.wind.exposure}
                  </span>
                </Row>
                <Row label="Region">
                  <span style={{ color: '#aaa' }}>{est.wind.region}</span>
                </Row>
                <Row label="Flags">
                  <span style={{ display: 'flex', gap: 4 }}>
                    {est.wind.hvhz && (
                      <span style={{ padding: '1px 6px', background: '#ef535033', color: '#ef5350', borderRadius: 3, fontSize: 10, fontWeight: 700 }}>HVHZ</span>
                    )}
                    {est.wind.wbdr && (
                      <span style={{ padding: '1px 6px', background: '#ffa72633', color: '#ffa726', borderRadius: 3, fontSize: 10, fontWeight: 700 }}>WBDR</span>
                    )}
                    {est.wind.coastal && (
                      <span style={{ padding: '1px 6px', background: '#29b6f633', color: '#29b6f6', borderRadius: 3, fontSize: 10, fontWeight: 700 }}>COASTAL</span>
                    )}
                  </span>
                </Row>
              </Section>

              <Section title="Pressure Zones (ASCE 7-22)">
                <Row label="a-dimension">
                  <span style={{ color: '#eee' }}>{fmtNum(est.zones.a_dimension_ft, 2)} ft</span>
                </Row>
                <Row label="Plan area">
                  <span style={{ color: '#eee' }}>{fmtNum(est.zones.total_plan_sqft, 0)} sf</span>
                </Row>
                <Row label="Sloped area">
                  <span style={{ color: '#eee' }}>{fmtNum(est.zones.sloped_area_sqft, 0)} sf ({fmtNum(est.zones.sloped_area_sqft / 100, 1)} sq)</span>
                </Row>
                <Row label="Perimeter %">
                  <span style={{ color: '#eee' }}>{fmtNum(est.zones.perimeter_fraction * 100, 0)}%</span>
                </Row>
              </Section>

              {est.sheathing && (
                <Section title="Sheathing (FBC R803.2.3.1)">
                  <Row label="Fastener">
                    <span style={{ color: '#eee' }}>{est.sheathing.fastener}</span>
                  </Row>
                  <Row label="Spacing">
                    <span style={{ color: '#eee' }}>
                      {est.sheathing.panel_edge_in}" edge · {est.sheathing.interior_override_in}" interior
                    </span>
                  </Row>
                  <Row label="Confidence">
                    <ConfidenceChip confidence={est.sheathing.confidence} />
                  </Row>
                </Section>
              )}

              {est.warnings.length > 0 && (
                <Section title={`Warnings · ${est.warnings.length}`}>
                  {est.warnings.map((w, i) => <WarningCard key={i} w={w} />)}
                </Section>
              )}

              <Section title={`BOM · ${est.line_items.length} items`}>
                {est.line_items.map((li, i) => <LineItemRow key={i} li={li} />)}
              </Section>

              <Section title="Confidence">
                <Row label="Overall">
                  <ConfidenceChip confidence={report.overall} />
                </Row>
                <Row label="Verified">
                  <span style={{ color: '#eee' }}>
                    {report.verified_line_items} / {report.total_line_items}
                    {' '}({fmtNum((report.verified_line_items / Math.max(1, report.total_line_items)) * 100, 0)}%)
                  </span>
                </Row>
                {report.flagged_items.length > 0 && (
                  <Row label="Flagged">
                    <span style={{ color: '#ef5350', fontSize: 10 }}>
                      {report.flagged_items.slice(0, 3).join(', ')}
                      {report.flagged_items.length > 3 && ` +${report.flagged_items.length - 3}`}
                    </span>
                  </Row>
                )}
              </Section>

              {aroyhPricing && (
                <Section title="AROYH Rough Pricing (side view)">
                  <Row label="Net squares">
                    <span style={{ color: '#eee' }}>{fmtNum(aroyhPricing.mat.netSquares, 1)} sq</span>
                  </Row>
                  <Row label="Shingle bundles">
                    <span style={{ color: '#eee' }}>{aroyhPricing.mat.shingleBundles}</span>
                  </Row>
                  <Row label="Material cost">
                    <span style={{ color: '#eee' }}>{fmtUsd(aroyhPricing.price.materialCost)}</span>
                  </Row>
                  <Row label="Labor cost">
                    <span style={{ color: '#eee' }}>{fmtUsd(aroyhPricing.price.laborCost)}</span>
                  </Row>
                  <Row label="Total">
                    <span style={{ color: '#00e676', fontWeight: 700 }}>
                      {fmtUsd(aroyhPricing.price.total)}
                    </span>
                  </Row>
                  <Row label="$/square">
                    <span style={{ color: '#aaa' }}>{fmtUsd(aroyhPricing.price.pricePerSquare)}</span>
                  </Row>
                </Section>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}
