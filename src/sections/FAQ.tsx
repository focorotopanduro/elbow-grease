import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { FAQS, type FaqEntry } from '../data/faqs';
import './FAQ.css';

/**
 * FAQ section — accessible accordion sourced from src/data/faqs.ts.
 *
 * Accessibility (WAI-ARIA Authoring Practices Accordion pattern):
 *   • Each item is `<h3><button aria-expanded aria-controls></button></h3>`.
 *   • Each panel has `role="region"` and `aria-labelledby` linking back
 *     to the trigger button.
 *   • When closed, panels get `inert` (set imperatively to dodge React-18
 *     prop-typing limits) so focus + screen readers skip them entirely.
 *   • Keyboard: Up/Down arrow keys move focus between triggers (wraps),
 *     Home/End jump to first/last, Enter/Space toggle (default button
 *     behavior — no preventDefault).
 *
 * Animation:
 *   • Smooth height transition uses the CSS grid 0fr → 1fr trick, which
 *     animates without layout thrash and works without a known content
 *     height. Keeps the section feeling premium without compromising a11y.
 *
 * The first item is expanded by default for scannability — most FAQ
 * scrollers want to see at least one answered question without clicking.
 *
 * Re-use across pages:
 *   <FAQ /> — uses the full FAQS list and default heading.
 *   <FAQ faqs={cityFaqs} eyebrow="Orlando FAQ" titleNode={...} />
 *     — used by city pages (Phase 6+) to render a filtered subset.
 */
export interface FAQProps {
  /** Subset of FAQs to render. Defaults to the full FAQS list. */
  faqs?: FaqEntry[];
  /** Override eyebrow label above the heading. */
  eyebrow?: string;
  /** Override heading content (pass JSX for the italic em accent). */
  titleNode?: ReactNode;
  /** Override lead paragraph under the heading. */
  leadNode?: ReactNode;
  /** Section id for in-page anchors / SEO. Defaults to 'faq'. */
  sectionId?: string;
}

export default function FAQ({
  faqs,
  eyebrow,
  titleNode,
  leadNode,
  sectionId = 'faq',
}: FAQProps = {}) {
  const items = useMemo(
    () => (faqs ?? FAQS).filter((faq) => !faq.id.endsWith('-draft')),
    [faqs],
  );
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(items.length ? [items[0].id] : []),
  );
  const buttonsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const panelsRef = useRef<Map<string, HTMLDivElement>>(new Map());

  const toggle = useCallback((id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Imperatively mirror open state onto each panel's `inert` attribute.
  // React 18's JSX types don't include `inert` on HTMLDivElement; setting
  // it via DOM avoids a TS escape hatch and is no slower in practice.
  useEffect(() => {
    panelsRef.current.forEach((el, id) => {
      const open = expanded.has(id);
      if (open) el.removeAttribute('inert');
      else el.setAttribute('inert', '');
    });
  }, [expanded]);

  const focusTrigger = useCallback((id: string) => {
    buttonsRef.current.get(id)?.focus();
  }, []);

  const onTriggerKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = (idx + 1) % items.length;
          focusTrigger(items[next].id);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = (idx - 1 + items.length) % items.length;
          focusTrigger(items[prev].id);
          break;
        }
        case 'Home': {
          e.preventDefault();
          focusTrigger(items[0].id);
          break;
        }
        case 'End': {
          e.preventDefault();
          focusTrigger(items[items.length - 1].id);
          break;
        }
        // Enter + Space fall through to the button default — no preventDefault.
        default:
          break;
      }
    },
    [focusTrigger, items],
  );

  const headingEyebrow = eyebrow ?? 'Common Questions';
  const heading = titleNode ?? (
    <>
      Frequently Asked <em>Questions</em>
    </>
  );
  const lead = leadNode ?? (
    <>
      Practical answers about insurance claims, timelines, warranties, and how
      we work. Don&apos;t see your question?{' '}
      <a href="#contact" className="faq__lead-link">
        Ask us directly
      </a>{' '}
      and we&apos;ll follow up directly.
    </>
  );

  return (
    <section
      id={sectionId}
      className="faq section"
      aria-label="Frequently asked questions"
    >
      <div className="container">
        <header className="faq__header reveal">
          <p className="eyebrow">{headingEyebrow}</p>
          <h2 className="faq__title">{heading}</h2>
          <p className="faq__lead">{lead}</p>
        </header>

        <ul className="faq__list" role="list">
          {items.map((faq, idx) => (
            <FaqItem
              key={faq.id}
              faq={faq}
              idx={idx}
              open={expanded.has(faq.id)}
              onToggle={toggle}
              onKeyDown={onTriggerKeyDown}
              registerButton={(el) => {
                if (el) buttonsRef.current.set(faq.id, el);
                else buttonsRef.current.delete(faq.id);
              }}
              registerPanel={(el) => {
                if (el) panelsRef.current.set(faq.id, el);
                else panelsRef.current.delete(faq.id);
              }}
            />
          ))}
        </ul>
      </div>
    </section>
  );
}

interface FaqItemProps {
  faq: FaqEntry;
  idx: number;
  open: boolean;
  onToggle: (id: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>, idx: number) => void;
  registerButton: (el: HTMLButtonElement | null) => void;
  registerPanel: (el: HTMLDivElement | null) => void;
}

function FaqItem({
  faq,
  idx,
  open,
  onToggle,
  onKeyDown,
  registerButton,
  registerPanel,
}: FaqItemProps) {
  const buttonId = `faq-trigger-${faq.id}`;
  const panelId = `faq-panel-${faq.id}`;

  return (
    <li className="faq__item reveal" data-open={open}>
      <h3 className="faq__heading">
        <button
          ref={registerButton}
          type="button"
          id={buttonId}
          className="faq__trigger"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => onToggle(faq.id)}
          onKeyDown={(e) => onKeyDown(e, idx)}
        >
          <span className="faq__q">{faq.question}</span>
          <span className="faq__icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
              <path
                d="M6 12h12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              <path
                d="M12 6v12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                className="faq__icon-vertical"
              />
            </svg>
          </span>
        </button>
      </h3>
      <div
        ref={registerPanel}
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        className="faq__panel"
        data-open={open}
      >
        <div className="faq__panel-inner">
          {faq.answer.split('\n\n').map((para, i) => (
            <p key={i} className="faq__answer-para">
              {para}
            </p>
          ))}
          {faq.links && faq.links.length > 0 && (
            <ul className="faq__links" role="list">
              {faq.links.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    className="faq__link"
                    {...(l.external
                      ? { target: '_blank', rel: 'noopener noreferrer' }
                      : {})}
                  >
                    {l.label}
                    <span aria-hidden="true">
                      {l.external ? ' ↗' : ' →'}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}
