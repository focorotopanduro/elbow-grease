import { useMemo } from 'react';
import {
  CLIENT_PATHS,
  getClientPath,
  type ClientPathId,
} from '../data/clientPaths';
import { useClientPath } from '../hooks/useClientPath';
import { track } from '../lib/analytics';
import './SmartPathways.css';

const OPERATING_LANES = [
  { label: 'Route', value: 'Right first move' },
  { label: 'Prefill', value: 'Service + context' },
  { label: 'Handoff', value: 'Contact-ready notes' },
] as const;

export default function SmartPathways() {
  const { path, selectPath } = useClientPath({ mirrorToDocument: true });
  const selected = path ?? getClientPath();

  const selectedIndex = useMemo(
    () => CLIENT_PATHS.findIndex((path) => path.id === selected.id) + 1,
    [selected.id],
  );

  const choosePath = (id: ClientPathId) => {
    const next = getClientPath(id);
    selectPath(id, 'smart_pathways');
    track('cta_click', {
      cta: 'client_path_select',
      placement: 'smart_pathways',
      path: id,
      intent: next.analyticsIntent,
      priority: next.priority,
    });
  };

  const trackPathCta = (cta: string) => () => {
    selectPath(selected.id, `smart_pathways:${cta}`);
    track('cta_click', {
      cta,
      placement: 'smart_pathways',
      path: selected.id,
      intent: selected.analyticsIntent,
      priority: selected.priority,
    });
  };

  return (
    <section id="smart-path" className="smart-path section section--dark" aria-labelledby="smart-path-title">
      <div className="container smart-path__inner">
        <div className="smart-path__header reveal">
          <p className="eyebrow">Client Pathways</p>
          <h2 id="smart-path-title" className="smart-path__title">
            Choose the route that matches the property.
          </h2>
          <p className="smart-path__lead">
            These are not separate websites or vague personas. Each route
            sets the service context, contact prompt, proof line, and handoff
            sequence used later in the estimate form.
          </p>
        </div>

        <div className="smart-path__shell reveal">
          <div className="smart-path__chooser" role="tablist" aria-label="Choose the closest project path">
            {CLIENT_PATHS.map((path, index) => {
              const active = selected.id === path.id;
              return (
                <button
                  key={path.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="smart-path-panel"
                  className={`smart-path__choice ${active ? 'is-active' : ''}`}
                  onClick={() => choosePath(path.id)}
                >
                  <span className="smart-path__choice-number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="smart-path__choice-body">
                    <span>{path.label}</span>
                    <small>{path.eyebrow}</small>
                  </span>
                </button>
              );
            })}
          </div>

          <div id="smart-path-panel" className="smart-path__panel" role="tabpanel">
            <div className="smart-path__panel-head">
              <span className="smart-path__index">Path {String(selectedIndex).padStart(2, '0')}</span>
              <span className="smart-path__proof">{selected.proof}</span>
            </div>

            <h3 className="smart-path__panel-title">{selected.title}</h3>
            <p className="smart-path__panel-copy">{selected.body}</p>

            <div className="smart-path__route" aria-label="Path steps">
              {selected.steps.map((step, index) => (
                <span key={step} className="smart-path__route-step">
                  <b>{String(index + 1).padStart(2, '0')}</b>
                  {step}
                </span>
              ))}
            </div>

            <div className="smart-path__brief">
              <span>
                <small>Service</small>
                <strong>{selected.recommendedService}</strong>
              </span>
              <span>
                <small>Contingency</small>
                <strong>{selected.contingency}</strong>
              </span>
            </div>

            <div className="smart-path__actions">
              <a href={selected.primaryHref} className="btn btn--primary" onClick={trackPathCta('smart_path_primary')}>
                {selected.primaryLabel}
              </a>
              <a href={selected.secondaryHref} className="btn btn--ghost" onClick={trackPathCta('smart_path_secondary')}>
                {selected.secondaryLabel}
              </a>
            </div>
          </div>

          <div className="smart-path__ledger" aria-label="Operating standards">
            {OPERATING_LANES.map((lane) => (
              <span key={lane.label}>
                <small>{lane.label}</small>
                <strong>{lane.value}</strong>
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
