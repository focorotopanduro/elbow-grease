/**
 * Cue → Routine → Reward feedback loop manager.
 *
 * Subscribes to EventBus signals and emits sensory feedback events
 * that the visual/audio layer consumes. This is the bridge between
 * "something happened in the engine" and "the user sees/hears/feels
 * a response."
 *
 * The three-phase cycle (from game design HCI research):
 *   CUE     — "What should I do?"   → glow, pulse, directional arrow
 *   ROUTINE — "I'm doing it."       → ghost preview, flow animation
 *   REWARD  — "I did it!"           → snap FX, completion burst, sound
 */

import { eventBus } from './EventBus';
import {
  EV,
  type CuePayload,
  type RewardPayload,
  type StateTransitionPayload,
  type PipeSnapPayload,
  type PipeCompletePayload,
  type CollisionPayload,
  type ViolationPayload,
} from './events';

// ── Cue emitters ────────────────────────────────────────────────

function emitCue(cue: CuePayload) {
  eventBus.emit(EV.CUE, cue);
}

function emitReward(reward: RewardPayload) {
  eventBus.emit(EV.REWARD, reward);
}

// ── Listeners ───────────────────────────────────────────────────

/** When the FSM enters a new state, fire appropriate cues. */
function onStateTransition(payload: StateTransitionPayload) {
  switch (payload.to) {
    case 'idle':
      // User is idle — pulse available attachment points
      emitCue({ type: 'pulse', message: 'Select a fixture to begin' });
      break;

    case 'selecting':
      // Fixture selected — glow connected nodes
      emitCue({ type: 'glow', message: 'Drag to start routing' });
      break;

    case 'routing':
      // Actively routing — show directional arrows along valid paths
      emitCue({ type: 'arrow', message: 'Route your pipe' });
      break;

    case 'previewing':
      // Route complete — highlight the confirm action
      emitCue({ type: 'highlight', message: 'Press Enter to confirm' });
      break;

    case 'confirming':
      // Commit succeeded — big reward
      emitReward({ type: 'complete', intensity: 1.0 });
      break;

    case 'violation':
      // Error — red highlight cue
      emitCue({ type: 'highlight', message: 'Fix the violation to continue' });
      break;
  }
}

/** A pipe segment snapped into place — small reward. */
function onPipeSnap(payload: PipeSnapPayload) {
  emitReward({ type: 'snap', position: payload.position, intensity: 0.4 });
}

/** An entire pipe route was committed — large reward. */
function onPipeComplete(payload: PipeCompletePayload) {
  const mid = payload.points[Math.floor(payload.points.length / 2)];
  emitReward({ type: 'complete', position: mid, intensity: 1.0 });
}

/** Collision detected — urgent red cue at the collision site. */
function onCollision(payload: CollisionPayload) {
  emitCue({
    type: 'highlight',
    position: payload.position,
    message: 'Collision — reroute to avoid obstacle',
  });
}

/** Code violation — red highlight with code reference. */
function onViolation(payload: ViolationPayload) {
  emitCue({
    type: 'highlight',
    position: payload.position,
    message: `${payload.codeRef}: ${payload.message}`,
  });
}

/** Violation resolved — small compliant reward. */
function onCompliant() {
  emitReward({ type: 'compliant', intensity: 0.6 });
}

// ── Bootstrap ───────────────────────────────────────────────────

let booted = false;

/** Call once at app startup to wire all feedback listeners. */
export function bootFeedbackLoop() {
  if (booted) return;
  booted = true;

  eventBus.on<StateTransitionPayload>(EV.STATE_TRANSITION, onStateTransition);
  eventBus.on<PipeSnapPayload>(EV.PIPE_SNAP, onPipeSnap);
  eventBus.on<PipeCompletePayload>(EV.PIPE_COMPLETE, onPipeComplete);
  eventBus.on<CollisionPayload>(EV.COLLISION_DETECTED, onCollision);
  eventBus.on<ViolationPayload>(EV.CODE_VIOLATION, onViolation);
  eventBus.on(EV.CODE_COMPLIANT, onCompliant);
}
