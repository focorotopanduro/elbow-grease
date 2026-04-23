/**
 * ErrorBoundary — catches render-time exceptions in a React subtree
 * and shows a compact recovery UI instead of white-screening the whole app.
 *
 * Three boundary placements in App.tsx:
 *   • Around the <Canvas> → a crashed 3D component doesn't kill the HUD.
 *   • Around the God Mode + Compliance debugger → one broken
 *     dev-tool mount doesn't take down the scene.
 *   • Around the main HUD stack → a panel crash shows "reload" affordance
 *     instead of black screen.
 *
 * Also emits a `ui.errorBoundary` command to the CommandBus so every
 * caught error shows up in the God Mode log alongside normal
 * mutations. Opens up future telemetry integration without re-wiring.
 *
 * We hand-roll this rather than pulling react-error-boundary (~6KB
 * gzipped) — the ~80 lines here cover our exact needs with no runtime
 * dependency bump. Three's Canvas error surface doesn't hand to
 * React's componentDidCatch via the normal path (WebGL errors are
 * async), but any throwing `useFrame` body or child component's
 * render phase IS caught here.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { commandBus } from '@core/commands/CommandBus';
import { newCorrelationId } from '@core/commands/correlationId';
import { logger } from '@core/logger/Logger';

const log = logger('ErrorBoundary');

// ── Optional one-time command registration ─────────────────────

let handlerRegistered = false;
function ensureHandlerRegistered(): void {
  if (handlerRegistered) return;
  handlerRegistered = true;
  commandBus.register({
    type: 'ui.errorBoundary',
    apply: () => undefined, // pure marker — the payload is the interesting part
  });
}

// ── Props / state ──────────────────────────────────────────────

export interface ErrorBoundaryProps {
  /** Human-readable label shown in the fallback + logged to the bus. */
  label: string;
  /** Children to protect. */
  children: ReactNode;
  /** Optional override for the fallback UI. */
  fallback?: (args: { error: Error; reset: () => void; label: string }) => ReactNode;
}

interface State {
  error: Error | null;
  /** `errorKey` monotonically increments on each reset so React remounts children fresh. */
  errorKey: number;
}

// ── Component ──────────────────────────────────────────────────

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  state: State = { error: null, errorKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    ensureHandlerRegistered();
    // Log through the CommandBus so God Mode shows it.
    commandBus.dispatch({
      type: 'ui.errorBoundary',
      payload: {
        label: this.props.label,
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
      },
      issuedBy: 'event',
      correlationId: newCorrelationId(),
    });
    // Also route through the logger so the God Mode "Logs" tab shows
    // a high-fidelity entry in addition to the CommandBus dispatch.
    log.fatal(`${this.props.label}: ${error.message}`, {
      label: this.props.label,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }

  reset = (): void => {
    this.setState((s) => ({ error: null, errorKey: s.errorKey + 1 }));
  };

  render(): ReactNode {
    if (this.state.error) {
      const fallback = this.props.fallback;
      if (fallback) {
        return fallback({
          error: this.state.error,
          reset: this.reset,
          label: this.props.label,
        });
      }
      return (
        <DefaultFallback
          error={this.state.error}
          reset={this.reset}
          label={this.props.label}
        />
      );
    }
    // Keyed re-render on reset so any children's initial state is fresh.
    return <div key={this.state.errorKey} style={{ display: 'contents' }}>{this.props.children}</div>;
  }
}

// ── Default fallback UI ────────────────────────────────────────

function DefaultFallback({
  error, reset, label,
}: {
  error: Error;
  reset: () => void;
  label: string;
}) {
  return (
    <div style={styles.panel} role="alert">
      <div style={styles.header}>
        <span style={styles.icon}>⚠</span>
        <span style={styles.title}>{label} crashed</span>
      </div>
      <pre style={styles.message}>{error.message}</pre>
      <div style={styles.actions}>
        <button style={styles.primary} onClick={reset}>Reset this panel</button>
        <button style={styles.secondary} onClick={() => window.location.reload()}>Reload app</button>
      </div>
      <div style={styles.hint}>
        Press <kbd style={styles.kbd}>Ctrl+Shift+G</kbd> to open God Mode — the full
        error stack is logged there with a correlationId you can copy for a bug report.
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'relative',
    margin: 16,
    padding: 14,
    background: 'rgba(30, 10, 10, 0.92)',
    border: '1px solid #ef5350',
    borderRadius: 8,
    color: '#ffcdd2',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    fontSize: 12,
    maxWidth: 520,
    boxShadow: '0 4px 14px rgba(0,0,0,0.5)',
    zIndex: 9999,
  },
  header: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 },
  icon: { fontSize: 18, color: '#ef5350' },
  title: { fontWeight: 700, color: '#fff' },
  message: {
    background: '#000',
    color: '#ffccbc',
    padding: 8,
    borderRadius: 4,
    fontSize: 11,
    lineHeight: 1.4,
    whiteSpace: 'pre-wrap',
    overflowX: 'auto',
    maxHeight: 140,
    margin: '0 0 10px',
  },
  actions: { display: 'flex', gap: 8, marginBottom: 8 },
  primary: {
    flex: 1, padding: '6px 12px', borderRadius: 4,
    background: '#ef5350', color: '#0a0a0f', border: 'none',
    fontWeight: 700, cursor: 'pointer', fontSize: 12,
  },
  secondary: {
    padding: '6px 12px', borderRadius: 4,
    background: 'transparent', color: '#ffcdd2',
    border: '1px solid #ef5350',
    cursor: 'pointer', fontSize: 12,
  },
  hint: { fontSize: 10, color: '#ffab91', opacity: 0.8 },
  kbd: {
    fontSize: 10, color: '#ffcdd2',
    border: '1px solid #ef5350', borderRadius: 3,
    padding: '1px 4px', fontFamily: 'monospace',
  },
};
