import { useCallback, useEffect, useRef, useState } from 'react';
import BeforeAfterSlider from './BeforeAfterSlider';
import { trackCta } from '../lib/interactions';
import {
  formatProjectDate,
  hasProjectPhotos,
  labelForCity,
  labelForService,
  type ProjectEntry,
} from '../data/projects';
import './ProjectModal.css';

/**
 * Accessible project lightbox modal.
 *
 * A11y:
 *   - role="dialog" + aria-modal="true" + aria-labelledby
 *   - Focus trap — Tab cycles inside; Shift+Tab cycles backwards
 *   - Escape closes the modal
 *   - Body scroll lock while open; restored on close
 *   - Focus moves to the close button on open; restored to the
 *     trigger element on close
 *
 * Navigation:
 *   - Arrow Left/Right cycles through projects (via onPrev/onNext)
 *   - Click backdrop to close (with stopPropagation guard inside)
 *
 * Gallery:
 *   - Thumbnail strip at the bottom; click to swap main image
 *   - Before/After slider mounts when project has both before+after
 */

export interface ProjectModalProps {
  project: ProjectEntry;
  isOpen: boolean;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  /**
   * Optional ref to the trigger element so focus can be restored
   * when the modal closes (avoids focus dropping to body).
   */
  returnFocusRef?: React.RefObject<HTMLElement>;
}

export default function ProjectModal({
  project,
  isOpen,
  onClose,
  onPrev,
  onNext,
  returnFocusRef,
}: ProjectModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Active gallery image — defaults to hero, swaps when user clicks a thumb.
  const photosAvailable = hasProjectPhotos(project);
  const allImages = photosAvailable ? [project.heroImage, ...project.gallery] : [];
  const [activeImage, setActiveImage] = useState<string>(project.heroImage);

  // Reset active image when project changes (prev/next navigation)
  useEffect(() => {
    setActiveImage(project.heroImage);
  }, [project.heroImage]);

  /* ─── Focus trap + Escape + arrow keys + body scroll lock ─────────── */

  useEffect(() => {
    if (!isOpen) return;
    const root = modalRef.current;
    if (!root) return;

    // Save the element that triggered the open so we can restore focus
    // on close (returnFocusRef takes priority if provided).
    const previouslyFocused = document.activeElement as HTMLElement | null;

    // Move focus to the close button so keyboard users land in the modal.
    closeBtnRef.current?.focus();

    // Lock body scroll
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), ' +
      'select:not([disabled]), textarea:not([disabled]), ' +
      '[tabindex]:not([tabindex="-1"])';

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowRight' && onNext) {
        e.preventDefault();
        onNext();
        return;
      }
      if (e.key === 'ArrowLeft' && onPrev) {
        e.preventDefault();
        onPrev();
        return;
      }
      if (e.key === 'Tab') {
        const focusable = Array.from(
          root.querySelectorAll<HTMLElement>(focusableSelector),
        ).filter((el) => el.offsetParent !== null);
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKey);
    const focusTarget = returnFocusRef?.current ?? previouslyFocused;

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      // Restore focus to the trigger element (or the previously-focused
      // element as a fallback). Defer to the next tick so React has
      // finished unmounting.
      if (focusTarget && typeof focusTarget.focus === 'function') {
        // Tiny delay so focus restoration doesn't race with modal exit
        // animations.
        window.setTimeout(() => focusTarget.focus(), 0);
      }
    };
  }, [isOpen, onClose, onPrev, onNext, returnFocusRef]);

  const onBackdropClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      // Only close when clicking the backdrop itself, not bubbled events
      // from inside the modal content.
      if (e.target === e.currentTarget) onClose();
    },
    [onClose],
  );

  if (!isOpen) return null;

  const titleId = `project-modal-title-${project.slug}`;
  const showSlider = photosAvailable && Boolean(project.beforeImage && project.afterImage);
  const contactHref = `/#contact?service=${project.serviceCategory}&location=${encodeURIComponent(labelForCity(project.city))}`;

  return (
    <div
      className="pmodal__backdrop"
      onClick={onBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={modalRef}
        className="pmodal"
        // Stop click bubbling so the backdrop's onClose isn't triggered
        // when clicking inside the modal content.
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pmodal__header">
          <div className="pmodal__meta">
            <span className="pmodal__service-tag">
              {labelForService(project.serviceCategory)}
            </span>
            <span className="pmodal__neighborhood">
              {project.neighborhood}, {labelForCity(project.city)}
            </span>
          </div>
          <button
            ref={closeBtnRef}
            type="button"
            className="pmodal__close"
            onClick={onClose}
            aria-label="Close project details"
          >
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </header>

        <h2 id={titleId} className="pmodal__title">{project.title}</h2>

        <div className="pmodal__body">
          <div className="pmodal__main">
            {showSlider ? (
              <BeforeAfterSlider
                before={project.beforeImage!}
                after={project.afterImage!}
                alt={project.title}
              />
            ) : photosAvailable ? (
              <img
                className="pmodal__main-image"
                src={activeImage}
                alt={project.title}
                onError={(e) => {
                  const img = e.currentTarget;
                  img.style.display = 'none';
                  img.parentElement?.classList.add('pmodal__main--placeholder');
                }}
              />
            ) : (
              <div
                className="pmodal__main-placeholder"
                role="img"
                aria-label={`${project.title} photo set pending approval`}
              >
                <span>Photo set pending</span>
              </div>
            )}

            {!showSlider && allImages.length > 1 && (
              <ul className="pmodal__thumbs" role="list">
                {allImages.map((src, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={`pmodal__thumb ${
                        src === activeImage ? 'pmodal__thumb--active' : ''
                      }`}
                      onClick={() => setActiveImage(src)}
                      aria-label={`Show image ${i + 1} of ${allImages.length}`}
                      aria-pressed={src === activeImage}
                    >
                      <img
                        src={src}
                        alt=""
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                          (e.currentTarget.parentElement as HTMLElement).classList.add(
                            'pmodal__thumb--placeholder',
                          );
                        }}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <aside className="pmodal__sidebar">
            <p className="pmodal__summary">{project.summary}</p>

            <dl className="pmodal__details">
              <div>
                <dt>Service</dt>
                <dd>{labelForService(project.serviceCategory)}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>
                  {project.neighborhood}, {labelForCity(project.city)}
                </dd>
              </div>
              <div>
                <dt>Completed</dt>
                <dd>{formatProjectDate(project.completedDate)}</dd>
              </div>
            </dl>

            {project.tags.length > 0 && (
              <ul className="pmodal__tags" role="list">
                {project.tags.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            )}

            <a
              href={contactHref}
              className="btn btn--primary pmodal__cta"
              onClick={trackCta(
                'project_quote_request',
                `project_modal:${project.slug}`,
              )}
              data-cta-source={`project_modal_quote_${project.slug}`}
            >
              Get a Quote Like This <span aria-hidden="true">→</span>
            </a>
          </aside>
        </div>

        {(onPrev || onNext) && (
          <nav className="pmodal__nav" aria-label="Project navigation">
            {onPrev && (
              <button
                type="button"
                className="pmodal__nav-btn pmodal__nav-btn--prev"
                onClick={onPrev}
                aria-label="Previous project (or Arrow Left)"
              >
                <span aria-hidden="true">←</span> Previous
              </button>
            )}
            {onNext && (
              <button
                type="button"
                className="pmodal__nav-btn pmodal__nav-btn--next"
                onClick={onNext}
                aria-label="Next project (or Arrow Right)"
              >
                Next <span aria-hidden="true">→</span>
              </button>
            )}
          </nav>
        )}
      </div>
    </div>
  );
}
