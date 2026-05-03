"""
BEIT BUILDING CONTRACTORS — CINEMATIC ROOF INSTALL
==================================================

A pre-rendered 12-second cinematic for the homepage. Drone-style
camera move that:
  • Opens with a tight, depth-of-field shot skimming over fresh shingle
    courses (you see individual textures and the bevel/emboss detail)
  • Pulls back + lifts as more courses lay down on the slope
  • Reveals a beautiful cottage with golden architectural-line accents
    glowing along the ridge, eaves, and gable rakes
  • Settles on a cinematic hero pose at golden-hour lighting

The animation timeline (24 fps, 288 frames):
    0.0–1.0s   bare wood deck appears on each slope
    1.0–2.5s   self-adhered underlayment rolls in
    2.5–9.0s   shingles lay course-by-course, eave to ridge
    9.0–9.5s   ridge cap caps the peak
    Camera does a continuous drone move from low-and-close to
    high-and-wide across the full duration.

OUTPUT
  PNG sequence to scripts/blender/frames/frame_####.png. ffmpeg then
  combines the frames into public/videos/roof-install.mp4. (Blender 5.1
  removed the built-in FFMPEG output, so the two-step render-then-mux
  is now the only path.)

USAGE — UI
  1. Open Blender 5.1
  2. File -> Save As -> roof_install.blend (next to this .py)
  3. Scripting workspace -> open this file -> Run Script
  4. Layout workspace, numpad-0 for camera view, Spacebar to preview
  5. Render -> Render Animation (Ctrl+F12)
  6. Run ffmpeg yourself to combine frames -> MP4

USAGE — HEADLESS (what you actually want)
  blender --background --python roof_install_fastforward.py
  (then ffmpeg combines automatically — see render_pipeline.sh sibling)
"""

import bpy
import math
import os
import random
from mathutils import Vector

random.seed(42)

# SHIP_MODE — set via env var SHIP=1 or by editing here. Controls the
# render quality + duration.
SHIP_MODE = os.environ.get('SHIP', '').lower() in ('1', 'true', 'yes')

# ============================================================
# EDITABLE PARAMETERS
# ============================================================

# Realistic Florida-cottage dimensions (matches AROYH-typical roof spec).
# Footprint ~108 m^2 (1162 sqft) — small cottage-class home.
HOUSE_W = 9.0       # gable-end width (m) ≈ 29.5 ft
HOUSE_D = 12.0      # eave length (m) ≈ 39.4 ft
WALL_Z  = 2.7       # eave height (m) ≈ 9 ft
PITCH   = 26.6      # 6:12 pitch — common Florida steep-low

# Spanish-style barrel tile — high fidelity, optimal polygon budget.
# 24*12 = 288 quads per tile = 576 tris. Curve renders silky smooth at
# 4K without wasting tris on flat parts. Multiplied across ~1500 tile
# placements: ~864k triangles total — well within Cycles' comfort zone.
TILE_W       = 0.55   # full tile width along eave (m)
TILE_L       = 0.45   # full tile length up slope (m)
TILE_H_ARCH  = 0.105  # arch peak height — pronounced enough to read clearly as "barrel tile"
TILE_W_SEG   = 24     # arch resolution across width (silky-smooth curves)
TILE_L_SEG   = 12     # length subdivisions (slight displacement-ready)
TILE_OVERLAP_W = 0.18 # 18% width overlap with neighbor (interlock)
TILE_OVERLAP_L = 0.40 # 40% length overlap (60% of each tile is exposed)

# Effective spacing (centers of adjacent tiles)
SHINGLE_W   = TILE_W * (1 - TILE_OVERLAP_W)
SHINGLE_H   = TILE_L * (1 - TILE_OVERLAP_L)
SHINGLE_THK = 0.03    # used by ridge-cap geometry only

# Animation + render — values switch based on SHIP_MODE flag.
FPS         = 24
USE_CYCLES_GUI = True

if SHIP_MODE:
    # 4K production render — slower cinematic pacing
    DURATION_S = 16
    RES_W, RES_H = 3840, 2160
    SAMPLES = 96
    OUTPUT_DIR = "C:/BEITBUILDING/website/scripts/blender/ship/frames/"
    LIGHT_BOUNCES = 8
else:
    # Preview — slower cadence than v1 (8s) so the cinematic feel reads.
    # Samples bumped 12 → 24 to clean denoised noise (was reading as
    # frame-to-frame jitter in playback).
    DURATION_S = 10
    RES_W, RES_H = 720, 405
    SAMPLES = 24
    OUTPUT_DIR = "C:/BEITBUILDING/website/scripts/blender/preview/frames/"
    LIGHT_BOUNCES = 6

# Color palette — Beit brand: black + gold, glassmorphic, ethereal.
# Everything is dark + restrained except the gold architectural lines,
# which read as the brand's signature glow against a void background.
COLOR_WALLS    = (0.025, 0.030, 0.040)  # near-black, faint blue-grey for glass
COLOR_DECK     = (0.06,  0.05,  0.05)   # subtle dark deck (mostly hidden by shingles)
COLOR_UNDERLAY = (0.02,  0.02,  0.025)  # almost-black SWB
COLOR_SHINGLE  = (0.42, 0.18, 0.09)  # warm Spanish terracotta — instantly readable as clay tile

# Per-tile color variation palette — fed into the ColorRamp inside
# make_clay_tile_material(). Each tile picks a random point along this
# 3-stop gradient via Object Info > Random.
COLOR_TILE_DARK  = (0.34, 0.12, 0.05)  # darker baked clay (under-fired)
COLOR_TILE_MID   = (0.42, 0.18, 0.09)  # standard terracotta (base color)
COLOR_TILE_LIGHT = (0.58, 0.28, 0.12)  # lighter, more orange (over-fired)
COLOR_RIDGE    = (0.025, 0.025, 0.035)  # ridge cap (slightly darker yet)
COLOR_GROUND   = (0.012, 0.012, 0.018)  # near-pitch-black ground
COLOR_GOLD     = (1.000, 0.780, 0.360)  # the brand gold
COLOR_CHIMNEY  = (0.030, 0.030, 0.040)  # dark glass chimney column
COLOR_VAR      = 0.020                  # subtle shade variation per shingle

# Architectural-lines glow — bright enough to read against the black void.
# Bumped from 8 to 18 because the rest of the scene is now dark; the
# gold has to be the primary visual anchor.
GOLD_EMISSION_STRENGTH = 18.0

# Glass material params (dark glassmorphic walls + chimney)
GLASS_ROUGHNESS    = 0.18   # frosted-but-readable
GLASS_IOR          = 1.45   # standard architectural glass
GLASS_TRANSMISSION = 0.55   # half-translucent (lets the gold lines glow through)

# ============================================================
# DERIVED
# ============================================================
RUN     = HOUSE_W / 2
RISE    = RUN * math.tan(math.radians(PITCH))
SLOPE   = math.sqrt(RUN**2 + RISE**2)
RIDGE_Z = WALL_Z + RISE

COURSES_PER_SLOPE   = max(1, int(SLOPE / SHINGLE_H))
SHINGLES_PER_COURSE = max(1, int(HOUSE_D / SHINGLE_W))

TOTAL_F = FPS * DURATION_S
COS_P   = math.cos(math.radians(PITCH))
SIN_P   = math.sin(math.radians(PITCH))

# Animation timing as PROPORTIONS of total duration. Pulled EARLIER so
# the opening close-up linger has tiles arriving while the camera is
# still tight on the slope — eye registers tile detail mid-install,
# not on a bare deck.
F_DECK     = max(2, int(TOTAL_F * 0.03))   # deck barely 3% in
F_UNDERLAY = max(3, int(TOTAL_F * 0.08))   # underlayment at 8%
F_COURSE_0 = max(4, int(TOTAL_F * 0.10))   # first course at 10% (during linger!)
F_COURSE_N = max(5, int(TOTAL_F * 0.72))   # last course at 72%
F_RIDGE    = max(6, int(TOTAL_F * 0.76))   # ridge cap at 76%


