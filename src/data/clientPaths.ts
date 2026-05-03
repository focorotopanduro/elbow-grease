import { LICENSES } from '../components/dbprData';

export const CLIENT_PATH_STORAGE_KEY = 'beit_client_path_v1';
export const CLIENT_PATH_EVENT = 'beit:client-path-change';

export type ClientPathId = 'storm' | 'roof' | 'build' | 'manager';
export type ClientPathPriority = 'call-first' | 'estimate-first' | 'scope-first' | 'work-order';

export interface ClientPathStep {
  title: string;
  note: string;
}

export interface ClientPath {
  id: ClientPathId;
  label: string;
  shortLabel: string;
  eyebrow: string;
  title: string;
  body: string;
  recommendedService: string;
  priority: ClientPathPriority;
  contingency: string;
  intakePrompt: string;
  contactHint: string;
  messagePlaceholder: string;
  analyticsIntent: string;
  urgency: string;
  proof: string;
  primaryHref: string;
  primaryLabel: string;
  secondaryHref: string;
  secondaryLabel: string;
  steps: readonly string[];
  handoff: readonly ClientPathStep[];
}

const ROOF_LICENSE = LICENSES.find((license) => license.number.startsWith('CCC')) ?? LICENSES[0];
const GC_LICENSE = LICENSES.find((license) => license.number.startsWith('CGC')) ?? LICENSES[1] ?? LICENSES[0];
const LICENSE_PAIR = [ROOF_LICENSE?.number, GC_LICENSE?.number].filter(Boolean).join(' + ');

