import { Component, type ErrorInfo, type ReactNode } from 'react';
import { track } from '../lib/analytics';

interface Props {
  children: ReactNode;
  /** Where the recovery CTA points if the page itself crashes. */
  fallbackHref?: string;
}
interface State { error: Error | null; }

/**
 * Top-level boundary — catches any uncaught render error in the page
 * tree (chunk failures inside the sim ErrorBoundary already get caught
 * there; this is for everything else: a component throwing on bad
 * data, a hook throwing, a third-party script failing, etc).
 *
 * On error: replaces the entire page tree with a single-screen
 * recovery card (avoid showing a half-rendered broken UI). Logs to
 * console + analytics so you find out about errors before users
 * complain.
 */
export default class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Page-level error:', error, info);
    track('page_error', {
      reason: error.message || String(error),
      componentStack: info.componentStack ?? undefined,
    });
  }

  handleReload = (): void => {
    if (typeof window !== 'undefined') window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page-error" role="alert">
        <div className="page-error__inner">
          <p className="page-error__eyebrow">Something broke on our end</p>
          <h1 className="page-error__title">
            We couldn't load this page.
          </h1>
          <p className="page-error__body">
            Refresh and try again — or go straight to the home page where
            you can reach Beit Building Contractors directly.
          </p>
          <div className="page-error__actions">
            <button type="button" onClick={this.handleReload} className="btn btn--primary">
              Reload
            </button>
            <a href={this.props.fallbackHref ?? '/'} className="btn btn--ghost">
              Home
            </a>
          </div>
        </div>
      </div>
    );
  }
}
