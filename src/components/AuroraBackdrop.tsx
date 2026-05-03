/**
 * Aetherial drifting gold-aurora light beams + a periodic shimmer sweep.
 * Pure CSS animation — three layered radial gradients with a screen-blended
 * diagonal shimmer that crosses the section every 14 seconds.
 */
export default function AuroraBackdrop() {
  return (
    <div className="aurora" aria-hidden="true">
      <span className="aurora__beam aurora__beam--1" />
      <span className="aurora__beam aurora__beam--2" />
      <span className="aurora__beam aurora__beam--3" />
      <span className="aurora__beam aurora__beam--shimmer" />
    </div>
  );
}
