"""Agent office, first pass (#11): a cut-away room diorama in the dark, modeled and light-baked.

Run:  blender --background --factory-startup --python office_bake.py -- <out_dir> [flags]
  (default)        bake the atlases, write office.glb + <atlas>.webp (+ office.blend)
  --preview        no bake: Cycles renders of the camera shots (preview_<shot>.png), to check modeling
  --shot=a,b       only these preview shots
  --no-bake        unwrap and export office.glb without baking (fast layout checks; no atlases written)
  --stats          print triangles, surface area and texel density per atlas
  --samples N      bake samples (default 1024)   --size N  atlas size (default 2048)   --no-denoise

Same pipeline as the rowansong.dev desk (bakekit.py), so the two rooms read as one world.

Node contract (the app reads glTF extras):
  atlases room, walls_nw, walls_se, work, wall_items, lounge (6 webp) -> MeshBasicMaterial + atlas. Baked nodes:
  room                             the floor, carpet, rug, base edges; extras room = [HX, HZ, WALL_H] (#109: the app
                                   reads the room size here)
  wall_n|e|s|w                     the four walls (#111), pivot_at at the wall's foot (floor, middle of the wall),
                                   extras wall; the app lowers the camera-side ones. n carries the window frame
  door, boards, wallclock          hung on a wall: extras wall (w, n, w). shelf, lounge, desk_<i>, pad_<i>: on the floor
  window_sky|skyline|mid|near, window_lights, window_lights_far, window_portal
                                   the city behind the window (#111): live "sky" (UV 0..1, the app paints it by the
                                   hour), "backdrop", "city_lights" (the app sets day / night strength), at 40 / 25 /
                                   12 / 6 m; "portal" = the window opening, the stencil the cards are masked to.
                                   All extras wall = n
  slot_<name>                      empties: each object's footprint (#109, extras slot, size, wall); the app ignores them
  agent_<i>                        live "bot" empty on the floor: the agent's frame (front = -z)
  agent_<i>_head, _hand_l|r, _hand_l|r_index|fingers|thumb, agent_0_postit_<k>
                                   live "bot": real-time lit parts with pivots (extras pivot_at); fingers bend on local x
  agent_<i>_glow|_beam|_floor, _hand_l|r_cuff, _tip, agent_1_orbit, agent_3_ear_glow, neon_desk_<i>, lamp_shade
                                   live "neon" emitters (hover light, wrist rings, state)
  agent_<i>_face                   live "face": canvas slot like the screens (extras screen, aspect, w, h)
  agent_<i>_hand_l|r_grip          empties, children of the palms: attach a held prop here (extras grip_of)
  screen_work_<i>, screen_door     live "screen" slots the app draws (extras screen, aspect, w, h, ppm); shipped off
  surface_whiteboard|bulletin      empties at the board faces where the app pins cards / notes (extras w, h, normal)
  prop_*, agent_0_pen              live "prop": paddles, cups, watering can, omok stones in hand (prop_piece_a black,
                                   _b white), book (its spine), paper plane, pen
                                   (extras prop, home, grip; the pen's home is on its head: extras home_on)
  prop_book_l|r                    live "bot" (#135): the book's halves, pivot on the spine axis (local z); the app
                                   attaches them to prop_book; _l opens by +180° about local z (lies flat at -x)
  prop_watering_can_spout          empty, child of the can: the spout's end, local +z = the water's way out
  omok_board                       the 15 x 15 board (lounge atlas, 3x texels: the lines are baked)
  omok_grid                        empty at the (0, 0) intersection on the board top, +x = columns, +z = rows
                                   (extras n, cell, stone_h)
  omok_stone_b|w                   live "bot" samples (the app hides them and instances the stones on the board);
                                   pivot = the stone's bottom center
  omok_bowl_b|w                    empties: the grab point in each stone bowl (extras bowl); black by nav_game_a
  pp_ball                          live "bot" (#135): the ball, the app moves it (not a prop); pivot = its center
  pp_table                         empty at the table top center, +x = the long side (extras size [l, w], net_h)
  nav_<id>                         empties: where agents go and which way they face (navigation)
  shelf_r<r>_b<k>, _band, _label, _secret
                                   live "bot": the library binders (#67): cover, spine band, spine label (one cell of
                                   the shared "spines" canvas: extras canvas, grid, px, cell), SECRET stamp (own pivot)
  screen_shelf_r<r>                live "screen": the folder name plate under each library row
  neon_approval                    live "neon": the amber dot on MEMO's IN tray (= the approval box)
  hit_approval, hit_library, hit_clock
                                   empties: click boxes (extras hit, size [w, h, d]; center + axes = the empty)
  clock_hand_h, clock_hand_m, clock_hub
                                   live "bot": the wall clock (#91), pivot_at = face center, local +y = 12 o'clock,
                                   local +z = out of the face; both hands export at 12, clockwise = negative turn about z
Seats 0..3 = MEMO amber, MESH lavender, HUE magenta, LOOP cyan (#26); their forms: docs/design/agents.md 2 (#28).
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bakekit import *  # noqa: E402,F401,F403

RNG = random.Random(7)
DRNG = random.Random(43)  # desk props (#43): their own sequence, so the rest of the room keeps its randomness

# ---------------------------------------------------------------- layout (web meters, floor top y = 0)
# #109: 7 x 5.5 -> 9 x 7 m so that nothing touches (layout rules: .claude/skills/office-bake/SKILL.md 10, checked by
# check-glb --overlap on the slot_* footprints). Zones: work back-left (desks 0-1 under the window, 2-3 along the left
# wall), meeting at the whiteboard (back middle), library back-right, lounge front-right (ping-pong, sofa facing it),
# coffee on the right wall, board games front-left, entrance on the left wall near the front (door + clock).
HX, HZ = 4.5, 3.5  # half room: x -4.5..4.5, z -3.5..3.5 (back wall n at -z, left wall w at -x)
WALL_H = 2.6
WT = 0.14
WORK_Z = 0.5  # where an agent hovers in front of its desk (from the desk center): hands reach the keyboard

AGENTS = [  # desk frame (x, z, ry): the agent sits on local +z and faces local -z (the monitor / the wall)
    {"color": "#ffb347", "at": (-2.8, -3.07, 0.0)},  # 0 MEMO amber (its back edge just clear of the window sill)
    {"color": "#8f9bff", "at": (-1.0, -3.07, 0.0)},  # 1 MESH lavender
    {"color": "#ff3ea5", "at": (-4.14, -1.12, math.pi / 2)},  # 2 HUE magenta (0.6 m clear of MEMO's spot)
    {"color": "#4df3ff", "at": (-4.14, 0.68, math.pi / 2)},  # 3 LOOP cyan
]
WINDOW_X = -1.9  # the window over desks 0-1 (2.6 m wide)
WHITEBOARD_X, BULLETIN_X = 1.1, 2.55
DOOR_Z = 2.6
PINGPONG = (2.2, 0.0)
SOFA = (2.2, 2.6)
GAME_TABLE = (-1.6, 2.2)
SIDE_TABLE = (0.3, 2.6)  # a small round table in the open front middle (designer, #109): visitors' snacks and cheers later
COUNTER = (HX - 0.32, -2.0, math.pi)  # against the right wall, its front (local +x) facing the room
SHELF_X = 3.75
SHELF_W, SHELF_D = 1.1, 0.34  # the bookshelf against the back wall: width, depth
PLANTS = [  # name, species, x, z (#126: one species each, office-quality.md 3; plant_boards left out, designer)
    ("plant_desk", "sansevieria", 0.0, -3.2),  # between MESH's desk and the whiteboard: tall and narrow
    ("plant_corner", "fiddle_fig", 4.22, 3.18),  # its canopy (0.6 m) clears the floor lamp by 0.1 m
    ("plant_sofa", "monstera", 0.925, 2.75),  # between the side table and the sofa: 0.44 m wide, leaves face the camera
]
CLOCK_AT, CLOCK_S = (-HX + 0.02, 1.85, 1.6), 0.40  # wall clock face center (left wall, next to the door), size
CLOCK_M = Mx((CLOCK_AT[0] + 0.01, CLOCK_AT[1], CLOCK_AT[2]), ry=math.pi / 2)  # the face front: local +z = web +x


def frame(at):
    x, z, ry = at
    return Mx((x, 0, z), ry=ry)


def counter_frame():
    """the coffee counter's frame: origin at its floor center, local +x = its front (the machine's spout side)"""
    return frame(COUNTER)


# ---------------------------------------------------------------- layout slots (#109)
# Every object's footprint: the world bounding box (web coords) of its parts, measured before they are joined into an
# atlas mesh, and exported as slot_<name> empties. check-glb --overlap reads them; new models (#108) must fit inside.
# kind: floor (furniture, with the room it needs in use: an agent at a desk, players at the ping-pong ends),
#       decor (plants, lamps), wall (hangs on a wall; extras wall n|e|s|w), clear (floor kept free: in front of the door)
FOOTPRINTS = []


def fp(name, objs, kind, wall=None, grow=(0.0, 0.0)):
    """record the world bounding box of objs as a slot; grow = (x, z) margins added on both sides"""
    bpy.context.view_layer.update()
    lo, hi = [1e9] * 3, [-1e9] * 3
    for o in objs:
        for c in o.bound_box:
            v = o.matrix_world @ Vector(c)
            for k, x in enumerate((v.x, v.z, -v.y)):
                lo[k], hi[k] = min(lo[k], x), max(hi[k], x)
    lo[0], hi[0], lo[2], hi[2] = lo[0] - grow[0], hi[0] + grow[0], lo[2] - grow[1], hi[2] + grow[1]
    FOOTPRINTS.append({"name": name, "kind": kind, "wall": wall, "lo": lo, "hi": hi})


def fp_box(name, kind, lo, hi, wall=None):
    """a slot given directly (web coords): space kept free, not an object"""
    FOOTPRINTS.append({"name": name, "kind": kind, "wall": wall, "lo": list(lo), "hi": list(hi)})


def build_slots():
    fp_box("room", "room", (-HX, 0.0, -HZ), (HX, WALL_H, HZ))  # the inside of the walls
    for f in FOOTPRINTS:
        o = bpy.data.objects.new(f"slot_{f['name']}", None)
        coll("export").objects.link(o)
        lo, hi = f["lo"], f["hi"]
        o.matrix_world = Mx(((lo[0] + hi[0]) / 2, lo[1], (lo[2] + hi[2]) / 2))  # the footprint's center, at its base
        o["slot"] = f["kind"]
        o["size"] = [round(b - a, 3) for a, b in zip(lo, hi)]
        if f["wall"]:
            # a wall item belongs to its wall (it is lowered with it); a floor thing only stands against one (#115:
            # furniture that touches the floor stays when the wall is lowered), so it gets "against", not "wall"
            o["wall" if f["kind"] == "wall" else "against"] = f["wall"]
        NODES.append({"obj": o, "slot": f["kind"]})


PPM = 1024  # suggested canvas resolution for screen slots, pixels per meter (monitor ≈ 584 × 338)


def slot(o, w, h):
    """a screen the app draws (canvas texture): UV fills 0..1 (v = 1 at the top), extras say so"""
    o["screen"] = True
    o["aspect"] = round(w / h, 4)
    o["w"], o["h"] = w, h
    o["ppm"] = PPM
    return o


# ================================================================ ROOM SHELL (atlas: room)
def build_room():
    G = "room"
    floor_wood = wood()
    trim = plastic("#1a1c22", 0.6, 0.2, 0.1, "trim")
    carpet = plastic("#1d2a3d", 0.98, 0, 0.9, "carpet")
    rug = plastic("#5a2f45", 0.97, 0, 0.9, "rug")
    floor = apply_all(box("floor", (2 * HX + 2 * WT, 0.12, 2 * HZ + 2 * WT), (0, -0.06, 0), floor_wood, G, bev=0.01))
    cx0, cx1, cz0, cz1 = -HX, -HX + 4.3, -HZ, -HZ + 4.8  # the work corner carpet
    tile(floor, axes="xz")
    bm = bmesh.new()  # also cut along the carpet's two open edges, then drop the floor top under it
    bm.from_mesh(floor.data)
    for k, c in ((0, cx1), (1, -cz1)):
        no, co = Vector((0, 0, 0)), Vector((0, 0, 0))
        no[k], co[k] = 1.0, c
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no)
    bm.to_mesh(floor.data)
    bm.free()
    drop_faces_in(floor, cx0 - 0.5, cx1, cz0 - 0.5, cz1, 0.0)
    parts = [
        floor,
        # work corner carpet, lounge rug
        box("carpet", (cx1 - cx0, 0.01, cz1 - cz0), ((cx0 + cx1) / 2, 0.005, (cz0 + cz1) / 2), carpet, G),
        rounded_slab("rug", 2.8, 0.01, 1.4, 0.25, (SOFA[0], 0.006, SOFA[1] - 1.05), rug, G),
    ]
    # floor edge trim on all four sides: the cut-away faces read as a model base
    L, D = 2 * HX + 2 * WT, 2 * HZ + 2 * WT
    for name, size, c, n_in, ax in (("edge_n", (L, 0.12, 0.02), (0, -0.06, -D / 2 - 0.01), (0, 0, 1), "x"),
                                    ("edge_s", (L, 0.12, 0.02), (0, -0.06, D / 2 + 0.01), (0, 0, -1), "x"),
                                    ("edge_w", (0.02, 0.12, D + 0.04), (-L / 2 - 0.01, -0.06, 0), (1, 0, 0), "z"),
                                    ("edge_e", (0.02, 0.12, D + 0.04), (L / 2 + 0.01, -0.06, 0), (-1, 0, 0), "z")):
        e = apply_all(box(name, size, c, trim, G))
        drop_facing(e, n_in)  # the side pressed against the floor slab
        parts.append(tile(e, axes=ax))
    for n_out in ((0, 0, -1), (0, 0, 1), (-1, 0, 0), (1, 0, 0)):  # the slab's own sides: covered by the edge trims
        drop_facing(floor, n_out)
    # the city outside is no longer baked here (layered cards at 6–40 m: build_window_view, #111). The old baked city
    # drew from RNG: make the same draws so everything built after it (books, leaves) stays as it was.
    x = WINDOW_X - 1.3 - 0.15
    while x < WINDOW_X + 1.3 + 0.15:
        w = RNG.uniform(0.18, 0.42)
        h = RNG.uniform(0.25, 0.85)
        for _ in range(RNG.randint(2, 6)):
            RNG.uniform(0.04, w - 0.04), RNG.uniform(0.0, h - 0.1), RNG.choice((0, 0, 1))
        x += w + RNG.uniform(0.02, 0.08)
    o = join("room", parts)
    o["room"] = [HX, HZ, WALL_H]  # #109: the app reads the room size from here (floor bounds, walls, camera)
    return o


def tile(o, step=2.4, axes="xz", cuts_y=()):
    """cut a large flat part into ~step-sized tiles and split them apart, so the atlas packs small islands instead of
    one 9 m board (UV fill went 44% -> ~70%). Seams don't show: the bake extends each island's edge (margin 16 px)."""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    cut_edges = []
    lo = [min(v.co[k] for v in bm.verts) for k in range(3)]
    hi = [max(v.co[k] for v in bm.verts) for k in range(3)]
    planes = []
    for ax in axes:  # web axis -> Blender axis index (web x = X, web z = -Y)
        k = {"x": 0, "z": 1}[ax]
        n = max(1, round((hi[k] - lo[k]) / step))
        planes += [(k, lo[k] + (hi[k] - lo[k]) * i / n) for i in range(1, n)]
    planes += [(2, y) for y in cuts_y]
    for k, c in planes:
        no = Vector((0, 0, 0))
        no[k] = 1.0
        co = Vector((0, 0, 0))
        co[k] = c
        res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no)
        cut_edges += [e for e in res["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    bmesh.ops.split_edges(bm, edges=[e for e in set(cut_edges) if e.is_valid])
    bm.to_mesh(o.data)
    bm.free()
    return o


def drop_facing(o, n_web, plane=None, tol=0.95):
    """delete faces whose normal points along n_web (web coords) — faces pressed against something and never seen.
    plane = (web axis 'x'|'z', coordinate): only faces lying on that plane."""
    nb = Vector((n_web[0], -n_web[2], n_web[1]))
    bm = bmesh.new()
    bm.from_mesh(o.data)
    dead = []
    for f in bm.faces:
        if f.normal.dot(nb) < tol:
            continue
        if plane:
            c = f.calc_center_median()
            v = c.x if plane[0] == "x" else -c.y
            if abs(v - plane[1]) > 1e-3:
                continue
        dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(o.data)
    bm.free()


def drop_faces_in(o, x0, x1, z0, z1, y):
    """delete the upward faces at height y inside a web-coords rectangle (floor hidden under the carpet)"""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    dead = []
    for f in bm.faces:
        c = f.calc_center_median()
        if f.normal.z > 0.95 and abs(c.z - y) < 1e-3 and x0 < c.x < x1 and z0 < -c.y < z1:
            dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    bm.to_mesh(o.data)
    bm.free()


# ================================================================ WALLS (#111: four walls, atlases walls_nw / walls_se)
# Each wall is its own node (wall_n, wall_e, wall_s, wall_w; n = back -z, w = left -x) with its band, chair rail,
# baseboard and cap, pivot at its foot (pivot_at on the floor, the wall's middle) so the app can lower the one(s) on
# the camera side down to a 0.15 m strip. Outer faces are only kept for that strip (a skirt 0.3 m high): above it the
# outside of a wall is never seen (the wall is lowered whenever the camera is on its side). The n wall carries the
# window frame. Things hung on a wall carry extras wall = n|e|s|w (wall_items, the door, the clock, the window view).
def build_wall(side):
    G = "walls_nw" if side in "nw" else "walls_se"
    wall = plastic("#3a3f4c", 0.85, 0, 0.25, "wall")
    wall_low = plastic("#2b2f3a", 0.8, 0, 0.3, "wall_low")
    trim = plastic("#1a1c22", 0.6, 0.2, 0.1, "trim")
    along_x = side in "ns"
    sgn = -1 if side in "nw" else 1
    inner = sgn * (HZ if along_x else HX)  # the inside face's coordinate (z for n/s, x for e/w)
    run = 2 * HX + 2 * WT if along_x else 2 * HZ  # n/s span the corners, e/w fit between them

    def at(off, y, size_run, size_up, size_in):
        """a box against this wall: off = distance from the inside face into the room (negative = into the wall)"""
        c = inner - sgn * off
        size = (size_run, size_up, size_in) if along_x else (size_in, size_up, size_run)
        center = (0, y, c) if along_x else (c, y, 0)
        return size, center

    s, c = at(-WT / 2, WALL_H / 2, run, WALL_H, WT)
    slab = box(f"wall_{side}_slab", s, c, wall, G)
    if side == "n":  # the window over desks 0-1
        cs, cc = (2.6, 1.05, WT * 3), (WINDOW_X, 1.72, inner - sgn * -WT / 2)
        slab = cut(apply_all(slab), apply_all(box("win_cut", cs, cc, wall, G)))
    slab = apply_all(slab)
    # drop the outer face (the plane at inner + sgn * WT); a skirt replaces its bottom
    bm = bmesh.new()
    bm.from_mesh(slab.data)
    outer = inner + sgn * WT
    k = 1 if along_x else 0  # Blender axis of the wall normal: web z = -Blender y, web x = Blender x
    out_b = -outer if along_x else outer
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if abs(f.calc_center_median()[k] - out_b) < 1e-4], context="FACES")
    bm.to_mesh(slab.data)
    bm.free()
    # tiles along the wall (atlas packing), cut at the chair rail: below it the inside face takes the darker band
    # colour (a material, not a box in front: the box hid the wall face behind it and spent atlas twice)
    if not along_x:  # e / w end faces butt against the n / s walls: never seen
        drop_facing(slab, (0, 0, -1), ("z", -HZ))
        drop_facing(slab, (0, 0, 1), ("z", HZ))
    tile(slab, axes="x" if along_x else "z", cuts_y=(0.95,))
    slab.data.materials.append(wall_low)
    in_b = -inner if along_x else inner
    for f in slab.data.polygons:
        c = f.center
        if abs(c[k] - in_b) < 1e-4 and c.z < 0.95:
            f.material_index = 1
    p = [slab]
    p += [box(f"wall_{side}_skirt", *at(-WT - 0.001, 0.15, run, 0.3, 0.002), wall_low, G)]
    span = 2 * HX if along_x else 2 * HZ
    p += [box(f"wall_{side}_rail", *at(0.015, 0.96, span, 0.03, 0.03), trim, G),
          box(f"wall_{side}_base", *at(0.01, 0.04, span, 0.08, 0.02), trim, G),
          box(f"wall_{side}_cap", *at(-WT / 2, WALL_H + 0.015, run, 0.03, WT + 0.02), trim, G)]
    if side == "n":
        wx, wy, ww, wh = WINDOW_X, 1.72, 2.6, 1.05
        frame_m = plastic("#15171c", 0.4, 0.6, 0.05, "window_frame")
        win = [box("win_top", (ww + 0.08, 0.05, 0.1), (wx, wy + wh / 2, -HZ), frame_m, G),
               box("win_bot", (ww + 0.12, 0.05, 0.16), (wx, wy - wh / 2, -HZ + 0.03), frame_m, G),
               box("win_l", (0.05, wh, 0.1), (wx - ww / 2, wy, -HZ), frame_m, G),
               box("win_r", (0.05, wh, 0.1), (wx + ww / 2, wy, -HZ), frame_m, G)]
        fp("window", win, "wall", "n")
        for k2 in (1, 2, 3):
            win.append(box("mullion", (0.03, wh, 0.05), (wx - ww / 2 + k2 * ww / 4, wy, -HZ), frame_m, G))
        win.append(box("transom", (ww, 0.03, 0.05), (wx, wy + 0.18, -HZ), frame_m, G))
        p += win
    o = join(f"wall_{side}", p)
    foot = (0, 0, inner) if along_x else (inner, 0, 0)
    o = pivot(o, Mx(foot))
    o["wall"] = side
    return o


# ================================================================ WINDOW VIEW (#111: layered cards, live, not baked)
# Real planes behind the window so the city keeps its parallax from any orbit angle: sky 40 m, far skyline 25 m,
# mid buildings 12 m (their lit windows a node of their own: the app sets day / night strength), a near building
# corner 6 m. Widths cover every line of sight through the window from the orbit (polar 0.15–1.35, all around).
# All carry extras wall = "n": when the n wall is lowered the app hides them with it. Drawn MeshBasic, unlit.
VRNG = random.Random(111)


def build_window_view():
    zw = -HZ - WT  # the wall's outside
    cx = WINDOW_X
    out = []
    sky = quad("window_sky", 200.0, 110.0, emitter("#16213d", 1.0, "window_sky"), "export")  # UV 0..1, v = 1 at the top
    out.append((apply_all(place([sky], Mx((cx, 25.0, zw - 40.0)))[0]), "sky"))

    def towers(name, dist, x_half, w_rng, top_rng, base, color):
        bm = bmesh.new()
        x = cx - x_half
        while x < cx + x_half:
            w, top = VRNG.uniform(*w_rng), VRNG.uniform(*top_rng)
            v = [bm.verts.new(W(x + dx, y, zw - dist)) for dx, y in ((0, base), (w, base), (w, top), (0, top))]
            bm.faces.new(v)
            x += w + VRNG.uniform(0.0, w_rng[0] * 0.5)
        return mesh_obj(name, bm, emitter(color, 1.0, name), "export")

    # the office is high up: most roofs sit below eye level (1.55 m), a few towers reach above
    sky_line = towers("window_skyline", 25.0, 70.0, (2.5, 7.0), (-3.0, 5.0), -40.0, "#0d1426")
    out.append((sky_line, "backdrop"))
    mid = towers("window_mid", 12.0, 30.0, (2.0, 5.0), (-2.0, 4.0), -30.0, "#07080c")
    out.append((mid, "backdrop"))

    def window_cells(name, facades, dist, cell, step, y_low, x_half, color, keep):
        """lit-window cells on each facade: a grid (step) of cell-sized quads from y_low up to just under the roof,
        within x_half of the window; one quad per cell, the app picks which ones are on (#122). Seen through the
        window from inside, the band that shows is roughly y -0.6..6.7 m at 12 m and -2.6..11.6 m at 25 m."""
        bm = bmesh.new()
        vs = facades.data.vertices
        for pl in facades.data.polygons:  # each facade: its x range and top (Blender z = web y)
            x0, x1 = min(vs[i].co.x for i in pl.vertices), max(vs[i].co.x for i in pl.vertices)
            top = max(vs[i].co.z for i in pl.vertices)
            if x1 < cx - x_half or x0 > cx + x_half:
                continue
            y = y_low
            while y + cell[1] < top - 0.4:
                x = x0 + 0.3
                while x + cell[0] < x1 - 0.3:
                    if VRNG.random() < keep:  # not every bay is a window: the grid reads less regular
                        v = [bm.verts.new(W(x + dx, y + dy, zw - dist + 0.05)) for dx, dy in ((0, 0), (cell[0], 0), (cell[0], cell[1]), (0, cell[1]))]
                        bm.faces.new(v)
                    x += step[0]
                y += step[1]
        return mesh_obj(name, bm, emitter(color, 2.2, name), "export")

    # lit windows: nodes of their own (the app lights some of the cells by the hour, #122)
    lights = window_cells("window_lights", mid, 12.0, (0.45, 0.7), (1.0, 1.3), -6.0, 30.0, "#ffcf8a", 0.75)
    # 25 m: dots (#123: "half the 12 m rate, small as points"; the app lights half the share it lights at 12 m)
    far = window_cells("window_lights_far", sky_line, 25.0, (0.25, 0.35), (0.6, 0.8), -6.0, 25.0, "#ffd9a0", 0.7)
    out.append((far, "city_lights"))
    out.append((lights, "city_lights"))
    near = box("window_near", (3.0, 40.0, 3.0), (cx - 8.0, -6.0, zw - 6.0 - 1.5), emitter("#05060a", 1.0, "window_near"), "export")
    out.append((apply_all(near), "backdrop"))
    # the room has no ceiling and the camera orbits outside it, so the cards must only show THROUGH the window: this
    # quad fills the window opening (mid-wall, facing the room); the app draws it into the stencil and the cards
    # only where the stencil is set
    portal = quad("window_portal", 2.6, 1.05, emitter("#000000", 0.0, "window_portal"), "export")
    out.append((apply_all(place([portal], Mx((cx, 1.72, -HZ - WT / 2)))[0]), "portal"))
    for o, _ in out:
        o["wall"] = "n"
    return out
    return join("room", parts)


# ================================================================ WORK AREA (atlas: work)
def build_desk(i, agent):
    G = "work"
    F = frame(agent["at"])
    top = plastic("#c9b89a", 0.55, 0, 0.35, "desk_top")
    metal = plastic("#2a2c31", 0.35, 0.8, 0.03, "desk_metal")
    dark = plastic("#16181d", 0.5, 0.3, 0.05, "monitor")
    w, d, h = 1.2, 0.62, 0.74
    p = [rounded_slab("desk_top", w, 0.035, d, 0.02, (0, h - 0.0175, 0), top, G, edge=0.004),
         box("modesty", (w - 0.1, 0.38, 0.02), (0, h - 0.24, -d / 2 + 0.05), metal, G)]
    for sx in (-w / 2 + 0.05, w / 2 - 0.05):
        p += [box("leg", (0.04, h - 0.035, 0.04), (sx, (h - 0.035) / 2, -d / 2 + 0.05), metal, G),
              box("leg", (0.04, h - 0.035, 0.04), (sx, (h - 0.035) / 2, d / 2 - 0.05), metal, G),
              box("foot", (0.05, 0.03, d - 0.05), (sx, 0.015, 0), metal, G)]
    # monitor on an arm, keyboard, mouse; the rest of the desk is its owner's (#43: desk_props_*)
    mon = rounded_slab("mon_body", 0.62, 0.04, 0.38, 0.015, (0, 0, 0), dark, G, edge=0.004)
    mon.rotation_euler = (math.pi / 2, 0, 0)  # monitor body stands up
    mon.location = W(0, h + 0.36, -0.2)
    p += [box("mon_base", (0.2, 0.015, 0.16), (0, h + 0.0075, -0.18), dark, G, bev=0.004),
          box("mon_neck", (0.04, 0.22, 0.03), (0, h + 0.12, -0.21), dark, G),
          mon,
          rounded_slab("kb", 0.42, 0.018, 0.13, 0.01, (0, h + 0.009, 0.06), plastic("#2c3038", 0.6, 0, 0.1, "kb"), G, edge=0.003)]
    if i != 2:  # HUE has a pen tablet in the mouse spot
        p.append(rounded_slab("mouse", 0.06, 0.02, 0.1, 0.025, (0.3, h + 0.01, 0.07), plastic("#2c3038", 0.4, 0, 0.1, "kb"), G))
    if i == 1:  # only MESH kept the mug
        p.append(cyl("mug", 0.04, 0.09, (-0.42, h + 0.045, -0.05), plastic("#d64545", 0.4, 0, 0.1, "mug_1"), G, 20))
    if i % 2 == 0:  # the old plants drew from RNG: keep its sequence so the rest of the room stays as it was
        for _ in range(5 * 4):
            RNG.uniform(0, 1)
    statics, desk_live = DESK_PROPS[i](G)
    if "--tris" in ARGS:  # what the owner's things add (modifiers and text evaluated)
        dg = bpy.context.evaluated_depsgraph_get()
        n = 0
        for o in statics + [o for e in desk_live for o in e["objs"]]:
            if o.type in ("MESH", "CURVE", "FONT"):
                me = o.evaluated_get(dg).to_mesh()
                n += sum(len(p.vertices) - 2 for p in me.polygons)
                o.evaluated_get(dg).to_mesh_clear()
        print(f"desk_{i} props: {n} triangles")
    p += statics
    placed = place(p, F)
    # no chair: agents hover at their desk. A floor pad in the agent's color marks the spot instead.
    pad = rounded_slab("pad", 0.62, 0.006, 0.5, 0.12, (0, 0.003, 0), plastic(agent["color"], 0.9, 0, 0.6, f"pad_{i}"), G)
    pad = place([pad], F @ Mx((0, 0, WORK_Z)))
    fp(f"desk_{i}", placed + pad, "floor")  # the desk and the agent's spot in front of it
    desk = join(f"desk_{i}", placed)
    pad = join(f"pad_{i}", pad)
    # live parts: the screen slot and a neon strip under the desk's front edge
    scr = quad(f"screen_work_{i}", 0.57, 0.33, screen_mat(f"screen_glow_{i}", agent["color"], 0.45), "export")
    screen = slot(apply_all(place(scr, F @ Mx((0, h + 0.36, -0.178)))[0]), 0.57, 0.33)
    strip = box(f"neon_desk_{i}", (w - 0.04, 0.006, 0.006), (0, 0, 0), emitter(agent["color"], 3.0, f"neon_desk_{i}"), "export")
    neon = apply_all(place(strip, F @ Mx((0, h - 0.04, d / 2 - 0.004)))[0])
    return [desk, pad], [screen, neon], place_desk_live(F, desk_live)


# ================================================================ DESK PROPS (#43, docs/design/desks.md 2 + 4)
# Each owner's things on their desk. Built in the desk frame (x = right of the seated agent, z + = toward the
# agent, y = height from the floor, desk top at DESK_H). Plain things are baked into desk_<i>; things the app
# changes from data are live nodes (LIVE below), placed like the other live parts. The hands' band in front of
# the keyboard (x ±0.28, z -0.03..0.31) and the mouse spot stay empty.
DESK_H = 0.74
RED = "#ff5a5f"  # --color-red
TRAY = (0.44, -0.16, 0.24, 0.30)  # MEMO's IN/OUT tray: x, z, width, depth (right end: the left end hides behind HUE's head)


def paper_plane(name, s, material, group, two_sided=False):
    """the post-it plane (#27): nose = local -z, resting on its keel (keel bottom at y = -0.022 * s).
    two_sided: a second skin with flipped faces (baked copies: the app draws atlas meshes front faces only)"""
    bm = bmesh.new()
    pts = ((0, 0, -0.085), (-0.06, 0.012, 0.075), (0.06, 0.012, 0.075), (0, 0.004, 0.075), (0, -0.022, 0.075))
    for skin in ((0, False), (-0.0006, True)) if two_sided else ((0, False),):
        N, L, R, T, K = [bm.verts.new(W(p[0] * s, p[1] * s + skin[0], p[2] * s)) for p in pts]
        for f in ((N, T, L), (N, R, T), (N, K, T)):
            bm.faces.new(tuple(reversed(f)) if skin[1] else f)
    return mesh_obj(name, bm, material, group)


def LIVE(name, kind, objs, at=None, **extras):
    """a live desk part: objs in the desk frame; at = its pivot in the desk frame (Matrix), or None (no pivot)"""
    return {"name": name, "kind": kind, "objs": objs, "at": at, "extras": extras}


def desk_props_memo(G):
    h = DESK_H
    s, L = [], []
    grey = plastic("#5a606c", 0.45, 0.6, 0.05, "tray")
    paper = plastic("#efece4", 0.9, 0, 0.1, "paper")
    ink = plastic("#e9edf5", 0.5, 0, 0, "tray_label")
    tx, tz, tw, td = TRAY
    # 1 IN / OUT two-tier tray, open to the agent: IN on top (waiting for sign-off), OUT below (handed off today)
    for y0, label in ((0.075, "IN"), (0.0, "OUT")):
        s += [box("tray_floor", (tw, 0.004, td), (tx, h + y0 + 0.002, tz), grey, G),
              box("tray_back", (tw, 0.035, 0.004), (tx, h + y0 + 0.0175, tz - td / 2 + 0.002), grey, G),
              box("tray_side", (0.004, 0.035, td), (tx - tw / 2 + 0.002, h + y0 + 0.0175, tz), grey, G),
              box("tray_side", (0.004, 0.035, td), (tx + tw / 2 - 0.002, h + y0 + 0.0175, tz), grey, G),
              box("tray_lip", (tw, 0.02, 0.004), (tx, h + y0 + 0.01, tz + td / 2 - 0.002), grey, G),
              text("tray_label", label, 0.014, (tx, h + y0 + 0.011, tz + td / 2 + 0.0005), ink, G)]
        # the paper stack: 5 sheets (0.003 each) exported; the app shows 0..5 by scaling y (pivot at the bottom)
        base = h + y0 + 0.004
        sheets = []
        for k in range(5):
            sh = box("sheet", (0.2, 0.0028, 0.25), (tx + DRNG.uniform(-0.004, 0.004), base + 0.0015 + k * 0.003, tz + 0.012), paper, G)
            sh.rotation_euler = (0, 0, DRNG.uniform(-0.03, 0.03))
            sheets.append(sh)
        L.append(LIVE(f"desk_0_{label.lower()}", "bot", sheets, Mx((tx, base, tz + 0.012)), sheets=5, sheet_h=0.003))
    for px in (tx - tw / 2 + 0.004, tx + tw / 2 - 0.004):
        for pz in (tz - td / 2 + 0.004, tz + td / 2 - 0.004):
            s.append(box("tray_post", (0.006, 0.15, 0.006), (px, h + 0.075, pz), grey, G))
    s.append(box("tray_lid", (tw, 0.004, 0.14), (tx, h + 0.152, tz - td / 2 + 0.07), grey, G))
    # #67: IN doubles as the approval box. A 1.5 cm amber dot on its front lip, right corner: on while approvals wait
    dot = cyl("neon_approval", 0.0075, 0.003, (tx + tw / 2 - 0.016, h + 0.075 + 0.01, tz + td / 2 + 0.0015),
              emitter(AGENTS[0]["color"], 3.0, "neon_approval"), "export", 16, axis="z")
    L.append(LIVE("neon_approval", "neon", [dot]))
    # 3 two folded planes on the lid (the third, prop_plane, is the one MEMO throws: build_props)
    for dx, ry in ((-0.065, 0.25), (0.0, -0.1)):
        pl = paper_plane("plane", 0.5, plastic(POSTIT[0], 0.85, 0, 0.2, "postit_0"), G, two_sided=True)
        s += place([pl], Mx((tx + dx, h + 0.154 + 0.011, -0.22), ry=ry))
    # 2 ink pad (the stamp itself is the live prop_stamp: build_props)
    s += [box("ink_pad", (0.07, 0.015, 0.05), (0.44, h + 0.0075, 0.13), plastic("#2a2c31", 0.5, 0.3, 0.05, "ink_case"), G, bev=0.003, seg=1),
          box("ink", (0.06, 0.001, 0.04), (0.44, h + 0.0155, 0.13), plastic(RED, 0.8, 0, 0.1, "ink"), G)]
    # 4 desk calendar (tent): front face = canvas slot screen_cal_0 (today), a red band above it
    cx, cz = -0.24, -0.13
    bm = bmesh.new()
    v = [bm.verts.new(W(cx + sx * 0.06, h + y, cz + z)) for sx in (-1, 1) for (y, z) in ((0, 0.035), (0.10, 0), (0, -0.035))]
    for f in ((v[0], v[3], v[4], v[1]), (v[1], v[4], v[5], v[2]), (v[2], v[5], v[3], v[0]), (v[0], v[1], v[2]), (v[5], v[4], v[3])):
        bm.faces.new(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    s.append(mesh_obj("calendar", bm, paper, G))
    tilt = -math.atan2(0.035, 0.10)
    Fc = Mx((cx, h + 0.05, cz + 0.0175), rx=tilt)  # center of the front face, local +z = out of the face
    s += place([box("cal_band", (0.118, 0.022, 0.002), (0, 0.038, 0.001), plastic(RED, 0.6, 0, 0.1, "cal_band"), G)], Fc)
    cal = quad("screen_cal_0", 0.10, 0.07, paper, "export")
    L.append(LIVE("screen_cal_0", "screen", [place([cal], Mx((0, -0.012, 0.0012)))[0]], None, slot=(0.10, 0.07), frame=Fc))
    # 5 hourglass: pivot at its center; the app turns it over while MEMO waits for a sign-off
    wood_m = plastic("#a0703f", 0.6, 0, 0.3, "hourglass_wood")
    sand = plastic("#ffd27a", 0.9, 0, 0.3, "sand")
    glass = glass_mat("hourglass_glass", "#eef6ff", 0.18)
    hg = [cyl("hg_plate", 0.032, 0.008, (0, 0.051, 0), wood_m, G, 20), cyl("hg_plate", 0.032, 0.008, (0, -0.051, 0), wood_m, G, 20),
          cyl("hg_bulb", 0.004, 0.047, (0, 0.0235, 0), glass, G, 16, r2=0.024),
          cyl("hg_bulb", 0.024, 0.047, (0, -0.0235, 0), glass, G, 16, r2=0.004),
          cyl("hg_sand", 0.019, 0.016, (0, -0.039, 0), sand, G, 14, r2=0.004),
          cyl("hg_sand", 0.004, 0.012, (0, 0.012, 0), sand, G, 10, r2=0.012)]
    for k in range(3):
        a = 2 * math.pi * k / 3
        hg.append(cyl("hg_post", 0.003, 0.094, (0.027 * math.cos(a), 0, 0.027 * math.sin(a)), wood_m, G, 6))
    Hg = Mx((-0.50, h + 0.055, -0.22))
    L.append(LIVE("desk_0_hourglass", "bot", place(hg, Hg), Hg))
    return s, L


def desk_props_mesh(G):
    h = DESK_H
    s, L = [], []
    dark = plastic("#2c3038", 0.5, 0.2, 0.05, "kb")
    ivory = plastic("#ece6d8", 0.45, 0, 0.1, "ivory")
    grey = plastic("#9aa0aa", 0.5, 0, 0.1, "prim_grey")
    lav = plastic(AGENTS[1]["color"], 0.4, 0, 0.05, "turntable_rim")
    lb = lav.node_tree.nodes["Principled BSDF"]
    lb.inputs["Emission Color"].default_value = rgba(AGENTS[1]["color"])
    lb.inputs["Emission Strength"].default_value = 0.5
    # 1 turntable: baked base, live platter + cube (spins about local y while MESH bakes)
    tx, tz = -0.43, -0.18
    s.append(cyl("tt_base", 0.075, 0.008, (tx, h + 0.004, tz), dark, G, 28))
    Tt = Mx((tx, h + 0.008, tz))
    tt = [cyl("tt_platter", 0.07, 0.012, (0, 0.006, 0), plastic("#3a3f48", 0.4, 0.3, 0.05, "platter"), G, 28),
          torus("tt_rim", 0.07, 0.004, (0, 0.009, 0), lav, G, seg=28, rseg=5),
          box("tt_cube", (0.05, 0.05, 0.05), (0, 0.037, 0), ivory, G, bev=0.003, seg=1, rot_y=0.4)]
    L.append(LIVE("desk_1_turntable", "bot", place(tt, Tt), Tt))
    # 2 color checker card (muted 6 x 4 chips) leaning on the monitor base, 70° from the desk
    chips = ["#735244", "#c29682", "#627a9d", "#576c43", "#8580b1", "#67bdaa", "#d67e2c", "#505ba6", "#c15a63", "#5e3c6c",
             "#9dbc40", "#e0a32e", "#383d96", "#469449", "#af363c", "#e7c71f", "#bb5695", "#0885a1", "#f3f3f2", "#c8c8c8",
             "#a0a0a0", "#7a7a79", "#555555", "#343434"]
    card = [box("checker", (0.15, 0.10, 0.003), (0, 0.05, 0), plastic("#111216", 0.6, 0, 0, "checker"), G)]
    for k, c in enumerate(chips):
        col, row = k % 6, k // 6
        card.append(box("chip", (0.019, 0.019, 0.001), (-0.0575 + col * 0.023, 0.085 - row * 0.023, 0.002), plastic(c, 0.7, 0, 0, f"chip_{c[1:]}"), G))
    s += place(card, Mx((0.15, h, -0.09), rx=-math.radians(20)))
    # 3 ring light: baked base + pole, live ring (lavender, facing the agent)
    rx_, rz_ = 0.46, -0.20
    s += [cyl("rl_base", 0.05, 0.01, (rx_, h + 0.005, rz_), dark, G, 24),
          cyl("rl_pole", 0.006, 0.25, (rx_, h + 0.01 + 0.125, rz_), dark, G, 8)]
    Rl = Mx((rx_, h + 0.26 + 0.07, rz_))
    ring = torus("ringlight", 0.07, 0.009, (0, 0, 0), emitter(AGENTS[1]["color"], 3.0, "ringlight"), "export", axis="z", seg=32, rseg=6)
    L.append(LIVE("desk_1_ringlight", "neon", place([ring], Rl), Rl))
    # 4 primitives: sphere, cone, torus
    s += [sphere("prim_sphere", 0.03, (-0.48, h + 0.03, 0.12), ivory, G, seg=16, rings=10),
          cyl("prim_cone", 0.03, 0.06, (-0.40, h + 0.03, 0.19), grey, G, 18, r2=0.0),
          torus("prim_torus", 0.035, 0.011, (-0.36, h + 0.011, 0.09), ivory, G, seg=20, rseg=8)]
    return s, L


def desk_props_hue(G):
    h = DESK_H
    s, L = [], []
    dark = plastic("#2c3038", 0.5, 0.2, 0.05, "kb")
    # 1 swatch fan in the team's four colors (amber, lavender, magenta, cyan from the left), pinned at the bottom
    fx, fz = -0.40, -0.16
    s.append(box("fan_base", (0.04, 0.014, 0.03), (fx, h + 0.007, fz), dark, G, bev=0.003, seg=1))
    for k, (a, deg) in enumerate(zip(AGENTS, (27, 9, -9, -27))):
        chip = box("swatch", (0.035, 0.16, 0.003), (0, 0.08, 0), plastic(a["color"], 0.5, 0, 0.05, f"swatch_{k}"), G, bev=0.001, seg=1)
        s += place([chip], Mx((fx, h + 0.01, fz - 0.006 + k * 0.004), rz=math.radians(deg)))
    s.append(cyl("fan_pin", 0.006, 0.02, (fx, h + 0.018, fz), plastic("#c8ccd4", 0.3, 0.9, 0, "chrome"), G, 10, axis="z"))
    # 2 pen tablet in the mouse spot (baked) + live active-area outline (glows while HUE edits)
    bx, bz = 0.36, 0.06
    s += [rounded_slab("tablet", 0.20, 0.012, 0.14, 0.012, (bx, h + 0.006, bz), plastic("#22252c", 0.5, 0.1, 0.05, "tablet"), G),
          segment("tablet_pen", (bx + 0.075, h + 0.017, bz - 0.06), (bx + 0.085, h + 0.017, bz + 0.065), 0.005, plastic("#1a1c21", 0.4, 0.2, 0, "pen_dark"), G, verts=10, r2=0.003)]
    mag = emitter(AGENTS[2]["color"], 2.0, "tablet_area")
    aw, ad, t = 0.13, 0.09, 0.003
    area = [box("area", (aw, 0.001, t), (0, 0, -ad / 2), mag, "export"), box("area", (aw, 0.001, t), (0, 0, ad / 2), mag, "export"),
            box("area", (t, 0.001, ad), (-aw / 2, 0, 0), mag, "export"), box("area", (t, 0.001, ad), (aw / 2, 0, 0), mag, "export")]
    Ta = Mx((bx - 0.01, h + 0.0125, bz))
    L.append(LIVE("desk_2_tablet", "neon", place(area, Ta), Ta))
    # 3 small succulent: an echeveria rosette (#126)
    s += plant_tris("succulent", echeveria("succulent", 0.24, h, -0.18, G))
    # 4 bent desk lamp: base far back-left, two arm segments, shade over the swatch fan; live = the bulb
    base, elbow, head = (-0.52, h + 0.012, -0.26), (-0.53, h + 0.33, -0.24), (-0.40, h + 0.27, -0.13)
    joint = plastic("#3a3f48", 0.4, 0.5, 0.05, "lamp")
    s += [cyl("lamp_base", 0.05, 0.012, (base[0], h + 0.006, base[2]), joint, G, 24),
          segment("lamp_arm", base, elbow, 0.007, joint, G, verts=8),
          segment("lamp_arm", elbow, head, 0.007, joint, G, verts=8),
          sphere("lamp_joint", 0.011, elbow, joint, G, seg=10, rings=6)]
    Sh = Mx((-0.40, h + 0.24, -0.12), rx=math.radians(20))  # shade axis: down, tipped toward the fan
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=20, radius1=0.04, radius2=0.016, depth=0.06)
    shade = mesh_obj("lamp_shade", bm, joint, G)
    shade.modifiers.new("wall", "SOLIDIFY").thickness = 0.002  # seen from below too (atlas meshes are one-sided)
    s += place([shade, cyl("lamp_cap", 0.016, 0.01, (0, 0.033, 0), joint, G, 12)], Sh)
    bulb = [cyl("bulb", 0.034, 0.002, (0, -0.02, 0), emitter("#ffe2b0", 4.0, "desk_lamp"), "export", 20),
            sphere("bulb", 0.014, (0, -0.012, 0), emitter("#ffe2b0", 4.0, "desk_lamp"), "export", seg=10, rings=6)]
    L.append(LIVE("desk_2_lamp", "neon", place(bulb, Sh), Sh))
    return s, L


def desk_props_loop(G):
    h = DESK_H
    s, L = [], []
    dark = plastic("#2c3038", 0.5, 0.2, 0.05, "kb")
    metal = plastic("#c8ccd4", 0.3, 0.9, 0, "chrome")
    # 1 signal tower: baked base / pole / cap, three live lights (green bottom, yellow, red top)
    sx_, sz_ = 0.47, -0.24
    s += [cyl("sig_base", 0.022, 0.008, (sx_, h + 0.004, sz_), dark, G, 16),
          cyl("sig_pole", 0.006, 0.06, (sx_, h + 0.038, sz_), metal, G, 8),
          cyl("sig_cap", 0.026, 0.012, (sx_, h + 0.068 + 3 * 0.045 + 0.006, sz_), dark, G, 16, bev=0.002)]
    for k, (tag, c) in enumerate((("g", "#39d98a"), ("y", "#ffd23f"), ("r", RED))):
        At = Mx((sx_, h + 0.068 + 0.0225 + k * 0.045, sz_))
        lamp = cyl(f"signal_{tag}", 0.025, 0.043, (0, 0, 0), emitter(c, 3.0, f"signal_{tag}"), "export", 16)
        L.append(LIVE(f"desk_3_signal_{tag}", "neon", place([lamp], At), At))
    # 2 rubber duck (baked) looking toward the keyboard; desk_3_duck_look = the point LOOP turns to on a failure
    dx, dz = -0.34, 0.12
    yellow = plastic("#ffd23f", 0.35, 0, 0.05, "duck")
    s += [sphere("duck_body", 0.03, (dx, h + 0.022, dz), yellow, G, scale=(1.2, 0.75, 1.0), seg=16, rings=10),
          sphere("duck_head", 0.018, (dx + 0.016, h + 0.052, dz), yellow, G, seg=14, rings=8),
          cyl("duck_beak", 0.008, 0.014, (dx + 0.038, h + 0.05, dz), plastic(RED, 0.5, 0, 0, "beak"), G, 10, axis="x", r2=0.004),
          cyl("duck_tail", 0.012, 0.02, (dx - 0.036, h + 0.034, dz), yellow, G, 10, r2=0.002)]
    look = bpy.data.objects.new("desk_3_duck_look", None)
    coll("export").objects.link(look)
    L.append(LIVE("desk_3_duck_look", "anchor", [look], Mx((dx + 0.016, h + 0.052, dz))))
    # 3 portrait side monitor (baked): cyan stripes of fake code, softly lit
    M = Mx((-0.46, h, -0.20), ry=0.35)
    code = emitter(AGENTS[3]["color"], 0.9, "fake_code")
    mon = [box("sub_base", (0.1, 0.01, 0.08), (0, 0.005, 0), dark, G, bev=0.003, seg=1),
           box("sub_neck", (0.03, 0.09, 0.02), (0, 0.05, -0.02), dark, G),
           panel("sub_body", 0.21, 0.33, 0.02, 0.01, (0, 0.08 + 0.165, -0.01), plastic("#16181d", 0.5, 0.3, 0.05, "monitor"), G),
           box("sub_screen", (0.19, 0.31, 0.001), (0, 0.08 + 0.165, 0.0005), plastic("#07080a", 0.2, 0, 0, "screen_dark"), G)]
    rng = random.Random(11)
    for k in range(16):
        indent = rng.choice((0, 0, 0.015, 0.03))
        ln = rng.uniform(0.04, 0.15 - indent)
        mon.append(box("code", (ln, 0.006, 0.001), (-0.08 + indent + ln / 2, 0.08 + 0.3 - 0.018 * k, 0.0012), code, G))
    s += place(mon, M)
    # 4 keycap dish
    kx, kz = 0.44, 0.13
    s.append(cyl("dish", 0.04, 0.012, (kx, h + 0.006, kz), plastic("#ece6d8", 0.35, 0, 0.05, "ivory_dish"), G, 24, r2=0.045))
    for k, (ox, oz, ry) in enumerate(((-0.012, -0.008, 0.3), (0.014, 0.004, -0.5), (-0.002, 0.016, 1.1))):
        cap = plastic(AGENTS[3]["color"] if k == 2 else "#3a3f48", 0.5, 0, 0.05, "keycap_c" if k == 2 else "keycap")
        s.append(box("keycap", (0.02, 0.012, 0.02), (kx + ox, h + 0.018, kz + oz), cap, G, bev=0.003, seg=1, rot_y=ry))
    # 5 cable clips along the back edge + the cable going over the edge and down
    for x in (0.06, 0.12, 0.18, 0.24, 0.30):
        s.append(box("clip", (0.012, 0.012, 0.02), (x, h + 0.006, -0.295), metal, G))
    cable = rail("cable", [(0.0, h + 0.004, -0.24), (0.05, h + 0.006, -0.29), (0.18, h + 0.006, -0.295), (0.31, h + 0.006, -0.295),
                           (0.35, h - 0.01, -0.318), (0.37, h - 0.25, -0.32)], 0.003, plastic("#111216", 0.6, 0, 0, "cable"), G)
    cable.data.resolution_u = 6
    cable.data.bevel_resolution = 1
    s.append(cable)
    return s, L


DESK_PROPS = [desk_props_memo, desk_props_mesh, desk_props_hue, desk_props_loop]


def place_desk_live(F, entries):
    """desk-frame live parts -> world live nodes with their pivots and extras"""
    out = []
    for e in entries:
        if e["kind"] == "anchor":
            o = e["objs"][0]
            o.matrix_world = F @ e["at"]
            t = o.matrix_world.to_translation()
            o["pivot_at"] = [round(t.x, 5), round(t.z, 5), round(-t.y, 5)]
        elif e["kind"] == "screen":
            w, hh = e["extras"].pop("slot")
            o = apply_all(place(e["objs"], F @ e["extras"].pop("frame"))[0])
            o.name = o.data.name = e["name"]
            slot(o, w, hh)
        else:
            o = join(e["name"], place(e["objs"], F))
            if e["at"] is not None:
                o = pivot(o, F @ e["at"])
        for k, v in e["extras"].items():
            o[k] = v
        out.append((o, e["kind"]))
    return out


# ================================================================ LIBRARY (#67, docs/design/docs-ui.md 2, plan.md 6.4)
# The bookshelf's middle three shelves are the library: one shelf = one project folder, one binder = one file
# (an issue). Each slot is live so the app shows as many binders as there are files, paints the spine band (the
# agents' colors) and the cover (manila when SECRET), writes the issue number on the label, and drops the SECRET
# stamp when the owner makes a file public. Rows r0..r2 = shelves 1..3 from the bottom, slots k0..k9 from the left.
LIB_ROWS = (1, 2, 3)
LIB_N = 10
BINDER = (0.045, 0.30, 0.26)  # spine width, height, depth
BINDER_GAP = 0.004
LABEL = (0.035, 0.07)  # spine label window = one 64 x 128 px cell of the shared "spines" canvas
SPINES = {"canvas": "spines", "grid": [LIB_N, len(LIB_ROWS)], "px": [640, 384]}
SPINE_Z = -HZ + SHELF_D  # the spines' face, 1 cm back from the shelf's front edge
NAVY = "#2c3340"  # binder cover (docs-ui: the dark spines read as "the documents shelf" among the colored books)
MANILA = "#d9b877"  # --manila: the app paints a SECRET binder's cover with it
SECRET_RED = "#b3261e"  # --secret-stamp
LRNG = random.Random(67)
FONT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out", "fonts", "Galmuri11-Bold.ttf")


def shelf_top(s):
    return 0.08 + s * 0.42 + 0.0125


def binder_x(k):
    """left edge of slot k (from the inner face of the shelf's left side)"""
    return SHELF_X - SHELF_W / 2 + 0.015 + 0.008 + k * (BINDER[0] + BINDER_GAP)


def rect_ring(name, w, h, t, material, group):
    """a flat w x h rectangle outline, stroke t, facing web +z"""
    bm = bmesh.new()
    o = [bm.verts.new(W(x * w / 2, y * h / 2, 0)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    i = [bm.verts.new(W(x * (w / 2 - t), y * (h / 2 - t), 0)) for x, y in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for a in range(4):
        b = (a + 1) % 4
        bm.faces.new((o[a], o[b], i[b], i[a]))
    return mesh_obj(name, bm, material, group)


_font = []


def secret_stamp(name, material):
    """SECRET in a double frame, built lying along web x around the origin (the caller stands it up on the spine)"""
    L, S = 0.10, 0.032
    parts = [rect_ring("stamp_out", L, S, 0.0022, material, "export"),
             rect_ring("stamp_in", L - 0.0064, S - 0.0064, 0.0009, material, "export")]
    t = text("stamp_text", "SECRET", 0.02, (0, 0, 0), material, "export", extrude=0.0)
    if not _font and os.path.exists(FONT_PATH):
        _font.append(bpy.data.fonts.load(FONT_PATH))
    if _font:
        t.data.font = _font[0]
    else:
        print("no Galmuri11-Bold.ttf (build-office.sh fetches it): the stamp falls back to Blender's font")
    t = apply_all(t)
    xs = [v.co.x for v in t.data.vertices]
    zs = [v.co.z for v in t.data.vertices]  # Blender z = web y
    k = min((L - 0.017) / (max(xs) - min(xs)), (S - 0.013) / (max(zs) - min(zs)))
    t.data.transform(Matrix.Scale(k, 4) @ Matrix.Translation((-(max(xs) + min(xs)) / 2, 0, -(max(zs) + min(zs)) / 2)))
    return join(name, parts + [t])


def build_library():
    """the live binders (body, band, label, stamp per slot) and the folder name plates -> [(obj, kind)]"""
    G = "export"
    cover = plastic(NAVY, 0.6, 0, 0.15, "binder_cover")
    ring_m = plastic("#9aa0aa", 0.35, 0.8, 0.05, "binder_ring")
    label_m = plastic("#efe6d2", 0.8, 0, 0.0, "binder_label")
    ink = plastic(SECRET_RED, 0.7, 0, 0.0, "secret_stamp")
    bands = [plastic(a["color"], 0.5, 0, 0.0, f"binder_band_{i}") for i, a in enumerate(AGENTS)]
    w, hb, d = BINDER
    z = SPINE_Z
    out = []
    for r, s in enumerate(LIB_ROWS):
        y = shelf_top(s)
        for k in range(LIB_N):
            n = f"shelf_r{r}_b{k}"
            cx = binder_x(k) + w / 2
            # body, band and label share one pivot: the bottom right corner of the spine. The app leans a row's
            # last binder about it (8° to the right, into the empty slots) and can parent band and label as they are.
            P = Mx((binder_x(k) + w, y, z))
            body = join(n, [box("cover", (w, hb, d), (cx, y + hb / 2, z - d / 2), cover, G, bev=0.004, seg=1),
                            torus("ring", 0.009, 0.0016, (cx, y + 0.055, z + 0.0008), ring_m, G, axis="z", seg=10, rseg=3)])
            body = pivot(body, P)
            body["shelf"], body["slot"] = r, k
            band = pivot(apply_all(box(f"{n}_band", (w + 0.001, 0.03, 0.002), (cx, y + 0.27, z + 0.001), bands[(k + r) % 4], G)), P)
            lab = quad(f"{n}_label", LABEL[0], LABEL[1], label_m, G)
            uv = lab.data.uv_layers[0]
            for loop in uv.data:  # this slot's cell of the shared canvas: column k, row r from the top (v = 1 at the top)
                u, v = loop.uv
                loop.uv = ((k + u) / LIB_N, 1 - (r + 1 - v) / len(LIB_ROWS))
            lab = pivot(apply_all(place(lab, Mx((cx, y + 0.165, z + 0.0012)))[0]), P)
            for key, val in {**SPINES, "cell": [k, r]}.items():
                lab[key] = val
            # the stamp stands along the spine (reads top to bottom), tilted 6°, over the label like a real stamp
            M = Mx((cx, y + 0.165, z + 0.0025), rz=math.radians(-84))
            st = pivot(apply_all(place(secret_stamp(f"{n}_secret", ink), M)[0]), M)
            out += [(body, "bot"), (band, "bot"), (lab, "bot"), (st, "bot")]
        # the folder's name plate on the shelf's front lip, under the binders (the app writes the project name)
        x0, x1 = binder_x(0), binder_x(LIB_N - 1) + w
        plate = quad(f"screen_shelf_r{r}", 0.30, 0.035, screen_mat(f"shelf_plate_{r}", "#efe6d2", 0.25), G)
        plate = slot(apply_all(place(plate, Mx(((x0 + x1) / 2, 0.08 + s * 0.42 - 0.004, -HZ + 0.01 + SHELF_D + 0.0012)))[0]), 0.30, 0.035)
        out.append((plate, "screen"))
    return out


def library_statics(shelf_m):
    """baked: per library shelf, a bookend fixed at a full row's right end and a few books lying flat beyond it"""
    G = "wall"
    metal = plastic("#2a2c31", 0.35, 0.8, 0.03, "bookend")
    cols = ["#c0392b", "#d4a017", "#16a085", "#8e44ad", "#e67e22", "#ecf0f1"]  # the decorative books' bright ones
    p = []
    for s in LIB_ROWS:
        y = shelf_top(s)
        bx = binder_x(LIB_N - 1) + BINDER[0]  # its left face = a full row's right end: a leaning binder never meets it
        p += [box("bookend", (0.003, 0.17, 0.13), (bx + 0.0015, y + 0.085, SPINE_Z - 0.1), metal, G),
              box("bookend_foot", (0.11, 0.002, 0.13), (bx + 0.055, y + 0.001, SPINE_Z - 0.1), metal, G)]
        yy = y + 0.002
        for _ in range(LRNG.randint(2, 3)):
            bw, bt, bd = LRNG.uniform(0.2, 0.26), LRNG.uniform(0.025, 0.045), LRNG.uniform(0.17, 0.21)
            p.append(box("book", (bw, bt, bd), (bx + 0.07 + bw / 2 + LRNG.uniform(-0.01, 0.01), yy + bt / 2, SPINE_Z - 0.02 - bd / 2),
                         plastic(LRNG.choice(cols), 0.7, 0, 0.2, "book"), G, rot_y=LRNG.uniform(-0.08, 0.08)))
            yy += bt
    return p


def hit(name, kind, M, size):
    """an invisible click box for the app: center + axes = the empty's frame, size = [w, h, d] (web, m)"""
    o = bpy.data.objects.new(f"hit_{name}", None)
    coll("export").objects.link(o)
    o.matrix_world = M
    o["hit"] = kind
    o["size"] = [round(v, 4) for v in size]
    NODES.append({"obj": o, "hit": kind})
    return o


def build_hits():
    # the IN tray (= the approval box, #67): roomy, it is small on screen
    hit("approval", "approval", frame(AGENTS[0]["at"]) @ Mx((TRAY[0], DESK_H + 0.08, TRAY[1])), (0.30, 0.20, 0.36))
    hit("library", "library", Mx((SHELF_X, 1.05, -HZ + 0.01 + SHELF_D / 2)), (SHELF_W + 0.03, 2.1, SHELF_D))
    # the wall clock (#91): face and hands, a little proud of the face
    hit("clock", "clock", CLOCK_M @ Mx((0, 0, 0.015)), (CLOCK_S + 0.04, CLOCK_S + 0.04, 0.05))["wall"] = "w"


# ================================================================ WALL ITEMS (atlas: wall_items)
def build_wall_items():
    G = "wall"
    z = -HZ + 0.02
    frame_m = plastic("#c8ccd4", 0.35, 0.7, 0.05, "alu")
    board = plastic("#f4f4f0", 0.25, 0, 0.05, "whiteboard")
    cork = plastic("#a87b4f", 0.95, 0, 0.8, "cork")
    wbx = WHITEBOARD_X
    p = [box("wb_frame", (1.56, 1.06, 0.03), (wbx, 1.5, z), frame_m, G, bev=0.006),
         box("wb", (1.5, 1.0, 0.02), (wbx, 1.5, z + 0.01), board, G),
         box("wb_tray", (1.3, 0.025, 0.06), (wbx, 0.985, z + 0.03), frame_m, G)]
    # the cards and the visitor notes are the app's (surface_whiteboard / surface_bulletin): the boards stay empty
    for k, col in enumerate(("#1f6feb", "#d64545", "#111111")):
        p.append(cyl("marker", 0.008, 0.12, (wbx - 0.35 + k * 0.05, 1.0, z + 0.04), plastic(col, 0.4, 0, 0, f"marker_{k}"), G, 10, axis="x"))
    fp("whiteboard", p, "wall", "n")
    # bulletin board for visitor notes
    p += [box("cork_frame", (0.86, 0.96, 0.03), (BULLETIN_X, 1.45, z), plastic("#5a3d26", 0.6, 0, 0.3, "cork_frame"), G, bev=0.006),
          box("cork", (0.8, 0.9, 0.02), (BULLETIN_X, 1.45, z + 0.01), cork, G)]
    fp("bulletin", p[-2:], "wall", "n")
    mark = len(p)
    # bookshelf (the library): 5 shelves; 0 and 4 keep the decorative books, 1..3 hold the live binders (#67, LIBRARY)
    sw, sh, sd = SHELF_W, 2.1, SHELF_D
    shelf_m = plastic("#6b4a30", 0.6, 0, 0.4, "shelf_wood")
    sx = SHELF_X
    sz = -HZ + sd / 2 + 0.01
    p += [box("shelf_l", (0.03, sh, sd), (sx - sw / 2, sh / 2, sz), shelf_m, G),
          box("shelf_r", (0.03, sh, sd), (sx + sw / 2, sh / 2, sz), shelf_m, G),
          box("shelf_top", (sw + 0.03, 0.03, sd), (sx, sh, sz), shelf_m, G)]
    # the back reads as a furniture back from behind (designer, #109: when the n wall is lowered the app fades the
    # shelf to 25% and this side faces the camera): a 6 cm frame and a panel set 5 mm in, not one flat board
    fw, bz = 0.06, -HZ + 0.016
    p += [box("shelf_back_l", (fw, sh, 0.012), (sx - sw / 2 + fw / 2, sh / 2, bz), shelf_m, G),
          box("shelf_back_r", (fw, sh, 0.012), (sx + sw / 2 - fw / 2, sh / 2, bz), shelf_m, G),
          box("shelf_back_b", (sw - 2 * fw, fw, 0.012), (sx, fw / 2, bz), shelf_m, G),
          box("shelf_back_t", (sw - 2 * fw, fw, 0.012), (sx, sh - fw / 2, bz), shelf_m, G),
          box("shelf_back_panel", (sw - 2 * fw, sh - 2 * fw, 0.006), (sx, sh / 2, bz + 0.002), shelf_m, G)]
    book_cols = ["#c0392b", "#2c3e50", "#d4a017", "#16a085", "#8e44ad", "#e67e22", "#ecf0f1", "#34495e", "#7f8c8d"]
    for s in range(5):
        y0 = 0.08 + s * 0.42
        p.append(box("shelf", (sw, 0.025, sd), (sx, y0, sz), shelf_m, G))
        x = sx - sw / 2 + 0.03
        while x < sx + sw / 2 - 0.08:
            if RNG.random() < 0.08:
                x += RNG.uniform(0.05, 0.12)
                continue
            bw = RNG.uniform(0.025, 0.06)
            bh = RNG.uniform(0.22, 0.34)
            bd = RNG.uniform(0.2, 0.28)
            col = RNG.choice(book_cols)  # drawn even where the binders stand: the rest of the room keeps its randomness
            if s not in LIB_ROWS:
                p.append(box("book", (bw, bh, bd), (x + bw / 2, y0 + 0.0125 + bh / 2, sz + 0.02), plastic(col, 0.7, 0, 0.2, "book"), G))
            x += bw + 0.003
    p += library_statics(shelf_m)
    # #126: a pothos on top, over the right half (the decorative top row), hanging at most 0.35 m
    p += plant_tris("vine", pothos("vine", sx + 0.25, sh + 0.015, sz - 0.04, sz + sd / 2, G))
    fp("shelf", p[mark:], "floor", "n")  # stands on the floor against the back wall
    mark2 = len(p)
    # the wall clock on the left wall next to the door (#91: the timelapse entrance): face + 12 ticks baked,
    # hands and hub live (build_clock)
    p.append(box("clock", (0.02, CLOCK_S, CLOCK_S), CLOCK_AT, plastic("#f4f4f0", 0.4, 0, 0, "clock_face"), G))
    fp("clock", p[-1:], "wall", "w")
    tick = plastic("#1f2a44", 0.6, 0, 0, "clock_tick")
    for k in range(12):
        w, ln = (0.008, 0.030) if k % 3 == 0 else (0.004, 0.020)
        p += place([box("clock_tick", (w, ln, 0.001), (0, 0.184 - ln / 2, 0.0005), tick, G)], CLOCK_M @ Mx(rz=-k * math.pi / 6))
    # #111: one atlas (wall_items), three nodes, so the app can lower / hide what hangs on a wall with that wall
    boards = join("boards", p[:mark])
    boards["wall"] = "n"
    shelf = join("shelf", p[mark:mark2])  # stands on the floor: no wall (#115). Tall with its back to n: backTo
    shelf["backTo"] = "n"  # the app fades it to 25% when the n wall is lowered (its back faces the camera)
    face = join("wallclock", p[mark2:])
    face["wall"] = "w"
    return [boards, shelf, face]


# ================================================================ WALL CLOCK (#91, docs/design/timelapse.md 4)
# The timelapse's way in. The app turns the hands to the time (now, or the replayed moment) and lights the hub cyan on
# hover; hit_clock is the click box. Sizes from the design's clock() drawing at 0.40 m = 200 px (1 px = 2 mm).
def build_clock():
    """clock_hand_h, clock_hand_m, clock_hub: live bot, pivot = the face center, node frame = CLOCK_M (local +y =
    12 o'clock, local +z = out of the face = web +x). Both hands point at 12; clockwise = negative turn about local z."""
    G = "export"
    ink = plastic("#111111", 0.5, 0, 0, "clock_hand")
    out = []
    for name, (w, ln, z) in (("clock_hand_h", (0.020, 0.096, 0.0075)), ("clock_hand_m", (0.014, 0.152, 0.0110))):
        tail = 0.016
        hand = box(name, (w, ln + tail, 0.003), (0, (ln - tail) / 2, z), ink, G)
        out.append(pivot(join(name, place([hand], CLOCK_M)), CLOCK_M))
    hub = cyl("clock_hub", 0.01, 0.008, (0, 0, 0.0165), plastic("#111111", 0.35, 0.6, 0, "clock_hub"), G, 20, axis="z")
    out.append(pivot(join("clock_hub", place([hub], CLOCK_M)), CLOCK_M))
    for o in out:
        o["wall"] = "w"
    return out


# ================================================================ PLANTS (#126, docs/design/office-quality.md 2.6–2.7, 3)
# One species per plant so each reads by its silhouette from the default camera: fiddle-leaf fig (violin leaves),
# sansevieria (swords), monstera (split hearts), echeveria (rosette), pothos (hanging vine). Mesh leaves: a blade
# folded along its midrib, 8–12 triangles a side (sansevieria and monstera more: stripes / real slits, see the
# document), two-sided (a flipped skin with its own UV: atlas meshes are drawn front side only). The three leaf
# greens only. Pots in three parts: tapered body, a 1 cm rim, soil 1.5 cm under it with pebbles; saucer or legs.
# Everything from code, no outside assets. Own random stream (the room's RNG stream ends before the plants).
GREENS = ("#2f6b3a", "#4f8f4a", "#8cbf6a")
PRNG = random.Random(126)
UP = Vector((0.0, 1.0, 0.0))


class Foliage:
    """the leaves of one plant in one mesh: a material per face, each surface doubled by a flipped back skin"""

    def __init__(self, name, colors=GREENS, under=(1, 2, 2)):
        self.name = name
        self.bm = bmesh.new()
        self.mats = [plastic(c, 0.85, 0, 0.1, f"leaf_{c[1:]}") for c in colors]  # matte: a glossy leaf hung upright
        # under the wall light went pale mint (grazing sheen)
        self.under = under  # the underside one green lighter, as real leaves are (two-tone up close)

    def mat(self, m):
        if m not in self.mats:
            self.mats.append(m)
        return self.mats.index(m)

    def green(self):
        return PRNG.choices((0, 1, 2), weights=(3, 4, 2))[0]

    def surface(self, pts, faces, mis, up):
        """pts: web Vectors; faces: index tuples, counter-clockwise seen from the front (up side)"""
        front = [self.bm.verts.new(W(*p)) for p in pts]
        back = [self.bm.verts.new(W(*(p - up * 0.0008))) for p in pts]
        for f, mi in zip(faces, mis):
            self.bm.faces.new([front[i] for i in f]).material_index = mi
            self.bm.faces.new([back[i] for i in reversed(f)]).material_index = self.under[mi] if mi < len(self.under) else mi

    def obj(self, group):
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in self.mats:
            me.materials.append(m)
        o = bpy.data.objects.new(self.name, me)
        coll(group).objects.link(o)
        return o


def ribbed(fol, base, d, side, length, profile, fold=0.3, droop=0.0, mi=0, rib=0.07):
    """a leaf with a visible midrib (#126: a detail that reads up close): like blade() with 2 inner stations, but the
    midrib is a narrow strip (rib x half width each side) one green lighter. 12 triangles a side."""
    d = d.normalized()
    ts = [0.0] + [t for t, _ in profile] + [1.0]
    ws = [0.0] + [w for _, w in profile] + [0.0]
    p, prev, centers = base.copy(), 0.0, []
    for t in ts:
        dirn = (d - UP * droop * t).normalized()
        p = p + dirn * (t - prev) * length
        prev = t
        centers.append((p.copy(), dirn))
    pts = [centers[0][0]]
    for i in range(1, len(ts) - 1):
        c, dirn = centers[i]
        s = (side - dirn * side.dot(dirn)).normalized()
        up = s.cross(dirn)
        w = ws[i] * length
        r = max(0.0015, w * rib)
        pts += [c - s * w + up * w * fold, c - s * r, c + s * r, c + s * w + up * w * fold]
    pts.append(centers[-1][0])
    n, tip = len(ts) - 2, len(pts) - 1
    rm = min(mi + 1, 2)  # the midrib: one green lighter

    def L(i):
        return 1 + 4 * i

    faces = [(0, L(0) + 3, L(0) + 2), (0, L(0) + 2, L(0) + 1), (0, L(0) + 1, L(0))]
    mis = [mi, rm, mi]
    for i in range(n - 1):
        a, b = L(i), L(i + 1)
        faces += [(a + 2, a + 3, b + 3, b + 2), (a + 1, a + 2, b + 2, b + 1), (a, a + 1, b + 1, b)]
        mis += [mi, rm, mi]
    a = L(n - 1)
    faces += [(a + 2, a + 3, tip), (a + 1, a + 2, tip), (a, a + 1, tip)]
    mis += [mi, rm, mi]
    fol.surface(pts, faces, mis, side.cross(d).normalized())


def petiole(name, a, b, material, group, r=0.003):
    """the short stalk from a stem to a leaf's base, so no leaf floats (#126)"""
    return segment(name, tuple(a), tuple(b), r, material, group, verts=4, r2=r * 0.8)


def blade(fol, base, d, side, length, profile, fold=0.3, droop=0.0, mi=0):
    """a leaf from base along d (web; side = across it). profile: [(t, half width / length)] at the inner stations;
    base and tip are points. fold lifts the edges above the midrib (x half width), droop bends it toward the floor
    along its length (negative: curls up). 4 triangles per station a side: 2 stations = 8, 3 = 12."""
    d = d.normalized()
    ts = [0.0] + [t for t, _ in profile] + [1.0]
    ws = [0.0] + [w for _, w in profile] + [0.0]
    p, prev, centers = base.copy(), 0.0, []
    for t in ts:
        dirn = (d - UP * droop * t).normalized()
        p = p + dirn * (t - prev) * length
        prev = t
        centers.append((p.copy(), dirn))
    pts = [centers[0][0]]
    for i in range(1, len(ts) - 1):
        c, dirn = centers[i]
        s = (side - dirn * side.dot(dirn)).normalized()
        up = s.cross(dirn)
        w = ws[i] * length
        pts += [c - s * w + up * w * fold, c, c + s * w + up * w * fold]
    pts.append(centers[-1][0])
    n, tip = len(ts) - 2, len(pts) - 1

    def L(i):
        return 1 + 3 * i

    faces = [(0, L(0) + 2, L(0) + 1), (0, L(0) + 1, L(0))]
    for i in range(n - 1):
        faces += [(L(i) + 1, L(i) + 2, L(i + 1) + 2, L(i + 1) + 1), (L(i), L(i) + 1, L(i + 1) + 1, L(i + 1))]
    faces += [(L(n - 1) + 1, L(n - 1) + 2, tip), (L(n - 1), L(n - 1) + 1, tip)]
    fol.surface(pts, faces, [mi] * len(faces), side.cross(d).normalized())


def split_heart(fol, attach, d, side, size, mi, lobes=4, cup=0.12, slit=0.09):
    """monstera leaf: a heart along its midrib, base lobes rounding back past the petiole, cut from the edge toward
    the midrib by slits (real holes) that stop 40% of the way in. attach = the base notch, where the petiole
    joins; d = toward the tip. lobes per half (the tip lobe uncut): 4 -> 28 triangles a side."""
    d = d.normalized()
    s = (side - d * side.dot(d)).normalized()
    up = s.cross(d)
    n = lobes
    pts, faces = [], []

    def station(t, sgn):
        m = attach + d * (t * size)
        w = size * 0.52 * math.sin(math.pi * min(1.0, 0.12 + 0.88 * t)) ** 0.75
        e = m + s * (sgn * w) - d * (size * 0.22 * (1 - t) ** 3) + up * (cup * size * (1 - t * 0.5))
        return m, m.lerp(e, 0.4), e

    for sgn in (1, -1):
        base = len(pts)
        for k in range(n + 1):
            pts += list(station(k / n, sgn))
        for k in range(n):
            M0, I0, E0 = base + 3 * k, base + 3 * k + 1, base + 3 * k + 2
            M1, I1, E1 = M0 + 3, I0 + 3, E0 + 3
            if k == n - 1:  # the tip lobe: one piece out to the edge
                f = (M0, E0, E1, M1)
                faces.append(f if sgn > 0 else tuple(reversed(f)))
                continue
            inner = (M0, I0, I1, M1)
            faces.append(inner if sgn > 0 else tuple(reversed(inner)))
            # the outer piece is narrowed at its ends where a slit runs in (not at the base: the heart lobe is whole)
            g0 = slit if k else 0.0
            j = len(pts)
            pts += [pts[I0].lerp(pts[I1], g0), pts[E0].lerp(pts[E1], g0), pts[I1].lerp(pts[I0], slit), pts[E1].lerp(pts[E0], slit)]
            outer = (j, j + 1, j + 3, j + 2)
            faces.append(outer if sgn > 0 else tuple(reversed(outer)))
    fol.surface(pts, faces, [mi] * len(faces), up)


def sword(fol, base, d, side, length, width, edge_mi, band_mis, rows=4, twist=0.0):
    """sansevieria leaf: upright and flat, a yellow edge strip each side, darker / lighter cross bands; full width
    at the base, pointed tip. (rows - 1) x 8 + 4 triangles a side (28 for 4 rows)."""
    d = d.normalized()
    pts, faces, mis = [], [], []
    for i in range(rows):
        t = i / rows
        c = base + d * t * length
        w = width * (1.0 - 0.55 * t * t)
        a = twist * t
        s0 = (side - d * side.dot(d)).normalized()
        s = s0 * math.cos(a) + d.cross(s0) * math.sin(a)
        up = s.cross(d)
        pts += [c - s * w, c - s * w * 0.78, c + up * w * 0.12, c + s * w * 0.78, c + s * w]
    pts.append(base + d * length)
    tip = len(pts) - 1
    for i in range(rows - 1):
        for j in range(4):
            faces.append((5 * i + j, 5 * i + j + 1, 5 * (i + 1) + j + 1, 5 * (i + 1) + j))
            mis.append(edge_mi if j in (0, 3) else band_mis[i % 2])
    for j in range(4):
        faces.append((5 * (rows - 1) + j, 5 * (rows - 1) + j + 1, tip))
        mis.append(edge_mi if j in (0, 3) else band_mis[(rows - 1) % 2])
    fol.surface(pts, faces, mis, side.normalized().cross(d))


def flip(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.to_mesh(o.data)
    bm.free()
    return o


def pot3(name, x, z, y0, r_top, r_bot, h, body, group, saucer=False, pebbles=4, seg=24, foot=None, chips=0):
    """a pot in three parts: tapered body, a 1 cm rim (a wall above the soil, inside and out, capped by a rolled
    lip), soil 1.5 cm under the rim with pebbles and bark chips; optional saucer. foot = the material of an
    unglazed foot band (the glaze stops above it: a gloss difference that reads up close, #126). Returns
    (objects, soil height)."""
    soil_y = y0 + h - 0.015
    soil = plastic("#3b2a20", 0.95, 0, 0.4, "soil")
    stone = (plastic("#9a958c", 0.8, 0, 0.3, "pebble"), plastic("#c9c3b8", 0.8, 0, 0.3, "pebble_light"))
    bark = (plastic("#6b4a32", 0.9, 0, 0.5, "bark_chip"), plastic("#8a6242", 0.9, 0, 0.5, "bark_chip_light"))

    def radius(y):
        return r_bot + (r_top - r_bot) * (y - y0) / h

    small = r_top < 0.1  # office-quality.md 2.2: small props 1–2 bevel segments
    bseg = 1 if small else 2
    fy = y0 + (min(0.03, h * 0.14) if foot else 0.0)  # top of the unglazed foot band
    o = [add_bevel(cyl(f"{name}_body", radius(fy), soil_y - fy, (x, (fy + soil_y) / 2, z), body, group, seg, r2=radius(soil_y)), 0.002, seg=bseg),
         tube(f"{name}_collar", r_top, 0.015, (x, soil_y + 0.0075, z), body, group, seg),
         flip(tube(f"{name}_collar_in", r_top - 0.006, 0.015, (x, soil_y + 0.0075, z), body, group, seg)),
         torus(f"{name}_rim", r_top - 0.003, 0.0055, (x, y0 + h, z), body, group, seg=seg, rseg=4),
         cyl(f"{name}_soil", r_top - 0.006, 0.004, (x, soil_y + 0.001, z), soil, group, seg)]
    if foot:
        o.append(add_bevel(cyl(f"{name}_foot", r_bot, fy - y0, (x, (y0 + fy) / 2, z), foot, group, seg, r2=radius(fy) - 0.001), 0.002, seg=bseg))
    for k in range(pebbles):
        a, r = PRNG.uniform(0, 2 * math.pi), PRNG.uniform(0.2, 0.75) * (r_top - 0.02)
        o.append(sphere(f"{name}_pebble", PRNG.uniform(0.006, 0.011), (x + r * math.cos(a), soil_y + 0.005, z + r * math.sin(a)),
                        stone[k % 2], group, scale=(1.0, 0.6, 0.85), seg=6, rings=4))
    for k in range(chips):  # bark chips: flat, at odd angles on the soil
        a, r = PRNG.uniform(0, 2 * math.pi), PRNG.uniform(0.15, 0.8) * (r_top - 0.025)
        s = PRNG.uniform(0.7, 1.2)
        o.append(box(f"{name}_chip", (0.022 * s, 0.004, 0.012 * s), (x + r * math.cos(a), soil_y + 0.004, z + r * math.sin(a)),
                     bark[k % 2], group, rot_y=PRNG.uniform(0, math.pi)))
    if saucer:
        o.append(add_bevel(cyl(f"{name}_saucer", r_bot + 0.035, 0.02, (x, y0 - 0.01, z), foot or body, group, seg, r2=r_bot + 0.045), 0.002, seg=2))
    return o, soil_y


def camera_side(x, z):
    """the horizontal 'right' seen from the default camera at (x, z): leaves built across it face the camera"""
    c = Vector((8.5 - x, 0.0, 9.5 - z)).normalized()
    return UP.cross(c).normalized(), c


def fiddle_fig(name, x, z, group):
    """corner: fiddle-leaf fig 1.5 m; glazed charcoal pot (38 cm) with an unglazed foot band on a saucer, pebbles and
    bark chips; trunk + two branches; 44 violin leaves 20–30 cm with a pale midrib, each on its own short petiole,
    pointing into the room more than at the corner walls (#126, upper end of office-quality.md 3)"""
    PRNG.seed(f"126:{name}")  # each plant its own stream: changing one leaves the others as they are
    pot, sy = pot3(name, x, z, 0.02, 0.19, 0.15, 0.36, plastic("#33363d", 0.25, 0, 0.05, "pot_charcoal_glaze"), group,
                   saucer=True, pebbles=5, chips=8, foot=plastic("#8e8478", 0.9, 0, 0.3, "pot_bisque_dark"))
    bark = plastic("#5a4632", 0.85, 0, 0.5, "bark")
    trunk = [Vector((x, sy, z)), Vector((x - 0.02, 0.75, z - 0.01)), Vector((x - 0.05, 1.15, z - 0.03)), Vector((x - 0.04, 1.45, z - 0.05))]
    br1 = [trunk[1] + Vector((0, 0.08, 0)), Vector((x - 0.14, 1.02, z - 0.06)), Vector((x - 0.21, 1.22, z - 0.1))]
    br2 = [trunk[2], Vector((x + 0.02, 1.25, z - 0.14)), Vector((x + 0.01, 1.4, z - 0.2))]
    stems = [lowrail(f"{name}_trunk", [tuple(p) for p in trunk], 0.018, bark, group),
             lowrail(f"{name}_branch", [tuple(p) for p in br1], 0.011, bark, group),
             lowrail(f"{name}_branch", [tuple(p) for p in br2], 0.011, bark, group)]
    stalk = plastic(GREENS[1], 0.7, 0, 0.2, "fig_petiole")
    fol = Foliage(f"{name}_leaves")
    room = Vector((-0.55, 0.0, -1.0)).normalized()  # from the corner toward the room, a little away from the floor lamp (−x)
    for path, count in ((trunk[1:], 20), (br1[1:], 12), (br2[1:], 12)):
        for k in range(count):
            u = 0.15 + 0.85 * (k + PRNG.uniform(0.2, 0.8)) / count  # the upper part of each stem: bare low down
            seg = min(int(u * (len(path) - 1)), len(path) - 2)
            f = u * (len(path) - 1) - seg
            at = path[seg].lerp(path[seg + 1], f)
            yaw = PRNG.uniform(-1.6, 1.6)  # around the room direction: few leaves point into the corner
            out = Vector((room.x * math.cos(yaw) - room.z * math.sin(yaw), 0.0, room.x * math.sin(yaw) + room.z * math.cos(yaw)))
            elev = PRNG.uniform(0.45, 1.05)  # held up and out, as the fig does
            d = (out * math.cos(elev) + UP * math.sin(elev)).normalized()
            side = UP.cross(out).normalized()
            roll = PRNG.uniform(-1.0, 1.0)  # turned about the midrib so the leaves face every way, not all flat
            side = side * math.cos(roll) + d.cross(side) * math.sin(roll)
            base = at + (out * 0.75 + UP * 0.65).normalized() * 0.035  # a 3.5 cm petiole from the stem
            stems.append(petiole(f"{name}_petiole", at, base, stalk, group))
            ribbed(fol, base, d, side, PRNG.uniform(0.21, 0.29), [(0.33, 0.28), (0.72, 0.34)],
                   fold=0.15, droop=PRNG.uniform(0.1, 0.3), mi=fol.green())
    return pot + stems + [fol.obj(group)]


def sansevieria(name, x, z, group):
    """by MESH's desk: sansevieria laurentii, 12 upright swords 0.45–0.78 m with yellow edges and cross bands, in a
    glazed cream pot (unglazed foot band, pebbles and bark chips) on a three-legged wooden stand with a ring — tall
    and narrow for its 0.4 m gap"""
    PRNG.seed(f"126:{name}")  # each plant its own stream: changing one leaves the others as they are
    stand_h = 0.28
    pot, sy = pot3(name, x, z, stand_h, 0.12, 0.1, 0.22, plastic("#e8e1cf", 0.22, 0, 0.05, "pot_cream_glaze"), group,
                   pebbles=4, chips=4, foot=plastic("#cbbfa8", 0.9, 0, 0.3, "pot_bisque"))
    wood_m = plastic("#a07850", 0.6, 0, 0.4, "stand_wood")
    legs = []
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.5
        top = (x + 0.085 * math.cos(a), stand_h + 0.02, z + 0.085 * math.sin(a))
        foot = (x + 0.16 * math.cos(a), 0.0, z + 0.16 * math.sin(a))
        legs.append(add_bevel(segment(f"{name}_leg", top, foot, 0.012, wood_m, group, verts=8, r2=0.008), 0.0015, seg=1))
    legs.append(tube(f"{name}_ring", 0.095, 0.03, (x, stand_h + 0.005, z), wood_m, group, 16))
    fol = Foliage(f"{name}_leaves", colors=(GREENS[0], GREENS[1], "#d4c056"), under=(0, 1, 2))
    for k in range(12):
        a = 2 * math.pi * k / 12 + PRNG.uniform(-0.2, 0.2)
        r = PRNG.uniform(0.01, 0.065)
        base = Vector((x + r * math.cos(a), sy, z + r * math.sin(a)))
        lean = PRNG.uniform(0.04, 0.2)
        out = Vector((math.cos(a), 0.0, math.sin(a)))
        d = (UP + out * lean).normalized()
        side = UP.cross(out).normalized()
        sword(fol, base, d, side, PRNG.uniform(0.45, 0.78), PRNG.uniform(0.028, 0.04), 2, (0, 1), rows=4, twist=PRNG.uniform(-0.5, 0.5))
    return pot + legs + [fol.obj(group)]


def monstera(name, x, z, group):
    """by the sofa: a young monstera 0.9 m in terracotta (a darker water-stained foot band, pebbles, bark chips) on a
    saucer; 7 split-heart leaves on long petioles, each petiole running from the soil into its leaf's base notch,
    all facing the default camera, spread along z (the gap is narrow in x); undersides one green lighter"""
    PRNG.seed(f"126:{name}")  # each plant its own stream: changing one leaves the others as they are
    pot, sy = pot3(name, x, z, 0.02, 0.14, 0.11, 0.26, plastic("#b5654a", 0.85, 0, 0.3, "terracotta"), group, saucer=True,
                   pebbles=4, chips=6, foot=plastic("#96523d", 0.9, 0, 0.3, "terracotta_dark"))
    stem_m = plastic(GREENS[1], 0.7, 0, 0.2, "petiole")
    side, cam = camera_side(x, z)
    fol = Foliage(f"{name}_leaves")
    stems = []
    for k, (dz, h, tilt) in enumerate(((-0.22, 0.62, 0.35), (-0.08, 0.84, 0.15), (0.06, 0.7, 0.25), (0.2, 0.88, 0.1),
                                       (0.3, 0.55, 0.45), (-0.3, 0.5, 0.5), (0.12, 0.98, 0.05))):
        attach = Vector((x + PRNG.uniform(-0.04, 0.04), h, z + dz))
        mid = Vector((x, sy + (h - sy) * 0.55, z + dz * 0.4))
        stems.append(lowrail(f"{name}_petiole", [(x + PRNG.uniform(-0.02, 0.02), sy, z + PRNG.uniform(-0.02, 0.02)), tuple(mid), tuple(attach)],
                             0.006, stem_m, group))
        d = (UP * math.cos(tilt) + cam * math.sin(tilt) * 0.6 + Vector((0, 0, dz)) * 0.8).normalized()  # up, a bit out
        split_heart(fol, attach, d, side, PRNG.uniform(0.24, 0.3), fol.green())
    return pot + stems + [fol.obj(group)]


def echeveria(name, x, y, z, group):
    """HUE's desk: echeveria rosette in three tiers (8 + 6 + 4 fleshy leaves, 12 triangles a side) curling up, the
    centre lighter; small terracotta pot with pebbles"""
    PRNG.seed(f"126:{name}")  # each plant its own stream: changing one leaves the others as they are
    pot, sy = pot3(name, x, z, y, 0.04, 0.032, 0.05, plastic("#b5654a", 0.85, 0, 0.3, "terracotta"), group, pebbles=2, seg=10,
                   foot=plastic("#96523d", 0.9, 0, 0.3, "terracotta_dark"))
    fol = Foliage(f"{name}_leaves")
    for tier, (n, length, elev, r0) in enumerate(((8, 0.044, 0.25, 0.007), (6, 0.034, 0.7, 0.004), (4, 0.022, 1.15, 0.0015))):
        for k in range(n):
            a = 2 * math.pi * (k + 0.5 * tier) / n
            out = Vector((math.cos(a), 0.0, math.sin(a)))
            base = Vector((x, sy + 0.004 + 0.006 * tier, z)) + out * r0
            d = (out * math.cos(elev) + UP * math.sin(elev)).normalized()
            blade(fol, base, d, UP.cross(out), length, [(0.25, 0.25), (0.55, 0.31), (0.82, 0.22)], fold=0.45, droop=-0.6,
                  mi=(PRNG.choice((1, 2)), 2, 2)[tier])
    return pot + [fol.obj(group)]


HEART = [(0.22, 0.42), (0.6, 0.32)]  # pothos leaf: round low down, a pointed tip; with the midrib 12 triangles a side


def pothos(name, x, y, z, front_z, group):
    """top of the bookshelf: pothos in a glazed cream pot (unglazed foot band, pebbles, a few bark chips). Three
    strands of different length (0.18 / 0.26 / 0.35 m, never more: the binders' top row ends at ~1.65 m) arch out
    over the shelf's front lip and then fall; heart leaves with a pale midrib, each on a short petiole off the
    strand, at uneven spacing, darker and mid greens with a light one at the tips; three leaves lie over the pot
    rim so the vine visibly starts in the pot (designer, #126)"""
    PRNG.seed(f"126:{name}")  # each plant its own stream: changing one leaves the others as they are
    r_top = 0.07
    pot, sy = pot3(name, x, z, y, r_top, 0.055, 0.1, plastic("#e8e1cf", 0.22, 0, 0.05, "pot_cream_glaze"), group, pebbles=2,
                   chips=3, seg=12, foot=plastic("#cbbfa8", 0.9, 0, 0.3, "pot_bisque"))
    stem_m = plastic(GREENS[0], 0.7, 0, 0.2, "vine")
    fol = Foliage(f"{name}_leaves", under=(0, 1, 2))  # hanging leaves show their backs: no lighter underside here
    stems = []
    for k, (dx, drop) in enumerate(((-0.13, 0.26), (0.03, 0.35), (0.16, 0.18))):
        pts = [Vector((x + dx * 0.25, sy + 0.006, z + 0.02)),
               Vector((x + dx * 0.45, y + 0.028, front_z - 0.05)),
               Vector((x + dx * 0.7, y + 0.02, front_z + 0.015)),  # over the lip
               Vector((x + dx * 0.88, y - 0.035, front_z + 0.06)),  # arching out
               Vector((x + dx, y - drop * 0.55, front_z + 0.07)),
               Vector((x + dx * 1.04, y - drop, front_z + 0.045))]  # and falling back a little
        strand = lowrail(f"{name}_strand", [tuple(p) for p in pts], 0.003, stem_m, group)
        strand.data.resolution_u = 3  # a 3 mm stem: a few segments and a 4-sided section are enough
        strand.data.bevel_resolution = 0
        stems.append(strand)
        n = 7
        for j in range(n):  # alternate sides, uneven spacing
            u = min(0.98, 0.16 + 0.82 * (j + PRNG.uniform(0.15, 0.85)) / n)
            seg = min(int(u * 5), 4)
            at = pts[seg].lerp(pts[seg + 1], u * 5 - seg)
            sgn = 1.0 if (j + k) % 2 else -1.0
            d = Vector((sgn * 0.75, -0.25, 0.55 + PRNG.uniform(-0.15, 0.15))).normalized()
            mi = 2 if j == n - 1 else PRNG.choice((0, 0, 0, 1))  # under the wall light the shelf top reads bright: dark first
            base = at + (d + Vector((0, 0.3, 0))).normalized() * 0.014  # a 1.4 cm petiole off the strand
            stems.append(petiole(f"{name}_petiole", at, base, stem_m, group, r=0.0018))
            ribbed(fol, base, d, UP.cross(d).normalized(), PRNG.uniform(0.058, 0.078), HEART, fold=0.2, droop=0.45, mi=mi)
    for a in (-1.2, -0.2, 0.9):  # leaves lying over the pot rim (toward the room), and two standing in the pot
        out = Vector((math.sin(a), 0.0, math.cos(a)))
        rim = Vector((x, sy + 0.017, z)) + out * (r_top - 0.008)
        ribbed(fol, rim, (out - UP * 0.45).normalized(), UP.cross(out), PRNG.uniform(0.062, 0.072), HEART, fold=0.2, droop=0.3,
               mi=PRNG.choice((0, 1)))
    for a in (0.6, 3.4):
        out = Vector((math.cos(a), 0.0, math.sin(a)))
        ribbed(fol, Vector((x, sy + 0.005, z)) + out * 0.015, (out + UP * 0.9).normalized(), UP.cross(out), 0.072, HEART,
               fold=0.2, droop=0.6, mi=1)
    return pot + stems + [fol.obj(group)]


def plant_tris(name, objs):
    """--tris: a plant's triangles with curves evaluated (office-quality.md 3 budgets)"""
    if "--tris" in ARGS:
        dg = bpy.context.evaluated_depsgraph_get()
        n = 0
        for o in objs:
            me = o.evaluated_get(dg).to_mesh()
            k = sum(len(p.vertices) - 2 for p in me.polygons)
            n += k
            if "--tris-parts" in ARGS:
                print(f"    {o.name}: {k}")
            o.evaluated_get(dg).to_mesh_clear()
        print(f"plant {name}: {n} triangles")
    return objs


PLANT_BUILDERS = {"fiddle_fig": fiddle_fig, "sansevieria": sansevieria, "monstera": monstera}
PLANT_NODES = []  # (node, name): each floor plant is its own baked node in the lounge atlas, leaves at half density


# ================================================================ LOUNGE (atlas: lounge)
OMOK_NODES = []  # the omok board: its own baked node in the lounge atlas at OMOK_DENSITY (1.2 mm lines)
OMOK_DENSITY = 3.0
OMOK = dict(n=15, cell=0.0257, board=0.42, top=0.77, stone_d=0.022, stone_h=0.008)
OMOK_BOARD_PARTS = 2  # build_omok returns the board's parts first (they become omok_board), then the bowls
OMOK_BOWLS = {}  # "b" | "w" -> the grab point in the bowl (web): build_props puts prop_piece_a|b there
SRNG = random.Random(135)  # #135's own draws (the stone heaps)


def omok_mat(x0, z0, top):
    """light wood with the 15 x 15 grid drawn in the shader (world position): 1.2 mm lines, the border 2 mm, five
    star points 4 mm. Only on the top face (y >= top - 0.5 mm). Baked into the atlas like any colour."""
    m, nodes, links, b = new_mat("omok_board")
    b.inputs["Roughness"].default_value = 0.55
    bump(nodes, links, b, 900, 0.12, 0.0002)
    geo = nodes.new("ShaderNodeNewGeometry")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(geo.outputs["Position"], sep.inputs["Vector"])

    def op(kind, a, bb=None, c=None):
        n = nodes.new("ShaderNodeMath")
        n.operation = kind
        for k, v in enumerate((a, bb, c)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[k].default_value = v
            else:
                links.new(v, n.inputs[k])
        return n.outputs[0]

    pitch, last = OMOK["cell"], OMOK["n"] - 1
    u = op("DIVIDE", op("SUBTRACT", sep.outputs["X"], x0), pitch)  # web x = Blender X
    v = op("DIVIDE", op("SUBTRACT", op("MULTIPLY", sep.outputs["Y"], -1.0), z0), pitch)  # web z = -Blender Y

    def line(a, other):
        """mask of the lines a = const: near a whole number, inside the grid along the other axis"""
        ra = op("ROUND", a)
        border = op("MAXIMUM", op("LESS_THAN", ra, 0.5), op("GREATER_THAN", ra, last - 0.5))
        hw = op("DIVIDE", op("ADD", 0.0006, op("MULTIPLY", border, 0.0004)), pitch)  # half width in cells
        near = op("LESS_THAN", op("ABSOLUTE", op("SUBTRACT", a, ra)), hw)
        inside = op("MULTIPLY", op("GREATER_THAN", other, op("MULTIPLY", hw, -1.0)), op("LESS_THAN", other, op("ADD", hw, last)))
        within = op("MULTIPLY", op("GREATER_THAN", ra, -0.5), op("LESS_THAN", ra, last + 0.5))
        return op("MULTIPLY", op("MULTIPLY", near, inside), within)

    # star points: (3, 3), (3, 11), (11, 3), (11, 11), (7, 7) -> both rounded coords in {3, 11}, or both 7
    ru, rv = op("ROUND", u), op("ROUND", v)

    def is_(r, k):
        return op("LESS_THAN", op("ABSOLUTE", op("SUBTRACT", r, k)), 0.5)

    corner = op("MULTIPLY", op("MAXIMUM", is_(ru, 3), is_(ru, 11)), op("MAXIMUM", is_(rv, 3), is_(rv, 11)))
    star = op("MAXIMUM", corner, op("MULTIPLY", is_(ru, 7), is_(rv, 7)))
    du, dv = op("SUBTRACT", u, ru), op("SUBTRACT", v, rv)
    dist = op("MULTIPLY", op("SQRT", op("ADD", op("MULTIPLY", du, du), op("MULTIPLY", dv, dv))), pitch)
    dot = op("MULTIPLY", star, op("LESS_THAN", dist, 0.002))
    on_top = op("GREATER_THAN", sep.outputs["Z"], top - 0.0005)  # web y = Blender Z
    ink = op("MULTIPLY", op("MAXIMUM", op("MAXIMUM", line(u, v), line(v, u)), dot), on_top)
    mix = nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    col_a, col_b = [s for s in mix.inputs if s.type == "RGBA" and s.name in ("A", "B")]  # the colour pair
    col_a.default_value, col_b.default_value = rgba("#d4a463"), rgba("#3a2a1a")  # designer: a step darker than the table
    links.new(ink, mix.inputs["Factor"])
    links.new([s for s in mix.outputs if s.type == "RGBA"][0], b.inputs["Base Color"])
    return m


def lens(name, d, h, center, material, group, seg=16, rings=8):
    """a go stone: a lens, both faces domed (a flattened sphere)"""
    return sphere(name, d / 2, center, material, group, scale=(1.0, h / d, 1.0), seg=seg, rings=rings)


def stone_mats():
    return (plastic("#1d1f24", 0.25, 0, 0, "stone_b"), plastic("#f2efe8", 0.35, 0, 0, "stone_w"))


def build_omok(gx, gz, G):
    """the board's parts first (OMOK_BOARD_PARTS of them), then the bowls, lids and heaps (lounge atlas)"""
    B, top = OMOK["board"], OMOK["top"]
    span = OMOK["cell"] * (OMOK["n"] - 1)
    x0, z0 = gx - span / 2, gz - span / 2  # the (0, 0) intersection: the board's -x, -z corner
    table = 0.74
    parts = [box("omok_slab", (B, top - table - 0.008, B), (gx, (top + table + 0.008) / 2, gz), omok_mat(x0, z0, top), G, bev=0.003),
             box("omok_foot", (B - 0.008, 0.008, B - 0.008), (gx, table + 0.004, gz), plastic("#b98d55", 0.6, 0, 0.2, "omok_foot"), G)]
    grid = bpy.data.objects.new("omok_grid", None)
    coll("export").objects.link(grid)
    grid.matrix_world = Mx((x0, top, z0))  # +x = columns, +z = rows
    grid["n"], grid["cell"], grid["stone_h"] = OMOK["n"], OMOK["cell"], OMOK["stone_h"]
    NODES.append({"obj": grid, "play": "omok"})
    # bowls: wooden pots with the stones heaped in them, the lid upside down beside; black by game_a (-x)
    bowl_m = plastic("#5e3f27", 0.5, 0, 0.3, "omok_bowl")  # designer: dark walnut (orange read as a terracotta pot)
    rim_m = plastic("#7a5236", 0.5, 0, 0.3, "omok_lid_rim")
    inner = plastic("#3b2717", 0.8, 0, 0.2, "omok_bowl_in")
    mats = dict(zip("bw", stone_mats()))
    br, bh = 0.045, 0.06
    for side, dx in (("b", -0.29), ("w", 0.29)):
        bx, bz = gx + dx, gz + 0.06
        parts += [cyl("bowl", br, bh, (bx, table + bh / 2, bz), bowl_m, G, 28, r2=br - 0.004, bev=0.004),
                  cyl("bowl_in", br - 0.007, 0.002, (bx, table + bh - 0.002, bz), inner, G, 24),
                  cyl("bowl_lid", br + 0.002, 0.010, (bx, table + 0.005, gz - 0.07), bowl_m, G, 28, r2=br, bev=0.002),
                  cyl("bowl_lid_rim", br, 0.004, (bx, table + 0.012, gz - 0.07), rim_m, G, 28, r2=br - 0.002, bev=0.0015)]  # upside down: its rim on top
        for k in range(9):  # the heap: a ring of stones around the middle (the grab point stays clear)
            a, r = 2 * math.pi * (k + SRNG.random() * 0.6) / 9, 0.016 + SRNG.random() * 0.012
            s = lens("heap", OMOK["stone_d"], OMOK["stone_h"], (bx + r * math.cos(a), table + bh + 0.001, bz + r * math.sin(a)), mats[side], G, 10, 5)
            s.rotation_euler = (SRNG.uniform(-0.25, 0.25), SRNG.uniform(-0.25, 0.25), 0)
            parts.append(s)
        at = (bx, table + bh + 0.004, bz)
        OMOK_BOWLS[side] = at
        e = bpy.data.objects.new(f"omok_bowl_{side}", None)  # where a hand dips in for a stone
        coll("export").objects.link(e)
        e.matrix_world = Mx(at)
        e["bowl"] = side
        NODES.append({"obj": e, "play": "omok"})
    return parts


def build_play_lives():
    """live nodes of #135 that are not props: the stone samples, the ball, the table surface"""
    G = "prop"
    out = []
    # stone samples (hidden by the app, which instances them): pivot at the bottom center. They sit on the heaps
    for side, m in zip("bw", stone_mats()):
        x, y, z = OMOK_BOWLS[side]
        M = Mx((x, y, z))
        out.append((pivot(join(f"omok_stone_{side}", place([lens("stone", OMOK["stone_d"], OMOK["stone_h"], (0, OMOK["stone_h"] / 2, 0), m, G)], M)), M), "bot"))
    # ping-pong: the ball moves by the app (not a prop: PropBank must not pick it up); pp_table = the playing surface
    tx, tz = PINGPONG
    th = 0.76
    M = Mx((tx + 0.25, th + 0.02, tz - 0.1))
    out.append((pivot(join("pp_ball", place([sphere("ball", 0.02, (0, 0, 0), plastic("#f7f7f2", 0.8, 0, 0, "ball"), G, seg=14, rings=10)], M)), M), "bot"))
    t = bpy.data.objects.new("pp_table", None)
    coll("export").objects.link(t)
    t.matrix_world = Mx((tx, th, tz))  # +x = the long side
    t["size"], t["net_h"] = [2.05, 1.14], 0.15
    NODES.append({"obj": t, "play": "pingpong"})
    return out


def build_lounge():
    G = "lounge"
    metal = plastic("#2a2c31", 0.35, 0.8, 0.03, "metal")
    p = []
    # ping-pong table
    tx, tz = PINGPONG
    tw, td, th = 2.05, 1.14, 0.76  # 0.75 x a real table (2.74 x 1.525), office-quality.md rule 5
    green = plastic("#1f5a46", 0.6, 0, 0.2, "pp_top")
    white = plastic("#f2f2f2", 0.5, 0, 0, "pp_line")
    p += [box("pp_top", (tw, 0.04, td), (tx, th - 0.02, tz), green, G, bev=0.004),
          box("pp_edge", (tw, 0.004, 0.02), (tx, th + 0.001, tz + td / 2 - 0.01), white, G),
          box("pp_edge", (tw, 0.004, 0.02), (tx, th + 0.001, tz - td / 2 + 0.01), white, G),
          box("pp_end", (0.02, 0.004, td), (tx - tw / 2 + 0.01, th + 0.001, tz), white, G),
          box("pp_end", (0.02, 0.004, td), (tx + tw / 2 - 0.01, th + 0.001, tz), white, G),
          box("pp_mid", (tw, 0.004, 0.006), (tx, th + 0.001, tz), white, G),
          box("pp_net", (0.01, 0.15, td + 0.1), (tx, th + 0.075, tz), plastic("#111318", 0.9, 0, 0.5, "net"), G)]
    for sx in (-tw / 2 + 0.15, tw / 2 - 0.15):
        for sz in (-td / 2 + 0.12, td / 2 - 0.12):
            p.append(box("pp_leg", (0.05, th - 0.04, 0.05), (tx + sx, (th - 0.04) / 2, tz + sz), metal, G))
    # with the players: nav_pingpong_a|b hover 1.33 m from the center, 0.22 m body -> 0.55 m past each end
    fp("pingpong", p, "floor", grow=(0.55, 0.0))
    # the paddles and the ball are props now (build_props): agents pick them up
    # sofa facing the back wall
    mark = len(p)
    sx, sz = SOFA
    teal = plastic("#2f6f73", 0.95, 0, 0.8, "sofa")
    p += [rounded_slab("sofa_base", 1.9, 0.22, 0.85, 0.05, (sx, 0.19, sz), teal, G, edge=0.02),
          rounded_slab("sofa_back", 1.9, 0.5, 0.22, 0.06, (sx, 0.5, sz + 0.33), teal, G, edge=0.03),
          rounded_slab("arm", 0.2, 0.32, 0.85, 0.06, (sx - 0.85, 0.42, sz), teal, G, edge=0.03),
          rounded_slab("arm", 0.2, 0.32, 0.85, 0.06, (sx + 0.85, 0.42, sz), teal, G, edge=0.03)]
    for k in range(3):
        p.append(rounded_slab("cushion", 0.5, 0.14, 0.6, 0.06, (sx - 0.53 + k * 0.53, 0.37, sz - 0.05), teal, G, edge=0.04))
    p.append(rounded_slab("pillow", 0.36, 0.3, 0.12, 0.08, (sx - 0.55, 0.58, sz + 0.18), plastic("#f2c14e", 0.95, 0, 0.6, "pillow"), G, edge=0.04))
    for dx in (-0.85, 0.85):
        for dz in (-0.35, 0.35):
            p.append(cyl("sofa_foot", 0.025, 0.08, (sx + dx, 0.04, sz + dz), metal, G, 10))
    fp("sofa", p[mark:], "floor")
    # board game table with two stools and a board
    mark = len(p)
    gx, gz = GAME_TABLE
    p += [cyl("gt_top", 0.42, 0.04, (gx, 0.72, gz), plastic("#c9b89a", 0.55, 0, 0.35, "desk_top"), G, 40, bev=0.006),
          cyl("gt_col", 0.04, 0.68, (gx, 0.36, gz), metal, G, 14),
          cyl("gt_foot", 0.22, 0.03, (gx, 0.015, gz), metal, G, 32)]
    # omok (#135, play.md 1): a 15 x 15 board on the table, a stone bowl at each stool's side. The stones on the
    # board are the app's (InstancedMesh from omok_stone_b|w at omok_grid); the board bakes empty
    for k in range(10):
        RNG.randint(0, 7), RNG.randint(0, 7)  # the old chess pieces' draws: the RNG stream (plants below) stays as it was
    board = build_omok(gx, gz, G)
    p += board
    for dx in (-0.6, 0.6):
        p += [cyl("stool", 0.18, 0.05, (gx + dx, 0.5, gz), plastic("#d64545", 0.6, 0, 0.3, "stool"), G, 24, bev=0.01),
              cyl("stool_col", 0.025, 0.48, (gx + dx, 0.24, gz), metal, G, 10),
              cyl("stool_foot", 0.15, 0.02, (gx + dx, 0.01, gz), metal, G, 24)]
    fp("game", p[mark:], "floor")  # the table with its two stools
    p = [o for o in p if o not in board]
    OMOK_NODES.append(join("omok_board", board[:OMOK_BOARD_PARTS]))  # its own node: the lines need texels (below)
    p += board[OMOK_BOARD_PARTS:]
    # coffee counter against the right wall (#109: it used to cut into the door), built in its own frame: local +x = front
    c = []
    c += [box("counter", (0.6, 0.9, 0.7), (0, 0.45, 0), plastic("#2b2f3a", 0.6, 0, 0.2, "counter"), G, bev=0.01),
          box("counter_top", (0.64, 0.04, 0.74), (0, 0.92, 0), plastic("#e8e4dc", 0.3, 0, 0.3, "counter_top"), G, bev=0.006),
          box("machine", (0.28, 0.36, 0.3), (0, 1.12, -0.12), plastic("#1b1d22", 0.35, 0.6, 0.05, "machine"), G, bev=0.02),
          box("spout", (0.06, 0.05, 0.08), (0.12, 1.02, -0.12), plastic("#c8ccd4", 0.3, 0.9, 0, "chrome"), G)]
    # the cup under the spout and one beside it are props (build_props); the stack stays baked
    for k in range(3):
        c.append(cyl("cup", 0.035, 0.08, (0.05, 0.98 + k * 0.08, 0.2), plastic("#f4f4f0", 0.4, 0, 0, "cup"), G, 16, r2=0.03))
    c = place(c, counter_frame())
    fp("counter", c, "floor", "e")  # stands against the right wall
    p += c
    # floor plants (#126): one species each, each its own node (PLANT_NODES) so its leaves can bake at half density
    for name, species, px, pz in PLANTS:
        objs = plant_tris(name, PLANT_BUILDERS[species](name, px, pz, G))
        fp(name, objs, "decor")
        PLANT_NODES.append(join(name, objs))
    # floor lamp by the sofa (its shade glows live)
    lx, lz = SOFA[0] + 1.3, SOFA[1] + 0.25
    p += [cyl("lamp_base", 0.14, 0.03, (lx, 0.015, lz), metal, G, 24),
          cyl("lamp_pole", 0.015, 1.5, (lx, 0.78, lz), metal, G, 10)]
    shade = cyl("lamp_shade", 0.2, 0.26, (lx, 1.62, lz), emitter("#ffcf8a", 2.0, "lamp_shade"), "export", 32, r2=0.13)
    fp("floor_lamp", p[-2:] + [shade], "decor")
    # small round side table in the open front middle (#109): an empty top and a basket for now
    sx2, sz2 = SIDE_TABLE
    st = [cyl("side_top", 0.3, 0.03, (sx2, 0.55, sz2), plastic("#c9b89a", 0.55, 0, 0.35, "desk_top"), G, 32, bev=0.006),
          cyl("side_col", 0.025, 0.52, (sx2, 0.27, sz2), metal, G, 12),
          cyl("side_foot", 0.18, 0.02, (sx2, 0.01, sz2), metal, G, 24),
          cyl("basket", 0.11, 0.08, (sx2 + 0.06, 0.605, sz2 - 0.04), plastic("#b98a4e", 0.9, 0, 0.6, "basket"), G, 16, r2=0.09)]
    fp("side_table", st, "floor")
    p += st
    lounge = join("lounge", p)
    return lounge, apply_all(shade), (lx, 1.55, lz)


# ================================================================ PROPS (live, real-time lit)
# Things agents pick up while playing. Each is built around its pivot (where a hand holds it: paddle handle end,
# cup and watering-can handle; ball and pieces at their center), exported at its home spot with extras:
#   prop = kind,  home = {pos, rot} (web, Euler XYZ),  grip = {pos, rot} (offset from agent_i_hand_l|r)
# They are left out of the bake (#43): a lifted prop would leave its shadow behind; the app can add a small contact shadow.


def prop(name, kind, objs, home_pos, home_rot=(0.0, 0.0, 0.0), grip_pos=(0.0, 0.0, 0.0), grip_rot=(0.0, 0.0, 0.0)):
    H = Mx(home_pos, *home_rot)
    o = pivot(join(name, place(objs, H)), H)
    o["prop"] = kind
    o["home"] = {"pos": [round(v, 4) for v in home_pos], "rot": [round(v, 4) for v in home_rot]}
    o["grip"] = {"pos": [round(v, 4) for v in grip_pos], "rot": [round(v, 4) for v in grip_rot]}
    return o


BOOK_HALVES = []  # live bot: prop_book_l, prop_book_r


def build_book(G):
    """book frame: origin on the spine axis at mid thickness, pages along +x (0.15), spine along z (0.22), thickness
    along y; the lower half (_r) under y = 0, the upper half (_l) above. Home: lying on the side table"""
    W_, H_, T = 0.15, 0.22, 0.025
    cover = plastic("#2f6f9f", 0.6, 0, 0.3, "book_cover")  # a decorative-book blue from the shelf
    paper = plastic("#efe9df", 0.9, 0, 0.1, "book_paper")
    ink = plastic("#9a948a", 0.9, 0, 0.0, "book_ink")
    sx2, sz2 = SIDE_TABLE
    H = Mx((sx2 - 0.235, 0.565 + T / 2, sz2 + 0.06), 0.0, 0.15, 0.0)

    def half(name, sgn):
        """sgn = +1: the upper half (cover on top), -1: the lower one"""
        c = T / 2 - 0.001
        objs = [box("cover", (W_, 0.002, H_), (W_ / 2, sgn * c, 0), cover, G, bev=0.0008, seg=1),
                box("pages", (W_ - 0.006, T / 2 - 0.002, H_ - 0.01), (W_ / 2 - 0.001, sgn * (T / 4 - 0.001), 0), paper, G)]
        if sgn > 0:  # the spine's upper half turns with this half (a whole spine would stand up between open pages)
            objs.append(box("spine", (0.003, T / 2, H_), (-0.0015, T / 4, 0), cover, G))
        for k in range(8):  # a few grey lines of text on the inner page (seen when open)
            objs.append(box("line", (W_ - 0.04 - (0.03 if k % 3 == 2 else 0), 0.0002, 0.0025),
                            (W_ / 2 - (0.015 if k % 3 == 2 else 0), -sgn * 0.0001, -0.075 + k * 0.02), ink, G))
        return live(pivot(join(name, place(objs, H)), H), "bot")

    BOOK_HALVES.extend([half("prop_book_l", 1), half("prop_book_r", -1)])
    spine = [box("spine", (0.003, T / 2, H_), (-0.0015, -T / 4, 0), cover, G)]  # the lower half of the spine
    return prop("prop_book", "book", spine, (sx2 - 0.235, 0.565 + T / 2, sz2 + 0.06), (0.0, 0.15, 0.0),
                grip_pos=(0, -0.04, 0), grip_rot=(-math.pi / 2, 0, 0))


def build_props():
    G = "prop"
    out = []
    tx, tz = PINGPONG
    th = 0.76
    wood_h = plastic("#c9a47a", 0.6, 0, 0.3, "handle")
    # paddles (play.md): handle end at the origin, handle along local +y, an oval blade 0.15 x 0.16 beyond it: a
    # 4 mm wooden core (its 1 mm rim shows), red rubber on local +z, black on -z, 6 mm in all. The handle widens
    # a little at its end. Home: flat on the table, red up, handle toward the player at that end. Grip: handle in
    # the fist, blade carried on along the arm (local +y -> hand -y).
    red, black = plastic("#d43a33", 0.7, 0, 0.3, "paddle_red"), plastic("#1d1f24", 0.7, 0, 0.3, "paddle_black")

    def oval(name, r, depth, z, m):
        o = cyl(name, r, depth, (0, 0.17, z), m, G, 32, axis="z")
        o.data.transform(Matrix.Diagonal((1.0, 0.16 / 0.15, 1.0, 1.0)))  # local y = web y after the axis turn
        return o

    for end, bx, bz, rz in (("a", tx - 0.6, tz + 0.25, -math.pi / 2), ("b", tx + 0.62, tz - 0.25, math.pi / 2)):
        objs = [box("grip", (0.026, 0.09, 0.02), (0, 0.055, 0), wood_h, G, bev=0.004, seg=2),
                box("grip_end", (0.032, 0.014, 0.022), (0, 0.007, 0), wood_h, G, bev=0.004, seg=2),
                oval("blade", 0.075, 0.004, 0.0, wood_h),
                oval("rubber_red", 0.074, 0.001, 0.0025, red),
                oval("rubber_black", 0.074, 0.001, -0.0025, black)]
        hx = bx + (-0.17 if end == "a" else 0.17)  # handle end sits 0.17 m behind the blade center
        out.append(prop(f"prop_paddle_{end}", "paddle", objs, (hx, th + 0.003, bz), (-math.pi / 2, 0.0, rz),
                        grip_pos=(0, -0.02, 0), grip_rot=(math.pi, 0, 0)))
    # the ball is pp_ball now (build_play_lives): the app moves it, PropBank must not pick it up
    # cups: origin at the handle (on local +x), body hanging beside it. Home on the counter, handle toward the room
    C = counter_frame()
    for k, (bx, bz) in enumerate(((0.14, -0.12), (0.19, 0.07))):  # counter frame: under the spout, and beside it
        # 1.25x the baked mugs so a cup still reads in a robot hand
        objs = [cyl("cup", 0.045, 0.105, (-0.072, 0, 0), plastic("#f4f4f0", 0.4, 0, 0, "cup"), G, 20),
                torus("cup_handle", 0.027, 0.0075, (-0.027, 0.0, 0), plastic("#f4f4f0", 0.4, 0, 0, "cup"), G, axis="z", half=True, seg=16, rseg=6)]
        at = (C @ Mx((bx + 0.072, 0.94 + 0.0525, bz))).to_translation()
        out.append(prop(f"prop_cup_{k}", "cup", objs, (at.x, at.z, -at.y), (0.0, COUNTER[2], 0.0)))
    # watering can: origin at the top of its carry handle; body, spout and rose below. Home on the floor by the
    # front-right plant
    green = plastic("#3fa36b", 0.45, 0.2, 0.1, "can")
    objs = [cyl("can_body", 0.08, 0.14, (0, -0.13, 0), green, G, 28, bev=0.006),
            cyl("can_lid", 0.05, 0.012, (0, -0.054, 0), green, G, 20),
            box("can_post", (0.012, 0.06, 0.016), (-0.045, -0.03, 0), green, G),
            box("can_post", (0.012, 0.06, 0.016), (0.045, -0.03, 0), green, G),
            box("can_bar", (0.1, 0.014, 0.018), (0, 0, 0), green, G, bev=0.004, seg=2),
            segment("can_spout", (0.07, -0.17, 0), (0.2, -0.07, 0), 0.012, green, G, r2=0.009),
            cyl("can_rose", 0.022, 0.014, (0.205, -0.065, 0), plastic("#c8ccd4", 0.3, 0.9, 0, "chrome"), G, 16)]
    can = prop("prop_watering_can", "watering_can", objs, (3.75, 0.2, 3.3), (0.0, 0.6, 0.0))
    out.append(can)
    # the spout's end (#135): where the water starts, local +z = along the spout (the app tilts the can to pour)
    a = math.atan2(0.10, 0.13)
    e = bpy.data.objects.new("prop_watering_can_spout", None)
    coll("export").objects.link(e)
    e.parent = can
    e.matrix_world = can.matrix_world @ Mx((0.212, -0.06, 0.0), 0.0, math.pi / 2, a)
    NODES.append({"obj": e, "play": "spout"})
    # omok stones in the hand (#135: the chess pieces became go stones): a = black, b = white, home on the heap in
    # its bowl, next to the sample stone. Center pivot (a pinch between the fingers)
    for end, side, m in zip("ab", "bw", stone_mats()):
        x, y, z = OMOK_BOWLS[side]
        out.append(prop(f"prop_piece_{end}", "piece", [lens("piece", OMOK["stone_d"], OMOK["stone_h"], (0, 0, 0), m, G)],
                        (x + (0.014 if side == "b" else -0.014), y + 0.006, z), grip_pos=(0, -0.04, 0)))
    # a book to read on the sofa (#135, play.md): closed 0.15 x 0.22 x 0.025 on the side table. prop_book is the
    # spine (the prop PropBank carries); its two halves are live bot nodes the app attaches to it and turns
    # about the spine (local z through the pivot): prop_book_l (the upper half) opens by +180° to lie flat at -x
    out.append(build_book(G))
    # MEMO's desk (seat 0) props, homes in world coordinates through the desk frame
    F0 = frame(AGENTS[0]["at"])
    ry0 = AGENTS[0]["at"][2]

    def desk0(x, y, z):
        t = (F0 @ Mx((x, y, z))).to_translation()
        return (t.x, t.z, -t.y)

    # paper plane (#27, a short hand-off from MEMO): folded from a post-it, nose = local -z, resting on its keel.
    # #43: one of the three on the IN/OUT tray lid (desks.md: 0.06 x 0.08), the one MEMO throws.
    # Grip: pinched under the wings, nose along the fingers.
    plane = paper_plane("plane", 0.5, plastic(POSTIT[0], 0.85, 0, 0.2, "postit_0"), G)
    out.append(prop("prop_plane", "plane", [plane], desk0(TRAY[0] + 0.065, DESK_H + 0.154 + 0.011, -0.22), (0.0, ry0 - 0.3, 0.0),
                    grip_pos=(0, -0.04, 0), grip_rot=(-math.pi / 2, 0, 0)))
    # sign-off stamp (#43): origin at the body's center, face = local -y. Home: standing by the ink pad.
    # Grip: in the fist, face out of the little-finger side (grip +z: down at the rest pose)
    amber = plastic(AGENTS[0]["color"], 0.4, 0, 0.05, "stamp")
    objs = [cyl("stamp_body", 0.018, 0.075, (0, 0, 0), amber, G, 18, bev=0.002),
            cyl("stamp_face", 0.019, 0.006, (0, -0.0395, 0), plastic("#7a1f1f", 0.7, 0, 0.1, "stamp_rubber"), G, 18),
            sphere("stamp_knob", 0.02, (0, 0.05, 0), plastic("#c9a36b", 0.6, 0, 0.3, "handle"), G, seg=14, rings=8)]
    out.append(prop("prop_stamp", "stamp", objs, desk0(0.51, DESK_H + 0.0425, 0.12), (0.0, ry0, 0.0),
                    grip_pos=(0, -0.03, 0), grip_rot=(-math.pi / 2, 0, 0)))
    return out


# ================================================================ EXIT DOOR (part of room atlas + live screen)
def build_door():
    G = "door"
    ivory = plastic("#e8e1cf", 0.45, 0, 0.15, "ivory")
    dark = plastic("#16181d", 0.5, 0.3, 0.05, "bezel")
    x = -HX + 0.03
    p = [panel("door_body", 1.05, 2.2, 0.12, 0.12, (0, 0, 0), ivory, G, edge=0.01),
         panel("door_bezel", 0.86, 1.86, 0.02, 0.08, (0, 0, 0.06), dark, G)]
    for k, dx in enumerate((-0.18, 0.18)):
        p.append(cyl("knob", 0.03, 0.03, (dx, -0.98, 0.07), plastic("#2a2c31", 0.4, 0.6, 0, "knob"), G, 16, axis="z"))
    M = Mx((x + 0.06, 1.12, DOOR_Z), ry=math.pi / 2)
    placed = place(p, M)
    fp("door", placed, "wall", "w")
    fp_box("door_clear", "clear", (x + 0.13, 0.0, DOOR_Z - 0.5), (x + 0.13 + 0.8, 0.0, DOOR_Z + 0.5))  # 0.8 m kept free in front
    door = join("door", placed)
    drop_facing(door, (-1, 0, 0))  # its back, flat against the wall
    scr = quad("screen_door", 0.8, 1.78, screen_mat("door_glow", "#ffb347", 0.45), "export")
    screen = slot(apply_all(place(scr, M @ Mx((0, 0.02, 0.072)))[0]), 0.8, 1.78)
    return door, screen


# ================================================================ AGENTS (live, real-time lit)
# Agents have no body (#28): a floating head and two floating hands, all held up by the same light — a thrust
# ring under the head with a faint beam down to a glow disc on the floor, and a glowing cuff closing each wrist.
# They glide, bob, type and hand things over, so they are not baked; the bake hides them (no ghost shadows).
# Every part is a flat top-level node with its pivot (extras pivot_at, web coords) and the app parents them
# (docs/design/agents.md 2.3):
#   agent_<i>                 empty, the floor under the head; moving / turning the agent = this frame (front -z)
#   agent_<i>_head            the whole body: head, ears, thrust housing, fixed role parts. Pivot = head center
#   agent_<i>_face            canvas slot (screen=true, aspect, w, h) on the head front; _tip = state light
#   agent_<i>_glow / _beam    thrust ring light / light beam (pivot at its top: the app stretches it in y)
#   agent_<i>_floor           glow disc on the floor (UV 0..1 so the app can fade its edge)
#   agent_<i>_hand_l|r        palm, rotated into the rest pose; children: _grip (empty, where a prop attaches)
#   agent_<i>_hand_l|r_index|fingers|thumb   pivot at the root joint, bend = local x (+ = toward the palm)
#   agent_<i>_hand_l|r_cuff   the glowing wrist ring
# Role parts that move on their own: agent_0_pen (prop), agent_0_postit_0..4, agent_1_orbit, agent_3_ear_glow;
# agent_3_tip is the spinning loop ring (spin = local y).
HEAD_Y = 1.15  # head center: seated eye height, facing the monitor center
HEAD = (0.42, 0.32, 0.34)
GLOW_Y = 0.97  # thrust ring under the head
HAND_REST = (0.30, 0.86, -0.04)  # (±x, y, z) palm center at rest, agent frame
SPAWN = [  # where each agent hovers in the exported (idle) pose: ping-pong, coffee, whiteboard, desk side
    (PINGPONG[0] - 1.33, PINGPONG[1], -math.pi / 2),
    (PINGPONG[0] + 1.33, PINGPONG[1], math.pi / 2),
    (COUNTER[0] - 0.62, COUNTER[1], -math.pi / 2),  # nav_coffee: in front of the counter, facing +x
    (WHITEBOARD_X, -HZ + 0.9, 0.0),
]
POSTIT = ["#ffe27a", "#ffc46b", "#fff1b8"]
# the #20 grip offsets were defined on the old hand empty: agent frame, arm hanging (-y = away from the
# shoulder, x = the agent's right). The fingers now play that -y; at rest the grip frame = agent frame @ Rx(60°)
GRIP_RX = math.radians(60)
GRIP_Y = 0.015  # grip point: palm center, moved this far along the fingers (hand local +y)


def basis(loc, x, y, z):
    """frame from web axis vectors (orthonormal, right-handed) at a web point, as a Blender matrix"""
    M = Matrix.Identity(4)
    for c, v in enumerate((x, -Vector(z), y)):  # Blender local X, Y, Z = web x, -z, y
        b = W(*v).normalized()
        for r in range(3):
            M[r][c] = b[r]
    M.translation = W(*loc)
    return M


def hand_rest(side):
    """the rest pose (agent frame): fingers (local +y) forward and 30° down, palm (local +z) facing the body's
    center line, thumb (local x side) up. A relaxed hand just before a handshake."""
    sx = -1 if side == "l" else 1
    y = Vector((0, -math.sin(math.radians(30)), -math.cos(math.radians(30))))
    z = Vector((-sx, 0, 0))
    return basis((sx * HAND_REST[0], HAND_REST[1], HAND_REST[2]), y.cross(z), y, z)


def capsule(name, r, length, material, group, square=False):
    """finger along local +y from the root (y 0) to the tip; the root end sits inside the palm (no cap)"""
    if square:  # keycap-like: a box with a small bevel (LOOP)
        return [box(name, (2 * r, length, 2 * r), (0, length / 2, 0), material, group, bev=0.006, seg=1)]
    return [cyl(name, r, length - r, (0, (length - r) / 2, 0), material, group, 8),
            sphere(name, r, (0, length - r, 0), material, group, seg=8, rings=5)]


def lowrail(name, pts, r, material, group):
    """rail() with a lighter tube (the agents' triangle budget)"""
    o = rail(name, pts, r, material, group)
    o.data.resolution_u = 5
    o.data.bevel_resolution = 1
    return o


def disc(name, r, material, group, seg=32):
    """flat disc in the web x/z plane facing up, UV = planar 0..1 over its square"""
    me = bpy.data.meshes.new(name)
    vs = [(0, 0, 0)] + [(r * math.cos(2 * math.pi * k / seg), r * math.sin(2 * math.pi * k / seg), 0) for k in range(seg)]
    me.from_pydata(vs, [], [(0, 1 + k, 1 + (k + 1) % seg) for k in range(seg)])
    uv = me.uv_layers.new(name="UVMap")
    for p in me.polygons:
        for li, vi in zip(p.loop_indices, p.vertices):
            uv.data[li].uv = (0.5 + vs[vi][0] / (2 * r), 0.5 + vs[vi][1] / (2 * r))
    o = bpy.data.objects.new(name, me)
    coll(group).objects.link(o)
    me.materials.append(material)
    return o


def soft_glow(h, alpha, strength, name):
    """emissive, mostly see-through (the beam and the floor disc); the app draws them additive"""
    m = emitter(h, strength, name)
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Alpha"].default_value = alpha
    try:
        m.blend_method = "BLEND"
    except Exception:
        pass
    return m


def build_agent(i, agent):
    G = "bot"
    col = agent["color"]
    shell = plastic("#f6f3ec", 0.32, 0, 0.08, "bot_shell")
    joint = plastic("#4a505c", 0.35, 0.35, 0.05, "bot_joint")
    accent = plastic(col, 0.4, 0, 0.05, f"bot_accent_{i}")
    ab = accent.node_tree.nodes["Principled BSDF"]
    ab.inputs["Emission Color"].default_value = rgba(col)
    ab.inputs["Emission Strength"].default_value = 0.35
    glow_m = emitter(col, 6.0, f"glow_{i}")
    x, z, ry = SPAWN[i]
    root = Mx((x, 0, z), ry=ry)
    Hd = root @ Mx((0, HEAD_Y, 0))
    hw, hh, hd = HEAD
    bot, neon, other = [], [], []  # live kinds

    # -- the agent frame: an empty on the floor
    a = bpy.data.objects.new(f"agent_{i}", None)
    coll("export").objects.link(a)
    a.matrix_world = root
    a["pivot_at"] = [round(x, 5), 0.0, round(z, 5)]
    bot.append(a)

    # -- head: rounded box (MESH: chamfered, two chamfer faces glowing lavender), ears, vent, thrust housing
    if i == 1:
        head = box("head", HEAD, (0, 0, 0), shell, G, bev=0.06, seg=1)
        head = apply_all(head)
        head.data.materials.append(emitter(col, 0.5, "mesh_facet"))
        for p in head.data.polygons:  # front-left and back-right vertical chamfers (diagonal pair)
            n = p.normal
            if (abs(n.x + 0.7071) < 0.05 and abs(n.y - 0.7071) < 0.05) or (abs(n.x - 0.7071) < 0.05 and abs(n.y + 0.7071) < 0.05):
                p.material_index = 1
    else:
        head = box("head", HEAD, (0, 0, 0), shell, G, bev=0.08, seg=3)
    hp = [head,
          panel("face_bezel", 0.33, 0.21, 0.006, 0.03, (0, 0, -hd / 2 + 0.001), plastic("#111216", 0.3, 0.2, 0, "face_bezel"), G),
          box("vent_plate", (0.24, 0.13, 0.006), (0, -0.01, hd / 2), joint, G)]
    hp += [box("vent", (0.2, 0.012, 0.008), (0, -0.05 + k * 0.027, hd / 2 + 0.004), shell, G) for k in range(4)]
    hp += [cyl("thrust", 0.105, 0.03, (0, -hh / 2 - 0.005, 0), joint, G, 16, r2=0.09)]
    ears = {"l": True, "r": True}
    if i == 0:  # MEMO: antenna (back), headset on the right ear (cup + boom + status mic)
        ears["r"] = False
        hp += [cyl("antenna", 0.01, 0.14, (0.08, hh / 2 + 0.07, 0.08), joint, G, 8),
               box("headset", (0.064, 0.14, 0.06), (hw / 2 + 0.03, 0, 0), joint, G, bev=0.025, seg=2),
               lowrail("boom", [(hw / 2 + 0.045, -0.05, -0.02), (hw / 2 + 0.01, -0.11, -0.15), (0.09, -0.13, -0.205)], 0.008, joint, G),
               sphere("mic", 0.02, (0.09, -0.13, -0.205), accent, G, seg=10, rings=6)]
    if i == 1:  # MESH: gizmo (stalk, three axis bars + ends; the center is the tip)
        cz = hh / 2 + 0.13
        hp += [cyl("gizmo_stalk", 0.01, 0.11, (0, hh / 2 + 0.055, 0), joint, G, 8)]
        for v, c in (((1, 0, 0), "#ff4d5e"), ((0, 1, 0), "#5dde7a"), ((0, 0, 1), "#4d8bff")):
            m = plastic(c, 0.4, 0, 0, f"gizmo_{c}")
            end = (0.13 * v[0], cz + 0.13 * v[1], 0.13 * v[2])
            hp += [segment("gizmo_bar", (0, cz, 0), end, 0.009, m, G, verts=8),
                   sphere("gizmo_end", 0.026, end, m, G, seg=10, rings=6)]
    if i == 2:  # HUE: a flat beret tilted -10° (band, dome, stalk)
        fabric_m = plastic("#5a2147", 0.85, 0, 0.4, "beret")
        beret = [cyl("beret_band", 0.215, 0.035, (0, 0, 0), fabric_m, G, 32),
                 sphere("beret_dome", 0.26, (0, 0.01, 0), fabric_m, G, scale=(1, 0.09 / 0.26, 1), half=True, seg=32, rings=10),
                 cyl("beret_stalk", 0.008, 0.03, (0, 0.11, 0), fabric_m, G, 8)]
        hp += place(beret, Mx((0, hh / 2 + 0.005, 0), rz=math.radians(-10)))
    if i == 3:  # LOOP: headphones (cups at the ears + band over the top)
        ears = {"l": False, "r": False}
        for sx in (-1, 1):
            hp.append(box("cup", (0.09, 0.18, 0.09), (sx * (hw / 2 + 0.045), 0, 0), joint, G, bev=0.03, seg=2))
        hp.append(lowrail("band", [(-(hw / 2 + 0.045), 0.09, 0), (-0.2, 0.22, 0), (0, hh / 2 + 0.1, 0), (0.2, 0.22, 0),
                                (hw / 2 + 0.045, 0.09, 0)], 0.02, joint, G))
    for s, sx in (("l", -1), ("r", 1)):
        if ears[s]:
            hp.append(cyl("ear", 0.04, 0.03, (sx * (hw / 2 + 0.012), 0, 0), accent, G, 16, axis="x"))
    bot.append(pivot(join(f"agent_{i}_head", place(hp, Hd)), Hd))

    # -- face slot (off screen material on export; the app draws the face)
    face = quad(f"agent_{i}_face", 0.30, 0.18, screen_mat(f"face_glow_{i}", col, 0.8), "export")
    face.rotation_euler = (0, 0, math.pi)  # faces local -z (forward)
    face = pivot(apply_all(place(face, Hd @ Mx((0, 0, -0.172)))[0]), Hd)
    slot(face, 0.30, 0.18)
    other.append((face, "face"))

    # -- state light (tip)
    # pivot = the light's own center (MEMO antenna end, MESH gizmo center, HUE beret stalk), head's rotation
    tip_m = emitter(col, 4.0, f"tip_{i}")
    if i < 3:
        r, T = ((0.026, Hd @ Mx((0.08, hh / 2 + 0.165, 0.08))),
                (0.03, Hd @ Mx((0, hh / 2 + 0.13, 0))),
                (0.022, Hd @ Mx((0, hh / 2 + 0.005, 0), rz=math.radians(-10)) @ Mx((0, 0.13, 0))))[i]
        tip = sphere(f"agent_{i}_tip", r, (0, 0, 0), tip_m, "export", seg=10, rings=6)
        neon.append(pivot(apply_all(place(tip, T)[0]), T))
    else:  # LOOP: the ring itself, open by 40° with an arrowhead at one end; spins about local y
        Rc = Hd @ Mx((0, hh / 2 + 0.2, 0), rx=math.radians(-25))  # tipped 25° forward: reads as a ring at eye level
        ring = torus(f"agent_{i}_tip", 0.13, 0.011, (0, 0, 0), tip_m, "export", seg=28, rseg=5)
        bm = bmesh.new()
        bm.from_mesh(ring.data)
        gap = math.radians(40)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if math.atan2(v.co.y, v.co.x) % (2 * math.pi) > 2 * math.pi - gap + 1e-4], context="VERTS")
        bm.to_mesh(ring.data)
        bm.free()
        # arrowhead at angle 0 (web +x), pointing along the ring into the gap (web +z there, i.e. clockwise from above)
        head_a = cyl("arrow", 0.03, 0.05, (0.13, 0, 0.02), tip_m, "export", 12, axis="z", r2=0.0)
        tip = join(f"agent_{i}_tip", place([ring, head_a], Rc))
        neon.append(pivot(tip, Rc))

    # -- hover light: thrust ring (glow), beam (pivot on top), floor disc
    Gy = root @ Mx((0, GLOW_Y, 0))
    glow = join(f"agent_{i}_glow", place([torus("ring", 0.085, 0.012, (0, -0.002, 0), glow_m, "export", seg=24, rseg=5),
                                          place(disc("disc", 0.075, glow_m, "export", seg=16), Mx((0, -0.004, 0)))[0]], Gy))
    neon.append(pivot(glow, Gy))
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=32, radius1=0.2, radius2=0.085, depth=GLOW_Y - 0.005)
    beam = mesh_obj(f"agent_{i}_beam", bm, soft_glow(col, 0.12, 1.5, f"beam_{i}"), "export")
    beam.location = W(0, -(GLOW_Y - 0.005) / 2, 0)
    beam = pivot(apply_all(place(beam, Gy)[0]), Gy)
    neon.append(beam)
    F0 = root @ Mx((0, 0.005, 0))
    floor = pivot(apply_all(place(disc(f"agent_{i}_floor", 0.26, soft_glow(col, 0.45, 1.2, f"floor_{i}"), "export"), F0)[0]), F0)
    neon.append(floor)

    # -- hands (glove A: palm + index + three-finger block + thumb), wrist cuff, grip empty
    square = i == 3
    for side, sx in (("l", -1), ("r", 1)):
        Mh = root @ hand_rest(side)
        n = f"agent_{i}_hand_{side}"
        palm = box("palm", (0.086, 0.086, 0.045), (0, 0, 0), shell, G, bev=0.02, seg=3)
        bot.append(pivot(join(n, place([palm], Mh)), Mh))
        Mi = Mh @ Mx((sx * 0.027, 0.022, 0.0))
        bot.append(pivot(join(f"{n}_index", place(capsule("index", 0.011, 0.07, shell, G, square), Mi)), Mi))
        Mf = Mh @ Mx((-sx * 0.013, 0.02, 0.0))
        blk = box("fingers", (0.046, 0.055, 0.04), (0, 0.0275, 0), shell, G, bev=0.006 if square else 0.015, seg=1 if square else 2)
        bot.append(pivot(join(f"{n}_fingers", place([blk], Mf)), Mf))
        Mt = Mh @ Mx((sx * 0.04, -0.018, 0.0)) @ Mx(rz=-sx * math.radians(35)) @ Mx(rx=math.radians(20))
        bot.append(pivot(join(f"{n}_thumb", place(capsule("thumb", 0.012, 0.046, shell, G, square), Mt)), Mt))
        cuff = [tube("cuff", 0.036, 0.023, (0, -0.05, 0), glow_m, "export", 16),
                cyl("cuff_cap", 0.03, 0.006, (0, -0.06, 0), glow_m, "export", 12)]
        neon.append(pivot(join(f"{n}_cuff", place(cuff, Mh)), Mh))
        g = bpy.data.objects.new(f"{n}_grip", None)
        coll("export").objects.link(g)
        g.parent = bot[-4]  # the palm node
        # 1.5 cm toward the fingers: at the palm center a held cup sank into the palm
        g.matrix_world = Matrix.Translation((Mh @ Mx((0, GRIP_Y, 0))).to_translation()) @ root.to_3x3().to_4x4() @ Mx(rx=GRIP_RX)
        g["grip_of"] = side
        NODES.append({"obj": g, "grip_of": side})

    # -- role parts that move on their own
    if i == 0:  # MEMO: pen over the left ear (a prop with a head-relative home), post-it stack behind the head
        pen_local = Mx((-(hw / 2 + 0.025), 0.07, 0.0), rx=math.radians(25))
        P = Hd @ pen_local
        pen_m = plastic("#2d3240", 0.4, 0.2, 0.05, "pen")
        pen = pivot(join("agent_0_pen", place([cyl("pen", 0.009, 0.15, (0, 0, 0.01), pen_m, G, 12, axis="z"),
                                                cyl("pen_cap", 0.0095, 0.02, (0, 0, -0.075), accent, G, 12, axis="z")], P)), P)
        pen["prop"] = "pen"
        pen["home_on"] = f"agent_{i}_head"
        pen["home"] = {"pos": [round(-(hw / 2 + 0.025), 4), 0.07, 0.0], "rot": [round(math.radians(25), 4), 0.0, 0.0]}
        pen["grip"] = {"pos": [0.0, -0.04, 0.0], "rot": [round(math.pi / 2, 4), 0.0, 0.0]}
        other.append((pen, "prop"))
        spots = [(-0.03, 0.04, 9), (0.04, 0.015, -6), (-0.01, -0.03, 4), (0.05, -0.05, -9), (-0.05, -0.005, 7)]
        for k, (dx, dy, rz) in enumerate(spots):
            Pk = Hd @ Mx((dx, dy, hd / 2 + 0.06 + 0.008 * k), rz=math.radians(rz))
            note = box("postit", (0.09, 0.09, 0.003), (0, 0, 0), plastic(POSTIT[k % 3], 0.85, 0, 0.2, f"postit_{k % 3}"), G)
            bot.append(pivot(join(f"agent_0_postit_{k}", place([note], Pk)), Pk))
    if i == 1:  # MESH: wireframe cube orbiting the head (pivot = orbit center, spin = local y)
        Oc = Hd @ Mx((0, 0.06, 0))
        e, t = 0.1, 0.009
        orbit_m = emitter(col, 2.0, "orbit")
        bars = []
        for ax in range(3):
            for u in (-1, 1):
                for v in (-1, 1):
                    c = [0, 0, 0]
                    c[(ax + 1) % 3], c[(ax + 2) % 3] = u * e / 2, v * e / 2
                    s = [t, t, t]
                    s[ax] = e + t
                    bars.append(box("orbit_bar", tuple(s), tuple(c), orbit_m, "export"))
        cube = place(bars, Mx((0.34, 0, 0), rx=0.6, ry=0.8))
        neon.append(pivot(join("agent_1_orbit", place(cube, Oc)), Oc))
    if i == 3:  # LOOP: ear-cup glow strips (lit while working)
        strips = [box("cup_glow", (0.004, 0.11, 0.025), (sx * (hw / 2 + 0.091), 0, 0), emitter(col, 3.0, "ear_glow"), "export")
                  for sx in (-1, 1)]
        neon.append(pivot(join("agent_3_ear_glow", place(strips, Hd)), Hd))
    return bot, neon, other


# ================================================================ NAVIGATION SPOTS (empties)
# Where agents go and which way they face there. The app links them through the hall nodes into a graph and
# glides agents along it (no teleporting, never through furniture), and sends two agents to a "meet" pair to
# talk face to face. Each empty: name nav_<id>, extras nav=<kind> (work, stand, sofa, stool, play, meet, door,
# hall), ry=<facing>.
def nav(name, x, z, ry, kind):
    o = bpy.data.objects.new(f"nav_{name}", None)
    coll("export").objects.link(o)
    o.matrix_world = Mx((x, 0, z), ry=ry)
    o["nav"] = kind
    o["ry"] = round(ry, 4)
    NODES.append({"obj": o, "nav": kind})
    return o


def surface(name, center, w, h):
    """where the app pins things (cards, visitor notes): an empty at the board's front face, facing web +z"""
    o = bpy.data.objects.new(f"surface_{name}", None)
    coll("export").objects.link(o)
    o.matrix_world = Mx(center)
    o["surface"] = name
    o["w"], o["h"] = w, h
    o["normal"] = [0, 0, 1]
    NODES.append({"obj": o, "surface": name})
    return o


def build_surfaces():
    z = -HZ + 0.02 + 0.021  # just in front of the board faces (board front at z + 0.02)
    surface("whiteboard", (WHITEBOARD_X, 1.5, z), 1.5, 1.0)["wall"] = "n"
    surface("bulletin", (BULLETIN_X, 1.45, z), 0.8, 0.9)["wall"] = "n"


def facing(fx, fz, tx, tz):
    """ry that turns local -z from (fx, fz) toward (tx, tz)"""
    return math.atan2(-(tx - fx), -(tz - fz))


# where a visiting agent stands to talk to the one at desk i, in the desk frame: in front of the desk's right end,
# in the 0.6 m gap to the next desk (#109 layout). Facing the worker.
DESK_SIDE = (0.95, 0.55)
COFFEE_SPOT = (0.62, 0.0)  # in the counter frame: in front of the machine


def build_nav():
    for i, a in enumerate(AGENTS):
        F = frame(a["at"])
        seat = (F @ Mx((0, 0, WORK_Z))).to_translation()
        nav(f"work_{i}", seat.x, -seat.y, a["at"][2], "work")
        side = (F @ Mx((DESK_SIDE[0], 0, DESK_SIDE[1]))).to_translation()
        nav(f"desk_side_{i}", side.x, -side.y, facing(side.x, -side.y, seat.x, -seat.y), "stand")
    stand_z = -HZ + 0.9  # in front of the back wall's boards and the shelf
    nav("whiteboard", WHITEBOARD_X, stand_z, 0.0, "stand")
    nav("bulletin", BULLETIN_X, stand_z, 0.0, "stand")
    nav("shelf", SHELF_X, stand_z, 0.0, "stand")
    cs = (counter_frame() @ Mx((COFFEE_SPOT[0], 0, COFFEE_SPOT[1]))).to_translation()
    nav("coffee", cs.x, -cs.y, facing(cs.x, -cs.y, COUNTER[0], COUNTER[1]), "stand")
    nav("pingpong_a", PINGPONG[0] - 1.33, PINGPONG[1], -math.pi / 2, "play")
    nav("pingpong_b", PINGPONG[0] + 1.33, PINGPONG[1], math.pi / 2, "play")
    for k in range(3):
        nav(f"sofa_{k}", SOFA[0] - 0.53 + k * 0.53, SOFA[1] - 0.05, 0.0, "sofa")
    nav("game_a", GAME_TABLE[0] - 0.6, GAME_TABLE[1], -math.pi / 2, "stool")
    nav("game_b", GAME_TABLE[0] + 0.6, GAME_TABLE[1], math.pi / 2, "stool")
    nav("door", -HX + 0.55, DOOR_Z, math.pi / 2, "door")
    # face-to-face talk spots (0.8 / 0.62 m apart): in the open floor, and by the whiteboard
    nav("meet_a", -1.4, -0.6, -math.pi / 2, "meet")
    nav("meet_b", -0.6, -0.6, math.pi / 2, "meet")
    nav("meet_c", WHITEBOARD_X - 0.31, -1.9, -math.pi / 4, "meet")
    nav("meet_d", WHITEBOARD_X + 0.31, -1.9, math.pi / 4, "meet")
    # hall nodes: the aisles between the zones (#109 layout; the app's nav check #17 links and tests them)
    for name, x, z in (("door", -3.3, DOOR_Z), ("west", -3.0, 1.4), ("work", -2.2, -1.5), ("mid", -1.0, -0.6),
                       ("back", 2.0, -1.7), ("east", 3.1, -1.3), ("front", 0.2, 1.3), ("lounge", 3.95, 1.6),
                       ("game", -1.6, 1.2), ("ne", 4.1, 0.0)):
        nav(f"hall_{name}", x, z, 0.0, "hall")


# ================================================================ LIGHTS
def build_lights(lamp_pos):
    # soft overhead "ceiling" panels over the work corner and the lounge (the room has no ceiling)
    # #109: sized to the 9 x 7 room; power scaled with panel area so the light per m2 stays as it was
    light("panel_work", "AREA", 160, "#dfe6ff", (-2.7, 3.2, -1.5), aim=(-2.7, 0, -1.5), size=3.6, size_y=3.6)
    light("panel_lounge", "AREA", 120, "#ffe2c4", (2.2, 3.2, 1.3), aim=(2.2, 0, 1.3), size=4.0, size_y=3.6)
    light("panel_mid", "AREA", 55, "#ece4dc", (-0.9, 3.2, 1.2), aim=(-0.9, 0, 1.2), size=2.8, size_y=2.6)
    light("panel_wall", "AREA", 45, "#e8ecff", (2.4, 3.0, -2.55), aim=(2.4, 1.2, -HZ), size=3.6, size_y=0.8)
    # moonlight through the window, warm lamp in the lounge
    light("moon", "AREA", 25, "#7d93ff", (WINDOW_X, 1.75, -HZ - 0.55), aim=(WINDOW_X, 0.6, -HZ + 1.75), size=2.4, size_y=1.0)
    light("floor_lamp", "POINT", 18, "#ffcf8a", lamp_pos, size=0.12)
    world = bpy.data.worlds.new("night")
    scene.world = world
    try:
        world.use_nodes = True
    except Exception:
        pass
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = rgba("#0b1020")
    bg.inputs["Strength"].default_value = 0.3 * EXPOSURE


# ================================================================ main
room = build_room()
door, door_screen = build_door()
baked(room, "room")
for side in "nwse":  # #111: four walls, two atlases
    baked(build_wall(side), "walls_nw" if side in "nw" else "walls_se")
baked(door, "walls_se")  # its wall is w (extras), its atlas the roomier se one
door["wall"] = door_screen["wall"] = "w"
live(door_screen, "screen")
work = []
for i, a in enumerate(AGENTS):
    statics, lives, desk_live = build_desk(i, a)
    work += statics
    live(lives[0], "screen")
    live(lives[1], "neon")
    for o, kind in desk_live:
        live(o, kind)
for o in work:
    baked(o, "work")
for o in build_wall_items():
    baked(o, "wall_items")
for o, kind in build_window_view():
    live(o, kind)
for o in build_clock():
    live(o, "bot")
lib = build_library()
for o, kind in lib:
    live(o, kind)
print(f"library: {sum(len(p.vertices) - 2 for o, _ in lib for p in o.data.polygons)} triangles, {len(lib)} nodes")
lounge, shade, lamp_pos = build_lounge()
baked(lounge, "lounge")
for o in PLANT_NODES:  # #126: leaves are near flat colour; half the texel density saves the atlas (office-quality.md 4)
    baked(o, "lounge", density=0.5)
live(shade, "neon")
for o in OMOK_NODES:  # #135: the 1.2 mm grid lines need about 3x the lounge texels
    baked(o, "lounge", density=OMOK_DENSITY)
for o in build_props():
    live(o, "prop")
for o, kind in build_play_lives():
    live(o, kind)  # BOOK_HALVES are already live (build_book)
for i, a in enumerate(AGENTS):
    bots, neons, others = build_agent(i, a)
    for o in bots:
        live(o, "bot")
    for o in neons:
        live(o, "neon")
    for o, kind in others:
        live(o, kind)
    tris = sum(len(p.vertices) - 2 for o in bots + neons + [o for o, _ in others] if o.type == "MESH" for p in o.data.polygons)
    print(f"agent_{i}: {tris} triangles")
    if "--tris" in ARGS:
        for o in bots + neons + [o for o, _ in others]:
            if o.type == "MESH":
                print("   ", o.name, sum(len(p.vertices) - 2 for p in o.data.polygons))
build_nav()
build_surfaces()
build_hits()
build_slots()
build_lights(lamp_pos)

if "--stats" in ARGS:  # #108/#109: triangles, surface area and the texel density each atlas can give
    groups = {}
    for n in NODES:
        o = n["obj"]
        if o.type != "MESH":
            continue
        key = f"atlas:{n['atlas']}" if "atlas" in n else f"live:{n.get('live')}"
        g = groups.setdefault(key, [0, 0.0, 1.0])
        g[0] += sum(len(p.vertices) - 2 for p in o.data.polygons)
        g[1] += sum(p.area for p in o.data.polygons) * (o.matrix_world.to_scale().x ** 2)
        g[2] = n.get("density", 1.0)
    for key, (tris, area, _) in sorted(groups.items()):
        # packed islands fill about 65% of the square; density = pixels per meter at the average scale
        ppm = f", ~{SIZE * math.sqrt(0.65 / area):.0f} px/m at {SIZE}" if key.startswith("atlas") and area else ""
        print(f"stats {key}: {tris} triangles, {area:.1f} m2{ppm}")


def agent_objs(i):
    """the agent's top-level parts (grip empties ride along as children)"""
    return [o for o in bpy.data.objects if o.parent is None and (o.name == f"agent_{i}" or o.name.startswith(f"agent_{i}_"))]


def move_agent(i, x, z, ry):
    old = bpy.data.objects[f"agent_{i}"].matrix_world.copy()
    D = Mx((x, 0, z), ry=ry) @ old.inverted()
    for o in agent_objs(i):
        o.matrix_world = D @ o.matrix_world
    bpy.context.view_layer.update()


def curl(i, side, index=0.0, fingers=0.0, thumb=0.0):
    """bend fingers about their local x (+ = toward the palm), degrees"""
    for part, deg in (("index", index), ("fingers", fingers), ("thumb", thumb)):
        o = bpy.data.objects[f"agent_{i}_hand_{side}_{part}"]
        o.matrix_world = o.matrix_world @ Mx(rx=math.radians(deg))
    bpy.context.view_layer.update()


def preview_glow_materials():
    """Cycles stand-ins for what the app draws additive: the beam fades downward, the floor disc to its edge"""
    for i in range(len(AGENTS)):
        col = AGENTS[i]["color"]
        for part, size in (("beam", GLOW_Y - 0.005), ("floor", 0.26)):
            m = bpy.data.materials.new(f"preview_{part}_{i}")
            m.use_nodes = True
            nt = m.node_tree
            nt.nodes.clear()
            out = nt.nodes.new("ShaderNodeOutputMaterial")
            mix = nt.nodes.new("ShaderNodeMixShader")
            tr = nt.nodes.new("ShaderNodeBsdfTransparent")
            em = nt.nodes.new("ShaderNodeEmission")
            em.inputs["Color"].default_value = rgba(col)
            em.inputs["Strength"].default_value = (1.5 if part == "beam" else 3.0) * EXPOSURE
            tc = nt.nodes.new("ShaderNodeTexCoord")
            sep = nt.nodes.new("ShaderNodeSeparateXYZ")
            f = nt.nodes.new("ShaderNodeMath")
            g = nt.nodes.new("ShaderNodeMath")
            nt.links.new(tc.outputs["Object"], sep.inputs[0])
            if part == "beam":  # object z: 0 at the top .. -size at the floor
                f.operation = "MULTIPLY_ADD"
                f.inputs[1].default_value = 1 / size
                f.inputs[2].default_value = 1.0
                nt.links.new(sep.outputs["Z"], f.inputs[0])
                g.operation = "MULTIPLY"
                g.inputs[1].default_value = 0.05
            else:  # radial: 1 at the center .. 0 at the rim
                vl = nt.nodes.new("ShaderNodeVectorMath")
                vl.operation = "LENGTH"
                nt.links.new(tc.outputs["Object"], vl.inputs[0])
                f.operation = "MULTIPLY_ADD"
                f.inputs[1].default_value = -1 / size
                f.inputs[2].default_value = 1.0
                nt.links.new(vl.outputs["Value"], f.inputs[0])
                g.operation = "POWER"
                g.inputs[1].default_value = 1.6
            f.use_clamp = True
            nt.links.new(f.outputs[0], g.inputs[0])
            nt.links.new(g.outputs[0], mix.inputs["Fac"])
            nt.links.new(tr.outputs[0], mix.inputs[1])
            nt.links.new(em.outputs[0], mix.inputs[2])
            nt.links.new(mix.outputs[0], out.inputs["Surface"])
            o = bpy.data.objects[f"agent_{i}_{part}"]
            o.data.materials.clear()
            o.data.materials.append(m)


if PREVIEW:
    setup_cycles(160)
    scene.cycles.use_denoising = True
    scene.view_settings.view_transform = "AgX"
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.sensor_fit = "VERTICAL"
    cam.data.angle_y = math.radians(32)
    preview_glow_materials()
    for k in (3, 4):  # the app shows one post-it per open issue; three until that data is wired
        bpy.data.objects[f"agent_0_postit_{k}"].hide_render = True
    only = [a for a in ARGS if a.startswith("--shot=")]
    want = only[0].split("=")[1].split(",") if only else None
    scene.render.resolution_x, scene.render.resolution_y = 1440, 900
    scene.render.resolution_percentage = 60
    scene.render.image_settings.file_format = "PNG"

    def shoot(name, pos, target):
        if want and name not in want:
            return
        cam.location = W(*pos)
        cam.rotation_euler = (W(*target) - cam.location).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = os.path.join(OUT, f"preview_{name}.png")
        bpy.ops.render.render(write_still=True)

    def hold(i, side, prop_name, upright=False):
        """put a prop in a hand by its grip extras (preview only). upright: keep it level (a cup)"""
        g = bpy.data.objects[f"agent_{i}_hand_{side}_grip"]
        p = bpy.data.objects[prop_name]
        gr = p["grip"]
        level = Mx(rx=-GRIP_RX) if upright else Mx()
        p.matrix_world = g.matrix_world @ level @ Mx(tuple(gr["pos"]), *[float(v) for v in gr["rot"]])
        bpy.context.view_layer.update()

    # 1) the room as exported (agents at their spawn spots), shown as the app shows it from the default camera: the
    #    camera-side walls (s, e) lowered, the window view only in the shots that look through the window (the app
    #    masks it to the window opening; Cycles can't, so it is hidden elsewhere)
    for side in "se":
        bpy.data.objects[f"wall_{side}"].hide_render = True
    view = [o for o in bpy.data.objects if o.name.startswith("window_")]
    for o in view:
        o.hide_render = True

    def shoot_view(name, pos, target):
        for o in view:
            o.hide_render = o.name == "window_portal"
        shoot(name, pos, target)
        for o in view:
            o.hide_render = True

    shoot_view("window_view", (-1.0, 1.55, -1.3), (WINDOW_X, 1.75, -HZ))
    shoot_view("window_side", (1.2, 1.45, -2.4), (WINDOW_X, 1.7, -HZ))
    for name, (pos, target) in {"overview": ((8.5, 8.0, 9.5), (-0.3, 0.6, -0.3)),
                                "work": ((0.6, 2.3, 1.4), (-2.3, 0.8, -1.6)),
                                "lounge": ((-1.2, 2.2, 4.4), (1.2, 0.6, 1.0)),
                                "wall": ((1.4, 1.7, 1.2), (1.7, 1.35, -2.75)),
                                "door": ((0.4, 1.7, 2.6), (-3.4, 1.1, 1.7)),
                                "bots": ((1.4, 1.5, 3.1), (0.6, 0.75, 0.95)),
                                "props_plane": ((-1.95, 1.2, -1.45), (-2.72, 0.76, -2.2)),
                                "props_table": ((1.0, 1.35, 2.3), (1.6, 0.76, 0.95))}.items():
        shoot(name, pos, target)
    for i, a in enumerate(AGENTS):  # each desk from above the seat (#43)
        F = frame(a["at"])
        c, t = (F @ Mx((0, 1.85, 1.15))).to_translation(), (F @ Mx((0, 0.8, -0.08))).to_translation()
        shoot(f"desk_{i}", (c.x, c.z, -c.y), (t.x, t.z, -t.y))
    # 1a) one 3/4 close-up per object, agents hidden, 800 x 600 (#108: "now" column of the quality table)
    QUALITY = {
        # #126: the plants where #109 put them
        # (seen along the default camera, as the visitor does: the monstera faces it)
        "q_plant_corner": ((2.7, 1.6, 1.9), (4.22, 0.95, 3.18)),
        "q_plant_desk": ((0.95, 1.35, -1.85), (0.0, 0.75, -3.2)),
        "q_plant_sofa": ((2.05, 1.35, 3.74), (0.925, 0.6, 2.75)),
        "q_vine": ((3.25, 2.25, -1.95), (4.0, 1.95, -3.2)),
        "q_succulent": ((-3.55, 1.15, -0.9), (-4.32, 0.8, -1.36)),
        "q_sofa": ((-0.75, 1.35, 0.85), (0.35, 0.4, 2.15)),
        "q_lamp": ((2.6, 1.45, 1.15), (1.6, 1.0, 2.25)),
        "q_pingpong": ((3.45, 1.9, -0.65), (1.75, 0.65, 0.95)),
        "q_game": ((-0.25, 1.5, 0.55), (-1.35, 0.6, 1.55)),
        "q_counter": ((-1.9, 1.55, 0.55), (-3.2, 0.95, 1.32)),
        "q_shelf": ((2.0, 1.3, -0.35), (2.85, 1.0, -2.57)),
        "q_boards": ((1.55, 1.5, 0.3), (1.05, 1.45, -2.73)),
        "q_door": ((-1.35, 1.45, 1.15), (-3.4, 1.1, 2.12)),
        "q_window": ((-1.2, 1.5, -0.55), (-1.8, 1.7, -2.75)),
        "q_rug": ((0.55, 2.7, -0.45), (0.55, 0.0, 1.5)),
        "q_omok": ((-1.6, 1.3, 2.62), (-1.6, 0.77, 2.2)),  # #135
        "q_omok_side": ((-0.75, 1.15, 2.75), (-1.6, 0.76, 2.2)),
        "q_paddles": ((1.55, 1.3, 0.95), (1.75, 0.76, 0.0)),
        "q_book": ((0.55, 1.0, 3.05), (0.14, 0.57, 2.66)),
    }
    if not want or any(n in want for n in list(QUALITY) + ["q_omok_game", "q_book_open"]):
        was = {o.name: o.hide_render for o in bpy.data.objects if o.name.startswith("agent_")}
        for n in was:
            bpy.data.objects[n].hide_render = True
        res = (scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage)
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = 800, 600, 100
        for name, (pos, target) in QUALITY.items():
            shoot(name, pos, target)
        # #135, as the app will do it: stones on the board (copies of the samples at grid points), the book open
        if not want or any(n in want for n in ("q_omok_game", "q_book_open")):
            grid = bpy.data.objects["omok_grid"].matrix_world
            moves = [(7, 7), (8, 7), (8, 8), (6, 6), (9, 9), (7, 8), (6, 8), (9, 6), (5, 9), (7, 6), (10, 7)]
            copies = []
            for k, (c, r) in enumerate(moves):
                s = bpy.data.objects[f"omok_stone_{'bw'[k % 2]}"]
                o = s.copy()
                scene.collection.objects.link(o)
                o.matrix_world = grid @ Mx((c * OMOK["cell"], 0, r * OMOK["cell"]))
                copies.append(o)
            shoot("q_omok_game", (-1.6, 1.3, 2.62), (-1.6, 0.77, 2.2))
            for o in copies:
                bpy.data.objects.remove(o)
            L = bpy.data.objects["prop_book_l"]
            P = L.matrix_world.copy()
            L.matrix_world = P @ Mx(rz=math.pi)
            shoot("q_book_open", (0.55, 1.0, 3.05), (0.14, 0.57, 2.66))
            L.matrix_world = P
        scene.render.resolution_x, scene.render.resolution_y, scene.render.resolution_percentage = res
        for n, h in was.items():
            bpy.data.objects[n].hide_render = h
    # 1b) the library as the app will show it (#67): rows of 7 / 10 / 4 files, a short row's last binder leaning 8° into
    #     the gap, four SECRET (manila cover + stamp); the others without the stamp. And the IN tray = approval box.
    manila = plastic(MANILA, 0.6, 0, 0.15, "binder_manila")
    secret = {(0, 2), (1, 5), (1, 8), (2, 1)}
    for r, n in enumerate((7, 10, 4)):
        for k in range(LIB_N):
            parts = [bpy.data.objects[f"shelf_r{r}_b{k}{x}"] for x in ("", "_band", "_label", "_secret")]
            if k >= n:
                for o in parts:
                    o.hide_render = True
                continue
            if (r, k) in secret:
                parts[0].material_slots[0].material = manila
            else:
                parts[3].hide_render = True
            if k == n - 1 and n < LIB_N:
                P = parts[0].matrix_world.copy()
                R = P @ Mx(rz=math.radians(-8)) @ P.inverted()
                for o in parts:
                    o.matrix_world = R @ o.matrix_world
    bpy.context.view_layer.update()
    for hand, turn in (("clock_hand_h", (10 + 10 / 60) / 12), ("clock_hand_m", 10 / 60)):  # 10:10 as in the design (#91)
        o = bpy.data.objects[hand]
        o.matrix_world = CLOCK_M @ Mx(rz=-turn * 2 * math.pi) @ CLOCK_M.inverted() @ o.matrix_world
    bpy.context.view_layer.update()
    for name, (pos, target) in {"library": ((2.0, 1.4, -0.45), (2.78, 1.05, -2.55)),
                                "library_spines": ((2.5, 1.12, -1.75), (2.6, 1.02, -2.45)),
                                "approval": ((-1.55, 1.25, -1.65), (-2.0, 0.85, -2.45)),
                                "clock": ((-2.35, 1.8, 1.0), (-3.48, 1.85, 1.35))}.items():
        shoot(name, pos, target)
    # 2) holding props by their #20 grip offsets on the new _grip empties (preview-only poses)
    saved = {n: bpy.data.objects[n].matrix_world.copy() for n in ("prop_paddle_a", "prop_cup_1")}
    hold(0, "r", "prop_paddle_a")
    curl(0, "r", 70, 80, 40)
    shoot("hold_paddle", (1.15, 1.15, 1.9), (0.45, 0.85, 1.2))
    hold(3, "r", "prop_cup_1", upright=True)
    curl(3, "r", 60, 70, 30)
    shoot("hold_cup", (1.15, 1.05, -2.6), (0.6, 0.86, -2.1))
    for n, M in saved.items():
        bpy.data.objects[n].matrix_world = M
    curl(0, "r", -70, -80, -40)
    curl(3, "r", -60, -70, -30)
    # 3) the four in a row: front, back, at work
    XS = (-1.05, -0.35, 0.35, 1.05)
    LZ = -0.9
    for i, x in enumerate(XS):
        move_agent(i, x, LZ, math.pi)
    shoot("agents_front", (0, 1.45, 2.75), (0, 0.78, LZ))
    shoot("hands_rest", (XS[1], 1.05, -0.05), (XS[1], 0.87, LZ))
    curl(3, "r", 0, 100, 60)  # pointing
    curl(3, "l", 100, 100, 50)  # fist
    shoot("hands_pose", (XS[3], 1.05, -0.05), (XS[3], 0.87, LZ))
    curl(3, "r", 0, -100, -60)
    curl(3, "l", -100, -100, -50)
    for i, x in enumerate(XS):
        move_agent(i, x, LZ, 0.0)
    shoot("agents_back", (0, 1.45, 2.75), (0, 0.78, LZ))
    for i, a in enumerate(AGENTS):
        seat = (frame(a["at"]) @ Mx((0, 0, WORK_Z))).to_translation()
        move_agent(i, seat.x, -seat.y, a["at"][2])
    shoot("agents_work", (0.3, 1.8, 0.7), (-2.3, 0.95, -1.7))
    # 4) silhouettes: shapes only, black on white (lights, beams and the room hidden)
    for i, x in enumerate(XS):
        move_agent(i, x, LZ, math.pi)
    lights_only = ("_glow", "_beam", "_floor", "_face")
    for o in bpy.data.objects:
        if o.type != "CAMERA" and (not o.name.startswith("agent_") or o.name.endswith(lights_only)):
            o.hide_render = True
    ink = bpy.data.materials.new("ink")
    ink.use_nodes = True
    ink.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0, 0, 0, 1)
    ink.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1.0
    bpy.context.view_layer.material_override = ink
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 1.0
    scene.view_settings.view_transform = "Standard"
    shoot("sil_front", (0, 1.45, 2.75), (0, 0.78, LZ))
    for i, x in enumerate(XS):
        move_agent(i, x, LZ, 0.0)
    shoot("sil_back", (0, 1.45, 2.75), (0, 0.78, LZ))
    sys.exit(0)


# --- bake
setup_cycles(SAMPLES)
scene.render.bake.margin = 16
scene.render.bake.margin_type = "EXTEND"
scene.render.bake.use_clear = True
scene.render.bake.target = "IMAGE_TEXTURES"

# agents and props move: keep them (and their glow) out of the baked light, or their shadows would stay behind
# when they leave (props too since #43: a lifted paddle left its shadow on the table; the binders since #67: the app
# shows only as many as there are files)
for n in NODES:
    if n["obj"].name.startswith(("agent_", "shelf_r", "clock_", "window_", "prop_book_", "omok_stone_", "pp_ball")) or n.get("live") == "prop":
        n["obj"].hide_render = True

atlases = {}
for n in NODES:
    if "atlas" in n:
        atlases.setdefault(n["atlas"], []).append(n)
        if n["drop"]:
            drop_hidden_faces(n["obj"])

images = {}
for name, entries in atlases.items():
    objs = [e["obj"] for e in entries]
    unwrap(objs, {e["obj"].name: e["density"] for e in entries})
    # the texel density this atlas really gets (#108 targets: objects >= 300, floor / walls >= 200 px/m)
    area = uv_area = 0.0
    for o in objs:
        uv = o.data.uv_layers["bake"].data
        for pl in o.data.polygons:
            pts = [uv[li].uv for li in pl.loop_indices]
            uv_area += abs(sum(a.x * b.y - b.x * a.y for a, b in zip(pts, pts[1:] + pts[:1]))) / 2
            area += pl.area
    print(f"texels {name}: {SIZE * math.sqrt(uv_area / area):.0f} px/m, UV fill {uv_area * 100:.0f}%, {area:.1f} m2")
    img = bpy.data.images.new(name, SIZE, SIZE, float_buffer=True, alpha=False)
    bake_targets(objs, img)
    images[name] = img

import time  # noqa: E402

NO_BAKE = "--no-bake" in ARGS  # #109: export the glb only (layout and slot checks), no atlases
for name, entries in ({} if NO_BAKE else atlases).items():
    bpy.ops.object.select_all(action="DESELECT")
    for e in entries:
        e["obj"].select_set(True)
    bpy.context.view_layer.objects.active = entries[0]["obj"]
    t0 = time.time()
    bpy.ops.object.bake(type="COMBINED")
    print(f"baked {name} ({len(entries)} nodes) in {time.time() - t0:.1f}s")
    if DENOISE:
        try:
            denoise(images[name], os.path.join(OUT, f"{name}.webp"))
            continue
        except Exception as e:
            print("denoise failed, keeping the raw bake:", e)
    save(images[name], os.path.join(OUT, f"{name}.webp"))

# --- export: baked meshes get one plain material (the app swaps in the atlas), live nodes keep theirs
plain = bpy.data.materials.new("baked")
for n in NODES:
    if "atlas" in n:
        n["obj"].data.materials.clear()
        n["obj"].data.materials.append(plain)
# screen slots lit the bake softly (monitor light on the desks); they ship switched off: the app draws them
screen_off = plastic("#07080a", 0.18, 0, 0.0, "screen_off")
for n in NODES:
    if n["obj"].get("screen"):
        n["obj"].data.materials.clear()
        n["obj"].data.materials.append(screen_off)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "office.blend"))
bpy.ops.object.select_all(action="DESELECT")
for n in NODES:
    n["obj"].select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "office.glb"), export_format="GLB", use_selection=True,
                          export_apply=True, export_yup=True, export_texcoords=True, export_normals=True,
                          export_materials="EXPORT", export_image_format="NONE", export_extras=True)
print("atlases:", ", ".join(f"{k} ({len(v)})" for k, v in atlases.items()))
print("DONE", OUT)
