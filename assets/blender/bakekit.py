"""Shared bake kit: materials, geometry helpers, node registry, lights, Cycles, UV unwrap, bake, denoise.

Taken from rowansong.dev assets/blender/desk_bake.py (the desk diorama), so the office is built, lit and
exported the same way and the two rooms look like one world. Scene scripts do `from bakekit import *`.

Coordinates are web coordinates (meters, Y up) converted with W() to Blender (Z up):
web (x, y, z) -> Blender (x, -z, y). The glTF exporter converts back.

Flags (after `--`): <out_dir> --preview --samples N --size N --no-denoise --exposure X --shot=a,b
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = next((a for a in ARGS if not a.startswith("--") and not a.replace(".", "").isdigit()), os.getcwd())
PREVIEW = "--preview" in ARGS
DENOISE = "--no-denoise" not in ARGS


def arg(name, default):
    return int(ARGS[ARGS.index(name) + 1]) if name in ARGS else default


SAMPLES = arg("--samples", 1024)
SIZE = arg("--size", 2048)
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
EXPOSURE = float(ARGS[ARGS.index("--exposure") + 1]) if "--exposure" in ARGS else 4.0  # every light and emitter; matches the web tone mapping


# ---------------------------------------------------------------- coordinates
def W(x, y, z):
    """web position -> Blender"""
    return Vector((x, -z, y))


def WS(w, h, d):
    """web size (x, y, z extents) -> Blender scale"""
    return Vector((w, d, h))


# ---------------------------------------------------------------- colors and materials
def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def rgb(h):
    return tuple(_lin(int(h[i:i + 2], 16) / 255) for i in (1, 3, 5))


def rgba(h):
    return (*rgb(h), 1.0)


def new_mat(name):
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    return m, m.node_tree.nodes, m.node_tree.links, m.node_tree.nodes["Principled BSDF"]


def bump(nodes, links, bsdf, scale, strength, distance=0.0005, stretch=(1, 1, 1)):
    """procedural micro-surface: noise -> bump -> normal"""
    tc = nodes.new("ShaderNodeTexCoord")
    mp = nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = stretch
    nz = nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = scale
    nz.inputs["Detail"].default_value = 6
    bp = nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = strength
    bp.inputs["Distance"].default_value = distance
    links.new(tc.outputs["Object"], mp.inputs["Vector"])
    links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    links.new(nz.outputs["Fac"], bp.inputs["Height"])
    links.new(bp.outputs["Normal"], bsdf.inputs["Normal"])
    return nz


_cache = {}


def plastic(h, rough=0.5, metal=0.0, grain=0.15, name=None):
    key = ("p", h, rough, metal, grain)
    if key in _cache:
        return _cache[key]
    m, nodes, links, b = new_mat(name or f"plastic_{h[1:]}")
    b.inputs["Base Color"].default_value = rgba(h)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if grain:
        bump(nodes, links, b, 900, grain, 0.0002)
    _cache[key] = m
    return m


def brass():
    if "brass" in _cache:
        return _cache["brass"]
    m, nodes, links, b = new_mat("brass")
    b.inputs["Base Color"].default_value = rgba("#c9a465")
    b.inputs["Metallic"].default_value = 1.0
    b.inputs["Roughness"].default_value = 0.32
    bump(nodes, links, b, 400, 0.08, 0.0002, stretch=(1, 30, 1))  # brushed
    _cache["brass"] = m
    return m


def wood():
    """dark lacquered walnut; grain runs along the desk (Blender X)"""
    if "wood" in _cache:
        return _cache["wood"]
    m, nodes, links, b = new_mat("wood")
    tc = nodes.new("ShaderNodeTexCoord")
    mp = nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.25, 22, 22)
    nz = nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 3.0
    nz.inputs["Detail"].default_value = 8
    nz.inputs["Distortion"].default_value = 0.6
    wave = nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "Y"
    wave.inputs["Scale"].default_value = 30
    wave.inputs["Distortion"].default_value = 2.5
    wave.inputs["Detail"].default_value = 3
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "FLOAT"
    mix.inputs[0].default_value = 0.3
    ramp = nodes.new("ShaderNodeValToRGB")
    els = ramp.color_ramp.elements
    els[0].position, els[0].color = 0.2, rgba("#1a100a")
    els[1].position, els[1].color = 0.8, rgba("#3a2414")
    mid = els.new(0.5)
    mid.color = rgba("#26180f")
    links.new(tc.outputs["Object"], mp.inputs["Vector"])
    links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    links.new(tc.outputs["Object"], wave.inputs["Vector"])
    links.new(nz.outputs["Fac"], mix.inputs[2])
    links.new(wave.outputs["Fac"], mix.inputs[3])
    links.new(mix.outputs[0], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.5
    bp = nodes.new("ShaderNodeBump")
    bp.inputs["Strength"].default_value = 0.03
    bp.inputs["Distance"].default_value = 0.0005
    links.new(mix.outputs[0], bp.inputs["Height"])
    links.new(bp.outputs["Normal"], b.inputs["Normal"])
    _cache["wood"] = m
    return m


def fabric():
    if "fabric" in _cache:
        return _cache["fabric"]
    m, nodes, links, b = new_mat("fabric")
    b.inputs["Base Color"].default_value = rgba("#14161c")
    b.inputs["Roughness"].default_value = 0.95
    try:
        b.inputs["Sheen Weight"].default_value = 0.4
    except KeyError:
        pass
    bump(nodes, links, b, 1800, 0.35, 0.0003)
    _cache["fabric"] = m
    return m


def emitter(h, strength, name):
    """emissive part: black base + emission, exported with KHR_materials_emissive_strength"""
    m, nodes, links, b = new_mat(name)
    b.inputs["Base Color"].default_value = (0, 0, 0, 1)
    b.inputs["Emission Color"].default_value = rgba(h)
    b.inputs["Emission Strength"].default_value = strength * EXPOSURE
    return m


# ---------------------------------------------------------------- geometry helpers
COLL = {}


def coll(name):
    if name not in COLL:
        c = bpy.data.collections.new(name)
        scene.collection.children.link(c)
        COLL[name] = c
    return COLL[name]


def link(o, group):
    for c in o.users_collection:
        c.objects.unlink(o)
    coll(group).objects.link(o)
    return o


def mesh_obj(name, bm, material, group):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    coll(group).objects.link(o)
    if material:
        me.materials.append(material)
    return o


def add_bevel(o, width, seg=3, angle=40):
    md = o.modifiers.new("bevel", "BEVEL")
    md.width = width
    md.segments = seg
    md.limit_method = "ANGLE"
    md.angle_limit = math.radians(angle)
    md.harden_normals = True
    md.miter_outer = "MITER_ARC"
    return o


def smooth(o):
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def box(name, size, center, material, group, bev=0.0, seg=3, rot_y=0.0):
    """size and center in web coords; rot_y = rotation about the web Y axis (radians)"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=WS(*size), verts=bm.verts)
    o = mesh_obj(name, bm, material, group)
    o.location = W(*center)
    o.rotation_euler = (0, 0, rot_y)
    if bev:
        add_bevel(o, bev, seg)
        smooth(o)
    return o


