/**
 * CustomerStore — high-level assembly profiles.
 *
 * In plumbing contracting, a "Customer" represents a home builder,
 * developer, or client organization whose standards dictate which
 * specific fixture models drop into a design. Two customers drawing
 * the same residential bathroom will get different parts.
 *
 * Example:
 *   Customer "Lennar Homes"  → Toilet = Kohler Cimarron 12" rough-in
 *   Customer "Spec Home Co"  → Toilet = American Standard Cadet Pro
 *
 * Each customer profile contains:
 *   - A FixtureTemplate for every fixture type, organized by phase
 *   - Default materials (PEX vs copper, PVC vs cast iron)
 *   - Regional code overlays (FBC, CA Title 24, etc.)
 *   - Cost markup preferences
 *   - Preferred manufacturers (per-category allowlist)
 *
 * The CUSTOMER EDIT wheel (CTRL+E+F) modifies these templates.
 * The CUSTOMER wheel (CTRL+F) selects which customer profile is active.
 *
 * Templates are saved to localStorage so customer configurations
 * persist across sessions and can be exported/imported.
 */

import { create } from 'zustand';
import type { FixtureSubtype } from '../engine/graph/GraphNode';
import type { PipeMaterial } from '../engine/graph/GraphEdge';
import type {
  ClientContact, SiteAddress, ProjectType, ProjectStatus, PhaseScheduleMap,
} from '@core/customers/CustomerTypes';
import { emptyPhaseSchedule } from '@core/customers/CustomerTypes';

// ── Construction phases ────────────────────────────────────────

export type ConstructionPhase = 'underground' | 'rough_in' | 'trim';

export const PHASE_LABELS: Record<ConstructionPhase, string> = {
  underground: 'Underground',
  rough_in:    'Rough-In',
  trim:        'Trim / Finish',
};

export const PHASE_COLORS: Record<ConstructionPhase, string> = {
  underground: '#8d6e63', // earthy brown
  rough_in:    '#ffa726', // orange (in-wall)
  trim:        '#66bb6a', // green (visible finish)
};

export const PHASE_ORDER: ConstructionPhase[] = ['underground', 'rough_in', 'trim'];

// ── Assembly definitions ───────────────────────────────────────

/**
 * A single item that drops during a specific phase. Can be a pipe
 * segment, fitting, or fixture component.
 */
export interface PhasedAssemblyItem {
  id: string;
  kind: 'pipe' | 'fitting' | 'fixture_component' | 'support';
  /** Local-space position relative to the fixture origin. */
  offset: [number, number, number];
  /** Local-space rotation (euler XYZ radians). */
  rotation: [number, number, number];
  /** Material (for pipes). */
  material?: PipeMaterial;
  /** Diameter (for pipes/fittings, inches). */
  diameter?: number;
  /** Length (for pipe segments, feet). */
  length?: number;
  /** Fitting type (for fittings). */
  fittingType?: string;
  /** Descriptive label ("Kohler K-3493 tank"). */
  label: string;
  /** Est. cost (USD). */
  cost: number;
  /** Supplier part number hint. */
  partNumber?: string;
}

/** Full template for one fixture type under one customer. */
export interface FixtureTemplate {
  subtype: FixtureSubtype;
  variant: string; // "Drop-In", "Wall-Hung", etc.
  category: string; // "toilet", "shower", "lavatory"
  /** Display name in the active customer's catalog. */
  modelName: string;
  /** Items to drop during each phase. */
  phases: Record<ConstructionPhase, PhasedAssemblyItem[]>;
  /** Connection nodes (inlets/outlets) in fixture-local coords. */
  connections: {
    waste?: { position: [number, number, number]; diameter: number };
    vent?: { position: [number, number, number]; diameter: number };
    cold?: { position: [number, number, number]; diameter: number };
    hot?: { position: [number, number, number]; diameter: number };
  };
  /** Spatial envelope (bounding box, feet). */
  footprint: { width: number; depth: number; height: number };
}

// ── Customer profile ───────────────────────────────────────────

export interface CustomerProfile {
  id: string;
  name: string;
  /** Templates keyed by subtype+variant. */
  templates: Record<string, FixtureTemplate>;
  /** Default pipe materials. */
  defaults: {
    wasteMaterial: PipeMaterial;
    supplyMaterial: PipeMaterial;
    ventMaterial: PipeMaterial;
  };
  /** Regional code overlays. */
  codes: string[]; // e.g. ["IPC-2021", "FBC-2026", "Title-24"]
  /** Markup percentage added to material costs. */
  markupPercent: number;
  /** Created timestamp. */
  createdAt: string;
  /** Last-updated timestamp. */
  updatedAt?: string;
  /** Notes. */
  notes?: string;

