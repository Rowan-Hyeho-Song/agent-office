# #187 pre-modelling: the common desk kit (docs/design/desk-props.md 2: keyboard, mouse, mouse pad, monitor, desk,
# cables) at the desk-room standard (office-quality.md 0). Standalone: builds the kit on one desk in a preview scene,
# prints triangles per item against the spec budget, renders Cycles shots and saves a .blend. Not in office.glb yet
# (the desks move in #195). Desk frame as office_bake.py: x = right of the seated agent, z+ = toward the agent,
# y = height, desk top at DESK_H. Positions match today's build_desk so they drop in.
#   blender --background --factory-startup --python desk_kit.py -- <out_dir> [--accent #ffb347] [--shot=a,b]
import os, sys, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bakekit import *  # noqa

DESK_W, DESK_D, DESK_H = 1.2, 0.62, 0.74
TOP_T = 0.025
U = 0.01905  # key pitch
# sculpted profile (spec: top row 9.8 mm -> home row 7.2 mm), rows back to front: F, number, Q, A (home), Z, bottom
ROW_H = (0.0098, 0.0092, 0.0080, 0.0072, 0.0078, 0.0080)
ROW_PITCH = (7, 8, 5, 1, -4, -5)
# tenkeyless 87: rows back to front; (width in U, gap before it in U)
TKL = [
    [(1, 0)] + [(1, 1 if k == 0 else (0.5 if k in (4, 8) else 0)) for k in range(12)],
    [(1, 0)] * 13 + [(2, 0)],
    [(1.5, 0)] + [(1, 0)] * 12 + [(1.5, 0)],
    [(1.75, 0)] + [(1, 0)] * 11 + [(2.25, 0)],
    [(2.25, 0)] + [(1, 0)] * 10 + [(2.75, 0)],
    [(1.25, 0)] * 3 + [(6.25, 0)] + [(1.25, 0)] * 4,
]
NAV = {0: 3, 1: 3, 2: 3, 4: 1, 5: 3}  # the navigation cluster: keys per row (row 4: the up arrow in the middle)
NAV_X = 15.25  # its left edge, U from the main block's left (a quarter-key gap)
CASE_C = "#3a3d44"  # dark grey matte aluminium; the mouse body takes it too (spec)


def face_out(bm, verts, ref, outward=True):
    """a face whose normal points away from (outward) or toward ref (a Blender point)"""
    f = bm.faces.new(verts)
    f.normal_update()
    if (f.normal.dot(f.calc_center_median() - ref) < 0) == outward:
        f.normal_flip()
    return f


def cap(bm, cx, cz, wu, row, y0):
    """a sculpted cap in 20 triangles: a square foot 18 mm (1u), an octagonal top 12.5 mm with chamfered corners,
    pitched by row and dished 1 mm in the middle"""
    w, d = wu * U - 0.00105, U - 0.00105
    tw, td, r = w - 0.0055, d - 0.0055, 0.0018
    h, pt = ROW_H[row], math.tan(math.radians(ROW_PITCH[row]))
    B = [bm.verts.new(W(cx + x, y0, cz + z)) for x, z in ((w / 2, d / 2), (-w / 2, d / 2), (-w / 2, -d / 2), (w / 2, -d / 2))]
    T2 = [(tw / 2, td / 2 - r), (tw / 2 - r, td / 2), (-tw / 2 + r, td / 2), (-tw / 2, td / 2 - r),
          (-tw / 2, -td / 2 + r), (-tw / 2 + r, -td / 2), (tw / 2 - r, -td / 2), (tw / 2, -td / 2 + r)]
    T = [bm.verts.new(W(cx + x, y0 + h - pt * z, cz + z)) for x, z in T2]
    C = bm.verts.new(W(cx, y0 + h - 0.001, cz))
    mid = W(cx, y0 + h * 0.4, cz)
    for k in range(4):
        face_out(bm, (B[k - 1], B[k], T[2 * k], T[2 * k - 1]), mid)  # the skirt side between corners k-1 and k
        face_out(bm, (B[k], T[2 * k + 1], T[2 * k]), mid)  # the corner chamfer
    up = W(cx, y0 - 1.0, cz)  # top faces point away from a point far below
    for i in range(8):
        face_out(bm, (C, T[i], T[(i + 1) % 8]), up)


