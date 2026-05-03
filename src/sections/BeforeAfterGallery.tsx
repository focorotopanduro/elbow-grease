import BeforeAfterSlider from '../components/BeforeAfterSlider';
import {
  formatProjectDate,
  hasProjectPhotos,
  labelForCity,
  labelForService,
  PROJECTS,
} from '../data/projects';
import './BeforeAfterGallery.css';

/**
 * Before/after proof block.
 *
 * The project data may include planned image paths before the owner has
 * approved those photos for public use. We only mount sliders for projects
 * explicitly marked photoStatus: 'available'; pending projects render as
 * polished proof cards so local/prod builds do not throw image 404s.
 */

const COMPARISONS = PROJECTS
  .filter((p) => hasProjectPhotos(p) && p.beforeImage && p.afterImage)
  .slice(0, 3);

const PENDING_PROOF = PROJECTS
  .filter((p) => !hasProjectPhotos(p))
  .slice(0, 3);

export default function BeforeAfterGallery() {
  const hasComparisons = COMPARISONS.length > 0;

  return (
    <section
      className="bag section section--dark"
      aria-label="Before and after project gallery"
    >
      <div className="container">
        <header className="bag__header reveal">
          <p className="eyebrow eyebrow--gold">
            {hasComparisons ? 'Before & After' : 'Proof Queue'}
          </p>
          <h2 className="bag__title">
            {hasComparisons ? (
              <>
                Real Florida projects, <em>side by side</em>
              </>
            ) : (
              <>
                Project proof, <em>queued for approval</em>
              </>
            )}
          </h2>
          <p className="bag__lead">
            {hasComparisons
              ? 'Drag the gold handle on each photo to see the same roof before and after we worked on it. Same angle, same lighting, just the craftsmanship in between.'
              : 'Matched before-and-after photo sets are being curated for public use. Until those images are approved, these cards preserve the project story without loading missing files.'}
          </p>
        </header>

        {hasComparisons ? (
          <ul className="bag__grid" role="list">
            {COMPARISONS.map((p) => (
              <li key={p.id} className="bag__item reveal">
                <BeforeAfterSlider
                  before={p.beforeImage!}
                  after={p.afterImage!}
                  alt={p.title}
                  caption={`${p.title} - ${p.neighborhood}, ${labelForCity(p.city)}`}
                />
              </li>
            ))}
          </ul>
        ) : (
          <ul className="bag__grid bag__proof-grid" role="list">
            {PENDING_PROOF.map((p) => (
              <li key={p.id} className="bag__item reveal">
                <article className="bag__proof-card">
                  <span className="bag__proof-status">Photo set pending</span>
                  <span className="bag__proof-service">
                    {labelForService(p.serviceCategory)}
                  </span>
                  <h3>{p.title}</h3>
                  <p>{p.summary.split('. ')[0]}.</p>
                  <span className="bag__proof-meta">
                    {p.neighborhood}, {labelForCity(p.city)} / {formatProjectDate(p.completedDate)}
                  </span>
                </article>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
