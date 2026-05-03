import { useEffect, useState } from 'react';
import { trackCta } from '../lib/interactions';
import './FloatingCTA.css';

export default function FloatingCTA() {
  const [visible, setVisible] = useState(false);
  const [hideOnFocusSection, setHideOnFocusSection] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > window.innerHeight * 0.6);

      const focusSections = [
        document.getElementById('smart-path'),
        document.querySelector('.trust-ledger'),
        document.getElementById('services'),
        document.querySelector('.sg'),
        document.getElementById('contact'),
      ].filter((el): el is Element => Boolean(el));

      setHideOnFocusSection(focusSections.some((section) => {
        const rect = section.getBoundingClientRect();
        return rect.top < window.innerHeight - 120 && rect.bottom > 140;
      }));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div
      className={`fcta ${visible && !hideOnFocusSection ? 'fcta--visible' : ''}`}
      aria-hidden={!visible || hideOnFocusSection}
    >
      <a
        href="https://wa.me/4079426459"
        target="_blank"
        rel="noopener noreferrer"
        className="fcta__btn fcta__btn--whatsapp glass--dark"
        aria-label="Message us on WhatsApp"
        data-cta-source="floating_cta_whatsapp"
        onClick={trackCta('whatsapp', 'floating_cta')}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M17.6 6.32A7.85 7.85 0 0 0 12.05 4a7.94 7.94 0 0 0-6.88 11.93L4 20l4.18-1.1a7.93 7.93 0 0 0 3.86 1h.01a7.94 7.94 0 0 0 5.55-13.58zM12.05 18.6h-.01a6.6 6.6 0 0 1-3.36-.92l-.24-.14-2.49.65.66-2.42-.16-.25a6.6 6.6 0 1 1 12.25-3.49 6.6 6.6 0 0 1-6.65 6.57zm3.62-4.93c-.2-.1-1.18-.58-1.36-.65-.18-.07-.31-.1-.45.1-.13.2-.51.65-.62.78-.12.13-.23.15-.43.05a5.4 5.4 0 0 1-1.6-.99 6 6 0 0 1-1.1-1.38c-.12-.2 0-.31.09-.41.09-.09.2-.23.3-.35.1-.12.13-.2.2-.33.06-.13.03-.25-.02-.35-.05-.1-.45-1.08-.62-1.48-.16-.39-.32-.34-.45-.34l-.38-.01c-.13 0-.35.05-.53.25-.18.2-.7.68-.7 1.66 0 .98.71 1.92.81 2.05.1.13 1.4 2.13 3.39 2.99.47.2.84.32 1.13.42.48.15.91.13 1.25.08.38-.06 1.18-.48 1.34-.95.17-.46.17-.86.12-.94-.05-.08-.18-.13-.38-.23z" />
        </svg>
      </a>

      <a
        href="tel:+14079426459"
        className="fcta__btn fcta__btn--call"
        aria-label="Call (407) 942-6459"
        data-cta-source="floating_cta_call"
        onClick={trackCta('call_phone', 'floating_cta')}
      >
        <span className="fcta__btn-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
          </svg>
        </span>
        <span className="fcta__btn-text">
          <span className="fcta__btn-label">Call now</span>
          <span className="fcta__btn-num">(407) 942-6459</span>
        </span>
      </a>
    </div>
  );
}
