/**
 * Project Panel — HUD with save/load/new/export controls.
 *
 * Positioned top-left. Shows project name, auto-save status,
 * and action buttons. Also handles the "restore auto-save?"
 * dialog on app startup.
 *
 * Keyboard shortcuts:
 *   Ctrl+S — save to file
 *   Ctrl+O — open from file
 *   Ctrl+N — new project (confirms if unsaved)
 */

import { useState, useCallback, useEffect } from 'react';
import { usePipeStore, getColorForDiameter } from '@store/pipeStore';
import { useLayerStore } from '@store/layerStore';
import { autoSave } from '@core/project/AutoSave';
import { exportProjectFile, importProjectFile } from '@core/project/ProjectFileIO';
import type { SerializeInput } from '@core/project/ProjectSerializer';
import type { DeserializeResult } from '@core/project/ProjectSerializer';
import type { Vec3 } from '@core/events';
import type { FixtureSubtype } from '../engine/graph/GraphNode';
import type { StructuralElement } from '@core/interference/StructuralElements';

// ── Props ───────────────────────────────────────────────────────

interface ProjectPanelProps {
  fixtures: { position: Vec3; subtype: FixtureSubtype }[];
  structures: StructuralElement[];
  onProjectLoaded: (result: DeserializeResult) => void;
  onNewProject: () => void;
}

