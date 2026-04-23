/**
 * ComplianceOverlay3D — real-time 3D code violation markers.
 *
 * Operates like a spellchecker for plumbing: when the compliance
 * engine flags a node or edge, this component renders a pulsing
 * red beacon at that location plus a floating callout showing the
 * IPC code reference and remediation hint.
 *
 * Visual design:
 *   • ERROR   → red pulsing sphere with ⨯ glyph, solid callout
 *   • WARNING → amber pulsing ring, translucent callout
 *   • INFO    → cyan soft halo, compact callout
 *
 * Violations fade out over 1.5s if the underlying issue is fixed.
 * If multiple violations stack on the same position (< 0.3ft),
 * they group into a cluster marker with a count badge.
 *
 * Subscribes to simBus.SIM_MSG.COMPLIANCE_CHECKED which fires
 * after every Pass 4 of the solver.
 */

import { useEffect, useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import { simBus, SIM_MSG, type CompliancePayload } from '../../engine/graph/MessageBus';
import { usePipeStore } from '@store/pipeStore';
import { useFloorParams } from '@store/floorStore';
import { useReducedMotion } from '@core/a11y/useReducedMotion';
import type { Vec3 } from '@core/events';

// ── Live violation record ───────────────────────────────────────

interface ActiveViolation {
  id: string;
  severity: 'error' | 'warning' | 'info';
  codeRef: string;
  message: string;
  position: Vec3;
  detectedAt: number;
  /** Set when the violation is no longer in the latest report; used to animate fade-out. */
  fadeStartTs: number | null;
}

// ── Severity styling ────────────────────────────────────────────

const SEVERITY_STYLE = {
  error:   { color: '#ff1744', emissive: '#ff1744', glyph: '⨯', pulseHz: 2.5 },
  warning: { color: '#ffc107', emissive: '#ffc107', glyph: '⚠',  pulseHz: 1.5 },
  info:    { color: '#00e5ff', emissive: '#00e5ff', glyph: 'ⓘ',  pulseHz: 1.0 },
};

// ── Main component ──────────────────────────────────────────────

export function ComplianceOverlay3D() {
  const [violations, setViolations] = useState<ActiveViolation[]>([]);

  useEffect(() => {
    return simBus.on(SIM_MSG.COMPLIANCE_CHECKED, (msg) => {
      const payload = msg.payload as CompliancePayload;
      if (!payload) return;

      const now = performance.now();
      const pipes = usePipeStore.getState().pipes;

      // Resolve violation positions from nodeId / edgeId
      const incoming: ActiveViolation[] = [];
      for (const v of payload.violations) {
        let position: Vec3 | null = null;

        // Try edge first — violations often reference edges
        if (v.edgeId) {
          // Edge ID format: "edge-{pipeId}-{segmentIndex}"
          const parts = v.edgeId.split('-');
          const pipeId = parts.slice(1, -1).join('-');
          const segIdx = Number(parts[parts.length - 1]);
          const pipe = pipes[pipeId];
          if (pipe && !isNaN(segIdx) && pipe.points[segIdx] && pipe.points[segIdx + 1]) {
            const a = pipe.points[segIdx]!;
            const b = pipe.points[segIdx + 1]!;
            position = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.3, (a[2] + b[2]) / 2];
          }
        }

        // Fall back to node position
        if (!position && v.nodeId) {
          // Node ID format: "wp-{pipeId}-{index}"
          const parts = v.nodeId.split('-');
          const pipeId = parts.slice(1, -1).join('-');
          const idx = Number(parts[parts.length - 1]);
          const pipe = pipes[pipeId];
          if (pipe && !isNaN(idx) && pipe.points[idx]) {
            const p = pipe.points[idx]!;
            position = [p[0], p[1] + 0.3, p[2]];
          }
        }

        if (!position) continue;

        incoming.push({
          id: v.ruleId + '|' + (v.nodeId ?? '') + '|' + (v.edgeId ?? ''),
          severity: (v.severity === 'error' ? 'error' : 'warning') as 'error' | 'warning' | 'info',
          codeRef: v.codeRef,
          message: v.message,
          position,
          detectedAt: now,
          fadeStartTs: null,
        });
      }

      // Merge with existing: keep matching, mark missing for fade-out, add new
      setViolations((current) => {
        const incomingIds = new Set(incoming.map((v) => v.id));
        const currentMap = new Map(current.map((v) => [v.id, v]));
        const merged: ActiveViolation[] = [];

        // Keep or fade existing
        for (const [id, v] of currentMap) {
          if (incomingIds.has(id)) {
            merged.push({ ...v, fadeStartTs: null });
          } else if (!v.fadeStartTs) {
            merged.push({ ...v, fadeStartTs: now });
          } else {
            // Already fading — keep until fade completes
            if (now - v.fadeStartTs < 1500) merged.push(v);
          }
        }

        // Add new
        for (const v of incoming) {
          if (!currentMap.has(v.id)) merged.push(v);
        }

        return merged;
      });
    });
  }, []);

  // Cluster violations at similar positions
  const clusters = useMemo(() => {
    const clusterTol = 0.4; // feet
    const out: { rep: ActiveViolation; count: number; members: ActiveViolation[] }[] = [];

    for (const v of violations) {
      const match = out.find((c) => {
        const d = Math.sqrt(
          (c.rep.position[0] - v.position[0]) ** 2 +
          (c.rep.position[1] - v.position[1]) ** 2 +
          (c.rep.position[2] - v.position[2]) ** 2,
        );
        return d < clusterTol;
      });
      if (match) {
        match.count++;
        match.members.push(v);
      } else {
        out.push({ rep: v, count: 1, members: [v] });
      }
    }

    return out;
  }, [violations]);

  return (
    <group>
      {clusters.map((c) => (
        <FloorAwareViolation key={c.rep.id} cluster={c} />
      ))}
    </group>
  );
}