  // ── Phase 2.D contractor workflow fields (all optional) ──
  contact?: ClientContact;
  siteAddress?: SiteAddress;
  projectType?: ProjectType;
  status?: ProjectStatus;
  phaseSchedule?: PhaseScheduleMap;
  estimateAmount?: number;
  startDate?: string;
  targetCompleteDate?: string;
  tags?: string[];
  crewLead?: string;
}

// ── Pending fixture state ──────────────────────────────────────

export interface PendingFixture {
  subtype: FixtureSubtype;
  variant: string;
  category: string;
}

export interface EditFixtureState {
  subtype: FixtureSubtype;
  variant: string;
  phase: ConstructionPhase;
}

// ── Store state ────────────────────────────────────────────────

interface CustomerState {
  profiles: Record<string, CustomerProfile>;
  activeCustomerId: string | null;
  pendingFixture: PendingFixture | null;
  editingFixture: EditFixtureState | null;

  // Actions
  createProfile: (name: string) => string;
  duplicateProfile: (id: string, newName?: string) => string | null;
  deleteProfile: (id: string) => void;
  setActiveCustomer: (id: string | null) => void;
  updateProfile: (id: string, updates: Partial<CustomerProfile>) => void;
  setTemplate: (customerId: string, template: FixtureTemplate) => void;
  setPendingFixture: (pending: PendingFixture | null) => void;
  beginEditFixture: (subtype: FixtureSubtype, variant: string) => void;
  endEditFixture: () => void;
  getActiveTemplate: (subtype: FixtureSubtype, variant: string) => FixtureTemplate | null;

  // Phase 2.D
  updatePhaseStatus: (customerId: string, phase: ConstructionPhase, patch: Partial<{ status: string; scheduledDate: string; startedDate: string; completedDate: string; note: string }>) => void;
  searchProfiles: (query: string) => CustomerProfile[];
}

// ── Default template builders ──────────────────────────────────

function defaultToiletTemplate(): FixtureTemplate {
  return {
    subtype: 'water_closet',
    variant: 'Floor-Mount WC',
    category: 'toilet',
    modelName: 'Standard 1.28 GPF Floor-Mount',
    footprint: { width: 1.5, depth: 2.5, height: 2.5 },
    connections: {
      waste: { position: [0, 0, 0], diameter: 3 },
      cold:  { position: [0.5, 0.5, -0.5], diameter: 0.5 },
    },
    phases: {
      underground: [
        {
          id: 'wc-ug-closet-flange',
          kind: 'fixture_component',
          offset: [0, -0.1, 0],
          rotation: [0, 0, 0],
          label: 'Closet flange 3" PVC',
          cost: 12,
          partNumber: 'PVC-CF-3',
        },
        {
          id: 'wc-ug-3in-trap-adapter',
          kind: 'fitting',
          offset: [0, -0.5, 0],
          rotation: [0, 0, 0],
          fittingType: 'trap_adapter',
          diameter: 3,
          material: 'pvc_sch40',
          label: '3" P-trap adapter',
          cost: 8,
        },
      ],
      rough_in: [
        {
          id: 'wc-rin-cold-stub',
          kind: 'pipe',
          offset: [0.5, 0.8, -0.5],
          rotation: [0, 0, 0],
          diameter: 0.5,
          material: 'pex',
          length: 1.0,
          label: '1/2" cold supply stub-out',
          cost: 2,
        },
        {
          id: 'wc-rin-angle-stop',
          kind: 'fitting',
          offset: [0.5, 0.8, -0.4],
          rotation: [0, 0, 0],
          fittingType: 'angle_stop',
          diameter: 0.5,
          label: '1/2" × 3/8" angle stop (Brasscraft)',
          cost: 8,
        },
      ],
      trim: [
        {
          id: 'wc-tr-bowl',
          kind: 'fixture_component',
          offset: [0, 0.3, 0.5],
          rotation: [0, 0, 0],
          label: 'Toilet bowl (porcelain)',
          cost: 180,
          partNumber: 'TOILET-BOWL-STD',
        },
        {
          id: 'wc-tr-tank',
          kind: 'fixture_component',
          offset: [0, 0.8, 0],
          rotation: [0, 0, 0],
          label: 'Tank + flush valve',
          cost: 140,
          partNumber: 'TOILET-TANK-1.28',
        },
        {
          id: 'wc-tr-seat',
          kind: 'fixture_component',
          offset: [0, 0.7, 0.4],
          rotation: [0, 0, 0],
          label: 'Toilet seat',
          cost: 30,
        },
        {
          id: 'wc-tr-supply-line',
          kind: 'fitting',
          offset: [0.3, 0.7, -0.3],
          rotation: [0, 0, 0],
          fittingType: 'flex_supply',
          diameter: 0.375,
          label: '3/8" flex supply line (12")',
          cost: 6,
        },
      ],
    },
  };
}

