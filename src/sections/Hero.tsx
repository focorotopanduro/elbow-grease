import { useMagnetic } from '../hooks/useMagnetic';
import TrustSeal from '../components/TrustSeal';
import AwardsRow from '../components/AwardsRow';
import { trackCta } from '../lib/interactions';
import { useExperiment } from '../lib/experiments';
import './Hero.css';

const HERO_VARIANTS: Record<string, { sub: string; cta: string }> = {
  A: {
    sub: 'Roofing and construction run like a field operation: inspect first, document clearly, build with a crew that understands Central Florida homes.',
    cta: 'Request Free Estimate',
  },
  B: {
    sub: 'Two state licenses. Bilingual crew. Free inspection windows scheduled around the property and weather conditions.',
    cta: 'Request Free Estimate',
  },
  C: {
    sub: 'Free site visit with photo documentation, plain-language scope notes, and a contractor who can handle the envelope beyond the roof.',
    cta: 'Request Free Estimate',
  },
};

const HERO_PROOFS = [
  { value: '02', label: 'Active Florida licenses' },
  { value: 'Free', label: 'Inspection windows' },
  { value: 'EN/ES', label: 'Bilingual site crew' },
];

const SITE_BRIEF = [
  { key: '1', value: 'Tell us what is happening' },
  { key: '2', value: 'We inspect and document' },
  { key: '3', value: 'You get the next move' },
];

const FIELD_RAIL = [
  { label: 'DBPR', value: 'CCC + CGC' },
  { label: 'Visit', value: 'Photo notes' },
  { label: 'Crew', value: 'EN / ES' },
];

export default function Hero() {
  const ctaRef = useMagnetic<HTMLAnchorElement>(0.18, 110);
  const variant = useExperiment('hero_cta_copy_v1');
  const copy = HERO_VARIANTS[variant] ?? HERO_VARIANTS.A;

  return (
    <section id="home" className="hero">
      <video
        className="hero__video"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster="/images/house-1.jpg"
        aria-hidden="true"
      >
        <source src="/videos/hero.mp4" type="video/mp4" media="(min-width: 720px)" />
      </video>
      <div className="hero__overlay" aria-hidden="true" />
      <div className="hero__grain" aria-hidden="true" />
      <div className="hero__halo" aria-hidden="true" />

      <div className="hero__content container">
        <div className="hero__site-rail" aria-label="Field crew quick facts">
          <span className="hero__rail-status">
            <span aria-hidden="true" />
            DBPR active
          </span>
          <div className="hero__rail-core">
            <strong>Orlando FL</strong>
            <span>Roofing + construction</span>
          </div>
          <ul className="hero__rail-facts" aria-label="Credential highlights">
            {FIELD_RAIL.map((item) => (
              <li key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </li>
            ))}
          </ul>
          <span className="hero__rail-coords">28.5383 N / 81.3792 W</span>
        </div>

        <div className="hero__copy">
          <p className="eyebrow eyebrow--gold hero__eyebrow">
            Orlando, Florida / Roofing + construction
          </p>
          <h1 className="hero__title">
            <span className="text-gold-shimmer">Beit Building</span>
            <br />
            {' '}
            <em>Contractors LLC</em>
          </h1>
          <p className="hero__sub">{copy.sub}</p>
          <div className="hero__cta">
            <a
              ref={ctaRef}
              href="#contact"
              className="btn btn--primary magnet"
              data-cta-source="hero_primary"
              data-variant={variant}
              onClick={trackCta('book_quote', `hero_primary:${variant}`)}
            >
              {copy.cta}
            </a>
            <a
              href="#services"
              className="btn btn--ghost btn--ghost-on-dark"
              data-cta-source="hero_secondary"
              onClick={trackCta('explore_services', 'hero_secondary')}
            >
              See Services
            </a>
          </div>
          <AwardsRow variant="subtle" className="hero__awards" />

          <aside className="hero__brief" aria-label="What happens next">
            <div className="hero__brief-head">
              <picture>
                <source srcSet="/logo-mark.webp" type="image/webp" />
                <img
                  src="/logo-mark.png"
                  alt=""
                  className="hero__logo"
                  width="96"
                  height="96"
                  loading="eager"
                />
              </picture>
              <span>
                <strong>Next Steps</strong>
                <small>What happens next</small>
              </span>
            </div>
            <dl className="hero__brief-list">
              {SITE_BRIEF.map((item) => (
                <div key={item.key}>
                  <dt>{item.key}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
            <ul className="hero__proofs" aria-label="Trust highlights">
              {HERO_PROOFS.map((item) => (
                <li key={item.label}>
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>

      <TrustSeal />

      <a
        href="#services"
        className="hero__scroll"
        aria-label="Scroll to next section"
        data-cta-source="hero_scroll"
        onClick={trackCta('scroll_to_services', 'hero_scroll')}
      >
        <span className="hero__scroll-line" aria-hidden="true" />
        <span className="hero__scroll-label">Scroll</span>
      </a>
    </section>
  );
}
