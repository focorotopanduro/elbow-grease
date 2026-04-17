/**
 * XR Overlay — world-space HUD panels for immersive mode.
 *
 * In desktop mode, HUD elements are screen-space HTML divs.
 * In VR/AR, they become Three.js meshes anchored in world space
 * so the user can glance at them naturally without breaking
 * immersion. Panels float at comfortable reading distance and
 * follow the user's gaze loosely (billboard behavior).
 *
 * Also provides the VR Enter/Exit button for desktop mode.
 */

import { useRef, useState, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Text, Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { useEvent, useEventState } from '@hooks/useEventBus';
import { XR_EV, type XRTier } from '@core/xr/XRSessionManager';
import { LOAD_EV, type LoadState } from '@core/spatial/CognitiveLoadMonitor';

// ── World-space info panel (VR/AR mode) ─────────────────────────

interface WorldPanelProps {
  position: [number, number, number];
  title: string;
  body: string;
  color?: string;
  width?: number;
}

export function WorldPanel({
  position,
  title,
  body,
  color = '#00e5ff',
  width = 1.2,
}: WorldPanelProps) {
  return (
    <Billboard position={position} follow lockX={false} lockY={false} lockZ={false}>
      <group>
        {/* Background plane */}
        <mesh position={[0, 0, -0.01]}>
          <planeGeometry args={[width, 0.5]} />
          <meshBasicMaterial color="#0a0a0f" transparent opacity={0.85} />
        </mesh>

        {/* Border */}
        <mesh position={[0, 0, -0.005]}>
          <planeGeometry args={[width + 0.02, 0.52]} />
          <meshBasicMaterial color={color} transparent opacity={0.3} />
        </mesh>

        {/* Title */}
        <Text
          position={[0, 0.12, 0]}
          fontSize={0.06}
          color={color}
          anchorX="center"
          anchorY="middle"
          font={undefined}
        >
          {title}
        </Text>

        {/* Body */}
        <Text
          position={[0, -0.05, 0]}
          fontSize={0.045}
          color="#cccccc"
          anchorX="center"
          anchorY="middle"
          maxWidth={width - 0.2}
          font={undefined}
        >
          {body}
        </Text>
      </group>
    </Billboard>
  );
}

// ── Cognitive load indicator (world-space bar) ──────────────────

export function CognitiveLoadBar() {
  const meshRef = useRef<THREE.Group>(null!);
  const load = useEventState<LoadState | null>(LOAD_EV.LOAD_UPDATED, null);

  useFrame(({ camera }) => {
    if (!meshRef.current) return;
    // Position the bar 2m in front of camera, slightly below eye level
    const dir = new THREE.Vector3(0, 0, -2).applyQuaternion(camera.quaternion);
    meshRef.current.position.copy(camera.position).add(dir);
    meshRef.current.position.y -= 0.8;
    meshRef.current.lookAt(camera.position);
  });

  if (!load) return null;

  const barColor =
    load.level === 'low'        ? '#00e676' :
    load.level === 'moderate'   ? '#ffc107' :
    load.level === 'high'       ? '#ff9100' :
                                  '#ff1744';

  return (
    <group ref={meshRef}>
      {/* Track background */}
      <mesh position={[0, 0, 0]}>
        <planeGeometry args={[0.6, 0.03]} />
        <meshBasicMaterial color="#222" transparent opacity={0.7} />
      </mesh>
      {/* Fill */}
      <mesh position={[(load.score - 1) * 0.3, 0, 0.001]}>
        <planeGeometry args={[0.6 * load.score, 0.03]} />
        <meshBasicMaterial color={barColor} transparent opacity={0.9} />
      </mesh>
      {/* Label */}
      <Text
        position={[0, 0.04, 0]}
        fontSize={0.025}
        color="#888"
        anchorX="center"
      >
        {`COGNITIVE LOAD: ${load.level.toUpperCase()}`}
      </Text>
    </group>
  );
}

// ── Desktop VR toggle button ────────────────────────────────────

interface VRToggleProps {
  onEnterVR: () => void;
  onExitVR: () => void;
}

export function VRToggleButton({ onEnterVR, onExitVR }: VRToggleProps) {
  const [tier, setTier] = useState<XRTier>('desktop');
  const [vrAvailable, setVrAvailable] = useState(false);

  useEvent(XR_EV.TIER_CHANGED, (t: XRTier) => setTier(t));
  useEvent(XR_EV.CAPABILITIES_DETECTED, (cap: { supportsVR: boolean }) => {
    setVrAvailable(cap.supportsVR);
  });

  if (!vrAvailable && tier === 'desktop') return null;

  const isImmersive = tier !== 'desktop';

  return (
    <button
      onClick={isImmersive ? onExitVR : onEnterVR}
      style={{
        position: 'absolute',
        bottom: 16,
        right: 16,
        padding: '10px 20px',
        borderRadius: 8,
        border: `1px solid ${isImmersive ? '#ff1744' : '#00e5ff'}`,
        background: 'rgba(10,10,15,0.9)',
        color: isImmersive ? '#ff1744' : '#00e5ff',
        fontSize: 13,
        fontWeight: 600,
        cursor: 'pointer',
        letterSpacing: 1,
        textTransform: 'uppercase',
        pointerEvents: 'auto',
        zIndex: 30,
      }}
    >
      {isImmersive ? 'EXIT VR' : 'ENTER VR'}
    </button>
  );
}

// ── Contextual hint overlay (adapts to cognitive load) ──────────

export function AdaptiveHints() {
  const load = useEventState<LoadState | null>(LOAD_EV.LOAD_UPDATED, null);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!load) return;

    if (load.level === 'high' || load.level === 'overloaded') {
      if (load.cancelRate > 0.4) {
        setHint('Tip: Open your palm to cancel and start fresh');
      } else if (load.idleSeconds > 15) {
        setHint('Tip: Pinch a glowing fixture to start routing');
      } else if (load.cameraThrash > 2) {
        setHint('Tip: Press 1-4 for preset camera views');
      } else {
        setHint('Take your time — the system adapts to your pace');
      }
    } else {
      setHint(null);
    }
  }, [load]);

  if (!hint) return null;

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        padding: '8px 20px',
        borderRadius: 8,
        border: '1px solid #ffc107',
        background: 'rgba(10,10,15,0.9)',
        color: '#ffc107',
        fontSize: 12,
        pointerEvents: 'none',
        zIndex: 25,
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}
    >
      {hint}
    </div>
  );
}