function defaultShowerTemplate(): FixtureTemplate {
  return {
    subtype: 'shower',
    variant: 'Standard',
    category: 'shower',
    modelName: 'Standard 36×36 Shower Stall',
    footprint: { width: 3, depth: 3, height: 7 },
    connections: {
      waste: { position: [0, 0, 0], diameter: 2 },
      vent:  { position: [0, 3, 0], diameter: 1.5 },
      cold:  { position: [-1.5, 4, -1.4], diameter: 0.5 },
      hot:   { position: [-1.5, 4, -1.4], diameter: 0.5 },
    },
    phases: {
      underground: [
        {
          id: 'sh-ug-p-trap',
          kind: 'fitting',
          offset: [0, -0.5, 0],
          rotation: [0, 0, 0],
          fittingType: 'p_trap',
          diameter: 2,
          material: 'pvc_sch40',
          label: '2" PVC P-trap',
          cost: 14,
        },
        {
          id: 'sh-ug-shower-pan-drain',
          kind: 'fixture_component',
          offset: [0, 0, 0],
          rotation: [0, 0, 0],
          label: 'Shower drain body (Oatey)',
          cost: 35,
          partNumber: 'OATEY-130-42',
        },
      ],
      rough_in: [
        {
          id: 'sh-rin-hot-stub',
          kind: 'pipe',
          offset: [-1.5, 4, -1.4],
          rotation: [0, 0, 0],
          diameter: 0.5,
          material: 'pex',
          length: 0.5,
          label: '1/2" hot supply stub-out',
          cost: 1.5,
        },
        {
          id: 'sh-rin-cold-stub',
          kind: 'pipe',
          offset: [-1.0, 4, -1.4],
          rotation: [0, 0, 0],
          diameter: 0.5,
          material: 'pex',
          length: 0.5,
          label: '1/2" cold supply stub-out',
          cost: 1.5,
        },
        {
          id: 'sh-rin-hot-90',
          kind: 'fitting',
          offset: [-1.5, 4, -1.4],
          rotation: [0, Math.PI / 2, 0],
          fittingType: 'elbow_90',
          diameter: 0.5,
          material: 'pex',
          label: '1/2" PEX 90° elbow (hot) — auto-populated',
          cost: 1.2,
        },
        {
          id: 'sh-rin-cold-90',
          kind: 'fitting',
          offset: [-1.0, 4, -1.4],
          rotation: [0, Math.PI / 2, 0],
          fittingType: 'elbow_90',
          diameter: 0.5,
          material: 'pex',
          label: '1/2" PEX 90° elbow (cold) — auto-populated',
          cost: 1.2,
        },
        {
          id: 'sh-rin-valve-body',
          kind: 'fixture_component',
          offset: [-1.25, 4, -1.3],
          rotation: [0, 0, 0],
          label: 'Pressure-balance valve body (rough-in)',
          cost: 85,
        },
      ],
      trim: [
        {
          id: 'sh-tr-valve-trim',
          kind: 'fixture_component',
          offset: [-1.25, 4, -1.25],
          rotation: [0, 0, 0],
          label: 'Shower valve trim kit + handle',
          cost: 75,
        },
        {
          id: 'sh-tr-showerhead',
          kind: 'fixture_component',
          offset: [-1.25, 6.5, -1.3],
          rotation: [0, 0, 0],
          label: '2.0 GPM showerhead (WaterSense)',
          cost: 45,
        },
        {
          id: 'sh-tr-drain-cover',
          kind: 'fixture_component',
          offset: [0, 0.05, 0],
          rotation: [0, 0, 0],
          label: 'Chrome drain strainer',
          cost: 12,
        },
      ],
    },
  };
}

// ── Default customer profile ───────────────────────────────────

