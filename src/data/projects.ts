/**
 * Project portfolio — single source of truth for the filterable
 * gallery section + modal lightbox.
 *
 * Used by:
 *   - src/sections/ProjectPortfolio.tsx (the visible filterable grid)
 *   - src/components/ProjectModal.tsx (lightbox detail view)
 *
 * Each entry is currently PLACEHOLDER content. Image paths point at
 * /public/images/projects/<city>/<slug>-{hero,before,after,gallery-N}.jpg
 * — when the real photos exist they load; until then, the runtime
 * onError handler in ProjectPortfolio.tsx + ProjectModal.tsx falls
 * back to gradient placeholders so the layout is always intact.
 *
 * Photo brief: docs/projects-photo-todo.md
 *
 * AUTHORING:
 *   - Add a new project: append to PROJECTS with a unique slug.
 *   - Mark `featured: true` to surface in any "featured projects"
 *     subset (currently unused but reserved for future use).
 *   - Service categories MUST match the SERVICES taxonomy in
 *     src/data/business.ts (`roofing` | `general` | `deck` | `paint`).
 *   - completedDate is ISO 8601 (`YYYY-MM-DD`) for sortability.
 */

export type ProjectCity =
  | 'orlando'
  | 'winter-park'
  | 'oviedo'
  | 'kissimmee'
  | 'sanford'
  | 'other';

export type ProjectService = 'roofing' | 'general' | 'deck' | 'paint';

export interface ProjectEntry {
  /** Stable id for React keys + URL hash navigation. */
  id: string;
  /** URL-safe slug — folder name under /public/images/projects/<city>/. */
  slug: string;
  /** Display title shown on card + modal. */
  title: string;
  /** Specific neighborhood — appears as a badge on the card. */
  neighborhood: string;
  /** Anchor city for filtering. */
  city: ProjectCity;
  /** Top-level service category. */
  serviceCategory: ProjectService;
  /** ISO 8601 date (`YYYY-MM-DD`) — used for sorting newest-first. */
  completedDate: string;
  /** 2-3 sentence project summary. Customer-facing copy. */
  summary: string;
  /** Hero image (16:9 ideal). Path: /images/projects/<city>/<slug>-hero.jpg */
  heroImage: string;
  /** Whether referenced photos exist and are approved for public marketing use. */
  photoStatus?: 'available' | 'pending';
  /** Additional gallery images. Each rendered as a thumbnail in the modal. */
  gallery: string[];
  /** Optional BEFORE photo for the modal's before-after slider. */
  beforeImage?: string;
  /** Optional AFTER photo. Both must be set for the slider to render. */
  afterImage?: string;
  /** Free-form tags for filterable subsets later (currently informational). */
  tags: string[];
  /** Highlight in any "featured" view. Reserved for future curation. */
  featured?: boolean;
}

const PATH = (city: ProjectCity, slug: string, suffix: string) =>
  `/images/projects/${city}/${slug}-${suffix}.jpg`;

