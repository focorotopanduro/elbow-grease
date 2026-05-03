interface Props {
  count?: number;
  /** intensity 0-1 — scales twinkle frequency + opacity peak */
  intensity?: number;
}

/**
 * Golden nuggets — three particle types woven through the page:
 *   - sparkle  : 4-point star catchlight, twinkles in burst pulses
 *   - flake    : small gold-leaf parallelogram, drifts upward with rotation
 *   - nugget   : tiny faceted gold dot with halo
 *
 * Replaces the previous bubble/orb language. Aetherial, light, drifting.
 * Pure CSS animations — GPU compositor only, ~250 bytes per type.
 */
export default function GoldenNuggets({ count = 24, intensity = 1 }: Props) {
  return (
    <div className="nuggets" aria-hidden="true" style={{ ['--n-intensity' as never]: intensity }}>
      {Array.from({ length: count }).map((_, i) => {
        const seed = (i * 37 + 13) % 100;
        const left = (seed * 7) % 100;
        const top = (seed * 11) % 100;
        const delay = (seed % 18) * -1;
        const dur = 12 + (seed % 14);
        // Distribute types: ~33% sparkle, ~33% flake, ~33% nugget
        const type = i % 3 === 0 ? 'sparkle' : i % 3 === 1 ? 'flake' : 'nugget';
        const rotate = (seed * 13) % 360;
        const size = type === 'sparkle' ? 8 + (seed % 8) : type === 'flake' ? 6 + (seed % 5) : 3 + (seed % 4);
        return (
          <span
            key={i}
            className={`nugget nugget--${type}`}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              width: `${size}px`,
              height: type === 'flake' ? `${Math.max(2, size / 2)}px` : `${size}px`,
              animationDelay: `${delay}s`,
              animationDuration: `${dur}s`,
              ['--n-rotate' as never]: `${rotate}deg`,
            }}
          />
        );
      })}
    </div>
  );
}