def kit_keyboard(G, accent="#ffb347", at=(0.0, 0.06)):
    """TKL 87 (spec 2): a low aluminium case 0.37 x 0.135, 15 mm at the front rising 6 degrees to 29 mm at the back,
    2 mm bevels; sculpted dished caps, ivory alphas and grey modifiers, only Esc in the owner's colour; rubber feet,
    a USB-C cable off the back toward the monitor. Legends go in the atlas at integration, not in geometry.
    Returns (parts, esc): esc is the one per-seat mesh (the rest can be one instance shared by five desks)."""
    x0, z0 = at
    h = DESK_H
    cw, cd, yf, yb = 0.37, 0.135, 0.015, 0.029
    case_m = plastic(CASE_C, 0.6, 0.3, 0.08, "kb_case")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:  # Blender +Y = web -z (the back)
        v.co = Vector((v.co.x * cw, v.co.y * cd, (yb if v.co.y > 0 else yf) if v.co.z > 0 else 0.0))
    case = mesh_obj("kb_case", bm, case_m, G)
    case.location = W(x0, h, z0)
    add_bevel(case, 0.002, 1, angle=30)
    smooth(case)
    tilt = math.atan2(yb - yf, cd)
    T = Mx((x0, h + (yf + yb) / 2 - 0.004, z0), rx=tilt)  # the plate, 4 mm under the rim, tilted with the wedge
    parts = [case]
    parts += place([box("kb_plate", (cw - 0.012, 0.001, cd - 0.012), (0, 0, 0), plastic("#15161a", 0.6, 0.3, 0.05, "kb_plate"), G)], T)
    mats = [plastic("#e6dfcf", 0.55, 0, 0.12, "cap_alpha"), plastic("#8d929c", 0.55, 0, 0.12, "cap_mod"),
            plastic(accent, 0.5, 0, 0.12, f"cap_accent_{accent[1:]}")]
    bms = [bmesh.new() for _ in mats]
    zrow = [-2.75 * U, -1.25 * U, -0.25 * U, 0.75 * U, 1.75 * U, 2.75 * U]  # the F row stands 0.5 U back
    xl = -(NAV_X + 3) * U / 2
    for r, row in enumerate(TKL):
        x = xl
        for k, (wu, gap) in enumerate(row):
            x += gap * U
            m = 2 if (r == 0 and k == 0) else 1 if (wu > 1 and wu < 6) or r == 0 else 0
            cap(bms[m], x + wu * U / 2, zrow[r], wu, r, 0.0005)
            x += wu * U
        nk = NAV.get(r, 0)
        for j in range(nk):
            cx = xl + NAV_X * U + (j + (1 if (r == 4 and nk == 1) else 0)) * U + U / 2
            cap(bms[1], cx, zrow[r], 1, r, 0.0005)
    caps = [place([smooth(mesh_obj(f"kb_caps_{m.name}", bm_, m, G))], T)[0] for bm_, m in zip(bms, mats)]
    parts += caps[:2]
    led = emitter("#9be7c4", 1.2, "kb_led")  # lock LEDs: one quiet colour on every desk (the accent is Esc's)
    for j in range(3):
        parts += place([box("kb_led", (0.0024, 0.0006, 0.0012), (xl + (NAV_X + 0.4) * U + j * 0.008, 0.0003, -3.1 * U), led, G)], T)
    for sx in (-1, 1):  # rubber feet
        for sz in (-1, 1):
            parts.append(box("kb_foot", (0.018, 0.002, 0.006), (x0 + sx * (cw / 2 - 0.02), h + 0.001, z0 + sz * (cd / 2 - 0.012)),
                             plastic("#0e0f12", 0.9, 0, 0.3, "rubber_foot"), G))
    return parts, caps[2]