export const PROJECTS: ProjectEntry[] = [
  // ─── Roofing ───────────────────────────────────────────────────────
  {
    id: 'audubon-park-tile-2024',
    slug: 'audubon-park-tile-restoration',
    title: 'Clay tile roof restoration',
    neighborhood: 'Audubon Park',
    city: 'orlando',
    serviceCategory: 'roofing',
    completedDate: '2024-09-12',
    summary:
      'Full clay tile roof restoration on a 1928 Mediterranean Revival home in the Audubon Park historic district. Period-correct color match against original tile lots, hand-fabricated copper flashing, FBC §1518 secondary water barrier underneath.',
    heroImage: PATH('orlando', 'audubon-park-tile-restoration', 'hero'),
    gallery: [
      PATH('orlando', 'audubon-park-tile-restoration', 'detail-1'),
      PATH('orlando', 'audubon-park-tile-restoration', 'detail-2'),
      PATH('orlando', 'audubon-park-tile-restoration', 'detail-3'),
    ],
    beforeImage: PATH('orlando', 'audubon-park-tile-restoration', 'before'),
    afterImage: PATH('orlando', 'audubon-park-tile-restoration', 'after'),
    tags: ['Mediterranean Revival', 'Historic district', 'Tile', 'Copper flashing'],
    featured: true,
  },
  {
    id: 'park-avenue-cedar-2024',
    slug: 'park-avenue-cedar-shake',
    title: 'Cedar shake porch restoration',
    neighborhood: 'Olde Winter Park',
    city: 'winter-park',
    serviceCategory: 'roofing',
    completedDate: '2024-07-22',
    summary:
      'Cedar shake replacement on a Park Avenue district porch overhang. Sourced kiln-dried Western Red Cedar from a Pacific Northwest specialty mill. Coordinated with the Winter Park Historic Preservation Board on permit submittal.',
    heroImage: PATH('winter-park', 'park-avenue-cedar-shake', 'hero'),
    gallery: [
      PATH('winter-park', 'park-avenue-cedar-shake', 'detail-1'),
      PATH('winter-park', 'park-avenue-cedar-shake', 'detail-2'),
    ],
    beforeImage: PATH('winter-park', 'park-avenue-cedar-shake', 'before'),
    afterImage: PATH('winter-park', 'park-avenue-cedar-shake', 'after'),
    tags: ['Historic preservation', 'Cedar shake', 'Park Avenue district'],
  },
  {
    id: 'stoneybrook-hurricane-2022',
    slug: 'stoneybrook-hurricane-claim',
    title: 'Post-hurricane shingle replacement',
    neighborhood: 'Stoneybrook',
    city: 'oviedo',
    serviceCategory: 'roofing',
    completedDate: '2022-11-30',
    summary:
      'Full architectural shingle re-roof following Hurricane Nicole damage. Documented for insurance with drone aerial photography + attic moisture readings. Class 4 impact-resistant shingles installed for ongoing premium discount.',
    heroImage: PATH('oviedo', 'stoneybrook-hurricane-claim', 'hero'),
    gallery: [
      PATH('oviedo', 'stoneybrook-hurricane-claim', 'detail-1'),
      PATH('oviedo', 'stoneybrook-hurricane-claim', 'detail-2'),
      PATH('oviedo', 'stoneybrook-hurricane-claim', 'detail-3'),
    ],
    beforeImage: PATH('oviedo', 'stoneybrook-hurricane-claim', 'before'),
    afterImage: PATH('oviedo', 'stoneybrook-hurricane-claim', 'after'),
    tags: ['Storm damage', 'Insurance claim', 'Class 4 impact'],
    featured: true,
  },

  // ─── General Construction ──────────────────────────────────────────
  {
    id: 'live-oak-reserve-garage-2024',
    slug: 'live-oak-reserve-garage-conversion',
    title: 'Garage to home office conversion',
    neighborhood: 'Live Oak Reserve',
    city: 'oviedo',
    serviceCategory: 'general',
    completedDate: '2024-05-18',
    summary:
      'Full conversion of a 2-car garage into a permitted, conditioned home office with separate entry. Structural reframing, HVAC tie-in, electrical upgrade, drywall + finish carpentry. License CGC1534077 carried the entire scope.',
    heroImage: PATH('oviedo', 'live-oak-reserve-garage-conversion', 'hero'),
    gallery: [
      PATH('oviedo', 'live-oak-reserve-garage-conversion', 'detail-1'),
      PATH('oviedo', 'live-oak-reserve-garage-conversion', 'detail-2'),
    ],
    tags: ['Conversion', 'Permitted', 'Seminole County'],
  },

  // ─── Deck & Fence ──────────────────────────────────────────────────
  {
    id: 'conway-composite-deck-2024',
    slug: 'conway-composite-deck',
    title: 'Backyard composite deck install',
    neighborhood: 'Conway',
    city: 'orlando',
    serviceCategory: 'deck',
    completedDate: '2024-03-08',
    summary:
      'Full backyard deck build-out using TimberTech AZEK composite decking, hidden-fastener system, code-compliant pool fencing per Florida Statute Chapter 515. Pressure-treated structural framing rated UC4A for ground contact.',
    heroImage: PATH('orlando', 'conway-composite-deck', 'hero'),
    gallery: [
      PATH('orlando', 'conway-composite-deck', 'detail-1'),
      PATH('orlando', 'conway-composite-deck', 'detail-2'),
    ],
    tags: ['Composite', 'Pool fencing', 'TimberTech AZEK'],
  },

  // ─── Painting & Siding ─────────────────────────────────────────────
  {
    id: 'lake-nona-exterior-paint-2024',
    slug: 'lake-nona-exterior-paint',
    title: 'Two-story exterior repaint',
    neighborhood: 'Lake Nona',
    city: 'orlando',
    serviceCategory: 'paint',
    completedDate: '2024-08-04',
    summary:
      'Full exterior repaint of a Lake Nona two-story using elastomeric coating system rated for sustained Florida UV. Trim and fascia detail painted in contrasting cream. 12-year manufacturer warranty.',
    heroImage: PATH('orlando', 'lake-nona-exterior-paint', 'hero'),
    gallery: [
      PATH('orlando', 'lake-nona-exterior-paint', 'detail-1'),
      PATH('orlando', 'lake-nona-exterior-paint', 'detail-2'),
    ],
    beforeImage: PATH('orlando', 'lake-nona-exterior-paint', 'before'),
    afterImage: PATH('orlando', 'lake-nona-exterior-paint', 'after'),
    tags: ['Elastomeric', 'Two-story', 'Color consultation'],
  },
];

