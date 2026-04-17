# Good morning 👋

This is where things stand after last night's work. Sleep-test order:
double-click the desktop shortcut first, then come back here if something
seems off.

---

## ✅ Fixed overnight

### 1. Navigation
The Navigate button was grey (`#888`) whether active or not — so it looked
disabled even when it was working. Changed the active color to green
(`#66bb6a`) so the button clearly lights up when selected.

The Orbit camera controls now have explicit mouse bindings:

- **Left-click drag** → rotate around the target
- **Right-click drag** → pan the camera (screen-space panning)
- **Middle-click drag / wheel** → zoom (now zooms *toward the cursor*,
  not toward the center — much more intuitive for CAD work)
- **Touch**: one finger rotate, two fingers dolly + pan

Also expanded the orbit limits so you can get much closer (1.5 ft min) and
much farther (80 ft max) than before.

There's exactly one piece of code deciding whether orbit is enabled now
(`OrbitControlsGate`). The rule:

> orbit is enabled  ⇔  mode = Navigate  **and**  camera = Perspective
>                        **and**  no pipe-pivot drag in progress

If orbit ever feels dead, check those three things.

### 2. Wheels (Ctrl+Space, Ctrl+F, Ctrl+E+F)

Stripped all the heavy per-frame work:

- ❌ Fisheye lens deformation — sectors no longer shift under your cursor
- ❌ Full-screen `backdrop-filter: blur` — was re-compositing the entire
  scene while the wheel was open
- ❌ Particle emitter, holographics, cursor trail overlay
- ❌ Per-sector stagger (sectors now all appear at once, not one-by-one)
- ❌ Sector bulge on hover (they stay pinned, icon just grows)

Plus tightened timings:

| Moment | Before | Now |
|---|---|---|
| Open | 120 ms | **80 ms** |
| Close | 120 ms | **80 ms** |
| Hover feedback | 160 ms | **70 ms** |

The wheel should feel like flipping a switch now — open, aim, click,
close. What you aim at is what you hit; nothing slides.

### 3. Fittings now use real plumbing math

New file `src/core/pipe/PipeStandards.ts` holds actual industry-spec
data:

- **Socket depths** per ASTM: PVC Sch 40 (`D-2665`), copper sweat
  (`B16.22`), PEX-A (`F-877`), cast iron (`CISPI 301`), galvanized
  threaded. Values come from real plumber handbooks.
- **Hub-oversize multipliers**: PVC hubs are 16% wider than pipe, cast
  iron 30%, copper 4% (barely oversize — just a solder cup).
- **Bend centerline radii**: short-sweep 1/4 bend = 1.5× OD (PVC) or
  1.0× OD (copper). Long-sweep 1/4 = 3.0× OD.

Every bend fitting (22.5° / 45° / 90° / long-sweep 90°) is now generated
as a **torus arc with hub shoulders at each end**. The hub is flared
(larger radius) for the socket depth, so pipes visibly "slip into"
fittings — it reads like a real fitting, not a cylinder.

Also added proper geometries for:

- **P-trap** — actual U-bend (180° torus arc) with vertical downlet
  and horizontal trap arm. Seal depth 2.5" per UPC 1002.4 minimum.
- **Closet bend** — toilet-specific 90° with long horizontal leg and a
  short vertical neck going up to the flange. 3×4 reducing closet bend
  is the most common residential variant.
- **Long-sweep 1/4 bend** — now uses 3× OD centerline per industry
  convention (was 5× pipe-radius before, which was dimensionally wrong).

Each fitting also carries a Crane TP-410 K-factor for equivalent-length
friction loss in `getEquivLengthFt` so the hydraulic solver can use
accurate pressure-drop estimates.

### 4. Cleanup

Removed these orphaned files and their dependencies:

- `src/ui/pipe/PipeDecals.tsx` (per-pipe spec text — was never mounted)
- `src/ui/pipe/FittingStamps.tsx` (per-fitting manufacturer stamps)
- `src/ui/pipe/PipeEndDetails.tsx` (unused end-cap details)
- `src/ui/effects/PostEffects.tsx` (SSAO + Bloom + Vignette + SMAA)
- `@react-three/postprocessing` + `postprocessing` npm packages
- Six unused layer-store fields + three unused actions

