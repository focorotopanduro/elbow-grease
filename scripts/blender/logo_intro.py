"""
BEIT BUILDING CONTRACTORS — 3D LOGO INTRO
==========================================

A short cinematic intro for the homepage:
  • Imports the hand-traced logo SVG (chevrons + crest paths)
  • Extrudes each path into 3D metallic geometry
  • Stacks chevrons at different Z depths for parallax
  • Cinematic camera dolly: far/dark → close/lit
  • Gold particle vortex around the logo (optional)
  • Black void background → ends fading into transparent for HTML overlay

OUTPUT:
  PNG sequence to scripts/blender/logo_intro_frames/, then ffmpeg combines
  with the cinematic post-process pipeline (bloom + grade + vignette +
  grain + fades) to public/videos/logo-intro.mp4.

USAGE — HEADLESS (recommended):
  blender --background --python logo_intro.py
  (set SHIP=1 for 4K ship render)
"""

import bpy
import math
import os
import random
from mathutils import Vector

random.seed(42)

SHIP_MODE = os.environ.get('SHIP', '').lower() in ('1', 'true', 'yes')

# ============================================================
# PARAMETERS
# ============================================================
SVG_PATH = "C:/BEITBUILDING/website/scripts/blender/assets/logo.svg"

FPS = 24
USE_PARTICLES = True

if SHIP_MODE:
    DURATION_S    = 6
    RES_W, RES_H  = 3840, 2160
    SAMPLES       = 96
    OUTPUT_DIR    = "C:/BEITBUILDING/website/scripts/blender/ship/logo_frames/"
else:
    DURATION_S    = 5
    RES_W, RES_H  = 1280, 720
    SAMPLES       = 24
    OUTPUT_DIR    = "C:/BEITBUILDING/website/scripts/blender/preview/logo_frames/"

TOTAL_F = FPS * DURATION_S

# Materials — DEEPER gold for higher saturation. Pure-gold reflectance
# is technically (1.0, 0.78, 0.36), but in a Cycles render with warm-
# white lights + AgX color management, that reads as off-white. Pushing
# the base toward (1.0, 0.55, 0.12) gives the rendered metal an
# unmistakably "gold" cast even after color science transforms.
COLOR_GOLD     = (1.000, 0.560, 0.120)
COLOR_SILVER   = (0.880, 0.900, 0.920)

# Y-depth stacking for parallax (Y axis = depth into scene after the
# X rotation that stands the logo up). Camera is at NEGATIVE Y and
# looks toward +Y. So:
#   Y < 0  → CLOSER to camera (foreground)
#   Y > 0  → FARTHER from camera (background)
#
# Outer chevron is the FRONTMOST element; crest sits deepest BEHIND.
Y_OUTER   = -0.40    # closest to camera (front)
Y_MIDDLE  = -0.20
Y_INNER   =  0.00
Y_CREST   =  0.30    # silver crest deepest behind chevrons

# Extrude depth per path (how thick each layer is)
EXTRUDE_DEPTH = 0.10
BEVEL_DEPTH   = 0.008


# ============================================================
# HELPERS
# ============================================================
def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for col in [bpy.data.materials, bpy.data.meshes, bpy.data.lights,
                bpy.data.cameras, bpy.data.curves]:
        for item in list(col):
            col.remove(item)


