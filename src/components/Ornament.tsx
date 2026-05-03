import './Ornament.css';

interface Props {
  variant?: 'light' | 'dark';
}

/**
 * Subtle section divider — thin line with a centered orange dot.
 * Use between major theme transitions (e.g. between dark + light sections).
 */
export default function Ornament({ variant = 'light' }: Props) {
  return (
    <div className={`ornament ornament--${variant}`} aria-hidden="true">
      <span className="ornament__line ornament__line--left" />
      <span className="ornament__mark">
        <span className="ornament__dot" />
      </span>
      <span className="ornament__line ornament__line--right" />
    </div>
  );
}
