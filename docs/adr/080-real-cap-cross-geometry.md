# ADR 080 — Real Cap + Cross Geometry (Phases 14.AD.9 + 14.AD.10)

- **Status:** Accepted
- **Date:** 2026-04-20
- **Phases:** 14.AD.9 (cap), 14.AD.10 (cross)

## Context

During the AD.5 audit we catalogued every fitting type's
geometry builder. Two types were flagged as **aliased to wrong
shapes** rather than having dedicated builders:

| Type | Was rendering as | Should render as |
|---|---|---|
| `cap` | `getCouplingGeo` (open cylinder) | closed-end plug |
| `cross` | `getTeeStraightGeo` (3 hubs) | 4-way with 4 hubs |

Neither is a common fitting in residential work, but both do
appear:

- **Cap:** future-expansion stubs, capped cleanout ports, test
  caps at the end of a newly-pressurized supply line.
- **Cross:** DWV stacks with four tributaries meeting at a
  single floor (4-bathroom-branch stacks), supply manifolds
  with cross-connected trunks.

When they DO appear, the wrong geometry is obvious: a cap
rendering as a coupling is visibly open-ended (you can see
through the tube in cross-section), and a cross rendering as a
tee has one missing branch — either visually absent or bunched
up into the through-line.

These weren't priority-1 before because the AD.5 PVC-elbow
emission bug was hiding them. With the elbow now correct, the
remaining aliasings stand out.

## Decision

### AD.9 — Real `getCapGeo`

Closed-end plug. Composition:

```
Hub socket (open toward pipe)  →  closed dome (far end)
```

Geometry parts:
1. Main body cylinder with `hubR` radius, length =
   `socketDepth + 0.5 × pipeR`. One end open (pipe enters),
   other end at the dome.
2. Closed dome: a slightly smaller-radius disc at the outer
   end, thickness ≈ `0.1 × pipeR`. Gives the cap a visible
   "end cap" silhouette at any camera angle.
3. Internal stop ring at socket depth from the open end —
   pipe butts against it.

Orientation: cap's open end at local X=0, dome at local X=+totalLen.
The fitting's quaternion aligns it to the pipe's axis direction.

### AD.10 — Real `getCrossGeo`

True 4-way with 4 hubs. Composition:

```
         ┌─── hub (+Z)
         │
  hub ───┼─── hub
  (-X)   │   (+X)
         │
         └─── hub (-Z)
```

Geometry parts:
1. Main through-line: cylinder along X axis, length =
   `2 × (portOffset + socket)`.
2. Perpendicular branch: cylinder along Z axis, same length as
   main.
3. Four hub shoulders via `buildHubShoulder()`, positioned at
   each port offset along their respective half-axes.
4. Central stop ring at the intersection.

The two cylinders intersect at the origin. Each hub provides
the material-specific socket decoration (primer ring for PVC,
crimp ring for PEX, solder bead for copper, etc. — the
`buildHubShoulder` helper handles this per-material).

## Dispatch switch update

```ts
case 'cross':
  geometry = getCrossGeo(mat, diam);       // was getTeeStraightGeo
  break;
case 'coupling':
  geometry = getCouplingGeo(mat, diam);
  break;
case 'cap':
  geometry = getCapGeo(mat, diam);         // was getCouplingGeo
  break;
```

## Impact

- **Cap:** closed-end pipes now show a proper plug silhouette
  instead of a see-through cylinder. The stop ring + dome are
  visible from any angle; in section view, the dome reads as a
  solid disc.
- **Cross:** 4-pipe intersections render with 4 distinct hub
  ports, 4 clear pipe-entry locations. BOM already priced
  `cross` correctly (distinct row from `tee`); this just
  catches up the visual to match.

## Trade-offs

- **Hub orientation for cross is fixed X/Z.** The fitting's
  instance quaternion (computed by the emitter) rotates it to
  the world-space pipe orientations at that vertex. For a cross
  aligned to the world axes the quaternion is identity. For a
  rotated cross (e.g., four pipes meeting at a 45° in-plane
  cluster), the quaternion rotates the whole assembly so all
  four hubs align with their respective pipe axes. This was
  already the behavior for the aliased tee path, so no new
  orientation logic needed — the fix is purely geometric.
- **Cap dome thickness is a visual cue, not structural.** Real
  PVC caps are flat-capped or slightly domed depending on
  manufacturer. The 0.1×pipeR disc is a middle-ground
  aesthetic choice; readable at any camera distance, not
  attempting to model any specific cap brand. If the user wants
  flat vs dome as a material-dependent choice, that's a polish
  phase (AD.11+).
- **Memoized via `geoCache` like every other builder.** First
  render pays the mesh-construction cost; every subsequent
  instance of the same (material, diameter) reuses the cached
  BufferGeometry. No perf regression.

## Verification

- `npx vitest run` — 1626 tests pass (no new tests; no behavior
  changed for non-`cap`, non-`cross` types).
- `npx tsc -b --noEmit` — clean.
- Visual verification will be part of the user's next launch —
  the geometry paths are cached by (material, diameter) key, so
  a fresh build will rebuild them from scratch. No test can
  assert "looks like a closed end" without a visual-diff
  harness, which is AD.11 backlog.

## Files

- `src/ui/pipe/FittingMeshes.tsx` — `getCapGeo()` and
  `getCrossGeo()` new functions; dispatch switch routes them
  instead of aliasing.
- `docs/adr/080-real-cap-cross-geometry.md` — this document.