export function ProjectPanel({
  fixtures,
  structures,
  onProjectLoaded,
  onNewProject,
}: ProjectPanelProps) {
  const pipes = usePipeStore((s) => s.pipes);
  const layers = useLayerStore();
  const pipeCount = Object.keys(pipes).length;

  const [projectName, setProjectName] = useState('Untitled Project');
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [showRestore, setShowRestore] = useState(false);

  // Check for auto-save on mount
  useEffect(() => {
    if (autoSave.hasAutoSave()) {
      setShowRestore(true);
    }
  }, []);

  // Build the state snapshot for serialization
  const getSerializeInput = useCallback((): SerializeInput => ({
    pipes: Object.values(pipes),
    fixtures,
    structures,
    layers: {
      systems: layers.systems,
      fittings: layers.fittings,
      fixtures: layers.fixtures,
      dimensions: layers.dimensions,
    },
    camera: {
      position: [6, 8, 6], // TODO: read from actual camera
      target: [0, 0, 0],
      fov: 50,
    },
    projectName,
  }), [pipes, fixtures, structures, layers, projectName]);

  // Start auto-save
  useEffect(() => {
    autoSave.start(getSerializeInput);
    return () => autoSave.stop();
  }, [getSerializeInput]);

  // Save to file
  const handleSave = useCallback(() => {
    exportProjectFile(getSerializeInput(), `${projectName}.elbow`);
    setSaveStatus('Saved!');
    setTimeout(() => setSaveStatus(null), 2000);
  }, [getSerializeInput, projectName]);

  // Load from file
  const handleLoad = useCallback(async () => {
    try {
      const result = await importProjectFile();
      setProjectName(result.project.meta.name);
      onProjectLoaded(result);
      setSaveStatus(`Loaded: ${result.project.meta.name}`);
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      if ((err as Error).message !== 'File selection canceled') {
        setSaveStatus(`Error: ${(err as Error).message}`);
        setTimeout(() => setSaveStatus(null), 3000);
      }
    }
  }, [onProjectLoaded]);

  // New project
  const handleNew = useCallback(() => {
    if (pipeCount > 0) {
      if (!confirm('Start a new project? Unsaved changes will be lost.')) return;
    }
    setProjectName('Untitled Project');
    onNewProject();
    setSaveStatus(null);
  }, [pipeCount, onNewProject]);

  // Restore auto-save
  const handleRestore = useCallback(() => {
    const result = autoSave.loadAutoSave();
    if (result) {
      setProjectName(result.project.meta.name);
      onProjectLoaded(result);
      setSaveStatus('Restored from auto-save');
      setTimeout(() => setSaveStatus(null), 3000);
    }
    setShowRestore(false);
  }, [onProjectLoaded]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        handleLoad();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        handleNew();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleSave, handleLoad, handleNew]);

  return (
    <>
      {/* Restore dialog */}
      {showRestore && (
        <div style={styles.restoreOverlay}>
          <div style={styles.restoreDialog}>
            <div style={styles.restoreTitle}>Auto-save found</div>
            <div style={styles.restoreBody}>
              Saved {autoSave.getAutoSaveTimestamp()?.replace('T', ' ').split('.')[0] ?? 'recently'}
            </div>
            <div style={styles.restoreButtons}>
              <button style={styles.restoreBtn} onClick={handleRestore}>Restore</button>
              <button style={styles.dismissBtn} onClick={() => setShowRestore(false)}>Start Fresh</button>
            </div>
          </div>
        </div>
      )}

      {/* Project bar */}
      <div style={styles.panel}>
        {/* Project name (editable) */}
        <input
          style={styles.nameInput}
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          spellCheck={false}
        />

        <div style={styles.divider} />

        {/* Action buttons */}
        <button style={styles.btn} onClick={handleNew} title="Ctrl+N">
          New
        </button>
        <button style={styles.btn} onClick={handleLoad} title="Ctrl+O">
          Open
        </button>
        <button style={styles.btnPrimary} onClick={handleSave} title="Ctrl+S">
          Save
        </button>

        {/* Status / pipe count */}
        <div style={styles.divider} />
        <span style={styles.meta}>
          {pipeCount > 0 ? `${pipeCount} pipe${pipeCount !== 1 ? 's' : ''}` : 'Empty'}
        </span>

        {saveStatus && (
          <span style={styles.status}>{saveStatus}</span>
        )}
      </div>
    </>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  panel: {
    position: 'absolute',
    top: 16,
    left: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    borderRadius: 8,
    border: '1px solid #333',
    background: 'rgba(10,10,15,0.92)',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    pointerEvents: 'auto',
    zIndex: 25,
  },
  nameInput: {
    background: 'none',
    border: 'none',
    color: '#eee',
    fontSize: 13,
    fontWeight: 600,
    width: 160,
    outline: 'none',
    padding: '2px 4px',
    borderRadius: 4,
  },
  divider: {
    width: 1,
    height: 20,
    background: '#333',
    margin: '0 4px',
  },
  btn: {
    fontSize: 11,
    color: '#aaa',
    background: 'none',
    border: '1px solid #333',
    borderRadius: 5,
    padding: '4px 10px',
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  },
  btnPrimary: {
    fontSize: 11,
    color: '#00e5ff',
    background: 'none',
    border: '1px solid #00e5ff',
    borderRadius: 5,
    padding: '4px 10px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  meta: {
    fontSize: 10,
    color: '#666',
  },
  status: {
    fontSize: 10,
    color: '#00e676',
    marginLeft: 4,
  },
  restoreOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
    pointerEvents: 'auto',
  },
  restoreDialog: {
    padding: 24,
    borderRadius: 12,
    border: '1px solid #ffc107',
    background: 'rgba(10,10,15,0.98)',
    textAlign: 'center' as const,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    minWidth: 280,
  },
  restoreTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: '#ffc107',
    marginBottom: 8,
  },
  restoreBody: {
    fontSize: 12,
    color: '#aaa',
    marginBottom: 16,
  },
  restoreButtons: {
    display: 'flex',
    gap: 12,
    justifyContent: 'center',
  },
  restoreBtn: {
    fontSize: 13,
    fontWeight: 600,
    color: '#0a0a0f',
    background: '#ffc107',
    border: 'none',
    borderRadius: 6,
    padding: '8px 20px',
    cursor: 'pointer',
  },
  dismissBtn: {
    fontSize: 13,
    color: '#aaa',
    background: 'none',
    border: '1px solid #555',
    borderRadius: 6,
    padding: '8px 20px',
    cursor: 'pointer',
  },
};