// ── Floor-aware wrapper ─────────────────────────────────────────

function FloorAwareViolation({
  cluster,
}: {
  cluster: { rep: ActiveViolation; count: number; members: ActiveViolation[] };
}) {
  const getFloorParams = useFloorParams();
  const y = cluster.rep.position[1];
  const fp = getFloorParams(y, y);
  if (!fp.visible || fp.opacity < 0.8) return null;
  return <ViolationMarker violation={cluster.rep} count={cluster.count} />;
}

// ── Individual violation marker ─────────────────────────────────

function ViolationMarker({ violation, count }: { violation: ActiveViolation; count: number }) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const ringRef = useRef<THREE.Mesh>(null!);
  const groupRef = useRef<THREE.Group>(null!);
  const reducedMotion = useReducedMotion();

  const style = SEVERITY_STYLE[violation.severity];

  useFrame(({ clock }) => {
    const now = performance.now();
    let opacity = 1;

    if (violation.fadeStartTs) {
      const age = (now - violation.fadeStartTs) / 1500;
      opacity = Math.max(0, 1 - age);
    }

    // Reduced motion: static beacon. Still obviously a violation —
    // colored sphere + ring + callout — but no sine pulses that can
    // induce motion sickness or cognitive drag for sensitive users.
    if (reducedMotion) {
      if (meshRef.current) {
        meshRef.current.scale.setScalar(opacity);
        (meshRef.current.material as THREE.MeshStandardMaterial).opacity = 0.75 * opacity;
        meshRef.current.visible = opacity > 0.01;
      }
      if (ringRef.current) {
        ringRef.current.scale.setScalar(opacity);
        (ringRef.current.material as THREE.MeshBasicMaterial).opacity = 0.5 * opacity;
        ringRef.current.visible = opacity > 0.01;
      }
      if (groupRef.current) groupRef.current.visible = opacity > 0.01;
      return;
    }

    // Pulse animation
    const t = clock.elapsedTime;
    const pulseT = (Math.sin(t * style.pulseHz * Math.PI * 2) + 1) / 2;
    const scale = 1 + pulseT * 0.25;

    if (meshRef.current) {
      meshRef.current.scale.setScalar(scale * opacity);
      (meshRef.current.material as THREE.MeshStandardMaterial).opacity = 0.75 * opacity;
      meshRef.current.visible = opacity > 0.01;
    }

    if (ringRef.current) {
      const ringScale = 1 + pulseT * 0.6;
      ringRef.current.scale.setScalar(ringScale * opacity);
      (ringRef.current.material as THREE.MeshBasicMaterial).opacity = (1 - pulseT) * 0.7 * opacity;
      ringRef.current.visible = opacity > 0.01;
    }

    if (groupRef.current) {
      groupRef.current.visible = opacity > 0.01;
    }
  });

  return (
    <group ref={groupRef} position={violation.position}>
      {/* Central pulsing sphere — visual only, `raycast` disabled so
          clicks fall through to pipes/fixtures underneath. Ditto every
          decorative mesh below this group. See audit notes. */}
      <mesh ref={meshRef} raycast={() => null}>
        <sphereGeometry args={[0.12, 14, 14]} />
        <meshStandardMaterial
          color={style.color}
          transparent
          opacity={0.75}
          emissive={style.emissive}
          emissiveIntensity={2.5}
          toneMapped={false}
        />
      </mesh>

      {/* Outer expanding ring */}
      <mesh ref={ringRef} rotation-x={-Math.PI / 2} raycast={() => null}>
        <ringGeometry args={[0.15, 0.22, 24]} />
        <meshBasicMaterial color={style.color} transparent opacity={0.6} side={THREE.DoubleSide} />
      </mesh>

      {/* Count badge for clusters */}
      {count > 1 && (
        <Billboard position={[0.15, 0.15, 0]}>
          <mesh raycast={() => null}>
            <circleGeometry args={[0.06, 16]} />
            <meshBasicMaterial color={style.color} />
          </mesh>
          <Text fontSize={0.08} color="#0a0a0f" fontWeight={700} anchorX="center" anchorY="middle">
            {count}
          </Text>
        </Billboard>
      )}

      {/* Callout with code reference */}
      <Billboard position={[0, 0.4, 0]}>
        <mesh position={[0, 0, -0.005]} raycast={() => null}>
          <planeGeometry args={[1.8, 0.28]} />
          <meshBasicMaterial color="#0a0a0f" transparent opacity={0.92} />
        </mesh>
        <mesh position={[0, 0, -0.004]} raycast={() => null}>
          <planeGeometry args={[1.82, 0.3]} />
          <meshBasicMaterial color={style.color} transparent opacity={0.4} />
        </mesh>
        <Text
          position={[-0.85, 0.05, 0]}
          fontSize={0.065} color={style.color}
          anchorX="left" anchorY="middle" fontWeight={700}
        >
          {style.glyph} {violation.codeRef}
        </Text>
        <Text
          position={[-0.85, -0.05, 0]}
          fontSize={0.052} color="#ccc"
          anchorX="left" anchorY="middle"
          maxWidth={1.7}
        >
          {violation.message.substring(0, 70) + (violation.message.length > 70 ? '…' : '')}
        </Text>
      </Billboard>
    </group>
  );
}
