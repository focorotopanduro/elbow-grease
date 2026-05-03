/**
 * Vignette — subtle dark fade from corners inward. Sells focal depth by
 * pushing the periphery slightly back, drawing the eye to the house.
 *
 * Pure SVG radial gradient overlay, drawn LAST so it sits above weather.
 * Pointer-events disabled so it never blocks interaction.
 *
 * Storm-modulated: stronger vignette during high-wind moments increases
 * tension. At calm midday it's almost invisible.
 */
interface Props {
  /** 0–1 storm intensity */
  storm: number;
}

export default function Vignette({ storm }: Props) {
  const opacity = 0.18 + storm * 0.42;
  return (
    <>
      <radialGradient id="rh-vignette" cx="50%" cy="55%" r="68%">
        <stop offset="55%" stopColor="rgba(0,0,0,0)" />
        <stop offset="100%" stopColor={`rgba(0,0,0,${opacity.toFixed(2)})`} />
      </radialGradient>
      <rect
        x="0" y="0" width="800" height="480"
        fill="url(#rh-vignette)"
        pointerEvents="none"
        aria-hidden="true"
      />
    </>
  );
}