def kit_mouse(G, at=(0.3, 0.07)):
    """a symmetric office mouse 0.115 x 0.062 x 0.038 (spec 2): a teardrop dome fuller at the back, a 0.8 mm split
    between the buttons, a rubber wheel with grooves, rubber side grips, a black base with three glide feet"""
    x0, z0 = at
    h = DESK_H + 0.003  # on the pad
    body_m = plastic(CASE_C, 0.6, 0.1, 0.08, "mouse_body")
    dark = plastic("#121317", 0.6, 0.2, 0.05, "mouse_dark")
    rubber = plastic("#1b1c20", 0.9, 0, 0.5, "mouse_rubber")
    W2, H2, L2 = 0.031, 0.034, 0.0575
    dome = sphere("mouse_body", 1.0, (0, 0, 0), body_m, G, half=True, seg=24, rings=10)  # designer: a smoother outline
    for v in dome.data.vertices:  # Blender: x, y = web -z (back +), z = up
        fwd = v.co.y  # +1 at the nose (Blender +y = web -z: toward the monitor)
        v.co = Vector((v.co.x * W2 * (1 - 0.18 * max(0.0, fwd)), v.co.y * L2, v.co.z * H2 * (1 - 0.3 * max(0.0, fwd) ** 2)))
    # the black base follows the body's outline (a 3.5 mm band down from its rim, closed underneath), and the rubber
    # side grips are the flank faces in a darker material, not boards stuck on
    dome.data.materials.append(rubber)
    dome.data.materials.append(dark)
    bm = bmesh.new()
    bm.from_mesh(dome.data)
    rim = [e for e in bm.edges if e.is_boundary]
    for f in bm.faces:
        c = f.calc_center_median()
        hz = H2 * (1 - 0.3 * max(0.0, c.y / L2) ** 2)  # the local height: pick one ring row by angle, no staircase
        if 55 < math.degrees(math.atan2(abs(c.x), c.y)) < 125 and 0.1 < c.z / hz < 0.5:
            f.material_index = 1
    grips = [f for f in bm.faces if f.material_index == 1]  # set 0.5 mm into the curved flank (designer)
    bmesh.ops.inset_region(bm, faces=grips, thickness=0.0008, depth=-0.0005, use_even_offset=True)
    ext = bmesh.ops.extrude_edge_only(bm, edges=rim)
    down = [g for g in ext["geom"] if isinstance(g, bmesh.types.BMVert)]
    for v in down:
        v.co.z -= 0.0035
    for g in ext["geom"]:
        if isinstance(g, bmesh.types.BMFace):
            g.material_index = 2
    bottom = bmesh.ops.edgeloop_fill(bm, edges=[e for e in bm.edges if e.is_boundary])
    for f in bottom["faces"]:
        f.material_index = 2
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(dome.data)
    bm.free()
    dome.location = W(x0, h + 0.004, z0)
    smooth(dome)

    def top_y(x, z):
        fwd = max(0.0, -z / L2)
        w = W2 * (1 - 0.18 * fwd)
        q = 1 - (x / w) ** 2 - (z / L2) ** 2
        return h + 0.004 + H2 * (1 - 0.3 * fwd ** 2) * math.sqrt(max(q, 0.0))

    groove = plastic("#0b0c0f", 1.0, 0, 0.0, "mouse_groove")  # fully rough: a groove, not a wire
    parts = [dome]
    # the buttons' front ends (designer: a 1 mm step): a seam round the nose at 45% of the height, where the button
    # shells overhang the body; the split between the buttons runs from it back to 40% of the length. Thin, sunk
    # half into the shell, dense points on the surface (a few points arced off it like wires)
    s = math.sqrt(1 - 0.45 ** 2)

    def rim(a):
        z = -L2 * s * math.cos(a)
        w = W2 * (1 - 0.18 * max(0.0, -z / L2))
        return (x0 + w * s * math.sin(a), h + 0.004 + H2 * (1 - 0.3 * max(0.0, -z / L2) ** 2) * 0.45, z0 + z)

    edge = rail("mouse_button_edge", [rim(math.radians(a)) for a in range(-70, 71, 14)], 0.0003, groove, G)
    split = rail("mouse_split", [(x0, top_y(0, z) - 0.0001, z0 + z) for z in [-L2 * s + k * (L2 * s - 0.011) / 7 for k in range(8)]], 0.0003, groove, G)
    for c in (edge, split):
        c.data.resolution_u, c.data.bevel_resolution = 1, 0
    parts.append(split)
    parts.append(edge)
    zw = -0.034  # the wheel, in a slot between the buttons
    parts.append(cyl("mouse_wheel", 0.0072, 0.0065, (x0, top_y(0, zw) - 0.0015, z0 + zw), rubber, G, 10, axis="x"))
    for k in range(2):  # its grooves: dark rings
        parts.append(cyl("mouse_wheel_groove", 0.0074, 0.0006, (x0 - 0.001 + k * 0.002, top_y(0, zw) - 0.0015, z0 + zw), groove, G, 10, axis="x"))
    feet = plastic("#e8e4dc", 0.3, 0, 0, "ptfe")
    for fx, fz in ((-0.01, -0.034), (0.01, -0.034), (0.0, 0.042)):  # three glide feet
        parts.append(box("mouse_feet", (0.012, 0.0008, 0.008), (x0 + fx, h + 0.0004, z0 + fz), feet, G))
    return parts


