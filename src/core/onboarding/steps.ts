/**
 * Onboarding steps — content + advancement triggers.
 *
 * Each step is small and self-contained. The OnboardingOverlay
 * subscribes to the event bus, and when a step's `advanceOn` event
 * fires it calls `onboardingStore.next()` automatically. Steps
 * without an event trigger use the "Next" button as the sole
 * advancement path.
 *
 * Philosophy:
 *   • 5 steps total. Shorter is better — users tune out past ~5.
 *   • Every step either teaches one concept OR shows one system
 *     responding to the user's input. No passive walls of text.
 *   • No step blocks the user. Skip is always available; closing
 *     mid-tutorial is a dismiss, not a failure.
 */

import { EV, type EventName } from '@core/events';

export type StepPlacement = 'center' | 'top-right' | 'bottom-center' | 'top-left' | 'bottom-right';

export interface OnboardingStep {
  /** Stable id — used for telemetry keying + focus management. */
  id: string;
  /** Short headline (under 40 chars). */
  title: string;
  /** Body copy. Supports plain text; newlines become paragraph breaks. */
  body: string;
  /**
   * Preferred placement of the coach-mark card. The card is a
   * floating element; placement is a hint, not a hard constraint.
   * When `targetSelector` is set and resolvable, we offset the card
   * relative to that element; otherwise we center per placement.
   */
  placement: StepPlacement;
  /**
   * Optional CSS selector for the element being taught. When present
   * and resolvable, the backdrop dims everything EXCEPT this element
   * and an arrow points at its bounding box.
   */
  targetSelector?: string;
  /**
   * If set, the step advances automatically when this event fires.
   * The user can still click "Next" manually at any time.
   */
  advanceOn?: EventName;
  /** Primary button label. Defaults to "Next" on all but the last step. */
  primaryLabel?: string;
  /** Label for the last step's primary button ("Got it"). */
  isFinal?: boolean;
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to ELBOW GREASE',
    body:
      "Let's walk through drawing your first plumbing run in under a minute.\n" +
      'You can skip at any time, and replay this walkthrough from the Help menu later.',
    placement: 'center',
    primaryLabel: 'Start',
  },
  {
    id: 'place-fixture',
    title: 'Place a fixture',
    body:
      'Press and hold Ctrl+F to open the fixture wheel, release to drop a ' +
      'toilet/sink/tub into the scene. Every fixture gets a supply + waste ' +
      'connection point — pipes snap to those.',
    placement: 'bottom-center',
    advanceOn: EV.FIXTURE_PLACED,
  },
  {
    id: 'draw-pipe',
    title: 'Draw a pipe',
    body:
      'Press D for Draw mode. Then click-drag from your fixture across empty ' +
      'space — a solid tube grows under your cursor. Release to commit.\n' +
      'The solver runs in a worker and sizes the pipe automatically based on ' +
      'its fixture-unit load.',
    placement: 'bottom-center',
    advanceOn: EV.PIPE_COMPLETE,
  },
  {
    id: 'see-compliance',
    title: 'Live code checking',
    body:
      'Green = compliant with IPC / UPC / NSPC. Red beacon = a violation with ' +
      'the exact code section (e.g. "IPC 704.1"). Open the trace with ' +
      'Ctrl+Shift+D to see the reasoning chain for any violation.',
    placement: 'top-right',
    // No advanceOn — the user may not trigger a violation on their
    // first pipe. Manual Next is fine.
  },
  {
    id: 'done',
    title: "You're ready",
    body:
      'Press ? at any time to see every keyboard shortcut.\n' +
      'Ctrl+E opens the customer list, Ctrl+Shift+P toggles the perf HUD, ' +
      'Ctrl+Z undoes any action. Happy plumbing.',
    placement: 'center',
    isFinal: true,
    primaryLabel: 'Got it',
  },
];
