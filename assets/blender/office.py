"""Low-poly isometric agent office — asset spike.

Run:
  Blender --background --python office.py -- <out_dir>
Outputs: office.blend, office.glb, render_wide.png, render_close.png
"""
import bpy, math, sys, os
from mathutils import Vector, Euler

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.getcwd()
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------- helpers ----------
def _lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def hex_rgb(h):
    return tuple(_lin(int(h[i:i + 2], 16) / 255) for i in (1, 3, 5))

_mats = {}
def mat(h, rough=0.85, emit=0.0):
    key = (h, rough, emit)
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(f"m_{h[1:]}_{emit}")
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*hex_rgb(h), 1)
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*hex_rgb(h), 1)
        b.inputs["Emission Strength"].default_value = emit
    _mats[key] = m
    return m

def _finish(o, name, material, parent, bevel, flat=True):
    o.name = name
    if bevel:
        md = o.modifiers.new("bevel", "BEVEL")
        md.width = bevel
        md.segments = 2
        md.limit_method = "ANGLE"
    o.data.materials.append(material)
    if flat:
        for p in o.data.polygons:
            p.use_smooth = False
    if parent:
        o.parent = parent
    return o

def box(name, size, loc, material, parent=None, bevel=0.0, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(o, name, material, parent, bevel)

def cyl(name, r, depth, loc, material, parent=None, verts=10, rot=(0, 0, 0), r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
    return _finish(bpy.context.active_object, name, material, parent, 0)

def blob(name, r, loc, material, parent=None, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=r, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return _finish(o, name, material, parent, 0)

def empty(name, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    scene.collection.objects.link(e)
    e.location = loc
    if parent:
        e.parent = parent
    return e

# ---------- palette ----------
P = dict(
    floor="#DCCFBC", rug="#BFD0BA", wall="#E9E0D2", wall_trim="#D8CBB6",
    wood="#C8925A", wood_dark="#9C6B3D", metal="#5A5F6B", dark="#2B2E36",
    screen="#6FB7FF", code1="#FFD166", code2="#7BE495", code3="#FF8FA3",
    chair="#3C4250", skin="#F2C9A0", hair="#3B2A20", pant="#3A4A6B",
    pot="#D9734E", leaf="#5FA35A", leaf2="#7CC26E", mug="#FFFFFF",
    board="#FFFFFF", note1="#FFE08A", note2="#A7E3FF", note3="#FFB3C1",
    rack="#30343C", led_g="#4BFF8A", led_y="#FFC83D",
)

# ---------- assets ----------
FACE_STYLE = {
    # state: (screen bg, face color, antenna color)
    "idle":     ("#141B2D", "#7FF5FF", "#7FF5FF"),
    "focus":    ("#141B2D", "#7FF5FF", "#4BFF8A"),
    "thinking": ("#141B2D", "#7FF5FF", "#B9A2FF"),
    "waiting":  ("#2E2208", "#FFC83D", "#FFC83D"),
    "done":     ("#0F2A1C", "#7BE495", "#4BFF8A"),
    "error":    ("#2E0F12", "#FF5A5F", "#FF5A5F"),
}

def robot_head(name, shell, face, parent=None):
    """Floating display-head robot. Screen faces -Y locally. Origin = head center.
    In the app the 'face_screen' mesh gets a live CanvasTexture; the face geometry here is preview only."""
    W, H, D = 0.46, 0.38, 0.34
    bg, fc, ant = FACE_STYLE[face]
    root = empty(name, parent=parent)
    o = box("shell", (W, D, H), (0, 0, 0), mat(shell, 0.6), root, bevel=0.07)
    o.modifiers["bevel"].segments = 4
    o.modifiers["bevel"].harden_normals = True
    for p in o.data.polygons:
        p.use_smooth = True
    fy = -D / 2
    box("bezel", (W - 0.06, 0.02, H - 0.07), (0, fy - 0.004, 0), mat(P["dark"], 0.5), root, bevel=0.02)
    box("face_screen", (W - 0.11, 0.004, H - 0.12), (0, fy - 0.016, 0), mat(bg, 0.3, 0.6), root)
    # side "ears" + antenna
    for sx in (-1, 1):
        cyl("ear", 0.055, 0.04, (sx * (W / 2 + 0.012), 0, 0), mat(P["metal"], 0.5), root,
            verts=16, rot=(0, math.pi / 2, 0))
    cyl("antenna", 0.012, 0.12, (0, 0.03, H / 2 + 0.06), mat(P["metal"], 0.5), root, verts=8)
    blob("antenna_led", 0.032, (0, 0.03, H / 2 + 0.13), mat(ant, 0.3, 4.0), root)
    # hover ring
    bpy.ops.mesh.primitive_torus_add(major_radius=0.13, minor_radius=0.012, major_segments=28,
                                     minor_segments=8, location=(0, 0, -H / 2 - 0.09))
    _finish(bpy.context.active_object, "hover_ring", mat(fc, 0.3, 3.0), root, 0, flat=False)

    # --- face preview (emissive strokes on the screen) ---
    y = fy - 0.02
    fm = mat(fc, 0.3, 3.5)
    def stroke(w, h, x, z, a=0):
        box("face", (w, 0.004, h), (x, y, z), fm, root, rot=(0, math.radians(a), 0))
    def dot(r, x, z):
        cyl("face", r, 0.004, (x, y, z), fm, root, verts=16, rot=(math.pi / 2, 0, 0))
    ex = 0.075
    if face == "idle":
        for s in (-1, 1): dot(0.034, s * ex, 0.01)
    elif face == "focus":
        for s in (-1, 1): stroke(0.075, 0.022, s * ex, 0.0)
        stroke(0.04, 0.012, 0, -0.07)
    elif face == "thinking":
        for s in (-1, 1): dot(0.028, s * ex + 0.025, 0.04)
        for k in (-1, 0, 1): dot(0.011, k * 0.035, -0.07)
    elif face == "waiting":
        stroke(0.032, 0.1, 0, 0.03)
        dot(0.018, 0, -0.065)
    elif face == "done":
        for s in (-1, 1):
            stroke(0.055, 0.02, s * ex - 0.018, 0.0, -40)
            stroke(0.055, 0.02, s * ex + 0.018, 0.0, 40)
        stroke(0.06, 0.014, 0, -0.07)
    elif face == "error":
        for s in (-1, 1):
            stroke(0.075, 0.02, s * ex, 0.0, 45)
            stroke(0.075, 0.02, s * ex, 0.0, -45)
    return root

def workstation(name, shirt, face="idle"):
    """Desk + monitor + chair + floating robot agent. Faces +Y. Origin at desk center floor."""
    root = empty(name)
    # desk
    box("desk_top", (1.4, 0.7, 0.06), (0, 0, 0.74), mat(P["wood"]), root, bevel=0.01)
    for sx in (-0.64, 0.64):
        box("desk_leg", (0.06, 0.62, 0.71), (sx, 0, 0.355), mat(P["wood_dark"]), root)
    # monitor
    box("mon_base", (0.24, 0.16, 0.02), (0, 0.15, 0.78), mat(P["metal"]), root)
    box("mon_neck", (0.04, 0.04, 0.16), (0, 0.17, 0.86), mat(P["metal"]), root)
    box("mon_frame", (0.62, 0.04, 0.38), (0, 0.15, 1.08), mat(P["dark"]), root, bevel=0.008)
    box("mon_screen", (0.56, 0.005, 0.32), (0, 0.128, 1.08), mat(P["screen"], 0.4, 1.2), root)
    # code lines on screen (face -Y, toward character)
    for i, (w, c) in enumerate([(0.30, "code1"), (0.20, "code2"), (0.38, "code3"), (0.24, "code2"), (0.16, "code1")]):
        box("code", (w, 0.004, 0.022), (-0.24 + w / 2 + (0.04 if i in (1, 3) else 0), 0.124, 1.19 - i * 0.05),
            mat(P[c], 0.4, 2.0), root)
    # keyboard + mug
    box("keyboard", (0.44, 0.14, 0.02), (0, -0.18, 0.78), mat(P["dark"]), root, bevel=0.004)
    cyl("mug", 0.04, 0.09, (0.5, -0.05, 0.815), mat(P["mug"]), root)
    # chair
    cy = -0.72
    box("chair_seat", (0.46, 0.44, 0.07), (0, cy, 0.46), mat(P["chair"]), root, bevel=0.015)
    box("chair_back", (0.44, 0.06, 0.5), (0, cy - 0.24, 0.78), mat(P["chair"]), root, bevel=0.015)
    cyl("chair_post", 0.03, 0.34, (0, cy, 0.25), mat(P["metal"]), root, verts=8)
    for k in range(5):
        a = k * 2 * math.pi / 5
        box("chair_foot", (0.03, 0.26, 0.03), (math.sin(a) * 0.13, cy + math.cos(a) * 0.13, 0.06),
            mat(P["metal"]), root, rot=(0, 0, -a))
        blob("wheel", 0.035, (math.sin(a) * 0.25, cy + math.cos(a) * 0.25, 0.035), mat(P["dark"]), root)

    # robot agent floating above the chair, screen facing the monitor (+Y)
    bot = robot_head("agent", shirt, face, parent=root)
    bot.location = (0, -0.68, 1.0)
    bot.rotation_euler = (0, 0, math.pi)
    return root

def plant(name, loc):
    root = empty(name, loc)
    cyl("pot", 0.17, 0.32, (0, 0, 0.16), mat(P["pot"]), root, verts=8, r2=0.13)
    for i, (x, y, z, r) in enumerate([(0, 0, 0.5, 0.2), (0.1, 0.05, 0.68, 0.16), (-0.09, -0.04, 0.72, 0.14), (0.02, 0.02, 0.88, 0.12)]):
        blob("leaf", r, (x, y, z), mat(P["leaf"] if i % 2 == 0 else P["leaf2"]), root, scale=(1, 1, 1.2))
    return root

def whiteboard(name, loc):
    root = empty(name, loc)
    box("board_frame", (1.6, 0.05, 0.95), (0, 0, 1.45), mat(P["metal"]), root, bevel=0.01)
    box("board", (1.52, 0.02, 0.87), (0, -0.03, 1.45), mat(P["board"], 0.3), root)
    cols = [P["note1"], P["note2"], P["note3"]]
    for c in range(3):
        box("col_line", (0.01, 0.005, 0.75), (-0.25 + c * 0.5 - 0.0, -0.045, 1.43), mat(P["wall_trim"]), root) if c else None
        for r in range(3 - c):
            box("note", (0.16, 0.01, 0.14), (-0.5 + c * 0.5 + (r % 2) * 0.12 - 0.06, -0.045, 1.72 - r * 0.2),
                mat(cols[c]), root, rot=(0, math.radians((r * 7) % 11 - 5), 0))
    return root

def server_rack(name, loc):
    root = empty(name, loc)
    box("rack", (0.6, 0.6, 1.5), (0, 0, 0.75), mat(P["rack"]), root, bevel=0.02)
    for i in range(6):
        box("unit", (0.5, 0.01, 0.16), (0, -0.305, 0.25 + i * 0.2), mat(P["dark"]), root)
        box("led", (0.03, 0.01, 0.03), (0.18, -0.312, 0.25 + i * 0.2),
            mat(P["led_g"] if i != 2 else P["led_y"], 0.3, 6.0), root)
    return root

# ---------- room ----------
room = empty("room")
box("floor", (7, 6, 0.1), (0, 0.5, -0.05), mat(P["floor"]), room)
box("rug", (5, 2.6, 0.01), (0, 0.4, 0.005), mat(P["rug"]), room)
walls = empty("walls")
box("wall_back", (7, 0.12, 2.6), (0, 3.5, 1.3), mat(P["wall"]), walls)
box("wall_left", (0.12, 6, 2.6), (-3.5, 0.5, 1.3), mat(P["wall"]), walls)
box("trim_back", (7, 0.14, 0.1), (0, 3.5, 0.05), mat(P["wall_trim"]), walls)
box("trim_left", (0.14, 6, 0.1), (-3.5, 0.5, 0.05), mat(P["wall_trim"]), walls)

stations = []
# desks rotated so robots face +X: their screens read at 3/4 from the iso camera
for i, (shell, face, y) in enumerate([("#FFB86B", "thinking", 2.0), ("#8CB8FF", "focus", 0.3), ("#86D9A8", "waiting", -1.4)]):
    s = workstation(f"desk_{['planner', 'dev', 'qa'][i]}", shell, face)
    s.location = (0.2, y, 0)
    s.rotation_euler = (0, 0, -math.pi / 2)
    stations.append(s)
wb = whiteboard("whiteboard", (0.4, 3.42, 0))
plant("plant", (-3.0, 3.0, 0))
server_rack("server_rack", (2.9, 3.0, 0))

# ---------- lighting & render ----------
world = bpy.data.worlds.new("world")
scene.world = world
try:
    world.use_nodes = True
except Exception:
    pass
bg = world.node_tree.nodes.get("Background")
bg.inputs["Color"].default_value = (*hex_rgb("#DCE6F2"), 1)
bg.inputs["Strength"].default_value = 0.65

sun_data = bpy.data.lights.new("sun", "SUN")
sun_data.energy = 2.4
sun_data.angle = math.radians(8)
sun = bpy.data.objects.new("sun", sun_data)
scene.collection.objects.link(sun)
sun.rotation_euler = Euler((math.radians(50), math.radians(10), math.radians(30)))

for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try:
        scene.render.engine = eng
        break
    except TypeError:
        continue
try:
    scene.eevee.taa_render_samples = 48
except Exception:
    pass
scene.view_settings.view_transform = "Standard"
scene.render.resolution_x = 1400
scene.render.resolution_y = 1000
scene.render.film_transparent = False

cam_data = bpy.data.cameras.new("cam")
cam_data.type = "ORTHO"
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

def aim(target, rot_deg, ortho):
    rot = Euler(tuple(math.radians(a) for a in rot_deg))
    fwd = rot.to_matrix() @ Vector((0, 0, -1))
    cam.rotation_euler = rot
    cam.location = Vector(target) - fwd * 20
    cam_data.ortho_scale = ortho
    cam_data.clip_end = 100

def render(path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

# wide: classic isometric from front-right
aim((0, 0.6, 0.8), (60, 0, 45), 8.0)
render(os.path.join(OUT, "render_wide.png"))

# close-up of the dev robot
aim((-0.25, 0.3, 0.95), (62, 0, 50), 2.2)
render(os.path.join(OUT, "render_close.png"))

# expression sheet: six heads facing the camera on a plain backdrop
office_objs = [o for o in scene.objects if o.type != "CAMERA" and o.type != "LIGHT"]
for o in office_objs:
    o.hide_render = True
sheet = empty("sheet", (0, 30, 0))
box("backdrop", (6, 0.1, 3), (0, 0.6, 0), mat("#E7ECF3"), sheet)
box("ground", (6, 2, 0.1), (0, -0.4, -0.42), mat("#E7ECF3"), sheet)
faces = ["idle", "focus", "thinking", "waiting", "done", "error"]
shells = ["#8CB8FF", "#8CB8FF", "#FFB86B", "#86D9A8", "#86D9A8", "#8CB8FF"]
for k, (f, sh) in enumerate(zip(faces, shells)):
    h = robot_head(f"sheet_{f}", sh, f, parent=sheet)
    h.location = ((k - 2.5) * 0.72, 0, 0.05)
    bpy.ops.object.text_add(location=((k - 2.5) * 0.72, -0.3, -0.36), rotation=(math.radians(90), 0, 0))
    t = bpy.context.active_object
    t.data.body = f
    t.data.size = 0.075
    t.data.align_x = "CENTER"
    t.data.materials.append(mat("#5A5F6B"))
    t.parent = sheet
    t.location = ((k - 2.5) * 0.72, -0.3, -0.36)
aim((0, 30, 0.05), (82, 0, 0), 4.6)
scene.render.resolution_y = 560
render(os.path.join(OUT, "render_faces.png"))
for o in list(sheet.children_recursive) + [sheet]:
    o.hide_render = True
for o in office_objs:
    o.hide_render = False
scene.render.resolution_y = 1000

# ---------- save & export ----------
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "office.blend"))
for o in (cam, sun):
    o.select_set(False)
try:
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "office.glb"), export_format="GLB",
                              export_apply=True, export_cameras=False, export_lights=False)
except TypeError:
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "office.glb"), export_format="GLB")
print("DONE", OUT)