def kit_pad(G, at=(0.3, 0.06)):
    """a cloth mouse pad 0.25 x 0.21 x 3 mm, dark navy, a grey stitched band round the edge"""
    x0, z0 = at
    h = DESK_H
    return [rounded_slab("pad_edge", 0.25, 0.003, 0.21, 0.012, (x0, h + 0.0015, z0), plastic("#7d828c", 0.9, 0, 0.6, "pad_stitch"), G, seg=2),
            rounded_slab("pad_cloth", 0.244, 0.0006, 0.204, 0.009, (x0, h + 0.0029, z0), plastic("#1f2a44", 0.95, 0, 0.7, "pad_cloth"), G, seg=2)]


def kit_monitor(G, screen_at=(0.0, 0.36, -0.178)):
    """a 24-inch office monitor on a height / tilt stand (spec 2). The canvas slot stays 0.57 x 0.33 at screen_at:
    7 mm bezels, 15 mm chin; a rounded convex back with a VESA plate; a neck with a height slot and a cable hole;
    a front-rounded metal base; a power LED at the chin's right"""
    sx, sy, sz = screen_at
    h = DESK_H
    body = plastic("#2e3138", 0.6, 0.0, 0.08, "mon_body")
    dark = plastic("#101115", 0.7, 0.1, 0.0, "mon_dark")
    alu = plastic("#9aa0a8", 0.35, 0.8, 0.08, "mon_alu")
    yc = h + sy
    bw, bh = 0.57 + 0.014, 0.33 + 0.007 + 0.015
    byc = yc - (0.015 - 0.007) / 2  # the frame's centre: the chin is deeper
    M = Mx((sx, byc, sz - 0.007), rx=math.pi / 2)  # local +y = toward the agent (web +z)
    parts = place([rounded_slab("mon_bezel", bw, 0.012, bh, 0.005, (0, 0, 0), body, G, seg=2),
                   sphere("mon_back", 1.0, (0, -0.006, 0), body, G, scale=(bw / 2 - 0.05, 0.026, bh / 2 - 0.045), half=False, seg=40, rings=8)], M)
    # keep only the back half of the dome (a convex back, not a ball through the screen)
    back = parts[1]
    bm = bmesh.new()
    bm.from_mesh(back.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 1e-6], context="VERTS")  # web local +y = Blender +z
    bm.to_mesh(back.data)
    bm.free()
    parts.append(box("mon_screen_bed", (0.574, 0.334, 0.001), (sx, yc, sz - 0.0005), plastic("#050607", 0.25, 0, 0, "mon_glass"), G))
    bz = sz - 0.007 - 0.006 - 0.026  # the back's deepest point
    parts.append(box("mon_vesa", (0.1, 0.1, 0.006), (sx, yc, bz - 0.002), body, G, bev=0.002, seg=1))
    led = emitter("#7dd3fc", 2.0, "mon_power_led")
    parts.append(box("mon_led", (0.004, 0.0015, 0.001), (sx + bw / 2 - 0.03, byc - bh / 2 + 0.006, sz - 0.0005), led, G))
    nz = bz - 0.014  # the stand: a neck behind the VESA plate, its front carries the height slot and the cable hole
    ntop = yc + 0.01  # the neck reaches up behind the VESA plate; slot and cable hole on its back face
    parts += [box("mon_neck", (0.05, ntop - h - 0.008, 0.022), (sx, (ntop + h + 0.008) / 2, nz), alu, G, bev=0.003, seg=1),
              box("mon_slot", (0.008, 0.16, 0.001), (sx, h + 0.24, nz - 0.0112), dark, G),
              cyl("mon_hole", 0.011, 0.001, (sx, h + 0.07, nz - 0.0112), dark, G, 10, axis="z"),
              rounded_slab("mon_base", 0.24, 0.008, 0.18, 0.04, (sx, h + 0.004, nz + 0.04), alu, G, seg=3, edge=0.0015)]
    return parts