def rounded_slab(name, w, h, d, r, center, material, group, seg=6, edge=0.0):
    """box with rounded corners in plan view (web x/z), optional soft bevel on the remaining edges"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=WS(w, h, d), verts=bm.verts)
    vertical = [e for e in bm.edges if abs((e.verts[0].co - e.verts[1].co).normalized().z) > 0.99]
    bmesh.ops.bevel(bm, geom=vertical, offset=r, segments=seg, affect="EDGES", profile=0.5)
    o = mesh_obj(name, bm, material, group)
    o.location = W(*center)
    if edge:
        add_bevel(o, edge, 2, angle=60)
    return smooth(o)


def cyl(name, r, depth, center, material, group, verts=32, axis="y", r2=None, bev=0.0):
    """cylinder along a web axis"""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    o = mesh_obj(name, bm, material, group)
    o.location = W(*center)
    if axis == "z":  # web z = Blender -Y
        o.rotation_euler = (math.pi / 2, 0, 0)
    elif axis == "x":
        o.rotation_euler = (0, math.pi / 2, 0)
    if bev:
        add_bevel(o, bev, 2, angle=50)
    return smooth(o)


def frustum(name, w0, h0, w1, h1, z0, z1, center_xy, material, group, r=0.0):
    """rectangular frustum along web z: (w0 x h0) at z0 -> (w1 x h1) at z1; optional rounded corners"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        front = v.co.y < 0  # Blender -Y = web +z
        z = z1 if front else z0
        w, h = (w1, h1) if front else (w0, h0)
        v.co = Vector((v.co.x * w, -z, v.co.z * h))
    if r:
        depthwise = [e for e in bm.edges if abs((e.verts[0].co - e.verts[1].co).normalized().y) > 0.6]
        bmesh.ops.bevel(bm, geom=depthwise, offset=r, segments=6, affect="EDGES", profile=0.5)
    o = mesh_obj(name, bm, material, group)
    o.location = Vector((center_xy[0], 0, center_xy[1]))
    return smooth(o)