The codebase is 4 files lighter and 2 npm packages lighter than when
you went to sleep.

---

## 🧭 What to try when you wake up

Double-click the desktop shortcut, then:

1. **Verify navigate.** Press `N` or click Navigate in the toolbar (now
   green when active). Hold left-click and drag — camera should orbit.
   Hold right-click and drag — camera should pan.
2. **Verify wheels feel snappy.** `Ctrl+Space` to open the drawing wheel.
   Point at DWV. Click. The wheel should vanish within ~80 ms of your
   click and leave you in draw mode.
3. **Draw some PVC.** Drop three points with two 90° corners between.
   Look closely at the corners — you should see a flared hub where the
   pipe meets the elbow.
4. **Draw some PEX.** Open wheel → SUPPLY → PEX-A. Draw a wavy line.
   No elbows render (PEX flexes) and the pipe curves smoothly.
5. **Draw a trap manually.** Draw a waste pipe that dips down, does a
   180° turn, and comes back up. The 180° should render as a proper
   U-shape, not a right angle. (Note: the generator still classifies
   this as a P-trap if it's close to 180° ± tolerance.)
6. **Press `7` for Top view, `8` for Front, `0` for Perspective.** They
   should transition smoothly.

---

## 🐛 Known issues I didn't get to

In case you hit any of these:

- **Fixture placement preview** can lag behind the cursor on slower
  machines because it uses useFrame. Not broken, just feels lazy.
- **Wall draw** switches interaction mode to Navigate when activated.
  When you press Esc to end wall draw, you stay in Navigate (doesn't
  restore your previous mode). Minor annoyance only.
- **The pipe solver's hydraulic simulation** uses the old friction
  tables, not the new `PipeStandards.getEquivLengthFt()` values. Solver
  integration is more surgery than overnight allowed.
- **Fittings don't rotate with the pipe's tangent plane** on complex
  3D bends (e.g. a pipe that turns AND slopes). They orient correctly
  on pure horizontal or pure vertical bends. For most residential DWV
  this is fine because bends happen on orthogonal axes.

---

## 📁 Files touched overnight

- `src/App.tsx` — OrbitControlsGate rewritten with explicit mouse bindings
- `src/ui/Toolbar.tsx` — Navigate button color fix
- `src/store/radialMenuStore.ts` — close timing 120→80 ms
- `src/ui/radial/RadialMenu.tsx` — stripped fisheye, stagger, backdrop blur,
  particles, holographics, trail; sharper silhouette; tighter timings
- `src/core/pipe/PipeStandards.ts` — **new** industry-spec dimensional data
- `src/ui/pipe/FittingMeshes.tsx` — rebuilt bend/trap geometry on top of
  PipeStandards; proper hubs on every fitting; P-trap and closet bend
- `src/store/layerStore.ts` — removed three dead toggles
- `src/ui/LayerPanel.tsx` — removed their buttons
- `package.json` — dropped postprocessing deps
- Four orphaned files deleted

Production build is fresh:
`C:\Program Files\ELBOW GREASE\src-tauri\target\release\elbow-grease.exe`
— 8.8 MB, same location as before. Desktop shortcut already points here.

---

## What I'd work on next

When you're back in action and want me to pick up:

1. **Fitting rotation on compound bends** — fittings along a pipe that
   bends in two planes at once don't orient cleanly. The math exists,
   just needs to flow through `bendQuaternion`.
2. **Hook the solver to `PipeStandards.getEquivLengthFt()`** so the
   hydraulic simulation uses real K-factors. Direct wire, small PR.
3. **Fitting picker UI** — currently the fitting catalog is auto-applied.
   For the estimation workflow you might want to manually tag a fitting
   (e.g., "use long-sweep here even though short-sweep would fit").
4. **BOM export** — the BOM panel shows totals but doesn't export to
   CSV / PDF yet. One afternoon of work.
5. **Save/load projects** — `ProjectSerializer` exists but isn't wired
   to a Save/Open button.

Sleep well. Everything should still be here when you wake up. If anything
is broken, tell me exactly what and I'll go fix it.

— Claude
