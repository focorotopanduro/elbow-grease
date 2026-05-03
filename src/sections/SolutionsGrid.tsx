import type { MouseEvent, ReactNode } from 'react';
import { setStoredClientPath, type ClientPathId } from '../data/clientPaths';
import { trackCta } from '../lib/interactions';
import './SolutionsGrid.css';

interface Solution {
  id: string;
  index: string;
  title: string;
  body: string;
  field: string;
  result: string;
  icon: ReactNode;
  href: string;
  path: ClientPathId;
}

const SOLUTIONS: Solution[] = [
  {
    id: 'roofing',
    index: '01',
    title: 'Roofing Systems',
    body: 'Replacement, repair, storm response, and insurance-aware documentation for homes that take Florida weather seriously.',
    field: 'Roof plane',
    result: 'Dry interior',
    href: '#residential-roofing',
    path: 'roof',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 11 12 4l9 7" />
        <path d="M5 10v10h14V10" />
        <path d="M9 20v-6h6v6" />
      </svg>
    ),
  },
  {
    id: 'general',
    index: '02',
    title: 'General Construction',
    body: 'Renovations, additions, repairs, and build-outs coordinated from structure to finish details.',
    field: 'Structure',
    result: 'Clean handoff',
    href: '#general-construction',
    path: 'build',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="m14 6 6 6-7 7-6-6" />
        <path d="M14 6 8.5 11.5 4 7l1.5-1.5L8.5 8.5 12.5 4.5z" />
        <path d="m12 14-2 2" />
      </svg>
    ),
  },
  {
    id: 'deck',
    index: '03',
    title: 'Decks + Fences',
    body: 'Outdoor rooms, privacy lines, and durable exterior carpentry built for heat, rain, and daily use.',
    field: 'Lot edge',
    result: 'Usable outside',
    href: '#decks-fences',
    path: 'build',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7h18" />
        <path d="M3 11h18" />
        <path d="M5 11v10" />
        <path d="M9 11v10" />
        <path d="M13 11v10" />
        <path d="M17 11v10" />
        <path d="M21 11v10" />
      </svg>
    ),
  },
  {
    id: 'paint',
    index: '04',
    title: 'Paint + Siding',
    body: 'Exterior protection and finish work that changes curb appeal without ignoring the substrate beneath.',
    field: 'Envelope',
    result: 'Protected finish',
    href: '#painting-siding',
    path: 'build',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 7V4H5v6h14V7z" />
        <path d="M19 7h2v4H7v6a3 3 0 0 0 6 0v-2" />
      </svg>
    ),
  },
];

function ScopeNode({ solution }: { solution: Solution }) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    setStoredClientPath(solution.path, `solution_scope:${solution.id}`);
    trackCta('explore_services', `solution_scope:${solution.id}`)(event);
  };

  return (
    <li className={`sg__scope sg__scope--${solution.id} reveal`}>
      <a
        className="sg__link"
        href={solution.href}
        data-cta-source={`solution_scope_${solution.id}`}
        onClick={handleClick}
      >
        <span className="sg__index">{solution.index}</span>
        <span className="sg__icon" aria-hidden="true">{solution.icon}</span>
        <span className="sg__text">
          <strong className="sg__card-title">{solution.title}</strong>
          <span className="sg__card-body">{solution.body}</span>
        </span>
        <span className="sg__meta" aria-hidden="true">
          <span>
            <em>Problem</em>
            {solution.field}
          </span>
          <span>
            <em>Outcome</em>
            {solution.result}
          </span>
        </span>
        <span className="sg__action">View details</span>
      </a>
    </li>
  );
}

export default function SolutionsGrid() {
  return (
    <section className="sg" aria-label="Comprehensive construction solutions">
      <div className="container sg__layout">
        <header className="sg__header reveal">
          <p className="eyebrow">Services</p>
          <h2 className="sg__title">
            Choose what you need help with.
          </h2>
          <p className="sg__lead">
            Start with the closest match. If the problem overlaps, we will help
            sort the scope instead of making you choose the perfect category.
          </p>
        </header>

        <div className="sg__board reveal reveal--from-right">
          <div className="sg__ruler" aria-hidden="true">
            <span>North</span>
            <span>Roof</span>
            <span>Envelope</span>
          </div>
          <figure className="sg__plan">
            <img src="/images/house-2.jpg" alt="Central Florida home exterior and roof" loading="lazy" />
            <figcaption>
              <span>Site read</span>
              Roofline / water path / exterior envelope
            </figcaption>
          </figure>
          <ol className="sg__grid">
            {SOLUTIONS.map((solution) => (
              <ScopeNode key={solution.id} solution={solution} />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
