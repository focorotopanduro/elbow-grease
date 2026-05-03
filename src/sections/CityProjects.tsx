import type { CityData } from '../data/cities/types';
import './CityProjects.css';

interface CityProjectsProps {
  city: CityData;
}

export default function CityProjects({ city }: CityProjectsProps) {
  if (city.localProjects.length === 0) return null;
  return (
    <section
      className="city-projects section"
      aria-label={`Recent projects in ${city.name}`}
    >
      <div className="container">
        <header className="city-projects__header reveal">
          <p className="eyebrow">Recent {city.name} projects</p>
          <h2 className="city-projects__title">
            Real homes. <em>Real results.</em>
          </h2>
        </header>
        <ul className="city-projects__grid">
          {city.localProjects.map((p) => (
            <li key={p.slug} className="city-projects__item reveal">
              <picture className="city-projects__media">
                <source
                  srcSet={`/images/projects/${city.slug}/${p.slug}.webp`}
                  type="image/webp"
                />
                <img
                  src={`/images/projects/${city.slug}/${p.slug}.jpg`}
                  alt={p.alt}
                  loading="lazy"
                  width="800"
                  height="600"
                  onError={(e) => {
                    const img = e.currentTarget;
                    img.style.display = 'none';
                    const parent = img.closest('.city-projects__item');
                    parent?.classList.add('city-projects__item--placeholder');
                  }}
                />
              </picture>
              {p.caption && (
                <p className="city-projects__caption">{p.caption}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
