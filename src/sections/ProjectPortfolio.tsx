import { useCallback, useMemo, useState } from 'react';
import ProjectModal from '../components/ProjectModal';
import { trackCta } from '../lib/interactions';
import {
  filterProjects,
  formatProjectDate,
  getAvailableCities,
  getAvailableServices,
  hasProjectPhotos,
  labelForCity,
  labelForService,
  PROJECTS,
  type ProjectCity,
  type ProjectService,
} from '../data/projects';
import './ProjectPortfolio.css';

/**
 * ProjectPortfolio — filterable project gallery with modal lightbox.
 *
 * Two filter rows: service category + city. Filters combine (AND).
 * Cards show hero + neighborhood + service tag + completion month;
 * click opens the ProjectModal for full detail.
 *
 * Card click + filter changes both fire analytics events:
 *   - cta_click('view_project', `project_portfolio:<slug>`)
 *   - cta_click('filter_change', `project_portfolio:<key>:<value>`)
 *
 * TODO (Tier 5 schema work, deferred): once real photos land + the
 * portfolio is no longer placeholder, emit `@type: CreativeWork` JSON-LD
 * for each project so the gallery surfaces in image search results.
 */

type ServiceFilter = ProjectService | 'all';
type CityFilter = ProjectCity | 'all';

export default function ProjectPortfolio() {
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>('all');
  const [cityFilter, setCityFilter] = useState<CityFilter>('all');
  const [modalIndex, setModalIndex] = useState<number | null>(null);

  const filtered = useMemo(
    () => filterProjects(serviceFilter, cityFilter),
    [serviceFilter, cityFilter],
  );

  // Available filters derived from the actual project list. If a city
  // has no projects in the current filter combo, its chip stays in the
  // UI but selecting it won't show anything — that's fine, helps the
  // owner see coverage gaps.
  const availableServices = useMemo(() => getAvailableServices(), []);
  const availableCities = useMemo(() => getAvailableCities(), []);

  const onServiceChange = useCallback((next: ServiceFilter) => {
    setServiceFilter(next);
    trackCta('filter_change', `project_portfolio:service:${next}`)();
  }, []);

  const onCityChange = useCallback((next: CityFilter) => {
    setCityFilter(next);
    trackCta('filter_change', `project_portfolio:city:${next}`)();
  }, []);

  const openModal = useCallback(
    (index: number) => {
      setModalIndex(index);
      const slug = filtered[index]?.slug ?? '';
      trackCta('view_project', `project_portfolio:${slug}`)();
    },
    [filtered],
  );

  const closeModal = useCallback(() => {
    setModalIndex(null);
  }, []);

  const goPrev = useCallback(() => {
    if (modalIndex === null) return;
    const next = modalIndex === 0 ? filtered.length - 1 : modalIndex - 1;
    setModalIndex(next);
  }, [modalIndex, filtered.length]);

  const goNext = useCallback(() => {
    if (modalIndex === null) return;
    const next = modalIndex === filtered.length - 1 ? 0 : modalIndex + 1;
    setModalIndex(next);
  }, [modalIndex, filtered.length]);

  const activeProject =
    modalIndex !== null ? filtered[modalIndex] ?? null : null;

  return (
    <section
      className="pport section section--dark"
      aria-label="Project portfolio"
      id="portfolio"
    >
      <div className="container">
        <header className="pport__header reveal">
          <p className="eyebrow eyebrow--gold">Project Portfolio</p>
          <h2 className="pport__title">
            Case files, <em>not gallery filler</em>
          </h2>
          <p className="pport__lead">
            Filter by service and city. Each file keeps the useful project
            facts visible: service type, neighborhood, timing, and what the
            scope solved.
          </p>
        </header>

        {/* Service-category filter */}
        <div className="pport__filters" role="tablist" aria-label="Filter by service">
          <button
            type="button"
            role="tab"
            aria-selected={serviceFilter === 'all'}
            className="pport__filter"
            data-active={serviceFilter === 'all'}
            onClick={() => onServiceChange('all')}
          >
            All Services
          </button>
          {availableServices.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={serviceFilter === s}
              className="pport__filter"
              data-active={serviceFilter === s}
              onClick={() => onServiceChange(s)}
            >
              {labelForService(s)}
            </button>
          ))}
        </div>

        {/* City filter */}
        <div className="pport__filters" role="tablist" aria-label="Filter by city">
          <button
            type="button"
            role="tab"
            aria-selected={cityFilter === 'all'}
            className="pport__filter pport__filter--city"
            data-active={cityFilter === 'all'}
            onClick={() => onCityChange('all')}
          >
            All Cities
          </button>
          {availableCities.map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={cityFilter === c}
              className="pport__filter pport__filter--city"
              data-active={cityFilter === c}
              onClick={() => onCityChange(c)}
            >
              {labelForCity(c)}
            </button>
          ))}
        </div>

        <div
          className="pport__count"
          role="status"
          aria-live="polite"
        >
          {filtered.length === 0
            ? 'No projects match these filters yet.'
            : `Showing ${filtered.length} of ${PROJECTS.length} projects`}
        </div>

        {filtered.length > 0 && (
          <ul className="pport__grid" role="list">
            {filtered.map((p, i) => {
              const photosAvailable = hasProjectPhotos(p);
              return (
              <li key={p.id} className="pport__item reveal">
                <button
                  type="button"
                  className="pport__card"
                  onClick={() => openModal(i)}
                  aria-label={`View details for ${p.title} in ${p.neighborhood}`}
                >
                  <span
                    className="pport__card-media"
                    data-service={p.serviceCategory}
                    data-photo-status={photosAvailable ? 'available' : 'pending'}
                    style={
                      photosAvailable
                        ? { backgroundImage: `url(${p.heroImage})` }
                        : undefined
                    }
                    aria-hidden="true"
                  >
                    {!photosAvailable && (
                      <span className="pport__card-media-label">
                        Photo set pending
                      </span>
                    )}
                  </span>
                  <span className="pport__card-body">
                    <span className="pport__card-tags">
                      <span className="pport__card-service">
                        {labelForService(p.serviceCategory)}
                      </span>
                      <span className="pport__card-neighborhood">
                        {p.neighborhood}
                      </span>
                    </span>
                    <span className="pport__card-title">{p.title}</span>
                    <span className="pport__card-summary">
                      {p.summary.split('. ')[0]}.
                    </span>
                    <span className="pport__card-foot">
                      <span>{formatProjectDate(p.completedDate)}</span>
                      <span className="pport__card-arrow" aria-hidden="true">→</span>
                    </span>
                  </span>
                </button>
              </li>
              );
            })}
          </ul>
        )}
      </div>

      {activeProject && (
        <ProjectModal
          project={activeProject}
          isOpen={modalIndex !== null}
          onClose={closeModal}
          onPrev={filtered.length > 1 ? goPrev : undefined}
          onNext={filtered.length > 1 ? goNext : undefined}
        />
      )}
    </section>
  );
}
