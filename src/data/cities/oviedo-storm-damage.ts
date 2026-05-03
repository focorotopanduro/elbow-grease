/**
 * Oviedo Storm Damage page data — distinct from oviedo.ts.
 *
 * Targets a SEPARATE keyword cluster: "storm damage roof Oviedo",
 * "emergency roof tarping Seminole County", "hurricane roof claim Oviedo",
 * etc. Same physical city, but the visitor intent is urgent + insurance-
 * adjacent, not "considering re-roofing in 6 months."
 *
 * Architectural decision: rather than introducing a `pageVariant` flag in
 * the CityData type (which would push template-level branching into the
 * UI layer), we keep the type uniform and let CONTENT carry the difference.
 * The phone-first CTA is achieved purely via the new optional
 * `primaryCtaHref` / `secondaryCtaHref` fields on CityHeroCopy.
 *
 * Service highlights are TIGHTER (3 instead of 4) because the storm-
 * damage visitor doesn't need a deck/fence pitch — they need to know we
 * can re-roof, repair interior water damage, and finish the wall systems.
 */

import type { CityData } from './types';

export const OVIEDO_STORM_DAMAGE: CityData = {
  slug: 'oviedo-storm-damage',
  // We surface "Oviedo" as the city name throughout — the page is still
  // about Oviedo, just with a different commercial intent. This keeps
  // testimonials + FAQ filters pointing at the right canonical sources.
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
    'Oviedo sits in the Florida Building Code 130 mph wind-design zone (ASCE 7-22 Risk Category II). Ian (Sep 2022) and Nicole (Nov 2022) produced widespread wind and water-damage concerns across Seminole County, making documentation and mitigation planning especially important for Oviedo homeowners.',
  hero: {
    headline: 'Storm Damage Roof Repair in Oviedo, FL',
    sub: 'Storm-damage documentation, emergency mitigation planning, and insurance-aware scope notes for Oviedo homeowners.',
    ctaLabel: 'Call (407) 942-6459 for Storm Help',
    secondaryCtaLabel: 'Free Damage Assessment',
    // Phone is the primary action. The contact form is the fallback.
    primaryCtaHref: 'tel:+14079426459',
    secondaryCtaHref: '#contact',
  },
  intro: [
    'After a named storm, the first priority is limiting additional water intrusion and documenting visible damage before conditions change. Most Florida policies require reasonable mitigation steps, so emergency tarping or temporary dry-in planning may matter before the permanent repair scope is ready.',
    'Good storm documentation is specific and organized: photos of visible damage, roof-area context, attic observations where safely accessible, and notes that separate temporary mitigation from permanent repair. We keep the conversation factual so homeowners have useful information for the next claim or repair step.',
    'After a named storm, roofing schedules across Central Florida can tighten quickly. Beit Building Contractors carries two active Florida DBPR licenses (CCC1337413 + CGC1534077) and keeps storm-response conversations focused on mitigation, documentation, and a repair scope that is easy for the homeowner to understand.',
  ],
  whyUs: [
    {
      title: 'Storm response planning',
      body: 'During named-storm events, the priority is documenting damage, limiting additional water intrusion, and identifying the next safe repair step.',
    },
    {
      title: 'Mitigation-first approach',
      body: 'Limit water entry first, document visible conditions, then plan the permanent repair. The mitigation step helps protect the home while the larger scope is being reviewed.',
    },
    {
      title: 'Claim-ready documentation',
      body: 'Photos, measurements, attic observations where accessible, and plain-language scope notes give homeowners organized information for the claim conversation.',
    },
    {
      title: 'Insurance-aware scope notes',
      body: 'Coverage decisions belong to the carrier, but a clear repair scope helps reduce confusion between temporary dry-in work and the permanent fix.',
    },
  ],
  serviceHighlights: [
    {
      serviceId: 'roofing',
      headline: 'Emergency tarping + permanent repair',
      body: 'Emergency tarping and temporary dry-in planning help limit water entry until permanent repair can begin. When the repair schedule lands, the permanent solution is scoped to current Florida Building Code standards.',
    },
    {
      serviceId: 'general',
      headline: 'Interior damage from water intrusion',
      body: 'When a storm-damaged roof lets water through, the damage usually extends below the deck — soaked drywall, swollen framing, mold-prone insulation. License CGC1534077 lets us handle the whole interior rebuild under one accountable team, with the insurance documentation to match.',
    },
    {
      serviceId: 'paint',
      headline: 'Drying, paint, siding reinstallation',
      body: 'After interior water damage and structural repair, the finish work matters. We coordinate the drying schedule with our painters and James Hardie siding installers so your home is finished, not just patched.',
    },
  ],
  localProjects: [
    {
      slug: 'alafaya-woods-emergency-tarp',
      alt: 'Emergency roof tarping in Alafaya Woods, Oviedo, after Hurricane Ian',
      caption: 'Alafaya Woods — emergency tarp planning after storm damage',
    },
    {
      slug: 'stoneybrook-claim-documentation',
      alt: 'Drone aerial documentation of storm-damaged roof, Stoneybrook Oviedo',
      caption: 'Stoneybrook — drone aerial documentation for insurance claim package',
    },
    {
      slug: 'twin-rivers-permanent-repair',
      alt: 'Permanent storm-damage roof repair, Twin Rivers Oviedo',
      caption: 'Twin Rivers — permanent roof repair scope after storm damage',
    },
  ],
  testimonialIds: [
    'downey-2024-residential',
    'oreilly-investor-property',
    'lewis-2024-roof-replacement',
  ],
  faqIds: [
    'hurricane-emergency',
    'insurance-claims',
    'license-verification',
    'free-inspection',
    'project-timeline',
    'why-beit',
  ],
  // Oviedo-centered Google Maps embed (same as oviedo.ts).
  mapEmbed:
    'https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d224094.85!2d-81.21!3d28.67!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x88e770040efc1cb1%3A0x6c1cc0d9d6fb0da3!2sOviedo%2C%20FL!5e0!3m2!1sen!2sus!4v1714355200000',
};
