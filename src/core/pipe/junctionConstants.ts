/**
 * Junction tolerance constants — Phase 14.AD.14.
 *
 * The single source of truth for "these two pipe endpoints are at
 * the same vertex" across every subsystem that needs that
 * classification:
 *
 *   • FittingGenerator — deciding whether to emit a junction fitting
 *     between two pipes.
 *   • pipeCollision — clustering endpoints when checking interference.
 *   • hotSupplyPropagation — graph-walking which pipes touch.
 *   • condensateValidation — clustering drain endpoints at receptors.
 *   • PipeRenderer / PipeInstanceRenderer — deciding which pipe
 *     endpoints to retract for fitting-hub clearance.
 *
 * Historical note: AD.7 and AD.8 shipped with `TOL = 0.1` inlined in
 * the two renderers while the other four consumers used `0.15`. That
 * meant a fitting could emit at a junction (FittingGenerator's 0.15
 * threshold caught it) while the renderer didn't retract (its
 * stricter 0.1 didn't). The fitting would overlap the pipe body.
 * AD.14 consolidates to one value AND aligns the renderers with the
 * authoritative 0.15.
 *
 * Why 0.15 ft (1.8 inches):
 *   Pipe draw snap grid is 0.5 ft. Adjacent pipes routed on the same
 *   grid cell share an endpoint exactly; diagonally-adjacent cells
 *   produce an endpoint separation of sqrt(2) * 0.5 ≈ 0.707 ft. A
 *   0.15 ft threshold is generous enough to absorb floating-point
 *   drift + small user nudges (e.g. click at 0.51 and 0.49) while
 *   well below any intentional spatial separation. Tuned by field
 *   usage, not code-math — change with care.
 */

/**
 * Maximum distance (in feet) at which two pipe endpoints are
 * considered to meet at the same junction vertex. All subsystems
 * involved in junction classification should use this.
 */
export const JUNCTION_TOLERANCE_FT = 0.15;

/** Squared tolerance — useful for distance-comparison hot loops
 *  that want to avoid a `Math.sqrt`. */
export const JUNCTION_TOLERANCE_FT_SQ = JUNCTION_TOLERANCE_FT * JUNCTION_TOLERANCE_FT;
