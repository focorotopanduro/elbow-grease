/**
 * Frequently Asked Questions — single source of truth.
 *
 * Used by:
 *   - src/sections/FAQ.tsx (visible accordion)
 *   - src/data/schemas/faq.ts (FAQPage JSON-LD)
 *
 * AUTHORING GUIDELINES:
 *   • Answers are sales copy AND SEO content. Be specific (mention real
 *     license numbers, brand names, ranges) but avoid promising fixed
 *     timelines that depend on project scope.
 *   • Use real phone (407) 942-6459, real DBPR licenses CCC1337413 +
 *     CGC1534077, real address (2703 Dobbin Dr, Orlando, FL 32817).
 *   • Honesty: NEVER invent stats. If a number isn't verified, omit it.
 *   • Length: 60–180 words per answer. Shorter feels evasive, longer
 *     scans badly in the rich-results snippet (Google truncates at ~300
 *     chars in the FAQ accordion that surfaces in SERPs).
 *   • Use \n\n for paragraph breaks. The UI renders each block as <p>;
 *     the schema joins them with newlines (Google strips HTML).
 *   • Links go in the `links` array, NOT inline anchors. Schema parsers
 *     are flaky with HTML inside acceptedAnswer.text.
 */

export type FaqCategory =
  | 'insurance'
  | 'process'
  | 'pricing'
  | 'warranty'
  | 'trust'
  | 'timing'
  | 'service-area'
  | 'emergency';

export type ServiceTag = 'roofing' | 'general' | 'deck' | 'paint';

export interface FaqLink {
  label: string;
  href: string;
  /** External links open in a new tab; internal links jump anchors. */
  external?: boolean;
}

export interface FaqEntry {
  /** Stable id — also used as URL fragment + schema @id suffix. */
  id: string;
  category: FaqCategory;
  /** The question, exactly as a customer would phrase it. */
  question: string;
  /** Plain-text answer. Use \n\n for paragraph breaks. */
  answer: string;
  /** CTAs/links shown under the answer, after the body text. */
  links?: FaqLink[];
  /** Filter tag — used by future per-service FAQ filters. */
  relatedServices?: ServiceTag[];
}

