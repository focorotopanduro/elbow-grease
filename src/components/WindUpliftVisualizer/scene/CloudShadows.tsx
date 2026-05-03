/**
 * CloudShadows — soft elliptical shadows drifting across the lawn,
 * implying clouds passing overhead. Animated via CSS keyframe (translateX
 * over a long period). Slower than the cloud layers themselves so the
 * eye reads it as "ground shadow of distant clouds" — a classic 3D depth
 * cue that requires zero geometry.
 *
 * Suppressed when the storm is dense (clouds completely cover the sky →
 * no patches of light to cast distinct shadows).
 */
interface Props {
  /** 0–1 storm intensity. Above ~0.6 the sky is overcast → no patch shadows. */
  storm: number;
  /** prefers-reduced-motion — disables the drift animation */
  reduced: boolean;
}

export default function CloudShadows({ storm, reduced }: Props) {
  // Patch shadows fade out as the sky becomes overcast
  const intensity = Math.max(0, Math.min(1, 1 - storm * 1.6)) * 0.55;
  if (intensity <= 0) return null;
  return (
    <g className="rh-cloud-shadows" aria-hidden="true" style={{ opacity: intensity }}>
      <ellipse
        cx="-200"
        cy="450"
        rx="260"
        ry="14"
        fill="#000"
        className={reduced ? '' : 'rh-cloud-shadow rh-cloud-shadow--1'}
      />
      <ellipse
        cx="-200"
        cy="455"
        rx="180"
        ry="10"
        fill="#000"
        className={reduced ? '' : 'rh-cloud-shadow rh-cloud-shadow--2'}
      />
      <ellipse
        cx="-200"
        cy="460"
        rx="220"
        ry="12"
        fill="#000"
        className={reduced ? '' : 'rh-cloud-shadow rh-cloud-shadow--3'}
      />
    </g>
  );
}
