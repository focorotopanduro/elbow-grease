/**
 * FAQPage schema graph builder.
 *
 * Emits a single FAQPage entity whose `mainEntity` array is one Question
 * per FAQ in src/data/faqs.ts. Each Question has an `acceptedAnswer`
 * Answer, an author (Organization), and an `about` reference to the
 * LocalBusiness via @id.
 *
 * IMPORTANT — Google's FAQPage policy:
 *   • Every Q&A in the schema MUST be visible on the same page (this
 *     drives the FAQ.tsx component to render every FAQ entry — no
 *     "schema-only" hidden Q&As).
 *   • Avoid promotional content in answers (Google occasionally strips
 *     FAQPage rich results when answers feel like ads — keep them
 *     informational).
 *
 * Reference:
 *   https://schema.org/FAQPage
 *   https://developers.google.com/search/docs/appearance/structured-data/faqpage
 */

import {
  URL as SITE_URL,
  SCHEMA_IDS,
  LEGAL_NAME,
} from '../business';
import { FAQS, type FaqEntry } from '../faqs';

const FAQ_PAGE_ID = `${SITE_URL}/#faq`;
const questionId = (id: string) => `${SITE_URL}/#faq-question-${id}`;
const answerId = (id: string) => `${SITE_URL}/#faq-answer-${id}`;

/**
 * Plain-text answer for the schema. The visible UI renders \n\n as
 * paragraph breaks; for the schema we collapse to single spaces between
 * paragraphs so Google's parser sees a clean string.
 *
 * Optional links are appended as a parenthetical closing line so the
 * schema's answer captures the same call-to-action info the visitor
 * sees in the UI (otherwise Google might cite the schema verbatim and
 * miss the "Verify on DBPR" link entirely).
 */
function answerText(faq: FaqEntry): string {
  const body = faq.answer.replace(/\n\n/g, ' ').trim();
  if (!faq.links || faq.links.length === 0) return body;
  const linkBlurb = faq.links.map((l) => l.label).join(' · ');
  return `${body} (${linkBlurb})`;
}

function questionEntity(faq: FaqEntry) {
  return {
    '@type': 'Question',
    '@id': questionId(faq.id),
    name: faq.question,
    answerCount: 1,
    about: { '@id': SCHEMA_IDS.business },
    inLanguage: 'en-US',
    acceptedAnswer: {
      '@type': 'Answer',
      '@id': answerId(faq.id),
      text: answerText(faq),
      author: {
        '@type': 'Organization',
        '@id': SCHEMA_IDS.organization,
        name: LEGAL_NAME,
      },
      inLanguage: 'en-US',
      // upvoteCount is recommended for FAQPage but only when authentic.
      // Omit until we have real engagement data.
    },
  };
}

/**
 * Build the FAQPage schema object. Returns null when the FAQ set is empty
 * (defensive — never emit an empty FAQPage which Google flags as invalid).
 *
 * Pass a custom `faqs` list to scope the schema to a per-page subset
 * (e.g., the Orlando city page only includes 6 city-relevant FAQs).
 *
 * The `pageId` argument lets per-page graphs use a unique @id so multiple
 * FAQPage entities across the site don't collide.
 */
export function buildFaqGraph(
  faqs: FaqEntry[] = FAQS,
  pageId: string = FAQ_PAGE_ID,
) {
  const publicFaqs = faqs.filter((faq) => !faq.id.endsWith('-draft'));
  if (publicFaqs.length === 0) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    '@id': pageId,
    inLanguage: 'en-US',
    isPartOf: { '@id': SCHEMA_IDS.website },
    about: { '@id': SCHEMA_IDS.business },
    mainEntity: publicFaqs.map(questionEntity),
  };
}

export { FAQ_PAGE_ID };
