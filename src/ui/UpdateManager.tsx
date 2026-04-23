/**
 * UpdateManager — in-app auto-update UI.
 *
 * Flow:
 *   1. On boot (and every `RECHECK_MS` afterwards), ask the Tauri
 *      updater plugin whether a newer release exists on GitHub.
 *   2. If yes, show a non-blocking toast in the bottom-right corner
 *      with the new version number and release notes preview.
 *   3. User clicks "Install & restart" → plugin downloads + verifies
 *      the signed installer, we show a progress bar, then call
 *      `relaunch()` which quits + reopens the app on the new version.
 *
 * Notes:
 *   - The plugin is ONLY available inside a Tauri window. In `npm run dev`
 *     (plain Vite in a browser) there's no __TAURI_INTERNALS__ global,
 *     so we detect that and short-circuit. This keeps dev builds fast
 *     and avoids console noise.
 *   - Signature verification is handled by the plugin — if a signature
 *     is missing or doesn't match the embedded pubkey, the download is
 *     rejected. We can't be tricked into installing an unsigned binary.
 *   - Errors are logged to console and displayed non-modally. The app
 *     continues to run normally — update failures never block the user.
 */

import { useEffect, useRef, useState } from 'react';
import { logger } from '@core/logger/Logger';

const log = logger('UpdateManager');

type Phase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'installing'
  | 'error';

interface AvailableUpdate {
  version: string;
  currentVersion: string;
  notes?: string;
  date?: string;
}

// Re-check every 6 hours while the app is left running. Most users will
// just get the check on boot; this handles the "office workstation left
// open for a week" case.
const RECHECK_MS = 6 * 60 * 60 * 1000;

// Defer the first check so the scene has a chance to render first — we
// never want the update UI blocking initial paint.
const INITIAL_DELAY_MS = 4000;

