import { useEffect } from 'react';

const MAX_ATTEMPTS = 24;
const RETRY_MS = 100;

function currentHashId() {
  const raw = window.location.hash.slice(1);
  if (!raw) return '';

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export function useHashScroll() {
  useEffect(() => {
    let frame = 0;
    let timer = 0;
    let runId = 0;

    const clearPending = () => {
      if (frame) window.cancelAnimationFrame(frame);
      if (timer) window.clearTimeout(timer);
      frame = 0;
      timer = 0;
    };

    const scrollToHash = (behavior: ScrollBehavior) => {
      const id = currentHashId();
      if (!id) return;

      clearPending();
      const activeRun = ++runId;
      let attempts = 0;

      const tryScroll = () => {
        if (activeRun !== runId) return;

        const target = document.getElementById(id);
        if (target) {
          target.scrollIntoView({
            block: 'start',
            behavior: attempts === 0 ? behavior : 'auto',
          });
        }

        attempts += 1;
        if (attempts < MAX_ATTEMPTS) timer = window.setTimeout(tryScroll, RETRY_MS);
      };

      frame = window.requestAnimationFrame(tryScroll);
    };

    scrollToHash('auto');

    const onHashChange = () => scrollToHash('smooth');
    window.addEventListener('hashchange', onHashChange);

    return () => {
      runId += 1;
      clearPending();
      window.removeEventListener('hashchange', onHashChange);
    };
  }, []);
}
