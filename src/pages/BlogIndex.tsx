import { useEffect, useMemo, useState } from 'react';
import Banner from '../sections/Banner';
import Nav from '../sections/Nav';
import BottomMarquee from '../sections/BottomMarquee';
import Footer from '../sections/Footer';
import FloatingCTA from '../sections/FloatingCTA';
import TrustBadge from '../components/TrustBadge';
import VerifyToast from '../components/VerifyToast';
import JsonLd from '../components/JsonLd';
import SEO from '../components/SEO';
import {
  buildLocalBusinessGraph,
  buildServicesGraph,
} from '../data/schemas';
import { buildBlogIndexGraph } from '../data/schemas/article';
import {
  getLivePosts,
  getAllCategories,
  formatPostDate,
  type Post,
} from '../data/blog';
import { LIVE_READINESS } from '../data/liveReadiness';
import { useReveal } from '../hooks/useReveal';
import { track } from '../lib/analytics';
import { startScrollDepthTracking } from '../lib/interactions';
import './BlogIndex.css';

/**
 * BlogIndex — the /blog landing page.
 *
 * Lists every live post (drafts hidden), with optional category filter.
 * Re-uses the global chrome (Banner + Nav + Footer + Trust components)
 * so blog visitors see the same site shell as everywhere else.
 *
 * Schema:
 *   - local-business — canonical NAP graph (no per-page duplication)
 *   - services — full Service entities
 *   - blog-index — Blog + BreadcrumbList
 */

const LOCAL_BUSINESS_SCHEMA = buildLocalBusinessGraph();
const SERVICES_SCHEMA = buildServicesGraph();

export default function BlogIndex() {
  useReveal();

  useEffect(() => {
    track('page_view', { surface: 'desktop', route: '/blog' });
    startScrollDepthTracking();
  }, []);

  const allPosts = useMemo(() => getLivePosts(), []);
  const categories = useMemo(() => getAllCategories(), []);
  const [activeCategory, setActiveCategory] = useState<
    Post['category'] | 'all'
  >('all');

  const visiblePosts = useMemo(() => {
    if (activeCategory === 'all') return allPosts;
    return allPosts.filter((p) => p.category === activeCategory);
  }, [allPosts, activeCategory]);

  const blogIndexSchema = useMemo(
    () => (LIVE_READINESS.showBlog ? buildBlogIndexGraph(allPosts) : null),
    [allPosts],
  );

  return (
    <>
      <SEO
        path="/blog"
        title="Blog — Beit Building Contractors"
        description="Practical guides on roofing, hurricane preparation, insurance claims, and construction in Central Florida."
        ogType="website"
        noindex={!LIVE_READINESS.showBlog}
      />

      <JsonLd id="local-business" schema={LOCAL_BUSINESS_SCHEMA} />
      <JsonLd id="services" schema={SERVICES_SCHEMA} />
      <JsonLd id="blog-index" schema={blogIndexSchema} />

      <a href="#main" className="sr-only">
        Skip to main content
      </a>
      <Banner />
      <Nav />
      <main id="main">
        <section
          className="blog-index section section--dark"
          aria-label="Beit Building Contractors blog"
        >
          <div className="container blog-index__inner">
            <nav className="blog-breadcrumb" aria-label="Breadcrumb">
              <ol>
                <li>
                  <a href="/">Home</a>
                </li>
                <li aria-current="page">Blog</li>
              </ol>
            </nav>
            <p className="eyebrow eyebrow--gold">Insights &amp; Guides</p>
            <h1 className="blog-index__title">
              The Beit Building <em>Blog</em>
            </h1>
            <p className="blog-index__lead">
              Practical guides on roofing, hurricane preparation, insurance
              claims, and Florida construction — written by the licensed
              crew that does the work.
            </p>

            {categories.length > 1 && (
              <div className="blog-index__filters" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === 'all'}
                  className="blog-index__filter"
                  data-active={activeCategory === 'all'}
                  onClick={() => setActiveCategory('all')}
                >
                  All
                </button>
                {categories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    role="tab"
                    aria-selected={activeCategory === cat}
                    className="blog-index__filter"
                    data-active={activeCategory === cat}
                    onClick={() => setActiveCategory(cat)}
                  >
                    {labelForCategory(cat)}
                  </button>
                ))}
              </div>
            )}

            <ul className="blog-index__list">
              {visiblePosts.length === 0 && (
                <li className="blog-index__empty">
                  Guides are being reviewed for publication. For now, call
                  (407) 942-6459 or request a free estimate to talk through your roof
                  or construction question directly.
                </li>
              )}
              {visiblePosts.map((p) => (
                <li key={p.slug} className="blog-index__item reveal">
                  <a href={`/blog/${p.slug}`} className="blog-card">
                    {p.heroImage && (
                      <span
                        className="blog-card__media"
                        style={{ backgroundImage: `url(${p.heroImage})` }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="blog-card__body">
                      <span className="blog-card__meta">
                        <span className="blog-card__category">
                          {labelForCategory(p.category)}
                        </span>
                        <span className="blog-card__date">
                          {formatPostDate(p.datePublished)}
                        </span>
                        <span className="blog-card__time">
                          {p.computedReadingTime} min read
                        </span>
                      </span>
                      <span className="blog-card__title">{p.title}</span>
                      <span className="blog-card__desc">{p.description}</span>
                      <span className="blog-card__cta">
                        Read article <span aria-hidden="true">→</span>
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
      <BottomMarquee />
      <Footer />
      <FloatingCTA />
      <TrustBadge />
      <VerifyToast />
      <div className="vignette" aria-hidden="true" />
    </>
  );
}

function labelForCategory(cat: Post['category']): string {
  const map: Record<Post['category'], string> = {
    company: 'Company',
    guide: 'Guides',
    'storm-prep': 'Storm Prep',
    materials: 'Materials',
    insurance: 'Insurance',
    maintenance: 'Maintenance',
  };
  return map[cat] ?? cat;
}
