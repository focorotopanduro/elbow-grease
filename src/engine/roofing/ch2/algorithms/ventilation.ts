/**
 * ALG-017 — Attic ventilation gate.
 *
 * Source: spec §6 ALG-017. Book §2H.
 *
 * ─── Why this gate fires ──────────────────────────────────────
 *
 * Solid roof sheathing traps moisture in the attic — there's no
 * gap between boards for air to move through. An UNVENTED attic
 * combined with a SOLID deck creates a condensation trap: warm
 * moist air from the living space rises, hits the cold underside
 * of the sheathing, condenses, rots the deck + underlayment, and
 * eventually produces mold, ice dams, and shingle warping.
 *
 * §2H requires attic ventilation when the deck is solid. The
 * gate:
 *   - SOLID sheathing + unvented attic   → warn + corrective work
 *   - SOLID sheathing + vented attic     → OK (no flag)
 *   - SPACED sheathing (any)             → OK regardless of venting
 *
 * Spaced sheathing breathes naturally through the gaps between
 * boards; ventilation from within the attic is redundant (but
 * not harmful). So spaced-sheathing roofs don't fire this gate,
 * even when the attic is unvented.
 *
 * ─── Spec §10 edge-case matrix rows ───────────────────────────
 *
 *   sheathing_type             | has_vented_attic | result
 *   ---------------------------|------------------|-----------------
 *   solid                      |   false          | flag (E-018)
 *   solid                      |   true           | null
 *   spaced_with_solid_zones    |   false          | null (E-019)
 *   spaced_with_solid_zones    |   true           | null
 *   spaced_over_solid_hybrid   |   false          | null
 *   spaced_over_solid_hybrid   |   true           | null
 *
 * ─── Remediation copy ─────────────────────────────────────────
 *
 * The flag's remediation specifically tells the estimator to
 * ADD a line item for vent corrective work. Costing follows in
 * ALG-020 (cost engine) — the flag is both a UI warning and a
 * trigger for the cost engine's adder list.
 *
 * Pure function — returns at most one `WarningFlag` per call.
 */

import type { SheathingType, WarningFlag } from '../types';

/**
 * Return a ventilation warning iff the sheathing type + attic
 * venting combination fails the §2H gate.
 *
 * @param sheathing_type    From ALG-001 or a manual spec. Only
 *                          `'solid'` can trigger the flag.
 * @param has_vented_attic  True when the attic has continuous
 *                          or ridge-vented airflow per code.
 *
 * @returns `WarningFlag` with code `'ventilation_insufficient'`
 *          when the gate fires, otherwise `null`.
 */
export function check_attic_ventilation(
  sheathing_type: SheathingType,
  has_vented_attic: boolean,
): WarningFlag | null {
  if (sheathing_type !== 'solid') {
    // Spaced roofs breathe through the board gaps — ventilation
    // from within the attic isn't required by §2H.
    return null;
  }

  if (has_vented_attic) {
    // Solid deck + vented attic = compliant. No flag.
    return null;
  }

  // Solid deck + UNVENTED attic: §2H gate fires.
  return {
    code: 'ventilation_insufficient',
    severity: 'warning',
    message:
      'Solid roof sheathing with an unvented attic will trap ' +
      'moisture against the underside of the deck (§2H). This ' +
      'causes condensation, rot, mold, and shingle warping.',
    remediation:
      'Add vent corrective work to the bid — ridge vent, soffit ' +
      'vents, or a powered attic fan sized per NFPA 90A. Cost ' +
      'engine should surface this as an adder line item.',
  };
}