# ============================================================
# HELPERS
# ============================================================
def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for col in [bpy.data.materials, bpy.data.meshes, bpy.data.lights, bpy.data.cameras]:
        for item in list(col):
            col.remove(item)


def make_mat(name, color, roughness=0.7, metallic=0.0):
    """Standard Principled BSDF material."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return m


def make_glass_mat(name, color, roughness=GLASS_ROUGHNESS, ior=GLASS_IOR,
                   transmission=GLASS_TRANSMISSION):
    """Glassmorphic material for walls + chimney — half-translucent dark glass.
    The gold architectural lines glow through it slightly, giving the
    cottage that ethereal floating-in-the-void brand quality."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['IOR'].default_value = ior
    # Input names changed across Blender versions: 'Transmission' (3.x)
    # vs 'Transmission Weight' (4.x+). Try both.
    for tname in ('Transmission Weight', 'Transmission'):
        if tname in bsdf.inputs:
            bsdf.inputs[tname].default_value = transmission
            break
    return m


def make_polished_dark_mat(name, color, roughness=0.08):
    """Mirror-like dark material for the ground — reflects the cottage."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = 0.0
    # High specular for the polished void-floor look
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 1.0
    return m


def make_clay_tile_material(name, base_dark, base_mid, base_light):
    """High-fidelity Spanish clay tile shader.

    TWO realism upgrades on the basic Principled BSDF:

    1. PER-INSTANCE COLOR VARIATION via Object Info > Random.
       All tile placements share one mesh + one material, but the
       Random output of Object Info gives a different scalar per
       OBJECT instance. We feed it through a ColorRamp with three
       terracotta stops (darker / mid / lighter-orange), and the
       Principled BSDF Base Color picks up a slightly different shade
       per tile. Field of tiles reads as variegated kiln-fired clay
       instead of a uniform corrugated sheet.

    2. CLAY-GRIT BUMP via procedural Noise texture > Bump node.
       Adds the slightly rough, micro-pebbled surface texture that
       real fired terracotta has. No external image texture needed.

    Roughness + slight metallic stay tuned for clay (matte-ish,
    diffuse-dominated, picks up rim light cleanly).
    """
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links

    bsdf = nodes['Principled BSDF']
    bsdf.location = (300, 0)
    output = nodes['Material Output']
    output.location = (600, 0)

    # ── Per-instance color variation ───────────────────────────────
    obj_info = nodes.new('ShaderNodeObjectInfo')
    obj_info.location = (-1000, 200)

    color_ramp = nodes.new('ShaderNodeValToRGB')
    color_ramp.location = (-700, 200)
    cr = color_ramp.color_ramp
    cr.interpolation = 'LINEAR'
    cr.elements[0].position = 0.0
    cr.elements[0].color = (*base_dark, 1.0)
    cr.elements[1].position = 1.0
    cr.elements[1].color = (*base_light, 1.0)
    mid = cr.elements.new(0.5)
    mid.color = (*base_mid, 1.0)

    links.new(obj_info.outputs['Random'], color_ramp.inputs['Fac'])
    links.new(color_ramp.outputs['Color'], bsdf.inputs['Base Color'])

    # ── Clay-grit micro bump ───────────────────────────────────────
    noise = nodes.new('ShaderNodeTexNoise')
    noise.location = (-700, -250)
    noise.inputs['Scale'].default_value = 90.0   # fine grit
    noise.inputs['Detail'].default_value = 6.0
    noise.inputs['Roughness'].default_value = 0.55

    bump = nodes.new('ShaderNodeBump')
    bump.location = (-300, -250)
    bump.inputs['Strength'].default_value = 0.18  # subtle
    bump.inputs['Distance'].default_value = 0.012

    links.new(noise.outputs['Fac'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])

    # ── Shading tuning ─────────────────────────────────────────────
    bsdf.inputs['Roughness'].default_value = 0.62  # clay = matte-ish
    bsdf.inputs['Metallic'].default_value = 0.04
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.35

    # Subsurface scattering for warm clay glow under direct light. Real
    # terracotta has a slight forward translucence — the warm key light
    # picks it up and the tiles read as kiln-fired clay, not painted plastic.
    if 'Subsurface Weight' in bsdf.inputs:
        bsdf.inputs['Subsurface Weight'].default_value = 0.08
    if 'Subsurface Radius' in bsdf.inputs:
        bsdf.inputs['Subsurface Radius'].default_value = (0.40, 0.18, 0.08)
    if 'Subsurface Scale' in bsdf.inputs:
        bsdf.inputs['Subsurface Scale'].default_value = 0.006

    return m


def make_emissive_mat(name, color, strength=GOLD_EMISSION_STRENGTH):
    """Emission shader for the glowing architectural lines."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    # Replace the default Principled BSDF with an Emission node
    for n in list(nodes):
        if n.type != 'OUTPUT_MATERIAL':
            nodes.remove(n)
    out = next(n for n in nodes if n.type == 'OUTPUT_MATERIAL')
    em = nodes.new('ShaderNodeEmission')
    em.inputs['Color'].default_value = (*color, 1.0)
    em.inputs['Strength'].default_value = strength
    em.location = (-200, 0)
    out.location = (0, 0)
    links.new(em.outputs['Emission'], out.inputs['Surface'])
    return m


def keyframe_pop_in(obj, frame):
    """Hide before `frame`, show at `frame`. Hold visible to TOTAL_F.
    Self-contained interp: this function temporarily switches the
    keyframe-interp pref to CONSTANT, inserts the visibility keyframes,
    then restores. That way callers can keep BEZIER as the default for
    smooth position/rotation animations elsewhere."""
    prev = bpy.context.preferences.edit.keyframe_new_interpolation_type
    try:
        bpy.context.preferences.edit.keyframe_new_interpolation_type = 'CONSTANT'
        obj.hide_viewport = True
        obj.hide_render = True
        obj.keyframe_insert(data_path='hide_viewport', frame=frame - 1)
        obj.keyframe_insert(data_path='hide_render', frame=frame - 1)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.keyframe_insert(data_path='hide_viewport', frame=frame)
        obj.keyframe_insert(data_path='hide_render', frame=frame)
        obj.keyframe_insert(data_path='hide_viewport', frame=TOTAL_F)
        obj.keyframe_insert(data_path='hide_render', frame=TOTAL_F)
    finally:
        bpy.context.preferences.edit.keyframe_new_interpolation_type = prev


def keyframe_tile_drop_in(obj, final_loc, final_rot, frame, side, fade_frames=6):
    """Tile arrives from above + slightly rotated, settles flat on slope.

    Visibility pops in at (frame - fade_frames) — tile fades from
    invisible to its starting elevated pose, then BEZIER-interpolates
    down + rotates flat over `fade_frames` frames. fade_frames defaults
    to 6 = 0.25s at 24fps.

    Side ('left' or 'right') determines which slope normal direction
    we offset along for the start position (above the slope, not into
    it).
    """
    # Slope normal direction (outward)
    nx = -SIN_P if side == 'left' else SIN_P
    nz = COS_P
    offset_h = 0.32
    start_loc = (
        final_loc[0] + nx * offset_h,
        final_loc[1],
        final_loc[2] + nz * offset_h,
    )
    extra_rot = 0.30 if side == 'left' else -0.30  # ~17° tilt overshoot
    start_rot = (final_rot[0], final_rot[1] + extra_rot, final_rot[2])

    keyframe_pop_in(obj, frame - fade_frames)

    # BEZIER position + rotation transition
    obj.location = start_loc
    obj.rotation_euler = start_rot
    obj.keyframe_insert(data_path='location', frame=frame - fade_frames)
    obj.keyframe_insert(data_path='rotation_euler', frame=frame - fade_frames)

    obj.location = final_loc
    obj.rotation_euler = final_rot
    obj.keyframe_insert(data_path='location', frame=frame)
    obj.keyframe_insert(data_path='rotation_euler', frame=frame)


