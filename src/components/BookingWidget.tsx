import { useCallback, useEffect, useRef, useState } from 'react';
import { CALENDLY_URL, EMAIL, PHONE_DISPLAY } from '../data/business';
import { track } from '../lib/analytics';
import './BookingWidget.css';

/**
 * BookingWidget — lazy-loaded calendar embed for direct appointment
 * scheduling.
 *
 * Renders nothing when CALENDLY_URL is null (the default). Owner sets
 * the URL in src/data/business.ts and the section appears on home +
 * city pages.
 *
 * PROVIDER SUPPORT:
 *   - Calendly (https://calendly.com/<user>/...)
 *   - Cal.com  (https://cal.com/<user>/...)
 *   Auto-detected from URL host. Each provider's embed snippet differs;
 *   the component handles both.
 *
 * PERFORMANCE — third-party script does NOT load on initial paint.
 * The embed library is fetched + initialized only when a visitor
 * clicks "Open Calendar." This is critical for:
 *   - Performance: ~50-100kB saved on first paint
 *   - Privacy: third-party domain hits require explicit user consent
 *   - CSP: failure modes are isolated to opt-in interactions
 *
 * FALLBACK — if the third-party script fails to load (offline, CSP
 * mis-configured, network blocked), the component reveals an email +
 * phone fallback so the visitor can still convert.
 */

type Status = 'idle' | 'loading' | 'open' | 'failed';
type Provider = 'calendly' | 'cal-com';

interface CalendlyApi {
  initInlineWidget?: (opts: {
    url: string;
    parentElement: HTMLElement;
    prefill?: Record<string, unknown>;
    utm?: Record<string, unknown>;
  }) => void;
}

interface CalApi {
  (action: string, ...args: unknown[]): void;
  loaded?: boolean;
  q?: unknown[];
  ns?: Record<string, unknown>;
}

declare global {
  interface Window {
    Calendly?: CalendlyApi;
    Cal?: CalApi;
  }
}

function detectProvider(url: string): Provider | null {
  if (/^https?:\/\/(?:[\w-]+\.)?calendly\.com/i.test(url)) return 'calendly';
  if (/^https?:\/\/(?:[\w-]+\.)?cal\.com/i.test(url)) return 'cal-com';
  return null;
}

const CALENDLY_SCRIPT = 'https://assets.calendly.com/assets/external/widget.js';
const CAL_COM_SCRIPT = 'https://app.cal.com/embed/embed.js';