def text(name, body, size, center, material, group, facing="+z", extrude=0.0004, align="CENTER", rot=0.0):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = "CENTER"
    o = bpy.data.objects.new(name, cu)
    coll(group).objects.link(o)
    o.location = W(*center)
    if facing == "+z":
        o.rotation_euler = (math.pi / 2, 0, 0)
    elif facing == "+x":
        o.rotation_euler = (math.pi / 2, rot, math.pi / 2)
    elif facing == "-x":
        o.rotation_euler = (math.pi / 2, rot, -math.pi / 2)
    elif facing == "up":
        o.rotation_euler = (0, 0, rot)  # lying on the floor: rot turns it about the vertical (it was ignored: the door mat, #280)
    cu.materials.append(material)
    return o


def apply_all(o):
    """modifiers + object transform baked into the mesh"""
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target="MESH")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return bpy.context.view_layer.objects.active


def cut(o, cutter):
    """boolean difference, applied; the cutter is removed"""
    md = o.modifiers.new("cut", "BOOLEAN")
    md.operation = "DIFFERENCE"
    md.solver = "EXACT"
    md.object = cutter
    bpy.context.view_layer.objects.active = o
    with bpy.context.temp_override(object=o, active_object=o):
        for m in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cutter)
    return o


def join(name, objs):
    objs = [apply_all(o) for o in objs]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    o.data.name = name
    return o


def neon_loop(name, w, d, r, y, thick, material, group):
    """closed tube along a rounded rectangle (web x/z, w x d, corner r) at height y: a neon strip around a foot"""
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = thick
    curve.bevel_resolution = 2
    sp = curve.splines.new("POLY")
    pts = rounded_rect(w, d, r, 6)
    sp.points.add(len(pts) - 1)
    for p, (x, z) in zip(sp.points, pts):
        p.co = (*W(x, y, z), 1.0)
    sp.use_cyclic_u = True
    o = bpy.data.objects.new(name, curve)
    coll(group).objects.link(o)
    curve.materials.append(material)
    return o


def rounded_rect(w, h, r, n=6):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


# ================================================================ NODE REGISTRY
# Every exported node is tagged through custom properties, which the glTF exporter writes to node extras
# (userData in three.js):  atlas = "<name>"  -> baked, rendered with that atlas
#                          live  = "<kind>"  -> keeps its own material; the app drives it (screen, glass, neon…)
NODES = []


def baked(o, atlas, density=1.0, drop=True):
    o["atlas"] = atlas
    NODES.append({"obj": o, "atlas": atlas, "density": density, "drop": drop})
    return o


def live(o, kind):
    o["live"] = kind
    NODES.append({"obj": o, "live": kind})
    return o


# ---------------------------------------------------------------- more geometry helpers
def Mx(loc=(0, 0, 0), rx=0.0, ry=0.0, rz=0.0):
    """web transform (three.js Euler XYZ: Rx·Ry·Rz) as a Blender matrix.
    web x/y/z rotations map to Blender X / Z / -Y."""
    return (Matrix.Translation(W(*loc)) @ Matrix.Rotation(rx, 4, "X") @ Matrix.Rotation(ry, 4, "Z")
            @ Matrix.Rotation(-rz, 4, "Y"))


def place(objs, M):
    """move objects built in a group's local web frame into the world"""
    objs = objs if isinstance(objs, (list, tuple)) else [objs]
    for o in objs:
        o.matrix_world = M @ o.matrix_basis  # matrix_world is stale until a depsgraph update; basis is not
    return objs


def pivot(o, M):
    """o has world-space vertices; give it the frame M (its origin + axes) so the app can rotate/slide it"""
    o.data.transform(M.inverted())
    o.matrix_world = M
    # meshopt quantization folds a dequantize scale/offset into the node transform; the app uses this
    # (web coordinates) to rebuild a clean pivot frame after loading.
    # Named pivot_at, not pivot: three's GLTFLoader (r187+) treats a node with extras.pivot AND child nodes as a
    # GLTFExporter pivot container — it subtracts the pivot from the node position, zeroes the first child's
    # position and deletes the key. Arms carry a child (the hand grab point), so "pivot" broke them.
    t = M.to_translation()
    o["pivot_at"] = [round(t.x, 5), round(t.z, 5), round(-t.y, 5)]
    return o


