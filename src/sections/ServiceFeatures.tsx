import { ServiceFeature } from './Services';

export default function ServiceFeatures() {
  return (
    <>
      <ServiceFeature
        id="residential-roofing"
        index="01"
        eyebrow="Residential Roofing"
        title="Weather-read roofs"
        titleEm="for Florida homes"
        body={[
          'Every roof is treated as a protective system, not a surface swap. The crew checks the visible wear, the likely water path, and the details that decide whether the repair holds after the next hard storm.',
        ]}
        image="/images/house-2.jpg"
        alt="Beautiful home roofing project by Beit Building Contractors"
        note="Inspection notes stay practical: what is urgent, what can wait, and what should not be hidden under new material."
        deliverables={['Leak path', 'Material call', 'Photo notes']}
        pathId="roof"
      />

      <ServiceFeature
        id="general-construction"
        index="02"
        eyebrow="General Construction"
        title="Renovations with"
        titleEm="structural discipline"
        body={[
          'From repair work to larger renovation scopes, the build is sequenced around access, existing conditions, trade coordination, and a clean handoff instead of guesswork.',
        ]}
        image="/images/house-3.jpg"
        alt="General construction project by Beit Building Contractors Orlando"
        reverse
        note="The goal is a finished space that looks intentional because the hidden steps were handled in the right order."
        deliverables={['Access plan', 'Trade sequence', 'Finish handoff']}
        pathId="build"
      />

      <ServiceFeature
        id="decks-fences"
        index="03"
        eyebrow="Decks & Outdoor Living"
        title="Outdoor space"
        titleEm="that works daily"
        body={[
          'Deck and fence projects are planned around sun, drainage, privacy, fastening, and the way the yard is actually used after the tools leave.',
        ]}
        image="/images/house-4.jpg"
        alt="Beautiful deck and outdoor space by Beit Building"
        note="Durability comes from the small decisions: post layout, hardware, transitions, and material behavior in heat and rain."
        deliverables={['Layout read', 'Hardware spec', 'Clean perimeter']}
        pathId="build"
      />

      <ServiceFeature
        id="painting-siding"
        index="04"
        eyebrow="Painting & Siding"
        title="A cleaner shell"
        titleEm="with purpose"
        body={[
          'Paint and siding work should improve curb appeal while protecting the material beneath. Surface prep, seams, trim conditions, and moisture exposure shape the final scope.',
        ]}
        image="/images/house-5.jpg"
        alt="Interior and exterior painting by Beit Building Contractors"
        reverse
        note="The finish is the visible part. The prep is what decides how long that finish keeps looking intentional."
        deliverables={['Prep review', 'Color path', 'Envelope protection']}
        pathId="build"
      />
    </>
  );
}
