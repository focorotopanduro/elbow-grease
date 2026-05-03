import { useEffect } from 'react';

export function useReveal() {
  useEffect(() => {
    const revealNow = (el: HTMLElement) => {
      el.classList.add('is-visible');
    };

    const scan = (
      root: ParentNode,
      onMatch: (el: HTMLElement) => void,
    ) => {
      if (root instanceof HTMLElement && root.matches('.reveal')) {
        onMatch(root);
      }
      root
        .querySelectorAll?.<HTMLElement>('.reveal')
        .forEach((el) => onMatch(el));
    };

    if (!('IntersectionObserver' in window)) {
      scan(document, revealNow);
      const fallbackMo = new MutationObserver((records) => {
        records.forEach((record) => {
          record.addedNodes.forEach((node) => {
            if (node instanceof HTMLElement) scan(node, revealNow);
          });
        });
      });
      fallbackMo.observe(document.body, { childList: true, subtree: true });
      return () => fallbackMo.disconnect();
    }

    const observed = new WeakSet<HTMLElement>();
    const pending = new Set<HTMLElement>();
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            pending.delete(entry.target as HTMLElement);
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );

    let raf = 0;
    const checkPending = () => {
      raf = 0;
      pending.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.top < window.innerHeight - 40) {
          revealNow(el);
          pending.delete(el);
          obs.unobserve(el);
        }
      });
    };

    const queueCheck = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(checkPending);
    };

    const observe = (el: HTMLElement) => {
      if (el.classList.contains('is-visible') || observed.has(el)) return;
      observed.add(el);
      pending.add(el);
      obs.observe(el);
      queueCheck();
    };

    scan(document, observe);
    const mutationObserver = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) scan(node, observe);
        });
      });
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('scroll', queueCheck, { passive: true });
    window.addEventListener('resize', queueCheck);

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('scroll', queueCheck);
      window.removeEventListener('resize', queueCheck);
      mutationObserver.disconnect();
      obs.disconnect();
    };
  }, []);
}
