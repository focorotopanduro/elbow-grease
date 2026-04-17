/**
 * Generic Finite State Machine.
 *
 * Parameterised over State and Event string-literal unions so every
 * transition is fully type-checked at compile time.
 *
 * Supports:
 *  - enter / exit callbacks per state
 *  - guard predicates that can block a transition
 *  - action side-effects that fire when a transition is taken
 *  - external subscribers notified on every transition
 */

export interface TransitionTarget<S> {
  target: S;
  guard?: () => boolean;
  action?: () => void;
}

export type TransitionMap<S extends string, E extends string> = Partial<
  Record<E, S | TransitionTarget<S>>
>;

export interface StateNode<S extends string, E extends string> {
  on?: TransitionMap<S, E>;
  enter?: () => void;
  exit?: () => void;
}

export interface FSMConfig<S extends string, E extends string> {
  initial: S;
  states: Record<S, StateNode<S, E>>;
}

type Listener<S> = (current: S, previous: S, event: string) => void;

export class FSM<S extends string, E extends string> {
  private current: S;
  private readonly config: FSMConfig<S, E>;
  private listeners = new Set<Listener<S>>();

  constructor(config: FSMConfig<S, E>) {
    this.config = config;
    this.current = config.initial;
  }

  /** Current state (read-only). */
  get state(): S {
    return this.current;
  }

  /** Attempt a transition. Returns the resulting state. */
  send(event: E): S {
    const node = this.config.states[this.current];
    if (!node.on) return this.current;

    const edge = node.on[event];
    if (edge === undefined) return this.current;

    let target: S;
    if (typeof edge === 'string') {
      target = edge as S;
    } else {
      if (edge.guard && !edge.guard()) return this.current;
      target = edge.target;
      edge.action?.();
    }

    const prev = this.current;
    node.exit?.();
    this.current = target;
    this.config.states[target]?.enter?.();
    this.listeners.forEach((fn) => fn(this.current, prev, event));

    return this.current;
  }

  /** Check whether an event would cause a transition from the current state. */
  can(event: E): boolean {
    const node = this.config.states[this.current];
    if (!node.on) return false;
    const edge = node.on[event];
    if (edge === undefined) return false;
    if (typeof edge !== 'string' && edge.guard) return edge.guard();
    return true;
  }

  /** Subscribe to transitions. Returns an unsubscribe function. */
  subscribe(fn: Listener<S>): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Hard-reset to initial state (no callbacks fired). */
  reset(): void {
    this.current = this.config.initial;
  }
}
