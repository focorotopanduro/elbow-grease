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
import { buildArticleGraph } from '../data/schemas/article';
import {
  getRelatedPosts,
  formatPostDate,
  type Post,
} from '../data/blog';
import { useReveal } from '../hooks/useReveal';
import { track } from '../lib/analytics';
import { startScrollDepthTracking, trackCta } from '../lib/interactions';
import './BlogPost.css';

const LOCAL_BUSINESS_SCHEMA = buildLocalBusinessGraph();
const SERVICES_SCHEMA = buildServicesGraph();

export interface BlogPostProps {
  post: Post;
}

/**
 * BlogPost — renders a single MDX post.
 *
 * Layout: hero (title, meta, hero image) → two-column body with auto-
 * generated TOC sidebar → related posts → CTA → standard chrome footer.
 *
 * The MDX component is rendered as `post.Component`. rehype-slug ensures
 * every H2/H3 has an id, which the TOC component reads from the DOM
 * after first paint.
 *
 * Schema:
 *   - local-business — canonical NAP
 *   - services — Service entities
 *   - article — BlogPosting + BreadcrumbList
 */
export default function BlogPost({ post }: BlogPostProps) {
  useReveal();

  useEffect(() => {
    track('page_view', {
      surface: 'desktop',
      route: `/blog/${post.slug}`,
      blog_slug: post.slug,
      blog_category: post.category,
    });
    startScrollDepthTracking();
  }, [post.slug, post.category]);

  const articleSchema = useMemo(() => buildArticleGraph(post), [post]);
  const related = useMemo(() => getRelatedPosts(post, 3), [post]);
  const Content = post.Component;

  return (
    <>
      <SEO
        path={`/blog/${post.slug}`}
        title={`${post.title} | Beit Building Blog`}
        description={post.description}
        ogType="article"
        author={post.author}
        datePublished={post.datePublished}
        dateModified={post.dateModified ?? post.datePublished}
        ogImage={post.ogImage ?? post.heroImage}
        noindex={post.draft}
      />

      <JsonLd id="local-business" schema={LOCAL_BUSINESS_SCHEMA} />
      <JsonLd id="services" schema={SERVICES_SCHEMA} />
      <JsonLd id="article" schema={articleSchema} />

      <a href="#main" className="sr-only">Skip to main content</a>
      <Banner />
      <Nav />
      <main id="main">
        <article className="blog-post">
          <PostHero post={post} />
          <div className="blog-post__body container">
            <TOC />
            <div className="blog-post__content">
              <Content />
            </div>
          </div>
          <PostCTA />
          {related.length > 0 && <RelatedPosts posts={related} />}
        </article>
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

function PostHero({ post }: { post: Post }) {
  return (
    <header className="blog-post__hero section section--dark">
      <div className="container blog-post__hero-inner">
        <nav className="blog-breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li>
              <a href="/">Home</a>
            </li>
            <li>
              <a href="/blog">Blog</a>
            </li>
            <li aria-current="page">{post.title}</li>
          </ol>
        </nav>
        <p className="eyebrow eyebrow--gold blog-post__category">
          {labelForCategory(post.category)}
        </p>
        <h1 className="blog-post__title">{post.title}</h1>
        <p className="blog-post__lead">{post.description}</p>
        <div className="blog-post__meta">
          <span>{formatPostDate(post.datePublished)}</span>
          <span aria-hidden="true">·</span>
          <span>{post.computedReadingTime} min read</span>
          <span aria-hidden="true">·</span>
          <span>{post.author ?? 'Beit Building Contractors'}</span>
        </div>
        {post.heroImage && (
          <div
            className="blog-post__hero-image"
            style={{ backgroundImage: `url(${post.heroImage})` }}
            role="img"
            aria-label={post.title}
          />
        )}
      </div>
    </header>
  );
}

interface TOCItem {
  id: string;
  text: string;
  level: number;
}

function TOC() {
  const [items, setItems] = useState<TOCItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const headings = document.querySelectorAll<HTMLHeadingElement>(
      '.blog-post__content h2, .blog-post__content h3',
    );
    const list: TOCItem[] = [];
    for (const h of headings) {
      // Ensure every heading has an id — rehype-slug should handle this,
      // but if a post is rendered without the plugin we fall back to a
      // manual slug so the TOC still works.
      if (!h.id) {
        h.id = (h.textContent || '')
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9\s-]/g, '')
          .replace(/\s+/g, '-')
          .slice(0, 80);
      }
      list.push({
        id: h.id,
        text: h.textContent?.trim() ?? '',
        level: parseInt(h.tagName.slice(1), 10),
      });
    }
    setItems(list);

    if (list.length === 0) return;

    // Highlight current section as the user scrolls.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActiveId(e.target.id);
        }
      },
      {
        rootMargin: '-20% 0px -60% 0px',
        threshold: [0, 0.5, 1],
      },
    );
    for (const h of headings) observer.observe(h);
    return () => observer.disconnect();
  }, []);

  if (items.length === 0) return <aside className="blog-post__toc" aria-hidden="true" />;

  return (
    <aside className="blog-post__toc" aria-label="Table of contents">
      <p className="blog-post__toc-title">In this article</p>
      <nav>
        <ol>
          {items.map((it) => (
            <li
              key={it.id}
              data-level={it.level}
              data-active={activeId === it.id}
            >
              <a href={`#${it.id}`}>{it.text}</a>
            </li>
          ))}
        </ol>
      </nav>
    </aside>
  );
}

function PostCTA() {
  return (
    <section className="blog-post__cta section section--dark">
      <div className="container blog-post__cta-inner">
        <h2 className="blog-post__cta-title">
          Have a question we should answer next?
        </h2>
        <p className="blog-post__cta-lead">
          We respond within 24 hours — even if it&apos;s just a quick
          question. Free roof inspections in greater Orlando, Winter Park,
          Oviedo, and the surrounding service area.
        </p>
        <div className="blog-post__cta-actions">
          <a
            href="/#contact"
            className="btn btn--primary"
            data-cta-source="blog_post_end_quote"
            onClick={trackCta('book_quote', 'blog_post_end')}
          >
            Get a Free Inspection
          </a>
          <a
            href="tel:+14079426459"
            className="btn btn--ghost btn--ghost-on-dark"
            data-cta-source="blog_post_end_call"
            onClick={trackCta('call_phone', 'blog_post_end')}
          >
            Call (407) 942-6459
          </a>
        </div>
      </div>
    </section>
  );
}

function RelatedPosts({ posts }: { posts: Post[] }) {
  return (
    <section className="blog-post__related section">
      <div className="container">
        <h2 className="blog-post__related-title">Keep reading</h2>
        <ul className="blog-post__related-list">
          {posts.map((p) => (
            <li key={p.slug} className="blog-post__related-item">
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
                    <span className="blog-card__time">
                      {p.computedReadingTime} min read
                    </span>
                  </span>
                  <span className="blog-card__title">{p.title}</span>
                  <span className="blog-card__desc">{p.description}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
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
