/**
 * Orlando city page data — production content.
 *
 * NAP, services, reviews, and FAQ refs all live in canonical sources
 * (src/data/business.ts, reviews.ts, faqs.ts). Edit those, not here, for
 * anything that should propagate site-wide.
 *
 * Photo TODO list: docs/orlando-photo-todo.md — owner fills the gallery.
 *
 * Copy review checklist (when refreshing this page):
 *   [ ] FBC reference current? (currently 7th Edition / 2024)
 *   [ ] Recent named-storm references current? (Ian + Nicole 2022)
 *   [ ] License numbers current? (CCC1337413 + CGC1534077, 08/31/2026)
 *   [ ] Neighborhood list reflects active service-area
 *   [ ] FAQ ids still resolve (run `grep` on src/data/faqs.ts)
 */

import type { CityData } from './types';

export const ORLANDO: CityData = {
  slug: 'orlando-roofing',
  name: 'Orlando',
  county: 'Orange County',
  state: 'FL',
  geo: { lat: 28.5383, lng: -81.3792 },
  // Population: City of Orlando ~316,000 (2023 est.), metro 2.7M+. Omitted
  // here until verified directly with owner — rich-result snippets don't
  // benefit from population in LocalBusiness schema.
  // Alphabetised so the city map's "Active in:" list reads neutrally —
  // no neighborhood appears favored, no Orlando homeowner feels skipped.
  neighborhoods: [
    'Audubon Park',
    'Avalon Park',
    'Baldwin Park',
    'College Park',
    'Conway',
    'Curry Ford',
    'Dr. Phillips',
    'Hunters Creek',
    'Kirkman South',
    'Lake Eola Heights',
    'Lake Nona',
    'MetroWest',
    'Thornton Park',
    'Winter Garden',
    'Winter Park-adjacent',
  ],
  hurricaneRiskNotes:
    'Orange County sits in the Florida Building Code 130 mph wind-design zone (ASCE 7-22 Risk Category II) and was hit by Hurricane Ian (Sep 2022) and Hurricane Nicole (Nov 2022) within seven weeks — both caused measurable wind and water damage to thousands of Orlando-area roofs.',
  hero: {
    headline: 'Roofing Services in Orlando, FL',
    sub: 'Locally owned. Two active state licenses. Bilingual EN/ES crew. Schedule a free, no-obligation roof inspection based on property access and weather.',
    ctaLabel: 'Get a Free Roof Inspection',
    secondaryCtaLabel: 'Call (407) 942-6459',
  },
  intro: [
    "Central Florida's climate is uniquely punishing for roof systems. Year-round UV exposure cooks shingles 30-40% faster than in northern states. Daily summer thunderstorms soak every flashing seam. And every hurricane season tests fasteners that have spent the previous years baking in 95°F attics.",
    'After every named storm, Orlando homeowners get door-knocked by contractors who may not be around for warranty follow-up. Beit Building Contractors is locally owned and operated from a fixed Orlando address, with state license records you can verify before work begins.',
    'Two active Florida DBPR licenses — Certified Roofing Contractor CCC1337413 and Certified General Contractor CGC1534077 — let one accountable team talk through roofing, structural, and finish-scope questions together. Orlando roof work is scoped to current Florida Building Code requirements for the local 130 mph design wind speed, including secondary water barrier per FBC §1518 where conditions warrant. Our crew is bilingual English/Spanish for clear communication with everyone in your household.',
  ],
  whyUs: [
    {
      title: 'Local crew, local references',
      body: 'Locally owned from a fixed Orlando address, with license records and project documents you can review before work begins.',
    },
    {
      title: 'Orange County permit fluency',
      body: 'Orange County permitting and inspection requirements are part of the scope discussion, so the work is planned around the approvals your project needs.',
    },
    {
      title: 'Hurricane-rated installations',
      body: 'Every Orlando roof we install meets FBC 7th Edition (2024) for the local 130 mph design wind speed, including secondary water barrier per §1518 where conditions warrant.',
    },
    {
      title: 'Bilingual EN/ES communication',
      body: "Clear conversations with every family member, before, during, and after. Spanish-speaking project lead available on request — comunicación clara, en su idioma.",
    },
  ],
  serviceHighlights: [
    {
      serviceId: 'roofing',
      headline: 'Tile, shingle, metal & flat — code-current Orlando installs',
      body: "Tile-roof specialists for Orlando's Mediterranean and Spanish-revival homes (Audubon Park, College Park, Thornton Park). Architectural shingles for newer subdivisions (Lake Nona, MetroWest, Avalon Park). Standing-seam metal where hurricane resilience is the priority. Every system installed to FBC 7th Edition (2024) requirements.",
    },
    {
      serviceId: 'general',
      headline: 'Whole-home construction & renovation in Orange County',
      body: 'Ground-up builds, additions, kitchen and bath remodels — fully permitted and inspected through Orange County when required. License CGC1534077 keeps structural and finish-scope conversations under one accountable contractor.',
    },
    {
      serviceId: 'deck',
      headline: 'Florida-climate decks, fences, outdoor living',
      body: 'Pressure-treated and composite decking engineered for sustained Orlando humidity and UV. Privacy fences, code-compliant pool enclosures (Florida Statute Chapter 515), pergolas, and screened patios for backyard living through every Florida season.',
    },
    {
      serviceId: 'paint',
      headline: 'UV-rated exterior paint, James Hardie siding',
      body: 'Premium acrylic and elastomeric exterior systems formulated for Florida UV exposure — the difference between a 12-year coating and a 4-year repaint. James Hardie fiber-cement siding installation, pre-painted or field-finished, with full code-compliant flashing details.',
    },
  ],
  localProjects: [
    {
      slug: 'audubon-park-tile-replacement-2024',
      alt: 'Tile roof replacement in Audubon Park, Orlando',
      caption: 'Audubon Park — full clay tile replacement after Hurricane Ian',
    },
    {
      slug: 'lake-nona-shingle-storm-2023',
      alt: 'Storm-damage shingle replacement, Lake Nona Orlando',
      caption: 'Lake Nona — architectural shingle replacement after Nicole',
    },
    {
      slug: 'conway-standing-seam-metal-2024',
      alt: 'Standing-seam metal roof installation in Conway, Orlando',
      caption: 'Conway — standing-seam metal install for hurricane resilience',
    },
  ],
  // All 3 current testimonials reference Orlando explicitly. When Phase 12
  // GBP integration brings in real source attribution, the owner can add
  // more Orlando-specific reviews and the filter still works the same way.
  testimonialIds: [
    'downey-2024-residential',
    'oreilly-investor-property',
    'lewis-2024-roof-replacement',
  ],
  // 6 highest-intent FAQs for an Orlando service-area landing page.
  // Removed 'service-area' (visitors on /orlando-roofing don't doubt we
  // serve their city) in favor of 'project-timeline' (high commercial
  // intent — homeowners deciding whether to start before/after a storm).
  faqIds: [
    'insurance-claims',
    'free-inspection',
    'project-timeline',
    'license-verification',
    'hurricane-emergency',
    'why-beit',
  ],
  // Standard Google Maps embed pinning Orlando, FL. The pb-format URL is
  // generated by Google's "Embed a map" share dialog — replacing it does
  // not require an API key. Verified loading at this URL on 2026-04-28.
  mapEmbed:
    'https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d224094.85!2d-81.5!3d28.4!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x88e773d8fecdbc77%3A0xac3b2063ca5bf9e!2sOrlando%2C%20FL!5e0!3m2!1sen!2sus!4v1714355200000',
};
