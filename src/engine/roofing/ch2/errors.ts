/**
 * Chapter 2 — typed error hierarchy.
 *
 * Port of Python spec §5. Every rule violation surfaces as one of
 * these classes; the UI can `instanceof` on `Ch2Error` to render
 * the right severity chrome and a consumer can catch specific
 * subclasses to apply corrective logic.
 *
 * Naming rationale: JavaScript's `Error.name` drives `toString()`,
 * stack traces, and some browser devtools labels. Each subclass
 * sets `this.name` to its class name so stacks are readable
 * regardless of minification.
 */

/** Base exception for Chapter 2 rule violations. All Ch2-specific
 *  errors extend this so consumers can catch the category. */
export class Ch2Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Ch2Error';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Hard rule from the book violated by the chosen spec. */
export class SheathingSpecViolation extends Ch2Error {
  constructor(message: string) {
    super(message);
    this.name = 'SheathingSpecViolation';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Dead load exceeds what the frame/panel can support. */
export class LoadCapacityExceeded extends Ch2Error {
  constructor(message: string) {
    super(message);
    this.name = 'LoadCapacityExceeded';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** A required input is missing (rate, SKU, dimension, etc.). */
export class MissingRequiredInput extends Ch2Error {
  constructor(message: string) {
    super(message);
    this.name = 'MissingRequiredInput';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Covering is not in the enum — caller bug. */
export class UnknownCoveringType extends Ch2Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnknownCoveringType';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Impossible geometry (slope < 0, area ≤ 0, negative spacing). */
export class InvalidGeometry extends Ch2Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidGeometry';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** High-humidity climate declared but standard gaps applied. */
export class HumidityGapMismatch extends Ch2Error {
  constructor(message: string) {
    super(message);
    this.name = 'HumidityGapMismatch';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** No RateSet was provided or the version is stale. */
export class RateSetMissing extends Ch2Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateSetMissing';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** No APA panel in Table 21 satisfies the load + spacing. */
export class PanelSelectionFailed extends Ch2Error {
  constructor(message: string) {
    super(message);
    this.name = 'PanelSelectionFailed';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