def sphere(name, r, center, material, group, scale=(1, 1, 1), half=False, seg=24, rings=12):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    if half:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-6], context="VERTS")
    bmesh.ops.scale(bm, vec=WS(*scale), verts=bm.verts)
    o = mesh_obj(name, bm, material, group)
    o.location = W(*center)
    return smooth(o)


def torus(name, R, r, center, material, group, axis="y", half=False, seg=40, rseg=10):
    """ring around a web axis; half=True keeps the +x half (a mug handle)"""
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg, minor_segments=rseg)
    o = bpy.context.active_object
    o.name = name
    link(o, group)
    if half:
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.x < -1e-6], context="VERTS")
        bm.to_mesh(o.data)
        bm.free()
    o.data.materials.append(material)
    o.location = W(*center)
    if axis == "z":
        o.rotation_euler = (math.pi / 2, 0, 0)
    elif axis == "x":
        o.rotation_euler = (0, math.pi / 2, 0)
    return smooth(o)


def tube(name, r, depth, center, material, group, verts=32):
    """open-ended cylinder along web y (jar walls)"""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=verts, radius1=r, radius2=r, depth=depth)
    o = mesh_obj(name, bm, material, group)
    o.location = W(*center)
    return smooth(o)


def segment(name, a, b, r, material, group, verts=14, r2=None):
    """cylinder between two web points (r at a, r2 at b)"""
    A, B = W(*a), W(*b)
    d = B - A
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=d.length)
    o = mesh_obj(name, bm, material, group)
    o.location = (A + B) / 2
    o.rotation_euler = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    return smooth(o)


def rail(name, pts, r, material, group):
    """round tube along a smooth curve through web points (chair rails, cables)"""
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = r
    curve.bevel_resolution = 3
    curve.resolution_u = 10
    curve.use_fill_caps = True
    sp = curve.splines.new("BEZIER")
    sp.bezier_points.add(len(pts) - 1)
    for bp, p in zip(sp.bezier_points, pts):
        bp.co = W(*p)
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    o = bpy.data.objects.new(name, curve)
    coll(group).objects.link(o)
    curve.materials.append(material)
    return o


def quad(name, w, h, material, group):
    """w x h plane facing web +z with a full 0..1 UV (screens and labels take canvas textures)"""
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)], [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for loop, (u, v) in zip(me.polygons[0].loop_indices, ((0, 0), (1, 0), (1, 1), (0, 1))):
        uv.data[loop].uv = (u, v)
    o = bpy.data.objects.new(name, me)
    coll(group).objects.link(o)
    me.materials.append(material)
    return o


def panel(name, w, h, d, r, center, material, group, edge=0.0):
    """upright slab (w x h facing web +z, d deep) with rounded corners seen from the front"""
    o = rounded_slab(name, w, d, h, r, (0, 0, 0), material, group, seg=8)
    o.rotation_euler = (math.pi / 2, 0, 0)
    o.location = W(*center)
    if edge:
        add_bevel(o, edge, 2, angle=50)
    return o


def hazard():
    """black/yellow diagonal stripes"""
    if "hazard" in _cache:
        return _cache["hazard"]
    m, nodes, links, b = new_mat("hazard")
    wave = nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "DIAGONAL"
    wave.inputs["Scale"].default_value = 60
    tc = nodes.new("ShaderNodeTexCoord")
    links.new(tc.outputs["Object"], wave.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].color = rgba("#111111")
    ramp.color_ramp.elements[1].position = 0.5
    ramp.color_ramp.elements[1].color = rgba("#e8b21e")
    links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.55
    _cache["hazard"] = m
    return m


def glass_mat(name="glass", tint="#dff4ff", alpha=0.12):
    """alpha, not transmission: transmissive glass blocks shadow rays in the bake (no caustics)"""
    if name in _cache:
        return _cache[name]
    m, nodes, links, b = new_mat(name)
    b.inputs["Alpha"].default_value = alpha
    b.inputs["Roughness"].default_value = 0.05
    b.inputs["Base Color"].default_value = rgba(tint)
    try:
        m.surface_render_method = "BLENDED"
    except Exception:
        pass
    _cache[name] = m
    return m


def screen_mat(name, h, strength):
    return emitter(h, strength, name)


# ================================================================ LIGHTS
def light(name, kind, watts, color, at, aim=None, size=0.05, size_y=None, spot=None, direction=None):
    d = bpy.data.lights.new(name, kind)
    d.energy = watts * EXPOSURE
    d.color = rgb(color)
    if kind == "AREA":
        d.shape = "RECTANGLE" if size_y else "DISK"
        d.size = size
        if size_y:
            d.size_y = size_y
    else:
        d.shadow_soft_size = size
    if spot:
        d.spot_size = math.radians(spot)
        d.spot_blend = 0.6
    o = bpy.data.objects.new(name, d)
    coll("lights").objects.link(o)
    o.location = at if isinstance(at, Vector) else W(*at)
    if aim:
        o.rotation_euler = (W(*aim) - o.location).to_track_quat("-Z", "Y").to_euler()
    if direction is not None:
        o.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return o


# ================================================================ CYCLES
def setup_cycles(samples):
    scene.render.engine = "CYCLES"
    try:
        prefs = bpy.context.preferences.addons["cycles"].preferences
        for kind in ("OPTIX", "CUDA", "METAL", "HIP"):
            try:
                prefs.compute_device_type = kind
                prefs.get_devices()
                if any(d.type == kind for d in prefs.devices):
                    break
            except TypeError:
                continue
        for d in prefs.devices:
            d.use = d.type == prefs.compute_device_type
        scene.cycles.device = "GPU"
        print("cycles device:", prefs.compute_device_type, [d.name for d in prefs.devices if d.use])
    except Exception as e:
        print("GPU setup failed, using CPU:", e)
    scene.cycles.samples = samples
    scene.cycles.use_adaptive_sampling = True
    scene.cycles.adaptive_threshold = 0.005
    scene.cycles.sample_clamp_indirect = 8
    scene.cycles.max_bounces = 8
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "None"


# ================================================================ UV + BAKE
def drop_hidden_faces(o):
    """faces that point straight down are never seen from any camera stop; don't spend atlas space on them"""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.95], context="FACES")
    bm.to_mesh(o.data)
    bm.free()