export const FAQS: FaqEntry[] = [
  {
    id: 'insurance-claims',
    category: 'insurance',
    question: 'Do you handle insurance claims for roof damage?',
    answer:
      "We help document roof damage for your insurance claim and can coordinate scope information with your adjuster when requested. The inspection package can include photos, notes, measurements, and a clear repair or replacement scope so you have organized information for the claim conversation.\n\nCoverage and payment decisions are made by your insurance carrier. We do not promise claim approval, but we keep the documentation factual, easy to review, and aligned with the work your home actually needs.",
    relatedServices: ['roofing'],
    links: [
      { label: 'Schedule a free claim inspection', href: '#contact' },
    ],
  },
  {
    id: 'free-inspection',
    category: 'pricing',
    question: 'Is the free inspection actually free? What does it include?',
    answer:
      "Yes. The inspection is free, no-obligation, and no-pressure. A typical visit includes a roof walk when conditions allow, photos of visible slopes and penetrations, attic leak checks where accessible, and notes on flashing, gutters, fascia, or storm-related damage.\n\nAfter the site visit, we prepare written findings and an itemized repair or replacement estimate as scheduling, materials, and project complexity allow. If your roof is in good shape, we will tell you that too.",
    links: [
      { label: 'Book a free inspection', href: '#contact' },
    ],
  },
  {
    id: 'project-timeline',
    category: 'timing',
    question: 'How long does a typical roof replacement or project take?',
    answer:
      "Most residential roof replacements are completed in 1 to 3 days from tear-off to final cleanup. Larger or more complex roofs (multi-slope, tile, slate, or metal standing-seam) can take 3 to 7 days.\n\nGeneral construction varies widely — a kitchen renovation might run 4 to 8 weeks, while a ground-up build is usually 4 to 8 months depending on permits. Decks and fences are typically 2 to 5 days. Interior or exterior paint jobs are 2 to 7 days.\n\nWe provide a written timeline before we start and give you a daily progress update — no surprises.",
    relatedServices: ['roofing', 'general', 'deck', 'paint'],
  },
  {
    id: 'warranty',
    category: 'warranty',
    question: 'What kind of warranty do you offer?',
    answer:
      "Two layers of protection: (1) the manufacturer warranty on the materials themselves, which is typically 25 to 50 years for asphalt shingles, lifetime for many metal systems, and 30 to 50 years for tile; and (2) Beit's own workmanship warranty covering installation defects.\n\nThe specific coverage depends on the manufacturer and the system selected — we walk through the exact warranty language with you before signing, so you know what's covered, for how long, and how to make a claim if something ever goes wrong.",
    relatedServices: ['roofing', 'general', 'deck', 'paint'],
  },
  {
    id: 'license-verification',
    category: 'trust',
    question: 'How can I verify your license and insurance?',
    answer:
      "We hold two state-issued Florida DBPR licenses: Certified Roofing Contractor CCC1337413 and Certified General Contractor CGC1534077. Both are current and active.\n\nYou can verify either one yourself at myfloridalicense.com — just paste the license number into the License Number search and you'll see the live state record, including status, expiration, and qualifier of record. Our certificates of liability and workers' comp insurance are available on request before any work begins.",
    links: [
      {
        label: 'Verify on myfloridalicense.com',
        href: 'https://www.myfloridalicense.com/wl11.asp?mode=1&search=LicNbr',
        external: true,
      },
    ],
  },
  {
    id: 'hurricane-emergency',
    category: 'emergency',
    question: 'What do I do if my roof is damaged in a hurricane?',
    answer:
      "Call us at (407) 942-6459 as soon as it is safe to do so. The first priority is stabilizing your home: emergency tarping or temporary dry-in planning can help limit water entry and additional damage to the structure, drywall, and contents.\n\nOnce the property is secure, we document visible damage for your insurance claim and scope the permanent repair as soon as materials, access, and weather allow. Acting fast matters because most insurance policies require you to mitigate further damage promptly.",
    relatedServices: ['roofing'],
    links: [
      { label: 'Call (407) 942-6459 now', href: 'tel:+14079426459' },
    ],
  },
  {
    id: 'service-area',
    category: 'service-area',
    question: 'What areas do you serve?',
    answer:
      "We serve the greater Orlando metropolitan area: Orange County, Seminole County, and Osceola County. Specifically, we work regularly in Orlando, Winter Park, Oviedo, Kissimmee, Sanford, Altamonte Springs, Maitland, Apopka, Lake Mary, and Casselberry.\n\nIf your property is outside this radius, give us a call — depending on the project type and our current schedule, we may still be able to help, or we can refer you to a trusted contractor in your area.",
  },
  {
    id: 'financing-draft',
    category: 'pricing',
    question: 'Do you offer financing options?',
    answer:
      "Yes. We partner with several Florida-based lenders to offer financing options that fit a range of budgets — including 0% promotional periods, deferred-payment plans, and longer-term fixed-rate loans for larger projects.\n\nPre-qualification takes a few minutes online and does not affect your credit score. We'll walk through the available programs during your estimate so you can compare against paying out of pocket or using insurance proceeds.",
  },
  {
    id: 'estimate-process',
    category: 'process',
    question: 'What does the free estimate process look like?',
    answer:
      "Four straightforward steps: (1) you call us at (407) 942-6459 or fill out the contact form and we schedule a visit. (2) Our crew arrives on-site for an inspection, photos, measurements, and a conversation about your goals. (3) We prepare a written, itemized estimate after the site visit.\n\n(4) You decide on your timeline. No pressure. If you have questions about the scope or want to compare options, we will talk you through it.",
    links: [
      { label: 'Request a free estimate', href: '#contact' },
    ],
  },
  {
    id: 'payment-methods',
    category: 'pricing',
    question: 'What payment methods do you accept?',
    answer:
      "Cash, personal or business check, credit and debit card, and ACH bank transfer. For most projects, we structure payment as a deposit at signing, a progress payment at the midway milestone for larger jobs, and the balance at completion after your final walkthrough.\n\nFor insurance-related work, we keep the payment schedule clear in writing and can help organize scope documentation for the claim conversation. Coverage, deductibles, and release of funds are controlled by your policy and carrier.",
  },
  {
    id: 'whats-in-quote',
    category: 'pricing',
    question: "What's included in a written quote?",
    answer:
      "Every Beit estimate is itemized and transparent. You'll see: scope of work (broken down by phase), materials list with specific brands and product lines, labor cost, timeline estimate, payment schedule, warranty coverage, debris disposal, and required permits.\n\nNo hidden fees, no last-minute change orders for items that should have been included up front. The price you sign is the price you pay — the only exceptions are unforeseen issues discovered after tear-off (e.g., rotten decking that wasn't visible from the surface), which we always document with photos and quote separately before proceeding.",
  },
  {
    id: 'why-beit',
    category: 'trust',
    question: 'Why should I choose Beit Building Contractors?',
    answer:
      "Three reasons specifically: First, we hold two active Florida state licenses: Certified Roofing Contractor CCC1337413 and Certified General Contractor CGC1534077. That lets one accountable team talk through roofing, structural, and general construction needs without handoffs getting blurry.\n\nSecond, our crew is bilingual English/Spanish, which matters for clear communication on a project that affects your home. Third, we are locally owned in Orlando, with a fixed address and documents you can verify before work begins.\n\nAdd free no-pressure inspections, transparent itemized pricing, and practical storm-damage documentation, and you get a contractor relationship built around clarity.",
    links: [
      { label: 'See our recent projects', href: '#about' },
      { label: 'Get a free quote', href: '#contact' },
    ],
  },
];

/* ─────────────────────────────────────────────────────────────────────────
 * Derived helpers
 * ───────────────────────────────────────────────────────────────────────── */

/** Lookup by id — used by tests + schema cross-references. */
export function getFaqById(id: string): FaqEntry | undefined {
  return FAQS.find((f) => f.id === id);
}

/** Filter by category — used by future per-page filtered FAQ modules. */
export function getFaqsByCategory(category: FaqCategory): FaqEntry[] {
  return FAQS.filter((f) => f.category === category);
}

/** Filter by service tag — used by the per-city pages in Phases 7-8. */
export function getFaqsByService(service: ServiceTag): FaqEntry[] {
  return FAQS.filter((f) => f.relatedServices?.includes(service));
}
