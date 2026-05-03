interface Props {
  count?: number;
  size?: 'sm' | 'mix';
}

/**
 * Decorative drifting gold orbs. Sit behind dark sections so the glass cards
 * have something for their backdrop-blur to refract. Pure CSS animation —
 * cheap, GPU-only.
 */
export default function GoldParticles({ count = 14, size = 'mix' }: Props) {
  // Deterministic positions so the layout is stable across renders
  return (
    <div className="gold-particles" aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => {
        const seed = (i * 37 + 13) % 100;
        const left = (seed * 7) % 100;
        const top = (seed * 11) % 100;
        const delay = (seed % 16) * -1;
        const dur = 14 + (seed % 8);
        const cls =
          size === 'mix'
            ? i % 4 === 0
              ? 'gold-particle--xl'
              : i % 3 === 0
              ? 'gold-particle--lg'
              : ''
            : '';
        return (
          <span
            key={i}
            className={`gold-particle ${cls}`}
            style={{
              left: `${left}%`,
              top: `${top}%`,
              animationDelay: `${delay}s`,
              animationDuration: `${dur}s`,
            }}
          />
        );
      })}
    </div>
  );
}
