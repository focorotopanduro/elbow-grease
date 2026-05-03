import type { MouseEvent } from 'react';
import { useCountUp } from '../hooks/useCountUp';
import { useMagnetic } from '../hooks/useMagnetic';
import { setStoredClientPath, type ClientPathId } from '../data/clientPaths';
import { trackCta } from '../lib/interactions';
import './Services.css';

const STATS = [
  { num: 2, suffix: '', label: 'Active DBPR Licenses' },
  { num: 3, suffix: '', label: 'Core Counties Served' },
  { num: 4, suffix: '', label: 'Ways We Can Help' },
];

const PROCESS = ['Inspect', 'Scope', 'Build', 'Document'];

function Stat({ num, suffix, label }: { num: number; suffix: string; label: string }) {
  const [v, ref] = useCountUp(num);
  return (
    <li>
      <strong>
        <span ref={ref}>{v}</span>
        <span className="sf__stat-suffix">{suffix}</span>
      </strong>
      <span>{label}</span>
    </li>
  );
}

interface FeatureProps {
  id: string;
  index?: string;
  eyebrow: string;
  title: string;
  titleEm?: string;
  body: string[];
  image: string;
  alt: string;
  reverse?: boolean;
  showStats?: boolean;
  ctaLabel?: string;
  note?: string;
  deliverables?: string[];
  videoSrc?: string;
  pathId?: ClientPathId;
}

function ServiceFeature({
  id,
  index = '01',
  eyebrow,
  title,
  titleEm,
  body,
  image,
  alt,
  reverse = false,
  showStats = false,
  ctaLabel = 'Get a Quote',
  note = 'Crew, materials, weather, access, and cleanup are planned before the first tear-off or cut.',
  deliverables = ['Photo record', 'Plain scope', 'Clean closeout'],
  videoSrc,
  pathId,
}: FeatureProps) {
  const ctaRef = useMagnetic<HTMLAnchorElement>(0.16, 90);
  const handleCtaClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (pathId) setStoredClientPath(pathId, `service_feature:${id}`);
    trackCta('book_quote', `service_feature:${id}`)(event);
  };

  return (
    <section
      id={id}
      className={`sf reveal ${reverse ? 'sf--reverse' : ''} ${showStats ? 'sf--with-stats' : ''}`}
    >
      <aside className="sf__rail" aria-hidden="true">
        <span>{index}</span>
        <span>Field Ledger</span>
      </aside>

      <figure className="sf__media">
        <span className="sf__mask" aria-hidden="true" />
        {videoSrc ? (
          <video
            className="sf__video"
            src={videoSrc}
            poster={image}
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            aria-label={alt}
          />
        ) : (
          <img src={image} alt={alt} loading="lazy" />
        )}
        <figcaption className="sf__media-tag">
          <span>{eyebrow}</span>
          Central Florida
        </figcaption>
      </figure>

      <div className="sf__copy">
        <p className="sf__kicker">{eyebrow}</p>
        <h2 className="sf__title">
          {title}
          {titleEm && <><br /> <em>{titleEm}</em></>}
        </h2>
        <p className="sf__note">{note}</p>
        {body.map((p, i) => (
          <p key={i} className="sf__body">{p}</p>
        ))}
        <ul className="sf__deliverables" aria-label={`${eyebrow} deliverables`}>
          {deliverables.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {showStats && (
          <>
            <ul className="sf__stats">
              {STATS.map((s) => (
                <Stat key={s.label} {...s} />
              ))}
            </ul>
            <ol className="sf__process" aria-label="Project process">
              {PROCESS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </>
        )}
        <a
          ref={ctaRef}
          href="#contact"
          className="btn btn--primary sf__cta magnet"
          data-cta-source={`service_feature_${id}`}
          onClick={handleCtaClick}
        >
          {ctaLabel} <span aria-hidden="true">-&gt;</span>
        </a>
      </div>
    </section>
  );
}

export default function Services() {
  return (
    <div id="services" className="services-wrap">
      <ServiceFeature
        id="signature"
        index="00"
        eyebrow="Signature Method"
        title="The roof is only one"
        titleEm="part of the system"
        body={[
          'From complete roof replacements to storm repairs, the crew reads the whole envelope: roof plane, fascia, penetrations, drainage, attic clues, and exterior finish conditions.',
          'When insurance is involved, the scope is organized so the conversation stays factual, documented, and easier to follow.',
        ]}
        image="/images/house-1.jpg"
        alt="Premium roofing installation by Beit Building Contractors Orlando"
        showStats
        ctaLabel="Request Free Estimate"
        note="A good roofing decision starts with the building around it, not a rushed square count."
        deliverables={['Roof read', 'Envelope notes', 'Estimate path']}
        pathId="roof"
      />
    </div>
  );
}

export { ServiceFeature };
