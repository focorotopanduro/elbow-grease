/**
 * User Progress FSM — models the user's real-time interaction state.
 *
 * Replaces static error dialogs entirely. The FSM continuously tracks
 * what the user is doing so the sensory feedback layer always knows
 * which cues, routines, and rewards to deliver.
 *
 * States map to distinct UX modes:
 *   idle        → waiting for input, attachment points glow
 *   selecting   → fixture or node highlighted, context hints visible
 *   routing     → actively dragging a pipe route, ghost preview shown
 *   previewing  → route drawn but uncommitted, validation running
 *   confirming  → route is valid, commit animation plays
 *   violation   → code/collision error detected, red highlights active
 */

import { FSM, type FSMConfig } from './FSM';
import { eventBus } from './EventBus';
import { EV, type StateTransitionPayload } from './events';

// ── State & event unions ────────────────────────────────────────

export type UserState =
  | 'idle'
  | 'selecting'
  | 'routing'
  | 'previewing'
  | 'confirming'
  | 'violation';

export type UserEvent =
  | 'SELECT_FIXTURE'
  | 'DESELECT'
  | 'START_ROUTE'
  | 'UPDATE_ROUTE'
  | 'FINISH_ROUTE'
  | 'CONFIRM'
  | 'CANCEL'
  | 'VIOLATION_DETECTED'
  | 'VIOLATION_RESOLVED';

// ── FSM definition ──────────────────────────────────────────────

const config: FSMConfig<UserState, UserEvent> = {
  initial: 'idle',
  states: {
    idle: {
      on: {
        SELECT_FIXTURE: 'selecting',
      },
    },
    selecting: {
      on: {
        START_ROUTE: 'routing',
        DESELECT:    'idle',
        CANCEL:      'idle',
      },
    },
    routing: {
      on: {
        FINISH_ROUTE:       'previewing',
        VIOLATION_DETECTED: 'violation',
        CANCEL:             'idle',
      },
    },
    previewing: {
      on: {
        CONFIRM:            'confirming',
        VIOLATION_DETECTED: 'violation',
        CANCEL:             'routing',
      },
    },
    confirming: {
      on: {
        // Auto-transitions back to idle after commit animation
        DESELECT: 'idle',
      },
    },
    violation: {
      on: {
        VIOLATION_RESOLVED: 'routing',
        CANCEL:             'idle',
      },
    },
  },
};

// ── Singleton instance ──────────────────────────────────────────

export const userFSM = new FSM<UserState, UserEvent>(config);

// Bridge every FSM transition onto the EventBus so the decoupled
// sensory layer can react without importing the FSM directly.
userFSM.subscribe((current, previous, event) => {
  eventBus.emit<StateTransitionPayload>(EV.STATE_TRANSITION, {
    from: previous,
    to: current,
    event,
  });
});
