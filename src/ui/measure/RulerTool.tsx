/**
 * RulerTool — in-scene click-click measurement tool.
 *
 * When measureStore.mode === 'ruler' or 'scale', a full-screen catcher
 * plane on the active floor receives clicks:
 *   - First click  → set pendingStart
 *   - Second click → commitMeasurement (ruler) or proposeScalePair (scale)
 *
 * Renders:
 *   - Persistent dimensions for all committed measurements
 *   - Live preview dimension while picking second point
 *   - Scale-entry dialog after the second click in 'scale' mode
 */

import { useState } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { useMeasureStore, type Vec3 } from '@store/measureStore';
import { useFloorStore } from '@store/floorStore';

const PLANE_SIZE = 200;

export function RulerCatcher() {
  const mode = useMeasureStore((s) => s.mode);
  const pendingStart = useMeasureStore((s) => s.pendingStart);
  const setPendingStart = useMeasureStore((s) => s.setPendingStart);
  const setPreviewEnd = useMeasureStore((s) => s.setPreviewEnd);
  const commit = useMeasureStore((s) => s.commitMeasurement);
  const proposeScalePair = useMeasureStore((s) => s.proposeScalePair);
  // Phase 14.G — level + origin calibrate actions.
  const applyLevelFromPair = useMeasureStore((s) => s.applyLevelFromPair);
  const applyOriginShift = useMeasureStore((s) => s.applyOriginShift);
  const activeFloor = useFloorStore((s) => s.floors[s.activeFloorId]);
  const floorY = activeFloor?.elevationBase ?? 0;

  // Active for any 2-click (ruler/scale/level) or 1-click (origin) tool.
  if (mode === 'off') return null;

  const onMove = (e: ThreeEvent<PointerEvent>) => {
    setPreviewEnd([e.point.x, floorY, e.point.z]);
  };

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const pt: Vec3 = [e.point.x, floorY, e.point.z];

    // Origin is a ONE-click tool — apply on first click.
    if (mode === 'calibrate_origin') {
      applyOriginShift(pt);
      return;
    }

    // Ruler / scale / level are TWO-click tools.
    if (!pendingStart) {
      setPendingStart(pt);
      return;
    }
    if (mode === 'ruler') {
      commit(pendingStart, pt);
    } else if (mode === 'scale') {
      proposeScalePair(pendingStart, pt);
    } else if (mode === 'calibrate_level') {
      applyLevelFromPair(pendingStart, pt);
    }
  };

  return (
    <mesh
      position={[0, floorY + 0.015, 0]}
      rotation={[-Math.PI / 2, 0, 0]}
      onPointerMove={onMove}
      onPointerDown={onDown}
    >
      <planeGeometry args={[PLANE_SIZE, PLANE_SIZE]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

// ── Persistent measurement lines + labels ─────────────────────

export function MeasurementLines() {
  const measurements = useMeasureStore((s) => s.measurements);
  const pendingStart = useMeasureStore((s) => s.pendingStart);
  const previewEnd = useMeasureStore((s) => s.previewEnd);
  const mode = useMeasureStore((s) => s.mode);
  const scaleFactor = useMeasureStore((s) => s.scaleFactor);

  return (
    <group>
      {Object.values(measurements).map((m) => (
        <DimLine key={m.id} a={m.a} b={m.b} color={m.pinned ? '#ffd54f' : '#26c6da'} scaleFactor={scaleFactor} />
      ))}
      {(mode === 'ruler' || mode === 'scale') && pendingStart && previewEnd && (
        <DimLine a={pendingStart} b={previewEnd} color={mode === 'scale' ? '#ef5350' : '#4dd0e1'} dashed scaleFactor={scaleFactor} />
      )}
    </group>
  );
}

function DimLine({ a, b, color, dashed, scaleFactor }: { a: Vec3; b: Vec3; color: string; dashed?: boolean; scaleFactor: number }) {
  const ax = a[0], ay = a[1], az = a[2];
  const bx = b[0], by = b[1], bz = b[2];
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const worldDist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const realDist = worldDist * scaleFactor;
  const mid: Vec3 = [(ax + bx) / 2, (ay + by) / 2 + 0.15, (az + bz) / 2];

  // Build line using bufferGeometry
  const positions = new Float32Array([ax, ay + 0.02, az, bx, by + 0.02, bz]);

  return (
    <group>
      {/* Endpoint markers */}
      <mesh position={[ax, ay + 0.02, az]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.06, 0.09, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh position={[bx, by + 0.02, bz]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.06, 0.09, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* Line */}
      <line>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        {dashed ? (
          <lineDashedMaterial color={color} dashSize={0.15} gapSize={0.08} toneMapped={false} />
        ) : (
          <lineBasicMaterial color={color} toneMapped={false} />
        )}
      </line>
      {/* Label */}
      <Billboard position={mid}>
        <Text
          fontSize={0.13}
          color={color}
          outlineWidth={0.012}
          outlineColor="#000"
          anchorY="middle"
        >
          {formatFeet(realDist)}
        </Text>
      </Billboard>
    </group>
  );
}

function formatFeet(ft: number): string {
  if (ft < 1) return `${(ft * 12).toFixed(1)}″`;
  const whole = Math.floor(ft);
  const inches = (ft - whole) * 12;
  if (inches < 0.1) return `${whole}′`;
  return `${whole}′ ${inches.toFixed(1)}″`;
}

// ── Scale calibration dialog ──────────────────────────────────

export function ScaleCalibratorDialog() {
  const pair = useMeasureStore((s) => s.pendingScalePair);
  const apply = useMeasureStore((s) => s.applyScaleFromRealFeet);
  const cancel = useMeasureStore((s) => s.cancelScale);
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');

  if (!pair) return null;

  const dx = pair.b[0] - pair.a[0];
  const dy = pair.b[1] - pair.a[1];
  const dz = pair.b[2] - pair.a[2];
  const measured = Math.sqrt(dx * dx + dy * dy + dz * dz);

  const applyClick = () => {
    const ft = parseFloat(feet) || 0;
    const inc = parseFloat(inches) || 0;
    const total = ft + inc / 12;
    if (total > 0) apply(total);
    setFeet(''); setInches('');
  };

  return (
    <div style={{
      position: 'fixed',
      top: '30%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      zIndex: 120,
      background: 'linear-gradient(180deg, rgba(8,14,22,0.98) 0%, rgba(16,24,36,0.96) 100%)',
      border: '1px solid rgba(239,83,80,0.5)',
      borderRadius: 8,
      padding: 20,
      minWidth: 340,
      boxShadow: '0 8px 26px rgba(0,0,0,0.6), 0 0 24px rgba(239,83,80,0.25)',
      fontFamily: '"Segoe UI", system-ui, sans-serif',
      color: '#e0ecf3',
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: '#ef5350', letterSpacing: 1, marginBottom: 4 }}>
        📏 SCALE CALIBRATION
      </div>
      <div style={{ fontSize: 11, color: '#b8cbd7', marginBottom: 12 }}>
        Measured distance: <span style={{ color: '#ffd54f', fontFamily: 'Consolas, monospace' }}>{measured.toFixed(3)} world units</span>
        <br />
        Enter the real-world distance for these two points:
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 12 }}>
        <input
          type="number"
          value={feet}
          onChange={(e) => setFeet(e.target.value)}
          placeholder="ft"
          style={calInput}
          autoFocus
        />
        <span style={{ color: '#ffd54f' }}>′</span>
        <input
          type="number"
          value={inches}
          onChange={(e) => setInches(e.target.value)}
          placeholder="in"
          style={calInput}
        />
        <span style={{ color: '#ffd54f' }}>″</span>
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        <button onClick={cancel} style={cancelBtn}>Cancel</button>
        <button onClick={applyClick} style={applyBtn}>Apply Scale</button>
      </div>
    </div>
  );
}

const calInput: React.CSSProperties = {
  width: 70,
  padding: '6px 10px',
  background: 'rgba(8,14,22,0.85)',
  border: '1px solid rgba(120,180,220,0.3)',
  color: '#e0ecf3',
  borderRadius: 4,
  fontFamily: 'Consolas, monospace',
  fontSize: 13,
  outline: 'none',
};

const cancelBtn: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 11,
  background: 'transparent',
  border: '1px solid rgba(120,180,220,0.3)',
  borderRadius: 4,
  color: '#7fb8d0',
  cursor: 'pointer',
};

const applyBtn: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 11,
  background: 'linear-gradient(135deg, #26c6da, #00acc1)',
  border: '1px solid #4dd0e1',
  borderRadius: 4,
  color: '#fff',
  cursor: 'pointer',
  fontWeight: 600,
  boxShadow: '0 0 8px rgba(38,198,218,0.4)',
};