def set_constant_interpolation():
    """Legacy helper — no longer called from main(). Kept so old call
    sites still work. New keyframe_pop_in handles its own interp."""
    pass


def look_at_euler(camera_loc, target_loc):
    """Return Euler rotation that points the camera's -Z axis at the target."""
    direction = Vector(target_loc) - Vector(camera_loc)
    return direction.to_track_quat('-Z', 'Y').to_euler()


def add_cube(loc, rot, scale, name, mat, bevel_w=0.0):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(mat)
    if bevel_w > 0:
        b = o.modifiers.new('Bevel', 'BEVEL')
        b.width = bevel_w
        b.segments = 2
    return o


def add_plane(loc, rot, scale, name, mat):
    bpy.ops.mesh.primitive_plane_add(location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(mat)
    return o


def slope_transform(side):
    if side == 'left':
        return (-RUN/2, 0, WALL_Z + RISE/2), (0, -math.radians(PITCH), 0)
    return (RUN/2, 0, WALL_Z + RISE/2), (0, math.radians(PITCH), 0)


def shingle_world_pos(side, course_idx, slot_idx):
    s = course_idx * SHINGLE_H + SHINGLE_H / 2
    d = -HOUSE_D/2 + (slot_idx + 0.5) * SHINGLE_W
    offset = 0.022
    if side == 'left':
        wx = -RUN + s * COS_P - SIN_P * offset
        wz = WALL_Z + s * SIN_P + COS_P * offset
        ry = -math.radians(PITCH)
    else:
        wx = RUN - s * COS_P + SIN_P * offset
        wz = WALL_Z + s * SIN_P + COS_P * offset
        ry = math.radians(PITCH)
    return (wx, d, wz), (0, ry, 0)


# ============================================================
# STATIC GEOMETRY
# ============================================================
def build_ground():
    """Dark water surface — black-glassy with animated radial ripples
    so reflections are softened and stylized (not a perfect mirror that
    would compete with the cottage). Wave Texture node generates the
    ripples, animated via keyframes on Phase Offset for slow ring
    motion across the duration. Reflection ~65% strength so the
    cottage's inverted reflection reads as ambient mood, not subject.
    """
    bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
    g = bpy.context.active_object
    g.name = 'WaterGround'

    m = bpy.data.materials.new('WaterMat')
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links

    bsdf = nodes['Principled BSDF']

    # Generated coord → Mapping → Wave (rings)
    tex_coord = nodes.new('ShaderNodeTexCoord')
    tex_coord.location = (-1100, 0)

    mapping = nodes.new('ShaderNodeMapping')
    mapping.name = 'WaveMapping'
    mapping.location = (-900, 0)
    mapping.inputs['Scale'].default_value = (0.04, 0.04, 1.0)  # large rings

    wave = nodes.new('ShaderNodeTexWave')
    wave.name = 'WaveTex'
    wave.location = (-650, 0)
    wave.wave_type = 'RINGS'
    wave.inputs['Scale'].default_value = 6.0
    wave.inputs['Distortion'].default_value = 1.4
    wave.inputs['Detail'].default_value = 2.0
    wave.inputs['Detail Scale'].default_value = 1.5

    bump = nodes.new('ShaderNodeBump')
    bump.location = (-350, 0)
    bump.inputs['Strength'].default_value = 0.30
    bump.inputs['Distance'].default_value = 0.05

    links.new(tex_coord.outputs['Generated'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], wave.inputs['Vector'])
    links.new(wave.outputs['Color'], bump.inputs['Height'])
    links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])

    bsdf.inputs['Base Color'].default_value = (0.012, 0.012, 0.020, 1.0)
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.18    # softer than mirror
    if 'Specular IOR Level' in bsdf.inputs:
        bsdf.inputs['Specular IOR Level'].default_value = 0.65

    g.data.materials.append(m)

    # Animate Wave Phase Offset across duration — slow ring motion.
    # Phase Offset input is named exactly that on the Wave Texture.
    if 'Phase Offset' in wave.inputs:
        wave.inputs['Phase Offset'].default_value = 0.0
        m.node_tree.keyframe_insert(
            data_path=f'nodes["WaveTex"].inputs["Phase Offset"].default_value',
            frame=1,
        )
        wave.inputs['Phase Offset'].default_value = 8.0  # ~1.3 cycles
        m.node_tree.keyframe_insert(
            data_path=f'nodes["WaveTex"].inputs["Phase Offset"].default_value',
            frame=TOTAL_F,
        )
    return g


def build_walls():
    """Dark glassmorphic walls. Gold architectural lines glow through."""
    return add_cube(
        loc=(0, 0, WALL_Z/2),
        rot=(0, 0, 0),
        scale=(HOUSE_W/2, HOUSE_D/2, WALL_Z/2),
        name='Walls',
        mat=make_glass_mat('Walls', COLOR_WALLS),
        bevel_w=0.04,
    )


def build_gables():
    """Same glass material as the walls so the cottage reads as a single
    transparent volume capped by the dark roof."""
    out = []
    glass_mat = make_glass_mat('Gable', COLOR_WALLS)
    for sign in (-1, 1):
        verts = [
            (-RUN, sign * HOUSE_D/2, WALL_Z),
            ( RUN, sign * HOUSE_D/2, WALL_Z),
            (   0, sign * HOUSE_D/2, RIDGE_Z),
        ]
        m = bpy.data.meshes.new(f'GableMesh_{sign}')
        m.from_pydata(verts, [], [(0, 1, 2)])
        m.update()
        o = bpy.data.objects.new(f'Gable_{sign}', m)
        bpy.context.collection.objects.link(o)
        o.data.materials.append(glass_mat)
        out.append(o)
    return out


def build_chimney():
    """Dark glass column near the ridge — cottage silhouette accent.
    Reads as a tall obelisk against the glow rather than a brick stack."""
    cx, cy = 0.4, HOUSE_D/2 - 1.2
    base = add_cube(
        loc=(cx, cy, RIDGE_Z + 0.05),
        rot=(0, 0, 0),
        scale=(0.40, 0.40, 0.55),
        name='Chimney_Base',
        mat=make_glass_mat('ChimneyGlass', COLOR_CHIMNEY),
        bevel_w=0.03,
    )
    cap = add_cube(
        loc=(cx, cy, RIDGE_Z + 1.5),
        rot=(0, 0, 0),
        scale=(0.50, 0.50, 0.10),
        name='Chimney_Cap',
        mat=make_polished_dark_mat('ChimneyCap', (0.04, 0.04, 0.05), roughness=0.20),
        bevel_w=0.02,
    )
    return [base, cap]


def build_deck(side):
    loc, rot = slope_transform(side)
    return add_plane(loc, rot, (SLOPE/2, HOUSE_D/2, 1),
                     f'Deck_{side}',
                     make_mat(f'DeckMat_{side}', COLOR_DECK, 0.88))


def build_underlay(side):
    loc, rot = slope_transform(side)
    offset = 0.015
    nx = -SIN_P if side == 'left' else SIN_P
    nz = COS_P
    loc = (loc[0] + nx * offset, loc[1], loc[2] + nz * offset)
    return add_plane(loc, rot, (SLOPE/2, HOUSE_D/2, 1),
                     f'Underlay_{side}',
                     make_mat(f'UnderMat_{side}', COLOR_UNDERLAY, 0.62))