export const CLIENT_PATHS: readonly ClientPath[] = [
  {
    id: 'storm',
    label: 'Storm triage',
    shortLabel: 'Storm',
    eyebrow: 'Leak / damage',
    title: 'Route urgent roof uncertainty first.',
    body: 'For active leaks, lifted shingles, storm damage, or anything that needs photo documentation before the next weather window.',
    recommendedService: 'Roof repair or storm damage',
    priority: 'call-first',
    contingency: 'Call-first triage when water is active; form-first when photos and notes are enough.',
    intakePrompt: 'Leak, storm, or urgent roof condition',
    contactHint: 'Tell us what changed, whether water is active, and whether you have photos. If water is entering now, calling is the fastest route.',
    messagePlaceholder: 'What changed? Where is the leak or damage? Is water active now? Are photos, insurance claim details, or tarp needs involved?',
    analyticsIntent: 'storm_triage',
    urgency: 'Same-week inspection window when conditions allow',
    proof: `Roofing license ${ROOF_LICENSE?.number ?? 'CCC1337413'}`,
    primaryHref: 'tel:+14079426459',
    primaryLabel: 'Call Now',
    secondaryHref: '#contact',
    secondaryLabel: 'Send Details',
    steps: ['Describe what changed', 'We inspect and photograph', 'You get repair or replacement direction'],
    handoff: [
      { title: 'Triage', note: 'We separate active leak response from documentation-only roof concerns.' },
      { title: 'Document', note: 'Photos, visible water paths, and roof conditions get captured clearly.' },
      { title: 'Decide', note: 'You get repair, tarp, replacement, or claim-support direction.' },
    ],
  },
  {
    id: 'roof',
    label: 'Roof planning',
    shortLabel: 'Roof',
    eyebrow: 'Replacement path',
    title: 'Compare the roof decision without the sales fog.',
    body: 'For aging roofs, insurance timelines, material choices, and owners who need a measured replacement plan before committing.',
    recommendedService: 'Roof replacement',
    priority: 'estimate-first',
    contingency: 'Estimate-first route for replacement, material, schedule, and permit questions.',
    intakePrompt: 'Roof replacement or major roof planning',
    contactHint: 'Tell us roof age, material, timeline, and whether insurance or a sale deadline is involved.',
    messagePlaceholder: 'Roof age, current material, known leaks, insurance deadline, preferred material, HOA constraints, or timing goals.',
    analyticsIntent: 'roof_planning',
    urgency: 'Material, access, and timing reviewed up front',
    proof: `DBPR-active roofing license ${ROOF_LICENSE?.number ?? 'CCC1337413'}`,
    primaryHref: '#residential-roofing',
    primaryLabel: 'View Roof Work',
    secondaryHref: '#contact',
    secondaryLabel: 'Request Estimate',
    steps: ['Review roof condition', 'Match material and budget', 'Confirm the cleanest build path'],
    handoff: [
      { title: 'Assess', note: 'We review condition, age, material, ventilation, and visible risk.' },
      { title: 'Compare', note: 'Repair vs replacement, material fit, and timing get separated.' },
      { title: 'Estimate', note: 'You get a clear roof path with scope and next-step timing.' },
    ],
  },
  {
    id: 'build',
    label: 'Build scope',
    shortLabel: 'Build',
    eyebrow: 'Licensed construction',
    title: 'Connect structure, envelope, and finish work.',
    body: 'For remodels, additions, exterior updates, repairs, and scopes where one accountable contractor needs to coordinate connected trades.',
    recommendedService: 'General construction',
    priority: 'scope-first',
    contingency: 'Scope-first route for structural, permit, sequencing, and trade-dependency questions.',
    intakePrompt: 'Construction, renovation, repair, or connected trades',
    contactHint: 'Tell us the intended outcome, what already exists, and whether permits, structure, or finish work are part of the scope.',
    messagePlaceholder: 'What are you trying to build or change? What trades are involved? Any permits, plans, water damage, framing, or access constraints?',
    analyticsIntent: 'build_scope',
    urgency: 'Scope notes aligned before field time is spent',
    proof: `General contractor license ${GC_LICENSE?.number ?? 'CGC1534077'}`,
    primaryHref: '#general-construction',
    primaryLabel: 'View Build Work',
    secondaryHref: '#contact',
    secondaryLabel: 'Plan Scope',
    steps: ['Clarify the outcome', 'Identify trade dependencies', 'Set a practical sequence'],
    handoff: [
      { title: 'Clarify', note: 'We separate desired outcome from constraints, access, and existing conditions.' },
      { title: 'Sequence', note: 'Roofing, structure, finish, and permit dependencies get ordered.' },
      { title: 'Scope', note: 'You get a practical next move instead of a loose construction guess.' },
    ],
  },
  {
    id: 'manager',
    label: 'Manager desk',
    shortLabel: 'Manager',
    eyebrow: 'Repeat property work',
    title: 'Make vendor decisions easier to defend.',
    body: 'For managers, investors, and repeat clients who need licensing, documentation, bilingual coordination, and clean follow-through across properties.',
    recommendedService: 'Other or multiple services',
    priority: 'work-order',
    contingency: 'Work-order route for repeat scopes, tenant access, and multi-property documentation.',
    intakePrompt: 'Property manager, investor, or repeat-client work order',
    contactHint: 'Tell us how many properties, who controls access, and whether this is inspection, repair, bid, or repeat maintenance.',
    messagePlaceholder: 'Property count, address or area, tenant/access notes, recurring issue, documentation needs, deadline, and preferred communication flow.',
    analyticsIntent: 'manager_work_order',
    urgency: 'Designed around tenant access and repeat scopes',
    proof: `${LICENSE_PAIR || 'CCC1337413 + CGC1534077'} · bilingual EN/ES coordination`,
    primaryHref: '#contact',
    primaryLabel: 'Start Work Order',
    secondaryHref: '#services',
    secondaryLabel: 'Compare Services',
    steps: ['Share property context', 'We document conditions', 'You get a clean action record'],
    handoff: [
      { title: 'Context', note: 'Property count, access, tenant constraints, and urgency are captured first.' },
      { title: 'Record', note: 'Conditions and recommendations are documented for owner or board review.' },
      { title: 'Repeat', note: 'Follow-up scopes stay easier to compare across properties.' },
    ],
  },
] as const;

export function isClientPathId(value: unknown): value is ClientPathId {
  return CLIENT_PATHS.some((path) => path.id === value);
}

export function getClientPath(value?: unknown): ClientPath {
  const found = CLIENT_PATHS.find((path) => path.id === value);
  return found ?? CLIENT_PATHS[0];
}

export function getStoredClientPath(): ClientPathId | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CLIENT_PATH_STORAGE_KEY);
    return isClientPathId(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function setStoredClientPath(id: ClientPathId, source = 'unknown'): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CLIENT_PATH_STORAGE_KEY, id);
  } catch {
    /* localStorage can fail in private browsing; the live event still helps. */
  }
  window.dispatchEvent(
    new CustomEvent(CLIENT_PATH_EVENT, {
      detail: { id, source },
    }),
  );
}
