/**
 * Winter Park city page data.
 *
 * Winter Park is in Orange County (NOT Seminole), shares the same FBC
 * 130 mph design wind speed as the rest of the Orlando metro. Distinct
 * positioning vs the Orlando page: Winter Park is the historic-home
 * specialty angle — slate, cedar, original clay tile, copper details,
 * Park Avenue district fluency.
 */

import type { CityData } from './types';

export const WINTER_PARK: CityData = {
  slug: 'winter-park-roofing',
  name: 'Winter Park',
  county: 'Orange County',
  state: 'FL',
  geo: { lat: 28.5999, lng: -81.3392 },
  neighborhoods: [
    'Audubon Park',
    'College Quarter',
    'Comstock Park',
    'Hannibal Square',
    'Interlachen',
    'Lake Killarney',
    'Lake Sue',
    'Olde Winter Park',
    'Park Avenue',
    'Virginia Heights',
    'Vue at Lake Lily',
  ],
  hurricaneRiskNotes:
    'Winter Park sits in the Florida Building Code 130 mph wind-design zone (ASCE 7-22 Risk Category II) shared with the rest of Orange County. Ian (Sep 2022) and Nicole (Nov 2022) downed historic-tree limbs across Park Avenue and Olde Winter Park, with significant tile and slate damage to the historic-home stock.',
  hero: {
    headline: 'Roofing Services in Winter Park, FL',
    sub: "Roofing support for Winter Park's historic and custom homes: slate, cedar, clay tile, and copper-detail conversations handled by a two-license contractor.",
    ctaLabel: 'Free Historic-Home Assessment',
    secondaryCtaLabel: 'Call (407) 942-6459',
  },
  intro: [
    "Winter Park's architectural heritage is unlike anywhere else in Central Florida. The Park Avenue corridor and Olde Winter Park district include Mediterranean Revival, Spanish Colonial, Tudor Revival, and custom homes where roof material, flashing details, and exterior finish choices need more care than a standard subdivision re-roof.",
    "Re-roofing a historic or custom Winter Park home is not the same job as re-roofing a 2008 stucco subdivision. Clay tile, slate, cedar, copper details, and preservation-sensitive finish choices all need careful sourcing, clear scope notes, and documentation before work begins.",
    'Beit Building Contractors holds two active Florida DBPR licenses (Certified Roofing Contractor CCC1337413 and Certified General Contractor CGC1534077). We keep Winter Park roof assessments focused on material compatibility, permit requirements, visible water paths, and preserving the character of the home where possible.',
  ],
  whyUs: [
    {
      title: 'Specialty material expertise',
      body: 'Slate, cedar, clay tile, and copper details require sourcing conversations before the quote is treated as final.',
    },
    {
      title: 'Park Avenue district fluency',
      body: 'Historic-area homes need extra attention to permits, visible details, and material compatibility before work begins.',
    },
    {
      title: 'Period-correct details',
      body: 'Hand-fabricated copper flashing. Color-matched tile lots. Cedar shake porch repair. The details that separate a restoration from a replacement.',
    },
    {
      title: 'Local accountability',
      body: "Locally owned, two state licenses, and a fixed Orlando address. You'll know exactly who is responsible before work begins.",
    },
  ],
  serviceHighlights: [
    {
      serviceId: 'roofing',
      headline: 'Slate, cedar, clay tile — period-correct restorations',
      body: "Park Avenue's older housing stock can require materials and techniques outside a standard shingle replacement. We review slate, cedar, clay tile, flashing, and compatibility questions before recommending a repair or replacement path.",
    },
    {
      serviceId: 'general',
      headline: 'Historic-addition framing & restoration',
      body: 'Additions and restoration work need framing, finish, and exterior-envelope decisions to agree with the original structure. License CGC1534077 lets those conversations stay with one accountable contractor.',
    },
    {
      serviceId: 'deck',
      headline: 'Period-correct fences, pergolas, garden walls',
      body: "Iron-and-stucco garden walls, cedar privacy fencing, hand-built wooden pergolas matched to the home's period. Built to last in Florida humidity but sized and detailed for the architecture they accompany.",
    },
    {
      serviceId: 'paint',
      headline: 'Old-World palettes, lead-aware repaint',
      body: 'Older homes may require lead-aware planning, careful prep, and finish choices that respect the original exterior character.',
    },
  ],
  localProjects: [
    {
      slug: 'park-avenue-clay-tile-restoration',
      alt: 'Clay tile roof restoration on Park Avenue, Winter Park',
      caption: 'Park Avenue district — clay tile restoration with period-matched color lot',
    },
    {
      slug: 'olde-winter-park-cedar-shake',
      alt: 'Cedar shake porch detail in Olde Winter Park',
      caption: 'Olde Winter Park — cedar shake porch restoration with kiln-dried mill stock',
    },
    {
      slug: 'lake-sue-copper-flashing',
      alt: 'Hand-fabricated copper flashing detail, Lake Sue Winter Park',
      caption: 'Lake Sue — hand-fabricated lead-coated copper flashing & ridge details',
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
    'license-verification',
    'project-timeline',
    'warranty',
    'why-beit',
  ],
  // Winter Park-centered Google Maps embed.
  mapEmbed:
    'https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d224094.85!2d-81.34!3d28.5999!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x88e7727d39d72057%3A0x53a4dbecc1e1f33d!2sWinter%20Park%2C%20FL!5e0!3m2!1sen!2sus!4v1714355200000',
};
