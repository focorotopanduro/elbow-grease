import type { ViewMode } from './useViewMode';

interface Props {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

/**
 * ViewModeToggle — pill-tab strip that swaps the simulator between the
 * homeowner-friendly Front view and the engineer-friendly Isometric view.
 *
 * Sits above the scene (between header and viz). Active tab gets a gold
 * ring + brushed-gold label. Touch-friendly hit targets (≥44px).
 */
export default function ViewModeToggle({ mode, onChange }: Props) {
  return (
    <div className="vmt" role="tablist" aria-label="View mode">
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'front'}
        className={`vmt__tab ${mode === 'front' ? 'is-active' : ''}`}
        onClick={() => onChange('front')}
      >
        <span className="vmt__icon" aria-hidden="true">
          <svg viewBox="0 0 24 16" width="20" height="14">
            {/* Tiny front-elevation house glyph */}
            <polygon points="2,8 12,2 22,8" fill="currentColor" opacity="0.6" />
            <rect x="2" y="8" width="20" height="6" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <rect x="10" y="10" width="4" height="4" fill="currentColor" opacity="0.7" />
          </svg>
        </span>
        <span className="vmt__label">
          <strong>Front</strong>
          <span>Homeowner view</span>
        </span>
      </button>

      <button
        type="button"
        role="tab"
        aria-selected={mode === 'iso'}
        className={`vmt__tab ${mode === 'iso' ? 'is-active' : ''}`}
        onClick={() => onChange('iso')}
      >
        <span className="vmt__icon" aria-hidden="true">
          <svg viewBox="0 0 24 16" width="20" height="14">
            {/* Tiny iso-projection house glyph */}
            <polygon points="2,11 12,5 22,11 12,17" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <line x1="12" y1="5" x2="12" y2="11" stroke="currentColor" strokeWidth="1" />
            <polygon points="12,5 22,1 22,11 12,11" fill="currentColor" opacity="0.4" />
          </svg>
        </span>
        <span className="vmt__label">
          <strong>Isometric</strong>
          <span>Engineer view</span>
        </span>
      </button>
    </div>
  );
}