def build_tile_mesh():
    """Build the high-polygon barrel-tile mesh ONCE.

    Geometry: a curved rectangle with cosine arch profile across the
    width (W axis = along eave). Length (L axis = up slope) runs in a
    uniform extruded fashion. Z = arch height above tile plane.

    Why a custom mesh instead of subdivision-modifier-a-cube:
      • predictable poly count for render planning
      • smooth-shaded across the arch (we set use_smooth on every face)
      • single mesh data block shared across ALL tile instances —
        Blender renders ~2000 placements without bloating memory

    Resulting poly count: TILE_W_SEG * TILE_L_SEG quads per tile.
    Default 16 * 8 = 128 quads = 256 tris/tile. With ~1500 tile
    placements that's ~380k tris — comfortable for 4K Cycles.
    """
    verts = []
    for j in range(TILE_W_SEG + 1):
        ly = -TILE_W/2 + j * TILE_W / TILE_W_SEG
        # Half-cosine arch: peak at center (ly=0), drops to 0 at edges
        arch = TILE_H_ARCH * math.cos(math.pi * ly / TILE_W)
        for i in range(TILE_L_SEG + 1):
            lx = -TILE_L/2 + i * TILE_L / TILE_L_SEG
            verts.append((lx, ly, arch))

    nx = TILE_L_SEG + 1
    faces = []
    for j in range(TILE_W_SEG):
        for i in range(TILE_L_SEG):
            v00 = j * nx + i
            v10 = v00 + 1
            v01 = v00 + nx
            v11 = v01 + 1
            faces.append((v00, v10, v11, v01))

    m = bpy.data.meshes.new('BarrelTileMesh')
    m.from_pydata(verts, [], faces)
    m.update()
    # Smooth-shaded so the arch reads as a continuous curve, not faceted
    for poly in m.polygons:
        poly.use_smooth = True
    return m


def build_shingle(side, course_idx, slot_idx, tile_mesh=None):
    """Place a barrel tile instance using the shared tile_mesh."""
    loc, rot = shingle_world_pos(side, course_idx, slot_idx)
    obj = bpy.data.objects.new(
        f'Tile_{side}_{course_idx}_{slot_idx}',
        tile_mesh,
    )
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    obj.rotation_euler = rot
    return obj


def build_ridge_cap():
    out = []
    n = max(1, int(HOUSE_D / SHINGLE_W))
    for i in range(n):
        d = -HOUSE_D/2 + (i + 0.5) * SHINGLE_W
        o = add_cube(
            loc=(0, d, RIDGE_Z + SHINGLE_THK),
            rot=(0, 0, 0),
            scale=(RUN * 0.06, SHINGLE_W/2 * 1.02, SHINGLE_THK),
            name=f'Ridge_{i}',
            mat=make_mat(f'RidgeM_{i}', COLOR_RIDGE, 0.80),
            bevel_w=0.004,
        )
        out.append(o)
    return out


# ============================================================
# GOLDEN ARCHITECTURAL LINES
# ============================================================
def build_gold_lines():
    """Thin glowing strips along the ridge, eaves, and gable rakes.
    Reads as "architectural blueprint glow" — luxe finish detail."""
    gold_mat = make_emissive_mat('Gold_Line', COLOR_GOLD, GOLD_EMISSION_STRENGTH)
    out = []

    # Ridge line (along Y axis at the peak)
    ridge = add_cube(
        loc=(0, 0, RIDGE_Z + SHINGLE_THK + 0.04),
        rot=(0, 0, 0),
        scale=(0.025, HOUSE_D/2, 0.012),
        name='GoldRidge',
        mat=gold_mat,
    )
    out.append(ridge)

    # Eave lines (front + back, at WALL_Z, just below the slope edge)
    for sign in (-1, 1):
        eave = add_cube(
            loc=(0, sign * HOUSE_D/2, WALL_Z + 0.005),
            rot=(0, 0, 0),
            scale=(HOUSE_W/2 + 0.04, 0.018, 0.010),
            name=f'GoldEave_{sign}',
            mat=gold_mat,
        )
        out.append(eave)

    # Gable rake edges — diagonal lines from eave corners UP to the ridge
    # apex on each gable end. The previous version had the angle
    # computation flipped — atan2 was using the ridge→eave vector
    # instead of eave→ridge, which rotated the rake cube into the
    # opposite diagonal. Result: the gable triangle's apex pointed DOWN
    # at WALL_Z instead of UP at RIDGE_Z. That was the entire "frame is
    # upside down" symptom.
    #
    # Fix: aim cube +X axis along the eave→ridge vector. After Y-axis
    # rotation by θ, mesh-local +X (1,0,0) maps to world (cos θ, 0, -sin θ).
    # Want this to align with (vec_dx, 0, vec_dz) / length where vec
    # points eave→ridge, so:
    #   cos θ = vec_dx / length    ⇒  θ component from x
    #   sin θ = -vec_dz / length    ⇒  negate dz before atan2
    # Hence: θ = atan2(-vec_dz, vec_dx).
    for end_sign in (-1, 1):       # -1 = back gable, +1 = front gable
        for side_sign in (-1, 1):  # -1 = left slope, +1 = right slope
            x_eave = side_sign * RUN
            x_ridge = 0.0
            y = end_sign * HOUSE_D/2
            mid_x = (x_eave + x_ridge) / 2
            mid_z = (WALL_Z + RIDGE_Z) / 2
            # Vector pointing FROM eave TO ridge (the upward direction).
            vec_dx = x_ridge - x_eave
            vec_dz = RIDGE_Z - WALL_Z
            length = math.sqrt(vec_dx*vec_dx + vec_dz*vec_dz)
            angle_y = math.atan2(-vec_dz, vec_dx)
            rake = add_cube(
                loc=(mid_x, y + end_sign * 0.005, mid_z),
                rot=(0, angle_y, 0),
                scale=(length / 2, 0.018, 0.010),
                name=f'GoldRake_{end_sign}_{side_sign}',
                mat=gold_mat,
            )
            out.append(rake)

    # Vertical corner edges of the walls (cottage-luxe touch)
    for sign_x in (-1, 1):
        for sign_y in (-1, 1):
            corner = add_cube(
                loc=(sign_x * HOUSE_W/2, sign_y * HOUSE_D/2, WALL_Z/2),
                rot=(0, 0, 0),
                scale=(0.012, 0.012, WALL_Z/2),
                name=f'GoldCorner_{sign_x}_{sign_y}',
                mat=gold_mat,
            )
            out.append(corner)

    return out


# ============================================================
# GOLD DUST + GLASS ORBS (atmospheric brand garnish)
# ============================================================
def make_specular_dust_material():
    """Chrome-metallic + per-instance variable emission. Each particle
    is a tiny mirror sphere that catches reflections of the key + rim
    lights AND emits gold light at a strength that varies per object
    instance via Object Info > Random. Field reads as a TWINKLY star
    field — some bright sparkles, some dim chrome motes catching
    reflections. Specular shimmer in the aether."""
    m = bpy.data.materials.new('SpecDust')
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links

    bsdf = nodes['Principled BSDF']

    # Per-instance random → emission strength variation
    obj_info = nodes.new('ShaderNodeObjectInfo')
    obj_info.location = (-700, -200)

    # Map random 0-1 to emission strength 1-50 (some dim, some bright)
    multiply = nodes.new('ShaderNodeMath')
    multiply.operation = 'MULTIPLY'
    multiply.location = (-450, -200)
    multiply.inputs[1].default_value = 50.0  # peak emission for brightest particles

    # Power curve to make most particles dim, only a few bright (sparkly)
    power = nodes.new('ShaderNodeMath')
    power.operation = 'POWER'
    power.location = (-250, -200)
    power.inputs[1].default_value = 2.5  # bias toward dim — only top ~30% are bright

    links.new(obj_info.outputs['Random'], multiply.inputs[0])
    links.new(multiply.outputs[0], power.inputs[0])

    # Chrome surface
    bsdf.inputs['Base Color'].default_value = (0.08, 0.06, 0.03, 1.0)
    bsdf.inputs['Metallic'].default_value = 1.0
    bsdf.inputs['Roughness'].default_value = 0.06        # near-mirror

    # Emission color = brand gold; strength = per-particle random
    if 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = (1.0, 0.78, 0.36, 1.0)
    if 'Emission Strength' in bsdf.inputs:
        links.new(power.outputs[0], bsdf.inputs['Emission Strength'])
    return m