function isTauri(): boolean {
  // Tauri 2 injects this global on window.
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function UpdateManager() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [available, setAvailable] = useState<AvailableUpdate | null>(null);
  const [progress, setProgress] = useState<{ downloaded: number; total: number | null }>({
    downloaded: 0, total: null,
  });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const updateRef = useRef<any>(null); // holds the plugin's Update handle

  // ── Check for updates ─────────────────────────────────────────
  const checkForUpdate = async () => {
    if (!isTauri()) return;
    setPhase('checking');
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        updateRef.current = update;
        setAvailable({
          version: update.version,
          currentVersion: update.currentVersion,
          notes: update.body ?? undefined,
          date: update.date ?? undefined,
        });
        setPhase('available');
      } else {
        setPhase('idle');
      }
    } catch (err) {
      log.info('check failed (network/offline is OK)', err);
      // Silent on check failure — no network is fine, user keeps working.
      setPhase('idle');
    }
  };

  // ── Boot + periodic re-check ──────────────────────────────────
  useEffect(() => {
    if (!isTauri()) return;
    const first = window.setTimeout(checkForUpdate, INITIAL_DELAY_MS);
    const interval = window.setInterval(checkForUpdate, RECHECK_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
    };
  }, []);

  // ── Install ──────────────────────────────────────────────────
  const installUpdate = async () => {
    const update = updateRef.current;
    if (!update) return;
    setPhase('downloading');
    setProgress({ downloaded: 0, total: null });
    try {
      let downloaded = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event: any) => {
        // Events: 'Started' (contentLength?), 'Progress' (chunkLength), 'Finished'.
        if (event?.event === 'Started') {
          total = event.data?.contentLength ?? null;
          setProgress({ downloaded: 0, total });
        } else if (event?.event === 'Progress') {
          downloaded += event.data?.chunkLength ?? 0;
          setProgress({ downloaded, total });
        } else if (event?.event === 'Finished') {
          setPhase('installing');
        }
      });
      // downloadAndInstall runs the installer synchronously on Windows;
      // once it returns the new version is on disk. Relaunch to pick it up.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (err) {
      log.error('install failed', err);
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  };

  // ── Render ───────────────────────────────────────────────────

  // Hidden in dev (browser) and when there's nothing to show.
  if (!isTauri()) return null;
  if (phase === 'idle' || phase === 'checking') return null;

  return (
    <div style={styles.toast} role="status" aria-live="polite">
      {phase === 'available' && available && (
        <>
          <div style={styles.header}>
            <span style={styles.dot} />
            <span style={styles.title}>Update available</span>
            <button
              style={styles.closeBtn}
              onClick={() => setPhase('idle')}
              title="Remind me later"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
          <div style={styles.versionLine}>
            <span style={styles.versionMuted}>v{available.currentVersion}</span>
            <span style={styles.arrow}>→</span>
            <span style={styles.versionNew}>v{available.version}</span>
          </div>
          {available.notes && (
            <div style={styles.notes}>{truncate(available.notes, 260)}</div>
          )}
          <div style={styles.actions}>
            <button style={styles.btnPrimary} onClick={installUpdate}>
              Install &amp; restart
            </button>
            <button style={styles.btnGhost} onClick={() => setPhase('idle')}>
              Later
            </button>
          </div>
        </>
      )}

      {phase === 'downloading' && (
        <>
          <div style={styles.title}>Downloading update…</div>
          <ProgressBar downloaded={progress.downloaded} total={progress.total} />
          <div style={styles.subline}>
            {formatBytes(progress.downloaded)}
            {progress.total ? ` / ${formatBytes(progress.total)}` : ''}
          </div>
        </>
      )}

      {phase === 'installing' && (
        <>
          <div style={styles.title}>Installing…</div>
          <div style={styles.subline}>The app will restart automatically.</div>
        </>
      )}

      {phase === 'error' && (
        <>
          <div style={{ ...styles.title, color: '#ef5350' }}>Update failed</div>
          <div style={styles.subline}>{errorMsg ?? 'Unknown error'}</div>
          <div style={styles.actions}>
            <button style={styles.btnGhost} onClick={() => setPhase('idle')}>Dismiss</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + '…';
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function ProgressBar({ downloaded, total }: { downloaded: number; total: number | null }) {
  const pct = total && total > 0 ? Math.min(100, (downloaded / total) * 100) : null;
  return (
    <div style={styles.barOuter}>
      <div
        style={{
          ...styles.barInner,
          width: pct === null ? '40%' : `${pct}%`,
          animation: pct === null ? 'egIndet 1.2s linear infinite' : undefined,
        }}
      />
    </div>
  );
}

// ── styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  toast: {
    position: 'fixed',
    right: 16,
    bottom: 16,
    width: 340,
    padding: 14,
    borderRadius: 10,
    background: 'rgba(10,14,22,0.96)',
    border: '1px solid #2a3a54',
    boxShadow: '0 8px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(0,229,255,0.08)',
    color: '#e0e6ef',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    fontSize: 13,
    zIndex: 500,
    pointerEvents: 'auto',
  },
  header: {
    display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8,
  },
  dot: {
    width: 8, height: 8, borderRadius: '50%',
    background: '#00e676', boxShadow: '0 0 8px #00e676',
  },
  title: { fontWeight: 600, color: '#e8f0ff', flex: 1 },
  closeBtn: {
    background: 'none', border: 'none', color: '#7a8592',
    fontSize: 18, lineHeight: 1, cursor: 'pointer', padding: '0 4px',
  },
  versionLine: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 },
  versionMuted: { color: '#7a8592', fontFamily: 'Consolas, monospace', fontSize: 12 },
  versionNew: { color: '#00e5ff', fontFamily: 'Consolas, monospace', fontWeight: 700 },
  arrow: { color: '#4a5668' },
  notes: {
    fontSize: 12, color: '#aebbc9', lineHeight: 1.4,
    maxHeight: 100, overflow: 'hidden',
    padding: 8, borderRadius: 6,
    background: 'rgba(255,255,255,0.03)',
    marginBottom: 10, whiteSpace: 'pre-wrap',
  },
  actions: { display: 'flex', gap: 8, marginTop: 6 },
  btnPrimary: {
    flex: 1, padding: '7px 12px', borderRadius: 6,
    background: '#00e5ff', color: '#00161a', border: 'none',
    fontWeight: 700, cursor: 'pointer', fontSize: 12,
  },
  btnGhost: {
    padding: '7px 12px', borderRadius: 6,
    background: 'transparent', color: '#aebbc9',
    border: '1px solid #2a3a54',
    cursor: 'pointer', fontSize: 12,
  },
  barOuter: {
    width: '100%', height: 6, borderRadius: 3,
    background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginTop: 4,
  },
  barInner: {
    height: '100%', background: 'linear-gradient(90deg,#00e5ff,#00e676)',
    transition: 'width 0.2s ease',
  },
  subline: { fontSize: 11, color: '#7a8592', marginTop: 6 },
};

// Inject once: keyframes for the indeterminate progress bar.
if (typeof document !== 'undefined' && !document.getElementById('eg-update-kf')) {
  const style = document.createElement('style');
  style.id = 'eg-update-kf';
  style.textContent = `@keyframes egIndet { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }`;
  document.head.appendChild(style);
}
