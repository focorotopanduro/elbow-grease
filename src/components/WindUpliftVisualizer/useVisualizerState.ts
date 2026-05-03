import { useEffect, useMemo, useState } from 'react';
import { buildFailureCascade, type CascadeResult } from '../../physics/cascade';
import { INSTALL_PROFILES, type InstallProfileId } from '../../physics/resistance';
import { DEFAULT_HOUSE_CONFIG, type HouseConfig } from '../../physics/pressure';
import type { Exposure } from '../../physics/exposure';
import type { RoofShape } from '../../physics/constants';
import { useStormReplay } from './effects/useStormReplay';

const VALID_INSTALLS: InstallProfileId[] = ['code_min', 'fbc_wbdr'];
const VALID_EXPOSURE: Exposure[] = ['B', 'C', 'D'];
const VALID_SHAPE: RoofShape[] = ['gable', 'hip'];

function clampWind(v: number): number {
  if (Number.isNaN(v)) return 130;
  return Math.max(60, Math.min(200, Math.round(v)));
}

function readUrlState(): { V: number; install: InstallProfileId; config: HouseConfig } {
  if (typeof window === 'undefined')
    return { V: 130, install: 'code_min', config: DEFAULT_HOUSE_CONFIG };
  const params = new URLSearchParams(window.location.search);
  const V = clampWind(Number(params.get('v') ?? 130));
  const installRaw = params.get('i') as InstallProfileId | null;
  const install =
    installRaw && VALID_INSTALLS.includes(installRaw) ? installRaw : 'code_min';

  const sRaw = Number(params.get('s'));
  const stories = (sRaw === 2 ? 2 : 1) as 1 | 2;
  const expRaw = params.get('e') as Exposure | null;
  const exposure = expRaw && VALID_EXPOSURE.includes(expRaw) ? expRaw : 'B';
  const shapeRaw = params.get('r') as RoofShape | null;
  const shape = shapeRaw && VALID_SHAPE.includes(shapeRaw) ? shapeRaw : 'gable';
  const enclosed: 'fully' | 'partial' = params.get('w') === '1' ? 'fully' : 'partial';

  return { V, install, config: { stories, exposure, shape, enclosed } };
}

function writeUrlState(V: number, install: InstallProfileId, config: HouseConfig) {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  params.set('v', String(V));
  params.set('i', install);
  params.set('s', String(config.stories));
  params.set('e', config.exposure);
  params.set('r', config.shape);
  params.set('w', config.enclosed === 'fully' ? '1' : '0');
  const next = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history.replaceState({}, '', next);
}

export function useVisualizerState() {
  const initial = useMemo(readUrlState, []);
  const [manualWind, setManualWind] = useState<number>(initial.V);
  const [installId, setInstallId] = useState<InstallProfileId>(initial.install);
  const [config, setConfig] = useState<HouseConfig>(initial.config);
  const replay = useStormReplay();

  const profile = INSTALL_PROFILES[installId];

  // When replay is playing, replay drives V; otherwise the slider does
  const windSpeed = replay.state.isPlaying ? replay.state.V : manualWind;

  const cascade: CascadeResult = useMemo(
    () => buildFailureCascade(windSpeed, profile, config),
    [windSpeed, profile, config],
  );

  useEffect(() => {
    // Don't pollute URL during replay (would re-render every frame)
    if (replay.state.isPlaying) return;
    writeUrlState(manualWind, installId, config);
  }, [manualWind, installId, config, replay.state.isPlaying]);

  return {
    windSpeed,
    setWindSpeed: (v: number) => setManualWind(clampWind(v)),
    installId,
    setInstallId,
    config,
    setConfig,
    profile,
    cascade,
    replay,
  };
}
