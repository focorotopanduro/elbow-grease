import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { reportWebVitals } from './lib/webVitals';
import { installGlobalErrorHandlers } from './lib/globalErrors';
import './styles/index.css';

// Tier 7 — install BEFORE React mounts so any errors during initial
// render are captured. Idempotent; no-ops on re-call.
installGlobalErrorHandlers();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// Wire Core Web Vitals telemetry — LCP / CLS / INP / FCP / TTFB.
// Each metric reports ONCE when its observation window closes (page
// hidden / unload). Native PerformanceObserver impl in lib/webVitals.ts
// — no `web-vitals` npm dep, ~6 kB saved. Events flow through the
// same /api/events beacon as the rest of analytics.
reportWebVitals();
