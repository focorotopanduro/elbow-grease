import { useCallback, useEffect, useState } from 'react';
import {
  CLIENT_PATH_EVENT,
  CLIENT_PATH_STORAGE_KEY,
  getClientPath,
  getStoredClientPath,
  setStoredClientPath,
  type ClientPath,
  type ClientPathId,
} from '../data/clientPaths';

type InitialClientPathMode = 'stored-or-default' | 'stored-only';

interface UseClientPathOptions {
  initial?: InitialClientPathMode;
  mirrorToDocument?: boolean;
}

interface ClientPathSelection {
  path: ClientPath | null;
  selectPath: (id: ClientPathId, source: string) => void;
}

function initialPath(mode: InitialClientPathMode): ClientPath | null {
  const stored = getStoredClientPath();
  if (stored) return getClientPath(stored);
  return mode === 'stored-or-default' ? getClientPath() : null;
}

export function useClientPath({
  initial = 'stored-or-default',
  mirrorToDocument = false,
}: UseClientPathOptions = {}): ClientPathSelection {
  const [path, setPath] = useState<ClientPath | null>(() => initialPath(initial));

  useEffect(() => {
    const onPathChange = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: ClientPathId }>).detail;
      setPath(detail?.id ? getClientPath(detail.id) : initialPath(initial));
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== CLIENT_PATH_STORAGE_KEY) return;
      setPath(event.newValue ? getClientPath(event.newValue) : initialPath(initial));
    };
    window.addEventListener(CLIENT_PATH_EVENT, onPathChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(CLIENT_PATH_EVENT, onPathChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [initial]);

  useEffect(() => {
    if (!mirrorToDocument || typeof document === 'undefined') return;
    if (path) document.documentElement.dataset.clientPath = path.id;
    else delete document.documentElement.dataset.clientPath;
    return () => {
      delete document.documentElement.dataset.clientPath;
    };
  }, [mirrorToDocument, path]);

  const selectPath = useCallback((id: ClientPathId, source: string) => {
    setPath(getClientPath(id));
    setStoredClientPath(id, source);
  }, []);

  return { path, selectPath };
}
