import './AwardsRow.css';

/**
 * AwardsRow — horizontal strip of small credential / membership badges.
 *
 * HONESTY POLICY: each entry has a `live: boolean` field. The component
 * renders ONLY entries with `live === true`. This prevents the site
 * from displaying memberships Beit hasn't earned (e.g., GAF Master
 * Elite badge before the actual program enrollment is complete).
 *
 * Owner action: when a membership is earned, flip the corresponding
 * `live` to `true` and supply a verifiable URL when applicable.
 *
 * VARIANTS:
 *   - `subtle` — minimal monochrome chips, suitable for the Hero
 *     (subtle trust hint without competing with primary CTA)
 *   - `full` — full-color cards with subtitle, suitable for the
 *     CredentialsWall section
 *
 * The DBPR Florida-Licensed entry is unconditionally live (Beit has
 * confirmed both CCC1337413 + CGC1534077). Everything else starts
 * `live: false`.
 */

export interface AwardEntry {
  /** Stable id for React keys + CSS targeting. */
  id: string;
  /** Short title — fits in a small chip at small sizes. */
  title: string;
  /** Subtitle — only shown in 'full' variant. */
  subtitle?: string;
  /** Inline SVG or a brand asset URL. */
  icon: React.ReactNode;
  /** Optional verifiable link — opens in new tab when set. */
  href?: string;
  /**
   * Whether to render this badge. NEVER set to true for a membership
   * Beit hasn't actually earned — the site's credibility depends on
   * accurate self-representation.
   */
  live: boolean;
  /** Internal note for owner — explains what unlocks `live: true`. */
  todoNote?: string;
}

/* ─── Icon SVGs ──────────────────────────────────────────────────────── */

const FloridaSealIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="6" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
  </svg>
);

const ShingleIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7h18l-2 4H5L3 7z" />
    <path d="M5 11h14l-1 4H6l-1-4z" />
    <path d="M6 15h12l-1 4H7l-1-4z" />
  </svg>
);

const StarIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const CheckShieldIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 2 4 5v7c0 4.5 3.4 8.7 8 10 4.6-1.3 8-5.5 8-10V5l-8-3z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
);

/* ─── The award registry ─────────────────────────────────────────────── */

export const AWARDS: AwardEntry[] = [
  {
    id: 'florida-licensed',
    title: 'Florida State Licensed',
    subtitle: 'Two active DBPR licenses (CCC1337413 + CGC1534077)',
    icon: <FloridaSealIcon />,
    href: 'https://www.myfloridalicense.com/wl11.asp?mode=1&search=LicNbr',
    live: true,
  },
  {
    id: 'frsa-member',
    title: 'FRSA Member',
    subtitle: 'Florida Roofing & Sheet Metal Contractors Association',
    icon: <ShingleIcon />,
    href: 'https://www.floridaroof.com/',
    live: false,
    // TODO (owner): join FRSA + flip live: true once member badge is earned
    // (~$300-500/yr membership). FRSA member directory becomes a sameAs entry.
    todoNote: 'Awaiting FRSA membership',
  },
  {
    id: 'gaf-master-elite',
    title: 'GAF Master Elite',
    subtitle: 'Top 3% of GAF-installing contractors',
    icon: <StarIcon />,
    href: 'https://www.gaf.com/en-us/roofing-contractors/master-elite',
    live: false,
    // TODO (owner): apply when GAF install volume + warranty record qualify.
    // Master Elite is a strong differentiator — worth pursuing if Beit's
    // GAF Timberline volume justifies the application work.
    todoNote: 'Awaiting GAF Master Elite enrollment',
  },
  {
    id: 'owens-corning-preferred',
    title: 'Owens Corning Preferred',
    subtitle: 'Preferred Contractor program',
    icon: <StarIcon />,
    href: 'https://www.owenscorning.com/roofing/contractors',
    live: false,
    // TODO (owner): apply if/when Owens Corning install volume justifies.
    todoNote: 'Awaiting Owens Corning Preferred enrollment',
  },
  {
    id: 'bbb-accredited',
    title: 'BBB Accredited',
    subtitle: 'Better Business Bureau Accredited Business',
    icon: <CheckShieldIcon />,
    live: false,
    // TODO (owner): claim BBB profile + complete accreditation (~$500-700/yr).
    // This is S-tier per docs/citations-master-list.md — high local-search lift.
    todoNote: 'Awaiting BBB accreditation',
  },
  {
    id: 'nrca-member',
    title: 'NRCA Member',
    subtitle: 'National Roofing Contractors Association',
    icon: <CheckShieldIcon />,
    href: 'https://www.nrca.net/',
    live: false,
    // TODO (owner): NRCA membership for trade-association credibility.
    todoNote: 'Awaiting NRCA membership',
  },
];

export interface AwardsRowProps {
  /** Visual variant — see component docblock. */
  variant?: 'subtle' | 'full';
  /** Optional className for layout-specific tweaks. */
  className?: string;
}

export default function AwardsRow({
  variant = 'subtle',
  className = '',
}: AwardsRowProps) {
  const liveAwards = AWARDS.filter((a) => a.live);
  if (liveAwards.length === 0) return null;

  return (
    <ul
      className={`awards awards--${variant} ${className}`}
      role="list"
      aria-label="Verifiable credentials and memberships"
    >
      {liveAwards.map((award) => {
        const inner = (
          <>
            <span className="awards__icon" aria-hidden="true">{award.icon}</span>
            <span className="awards__text">
              <span className="awards__title">{award.title}</span>
              {variant === 'full' && award.subtitle && (
                <span className="awards__subtitle">{award.subtitle}</span>
              )}
            </span>
          </>
        );

        return (
          <li key={award.id} className="awards__item">
            {award.href ? (
              <a
                href={award.href}
                target="_blank"
                rel="noopener noreferrer"
                className="awards__link"
                aria-label={`Verify ${award.title}`}
              >
                {inner}
                {variant === 'full' && (
                  <span className="awards__verify" aria-hidden="true">↗</span>
                )}
              </a>
            ) : (
              <span className="awards__static">{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
