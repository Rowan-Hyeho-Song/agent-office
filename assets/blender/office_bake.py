"""Agent office, first pass (#11): a cut-away room diorama in the dark, modeled and light-baked.

Run:  blender --background --factory-startup --python office_bake.py -- <out_dir> [flags]
  (default)        bake the atlases, write office.glb + <atlas>.webp (+ office.blend)
  --preview        no bake: Cycles renders of the camera shots (preview_<shot>.png), to check modeling
  --shot=a,b       only these preview shots
  --samples N      bake samples (default 1024)   --size N  atlas size (default 2048)   --no-denoise

Same pipeline as the rowansong.dev desk (bakekit.py), so the two rooms read as one world.

Node contract (the app reads glTF extras):
  room, work, wall_items, lounge   baked, one atlas each -> MeshBasicMaterial + atlas
  agent_<i>                        live "bot" empty on the floor: the agent's frame (front = -z)
  agent_<i>_head, _hand_l|r, _hand_l|r_index|fingers|thumb, agent_0_postit_<k>
                                   live "bot": real-time lit parts with pivots (extras pivot_at); fingers bend on local x
  agent_<i>_glow|_beam|_floor, _hand_l|r_cuff, _tip, agent_1_orbit, agent_3_ear_glow, neon_desk_<i>, lamp_shade
                                   live "neon" emitters (hover light, wrist rings, state)
  agent_<i>_face                   live "face": canvas slot like the screens (extras screen, aspect, w, h)
  agent_<i>_hand_l|r_grip          empties, children of the palms: attach a held prop here (extras grip_of)
  screen_work_<i>, screen_door     live "screen" slots the app draws (extras screen, aspect, w, h, ppm); shipped off
  surface_whiteboard|bulletin      empties at the board faces where the app pins cards / notes (extras w, h, normal)
  prop_*, agent_0_pen              live "prop": paddles, ball, cups, watering can, board pieces, paper plane, pen
                                   (extras prop, home, grip; the pen's home is on its head: extras home_on)
  nav_<id>                         empties: where agents go and which way they face (navigation)
Seats 0..3 = MEMO amber, MESH lavender, HUE magenta, LOOP cyan (#26); their forms: docs/design/agents.md 2 (#28).
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bakekit import *  # noqa: E402,F401,F403

RNG = random.Random(7)

# ---------------------------------------------------------------- layout (web meters, floor top y = 0)
HX, HZ = 3.5, 2.75  # half room: x -3.5..3.5, z -2.75..2.75 (back wall at -z, left wall at -x)
WALL_H = 2.6
WT = 0.14
WORK_Z = 0.5  # where an agent hovers in front of its desk (from the desk center): hands reach the keyboard

AGENTS = [  # desk frame (x, z, ry): the agent sits on local +z and faces local -z (the monitor / the wall)
    {"color": "#ffb347", "at": (-2.45, -2.36, 0.0)},  # 0 MEMO amber
    {"color": "#8f9bff", "at": (-1.15, -2.36, 0.0)},  # 1 MESH lavender
    {"color": "#ff3ea5", "at": (-3.11, -1.15, math.pi / 2)},  # 2 HUE magenta
    {"color": "#4df3ff", "at": (-3.11, 0.15, math.pi / 2)},  # 3 LOOP cyan
]
DOOR_Z = 2.12
PINGPONG = (1.75, 0.95)
SOFA = (0.35, 2.15)
GAME_TABLE = (-1.35, 1.55)
SHELF_X = 2.85


def frame(at):
    x, z, ry = at
    return Mx((x, 0, z), ry=ry)


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
    wall = plastic("#3a3f4c", 0.85, 0, 0.25, "wall")
    wall_low = plastic("#2b2f3a", 0.8, 0, 0.3, "wall_low")
    trim = plastic("#1a1c22", 0.6, 0.2, 0.1, "trim")
    carpet = plastic("#1d2a3d", 0.98, 0, 0.9, "carpet")
    rug = plastic("#5a2f45", 0.97, 0, 0.9, "rug")
    parts = [
        box("floor", (2 * HX + WT, 0.12, 2 * HZ + WT), (-WT / 2, -0.06, -WT / 2), floor_wood, G, bev=0.01),
        # work corner carpet, lounge rug
        box("carpet", (3.3, 0.01, 3.4), (-3.5 + 1.65, 0.005, -2.75 + 1.7), carpet, G),
        rounded_slab("rug", 2.6, 0.01, 1.7, 0.25, (0.55, 0.006, 1.5), rug, G),
    ]
    # back wall with a wide window over the two back desks; left wall solid
    back = box("back_wall", (2 * HX + WT, WALL_H, WT), (-WT / 2, WALL_H / 2, -HZ - WT / 2), wall, G)
    win = box("win_cut", (2.6, 1.05, WT * 3), (-1.8, 1.72, -HZ - WT / 2), wall, G)
    back = cut(apply_all(back), apply_all(win))
    left = box("left_wall", (WT, WALL_H, 2 * HZ), (-HX - WT / 2, WALL_H / 2, 0), wall, G)
    parts += [back, left]
    # lower wall band + chair rail, baseboards, wall caps
    parts += [
        box("back_low", (2 * HX, 0.95, 0.012), (0, 0.475, -HZ + 0.006), wall_low, G),
        box("left_low", (0.012, 0.95, 2 * HZ), (-HX + 0.006, 0.475, 0), wall_low, G),
        box("rail_b", (2 * HX, 0.03, 0.03), (0, 0.96, -HZ + 0.015), trim, G),
        box("rail_l", (0.03, 0.03, 2 * HZ), (-HX + 0.015, 0.96, 0), trim, G),
        box("base_b", (2 * HX, 0.08, 0.02), (0, 0.04, -HZ + 0.01), trim, G),
        box("base_l", (0.02, 0.08, 2 * HZ), (-HX + 0.01, 0.04, 0), trim, G),
        box("cap_b", (2 * HX + WT, 0.03, WT + 0.02), (-WT / 2, WALL_H + 0.015, -HZ - WT / 2), trim, G),
        box("cap_l", (WT + 0.02, 0.03, 2 * HZ), (-HX - WT / 2, WALL_H + 0.015, 0), trim, G),
        # floor edge trim: the cut-away faces read as a model base
        box("edge_f", (2 * HX + WT, 0.12, 0.02), (-WT / 2, -0.06, HZ + 0.01), trim, G),
        box("edge_r", (0.02, 0.12, 2 * HZ + WT), (HX + 0.01, -0.06, -WT / 2), trim, G),
    ]
    # window: frame, mullions, sill, and the night city behind it (baked emission)
    wx, wy, ww, wh = -1.8, 1.72, 2.6, 1.05
    frame_m = plastic("#15171c", 0.4, 0.6, 0.05, "window_frame")
    parts += [
        box("win_top", (ww + 0.08, 0.05, 0.1), (wx, wy + wh / 2, -HZ), frame_m, G),
        box("win_bot", (ww + 0.12, 0.05, 0.16), (wx, wy - wh / 2, -HZ + 0.03), frame_m, G),
        box("win_l", (0.05, wh, 0.1), (wx - ww / 2, wy, -HZ), frame_m, G),
        box("win_r", (0.05, wh, 0.1), (wx + ww / 2, wy, -HZ), frame_m, G),
    ]
    for k in (1, 2, 3):
        parts.append(box("mullion", (0.03, wh, 0.05), (wx - ww / 2 + k * ww / 4, wy, -HZ), frame_m, G))
    parts.append(box("transom", (ww, 0.03, 0.05), (wx, wy + 0.18, -HZ), frame_m, G))
    sky = emitter("#16213d", 0.6, "night_sky")
    parts.append(box("sky", (ww + 0.4, wh + 0.4, 0.02), (wx, wy, -HZ - WT - 0.35), sky, G))
    city = plastic("#07080c", 0.9, 0, 0.1, "city")
    lit = emitter("#ffcf8a", 2.2, "city_window")
    lit2 = emitter("#8fd8ff", 1.8, "city_window_cool")
    x = wx - ww / 2 - 0.15
    while x < wx + ww / 2 + 0.15:
        w = RNG.uniform(0.18, 0.42)
        h = RNG.uniform(0.25, 0.85)
        parts.append(box("tower", (w, h, 0.05), (x + w / 2, wy - wh / 2 - 0.05 + h / 2, -HZ - WT - 0.3), city, G))
        for _ in range(RNG.randint(2, 6)):
            parts.append(box("lit", (0.025, 0.035, 0.01), (x + RNG.uniform(0.04, w - 0.04), wy - wh / 2 + RNG.uniform(0.0, h - 0.1),
                                                             -HZ - WT - 0.27), RNG.choice((lit, lit, lit2)), G))
        x += w + RNG.uniform(0.02, 0.08)
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
    # monitor on an arm, keyboard, mouse, mug, a few things per desk
    p += [box("mon_base", (0.2, 0.015, 0.16), (0, h + 0.0075, -0.18), dark, G, bev=0.004),
          box("mon_neck", (0.04, 0.22, 0.03), (0, h + 0.12, -0.21), dark, G),
          rounded_slab("mon_body", 0.62, 0.04, 0.38, 0.015, (0, 0, 0), dark, G, edge=0.004),
          rounded_slab("kb", 0.42, 0.018, 0.13, 0.01, (0, h + 0.009, 0.06), plastic("#2c3038", 0.6, 0, 0.1, "kb"), G, edge=0.003),
          rounded_slab("mouse", 0.06, 0.02, 0.1, 0.025, (0.3, h + 0.01, 0.07), plastic("#2c3038", 0.4, 0, 0.1, "kb"), G),
          cyl("mug", 0.04, 0.09, (-0.42, h + 0.045, -0.05), plastic(["#e9e2d6", "#d64545", "#3a6ea5", "#f2c14e"][i], 0.4, 0, 0.1, f"mug_{i}"), G, 20)]
    p[-4].rotation_euler = (math.pi / 2, 0, 0)  # monitor body stands up
    p[-4].location = W(0, h + 0.36, -0.2)
    if i % 2 == 0:
        p.append(cyl("pot", 0.06, 0.1, (0.45, h + 0.05, -0.2), plastic("#b5654a", 0.8, 0, 0.3, "terracotta"), G, 16, r2=0.05))
        for k in range(5):
            leaf = sphere("leaf", 0.05, (0.45 + RNG.uniform(-0.03, 0.03), h + 0.14 + k * 0.012, -0.2 + RNG.uniform(-0.03, 0.03)),
                          plastic("#3f7d4a", 0.6, 0, 0.3, "leaf"), G, scale=(0.5, 1.4, 0.35), seg=10, rings=6)
            leaf.rotation_euler = (RNG.uniform(-0.5, 0.5), RNG.uniform(-0.5, 0.5), k * 1.3)
            p.append(leaf)
    else:
        for k in range(3):
            p.append(box("paper", (0.21, 0.004, 0.29), (-0.25 + k * 0.01, h + 0.002 + k * 0.004, -0.12), plastic("#efece4", 0.9, 0, 0.1, "paper"), G, rot_y=0.15 * k))
    desk = join(f"desk_{i}", place(p, F))
    # no chair: agents hover at their desk. A floor pad in the agent's color marks the spot instead.
    pad = rounded_slab("pad", 0.62, 0.006, 0.5, 0.12, (0, 0.003, 0), plastic(agent["color"], 0.9, 0, 0.6, f"pad_{i}"), G)
    pad = join(f"pad_{i}", place([pad], F @ Mx((0, 0, WORK_Z))))
    # live parts: the screen slot and a neon strip under the desk's front edge
    scr = quad(f"screen_work_{i}", 0.57, 0.33, screen_mat(f"screen_glow_{i}", agent["color"], 0.45), "export")
    screen = slot(apply_all(place(scr, F @ Mx((0, h + 0.36, -0.178)))[0]), 0.57, 0.33)
    strip = box(f"neon_desk_{i}", (w - 0.04, 0.006, 0.006), (0, 0, 0), emitter(agent["color"], 3.0, f"neon_desk_{i}"), "export")
    neon = apply_all(place(strip, F @ Mx((0, h - 0.04, d / 2 - 0.004)))[0])
    return [desk, pad], [screen, neon]


# ================================================================ WALL ITEMS (atlas: wall_items)
def build_wall_items():
    G = "wall"
    z = -HZ + 0.02
    frame_m = plastic("#c8ccd4", 0.35, 0.7, 0.05, "alu")
    board = plastic("#f4f4f0", 0.25, 0, 0.05, "whiteboard")
    cork = plastic("#a87b4f", 0.95, 0, 0.8, "cork")
    p = [box("wb_frame", (1.56, 1.06, 0.03), (0.35, 1.5, z), frame_m, G, bev=0.006),
         box("wb", (1.5, 1.0, 0.02), (0.35, 1.5, z + 0.01), board, G),
         box("wb_tray", (1.3, 0.025, 0.06), (0.35, 0.985, z + 0.03), frame_m, G)]
    # the cards and the visitor notes are the app's (surface_whiteboard / surface_bulletin): the boards stay empty
    for k, col in enumerate(("#1f6feb", "#d64545", "#111111")):
        p.append(cyl("marker", 0.008, 0.12, (0.0 + k * 0.05, 1.0, z + 0.04), plastic(col, 0.4, 0, 0, f"marker_{k}"), G, 10, axis="x"))
    # bulletin board for visitor notes
    p += [box("cork_frame", (0.86, 0.96, 0.03), (1.75, 1.45, z), plastic("#5a3d26", 0.6, 0, 0.3, "cork_frame"), G, bev=0.006),
          box("cork", (0.8, 0.9, 0.02), (1.75, 1.45, z + 0.01), cork, G)]
    # bookshelf (the library): 5 shelves of books and binders
    sw, sh, sd = 1.1, 2.1, 0.34
    shelf_m = plastic("#6b4a30", 0.6, 0, 0.4, "shelf_wood")
    sx = SHELF_X
    sz = -HZ + sd / 2 + 0.01
    p += [box("shelf_l", (0.03, sh, sd), (sx - sw / 2, sh / 2, sz), shelf_m, G),
          box("shelf_r", (0.03, sh, sd), (sx + sw / 2, sh / 2, sz), shelf_m, G),
          box("shelf_back", (sw, sh, 0.01), (sx, sh / 2, -HZ + 0.015), shelf_m, G),
          box("shelf_top", (sw + 0.03, 0.03, sd), (sx, sh, sz), shelf_m, G)]
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
            lean = 0.0
            p.append(box("book", (bw, bh, RNG.uniform(0.2, 0.28)), (x + bw / 2, y0 + 0.0125 + bh / 2, sz + 0.02),
                         plastic(RNG.choice(book_cols), 0.7, 0, 0.2, "book"), G))
            x += bw + 0.003 + lean
    # a framed poster and a clock on the left wall above the coffee counter
    lx = -HX + 0.02
    p += [box("clock", (0.02, 0.32, 0.32), (lx, 1.85, 1.35), plastic("#f4f4f0", 0.4, 0, 0, "clock_face"), G),
          box("hand_h", (0.012, 0.09, 0.012), (lx + 0.015, 1.88, 1.35), plastic("#111111", 0.5, 0, 0, "hand"), G),
          box("hand_m", (0.012, 0.012, 0.12), (lx + 0.015, 1.85, 1.39), plastic("#111111", 0.5, 0, 0, "hand"), G)]
    return join("wall_items", p)


# ================================================================ LOUNGE (atlas: lounge)
def build_lounge():
    G = "lounge"
    metal = plastic("#2a2c31", 0.35, 0.8, 0.03, "metal")
    p = []
    # ping-pong table
    tx, tz = PINGPONG
    tw, td, th = 2.0, 1.1, 0.76
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
    # the paddles and the ball are props now (build_props): agents pick them up
    # sofa facing the back wall
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
    # board game table with two stools and a board
    gx, gz = GAME_TABLE
    p += [cyl("gt_top", 0.42, 0.04, (gx, 0.72, gz), plastic("#c9b89a", 0.55, 0, 0.35, "desk_top"), G, 40, bev=0.006),
          cyl("gt_col", 0.04, 0.68, (gx, 0.36, gz), metal, G, 14),
          cyl("gt_foot", 0.22, 0.03, (gx, 0.015, gz), metal, G, 32)]
    board = box("board", (0.36, 0.015, 0.36), (gx, 0.7475, gz), plastic("#e9dcc0", 0.6, 0, 0.2, "board_light"), G)
    p.append(board)
    for r in range(8):
        for c in range(8):
            if (r + c) % 2:
                p.append(box("sq", (0.044, 0.002, 0.044), (gx - 0.154 + c * 0.044, 0.7555, gz - 0.154 + r * 0.044), plastic("#5a3d26", 0.6, 0, 0.2, "board_dark"), G))
    for k in range(10):
        r, c = RNG.randint(0, 7), RNG.randint(0, 7)  # drawn for every piece so the RNG stream (plants below) is unchanged
        at = (gx - 0.154 + c * 0.044, 0.762, gz - 0.154 + r * 0.044)
        if k < 2:  # the first black and white piece move: props (build_props)
            PIECE_HOME.append(at)
            continue
        col = "#f4f4f0" if k % 2 else "#1b1d22"
        p.append(cyl("piece", 0.016, 0.012, at, plastic(col, 0.3, 0, 0, f"piece_{k % 2}"), G, 16))
    for dx in (-0.6, 0.6):
        p += [cyl("stool", 0.18, 0.05, (gx + dx, 0.5, gz), plastic("#d64545", 0.6, 0, 0.3, "stool"), G, 24, bev=0.01),
              cyl("stool_col", 0.025, 0.48, (gx + dx, 0.24, gz), metal, G, 10),
              cyl("stool_foot", 0.15, 0.02, (gx + dx, 0.01, gz), metal, G, 24)]
    # coffee counter against the left wall, between the desks and the door
    cx, cz = -HX + 0.3, 1.32
    p += [box("counter", (0.6, 0.9, 0.7), (cx, 0.45, cz), plastic("#2b2f3a", 0.6, 0, 0.2, "counter"), G, bev=0.01),
          box("counter_top", (0.64, 0.04, 0.74), (cx, 0.92, cz), plastic("#e8e4dc", 0.3, 0, 0.3, "counter_top"), G, bev=0.006),
          box("machine", (0.28, 0.36, 0.3), (cx, 1.12, cz - 0.12), plastic("#1b1d22", 0.35, 0.6, 0.05, "machine"), G, bev=0.02),
          box("spout", (0.06, 0.05, 0.08), (cx + 0.12, 1.02, cz - 0.12), plastic("#c8ccd4", 0.3, 0.9, 0, "chrome"), G)]
    # the cup under the spout and one beside it are props (build_props); the stack stays baked
    for k in range(3):
        p.append(cyl("cup", 0.035, 0.08, (cx + 0.05 - k * 0.0, 0.98 + k * 0.08, cz + 0.2), plastic("#f4f4f0", 0.4, 0, 0, "cup"), G, 16, r2=0.03))
    # plants
    for (px, pz, s) in ((-0.35, -2.45, 1.0), (3.15, 2.35, 1.2), (-0.55, 2.45, 0.85), (2.25, -2.4, 0.7)):
        p.append(cyl("planter", 0.18 * s, 0.4 * s, (px, 0.2 * s, pz), plastic("#e8e4dc", 0.6, 0, 0.2, "planter"), G, 24, r2=0.15 * s))
        for k in range(9):
            leaf = sphere("leaf", 0.2 * s, (px + RNG.uniform(-0.08, 0.08) * s, (0.55 + RNG.uniform(0, 0.5)) * s, pz + RNG.uniform(-0.08, 0.08) * s),
                          plastic(RNG.choice(("#3f7d4a", "#2f6b3f", "#5a9a5a")), 0.6, 0, 0.3, "leaf"), G, scale=(0.35, 1.0, 0.18), seg=10, rings=6)
            leaf.rotation_euler = (RNG.uniform(-0.6, 0.6), RNG.uniform(-0.6, 0.6), k * 0.7)
            p.append(leaf)
    # floor lamp by the sofa (its shade glows live)
    lx, lz = SOFA[0] + 1.25, SOFA[1] + 0.1
    p += [cyl("lamp_base", 0.14, 0.03, (lx, 0.015, lz), metal, G, 24),
          cyl("lamp_pole", 0.015, 1.5, (lx, 0.78, lz), metal, G, 10)]
    lounge = join("lounge", p)
    shade = cyl("lamp_shade", 0.2, 0.26, (lx, 1.62, lz), emitter("#ffcf8a", 2.0, "lamp_shade"), "export", 32, r2=0.13)
    return lounge, apply_all(shade), (lx, 1.55, lz)


# ================================================================ PROPS (live, real-time lit)
# Things agents pick up while playing. Each is built around its pivot (where a hand holds it: paddle handle end,
# cup and watering-can handle; ball and pieces at their center), exported at its home spot with extras:
#   prop = kind,  home = {pos, rot} (web, Euler XYZ),  grip = {pos, rot} (offset from agent_i_hand_l|r)
# They stay in the bake at home (contact shadows read as "put down here"); lifted, the faint shadow stays.
PIECE_HOME = []  # filled by build_lounge: the two board pieces that became props


def prop(name, kind, objs, home_pos, home_rot=(0.0, 0.0, 0.0), grip_pos=(0.0, 0.0, 0.0), grip_rot=(0.0, 0.0, 0.0)):
    H = Mx(home_pos, *home_rot)
    o = pivot(join(name, place(objs, H)), H)
    o["prop"] = kind
    o["home"] = {"pos": [round(v, 4) for v in home_pos], "rot": [round(v, 4) for v in home_rot]}
    o["grip"] = {"pos": [round(v, 4) for v in grip_pos], "rot": [round(v, 4) for v in grip_rot]}
    return o


def build_props():
    G = "prop"
    out = []
    tx, tz = PINGPONG
    th = 0.76
    wood_h = plastic("#c9a36b", 0.6, 0, 0.3, "handle")
    # paddles: handle end at the origin, handle along local +y, blade (rubber facing local +z) beyond it.
    # Home: flat on the table (blade up), handle toward the player at that end. Grip: handle in the fist, blade
    # carried on along the arm (local +y -> hand -y).
    for k, (end, bx, bz, rz, col) in enumerate((("a", tx - 0.6, tz + 0.25, -math.pi / 2, "#c0392b"),
                                                 ("b", tx + 0.62, tz - 0.25, math.pi / 2, "#2c3e50"))):
        objs = [box("grip", (0.03, 0.1, 0.014), (0, 0.05, 0), wood_h, G, bev=0.004, seg=2),
                cyl("blade", 0.085, 0.012, (0, 0.18, 0), plastic(col, 0.6, 0, 0.3, f"paddle_{k}"), G, 28, axis="z")]
        hx = bx + (-0.18 if end == "a" else 0.18)  # handle end sits 0.18 m behind the blade center
        out.append(prop(f"prop_paddle_{end}", "paddle", objs, (hx, th + 0.007, bz), (-math.pi / 2, 0.0, rz),
                        grip_pos=(0, -0.02, 0), grip_rot=(math.pi, 0, 0)))
    out.append(prop("prop_ball", "ball", [sphere("ball", 0.02, (0, 0, 0), plastic("#ffffff", 0.3, 0, 0, "ball"), G, seg=14, rings=10)],
                    (tx + 0.25, th + 0.02, tz - 0.1), grip_pos=(0, -0.05, 0)))
    # cups: origin at the handle (on local +x), body hanging beside it. Home on the counter, handle toward the room
    cx, cz = -HX + 0.3, 1.32
    for k, (bx, bz) in enumerate(((cx + 0.14, cz - 0.12), (cx + 0.19, cz + 0.07))):
        # 1.25x the baked mugs so a cup still reads in a robot hand
        objs = [cyl("cup", 0.045, 0.105, (-0.072, 0, 0), plastic("#f4f4f0", 0.4, 0, 0, "cup"), G, 20),
                torus("cup_handle", 0.027, 0.0075, (-0.027, 0.0, 0), plastic("#f4f4f0", 0.4, 0, 0, "cup"), G, axis="z", half=True, seg=16, rseg=6)]
        out.append(prop(f"prop_cup_{k}", "cup", objs, (bx + 0.072, 0.94 + 0.0525, bz)))
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
    out.append(prop("prop_watering_can", "watering_can", objs, (2.8, 0.2, 2.45), (0.0, 0.6, 0.0)))
    # board pieces: center pivot, a little larger than the baked ones so they read in a hand
    for end, (at, col) in zip("ab", zip(PIECE_HOME, ("#1b1d22", "#f4f4f0"))):
        out.append(prop(f"prop_piece_{end}", "piece", [cyl("piece", 0.019, 0.014, (0, 0, 0), plastic(col, 0.3, 0, 0, f"piece_{end}"), G, 18)],
                        (at[0], 0.763, at[2]), grip_pos=(0, -0.04, 0)))
    # paper plane (#27, a short hand-off from MEMO): folded from a post-it, nose = local -z, resting on its keel
    # on MEMO's desk (seat 0). Grip: pinched under the wings, nose along the fingers.
    bm = bmesh.new()
    N, L, R, T, K = [bm.verts.new(W(*p)) for p in ((0, 0, -0.085), (-0.06, 0.012, 0.075), (0.06, 0.012, 0.075),
                                                    (0, 0.004, 0.075), (0, -0.022, 0.075))]
    for f in ((N, T, L), (N, R, T), (N, K, T)):
        bm.faces.new(f)
    plane = mesh_obj("plane", bm, plastic(POSTIT[0], 0.85, 0, 0.2, "postit_0"), G)
    home = frame(AGENTS[0]["at"]) @ Mx((-0.25, 0.74 + 0.022, 0.15))
    t = home.to_translation()
    out.append(prop("prop_plane", "plane", [plane], (t.x, t.z, -t.y), (0.0, 0.5, 0.0),
                    grip_pos=(0, -0.06, 0), grip_rot=(-math.pi / 2, 0, 0)))
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
    door = join("door", place(p, M))
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
    (0.42, 0.95, -math.pi / 2),
    (3.08, 0.95, math.pi / 2),
    (-2.6, 1.32, math.pi / 2),
    (0.35, -2.05, 0.0),
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
        Rc = Hd @ Mx((0, hh / 2 + 0.2, 0))
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
    surface("whiteboard", (0.35, 1.5, z), 1.5, 1.0)
    surface("bulletin", (1.75, 1.45, z), 0.8, 0.9)


def facing(fx, fz, tx, tz):
    """ry that turns local -z from (fx, fz) toward (tx, tz)"""
    return math.atan2(-(tx - fx), -(tz - fz))


# where a visiting agent stands to talk to the one at desk i: (x, z, ry facing the worker). Measured in the
# app's nav check (#17: rays along every edge and round each spot, 0.2–1.0 m high, ±0.22 m body width) —
# the first guesses (0.85 m beside each desk) sat inside the neighbouring desk's corner.
DESK_SIDE = [(-1.90, -1.72, 1.32), (-0.60, -1.72, 1.32), (-2.10, -0.80, 0.969), (-2.00, -0.20, 2.092)]


def build_nav():
    for i, a in enumerate(AGENTS):
        F = frame(a["at"])
        seat = (F @ Mx((0, 0, WORK_Z))).to_translation()
        nav(f"work_{i}", seat.x, -seat.y, a["at"][2], "work")
        nav(f"desk_side_{i}", *DESK_SIDE[i], "stand")
    nav("whiteboard", 0.35, -2.05, 0.0, "stand")
    nav("bulletin", 1.75, -2.05, 0.0, "stand")
    nav("shelf", SHELF_X, -2.05, 0.0, "stand")
    nav("coffee", -2.6, 1.32, math.pi / 2, "stand")
    nav("pingpong_a", PINGPONG[0] - 1.33, PINGPONG[1], -math.pi / 2, "play")
    nav("pingpong_b", PINGPONG[0] + 1.33, PINGPONG[1], math.pi / 2, "play")
    for k in range(3):
        nav(f"sofa_{k}", SOFA[0] - 0.53 + k * 0.53, SOFA[1] - 0.05, 0.0, "sofa")
    nav("game_a", GAME_TABLE[0] - 0.6, GAME_TABLE[1], -math.pi / 2, "stool")
    nav("game_b", GAME_TABLE[0] + 0.6, GAME_TABLE[1], math.pi / 2, "stool")
    nav("door", -2.95, DOOR_Z, math.pi / 2, "door")
    # face-to-face talk spots (0.8 m apart): in the open floor, and by the whiteboard
    nav("meet_a", -0.75, -0.55, -math.pi / 2, "meet")
    nav("meet_b", 0.05, -0.55, math.pi / 2, "meet")
    nav("meet_c", 0.0, -1.55, -math.pi / 4, "meet")
    nav("meet_d", 0.62, -1.55, math.pi / 4, "meet")
    # hall nodes: the aisles between the furniture. hall_game (under the board-game table) and hall_ne (behind the
    # ping-pong table) came from the app's nav check (#17): west→front grazed the game table by 2 cm and
    # east→pingpong_b crossed the table top's corner; hall_lounge moved off the corner plant's leaves.
    for name, x, z in (("door", -2.5, 2.25), ("west", -2.3, 0.75), ("work", -1.8, -1.35), ("mid", -0.35, -0.55),
                       ("east", 2.0, -0.6), ("front", 0.1, 1.2), ("lounge", 2.95, 1.85), ("game", -1.35, 0.7),
                       ("ne", 3.1, 0.0)):
        nav(f"hall_{name}", x, z, 0.0, "hall")


# ================================================================ LIGHTS
def build_lights(lamp_pos):
    # soft overhead "ceiling" panels over the work corner and the lounge (the room has no ceiling)
    light("panel_work", "AREA", 70, "#dfe6ff", (-2.0, 3.2, -1.3), aim=(-2.0, 0, -1.3), size=2.6, size_y=2.2)
    light("panel_lounge", "AREA", 55, "#ffe2c4", (1.2, 3.2, 1.2), aim=(1.2, 0, 1.2), size=3.0, size_y=2.2)
    light("panel_wall", "AREA", 30, "#e8ecff", (1.6, 3.0, -1.8), aim=(1.6, 1.2, -2.75), size=2.4, size_y=0.8)
    # moonlight through the window, warm lamp in the lounge
    light("moon", "AREA", 25, "#7d93ff", (-1.8, 1.75, -3.3), aim=(-1.8, 0.6, -1.0), size=2.4, size_y=1.0)
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
baked(room, "room", density=0.9)
baked(door, "room")
live(door_screen, "screen")
work = []
for i, a in enumerate(AGENTS):
    statics, lives = build_desk(i, a)
    work += statics
    live(lives[0], "screen")
    live(lives[1], "neon")
for o in work:
    baked(o, "work")
baked(build_wall_items(), "wall_items")
lounge, shade, lamp_pos = build_lounge()
baked(lounge, "lounge")
live(shade, "neon")
for o in build_props():
    live(o, "prop")
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
build_lights(lamp_pos)


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

    # 1) the room as exported (agents at their spawn spots)
    for name, (pos, target) in {"overview": ((6.6, 6.2, 7.4), (-0.25, 0.7, -0.2)),
                                "work": ((0.6, 2.3, 1.4), (-2.3, 0.8, -1.6)),
                                "lounge": ((-1.2, 2.2, 4.4), (1.2, 0.6, 1.0)),
                                "wall": ((1.4, 1.7, 1.2), (1.7, 1.35, -2.75)),
                                "door": ((0.4, 1.7, 2.6), (-3.4, 1.1, 1.7)),
                                "bots": ((1.4, 1.5, 3.1), (0.6, 0.75, 0.95)),
                                "props_plane": ((-1.95, 1.2, -1.45), (-2.72, 0.76, -2.2)),
                                "props_table": ((1.0, 1.35, 2.3), (1.6, 0.76, 0.95))}.items():
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

# agents move: keep them (and their glow) out of the baked light, or their shadows would stay behind
for n in NODES:
    if n["obj"].name.startswith("agent_"):
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
    img = bpy.data.images.new(name, SIZE, SIZE, float_buffer=True, alpha=False)
    bake_targets(objs, img)
    images[name] = img

import time  # noqa: E402

for name, entries in atlases.items():
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