def oak():
    """light oak #cdb894 (designer #187), straight grain along the desk (Blender X), the bands at most 6% darker"""
    m, nodes, links, b = new_mat("desk_oak")
    tc = nodes.new("ShaderNodeTexCoord")
    mp = nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (0.12, 6, 6)  # a few broad, wandering bands (not lined paper)
    wave = nodes.new("ShaderNodeTexWave")
    wave.wave_type, wave.bands_direction = "BANDS", "Y"
    wave.inputs["Scale"].default_value = 1.2
    wave.inputs["Distortion"].default_value = 7.0
    wave.inputs["Detail"].default_value = 5
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = rgba("#c1ad8b")  # 6% darker
    ramp.color_ramp.elements[1].color = rgba("#cdb894")
    links.new(tc.outputs["Object"], mp.inputs["Vector"])
    links.new(mp.outputs["Vector"], wave.inputs["Vector"])
    links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.55
    return m


def kit_desk(G):
    """the desk (spec 2, today's size 1.2 x 0.62 x 0.74): a white melamine top with a 2 mm ABS edge band in another
    colour, matte black steel legs on foot bars with rubber caps, four screws at each leg / foot joint, a modesty
    panel and a cable tray under the back edge"""
    w, d, h = DESK_W, DESK_D, DESK_H
    top_m = oak()  # designer #187: light oak, not white (the ivory robots merged into a white top)
    band = plastic("#3a3f48", 0.5, 0, 0.1, "desk_band")  # graphite
    steel = plastic("#202226", 0.6, 0.6, 0.05, "desk_steel")
    rubber = plastic("#0e0f12", 0.9, 0, 0.3, "desk_rubber")
    p = [box("desk_band", (w, TOP_T, d), (0, h - TOP_T / 2, 0), band, G, bev=0.002, seg=1),
         box("desk_top", (w - 0.004, 0.0005, d - 0.004), (0, h + 0.0002, 0), top_m, G),
         box("desk_modesty", (w - 0.1, 0.38, 0.016), (0, h - 0.24, -d / 2 + 0.05), steel, G)]
    for lx in (-w / 2 + 0.05, w / 2 - 0.05):
        for lz in (-d / 2 + 0.05, d / 2 - 0.05):
            p.append(box("desk_leg", (0.04, h - TOP_T - 0.03, 0.04), (lx, (h - TOP_T + 0.03) / 2, lz), steel, G))
            for k in range(4):  # the joint's screws, two each side of the leg on the foot bar's top
                sxk, szk = (-1, 1)[k % 2] * 0.012, lz + (-1, 1)[k // 2] * 0.03
                p.append(cyl("desk_screw", 0.0035, 0.001, (lx + sxk, 0.0305, szk), steel, G, 6))
        p += [box("desk_foot", (0.05, 0.03, d - 0.05), (lx, 0.015, 0), steel, G),
              box("desk_cap", (0.05, 0.008, 0.01), (lx, 0.004, -(d - 0.05) / 2 - 0.004), rubber, G),
              box("desk_cap", (0.05, 0.008, 0.01), (lx, 0.004, (d - 0.05) / 2 + 0.004), rubber, G)]
    ty, tz = h - TOP_T - 0.05, -d / 2 + 0.022  # the tray: a U channel hung under the back edge, behind the modesty panel
    p += [box("desk_tray", (0.8, 0.003, 0.036), (0, ty - 0.03, tz), steel, G),
          box("desk_tray", (0.8, 0.06, 0.003), (0, ty, tz - 0.018), steel, G),
          box("desk_tray", (0.8, 0.04, 0.003), (0, ty - 0.01, tz + 0.018), steel, G)]
    return p


def kit_cables(G, kb_at=(0.0, 0.06), mon_nz=-0.24):
    """4 mm black rubber: the keyboard's USB-C runs back past the monitor base, meets the monitor cable at the
    neck's foot, and both drop over the back edge into the tray"""
    h = DESK_H
    m = plastic("#16171b", 0.85, 0, 0.4, "cable")
    x0, z0 = kb_at
    edge = -DESK_D / 2
    kb = rail("cable_kb", [(x0 + 0.06, h + 0.024, z0 - 0.0675), (x0 + 0.07, h + 0.002, z0 - 0.1), (x0 + 0.05, h + 0.002, mon_nz - 0.03),
                           (x0 + 0.02, h + 0.002, edge + 0.02), (x0 + 0.01, h - 0.01, edge - 0.004), (x0 + 0.01, h - 0.07, edge + 0.022)], 0.002, m, G)
    mon = rail("cable_mon", [(x0, h + 0.1, mon_nz - 0.012), (x0, h + 0.03, mon_nz - 0.016), (x0 - 0.01, h + 0.002, mon_nz - 0.05),
                             (x0 - 0.005, h + 0.002, edge + 0.02), (x0 - 0.005, h - 0.01, edge - 0.004), (x0 - 0.005, h - 0.07, edge + 0.022)], 0.002, m, G)
    for c in (kb, mon):
        c.data.resolution_u, c.data.bevel_resolution = 4, 0
    return [kb, mon]


def build_kit(G="kit", accent="#ffb347", mouse=True):
    """the whole kit on one desk: [(label, objs, spec budget)]; mouse=False for HUE (a pen tablet in its place)"""
    kb, esc = kit_keyboard(G, accent)
    mn = kit_monitor(G)
    nz = [o for o in mn if o.name.startswith("mon_neck")][0].location
    items = [("keyboard", kb + [esc], 2000 + 120)]
    if mouse:
        items += [("mouse", kit_mouse(G), 500), ("mouse pad", kit_pad(G), 60)]
    items += [("monitor", mn, 600), ("desk", kit_desk(G), 500), ("cables", kit_cables(G, mon_nz=-nz.y), 300)]
    return items


def tris(objs):
    """triangles and material names of objects as exported (modifiers and curves evaluated)"""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    t, mats = 0, set()
    for o in objs:
        if o.type in ("MESH", "CURVE", "FONT"):
            me = o.evaluated_get(dg).to_mesh()
            t += sum(len(p.vertices) - 2 for p in me.polygons)
            o.evaluated_get(dg).to_mesh_clear()
            mats |= {m.name for m in o.data.materials if m}
    return t, mats


def report(tag, items):
    total = 0
    for label, objs, budget in items:
        t, mats = tris(objs)
        total += t
        print(f"{tag} {label}: {t} triangles" + (f" (spec {budget})" if budget else "") + f", {len(mats)} materials, {len(objs)} parts")
    print(f"{tag} total: {total} triangles")
    return total


def render(shots, blend_name):
    """a neutral studio round the desk (the app's lighting differs: this is for shape and parts), then each shot"""
    setup_cycles(96)
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = rgba("#20232b")
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    box("floor", (4, 0.01, 4), (0, -0.005, 0), plastic("#6b5644", 0.8, 0, 0.3, "floor"), "kit")
    light("key", "AREA", 22, "#ffe7c4", (-0.6, 1.9, 0.9), aim=(0, 0.8, 0), size=0.8)
    light("fill", "AREA", 8, "#c9d6ff", (0.8, 1.4, 0.6), aim=(0, 0.8, 0), size=0.6)
    light("back", "AREA", 10, "#dfe6ff", (0.4, 1.5, -1.3), aim=(0, 0.7, -0.2), size=0.8)  # so the back shots read
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle_y = math.radians(30)
    scene.render.resolution_x, scene.render.resolution_y = 1280, 800
    scene.render.image_settings.file_format = "PNG"
    want = next((a.split("=")[1].split(",") for a in ARGS if a.startswith("--shot=")), None)
    for name, pos, tgt in shots:
        if want and name not in want:
            continue
        cam.location = W(*pos)
        cam.rotation_euler = (W(*tgt) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(OUT, f"{name}.png")
        bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, blend_name))


KIT_SHOTS = (("kit_overview", (0.55, 1.15, 0.75), (0.0, 0.85, -0.05)),
             ("kit_keyboard", (0.12, 0.93, 0.3), (0.0, 0.75, 0.05)),
             ("kit_mouse", (0.42, 0.84, 0.2), (0.3, 0.75, 0.07)),
             ("kit_mouse_front", (0.4, 0.84, -0.09), (0.3, 0.755, 0.07)),
             ("kit_monitor_back", (-0.45, 1.15, -0.7), (0.0, 1.0, -0.2)),
             ("kit_monitor_chin", (0.32, 0.86, 0.12), (0.22, 0.91, -0.18)),
             ("kit_desk", (1.3, 0.9, 1.4), (0.0, 0.45, 0.0)),
             ("kit_desk_back", (0.9, 0.55, -1.2), (0.0, 0.55, -0.25)),
             ("kit_room_angle", (-1.0, 1.75, 1.75), (0.05, 0.72, -0.1)))

if __name__ == "__main__":
    accent = ARGS[ARGS.index("--accent") + 1] if "--accent" in ARGS else "#ffb347"
    report("KIT", build_kit("kit", accent))
    render(KIT_SHOTS, "desk_kit.blend")
    print("DONE")
