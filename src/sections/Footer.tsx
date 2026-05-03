import TrustInline from '../components/TrustInline';
import { GBP_URL, BRAND_NAME } from '../data/business';
import { trackCta } from '../lib/interactions';
import './Footer.css';

const PHONE = import.meta.env.VITE_BUSINESS_PHONE || '+14079426459';
const EMAIL = import.meta.env.VITE_BUSINESS_EMAIL || 'beitbuilding@gmail.com';
const YEAR = new Date().getFullYear();

const PhoneIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const MailIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
    <path d="m22 6-10 7L2 6" />
  </svg>
);

const PinIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
    <circle cx="12" cy="10" r="3" />
  </svg>
);

const GoogleIcon = () => (
  // Stylised "G" inscribed in a square — neutral mark that doesn't violate
  // Google's brand-asset usage rules (we don't use the rainbow logo).
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 1 1-3.5-7.1" />
    <path d="M21 12h-9" />
  </svg>
);

export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer__inner">
        <div className="footer__brand">
          <span className="footer__logo">
            <picture>
              <source srcSet="/logo-mark.webp" type="image/webp" />
              <img src="/logo-mark.png" alt="" width="48" height="48" loading="lazy" />
            </picture>
          </span>
          <p className="footer__name">
            <strong>Beit Building Contractors</strong>
            <span>LLC</span>
          </p>
          <p className="footer__tag">
            Orlando's trusted roofing and construction specialists.
            Quality craftsmanship. Transparent pricing. Clear next steps.
          </p>
        </div>

        <nav className="footer__nav" aria-label="Footer navigation">
          <h4>Quick Links</h4>
          <ul>
            <li><a href="#home">Home</a></li>
            <li><a href="#services">Services</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="#contact">Contact</a></li>
          </ul>
        </nav>

        <nav className="footer__nav" aria-label="Service navigation">
          <h4>Services</h4>
          <ul>
            <li><a href="#services">Roofing Services</a></li>
            <li><a href="#services">General Construction</a></li>
            <li><a href="#services">Deck &amp; Fence Installation</a></li>
            <li><a href="#services">Painting &amp; Siding</a></li>
          </ul>
        </nav>

        <div className="footer__contact">
          <h4>Contact</h4>
          <ul>
            <li>
              <a
                href={`tel:${PHONE}`}
                data-cta-source="footer_call"
                onClick={trackCta('call_phone', 'footer')}
              >
                <PhoneIcon /> (407) 942-6459
              </a>
            </li>
            <li>
              <a
                href={`mailto:${EMAIL}`}
                data-cta-source="footer_email"
                onClick={trackCta('email', 'footer')}
              >
                <MailIcon /> {EMAIL}
              </a>
            </li>
            <li>
              <a
                href="https://maps.google.com/?q=2703+Dobbin+Dr+Orlando+FL+32817"
                target="_blank"
                rel="noopener noreferrer"
                data-cta-source="footer_directions"
                onClick={trackCta('directions', 'footer')}
              >
                <PinIcon /> 2703 Dobbin Dr, Orlando, FL 32817
              </a>
            </li>
            {GBP_URL && (
              /* Google Business Profile link — only renders when GBP is
                 verified + GBP_URL is set in src/data/business.ts. The
                 entity-graph signal also propagates to schema sameAs
                 automatically. See docs/google-business-profile-setup.md. */
              <li>
                <a
                  href={GBP_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View ${BRAND_NAME} on Google Business Profile`}
                  data-cta-source="footer_gbp"
                  onClick={trackCta('view_gbp', 'footer')}
                >
                  <GoogleIcon /> View us on Google
                </a>
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* Secondary trust block — full-width strip above the legal bar.
          Surfaces the same DBPR licenses as the floating TrustBadge for
          visitors who scroll past corner badges entirely. */}
      <div className="footer__trust container">
        <TrustInline variant="footer" heading="Verify state licenses" />
      </div>

      <div className="footer__bar container">
        <p>© {YEAR} Beit Building Contractors LLC. All rights reserved.</p>
        <ul className="footer__legal" aria-label="Legal and accessibility links">
          <li><a href="/privacy.html">Privacy Policy</a></li>
          <li><a href="/terms.html">Terms of Service</a></li>
          <li><a href="/accessibility.html">Accessibility</a></li>
        </ul>
      </div>
    </footer>
  );
}