export default function BookingWidget() {
  // Hooks always run unconditionally — guards happen via early-render-null.
  const [status, setStatus] = useState<Status>('idle');
  const containerRef = useRef<HTMLDivElement>(null);

  const enabled = Boolean(CALENDLY_URL);
  const provider = CALENDLY_URL ? detectProvider(CALENDLY_URL) : null;

  // Listen for Calendly's `event_scheduled` postMessage so we can fire
  // the booking_completed analytics event when a visitor finishes
  // scheduling. Cal.com uses a different message format — handled in
  // its own branch below.
  useEffect(() => {
    if (!enabled || !provider) return;

    const handler = (e: MessageEvent) => {
      if (provider === 'calendly') {
        if (e.origin !== 'https://calendly.com') return;
        const data = e.data as { event?: string } | undefined;
        if (data?.event === 'calendly.event_scheduled') {
          track('cta_click', {
            cta: 'booking_completed',
            placement: 'booking_widget',
            provider: 'calendly',
          });
        }
      } else if (provider === 'cal-com') {
        // Cal.com sends namespaced events on its own channel. The
        // simplest cross-version-stable signal is the `bookingSuccessful`
        // event type sent on the parent window.
        const data = e.data as { type?: string } | undefined;
        if (data?.type === 'cal:bookingSuccessful' || data?.type === 'bookingSuccessful') {
          track('cta_click', {
            cta: 'booking_completed',
            placement: 'booking_widget',
            provider: 'cal-com',
          });
        }
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [enabled, provider]);

  const mountCalendly = useCallback(() => {
    if (!containerRef.current || !window.Calendly?.initInlineWidget) {
      setStatus('failed');
      return;
    }
    try {
      window.Calendly.initInlineWidget({
        url: CALENDLY_URL!,
        parentElement: containerRef.current,
        prefill: {},
        utm: {},
      });
      setStatus('open');
    } catch {
      setStatus('failed');
    }
  }, []);

  const mountCalCom = useCallback(() => {
    if (!containerRef.current || !window.Cal) {
      setStatus('failed');
      return;
    }
    try {
      // Cal.com namespace init pattern — see https://cal.com/docs/embed
      window.Cal('init', { origin: 'https://cal.com' });
      const calLink = CALENDLY_URL!.replace(/^https?:\/\/cal\.com\//i, '');
      window.Cal('inline', {
        elementOrSelector: containerRef.current,
        calLink,
        layout: 'month_view',
      });
      // Brand-tone the embed to the Beit gold palette
      window.Cal('ui', {
        theme: 'auto',
        styles: { branding: { brandColor: '#d4af37' } },
      });
      setStatus('open');
    } catch {
      setStatus('failed');
    }
  }, []);

  const loadProviderScript = useCallback(
    (src: string, onLoad: () => void) => {
      // Already loaded?
      const existing = document.querySelector<HTMLScriptElement>(
        `script[src="${src}"]`,
      );
      if (existing) {
        // Script tag exists but the global may still be initializing —
        // give it a tick. If still missing, fall through to failure.
        if (existing.dataset.loaded === 'true') {
          onLoad();
          return;
        }
        existing.addEventListener('load', () => onLoad(), { once: true });
        existing.addEventListener('error', () => setStatus('failed'), {
          once: true,
        });
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => {
        script.dataset.loaded = 'true';
        onLoad();
      };
      script.onerror = () => setStatus('failed');
      document.head.appendChild(script);
    },
    [],
  );

  const handleOpen = useCallback(() => {
    if (status !== 'idle' || !provider) return;
    setStatus('loading');
    track('cta_click', {
      cta: 'open_calendar',
      placement: 'booking_widget',
      provider,
    });

    if (provider === 'calendly') {
      if (window.Calendly?.initInlineWidget) {
        mountCalendly();
        return;
      }
      loadProviderScript(CALENDLY_SCRIPT, mountCalendly);
    } else if (provider === 'cal-com') {
      if (window.Cal) {
        mountCalCom();
        return;
      }
      loadProviderScript(CAL_COM_SCRIPT, mountCalCom);
    }
  }, [provider, status, loadProviderScript, mountCalendly, mountCalCom]);

  // Hard guard — render nothing when no URL configured or unsupported host.
  if (!enabled || !provider) return null;

  return (
    <section
      id="booking"
      className="booking section section--dark"
      aria-label="Book a free inspection"
    >
      <div className="container booking__inner">
        <header className="booking__header reveal">
          <p className="eyebrow">Schedule directly</p>
          <h2 className="booking__title">
            Book a <em>free inspection</em>
          </h2>
          <p className="booking__lead">
            Pick a time that works — most appointments scheduled within 48
            hours. No phone tag. Free, no-obligation roof or project
            inspection.
          </p>
        </header>

        {status === 'idle' && (
          <div className="booking__card reveal">
            <ul className="booking__advantages">
              <li>
                <span className="booking__advantage-icon" aria-hidden="true">⏱</span>
                <span>30-minute on-site inspection slot</span>
              </li>
              <li>
                <span className="booking__advantage-icon" aria-hidden="true">📅</span>
                <span>Pick the exact time, no callback waiting</span>
              </li>
              <li>
                <span className="booking__advantage-icon" aria-hidden="true">✉</span>
                <span>Confirmation + reminder by email</span>
              </li>
            </ul>
            <button
              type="button"
              className="btn btn--primary booking__open"
              onClick={handleOpen}
              data-cta-source="booking_open"
            >
              Open Calendar <span aria-hidden="true">→</span>
            </button>
          </div>
        )}

        {status === 'loading' && (
          <div className="booking__loading" role="status" aria-live="polite">
            <span className="booking__spinner" aria-hidden="true" />
            <span>Loading calendar…</span>
          </div>
        )}

        {status === 'failed' && (
          <div className="booking__fallback" role="alert" aria-live="assertive">
            <p>
              The calendar didn&apos;t load — your network may have blocked
              the booking script. To schedule, email us at{' '}
              <a href={`mailto:${EMAIL}`}>{EMAIL}</a> or call{' '}
              <a href="tel:+14079426459">{PHONE_DISPLAY}</a>.
            </p>
          </div>
        )}

        {/* Embed container — always rendered so the third-party library
            has a stable mount point. Hidden via CSS until status==='open',
            at which point the iframe inside takes over. */}
        <div
          ref={containerRef}
          className="booking__embed"
          data-status={status}
        />
      </div>
    </section>
  );
}
