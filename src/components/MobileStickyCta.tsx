import { useEffect, useState } from 'react';
import { trackCta } from '../lib/interactions';
import './MobileStickyCta.css';

/**
 * MobileStickyCta — fixed bottom bar with two equal CTA buttons.
 * Mobile-only (display: none on >720px viewport).
 *
 * Hides itself when the Contact section is in viewport so it doesn't
 * compete with the form for attention or cover the submit button.
 *
 * Tracks both buttons via the standard cta_click + placement events.
 */
const PhoneIconSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const QuoteIconSvg = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M14 3h7v7" />
    <path d="m10 14 11-11" />
    <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
  </svg>
);

export default function MobileStickyCta() {
  // Hidden when the Contact section is on screen (so the bar doesn't
  // cover the form's submit button or its own restored-draft banner).
  const [hideOnFocusSection, setHideOnFocusSection] = useState(false);

  useEffect(() => {
    const targets = ['contact', 'smart-path']
      .map((id) => document.getElementById(id))
      .concat(Array.from(document.querySelectorAll<HTMLElement>('footer')))
      .filter((el): el is HTMLElement => Boolean(el));
    if (!targets.length) return;

    const visible = new Set<string>();

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          // Hide the moment any portion of Contact intersects the
          // viewport — even minimal overlap, since the bar covers
          // the bottom 70-80px of the screen on mobile.
          const id = (entry.target as HTMLElement).id;
          if (entry.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        setHideOnFocusSection(visible.size > 0);
      },
      // Negative bottom rootMargin lets the bar START hiding once
      // the user is even close to the form, smoothing the transition.
      { rootMargin: '0px 0px 80px 0px', threshold: 0 },
    );
    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);

  return (
    <div
      className={`msc ${hideOnFocusSection ? 'msc--hidden' : ''}`}
      role="region"
      aria-label="Quick contact actions"
      aria-hidden={hideOnFocusSection}
    >
      <a
        href="tel:+14079426459"
        className="msc__btn msc__btn--call"
        data-cta-source="mobile_sticky_call"
        onClick={trackCta('call_phone', 'mobile_sticky')}
      >
        <span className="msc__btn-icon" aria-hidden="true"><PhoneIconSvg /></span>
        <span className="msc__btn-label">
          <span className="msc__btn-eyebrow">Call</span>
          <span className="msc__btn-text">(407) 942-6459</span>
        </span>
      </a>
      <a
        href="#contact"
        className="msc__btn msc__btn--quote"
        data-cta-source="mobile_sticky_quote"
        onClick={trackCta('book_quote', 'mobile_sticky')}
      >
        <span className="msc__btn-icon" aria-hidden="true"><QuoteIconSvg /></span>
        <span className="msc__btn-label">
          <span className="msc__btn-eyebrow">Request</span>
          <span className="msc__btn-text">Estimate</span>
        </span>
      </a>
    </div>
  );
}
