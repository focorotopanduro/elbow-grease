/**
 * Oviedo city page data.
 *
 * Oviedo is in Seminole County (NOT Orange). Same FBC 130 mph design
 * wind speed. Positioning vs Orlando + Winter Park: family-suburban,
 * fast response from Orlando base, school-district trust (Hagerty +
 * Oviedo High), value-conscious quality.
 *
 * Oviedo also has a SEPARATE storm-damage page (oviedo-storm-damage.ts)
 * targeting a distinct keyword cluster — emergency tarping, insurance
 * claim documentation, mitigation. The two pages share NAP, schema, and
 * canonical resources but diverge in content, CTA emphasis, and FAQs.
 */

import type { CityData } from './types';

export const OVIEDO: CityData = {
  slug: 'oviedo-roofing',
  name: 'Oviedo',
  county: 'Seminole County',
  state: 'FL',
  geo: { lat: 28.67, lng: -81.2081 },
  neighborhoods: [
    'Alafaya Woods',
    'Carillon',
    'Country Creek',
    'Estates at Aloma Woods',
    'Estates at Tuska Ridge',
    'Kingsbridge',
    'Live Oak Reserve',
    'Oviedo on the Park',
    'Stoneybrook',
    'Twin Rivers',
  ],
  hurricaneRiskNotes:
    'Oviedo sits in the Florida Building Code 130 mph wind-design zone (ASCE 7-22 Risk Category II) shared with Orange County. Hurricane Ian (Sep 2022) and Nicole (Nov 2022) caused notable wind and water damage across the Alafaya Woods and Stoneybrook neighborhoods, including dozens of insurance-claim roofs we documented across the area.',
  hero: {
    headline: 'Roofing Services in Oviedo, FL',
    sub: 'Seminole County roofing specialists based in the Orlando area. Two active state licenses, bilingual EN/ES crew, free no-obligation roof inspection.',
    ctaLabel: 'Get a Free Roof Inspection',
    secondaryCtaLabel: 'Call (407) 942-6459',
  },
  intro: [
    "Oviedo has grown from its chicken-roundabout small-town roots into one of Seminole County's strongest school-district communities: a town where families plant roots for decades and stay long enough to need a second roof on the same house. That kind of community needs a contractor with a verifiable license record and a fixed Orlando-area business address.",
    'From our Orlando base we serve Oviedo neighborhoods including Alafaya Woods, Carillon, Live Oak Reserve, and Stoneybrook. After a named storm, fast documentation and mitigation help prevent a small leak from becoming a larger interior claim.',
    'Two active Florida DBPR licenses (Certified Roofing Contractor CCC1337413 and Certified General Contractor CGC1534077) help us plan roofing and general construction scope under one accountable contractor. Our crew is bilingual English/Spanish for clear communication with everyone in the household, every step of the project.',
  ],
  whyUs: [
    {
      title: 'Orlando-area response',
      body: 'From our Orlando base we serve most Oviedo neighborhoods quickly, with priority placed on documentation, mitigation, and clear next steps after storm events.',
    },
    {
      title: 'Seminole County permit fluency',
      body: 'Seminole County permitting and inspection requirements are included in the planning conversation when your project needs approval.',
    },
    {
      title: 'School-district neighbors',
      body: 'We understand the neighborhood mix across Alafaya Woods, Live Oak Reserve, Stoneybrook, and the surrounding Oviedo service area.',
    },
    {
      title: 'Bilingual EN/ES communication',
      body: 'Clear conversations with every family member. Spanish-speaking project lead available on request — comunicación clara, en su idioma.',
    },
  ],
  serviceHighlights: [
    {
      serviceId: 'roofing',
      headline: 'Suburban shingle, tile, metal — Oviedo & Seminole County',
      body: 'Architectural shingle for the typical Oviedo two-story (Live Oak Reserve, Stoneybrook). Concrete and clay tile for the older Alafaya Woods stock. Metal where homeowners want maximum hurricane resilience after the lessons of Ian.',
    },
    {
      serviceId: 'general',
      headline: 'Additions, garage conversions, suburban renovations',
      body: 'Adding a 4th bedroom, converting a garage to a home office, or renovating a kitchen or bath requires clean scope planning, permit awareness, and a contractor accountable for the finished work.',
    },
    {
      serviceId: 'deck',
      headline: 'Family backyard decks, pool fencing, screen rooms',
      body: 'Pressure-treated and composite decking sized for typical Oviedo lots. Code-compliant pool fencing per Florida Statute Chapter 515. Screen rooms that hold up in Florida humidity through every summer.',
    },
    {
      serviceId: 'paint',
      headline: 'UV-rated paint for two-story Oviedo homes',
      body: 'The standard Oviedo two-story bakes in afternoon sun for the entire summer. Premium acrylic and elastomeric exterior coatings rated for sustained UV — the difference between a 12-year coating and a 4-year repaint.',
    },
  ],
  localProjects: [
    {
      slug: 'alafaya-woods-tile-replacement',
      alt: 'Tile roof replacement in Alafaya Woods, Oviedo',
      caption: 'Alafaya Woods — concrete tile replacement following Ian damage',
    },
    {
      slug: 'stoneybrook-shingle-storm',
      alt: 'Architectural shingle replacement, Stoneybrook Oviedo',
      caption: 'Stoneybrook — full architectural shingle replacement after Nicole',
    },
    {
      slug: 'live-oak-reserve-paint-siding',
      alt: 'Two-story exterior repaint, Live Oak Reserve Oviedo',
      caption: 'Live Oak Reserve — full exterior repaint with elastomeric system',
    },
  ],
  testimonialIds: [
    'downey-2024-residential',
    'oreilly-investor-property',
    'lewis-2024-roof-replacement',
  ],
  faqIds: [
    'insurance-claims',
    'free-inspection',
    'project-timeline',
    'license-verification',
    'why-beit',
    'service-area',
  ],
  // Oviedo-centered Google Maps embed.
  mapEmbed:
    'https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d224094.85!2d-81.21!3d28.67!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x88e770040efc1cb1%3A0x6c1cc0d9d6fb0da3!2sOviedo%2C%20FL!5e0!3m2!1sen!2sus!4v1714355200000',
};
