/**
 * Canonical event names and their payload shapes.
 *
 * Every event the simulation engine or UI can emit is defined here
 * so both sides share a single source of truth.
 *
 * ─── Naming convention (ARCHITECTURE.md §2) ─────────────────────
 *
 * **New events MUST follow this. Existing events are grandfathered
 * (see list below) — do NOT rename solely to satisfy the convention.**
 *
 * Pattern for the event-name KEY (left-hand side of `EV.`):
 *
 *   • **Domain-scoped events** — payload references entities from
 *     exactly one workspace (plumbing OR roofing):
 *        `EV.{DOMAIN}_{NOUN}_{VERB}`
 *        Examples:
 *          `EV.PLUMBING_PIPE_COMPLETE`
 *          `EV.ROOFING_SECTION_COMPLETE`
 *          `EV.ROOFING_PENETRATION_PLACED`
 *
 *   • **Shared events** — fired by the shell or a cross-domain
 *     feature (customer, pricing, file IO, app mode, selection):
 *        `EV.{NOUN}_{VERB}` (bare — no domain prefix)
 *        Examples:
 *          `EV.MODE_CHANGED`
 *          `EV.FILE_SAVED`
 *          `EV.SELECTION_CHANGED`
 *
 * Verb form:
 *   • **Past tense** (`_COMPLETE`, `_PLACED`, `_CHANGED`, `_SAVED`)
 *     for things that happened — this is the pub/sub convention.
 *   • **Imperative** (`.add`, `.remove`) lives on the CommandBus
 *     under `src/core/commands/` — NOT here.
 *
 * ─── Grandfathered identifiers (pre-convention) ─────────────────
 *
 * The entries below use the legacy colon-separated namespace form
 * (e.g. `'pipe:complete'` as the STRING value). Renaming them would
 * churn every subscriber + every log entry in every user's God Mode
 * console. Keep as-is until you're already editing the file that
 * owns them for another reason. The GRANDFATHER cutoff:
 *
 *   PIPE_*        — lifecycle events (drag/route/snap/complete/...)
 *   COLLISION_*   — spatial collision pairs
 *   CODE_*        — compliance ok / violation
 *   FIXTURE_*     — placement / params / selection / moved
 *   STATE_TRANSITION, MILESTONE  — FSM observability
 *   CUE, REWARD   — sensory-feedback triggers
 *
 * Everything added after Phase 8 of the hybrid-architecture
 * refactor follows the convention above.
 */

// ── Vec3 shorthand ──────────────────────────────────────────────
export type Vec3 = [x: number, y: number, z: number];

// ── Event name constants ────────────────────────────────────────
export const EV = {
  // Pipe lifecycle
  PIPE_DRAG_START:   'pipe:drag:start',
  PIPE_ROUTE_UPDATE: 'pipe:route:update',
  PIPE_SNAP:         'pipe:snap',
  PIPE_COMPLETE:     'pipe:complete',
  PIPE_CANCEL:       'pipe:cancel',
  PIPE_SELECTED:     'pipe:selected',
  PIPE_REMOVED:      'pipe:removed',

  // Spatial collision
  COLLISION_DETECTED: 'collision:detected',
  COLLISION_RESOLVED: 'collision:resolved',

  // Code compliance
  CODE_VIOLATION: 'compliance:violation',
  CODE_COMPLIANT: 'compliance:ok',

  // Fixture lifecycle
  FIXTURE_PLACED:         'fixture:placed',
  FIXTURE_REMOVED:        'fixture:removed',
  FIXTURE_SELECTED:       'fixture:selected',
  FIXTURE_PARAMS_CHANGED: 'fixture:params:changed',
  // Phase 14.AC.11 — position changes. Bridge listens so the
  // worker graph's fixture node elevation (and future: spatial
  // downstream recomputes) reflects moves rather than going stale.
  FIXTURE_MOVED:          'fixture:moved',

  // FSM state
  STATE_TRANSITION: 'fsm:transition',
  MILESTONE:        'fsm:milestone',

  // Feedback triggers (consumed by sensory UI)
  CUE:    'feedback:cue',
  REWARD: 'feedback:reward',
} as const;

export type EventName = (typeof EV)[keyof typeof EV];

// ── Payload types ───────────────────────────────────────────────

export interface PipeDragStartPayload {
  startPosition: Vec3;
  fixtureId: string;
}

export interface PipeRouteUpdatePayload {
  points: Vec3[];
  isValid: boolean;
  totalLength: number;
}

export interface PipeSnapPayload {
  position: Vec3;
  snapType: 'grid' | 'fixture' | 'pipe';
}

export interface PipeCompletePayload {
  id: string;
  points: Vec3[];
  diameter: number;
  material: string;
}

export interface CollisionPayload {
  position: Vec3;
  objectId: string;
  severity: 'warning' | 'error';
}

export interface ViolationPayload {
  ruleId: string;
  message: string;
  position: Vec3;
  codeRef: string;       // e.g. "IPC 906.1"
}

export interface FixturePayload {
  id: string;
  type: string;          // e.g. "toilet", "sink", "shower"
  position: Vec3;
  dfu: number;           // drainage fixture units
}

export interface StateTransitionPayload {
  from: string;
  to: string;
  event: string;
}

export interface MilestonePayload {
  id: string;
  label: string;
}

export interface CuePayload {
  type: 'glow' | 'pulse' | 'arrow' | 'highlight';
  targetId?: string;
  position?: Vec3;
  message?: string;
}

export interface RewardPayload {
  type: 'snap' | 'complete' | 'compliant' | 'milestone';
  position?: Vec3;
  intensity: number;     // 0-1 scale
}
