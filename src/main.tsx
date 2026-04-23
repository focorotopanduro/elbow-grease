import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

// Temporary diagnostic error boundary: surfaces runtime errors that
// would otherwise leave the screen blank. Remove once the app is stable.
class RuntimeErrorBoundary extends Component<
  { children: ReactNode },
  { err: Error | null; info: string | null }
> {
  state = { err: null as Error | null, info: null as string | null };

  static getDerivedStateFromError(err: Error) {
    return { err, info: null };
  }

  componentDidCatch(err: Error, info: { componentStack?: string | null }) {
    this.setState({ err, info: info.componentStack ?? null });
    // Top-level entry-point boundary: the Logger subsystem may not
    // have booted yet (the crash could be at first mount). Stay on
    // raw console here — this is the last line of defense below all
    // our other layers.
    // eslint-disable-next-line no-console -- intentional: pre-logger-boot path
    console.error('App crashed at entry:', err, info.componentStack);
  }

  render() {
    if (this.state.err) {
      return (
        <div style={{
          padding: 24,
          fontFamily: 'Consolas, monospace',
          color: '#ff6b6b',
          background: '#0a0a0f',
          minHeight: '100vh',
          overflow: 'auto',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}>
          <h1 style={{ color: '#ff9566', fontSize: 18, marginBottom: 12 }}>⚠ ELBOW GREASE crashed</h1>
          <div style={{ color: '#ffd54f', fontSize: 13, marginBottom: 8 }}>
            {this.state.err.name}: {this.state.err.message}
          </div>
          <div style={{ color: '#7fb8d0', fontSize: 11, marginBottom: 18 }}>
            {this.state.err.stack}
          </div>
          {this.state.info && (
            <>
              <div style={{ color: '#8aa0b1', fontSize: 11, letterSpacing: 1 }}>COMPONENT STACK</div>
              <div style={{ color: '#b8cbd7', fontSize: 11 }}>
                {this.state.info}
              </div>
            </>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RuntimeErrorBoundary>
      <App />
    </RuntimeErrorBoundary>
  </StrictMode>,
);
