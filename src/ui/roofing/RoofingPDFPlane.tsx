/**
 * RoofingPDFPlane — Phase 14.R.5.
 *
 * 3D textured ground plane that displays the loaded blueprint PDF
 * page. Sized from `pdfPhysicalSize()` (widthPx / scale) so once
 * the user calibrates, the plane matches real-world feet and roof
 * sections land on top at their true scale.
 *
 * Rendering:
 *   • XZ plane at y = -0.005 (below the grid, so the grid reads
 *     over the PDF) with the image as a CanvasTexture.
 *   • Texture is cached per-dataUrl at module scope to avoid
 *     re-uploading to GPU when the camera moves or the user tweaks
 *     opacity. Matches the pattern in `BackdropPlane.tsx`.
 *   • Returns null when the PDF is hidden OR no image is loaded
 *     yet, paying zero cost in those states.
 *   • In calibrate mode, both picked anchors appear as small glowing
 *     spheres to help the user sanity-check the distance they typed.
 *
 * Mount gating: mounted only inside the roofing branch of <Scene>
 * in App.tsx, so we don't need to check `appMode` here.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';
import { useRoofStore } from '@store/roofStore';
import { useRoofingPdfCalibStore } from '@store/roofingPdfCalibStore';
import { pdfPhysicalSize } from '@engine/roofing/RoofGraph';

// ── Texture cache ───────────────────────────────────────────────

const textureCache = new Map<string, THREE.Texture>();

function createTexture(dataUrl: string): THREE.Texture {
  const loader = new THREE.TextureLoader();
  const tex = loader.load(dataUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8; // blueprints have fine line work — worth the extra samples
  return tex;
}

function useCachedTexture(dataUrl: string | undefined): THREE.Texture | null {
  const texRef = useRef<THREE.Texture | null>(null);

  useEffect(() => {
    if (!dataUrl) { texRef.current = null; return; }
    let cached = textureCache.get(dataUrl);
    if (!cached) {
      cached = createTexture(dataUrl);
      textureCache.set(dataUrl, cached);
    }
    texRef.current = cached;
  }, [dataUrl]);

  if (!dataUrl) return null;
  return texRef.current ?? textureCache.get(dataUrl) ?? (() => {
    const t = createTexture(dataUrl);
    textureCache.set(dataUrl, t);
    return t;
  })();
}

// ── Component ───────────────────────────────────────────────────

export function RoofingPDFPlane() {
  const pdf = useRoofStore((s) => s.pdf);
  const calibMode = useRoofingPdfCalibStore((s) => s.mode);
  const p1 = useRoofingPdfCalibStore((s) => s.firstPoint);
  const p2 = useRoofingPdfCalibStore((s) => s.secondPoint);

  const size = useMemo(() => pdfPhysicalSize(pdf), [pdf.widthPx, pdf.heightPx, pdf.scale]);
  const texture = useCachedTexture(pdf.imageDataUrl);

  if (!pdf.imageDataUrl || !pdf.visible || !size || !texture) return null;

  const rotY = ((pdf.rotationDeg ?? 0) * Math.PI) / 180;

  return (
    <group position={[pdf.offsetX, -0.005, pdf.offsetY]} rotation={[0, rotY, 0]}>
      {/* The PDF page as a textured plane. rotation-x = -π/2 drops
          it flat on the XZ ground. */}
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[size.widthFt, size.depthFt]} />
        <meshBasicMaterial
          map={texture}
          transparent
          opacity={pdf.opacity}
          depthWrite={false}
          side={THREE.DoubleSide}
          toneMapped={false}
        />
      </mesh>

      {/* Subtle outline so the plane edges are discoverable even at
          low opacity. Brighter when the user is mid-calibration. */}
      <PlaneOutline
        widthFt={size.widthFt}
        depthFt={size.depthFt}
        highlight={calibMode !== 'idle'}
      />

      {/* Calibration anchor markers — world-space, NOT child of this
          rotation group, so they live on the raw ground plane where
          the user clicked. Pulled UP out of the group in the markup
          below so that logic is explicit. */}
      <CalibMarkers p1={p1} p2={p2} offsetX={pdf.offsetX} offsetY={pdf.offsetY} rotY={rotY} />
    </group>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function PlaneOutline({
  widthFt, depthFt, highlight,
}: {
  widthFt: number;
  depthFt: number;
  highlight: boolean;
}) {
  const w = widthFt / 2;
  const d = depthFt / 2;
  const y = 0.001;
  const pts: [number, number, number][] = [
    [-w, y, -d], [w, y, -d], [w, y, d], [-w, y, d], [-w, y, -d],
  ];
  return (
    <Line
      points={pts}
      color={highlight ? '#ff9800' : '#445'}
      lineWidth={highlight ? 2 : 1}
      transparent
      opacity={highlight ? 0.95 : 0.6}
    />
  );
}

function CalibMarkers({
  p1, p2, offsetX, offsetY, rotY,
}: {
  p1: readonly [number, number] | null;
  p2: readonly [number, number] | null;
  offsetX: number;
  offsetY: number;
  rotY: number;
}) {
  // The anchor points are stored in WORLD coords, but this component
  // is a child of the group that's already offset + rotated. Reverse-
  // transform to find the local position so the markers appear at the
  // world-space click location.
  //   local = Rz(-rotY) * (world - offset)
  const cr = Math.cos(-rotY);
  const sr = Math.sin(-rotY);
  function localize(w: readonly [number, number]): [number, number, number] {
    const dx = w[0] - offsetX;
    const dy = w[1] - offsetY;
    return [dx * cr - dy * sr, 0.03, dx * sr + dy * cr];
  }
  return (
    <group>
      {p1 && (
        <mesh position={localize(p1)}>
          <sphereGeometry args={[0.25, 12, 12]} />
          <meshBasicMaterial color="#00e5ff" toneMapped={false} />
        </mesh>
      )}
      {p2 && (
        <mesh position={localize(p2)}>
          <sphereGeometry args={[0.25, 12, 12]} />
          <meshBasicMaterial color="#ff9800" toneMapped={false} />
        </mesh>
      )}
      {p1 && p2 && (
        <Line
          points={[localize(p1), localize(p2)]}
          color="#ffd54f"
          lineWidth={2}
          dashed
          dashSize={0.3}
          gapSize={0.2}
        />
      )}
    </group>
  );
}
