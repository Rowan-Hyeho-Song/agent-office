# #187 pre-modelling: each seat's own desk props at the desk-room standard (docs/design/desk-props.md 3, positions
# from desks.md 2). Standalone like desk_kit.py: it runs office_bake.py's definitions (node conventions, helpers,
# AGENTS) and desk_kit.py's common kit, builds one seat on one desk, prints triangles against the 10k seat cap
# (kit included) and renders close-ups. office.glb is untouched until the #195 layout bake; then each seat_*()
# replaces desk_props_*() there (same LIVE nodes and names, same return shape) and the props move to build_props.
#   blender --background --factory-startup --python desk_seats.py -- <out_dir> --seat=0 [--shot=a,b]
import os, sys, math, random
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
_SRC = os.path.join(HERE, "office_bake.py")
_src = open(_SRC, encoding="utf-8").read()
_g = {"__name__": "office_bake_defs", "__file__": _SRC}
exec(compile(_src[:_src.index("# ================================================================ main")], _SRC, "exec"), _g)
globals().update({k: v for k, v in _g.items() if not k.startswith("__")})
import desk_kit as K  # noqa: E402

SEAT_CAP = 10000  # triangles per seat, the common kit included (planning, #187)


def punched(name, base_hex, dot_hex, axes, pitch=0.009, r=0.0028, metal=0.5):
    """sheet steel with a punched dot grid (baked into the atlas: dark dots, no alpha). axes = the two Blender
    object axes in the panel's plane, e.g. "XZ" for a panel facing web z, "YZ" for one facing web x"""
    m, nodes, links, b = new_mat(name)
    tc = nodes.new("ShaderNodeTexCoord")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    comb = nodes.new("ShaderNodeCombineXYZ")
    links.new(tc.outputs["Object"], sep.inputs["Vector"])
    links.new(sep.outputs[axes[0]], comb.inputs["X"])
    links.new(sep.outputs[axes[1]], comb.inputs["Y"])
    sc = nodes.new("ShaderNodeVectorMath")
    sc.operation = "SCALE"
    sc.inputs["Scale"].default_value = 1.0 / pitch
    fr = nodes.new("ShaderNodeVectorMath")
    fr.operation = "FRACTION"
    sub = nodes.new("ShaderNodeVectorMath")
    sub.operation = "SUBTRACT"
    sub.inputs[1].default_value = (0.5, 0.5, 0.0)
    ln = nodes.new("ShaderNodeVectorMath")
    ln.operation = "LENGTH"
    lt = nodes.new("ShaderNodeMath")
    lt.operation = "LESS_THAN"
    lt.inputs[1].default_value = r / pitch
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.inputs["A"].default_value = rgba(base_hex)
    mix.inputs["B"].default_value = rgba(dot_hex)
    links.new(comb.outputs["Vector"], sc.inputs[0])
    links.new(sc.outputs["Vector"], fr.inputs[0])
    links.new(fr.outputs["Vector"], sub.inputs[0])
    links.new(sub.outputs["Vector"], ln.inputs[0])
    links.new(ln.outputs["Value"], lt.inputs[0])
    links.new(lt.outputs["Value"], mix.inputs["Factor"])
    links.new(mix.outputs["Result"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.6
    b.inputs["Metallic"].default_value = metal
    return m


# ================================================================ MEMO (seat 0)
def seat_memo(G):
    """desk-props.md 3 MEMO: a two-tier wire-mesh tray (punched side / back panels, low front lips, four posts, IN /
    OUT plates), a round ink pad with its hinged lid open 80 deg, a tent calendar with a spiral binding (16 rings of
    4 mm) and a page or two flipped behind, the hourglass with turned posts and bevelled plates, the paper planes.
    Returns (statics, LIVE list, props) - props = [(name, objs)] built at their home (prop_stamp)."""
    h = DESK_H
    s, L, P = [], [], []
    iron = plastic("#26282e", 0.6, 0.5, 0.05, "tray_iron")
    side_m = punched("tray_punched_x", "#26282e", "#0c0d10", "YZ")  # panels facing web x
    back_m = punched("tray_punched_z", "#26282e", "#0c0d10", "XZ")  # panels facing web z
    paper = plastic("#efece4", 0.9, 0, 0.1, "paper")
    plate_m = plastic("#ece6d8", 0.5, 0, 0.1, "tray_plate")
    ink = plastic("#2a2c31", 0.6, 0, 0, "tray_label_ink")
    tx, tz, tw, td = TRAY
    # 1 the tray: IN on top (waiting for sign-off), OUT below (handed off today); open toward the agent
    for y0, label in ((0.075, "IN"), (0.0, "OUT")):
        wy = 0.042  # wall height
        s += [box("tray_floor", (tw, 0.003, td), (tx, h + y0 + 0.0015, tz), iron, G, bev=0.001, seg=1),
              box("tray_back", (tw, wy, 0.003), (tx, h + y0 + wy / 2, tz - td / 2 + 0.0015), back_m, G),
              box("tray_side", (0.003, wy, td - 0.02), (tx - tw / 2 + 0.0015, h + y0 + wy / 2, tz - 0.01), side_m, G),
              box("tray_side", (0.003, wy, td - 0.02), (tx + tw / 2 - 0.0015, h + y0 + wy / 2, tz - 0.01), side_m, G),
              # the sides sweep down to the low front lip (a real tray's scoop): a short low piece at the front
              box("tray_side", (0.003, 0.016, 0.02), (tx - tw / 2 + 0.0015, h + y0 + 0.008, tz + td / 2 - 0.01), iron, G),
              box("tray_side", (0.003, 0.016, 0.02), (tx + tw / 2 - 0.0015, h + y0 + 0.008, tz + td / 2 - 0.01), iron, G),
              box("tray_lip", (tw, 0.016, 0.003), (tx, h + y0 + 0.008, tz + td / 2 - 0.0015), iron, G, bev=0.001, seg=1),
              box("tray_plate", (0.05, 0.012, 0.001), (tx, h + y0 + 0.008, tz + td / 2 + 0.0005), plate_m, G),
              text("tray_label", label, 0.0085, (tx, h + y0 + 0.0082, tz + td / 2 + 0.0011), ink, G)]
        base = h + y0 + 0.003
        sheets = []
        for k in range(5):  # live: the app shows 0..5 (desks.md)
            sh = box("sheet", (0.2, 0.0028, 0.25), (tx + DRNG.uniform(-0.004, 0.004), base + 0.0015 + k * 0.003, tz + 0.012), paper, G)
            sh.rotation_euler = (0, 0, DRNG.uniform(-0.03, 0.03))
            sheets.append(sh)
        L.append(LIVE(f"desk_0_{label.lower()}", "bot", sheets, Mx((tx, base, tz + 0.012)), sheets=5, sheet_h=0.003))
    for px in (tx - tw / 2 + 0.004, tx + tw / 2 - 0.004):  # four posts through both tiers to the lid
        for pz in (tz - td / 2 + 0.004, tz + td / 2 - 0.004):
            top = 0.152 if pz < tz else 0.117  # the back pair carry the top shelf (the planes), the front pair stop at IN
            s.append(cyl("tray_post", 0.003, top, (px, h + top / 2, pz), iron, G, 8))
    s.append(box("tray_lid", (tw, 0.003, 0.14), (tx, h + 0.152, tz - td / 2 + 0.07), back_m, G, bev=0.001, seg=1))
    dot = cyl("neon_approval", 0.0075, 0.003, (tx + tw / 2 - 0.016, h + 0.075 + 0.008, tz + td / 2 + 0.0015),
              emitter(AGENTS[0]["color"], 3.0, "neon_approval"), "export", 16, axis="z")
    L.append(LIVE("neon_approval", "neon", [dot]))
    for dx, ry in ((-0.065, 0.25), (0.0, -0.1)):  # two folded planes on the lid (the third is prop_plane)
        pl = paper_plane("plane", 0.5, plastic(POSTIT[0], 0.85, 0, 0.2, "postit_0"), G, two_sided=True)
        s += place([pl], Mx((tx + dx, h + 0.154 + 0.011, -0.22), ry=ry))
    # 2 the ink pad: a round tin (6 cm), its hinged lid standing open at 80 deg behind, red felt inside
    ix, iz = 0.47, 0.13  # 3 cm right of desks.md: clear of the kit's mouse pad (its right edge at x 0.425)
    tin = plastic("#3b3e45", 0.4, 0.7, 0.05, "ink_tin")
    felt = plastic("#b3262e", 0.95, 0, 0.6, "ink_felt")
    s += [lathe("ink_case", [(0, 0), (0.029, 0), (0.03, 0.001), (0.03, 0.011), (0.0285, 0.012), (0.027, 0.012), (0.027, 0.008), (0, 0.008)],
                (ix, h, iz), tin, G, seg=24),
          cyl("ink_felt", 0.0268, 0.002, (ix, h + 0.009, iz), felt, G, 24)]
    Hn = Mx((ix, h + 0.012, iz - 0.03), rx=-math.radians(80))  # the hinge, the lid's back edge
    s += place([lathe("ink_lid", [(0, 0.004), (0.0305, 0.004), (0.031, 0.003), (0.031, 0.0), (0.029, 0.0), (0, 0.001)],
                      (0, -0.004, 0.031), tin, G, seg=24),
                cyl("ink_hinge", 0.0018, 0.012, (0, 0, 0), tin, G, 8, axis="x")], Hn)
    # the stamp (prop_stamp): rubber face, an amber body, a brass band, a waisted neck under a turned wooden knob.
    # Origin = the body's centre, 4.25 cm over the desk (the face at -0.0425), as before
    amber = plastic(AGENTS[0]["color"], 0.4, 0, 0.05, "stamp")
    wood_h = plastic("#c9a36b", 0.6, 0, 0.3, "handle")
    st = [lathe("stamp_face", [(0, -0.0425), (0.0185, -0.0425), (0.019, -0.041), (0.019, -0.0365), (0, -0.0365)], (0, 0, 0),
                plastic("#7a1f1f", 0.7, 0, 0.1, "stamp_rubber"), G, seg=18),
          lathe("stamp_body", [(0, -0.0365), (0.018, -0.0365), (0.018, 0.0), (0.0165, 0.004), (0, 0.004)], (0, 0, 0), amber, G, seg=18),
          lathe("stamp_band", [(0.0168, 0.004), (0.0175, 0.0045), (0.0175, 0.0095), (0.0165, 0.01), (0.0, 0.01)], (0, 0, 0), brass(), G, seg=18),
          lathe("stamp_knob", [(0.0, 0.01), (0.009, 0.01), (0.0075, 0.018), (0.0085, 0.024), (0.015, 0.03), (0.019, 0.036),
                               (0.0185, 0.041), (0.014, 0.0455), (0.0, 0.047)], (0, 0, 0), wood_h, G, seg=18)]
    P.append(("prop_stamp", place(st, Mx((0.535, h + 0.0425, 0.12)))))  # home moves 0.51 -> 0.535 with the pad
    # 3 the tent calendar: a spiral binding along the ridge (16 rings, 4 mm), a page or two flipped over behind
    cx, cz = -0.24, -0.13
    bm = bmesh.new()
    v = [bm.verts.new(W(cx + sx * 0.06, h + y, cz + z)) for sx in (-1, 1) for (y, z) in ((0, 0.035), (0.10, 0), (0, -0.035))]
    for f in ((v[0], v[3], v[4], v[1]), (v[1], v[4], v[5], v[2]), (v[2], v[5], v[3], v[0]), (v[0], v[1], v[2]), (v[5], v[4], v[3])):
        bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    s.append(mesh_obj("calendar", bm, paper, G))
    tilt = -math.atan2(0.035, 0.10)
    Fc = Mx((cx, h + 0.05, cz + 0.0175), rx=tilt)
    s += place([box("cal_band", (0.118, 0.022, 0.002), (0, 0.038, 0.001), plastic(RED, 0.6, 0, 0.1, "cal_band"), G)], Fc)
    cal = quad("screen_cal_0", 0.10, 0.07, paper, "export")
    L.append(LIVE("screen_cal_0", "screen", [place([cal], Mx((0, -0.012, 0.0012)))[0]], None, slot=(0.10, 0.07), frame=Fc))
    wire = plastic("#c8ccd4", 0.3, 0.9, 0, "chrome")
    for k in range(16):
        ring = torus("cal_ring", 0.0022, 0.00045, (0, 0, 0), wire, G, seg=8, rseg=3)
        s += place([ring], Mx((cx - 0.0525 + k * 0.007, h + 0.1, cz), rz=math.pi / 2))
    Fb = Mx((cx, h + 0.05, cz - 0.0175), rx=-tilt)  # the back face: flipped pages lie on it, a little proud, curling
    for k, (dz, w, ht) in enumerate(((-0.0012, 0.112, 0.097), (-0.0024, 0.11, 0.094))):
        pg = box("cal_page", (w, ht, 0.0005), (0, -0.002 * k, dz), plastic("#f4f1ea", 0.9, 0, 0.1, "cal_page"), G)
        s += place([pg], Fb @ Mx(rx=math.radians(2 + 3 * k)))
    # 4 the hourglass (live: turned over while MEMO waits): turned posts with beads, bevelled plates, a waisted glass
    wood_m = plastic("#a0703f", 0.6, 0, 0.3, "hourglass_wood")
    sand = plastic("#ffd27a", 0.9, 0, 0.3, "sand")
    glass = glass_mat("hourglass_glass", "#eef6ff", 0.18)
    hg = [cyl("hg_plate", 0.032, 0.008, (0, 0.051, 0), wood_m, G, 20, bev=0.0015),
          cyl("hg_plate", 0.032, 0.008, (0, -0.051, 0), wood_m, G, 20, bev=0.0015),
          lathe("hg_glass", [(0.004, -0.047), (0.017, -0.044), (0.023, -0.033), (0.02, -0.017), (0.007, -0.005), (0.0028, 0.0),
                             (0.007, 0.005), (0.02, 0.017), (0.023, 0.033), (0.017, 0.044), (0.004, 0.047)], (0, 0, 0), glass, G, seg=22),
          lathe("hg_sand", [(0.0, -0.046), (0.016, -0.044), (0.02, -0.036), (0.012, -0.03), (0.0, -0.026)], (0, 0, 0), sand, G, seg=14),
          lathe("hg_sand", [(0.0, 0.006), (0.006, 0.006), (0.016, 0.016), (0.019, 0.024), (0.0, 0.024)], (0, 0, 0), sand, G, seg=14)]
    post = [(0.003, -0.047), (0.004, -0.043), (0.0025, -0.039), (0.0025, -0.006), (0.0036, 0.0), (0.0025, 0.006),
            (0.0025, 0.039), (0.004, 0.043), (0.003, 0.047)]
    for k in range(3):
        a = 2 * math.pi * k / 3
        hg.append(lathe("hg_post", post, (0.027 * math.cos(a), 0, 0.027 * math.sin(a)), wood_m, G, seg=8))
    Hg = Mx((-0.50, h + 0.055, -0.22))
    L.append(LIVE("desk_0_hourglass", "bot", place(hg, Hg), Hg))
    return s, L, P


SEATS = [seat_memo]
SEAT_SHOTS = {
    0: (("seat0_overview", (0.75, 1.35, 0.95), (0.0, 0.8, -0.12)),
        ("seat0_tray", (0.2, 1.02, 0.22), (0.44, 0.82, -0.16)),
        ("seat0_tray_side", (0.75, 0.95, 0.05), (0.44, 0.82, -0.16)),
        ("seat0_stamp", (0.32, 0.88, 0.33), (0.47, 0.765, 0.12)),
        ("seat0_calendar", (-0.1, 0.95, 0.15), (-0.3, 0.8, -0.16)),
        ("seat0_hourglass", (-0.35, 0.9, -0.02), (-0.5, 0.8, -0.22))),
}

if __name__ == "__main__":
    i = int(next(a.split("=")[1] for a in ARGS if a.startswith("--seat=")))
    G = "kit"
    kit = K.build_kit(G, AGENTS[i]["color"], mouse=(i != 2))
    statics, lives, props = SEATS[i](G)
    items = [("statics (baked)", statics, 0)] + [(f"live {l['name']}", l["objs"], 0) for l in lives] + \
            [(f"prop {n}", objs, 0) for n, objs in props]
    kit_t = K.report("KIT", kit)
    seat_t = K.report(f"SEAT{i}", items)
    print(f"SEAT{i} with kit: {kit_t + seat_t} triangles (cap {SEAT_CAP})")
    K.render(SEAT_SHOTS[i], f"desk_seat{i}.blend")
    print("DONE")