def make_metal_mat(name, color, roughness=0.18, anisotropy=0.5):
    """Brushed-metal Principled BSDF — metallic + low roughness +
    anisotropic so the chevron edges catch reflective streaks like
    real polished gold/silver."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = 1.0
    bsdf.inputs['Roughness'].default_value = roughness
    if 'Anisotropic' in bsdf.inputs:
        bsdf.inputs['Anisotropic'].default_value = anisotropy
    if 'Anisotropic Rotation' in bsdf.inputs:
        bsdf.inputs['Anisotropic Rotation'].default_value = 0.25
    return m


def make_emissive_mat(name, color, strength):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
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


def look_at_euler(camera_loc, target_loc):
    direction = Vector(target_loc) - Vector(camera_loc)
    return direction.to_track_quat('-Z', 'Y').to_euler()


# ============================================================
# IMPORT + EXTRUDE THE LOGO SVG
# ============================================================
def import_logo():
    """Imports the SVG, returns dict of named curve objects.

    Blender's SVG importer (Curves > Scalable Vector Graphics .svg)
    creates one Curve object per path. Path IDs from the SVG file
    become object names — that's why our SVG uses id="chevron-outer"
    etc., so we can find + reposition each layer programmatically.
    """
    # Track existing objects so we can identify NEW ones from import
    existing = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=SVG_PATH)
    imported = [o for o in bpy.data.objects if o not in existing]

    # CRITICAL: Blender's SVG importer creates 2D curves by default.
    # 2D curves can't be Z-extruded, can't have rotations applied, and
    # can't be repositioned in Z. Convert each to 3D before doing
    # anything else. (This was the reason the first run failed with
    # "Rotation/Location cannot apply to a 2D curve".)
    for o in imported:
        if o.type == 'CURVE':
            o.data.dimensions = '3D'

    # First, measure the actual imported size — Blender's SVG importer
    # has changed scale behavior across versions, so we don't trust a
    # hardcoded multiplier. Compute the current bounding box, then
    # uniformly scale to a target diagonal of ~5 meters (right-sized
    # for a camera at 7-32m distance).
    bpy.context.view_layer.update()
    xs, ys, zs = [], [], []
    for o in imported:
        for v in o.bound_box:
            world = o.matrix_world @ Vector(v)
            xs.append(world.x); ys.append(world.y); zs.append(world.z)
    if xs:
        size_x = max(xs) - min(xs)
        size_y = max(ys) - min(ys)
        size_z = max(zs) - min(zs)
        diagonal = math.sqrt(size_x**2 + size_y**2 + size_z**2)
        TARGET_DIAGONAL = 5.0   # meters
        scale_factor = TARGET_DIAGONAL / max(0.001, diagonal)
        print(f"  SVG imported size: {size_x:.3f} x {size_y:.3f} x {size_z:.3f} m (diag {diagonal:.3f}m)")
        print(f"  Auto-scaling by {scale_factor:.3f}x to {TARGET_DIAGONAL}m diagonal")
    else:
        scale_factor = 1.0

    for o in imported:
        o.scale = (scale_factor, scale_factor, scale_factor)
    bpy.ops.object.select_all(action='DESELECT')
    for o in imported:
        o.select_set(True)
    bpy.ops.object.transform_apply(scale=True)

    # Recenter on origin AFTER scaling
    bpy.context.view_layer.update()
    xs, ys, zs = [], [], []
    for o in imported:
        for v in o.bound_box:
            world = o.matrix_world @ Vector(v)
            xs.append(world.x); ys.append(world.y); zs.append(world.z)
    if xs:
        cx = (min(xs) + max(xs)) / 2
        cy = (min(ys) + max(ys)) / 2
        cz = (min(zs) + max(zs)) / 2
        for o in imported:
            o.location.x -= cx
            o.location.y -= cy
            o.location.z -= cz
        print(f"  Recentered on origin from offset ({cx:.3f}, {cy:.3f}, {cz:.3f})")

    # ROTATE -90° around X so the logo stands up upright facing the
    # -Y direction (camera sits on the -Y axis). The SVG importer
    # already FLIPS the Y axis (SVG y-down → Blender y-up), so a +90°
    # rotation would put the logo upside down. -90° preserves the
    # natural up-orientation: chevron apex stays at top.
    # After rotation: X = horizontal, Z = vertical, Y = depth.
    for o in imported:
        o.rotation_euler.x = math.radians(-90)
    bpy.ops.object.select_all(action='DESELECT')
    for o in imported:
        o.select_set(True)
    bpy.ops.object.transform_apply(rotation=True)
    print("  Rotated 90° around X to stand logo upright facing -Y")

    # Map by name for downstream styling. SVG path IDs become
    # Blender object names (with possible numeric suffixes).
    by_name = {}
    for o in imported:
        # Blender may suffix duplicates like "chevron-outer.001"; strip
        base = o.name.split('.')[0]
        by_name.setdefault(base, []).append(o)

    return by_name, imported


def style_logo(by_name):
    """Apply 3D extrude + materials + Y-depth offsets per path group."""
    # Tighter roughness (0.08) for sharper, more recognizable gold
    # reflections. Anisotropic stays at 0.5 for the brushed-metal sheen.
    gold_mat = make_metal_mat('LogoGold', COLOR_GOLD, roughness=0.08)
    silver_mat = make_metal_mat('LogoSilver', COLOR_SILVER, roughness=0.10)

    # Parallax depth assignments (Y values) — outer is FRONTMOST,
    # crest is DEEPEST. Camera looks down +Y so smaller Y = closer.
    layer_depths = {
        'chevron-outer':       Y_OUTER,
        'chevron-middle':      Y_MIDDLE,
        'chevron-inner':       Y_INNER,
        'crest-crown':         Y_CREST,
        'crest-column-center': Y_CREST + 0.05,
        'crest-column-right':  Y_CREST + 0.05,
        'crest-column-left':   Y_CREST + 0.05,
        'crest-crossbar':      Y_CREST + 0.03,
    }

    for name, objs in by_name.items():
        for obj in objs:
            if obj.type != 'CURVE':
                continue
            # Extrude — gives the curve thickness along its local Z
            # (which after the 90° X-rotation becomes world Y, the
            # depth axis). Net effect: each chevron gets thickness
            # going INTO the scene, perfect for layered parallax.
            obj.data.extrude = EXTRUDE_DEPTH
            obj.data.bevel_depth = BEVEL_DEPTH
            obj.data.bevel_resolution = 2
            # Blender 5.1 renamed the fill_mode enum — 'BOTH' is gone,
            # 'FULL' is its replacement (caps both ends of the extrude).
            obj.data.fill_mode = 'FULL'

            # Apply material based on path id
            if name.startswith('crest'):
                obj.data.materials.append(silver_mat)
            else:
                obj.data.materials.append(gold_mat)

            # Depth offset along Y for parallax
            if name in layer_depths:
                obj.location.y = layer_depths[name]


# ============================================================
# CAMERA DOLLY: far/dark → close/lit
# ============================================================
def build_camera():
    bpy.ops.object.camera_add()
    cam = bpy.context.active_object
    cam.name = 'IntroCam'
    bpy.context.scene.camera = cam

    cam.data.dof.use_dof = True
    cam.data.dof.aperture_fstop = 2.8

    # Drone-style dolly: starts FAR + slightly above, looking down at
    # the logo center. Pulls IN + SETTLES at hero distance.
    target = (0, 0, 0)

    # Camera Z values are NEAR-ZERO so the camera is roughly LEVEL with
    # the logo center (logo spans -2.5 to +2.5 in Z after the X
    # rotation). Was Z=4.5 at start — that put the camera looking
    # DOWN at the logo, dropping it to the bottom of the frame.
    poses = [
        # (frame_pct, loc, lens_mm, fstop, focus_dist)
        # 0.00 — far, level, dark composition
        (0.00, (0, -32, 1.0),  85, 1.4, 32.0),
        # 0.40 — pulling in
        (0.40, (0, -18, 0.6),  60, 2.0, 18.0),
        # 0.75 — close, dramatic
        (0.75, (0,  -8, 0.2),  45, 2.6,  8.0),
        # 1.00 — final hero hold, slight settle
        (1.00, (0,  -7, 0.0),  42, 3.0,  7.0),
    ]
    for pct, loc, lens, fstop, focus in poses:
        f = max(1, int(pct * TOTAL_F))
        cam.location = loc
        cam.rotation_euler = look_at_euler(loc, target)
        cam.data.lens = lens
        cam.data.dof.aperture_fstop = fstop
        cam.data.dof.focus_distance = focus
        cam.keyframe_insert(data_path='location', frame=f)
        cam.keyframe_insert(data_path='rotation_euler', frame=f)
        cam.data.keyframe_insert(data_path='lens', frame=f)
        cam.data.dof.keyframe_insert(data_path='aperture_fstop', frame=f)
        cam.data.dof.keyframe_insert(data_path='focus_distance', frame=f)


# ============================================================
# LIGHTING: cool key + warm rim, against black void
# ============================================================
def build_lights():
    # ALL LIGHT INTENSITIES dropped from previous values. Reason: at
    # the previous brightness, every metal surface was hitting the
    # AgX/Filmic highlight roll-off and getting desaturated to white.
    # Lower values keep gold reflections in the saturation-preserved
    # zone of the tone-map curve.

    # KEY — full gold tint
    bpy.ops.object.light_add(type='AREA', location=(-6, -8, 6))
    key = bpy.context.active_object
    key.name = 'Key'
    key.data.energy = 180   # was 350
    key.data.color = (1.0, 0.82, 0.48)
    key.data.size = 5
    key.rotation_euler = look_at_euler(key.location, (0, 0, 0))

    # RIM — deep saturated gold
    bpy.ops.object.light_add(type='AREA', location=(4, 8, 5))
    rim = bpy.context.active_object
    rim.name = 'Rim'
    rim.data.energy = 700   # was 1400
    rim.data.color = (1.0, 0.65, 0.22)
    rim.data.size = 4
    rim.rotation_euler = look_at_euler(rim.location, (0, 0, 0))

    # COOL ACCENT — for silver crest chromatic break
    bpy.ops.object.light_add(type='AREA', location=(5, -4, -2))
    accent = bpy.context.active_object
    accent.name = 'Accent'
    accent.data.energy = 180   # was 350
    accent.data.color = (0.62, 0.78, 1.0)
    accent.data.size = 4
    accent.rotation_euler = look_at_euler(accent.location, (0, 0, 0))

    # GOLD UPLIGHT — bottom-glow
    bpy.ops.object.light_add(type='AREA', location=(0, -2, -4))
    up = bpy.context.active_object
    up.name = 'GoldUp'
    up.data.energy = 120   # was 250
    up.data.color = (1.0, 0.74, 0.32)
    up.data.size = 6
    up.rotation_euler = (0, 0, 0)

    # WORLD — subtle gold-gradient sky for metal to reflect.
    # Pure black world means metal reflects nothing, and the only
    # gold contribution comes from light highlights — which AgX
    # then desaturates to white. With a gold-tinted gradient world,
    # the metal's reflections always have a baseline gold cast,
    # preserving the brand color even in tone-mapped highlights.
    world = bpy.context.scene.world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links

    bg = nodes['Background']
    bg.location = (300, 0)
    bg.inputs['Strength'].default_value = 0.18

    tex_coord = nodes.new('ShaderNodeTexCoord')
    tex_coord.location = (-1000, 0)
    mapping = nodes.new('ShaderNodeMapping')
    mapping.location = (-800, 0)
    grad = nodes.new('ShaderNodeTexGradient')
    grad.location = (-550, 0)
    grad.gradient_type = 'SPHERICAL'
    cr = nodes.new('ShaderNodeValToRGB')
    cr.location = (-300, 0)
    cr.color_ramp.elements[0].position = 0.0
    cr.color_ramp.elements[0].color = (0.02, 0.01, 0.0, 1.0)   # near-black core
    cr.color_ramp.elements[1].position = 1.0
    cr.color_ramp.elements[1].color = (1.0, 0.55, 0.18, 1.0)   # warm gold periphery

    links.new(tex_coord.outputs['Generated'], mapping.inputs['Vector'])
    links.new(mapping.outputs['Vector'], grad.inputs['Vector'])
    links.new(grad.outputs['Color'], cr.inputs['Fac'])
    links.new(cr.outputs['Color'], bg.inputs['Color'])


# ============================================================
# OPTIONAL: gold particle vortex (small, subtle for the intro)
# ============================================================
def build_particles(count=40):
    out = []
    rng = random.Random(7)

    m = bpy.data.materials.new('IntroDust')
    m.use_nodes = True
    nodes = m.node_tree.nodes
    links = m.node_tree.links
    bsdf = nodes['Principled BSDF']

    obj_info = nodes.new('ShaderNodeObjectInfo')
    obj_info.location = (-700, -200)
    multiply = nodes.new('ShaderNodeMath')
    multiply.operation = 'MULTIPLY'
    multiply.location = (-450, -200)
    multiply.inputs[1].default_value = 60.0
    power = nodes.new('ShaderNodeMath')
    power.operation = 'POWER'
    power.location = (-250, -200)
    power.inputs[1].default_value = 2.5
    links.new(obj_info.outputs['Random'], multiply.inputs[0])
    links.new(multiply.outputs[0], power.inputs[0])

    bsdf.inputs['Base Color'].default_value = (0.05, 0.04, 0.02, 1.0)
    bsdf.inputs['Metallic'].default_value = 1.0
    bsdf.inputs['Roughness'].default_value = 0.06
    if 'Emission Color' in bsdf.inputs:
        bsdf.inputs['Emission Color'].default_value = (1.0, 0.78, 0.36, 1.0)
    if 'Emission Strength' in bsdf.inputs:
        links.new(power.outputs[0], bsdf.inputs['Emission Strength'])

    for i in range(count):
        r = rng.uniform(3.5, 8.0)
        a0 = rng.uniform(0, 2 * math.pi)
        z = rng.uniform(-2.5, 3.0)
        x0 = r * math.cos(a0)
        y0 = r * math.sin(a0)
        size = rng.uniform(0.025, 0.06)

        bpy.ops.mesh.primitive_uv_sphere_add(
            location=(x0, y0, z), radius=size, segments=8, ring_count=6,
        )
        p = bpy.context.active_object
        p.name = f'IntroDust_{i}'
        p.data.materials.append(m)
        for poly in p.data.polygons:
            poly.use_smooth = True

        # Slow vortex around the logo
        speed = rng.uniform(0.4, 0.9) * (1 if rng.random() > 0.5 else -1)
        phase = rng.uniform(0, 2 * math.pi)
        for kf, t in [(1, 0.0), (TOTAL_F // 2, 0.5), (TOTAL_F, 1.0)]:
            angle = a0 + speed * t
            offset_z = 0.25 * math.sin(phase + t * 2 * math.pi)
            x = r * math.cos(angle)
            y = r * math.sin(angle)
            p.location = (x, y, z + offset_z)
            p.keyframe_insert(data_path='location', frame=kf)
        out.append(p)
    return out


# ============================================================
# RENDER SETTINGS
# ============================================================
def setup_render():
    sc = bpy.context.scene
    sc.frame_start = 1
    sc.frame_end = TOTAL_F
    sc.render.fps = FPS
    sc.render.resolution_x = RES_W
    sc.render.resolution_y = RES_H
    sc.render.resolution_percentage = 100

    sc.render.engine = 'CYCLES'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 8 if SHIP_MODE else 6
    sc.cycles.glossy_bounces = 6 if SHIP_MODE else 4
    sc.cycles.transmission_bounces = 4
    sc.cycles.volume_bounces = 1

    # Filmic with High Contrast — preserves saturation in highlights
    # better than AgX for stylized brand colors. AgX is photorealistic
    # but desaturates bright reflections to neutral, which kills the
    # gold visual identity. Filmic + High Contrast Look gives punchier
    # mids + more chromatic highlights.
    try:
        sc.view_settings.view_transform = 'Filmic'
        sc.view_settings.look = 'High Contrast'
    except (TypeError, AttributeError):
        try:
            sc.view_settings.view_transform = 'AgX'
        except (TypeError, AttributeError):
            pass

    # Underexpose by 0.5 stop so highlights stay below saturation
    # roll-off threshold. Combined with reduced light intensities,
    # this keeps the gold reflective character readable.
    sc.view_settings.exposure = -0.5

    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.compression = 15
    sc.render.filepath = OUTPUT_DIR + 'frame_'

    sc.render.use_motion_blur = True


# ============================================================
# MAIN
# ============================================================
def main():
    clear_scene()

    by_name, imported = import_logo()
    style_logo(by_name)
    build_camera()
    build_lights()
    if USE_PARTICLES:
        build_particles(count=40)
    setup_render()

    print(f"\nLogo intro scene built: {len(imported)} curves imported, "
          f"{TOTAL_F} frames @ {RES_W}x{RES_H} ({SAMPLES} samples)")
    print(f"Output dir: {OUTPUT_DIR}\n")

    if bpy.app.background:
        try:
            prefs = bpy.context.preferences.addons['cycles'].preferences
            prefs.compute_device_type = 'CUDA'
            prefs.get_devices()
            bpy.context.scene.cycles.device = 'GPU'
        except Exception:
            bpy.context.scene.cycles.device = 'CPU'
        os.makedirs(OUTPUT_DIR, exist_ok=True)
        bpy.ops.render.render(animation=True)
        print(f"\nRender complete. PNG sequence at {OUTPUT_DIR}\n")


main()