def build_gold_particles(count=60):
    """Specular twinkly gold dust vortex around the cottage.

    Particles spawn in a cylindrical shell around the cottage (plan) +
    vertical band. Each particle:
      • has its own angular speed → slow rotation around cottage Z axis
      • has its own vertical drift phase → no two in sync
      • inherits per-instance random emission strength via the dust
        material's Object Info > Random node — most particles are dim
        chrome motes catching reflections, a few are bright sparkles

    Foreground particles in close-up frames fall ahead of the DOF
    focus plane → soft bokeh shimmer.
    """
    out = []
    spec_dust = make_specular_dust_material()
    rng = random.Random(99)

    placed = 0
    attempts = 0
    while placed < count and attempts < count * 8:
        attempts += 1
        # Cylindrical spawn — radius from cottage center
        radius = rng.uniform(7.0, 17.0)
        angle0 = rng.uniform(0, 2 * math.pi)
        z = rng.uniform(0.4, 12.5)

        x0 = radius * math.cos(angle0)
        y0 = radius * math.sin(angle0)

        # Skip if inside cottage envelope
        if (abs(x0) < HOUSE_W/2 + 0.6
                and abs(y0) < HOUSE_D/2 + 0.6
                and z < RIDGE_Z + 0.6):
            continue

        size = rng.uniform(0.030, 0.075)
        bpy.ops.mesh.primitive_uv_sphere_add(
            location=(x0, y0, z), radius=size, segments=8, ring_count=6,
        )
        p = bpy.context.active_object
        p.name = f'GoldDust_{placed}'
        p.data.materials.append(spec_dust)
        for poly in p.data.polygons:
            poly.use_smooth = True

        # VORTEX motion: angular speed drives a slow rotation around the
        # cottage Z axis. Direction randomly +/-, magnitude 0.35-0.85 rad
        # over total duration → subtle swirl.
        angular_speed = rng.uniform(0.35, 0.85) * (1 if rng.random() > 0.5 else -1)
        drift = rng.uniform(0.15, 0.40)
        phase = rng.uniform(0, 2 * math.pi)

        # 4 keyframes for smoother spiral path
        for kf, t in [(1, 0.0), (TOTAL_F // 3, 1/3), (2 * TOTAL_F // 3, 2/3), (TOTAL_F, 1.0)]:
            angle = angle0 + angular_speed * t
            offset_z = drift * math.sin(phase + t * 2 * math.pi)
            x = radius * math.cos(angle)
            y = radius * math.sin(angle)
            p.location = (x, y, z + offset_z)
            p.keyframe_insert(data_path='location', frame=kf)

        out.append(p)
        placed += 1

    return out


def build_ground_fog():
    """Low-lying volumetric fog from which gold particles emerge.
    Thin volume cube hovering over the water, filled with a Volume
    Scatter shader. Forward anisotropy so light scatters more toward
    the camera — gives the warm key + gold rim a soft atmospheric glow.
    Density tuned LOW so it doesn't crush the cottage detail."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 1.2))
    fog = bpy.context.active_object
    fog.name = 'GroundFog'
    # Low-slung fog: 60×60 footprint, ONLY 2.4m tall + sits near the
    # ground. Earlier 8m-tall fog flooded the whole scene with warm
    # haze + drowned the tile detail. Now the fog only kisses the
    # ground / lower walls; god rays still get something to scatter
    # through but the cottage stays crisp.
    fog.scale = (30, 30, 1.2)
    bpy.ops.object.transform_apply(scale=True)

    m = bpy.data.materials.new('FogMat')
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links

    # Strip the surface BSDF — fog should have no surface, only volume
    bsdf = nodes.get('Principled BSDF')
    if bsdf:
        nodes.remove(bsdf)

    output = nodes['Material Output']
    output.location = (300, 0)

    scatter = nodes.new('ShaderNodeVolumeScatter')
    scatter.location = (50, 0)
    scatter.inputs['Color'].default_value = (1.0, 0.86, 0.62, 1.0)
    scatter.inputs['Density'].default_value = 0.005     # whisper of haze
    scatter.inputs['Anisotropy'].default_value = 0.55

    links.new(scatter.outputs['Volume'], output.inputs['Volume'])

    fog.data.materials.append(m)
    return fog


def build_interior_glow():
    """Warm point light inside the cottage with candle-like flicker.
    Glass walls + transmission let the warmth bleed through, hinting
    at shelter / home / life. The flicker animation slightly varies
    the energy across the timeline (deterministic, seeded RNG)."""
    bpy.ops.object.light_add(type='POINT', location=(0, 0, WALL_Z * 0.45))
    light = bpy.context.active_object
    light.name = 'InteriorGlow'
    light.data.energy = 90
    light.data.color = (1.0, 0.78, 0.50)
    light.data.shadow_soft_size = 0.8

    # Flicker: BARELY perceptible variation. Earlier ±14W amplitude
    # was reading as visible brightness pulse → jitter. Reduced to
    # ±2W with longer keyframe interval (every 12 frames = 0.5s)
    # so the energy drifts slowly like a steady candle, not flickers.
    flicker_rng = random.Random(2026)
    base = 90.0
    for f in range(1, TOTAL_F + 1, 12):
        light.data.energy = base + flicker_rng.uniform(-2, 2)
        light.data.keyframe_insert(data_path='energy', frame=f)

    return light


def build_drip_edge():
    """Thin gold metallic drip-edge trim along the LEFT and RIGHT slope
    eaves (where the tile would overhang the wall). Real-world detail —
    every pro Florida roofer installs drip edge under the underlayment.
    Reads as architectural rigor + brand-luxe gold accent."""
    out = []
    drip_mat = make_mat('DripEdgeMetal', COLOR_GOLD, roughness=0.25, metallic=0.85)
    for x_sign in (-1, 1):
        bpy.ops.mesh.primitive_cube_add(
            location=(x_sign * (RUN + 0.04), 0, WALL_Z - 0.025),
        )
        d = bpy.context.active_object
        d.name = f'DripEdge_{x_sign}'
        d.scale = (0.025, HOUSE_D/2 + 0.05, 0.045)
        bpy.ops.object.transform_apply(scale=True)
        d.rotation_euler = (0, math.radians(15) * x_sign, 0)
        d.data.materials.append(drip_mat)
        out.append(d)
    return out


def build_blueprint():
    """Holographic gold floor-plan outline floating above the cottage.
    Visible only during the install window (frames F_DECK -> just
    before F_RIDGE), then dissolves. Reads as architect's holographic
    plan revealed mid-air during the build — brand signature touch."""
    out = []
    bp_mat = make_emissive_mat('Blueprint', COLOR_GOLD, strength=4.5)

    z = RIDGE_Z + 4.5
    edges = [
        # (x1, y1, x2, y2)
        (-RUN, -HOUSE_D/2,  RUN, -HOUSE_D/2),  # front eave
        ( RUN, -HOUSE_D/2,  RUN,  HOUSE_D/2),  # right
        ( RUN,  HOUSE_D/2, -RUN,  HOUSE_D/2),  # back
        (-RUN,  HOUSE_D/2, -RUN, -HOUSE_D/2),  # left
        (   0, -HOUSE_D/2,    0,  HOUSE_D/2),  # ridge centerline
    ]

    for i, (x1, y1, x2, y2) in enumerate(edges):
        mid_x = (x1 + x2) / 2
        mid_y = (y1 + y2) / 2
        dx = x2 - x1
        dy = y2 - y1
        length = math.sqrt(dx*dx + dy*dy)
        angle_z = math.atan2(dy, dx)

        bpy.ops.mesh.primitive_cube_add(location=(mid_x, mid_y, z))
        bp = bpy.context.active_object
        bp.name = f'Blueprint_{i}'
        bp.scale = (length / 2, 0.025, 0.005)
        bpy.ops.object.transform_apply(scale=True)
        bp.rotation_euler = (0, 0, angle_z)
        bp.data.materials.append(bp_mat)

        # Visibility: hidden, appears at F_UNDERLAY, holds through the
        # hero pose, then fades out as the camera starts rising (frame
        # 0.85 * TOTAL_F). Ensures the holographic plan is on-screen
        # during the hero hold so the viewer registers it.
        bp_fade_out = int(TOTAL_F * 0.85)
        prev = bpy.context.preferences.edit.keyframe_new_interpolation_type
        try:
            bpy.context.preferences.edit.keyframe_new_interpolation_type = 'CONSTANT'
            bp.hide_viewport = True
            bp.hide_render = True
            bp.keyframe_insert(data_path='hide_viewport', frame=1)
            bp.keyframe_insert(data_path='hide_render', frame=1)
            bp.hide_viewport = False
            bp.hide_render = False
            bp.keyframe_insert(data_path='hide_viewport', frame=F_UNDERLAY)
            bp.keyframe_insert(data_path='hide_render', frame=F_UNDERLAY)
            bp.keyframe_insert(data_path='hide_viewport', frame=bp_fade_out - 4)
            bp.keyframe_insert(data_path='hide_render', frame=bp_fade_out - 4)
            bp.hide_viewport = True
            bp.hide_render = True
            bp.keyframe_insert(data_path='hide_viewport', frame=bp_fade_out)
            bp.keyframe_insert(data_path='hide_render', frame=bp_fade_out)
        finally:
            bpy.context.preferences.edit.keyframe_new_interpolation_type = prev

        out.append(bp)
    return out


def build_glass_orbs():
    """Floating dark-glassmorphic orbs scattered around the cottage —
    decorative aesthetic elements that reinforce the brand. Refract
    light from the gold particles + cottage gold lines, soft-glow
    bokeh at low f-stops in the close-up shots.

    Hand-placed (not random) so the composition is balanced — none
    block the cottage from any of the camera positions, and a couple
    sit close to the early camera path to bokeh-blur into foreground
    sparkle in the opening DOF-tight frames."""
    out = []
    orb_glass = make_glass_mat('OrbGlass', COLOR_WALLS, roughness=0.08, ior=1.45, transmission=0.92)

    # (x, y, z, radius)
    orbs = [
        # Foreground orbs — between camera and cottage at start.
        # Heavy DOF blur during close-up = bokeh sparkle.
        (-RUN - 1.0, -HOUSE_D * 0.55, RIDGE_Z + 1.2,  0.32),
        (-RUN - 0.6, -HOUSE_D * 0.35, RIDGE_Z + 0.4,  0.22),
        # Mid-distance orbs — visible during pull-back.
        (-RUN - 4.0, -HOUSE_D * 1.3,  3.0,            0.85),
        ( RUN + 4.0,   HOUSE_D * 0.6, 1.8,            1.05),
        # Behind-the-cottage orbs — visible from hero pose.
        ( 1.5,        HOUSE_D * 1.3,  1.1,            0.65),
        (-1.0,        HOUSE_D + 4.0,  3.5,            0.95),
    ]

    for i, (x, y, z, r) in enumerate(orbs):
        bpy.ops.mesh.primitive_uv_sphere_add(
            location=(x, y, z), radius=r, segments=24, ring_count=16,
        )
        o = bpy.context.active_object
        o.name = f'GlassOrb_{i}'
        for poly in o.data.polygons:
            poly.use_smooth = True
        o.data.materials.append(orb_glass)
        out.append(o)

    return out


# ============================================================
# ANIMATION SEQUENCING
# ============================================================
def animate_install(decks, underlays, shingles_by_course, ridge_caps):
    for d in decks:
        keyframe_pop_in(d, F_DECK)
    for u in underlays:
        keyframe_pop_in(u, F_UNDERLAY)

    n_courses = len(shingles_by_course)
    total_install_span = max(1, F_COURSE_N - F_COURSE_0)
    # Each course gets a TIGHT BURST window — tiles in one course drop
    # in within a quick 5-frame stagger, then a brief pause before the
    # next course starts. Reads as deliberate craftsmanship cadence
    # (a roofer laying one course, stepping back, laying the next)
    # rather than a uniform shower of tiles.
    span_per_course = max(2, total_install_span // n_courses)
    burst_window = max(2, span_per_course // 3)

    for c, course in enumerate(shingles_by_course):
        course_start = F_COURSE_0 + c * span_per_course
        for i, sh in enumerate(course):
            # Tight stagger within the course
            f_within = int((i / max(1, len(course) - 1)) * burst_window)
            f = course_start + f_within
            side = 'left' if 'left' in sh.name else 'right'
            keyframe_tile_drop_in(
                sh,
                final_loc=tuple(sh.location),
                final_rot=tuple(sh.rotation_euler),
                frame=f,
                side=side,
            )

    # Ridge cap install — wave front-to-back along the ridge so the
    # finishing touch reads as deliberate, not a bulk pop. Spread the
    # ridge cap arrivals over ~0.4s.
    ridge_wave_span = max(2, int(FPS * 0.4))
    n_ridge = max(1, len(ridge_caps))
    for i, r in enumerate(ridge_caps):
        f = F_RIDGE + int((i / n_ridge) * ridge_wave_span)
        keyframe_pop_in(r, f)


def build_install_flashes(count=30):
    """Brief gold emission flashes scattered across the install
    timeline at random tile positions. Each flash is a tiny gold-emit
    sphere visible for 4 frames, simulating the moment a tile is
    seated — like a quick spark of light at the placement point.

    Spawned deterministically (seeded RNG) at random points along the
    front-left + front-right slope surfaces, with timing distributed
    across the install window.
    """
    out = []
    flash_mat = make_emissive_mat('FlashSpark', COLOR_GOLD, strength=60.0)
    rng = random.Random(404)

    for i in range(count):
        # Random course + slot inside the slope
        c = rng.randint(0, COURSES_PER_SLOPE - 1)
        slot = rng.randint(0, SHINGLES_PER_COURSE - 1)
        side = rng.choice(['left', 'right'])
        loc, rot = shingle_world_pos(side, c, slot)
        # Lift slightly above the slope surface
        nx = -SIN_P if side == 'left' else SIN_P
        nz = COS_P
        spark_offset = 0.05
        loc = (loc[0] + nx * spark_offset, loc[1], loc[2] + nz * spark_offset)

        bpy.ops.mesh.primitive_uv_sphere_add(
            location=loc, radius=0.04, segments=8, ring_count=6,
        )
        s = bpy.context.active_object
        s.name = f'Flash_{i}'
        s.data.materials.append(flash_mat)
        for poly in s.data.polygons:
            poly.use_smooth = True

        # Distribute the flash time across the install window
        t = (i + 0.5) / count
        flash_frame = int(F_COURSE_0 + t * (F_COURSE_N - F_COURSE_0))
        flash_duration = 4

        # Hidden, then visible for 4 frames, then hidden
        prev = bpy.context.preferences.edit.keyframe_new_interpolation_type
        try:
            bpy.context.preferences.edit.keyframe_new_interpolation_type = 'CONSTANT'
            s.hide_viewport = True
            s.hide_render = True
            s.keyframe_insert(data_path='hide_viewport', frame=1)
            s.keyframe_insert(data_path='hide_render', frame=1)
            s.hide_viewport = False
            s.hide_render = False
            s.keyframe_insert(data_path='hide_viewport', frame=flash_frame)
            s.keyframe_insert(data_path='hide_render', frame=flash_frame)
            s.hide_viewport = True
            s.hide_render = True
            s.keyframe_insert(data_path='hide_viewport', frame=flash_frame + flash_duration)
            s.keyframe_insert(data_path='hide_render', frame=flash_frame + flash_duration)
        finally:
            bpy.context.preferences.edit.keyframe_new_interpolation_type = prev

        out.append(s)
    return out


# ============================================================
# CINEMATIC CAMERA — drone path with depth of field
# ============================================================
def build_camera():
    """Drone-style move:
       Frame 1     low + close, skimming over the front-left slope shingles
       Frame 60    starting to pull back as more courses lay
       Frame 144   mid-altitude orbit revealing the cottage
       Frame 240   high pull-back showing the full cottage
       Frame 288   cinematic hero pose, golden lines glowing

       Depth of field tightens the focus on the shingles at the start
       and gradually widens to keep the cottage in soft focus at the end.
    """
    bpy.ops.object.camera_add()
    cam = bpy.context.active_object
    cam.name = 'CinematicCam'
    bpy.context.scene.camera = cam

    # Enable depth of field — Cycles renders true bokeh
    cam.data.dof.use_dof = True
    cam.data.dof.aperture_fstop = 1.8  # shallow, will widen at end

    # Drone path — opens HIGH and CLOSE above the roof tiles (top-down)
    # and slowly orbits + pulls back. Key fix from the previous version:
    # frame 1 is now nearly directly above the slope, looking down, so
    # the opening clearly reads as "drone over a tile roof."
    front_left_tile_zone = (-RUN * 0.6, -HOUSE_D * 0.05, WALL_Z + RISE * 0.55)
    mid_slope_target     = (-RUN * 0.3,  HOUSE_D * 0.05, WALL_Z + RISE * 0.6)
    ridge_mid = (0, 0, RIDGE_Z - 0.2)
    cottage_center = (0, 0, WALL_Z * 0.9)

    poses = [
        # (frame_pct, loc, target, lens_mm, fstop, focus_dist)
        # 0.00–0.35 — LINGER: high + close above the slope. ~3.5s in
        # a 10s preview, ~5.6s in a 16s ship. Eye reads tile detail.
        (0.00, (-RUN * 0.4, -HOUSE_D * 0.20, RIDGE_Z + 1.6),  front_left_tile_zone, 55, 2.4, 1.6),
        (0.20, (-RUN * 0.5, -HOUSE_D * 0.28, RIDGE_Z + 1.8),  front_left_tile_zone, 52, 2.6, 2.0),
        (0.35, (-RUN * 0.7, -HOUSE_D * 0.42, RIDGE_Z + 2.2),  mid_slope_target,     50, 2.8, 2.8),
        # 0.35–0.58 — pull back; ridge enters frame.
        (0.58, (-RUN - 2.2, -HOUSE_D * 1.05, RIDGE_Z + 3.2),  ridge_mid,            45, 3.5, 6.8),
        # 0.58–0.78 — wider, hero pose forming.
        (0.78, (-RUN - 6.0, -HOUSE_D * 1.5,  RIDGE_Z + 4.5),  cottage_center,       35, 4.0, 11.0),
        # 0.78–0.92 — HERO HOLD: ~1.4s preview / ~2.2s ship. Camera
        # barely drifts. Long enough for the cottage + blueprint + title
        # to register as a single composed image.
        (0.92, (-RUN - 6.4, -HOUSE_D * 1.5,  RIDGE_Z + 4.7),  cottage_center,       35, 4.0, 11.3),
        # 0.92–1.00 — RISE: cottage shrinks into the void in the final
        # 8% of the timeline (~0.8s preview / ~1.3s ship). Quick
        # poetic ascent before the loop wraps.
        (1.00, (-RUN - 2.0, -HOUSE_D * 0.7,  RIDGE_Z + 26.0), cottage_center,       28, 5.6, 30.0),
    ]
    poses = [(max(1, int(pct * TOTAL_F)), *rest) for pct, *rest in poses]

    for frame, loc, target, lens, fstop, focus in poses:
        cam.location = loc
        cam.rotation_euler = look_at_euler(loc, target)
        cam.data.lens = lens
        cam.data.dof.aperture_fstop = fstop
        cam.data.dof.focus_distance = focus
        cam.keyframe_insert(data_path='location', frame=frame)
        cam.keyframe_insert(data_path='rotation_euler', frame=frame)
        cam.data.keyframe_insert(data_path='lens', frame=frame)
        cam.data.dof.keyframe_insert(data_path='aperture_fstop', frame=frame)
        cam.data.dof.keyframe_insert(data_path='focus_distance', frame=frame)


# ============================================================
# CINEMATIC LIGHTING — black void with gold rim + cool key
# ============================================================
def build_lights():
    """Dark studio look: minimal lighting so the gold architectural
    lines + bevel highlights are the primary visual anchors. The cottage
    floats in a black void."""

    # Chiaroscuro key — near-white, harder edges. The previous warm
    # tint was bathing the whole frame in amber. Now: bright white-ish
    # key from camera-side gives sharp specular on the tile arches +
    # deep shadows on the slope's far side. Tile detail reads as
    # dimensional sculpture, not soft-lit photo.
    bpy.ops.object.light_add(type='AREA', location=(-12, -10, 10))
    key = bpy.context.active_object
    key.name = 'Key_Chiaroscuro'
    key.data.energy = 520
    key.data.color = (1.0, 0.99, 0.94)   # near-white, hint of warm only
    key.data.size = 4                     # smaller area = sharper shadows
    key.rotation_euler = look_at_euler(key.location, (0, 0, RIDGE_Z * 0.5))

    # Gold rim — small intense warm light from BEHIND the cottage. Edges
    # of the structure pick it up as a thin gold glow that matches the
    # architectural lines tonally. Brand signature.
    bpy.ops.object.light_add(type='AREA', location=(8, 12, 7))
    rim = bpy.context.active_object
    rim.name = 'Rim_Gold'
    rim.data.energy = 380
    rim.data.color = (1.0, 0.75, 0.40)   # warm gold
    rim.data.size = 4
    rim.rotation_euler = look_at_euler(rim.location, (0, 0, RIDGE_Z * 0.6))

    # Subtle gold uplight on the ground plane right beneath the cottage —
    # makes the polished floor glow gold from underneath, ethereal.
    bpy.ops.object.light_add(type='AREA', location=(0, 0, 0.12))
    up = bpy.context.active_object
    up.name = 'Underglow_Gold'
    up.data.energy = 18
    up.data.color = (1.0, 0.78, 0.40)
    up.data.size = 9
    up.rotation_euler = (0, 0, 0)        # facing up

    # World — near-black with a very soft warm gradient toward the
    # horizon (visible only in glass-orb reflections + slight ambient
    # warmth on the cottage). Uses a Gradient texture in the world
    # nodes; output strength is tiny (0.05) so the void still dominates.
    world = bpy.context.scene.world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links

    bg = nodes['Background']
    bg.location = (300, 0)
    bg.inputs['Strength'].default_value = 0.008  # near-black void

    # Texture coord (Generated) -> Mapping -> Gradient -> ColorRamp -> Background
    tex_coord = nodes.new('ShaderNodeTexCoord')
    tex_coord.location = (-1100, 0)
    mapping = nodes.new('ShaderNodeMapping')
    mapping.location = (-900, 0)
    grad = nodes.new('ShaderNodeTexGradient')
    grad.location = (-650, 0)
    grad.gradient_type = 'SPHERICAL'
    cr = nodes.new('ShaderNodeValToRGB')
    cr.location = (-400, 0)
    cr.color_ramp.elements[0].position = 0.0
    cr.color_ramp.elements[0].color = (0.0, 0.0, 0.0, 1.0)        # void
    cr.color_ramp.elements[1].position = 1.0
    cr.color_ramp.elements[1].color = (0.85, 0.55, 0.22, 1.0)     # warm gold horizon

    links.new(tex_coord.outputs['Generated'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], grad.inputs['Vector'])
    links.new(grad.outputs['Color'], cr.inputs['Fac'])
    links.new(cr.outputs['Color'], bg.inputs['Color'])

    # GOD RAY spot light — strong spot from above the cottage casting
    # downward through the fog. Combined with volumetric scatter in the
    # ground fog, the spot's cone becomes visible as warm light beams.
    # God-ray spot — without fog there's no medium for visible beams,
    # so this becomes a soft topdown accent light instead. Reduced to
    # 60W and widened cone so it just gently lights the cottage roof
    # from above without hot-spotting.
    bpy.ops.object.light_add(type='SPOT', location=(-3, -2, RIDGE_Z + 14))
    god = bpy.context.active_object
    god.name = 'TopAccent'
    god.data.energy = 60
    god.data.color = (1.0, 0.92, 0.78)
    god.data.spot_size = math.radians(60)
    god.data.spot_blend = 0.85
    god.data.shadow_soft_size = 2.0
    god.rotation_euler = look_at_euler(god.location, (0, 0, RIDGE_Z * 0.4))

    # Slow rotation across timeline — beams sweep gently over the scene
    god.rotation_euler = look_at_euler(god.location, (0, 0, RIDGE_Z * 0.4))
    god.keyframe_insert(data_path='rotation_euler', frame=1)
    god.rotation_euler = look_at_euler((-2, -1, RIDGE_Z + 14), (1, 0.5, RIDGE_Z * 0.4))
    god.keyframe_insert(data_path='rotation_euler', frame=TOTAL_F)


# ============================================================
# RENDER SETTINGS — PNG sequence (Blender 5.x dropped FFMPEG output)
# ============================================================
def setup_render():
    sc = bpy.context.scene
    # Allow resuming an interrupted render via env var RESUME_FROM=N.
    # Useful when Blender is killed mid-animation; existing frame_NNNN.png
    # files stay on disk so we just restart from the next frame.
    resume_from = int(os.environ.get('RESUME_FROM', '0'))
    sc.frame_start = max(1, resume_from)
    sc.frame_end = TOTAL_F
    sc.render.fps = FPS
    sc.render.resolution_x = RES_W
    sc.render.resolution_y = RES_H
    sc.render.resolution_percentage = 100

    # Always Cycles for headless reliability + DOF + emission glow
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    try:
        sc.cycles.preview_samples = 16
    except AttributeError:
        pass
    # Light-path settings scale with SHIP_MODE — preview lean, ship rich.
    sc.cycles.max_bounces = LIGHT_BOUNCES
    sc.cycles.diffuse_bounces = 3 if SHIP_MODE else 2
    sc.cycles.glossy_bounces = 6 if SHIP_MODE else 4
    sc.cycles.transmission_bounces = 6 if SHIP_MODE else 4
    sc.cycles.volume_bounces = 0  # no fog — skip volume sampling entirely for speed

    # Caustics — gold light refracted through glass orbs lands as
    # caustic patterns on the water below. Cycles classic caustics
    # toggles (legacy MIS controls) — enable both reflective and
    # refractive so the orbs cast caustic light reliably.
    if hasattr(sc.cycles, 'caustics_reflective'):
        sc.cycles.caustics_reflective = True
    if hasattr(sc.cycles, 'caustics_refractive'):
        sc.cycles.caustics_refractive = True

    # Color management — cinematic AgX (or fall back to Filmic on older 5.x)
    try:
        sc.view_settings.view_transform = 'AgX'
    except (TypeError, AttributeError):
        sc.view_settings.view_transform = 'Filmic'
    sc.view_settings.look = 'AgX - Medium High Contrast' if sc.view_settings.view_transform == 'AgX' else 'Medium High Contrast'

    # PNG sequence — frame_0001.png, frame_0002.png, ...
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.compression = 15
    sc.render.filepath = OUTPUT_DIR + 'frame_'

    # Camera motion blur for cinematic feel — moved across Blender versions:
    #   3.x-4.x: sc.cycles.motion_blur_position
    #   5.x+:    sc.render.motion_blur_position
    # Try both. If neither exists (old Blender, different engine), motion
    # blur still toggles on via use_motion_blur, just with default settings.
    sc.render.use_motion_blur = True
    for target in (sc.render, sc.cycles):
        if hasattr(target, 'motion_blur_position'):
            try:
                target.motion_blur_position = 'CENTER'
                break
            except (AttributeError, TypeError):
                continue


# ============================================================
# MAIN
# ============================================================
def main():
    try:
        prev_interp = bpy.context.preferences.edit.keyframe_new_interpolation_type
    except AttributeError:
        prev_interp = None
    set_constant_interpolation()

    clear_scene()

    build_ground()
    build_walls()
    build_gables()

    decks = [build_deck('left'), build_deck('right')]
    underlays = [build_underlay('left'), build_underlay('right')]

    # Build the barrel tile mesh ONCE + attach the high-fidelity clay
    # shader (per-instance color variation via Object Info > Random,
    # clay-grit bump via procedural noise). One mesh in memory, ~1500
    # transformed instances on screen, but each instance reads as a
    # subtly different shade of fired terracotta.
    tile_mesh = build_tile_mesh()
    tile_mat = make_clay_tile_material(
        'ClayTile',
        base_dark=COLOR_TILE_DARK,
        base_mid=COLOR_TILE_MID,
        base_light=COLOR_TILE_LIGHT,
    )
    tile_mesh.materials.append(tile_mat)

    courses = [[] for _ in range(COURSES_PER_SLOPE)]
    for c in range(COURSES_PER_SLOPE):
        for slot in range(SHINGLES_PER_COURSE):
            courses[c].append(build_shingle('left', c, slot, tile_mesh))
            courses[c].append(build_shingle('right', c, slot, tile_mesh))

    ridge = build_ridge_cap()
    chimney = build_chimney()
    drip = build_drip_edge()
    gold = build_gold_lines()
    # Fog disabled — volume scatter was the bottleneck (~30s/frame).
    # Without it, the void stays purer black + render speed roughly
    # halves. Loses the visible god-ray beam effect, gains chiaroscuro
    # contrast.
    fog = []
    interior = build_interior_glow()
    gold_particles = build_gold_particles(count=80)
    # Glass orbs removed — they read as flat black circles in the void
    # rather than translucent reflective spheres. Decorative element
    # cut in favor of a denser specular-dust field.
    blueprint = build_blueprint()
    # Install flashes removed — the 4-frame visibility popups were
    # creating perceptible flicker / jitter in the playback. Tile
    # drop-in animation alone carries the install rhythm.
    flashes = []

    animate_install(decks, underlays, courses, ridge)

    build_camera()
    build_lights()
    setup_render()

    total_objs = (
        sum(len(c) for c in courses)
        + len(decks) + len(underlays) + len(ridge)
        + len(chimney) + len(drip) + len(gold)
        + len(gold_particles)
        + len(blueprint) + len(flashes)
        + 7  # walls + 2 gables + ground + fog + interior light + god ray spot
    )
    print(f"\nScene built. {total_objs} objects, {COURSES_PER_SLOPE} courses, {TOTAL_F} frames.")

    if bpy.app.background:
        # GPU if available
        try:
            prefs = bpy.context.preferences.addons['cycles'].preferences
            prefs.compute_device_type = 'CUDA'
            prefs.get_devices()
            bpy.context.scene.cycles.device = 'GPU'
            print("  Cycles device: GPU (CUDA)")
        except Exception as e:
            bpy.context.scene.cycles.device = 'CPU'
            print(f"  Cycles device: CPU (no CUDA: {e})")

        print(f"\nHeadless mode: rendering PNG sequence to {OUTPUT_DIR}\n")
        bpy.ops.render.render(animation=True)
        print(f"\nRender complete. PNG sequence at {OUTPUT_DIR}")
        print(f"Combine with:  ffmpeg -framerate {FPS} -i {OUTPUT_DIR}frame_%04d.png "
              f"-c:v libx264 -pix_fmt yuv420p -crf 18 "
              f"C:/BEITBUILDING/website/public/videos/roof-install.mp4\n")

    if prev_interp is not None:
        try:
            bpy.context.preferences.edit.keyframe_new_interpolation_type = prev_interp
        except AttributeError:
            pass


main()
