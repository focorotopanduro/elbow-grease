/**
 * Decoupled Observer / Pub-Sub event system.
 *
 * The plumbing simulation engine broadcasts lightweight messages here
 * (pipe snapped, code violation, fixture placed). Visual and audio
 * subsystems subscribe and react — the engine never references them
 * directly. This keeps the core simulation fast and uncluttered.
 */

type Handler<T = unknown> = (payload: T) => void;

class EventBus {
  private channels = new Map<string, Set<Handler>>();
  private history: { event: string; payload: unknown; ts: number }[] = [];
  private historyLimit = 200;

  /** Subscribe. Returns an unsubscribe function. */
  on<T>(event: string, handler: Handler<T>): () => void {
    if (!this.channels.has(event)) {
      this.channels.set(event, new Set());
    }
    this.channels.get(event)!.add(handler as Handler);
    return () => this.off(event, handler);
  }

  /** Subscribe for a single firing, then auto-unsubscribe. */
  once<T>(event: string, handler: Handler<T>): () => void {
    const wrapper: Handler<T> = (payload) => {
      this.off(event, wrapper);
      handler(payload);
    };
    return this.on(event, wrapper);
  }

  /** Unsubscribe a specific handler. */
  off<T>(event: string, handler: Handler<T>): void {
    this.channels.get(event)?.delete(handler as Handler);
  }

  /** Broadcast an event to all subscribers. */
  emit<T>(event: string, payload: T): void {
    this.history.push({ event, payload, ts: performance.now() });
    if (this.history.length > this.historyLimit) {
      this.history.shift();
    }
    this.channels.get(event)?.forEach((h) => h(payload));
  }

  /** Read recent event history (useful for debugging / replay). */
  getHistory() {
    return [...this.history];
  }

  /** Tear down all subscriptions (e.g. on scene reset). */
  clear(): void {
    this.channels.clear();
    this.history.length = 0;
  }
}

/** Singleton — one bus per application. */
export const eventBus = new EventBus();
export type { Handler };