/* ─────────────────────────────────────────────────────────────────────────
 * Derived helpers
 * ───────────────────────────────────────────────────────────────────────── */

/** Sort newest-first. */
export function getProjectsSorted(): ProjectEntry[] {
  return [...PROJECTS].sort((a, b) =>
    b.completedDate.localeCompare(a.completedDate),
  );
}

/** Filter by service + city. Either filter can be 'all' to skip it. */
export function filterProjects(
  service: ProjectService | 'all',
  city: ProjectCity | 'all',
): ProjectEntry[] {
  return getProjectsSorted().filter((p) => {
    if (service !== 'all' && p.serviceCategory !== service) return false;
    if (city !== 'all' && p.city !== city) return false;
    return true;
  });
}

/** Lookup by slug — used by URL-hash deep-linking in the modal. */
export function getProjectBySlug(slug: string): ProjectEntry | undefined {
  return PROJECTS.find((p) => p.slug === slug);
}

/** Unset status means pending, which avoids requesting placeholder paths. */
export function hasProjectPhotos(project: ProjectEntry): boolean {
  return project.photoStatus === 'available';
}

/** All distinct cities appearing in current projects. */
export function getAvailableCities(): ProjectCity[] {
  const set = new Set<ProjectCity>();
  for (const p of PROJECTS) set.add(p.city);
  return Array.from(set);
}

/** All distinct service categories appearing in current projects. */
export function getAvailableServices(): ProjectService[] {
  const set = new Set<ProjectService>();
  for (const p of PROJECTS) set.add(p.serviceCategory);
  return Array.from(set);
}

/** Human-readable label for a service category. */
export function labelForService(s: ProjectService): string {
  const map: Record<ProjectService, string> = {
    roofing: 'Roofing',
    general: 'General Construction',
    deck: 'Deck & Fence',
    paint: 'Painting & Siding',
  };
  return map[s];
}

/** Human-readable label for a city. */
export function labelForCity(c: ProjectCity): string {
  const map: Record<ProjectCity, string> = {
    orlando: 'Orlando',
    'winter-park': 'Winter Park',
    oviedo: 'Oviedo',
    kissimmee: 'Kissimmee',
    sanford: 'Sanford',
    other: 'Other',
  };
  return map[c];
}

/** Format ISO date as a human-friendly month + year. */
export function formatProjectDate(iso: string): string {
  try {
    const d = new Date(`${iso}T12:00:00Z`);
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
    });
  } catch {
    return iso;
  }
}
