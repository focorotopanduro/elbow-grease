/**
 * correlationId — tiny, dependency-free ID generator for command chains.
 *
 * Every dispatched command gets one. When one command fires as a side
 * effect of another (e.g. the solver emits PIPES_SIZED which dispatches
 * `pipe.updateDiameter`), the child command inherits the parent's
 * correlationId. That chain is what makes the God Mode console
 * debuggable — "why did this pipe get resized?" becomes a trivial
 * filter-by-correlationId in the log.
 *
 * ID format: `c_<epoch36>_<counter36>` — short, time-sortable, 14-16
 * chars typical. Not a UUID: we don't need global uniqueness, only
 * in-session uniqueness, and a 16-bit counter per millisecond is
 * plenty for a single-user CAD app.
 */

let seq = 0;

export function newCorrelationId(): string {
  seq = (seq + 1) & 0xffff;
  return `c_${Date.now().toString(36)}_${seq.toString(36)}`;
}

/**
 * Convenience: begin a correlation in one place (a user action) and
 * pass it down into every side-effecting command that descends from it.
 */
export function childCorrelationId(parent: string): string {
  const next = newCorrelationId();
  return `${parent}>${next}`;
}
