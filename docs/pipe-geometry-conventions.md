# Pipe + Fitting Geometry Conventions

_Single source of truth for the "how does the pipe/fitting geometry system actually work" question, so future work doesn't reinvent (or worse, re-break) the same math the AD.19–AD.30 phases hardened._

---

## World axes (THREE.js convention)

- **+X**: east (or "right" from camera default)
- **+Y**: UP — the vertical axis. DWV slope sense, stack risers, floor stacking all use Y.
- **+Z**: forward (or "into the scene")

Right-handed coordinate system. `cross((1,0,0), (0,1,0)) = (0,0,1)`.

---

## Direction semantics — USE THESE NAMES, NOT "direction"

All four of these have historically been called "direction" in code, and the overlap caused AD.19 (bend quaternion on wrong axis) and AD.24 (tee main along branch direction). Prefer the explicit helpers in `src/core/pipe/pipeDirections.ts`:

| Name | Points from | Points to | Example use |
|---|---|---|---|
| **Segment tangent** / **travel** | Earlier polyline point | Later polyline point | Flow direction, slope computation |
| **Outward at endpoint** | Endpoint | Adjacent interior point (INTO the pipe body) | Junction-angle measurement, fitting alignment |
| **In-junction** | Pipe body | Junction point | Flow ENTERING the junction; equal to -Outward |
| **Bisector** (of two directions) | Junction | Outside the bend | Elbow arc midpoint direction |
| **Anti-bisector** | Junction | Inside the bend | Bend center offset direction |

Every module that needs directions should import the helpers: `outwardStart`, `outwardEnd`, `segmentTangent`, `travelIntoEnd`, `travelOutOfStart`. Do **not** hand-roll subtractions.

---

## Fitting local axes

Fittings in `FittingMeshes.tsx` are built in a **standardized local frame**. All quaternion math that places them in world space assumes this frame.

### Elbow / bend geometries (`buildMathBend`)

The torus geometry lives in the local XY plane:

- **Arc** lies in local XY plane (torus rotation axis along local +Z)
- **Arc midpoint** at local +X direction from the bend center (the local origin)
- **Hubs** at the arc ENDPOINTS, one at angle `-angle/2` and one at `+angle/2`
- **Hub tangents** point OUTWARD from the arc (away from the bend center)

### Tee / wye / combo / cross geometries

- **Main cylinder** along **local +X** (CylinderGeometry default +Y, then `body.rotateZ(π/2)`)
- **Branch cylinder**:
  - Sanitary tee (90°): along **local +Y**
  - Wye (45°): along local (cos45°, sin45°, 0) in XY plane
  - Combo: like wye with a 1/8 bend swept off the branch
- **Bend plane normal** along **local +Z**

### Straight-body fittings (coupling, cap, bushing)

- **Body cylinder** along **local +X** (same convention — oriented via `alignAxisToPipe`)

---

## Quaternion basis conventions

Three quaternion builders in `FittingGenerator.ts`. Each produces a rotation that maps the fitting's local frame to a world-space orientation. **The basis matrix column order encodes which local axis maps to which world direction.** Getting this wrong rotates the fitting onto the wrong axis — the classic AD.19 / AD.24 bug shape.

### `bendQuaternion(dirIn, dirOut)` — for elbows

- **Local +X** → world `antiBisector` (`bisector × planeNormal`) — the elbow's arc midpoint direction
- **Local +Y** → world `bisector` (`normalize(dirIn + dirOut)`)
- **Local +Z** → world `planeNormal` (`normalize(dirIn × dirOut)`) — torus rotation axis

Basis: `makeBasis(right, bisector, planeNormal)` where `right = bisector × planeNormal`.

Combined with `bendFittingOffset` to place the elbow at its **bend center** (not at the polyline vertex — the vertex is the kink point, offset `bendR/cos(angle/2)` from the bend center along the inward bisector).

### `teeQuaternion(mainDir, branchDir)` — for tee/wye/combo/cross

- **Local +X** → world `mainDir` (normalized) — tee's main cylinder aligns with the through-pipe
- **Local +Y** → world `perp` (Gram-Schmidt perp of branchDir w.r.t. mainDir) — tee's 90° branch OR wye's 45° branch aligns correctly in the bend plane
- **Local +Z** → world `up` (`mainDir × perp`) — bend plane normal

Basis: `makeBasis(mainDir, perp, up)` where `perp = normalize(branchDir - (branchDir·mainDir)·mainDir)`.

### `alignAxisToPipe(pipeDir)` — for couplings / caps / bushings

- **Local +X** → world `pipeDir` (normalized)
- Local +Y, +Z align via `THREE.Quaternion.setFromUnitVectors`'s default choice (arbitrary perpendicular)

---

## Retraction contract (AD.21)