def unwrap(objs, density):
    """one UV atlas for objs. density[name] scales an object's texel density relative to the others."""
    scene.tool_settings.use_uv_select_sync = True  # mesh selection drives UV ops (no UV editor in background)
    for o in objs:
        while o.data.uv_layers:
            o.data.uv_layers.remove(o.data.uv_layers[0])
        o.data.uv_layers.new(name="bake")
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        k = density.get(o.name, 1.0)
        if k != 1.0:
            for d in o.data.uv_layers["bake"].data:
                d.uv = d.uv * k
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, rotate_method="AXIS_ALIGNED", margin_method="FRACTION", margin=8 / SIZE, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


def bake_targets(objs, image):
    """every material on objs gets the atlas as its active image node (materials are made unique per atlas)"""
    for o in objs:
        for i, m in enumerate(o.data.materials):
            mm = m.copy()
            mm.name = f"{m.name}@{image.name}"
            o.data.materials[i] = mm
            node = mm.node_tree.nodes.new("ShaderNodeTexImage")
            node.image = image
            mm.node_tree.nodes.active = node


def denoise(image, path):
    """OIDN through the compositor (Workbench engine so no scene render happens)"""
    engine = scene.render.engine
    tree = bpy.data.node_groups.new("denoise", "CompositorNodeTree")
    scene.compositing_node_group = tree
    scene.render.use_compositing = True
    src = tree.nodes.new("CompositorNodeImage")
    src.image = image
    dn = tree.nodes.new("CompositorNodeDenoise")
    try:
        dn.inputs["HDR"].default_value = True
    except Exception:
        dn.use_hdr = True
    out = tree.nodes.new("NodeGroupOutput")
    tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    tree.links.new(src.outputs["Image"], dn.inputs["Image"])
    tree.links.new(dn.outputs["Image"], out.inputs[0])
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = image.size[0]
    scene.render.resolution_y = image.size[1]
    scene.render.resolution_percentage = 100
    bpy.ops.render.render(write_still=False)
    save(bpy.data.images["Render Result"], path)
    scene.render.engine = engine
    scene.compositing_node_group = None


def save(image, path):
    s = scene.render.image_settings
    s.file_format = "WEBP"
    s.quality = 92  # #195: the cap is 5 MB now (user): sharpness first (at 85 the models were 3.28 MB, at 92 3.83 MB)
    s.color_mode = "RGB"
    s.color_management = "FOLLOW_SCENE"
    image.save_render(path, scene=scene)
    print("saved", path)