function createDefaultProfile(name: string): CustomerProfile {
  const toilet = defaultToiletTemplate();
  const shower = defaultShowerTemplate();
  return {
    id: `cust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    templates: {
      [`${toilet.subtype}|${toilet.variant}`]: toilet,
      [`${shower.subtype}|${shower.variant}`]: shower,
    },
    defaults: {
      wasteMaterial: 'pvc_sch40',
      supplyMaterial: 'pex',
      ventMaterial: 'pvc_sch40',
    },
    codes: ['IPC-2021'],
    markupPercent: 15,
    createdAt: new Date().toISOString(),
  };
}

// ── Store ───────────────────────────────────────────────────────

const DEFAULT_ID = 'default';
const DEFAULT_PROFILE = createDefaultProfile('Default (Generic Residential)');
DEFAULT_PROFILE.id = DEFAULT_ID;

export const useCustomerStore = create<CustomerState>((set, get) => ({
  profiles: { [DEFAULT_ID]: DEFAULT_PROFILE },
  activeCustomerId: DEFAULT_ID,
  pendingFixture: null,
  editingFixture: null,

  createProfile: (name) => {
    const profile = createDefaultProfile(name);
    profile.status = 'lead';
    profile.phaseSchedule = emptyPhaseSchedule();
    set((s) => ({ profiles: { ...s.profiles, [profile.id]: profile } }));
    return profile.id;
  },

  duplicateProfile: (id, newName) => {
    const src = get().profiles[id];
    if (!src) return null;
    const copy: CustomerProfile = JSON.parse(JSON.stringify(src));
    copy.id = `cust-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    copy.name = newName ?? `${src.name} (copy)`;
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;
    copy.phaseSchedule = emptyPhaseSchedule();
    set((s) => ({ profiles: { ...s.profiles, [copy.id]: copy } }));
    return copy.id;
  },

  deleteProfile: (id) => {
    if (id === DEFAULT_ID) return; // can't delete default
    set((s) => {
      const copy = { ...s.profiles };
      delete copy[id];
      return {
        profiles: copy,
        activeCustomerId: s.activeCustomerId === id ? DEFAULT_ID : s.activeCustomerId,
      };
    });
  },

  setActiveCustomer: (id) => set({ activeCustomerId: id }),

  updateProfile: (id, updates) => {
    set((s) => {
      const existing = s.profiles[id];
      if (!existing) return s;
      return { profiles: { ...s.profiles, [id]: { ...existing, ...updates, updatedAt: new Date().toISOString() } } };
    });
  },

  updatePhaseStatus: (customerId, phase, patch) => {
    set((s) => {
      const existing = s.profiles[customerId];
      if (!existing) return s;
      const schedule = existing.phaseSchedule ?? emptyPhaseSchedule();
      const current = schedule[phase];
      return {
        profiles: {
          ...s.profiles,
          [customerId]: {
            ...existing,
            phaseSchedule: {
              ...schedule,
              [phase]: { ...current, ...patch },
            },
            updatedAt: new Date().toISOString(),
          },
        },
      };
    });
  },

  searchProfiles: (query) => {
    const q = query.trim().toLowerCase();
    const all = Object.values(get().profiles);
    if (!q) return all;
    return all.filter((p) => {
      const hay = [
        p.name,
        p.notes ?? '',
        p.contact?.personName ?? '',
        p.contact?.companyName ?? '',
        p.contact?.phone ?? '',
        p.contact?.email ?? '',
        p.siteAddress?.street ?? '',
        p.siteAddress?.city ?? '',
        p.siteAddress?.state ?? '',
        p.siteAddress?.zip ?? '',
        p.crewLead ?? '',
        ...(p.tags ?? []),
      ].join(' ').toLowerCase();
      return hay.includes(q);
    });
  },

  setTemplate: (customerId, template) => {
    set((s) => {
      const existing = s.profiles[customerId];
      if (!existing) return s;
      const key = `${template.subtype}|${template.variant}`;
      return {
        profiles: {
          ...s.profiles,
          [customerId]: {
            ...existing,
            templates: { ...existing.templates, [key]: template },
          },
        },
      };
    });
  },

  setPendingFixture: (pending) => set({ pendingFixture: pending }),

  beginEditFixture: (subtype, variant) => {
    set({
      editingFixture: { subtype, variant, phase: 'rough_in' },
    });
  },

  endEditFixture: () => set({ editingFixture: null }),

  getActiveTemplate: (subtype, variant) => {
    const { profiles, activeCustomerId } = get();
    if (!activeCustomerId) return null;
    const profile = profiles[activeCustomerId];
    if (!profile) return null;
    return profile.templates[`${subtype}|${variant}`] ?? null;
  },
}));

// ── LocalStorage persistence ────────────────────────────────────

const STORAGE_KEY = 'elbow-grease-customers';

export function saveCustomersToStorage(): void {
  try {
    const s = useCustomerStore.getState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      profiles: s.profiles,
      activeCustomerId: s.activeCustomerId,
    }));
  } catch {}
}

export function loadCustomersFromStorage(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (data.profiles && typeof data.profiles === 'object') {
      useCustomerStore.setState({
        profiles: { [DEFAULT_ID]: DEFAULT_PROFILE, ...data.profiles },
        activeCustomerId: data.activeCustomerId ?? DEFAULT_ID,
      });
      return true;
    }
  } catch {}
  return false;
}

// Auto-save on change
if (typeof window !== 'undefined') {
  useCustomerStore.subscribe(() => {
    saveCustomersToStorage();
  });
}
