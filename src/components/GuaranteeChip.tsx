import type { ReactNode } from 'react';
import './GuaranteeChip.css';

/**
 * GuaranteeChip — small reusable trust-signal chip.
 *
 * Used as inline trust signals throughout the site:
 *   - Contact section intro ("Free Inspection", "No-Obligation Quote")
 *   - BookingWidget advantages list
 *   - City page hero strip
 *   - FAQ section header
 *
 * Three visual variants:
 *   - 'gold' (default) — primary trust signal, gold border + gold text
 *   - 'cream' — neutral, for use on dark sections
 *   - 'orange' — emphasis variant for urgency ("24/7 Storm Response")
 *
 * Keep the label short — chips read best at 1-3 words. For longer copy,
 * use a CredentialBadge in CredentialsWall instead.
 */

export interface GuaranteeChipProps {
  /** Optional icon — emoji, SVG, or ReactNode. Falls back to a checkmark. */
  icon?: ReactNode;
  /** Chip label. 1-3 words ideal. */
  label: string;
  /** Visual variant. */
  variant?: 'gold' | 'cream' | 'orange';
  /** Additional className for layout-specific tweaks. */
  className?: string;
}

const DefaultCheck = () => (
  <svg viewBox="0 0 20 20" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="5 10 9 14 15 6" />
  </svg>
);

export default function GuaranteeChip({
  icon,
  label,
  variant = 'gold',
  className = '',
}: GuaranteeChipProps) {
  return (
    <span className={`gchip gchip--${variant} ${className}`}>
      <span className="gchip__icon" aria-hidden="true">
        {icon ?? <DefaultCheck />}
      </span>
      <span className="gchip__label">{label}</span>
    </span>
  );
}