Every pipe endpoint retracts by an amount determined by the specific fitting landing there. `PipeRenderer.junctionMap` classifies each endpoint via `junctionRetraction.ts::computeJunctionHints` and passes the numeric amount through `BuildPipeGeometryInput.retractStartFt` / `retractEndFt`:

| Fitting at endpoint | Retraction (feet) |
|---|---|
| Coupling (2-pipe inline, bend < 5°) | `socketDepth` |
| Reducer (2-pipe, mismatched diameters) | `socketDepth` |
| Tee / wye / cross (3+ pipe junction) | `socketDepth` |
| 2-pipe elbow | `socketDepth + bendR(angle)` |
| Mid-pipe branch (AD.20) | `socketDepth + 1.5·OD` |
| Free end | `0` |

For **internal** polyline vertices (always an elbow bend), retraction is unconditionally `socketDepth + bendR(angle)` on each side.

---

## End caps (AD.29)

When `retractStart/EndFt === 0` (free end, no fitting), `buildPipeGeometry` appends a `CircleGeometry(radius, 16)` disc at the endpoint oriented outward. Wall shell skips caps (transparent, would hide the main cap). Two 18-vertex caps = +36 verts per fully-free pipe.

---

## Split-on-branch (AD.28)

When a mid-pipe branch is drawn (OrthoPipeInteraction drag-from-middle), the commit flow:

1. `pipeStore.insertAnchor(mainPipeId, segmentIdx, projectionPoint)` — adds a vertex to the main pipe at the branch point, splitting the old segment in two.
2. `eventBus.emit(PIPE_COMPLETE, ...)` for the new branch pipe.
3. `generateJunctionFittings` (bidirectional loop) detects the 3-pipe cluster at the shared position and emits the proper tee/wye/combo.

Requires `generateJunctionFittings`'s outer loop to iterate `j = 0..N` (not `j > i`) — fitting emission needs to check BOTH directions of each pair because the split main has an interior vertex while the branch has an endpoint, and the endpoint-holder isn't guaranteed to be at the lower index.

---

## Invariants (AD.30)

`pipeInvariants.ts::validatePipe` checks:

- All polyline points are finite (no NaN/Infinity)
- `diameter > 0`, finite
- `points.length >= 2`
- Adjacent points not coincident
- Material non-empty

`pipeInvariants.ts::validateFitting` checks:

- Quaternion components all finite
- Position finite
- Diameter positive + finite

Call `assertPipeInvariants(pipe)` in dev-only hot paths when a silent NaN would cascade to unrenderable geometry. Compiled out in production via `import.meta.env.DEV`.

---

## The "why is my fitting at NaN" debugging checklist

When a fitting mysteriously appears in the wrong place or not at all:

1. **Is the quaternion finite?** → `validateFitting(f)` / check `f.quaternion`. A NaN component zeros the entire transform.
2. **Is the input direction zero-length?** → `bendQuaternion` etc. return identity quaternions for parallel/degenerate inputs. The fitting renders at world-axes alignment. Check the calling code's `dirIn`/`dirOut`/`mainDir`/`branchDir`.
3. **Is the fitting's local axis the one you expect?** → See "Fitting local axes" above. `build*` functions build in a specific local frame; getting the frame wrong is the #1 cause of rotational misplacement.
4. **Is the retraction amount in the correct units?** → `retractStartFt/EndFt` is **feet**. A bug that uses inches would retract 12× too much (pipe disappears) or 1/12 (pipe overlaps fitting). Run `validatePipe` and `validateFitting`.
5. **Is the bend-center offset applied?** → Elbows sit at their bend center, not the polyline vertex. `bendFittingOffset` encodes this; skipping it makes the elbow appear "floating off to the side".

---

## Phase history of architectural fixes

| Phase | Fix |
|---|---|
| **AD.5** | Emit elbow at 2-pipe endpoint junctions (was emitting tee/combo even for bends) |
| **AD.11** | `alignAxisToPipe` for couplings (was identity when inline) |
| **AD.12** | Bushing geometry + catalog entry |
| **AD.14** | Consolidated `JUNCTION_TOLERANCE_FT = 0.15` |
| **AD.15** | Galvanized NPT engagement lookup table |
| **AD.16** | Bushing auto-emit at 3+ endpoint clusters with smaller branch |
| **AD.19** | `bendQuaternion` basis fix (local +X was mapped to world antiBisector, not to world right) |
| **AD.20** | Mid-segment branch detection (endpoint-on-segment-interior) |
| **AD.21** | Per-endpoint numeric retraction (replaced boolean flags) |
| **AD.22** | Orientation-aware DWV classifier (san-tee vs combo vs wye) |
| **AD.23** | Ortho click-drag draw mode |
| **AD.24** | `teeQuaternion` basis fix (was mapping local +X to world branchDir) |
| **AD.28** | Split main pipe on mid-branch commit + bidirectional junction loop |
| **AD.29** | End caps on free pipe ends |
| **AD.30** | `pipeDirections.ts` + `pipeInvariants.ts` + this doc |
