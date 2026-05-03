import { useEffect } from 'react';

/**
 * JsonLd — declarative head injection for `<script type="application/ld+json">`
 * structured data tags.
 *
 * Behaviour:
 * • On mount, inserts (or updates) a script tag with `data-jsonld-id={id}`.
 * • If a tag with that id already exists (e.g., baked into index.html as
 *   the no-JS fallback), its content is REPLACED in place rather than
 *   duplicating. This keeps the DOM clean for SEO crawlers.
 * • On unmount, restores prior content if the tag was pre-existing, or
 *   removes it if we created it.
 *
 * Usage:
 *
 *   import JsonLd from '../components/JsonLd';
 *   import { buildLocalBusinessGraph } from '../data/schemas';
 *
 *   <JsonLd id="local-business" schema={buildLocalBusinessGraph()} />
 *
 * Multiple JsonLd instances can coexist on the same page — they're
 * keyed by `id` so each occupies its own script tag. Google merges
 * multiple JSON-LD blocks on a page into one logical schema graph.
 */

const ATTR = 'data-jsonld-id';

export interface JsonLdProps {
  /** Unique stable identifier for this schema instance. */
  id: string;
  /** Schema object — will be JSON.stringified. Pass `null` to remove. */
  schema: Record<string, unknown> | null;
}

function serialize(schema: Record<string, unknown> | null): string {
  if (!schema) return '';
  // JSON.stringify with no whitespace — search-engine parsers don't care
  // about formatting, and shipping minified payload reduces page weight.
  return JSON.stringify(schema);
}

export default function JsonLd({ id, schema }: JsonLdProps) {
  useEffect(() => {
    const selector = `script[type="application/ld+json"][${ATTR}="${id}"]`;
    const existing = document.head.querySelector<HTMLScriptElement>(selector);

    const newContent = serialize(schema);

    if (!schema) {
      // Caller wants the tag gone. If we created it, remove. If it was
      // pre-existing, leave it alone (their static fallback persists).
      if (existing && existing.dataset.jsonldOwned === 'true') {
        existing.parentNode?.removeChild(existing);
      }
      return;
    }

    if (existing) {
      // Capture prior content so cleanup can restore it. Mark as
      // owned-by-us if it wasn't already, so subsequent unmounts know
      // they can fully manage it.
      const prevContent = existing.textContent ?? '';
      existing.textContent = newContent;
      return () => {
        // Restore the prior content on unmount. If we replaced a static
        // fallback baked into index.html, this puts it back so the page's
        // server-side schema remains intact for non-JS crawlers.
        const stillHere = document.head.querySelector<HTMLScriptElement>(selector);
        if (stillHere) stillHere.textContent = prevContent;
      };
    }

    // No existing tag — create one and tag it as owned by us.
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.setAttribute(ATTR, id);
    el.dataset.jsonldOwned = 'true';
    el.textContent = newContent;
    document.head.appendChild(el);

    return () => {
      el.parentNode?.removeChild(el);
    };
  }, [id, schema]);

  return null;
}
