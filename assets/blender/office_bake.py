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
  atlases room, walls_nw, walls_se, work, wall_items, lounge, desk_props (7 webp) -> MeshBasicMaterial + atlas. Baked:
  room                             the three rugs (#195: work, meeting, lounge), base edges; extras room =
                                   [HX, HZ, WALL_H] (#109: the app reads the room size here; #280: [4.8, 4.1, 2.6])
  floor                            (#280) the wood floor, alone in the floor atlas
  sofa_l, table_low, shelf_records, coffee_bar, plant_hang_0|1, frame_0..2, shelf_wall, entry (#280 3: no beanbag)
                                   (#280 PR 2, lounge-props.md; atlas lounge2) baked. Live: turntable_platter (extras
                                   spin {axis, rps}), turntable_arm (pivot = its post; arm {axis, rest_deg, play_deg,
                                   sign}), turntable_cover (glass), fridge_door (pivot = the south hinge; open {axis,
                                   sign, deg, open_s, close_s}), shelf_wall_trophy_band (the app paints it), frame_<k>_art
                                   (screen slots for the posters; 0 = this site, 1 = agent office, 2 = desk room),
                                   hit_frame_<k>; props prop_pillow_0|1 (two-hand grips), prop_record (hidden at rest).
                                   Empties table_low_slot_0..3 (extras for), fridge_door_grip, water_tap_0|1,
                                   soil_plant_hang_0|1; nav_sofa_0..3 (#280 3 corner sofa: 0 / 1 the south row, 2 the corner
                                   facing north-west (last), 3 the east seat facing west, lie, head [x, z] = the north
                                   arm); no nav_beanbag (#280 3: the beanbag is gone)
                                   nav_sofa_in_w|e (seats, on the knee row's line just outside each end) and
                                   zone_sofa_row (#341: the knee row between the low table and the long side, extras
                                   zone, ry, size_x along it, size_z across; the planner side-steps only inside it)
  desk_<i>                        (work) the desk body (#187 kit: oak top, graphite band, legs, cable tray); i 0..4,
                                   the five desks stand as one island (#195 plan 2, slot_pod)
  desk_<i>_props                   (desk_props, #187) the common kit (keyboard case, monitor, mouse body + pad, cables)
                                   and the owner's things (seat_*), extras desk
  kb_<i>_caps                      (desk_props, #225) the 87 keycaps as one mesh, frame = the keyboard plate (pivot_at);
                                   point attribute _KEY (three: _key) = key 0..86; extras keys [{code, pivot, top, size,
                                   w}] in that frame, key_travel_m (press = local -y)
  desk_<i>_mouse_l|_r|_wheel       live "bot" (#225): the mouse's button shells (pivot on the hinge, press = local x
                                   -2 deg) and wheel (pivot on its axle, rolls about local x); no desk_2 mouse (tablet)
  desk_<i>_mouse, _mouse_shadow    live "bot" (#305): the body (pivot = its underside's middle on the pad; extras pad
                                   {center, half} = the pad top in the body's rest frame x, z; size [w, h, l]) and a
                                   contact-shadow card riding with it (extras shadow_of); the app hangs the buttons,
                                   wheel, contacts and the shadow under the body. Left out of the bake
  prop_tablet_pen extras tip, desk_2_tablet extras area {w, d, top}
                                   (#305) the nib's end in the pen's frame; the tablet's active area in its node frame
  desk_4_spk_l|_r, desk_4_knob_<k>, desk_4_fader_<k>
                                   live "bot" (#193 ECHO): woofer cones (extras travel, axis z), gain knobs (axis y),
                                   faders (extras travel 0.045, axis -z, zero); desk_4_spk_led, desk_4_meter_0..7 neon
  prop_duck, prop_keycap_0, prop_headphones
                                   live "prop" (#187 desk-props.md 5)
  <book>_page                      live "bot" (#231): a page to turn per book (prop_book, prop_shelfbook_<k>): two
                                   sheets back to back, 16 x 4, attributes _PAGE_U (spine 0 -> fore-edge 1), _PAGE_V
                                   (bottom 0 -> top 1); pivot = the spine axis; extras page_w, page_h, turn_axis, turn_dir
  <book>_l|r_grip, _l|r_contact_thumb|index|middle|ring|little
                                   empties (#231 1, grips.md 2): the open book in both hands, children of each half
                                   (grip_for l|r, pose open_book): palm on the cover behind the lower third, fingers
                                   flat on it toward the spine, the thumb on the paper 25 mm in from the cover's edge (#381)
  nav_meet_center                  (#195) the one meeting circle: extras ry (0 deg = toward the board), ring 0.9, r 1.16
  nav_chat_0|_1                    (#195) the second conversation's two spots by the window, facing each other
  <plant>_tip_0..2                 empties (#185 watering.md): leaf tips where a drop forms, extras tip_of
  agent_4_fork, agent_4_ring       (#193 ECHO) live "bot" tuning fork U (pivot = the stem's top; tines shake about
                                   local x), live "neon" light ring round the back grille
  wall_n|e|s|w                     the four walls (#111), pivot_at at the wall's foot (floor, middle of the wall),
                                   extras wall; the app lowers the camera-side ones. n carries the window frame
  door, boards, wallclock          hung on a wall: extras wall (w, n, w). shelf, lounge, desk_<i>, pad_<i>: on the floor
  window_sky|skyline|mid|near, window_lights, window_lights_far, window_portal
                                   the city behind the window (#111): live "sky" (UV 0..1, the app paints it by the
                                   hour), "backdrop", "city_lights" (the app sets day / night strength), at 40 / 25 /
                                   12 / 6 m; "portal" = the window opening, the stencil the cards are masked to.
                                   All extras wall = n
  slot_<name>                      empties: each object's footprint (#109, extras slot, size, wall|against; core =
                                   the body alone when the slot also holds its use room, #147: the walk grid)
  agent_<i>                        live "bot" empty on the floor: the agent's frame (front = -z)
  agent_<i>_head, _hand_l|r, _hand_l|r_f{1..4}_{1,2,3}, _hand_l|r_t_{0,1,2}, agent_0_postit_<k>
                                   live "bot": real-time lit parts with pivots (extras pivot_at); fingers bend on local x;
                                   #282: extras joint {flex|abduct|twist: {axis, sign}}, _f{n}_1 rest_abduct, hand wrist
  agent_<i>_glow|_beam|_floor, _hand_l|r_cuff, _tip, agent_1_orbit, agent_3_ear_glow, neon_desk_<i>, lamp_shade
                                   live "neon" emitters (hover light, wrist rings, state)
  agent_<i>_face                   live "face": canvas slot like the screens (extras screen, aspect, w, h)
  agent_<i>_hand_l|r_grip          empties, children of the palms: attach a held prop here (extras grip_of)
  screen_work_<i>, screen_door     live "screen" slots the app draws (extras screen, aspect, w, h, ppm); shipped off
  surface_whiteboard|bulletin      empties at the board faces where the app pins cards / notes (extras w, h, normal)
  prop_*, agent_0_pen              live "prop": paddles, cups, watering can, omok stones in hand (prop_piece_a black,
                                   _b white), book (its spine), paper plane, pen, A4 sheet (prop_paper, #262: a 2 mm core; extras size)
                                   (extras prop, home, grip; the pen's home is on its head: extras home_on)
  prop_paper_a|b                  live "bot" (#262): the sheet's near | far halves, pivot on the fold line (local x through
                                   the middle); extras fold {axis, sign} folds it up over the other, writing inside.
                                   prop_paper children: _grip_r (near edge) | _grip_r_far, _contact_thumb|index_near|far, _contact_palm
  prop_book_l|r                   live "bot" (#135): the book's halves, pivot on the spine axis (local z); the app
                                   attaches them to prop_book; _l opens by +180° about local z (lies flat at -x)
  prop_shelfbook_<k>, _l|_r        (#199) k 0..4: books to take from the library shelves, built as prop_book (spine =
                                   local z, pages +x, front cover +y); standing at the right end of shelves 1 . 2 . 3
                                   (2 . 2 . 1). extras size [w, h, t], spine "z", cover, shelf_row (the real shelf, 0 =
                                   bottom; not the binders' r), shelf_slot; children _grip_r, _contact_index|thumb|palm
  prop_watering_can_spout          empty, child of the can: the spout's end, local +z = the water's way out
  omok_board                       the 15 x 15 board and its two stone bowls (lounge atlas, 3x texels: the lines are baked)
  omok_grid                        empty at the (0, 0) intersection on the board top, +x = columns, +z = rows
                                   (extras n, cell, stone_h)
  omok_stone_b|w                   live "bot" samples (the app hides them and instances the stones on the board);
                                   pivot = the stone's bottom center
  omok_bowl_b|w                    empties: the grab point in each stone bowl (extras bowl); black by nav_game_a
  pp_ball                          live "bot" (#135): the ball, the app moves it (not a prop); pivot = its center
  pp_table                         empty at the table top center, +x = the long side (extras size [l, w], net_h)
  door_lever                       live "bot" (#280 3): the door's lever, pivot on its axle (local z = out of the
                                   door); extras press {axis z, sign -1, deg 30, press_s, release_s}; child empty
                                   door_lever_grip (grip_for l, pose wrap)
  hit_turntable                    (#353) empty: the turntable's click box (extras hit, size [0.46, 0.16, 0.36]), axes = the room's
  prop_paper_grip_side_l|r         empties (#280, paper-pass.md 5): children of prop_paper_a, the long edges 1.5 cm in, 45%
                                   up from the near edge (grip_for l|r, pose side_read); _contact_thumb (writing face) |
                                   _contact_index (back), also children of prop_paper_a
  hit_whiteboard                   (#234) empty: the whiteboard's click box on its face (extras hit, size [1.6, 1.1, 0.1], wall n)
  pp_net                           live "bot" (#280 3): the net's navy 1 cm lattice (static; the posts, clamps and white
                                   band are in the lounge atlas)
  nav_<id>                         empties: where agents go and which way they face (navigation); nav_meet_center_*
                                   (#147): meeting ring centers, extras r = floor kept free around it
  soil_<plant>                     empties (#184): the soil top's centre of each world-built pot (plant_corner|desk|sofa,
                                   vine), extras soil_of, r = the soil disc's radius: where watering lands
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
Seats 0..4 = MEMO amber, MESH lavender, HUE magenta, LOOP cyan (#26), ECHO phosphor (#193); their forms:
docs/design/agents.md 2 (#28).
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bakekit import *  # noqa: E402,F401,F403
import desk_kit as KIT  # noqa: E402  (#187: the common desk kit, docs/design/desk-props.md 2)
from mathutils import Color  # noqa: E402

RNG = random.Random(7)
DRNG = random.Random(43)  # desk props (#43): their own sequence, so the rest of the room keeps its randomness

# ---------------------------------------------------------------- layout (web meters, floor top y = 0)
# #109: 7 x 5.5 -> 9 x 7 m so that nothing touches (layout rules: .claude/skills/office-bake/SKILL.md 10, checked by
# check-glb --overlap on the slot_* footprints). Zones: work back-left (desks 0-1 under the window, 2-3 along the left
# wall), meeting at the whiteboard (back middle), library back-right, lounge front-right (ping-pong, sofa facing it),
# coffee on the right wall, board games front-left, entrance on the left wall near the front (door + clock).
# #280 plan 3 (room-280.md 8): 9 x 7 -> 9.6 x 8.2 m, still centred on the origin (the app's floor grids, walls and tour
# take the room as symmetric). The designer's table keeps the old origin (the new room x -4.5..5.1, z -3.9..4.3):
# _c() moves one of its points by -ROOM_SHIFT into the centred room; every placement below goes through it
ROOM_SHIFT = (0.3, 0.2)


def _c(x, z):
    return (round(x - ROOM_SHIFT[0], 4), round(z - ROOM_SHIFT[1], 4))


HX, HZ = 4.8, 4.1  # half room: x -4.8..4.8, z -4.1..4.1 (back wall n at -z, left wall w at -x)
WALL_H = 2.6
WT = 0.14
WORK_Z = 0.5  # where an agent hovers in front of its desk (from the desk center): hands reach the keyboard

AGENTS = [  # desk frame (x, z, ry): the agent sits on local +z and faces local -z (the monitor)
    # #195 plan 2 (desks.md 2.1.3): an island pod, two rows of two back to back running north-south (west row x -3.01,
    # east row x -2.39, desks 1.2 long), MEMO's head desk across their north end in front of the window
    {"color": "#ffb347", "at": (*_c(-2.50, -2.12), math.pi)},  # 0 MEMO amber: head desk, faces south
    {"color": "#8f9bff", "at": (*_c(-2.81, -0.01), -math.pi / 2)},  # 1 MESH lavender: west row south, faces east
    {"color": "#ff3ea5", "at": (*_c(-2.81, -1.21), -math.pi / 2)},  # 2 HUE magenta: west row north, faces east
    {"color": "#4df3ff", "at": (*_c(-2.19, -1.21), math.pi / 2)},  # 3 LOOP cyan: east row north, faces west
    {"color": "#f2ffc4", "at": (*_c(-2.19, -0.01), math.pi / 2)},  # 4 ECHO phosphor (#193): east row south, faces west
]
WINDOW_X = _c(-1.9, 0)[0]  # the window over desks 0-1 (2.6 m wide)
WHITEBOARD_X, BULLETIN_X = _c(1.1, 0)[0], _c(2.55, 0)[0]
# #195 (desks.md 2.1.2): one meeting circle almost square in front of the whiteboard; the board meeting and the floor
# meeting stand on the same ring. Ring 0.9 + a body 0.26 = 1.16 kept free; ry = its 0 deg (toward the board)
MEET_CENTER = _c(1.0, -1.77)  # #280: 0.2 north with the back wall
# #195 (designer #249): the pod stands right under the work panel's middle and its oak tops and ivory caps baked
# past white. Their two atlases are scaled down after the bake (linear, before the webp), the rest of the room as before
ATLAS_GAIN = {"work": float(next((a.split("=")[1] for a in sys.argv if a.startswith("--gain-work=")), 0.27)),
              "desk_props": float(next((a.split("=")[1] for a in sys.argv if a.startswith("--gain-desk=")), 0.27))}  # calibrated: tops linear ~(2.26, 1.91, 1.57) at 1.0
MEET_RING, MEET_R, MEET_RY = 0.9, 1.16, math.radians(-3.0)
CHAT_SPOTS = (_c(-1.45, -3.35), _c(-0.45, -3.35))  # the second conversation: two spots by the window, facing each other
RUG_WORK = (*_c(-2.50, -0.92), 2.46, 4.24)  # x, z, width, depth (desks.md 2.1.5)
RUG_LOUNGE = (3.275, 2.655, 2.45, 2.29)  # #280 3 (lounge-props.md 3.1): x 2.05..4.5, z 1.51..3.8 (its west end 7 cm in)
RUG_MEET_D = 2.92
CAN_STAND = _c(4.85 - 0.035, 0.95)  # #185 / #280: the watering can's stand, north of the fig on the east wall (designer); #416: 3.5 cm west (the turned can's spout cleared the wall)
DOOR_Z = _c(0, 2.6)[1]
PINGPONG = _c(1.9, 0.9)
# #280 PR 1: the old 1.9 m sofa along the south wall, its east end at the L sofa's (PR 2 makes it the L), 0.12 off the wall
SOFA = _c(4.03, 3.7375)  # #280 PR 1 only (the old sofa); PR 2 builds SOFA_L / CHAISE (build_lounge2)
LAMP = (2.05, 3.80)  # #280 3 (user, lounge-props.md 3.1): just past the sofa's west arm (the book table is gone)
GAME_TABLE = _c(-1.6, 2.6)
SIDE_TABLE, SIDE_R = _c(2.15, 3.535), 0.21  # #280: the book table at the long sofa's west end (#341: 0.10 west, 0.055 south: the west way in, clear of nav_sofa_in_w)
COUNTER = (HX - 0.32, _c(0, 0.3)[1], math.pi)  # against the right wall, its front (local +x) facing the room
COFFEE_BUTTON = (0.146, 1.2, -0.02)  # #164: the brew button face, counter frame (front = local +x)
SHELF_X = _c(3.75, 0)[0]
SHELF_W, SHELF_D = 1.1, 0.34  # the bookshelf against the back wall: width, depth
PLANTS = [  # name, species, x, z (#126: one species each, office-quality.md 3; plant_boards left out, designer)
    ("plant_desk", "sansevieria", *_c(-3.75, -3.6)),  # #195: the window's west end (the chat spots took its old place)
    ("plant_corner", "fiddle_fig", *_c(4.8, 1.55)),  # #280: on the east wall, north of the sofa's short side
    ("plant_sofa", "monstera", *_c(1.6, 3.85)),  # #280: the lounge rug's west; 0.1 north of the table's 3.95 (its leaves crossed the south wall by 3 cm)
]
CLOCK_AT, CLOCK_S = (-HX + 0.02, 1.85, _c(0, 1.6)[1]), 0.40  # wall clock face center (left wall, next to the door), size
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


def bounds(objs):
    """world bounding box (web coords) of objs: (lo, hi)"""
    bpy.context.view_layer.update()
    lo, hi = [1e9] * 3, [-1e9] * 3
    for o in objs:
        for c in o.bound_box:
            v = o.matrix_world @ Vector(c)
            for k, x in enumerate((v.x, v.z, -v.y)):
                lo[k], hi[k] = min(lo[k], x), max(hi[k], x)
    return lo, hi


def fp(name, objs, kind, wall=None, grow=(0.0, 0.0), core=None):
    """record the world bounding box of objs as a slot; grow = (x, z) margins added on both sides.
    When the slot also holds the room to use the thing (an agent at a desk: core = the desk's objects; players at the
    table ends: grow), the body alone goes out as extras core, so the app's walk grid (#138) blocks only the body"""
    lo, hi = bounds(objs)
    body = bounds(core) if core else (list(lo), list(hi)) if grow != (0.0, 0.0) else None
    lo[0], hi[0], lo[2], hi[2] = lo[0] - grow[0], hi[0] + grow[0], lo[2] - grow[1], hi[2] + grow[1]
    FOOTPRINTS.append({"name": name, "kind": kind, "wall": wall, "lo": lo, "hi": hi, "core": body})


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
        if f.get("core"):  # the body alone (no use room): its base center and size, world web coords
            clo, chi = f["core"]
            o["core"] = {"at": [round((clo[0] + chi[0]) / 2, 3), round(clo[1], 3), round((clo[2] + chi[2]) / 2, 3)],
                         "size": [round(b - a, 3) for a, b in zip(clo, chi)]}
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
    tile(floor, axes="xz")
    # #195 (desks.md 2.1.5): one rug per zone, none touching another. Work: the pod + its chair room, 0.61 beyond the
    # desks (0.30 from a wall wins); meeting: round, the standing circle + 0.30; lounge: the mat in front of the sofa,
    # 0.30 wider each side, 0.45 in front of it, 0.30 off the south wall
    rugs = (("rug_work", RUG_WORK, carpet), ("rug_lounge", RUG_LOUNGE, rug))
    parts = [rounded_slab(n, w, 0.01, d, 0.06 if n == "rug_work" else 0.2, (x, 0.005, z), m, G) for n, (x, z, w, d), m in rugs]
    parts.append(cyl("rug_meet", RUG_MEET_D / 2, 0.01, (MEET_CENTER[0], 0.005, MEET_CENTER[1]), plastic("#33404c", 0.97, 0, 0.9, "rug_meet"), G, 56))
    for n, (x, z, w, d), _m in rugs:
        fp_box(n, "rug", (x - w / 2, 0.0, z - d / 2), (x + w / 2, 0.01, z + d / 2))
    r = RUG_MEET_D / 2
    fp_box("rug_meet", "rug", (MEET_CENTER[0] - r, 0.0, MEET_CENTER[1] - r), (MEET_CENTER[0] + r, 0.01, MEET_CENTER[1] + r))
    # floor edge trim on all four sides: the cut-away faces read as a model base
    L, D = 2 * HX + 2 * WT, 2 * HZ + 2 * WT
    for name, size, c, n_in, ax in (("edge_n", (L, 0.12, 0.02), (0, -0.06, -D / 2 - 0.01), (0, 0, 1), "x"),
                                    ("edge_s", (L, 0.12, 0.02), (0, -0.06, D / 2 + 0.01), (0, 0, -1), "x"),
                                    ("edge_w", (0.02, 0.12, D + 0.04), (-L / 2 - 0.01, -0.06, 0), (1, 0, 0), "z"),
                                    ("edge_e", (0.02, 0.12, D + 0.04), (L / 2 + 0.01, -0.06, 0), (-1, 0, 0), "z")):
        e = apply_all(box(name, size, c, trim, G))
        drop_facing(e, n_in)  # the side pressed against the floor slab
        parts.append(tile(e, axes=ax))
    # the slab's own sides are covered by the edge trims; #280: its underside is never seen either (it took half the
    # floor's atlas area)
    for n_out in ((0, 0, -1), (0, 0, 1), (-1, 0, 0), (1, 0, 0), (0, -1, 0)):
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
    # #280 (designer, room-280.md 6): the wood floor bakes alone in the floor atlas (the 9.6 x 8.2 m room left the shared
    # room atlas ~120 px/m); the rugs, pads and edge trims keep the room atlas
    return o, join("floor", [floor])


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
    if side == "n":  # #211: the rail (3 cm deep) stood 8 mm proud of the shelf's back panel: a black strip in each
        # shelf at 0.96 m (designer: "a dashed seam"). It stops at the shelf's sides instead of running behind it
        rs, (_, ry, rz) = at(0.015, 0.96, span, 0.03, 0.03)
        a, b = SHELF_X - SHELF_W / 2 - 0.015, SHELF_X + SHELF_W / 2 + 0.015
        for k, (x0, x1) in enumerate(((-HX, a), (b, HX))):
            p.append(box(f"wall_{side}_rail_{k}", (x1 - x0, rs[1], rs[2]), ((x0 + x1) / 2, ry, rz), trim, G))
    else:
        # #263: e / w trims stop at the n / s trims (they overlapped in the corners and z-fought): rail 3 cm, base 2 cm,
        # cap 1.1 cm short at each end
        p.append(box(f"wall_{side}_rail", *at(0.015, 0.96, span if along_x else span - 0.06, 0.03, 0.03), trim, G))
    p += [box(f"wall_{side}_base", *at(0.01, 0.04, span if along_x else span - 0.04, 0.08, 0.02), trim, G),
          box(f"wall_{side}_cap", *at(-WT / 2, WALL_H + 0.015, run if along_x else run - 0.022, 0.03, WT + 0.02), trim, G)]
    if side == "n":
        wx, wy, ww, wh = WINDOW_X, 1.72, 2.6, 1.05
        frame_m = plastic("#15171c", 0.4, 0.6, 0.05, "window_frame")
        win = [box("win_top", (ww + 0.08, 0.05, 0.1), (wx, wy + wh / 2, -HZ), frame_m, G),
               box("win_bot", (ww + 0.12, 0.05, 0.16), (wx, wy - wh / 2, -HZ + 0.03), frame_m, G),
               box("win_l", (0.05, wh - 0.05, 0.1), (wx - ww / 2, wy, -HZ), frame_m, G),  # #263: between the bars, not through them
               box("win_r", (0.05, wh - 0.05, 0.1), (wx + ww / 2, wy, -HZ), frame_m, G)]
        fp("window", win, "wall", "n")
        for k2 in (1, 2, 3):
            win.append(box("mullion", (0.03, wh, 0.05), (wx - ww / 2 + k2 * ww / 4, wy, -HZ), frame_m, G))
        win.append(box("transom", (ww, 0.03, 0.04), (wx, wy + 0.18, -HZ), frame_m, G))  # #263: 1 cm shallower than the mullions
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
SEAT_PROPS = {}  # #187: prop name -> (its parts in the prop frame or None, home matrix in the world): build_props
DESK_ATLAS = "desk_props"  # #187: the kit and the owners' things, near-field (>= 500 px/m, desk-props.md 1)


def build_desk(i, agent):
    """the desk body (work atlas: oak top, graphite band, legs, cable tray) and, in the desk_props atlas, the common
    kit (#187: keyboard case, monitor, mouse + pad, cables) with its owner's things (SEATS); the 87 caps as one node
    kb_<i>_caps (#225: _KEY, extras keys); the mouse buttons and wheel live (#225)"""
    G = "work"
    F = frame(agent["at"])
    w, d, h = KIT.DESK_W, KIT.DESK_D, DESK_H
    body = KIT.kit_desk(G)
    GP = DESK_ATLAS
    kit, _ = KIT.kit_keyboard(GP, agent["color"], caps=False)
    mon = KIT.kit_monitor(GP)
    nz = [o for o in mon if o.name.startswith("mon_neck")][0].location
    kit += mon + KIT.kit_cables(GP, mon_nz=-nz.y)
    mouse_live = []
    if i != 2:  # HUE has a pen tablet in the mouse spot
        m_parts, mouse_live = KIT.kit_mouse(GP, split=True)
        kit += m_parts + KIT.kit_pad(GP)
    if i in (0, 2):  # the old plants drew from RNG: keep its sequence so the rest of the room stays as it was (desks 0, 2 only)
        for _ in range(5 * 4):
            RNG.uniform(0, 1)
    statics, desk_live, props = SEATS[i](GP)
    for name, objs, home in props:
        SEAT_PROPS[name] = (objs, F @ home)
    for suf, objs, M in mouse_live:
        if suf == "mouse":  # #305: the body; the pad's top rectangle in the body's rest frame (local x, z), its size
            desk_live.append(LIVE(f"desk_{i}_{suf}", "bot", objs, M, pad={"center": [0.0, 0.03], "half": [0.125, 0.105]},
                                  size=[0.062, 0.038, 0.115]))
        elif suf == "mouse_shadow":
            desk_live.append(LIVE(f"desk_{i}_{suf}", "bot", objs, M, shadow_of=f"desk_{i}_mouse"))
        else:
            desk_live.append(LIVE(f"desk_{i}_{suf}", "bot", objs, M))
    if "--tris" in ARGS:  # what the kit and the owner's things add (modifiers and text evaluated)
        dg = bpy.context.evaluated_depsgraph_get()
        n = 0
        for o in kit + statics + [o for e in desk_live for o in e["objs"]]:
            if o.type in ("MESH", "CURVE", "FONT"):
                me = o.evaluated_get(dg).to_mesh()
                n += sum(len(p.vertices) - 2 for p in me.polygons)
                o.evaluated_get(dg).to_mesh_clear()
        print(f"desk_{i} kit + props: {n} triangles")
    body_w = place(body, F)
    props_w = place(kit + statics, F)
    # no chair: agents hover at their desk. A floor pad in the agent's color marks the spot instead.
    pad = rounded_slab("pad", 0.62, 0.006, 0.5, 0.12, (0, 0.003, 0), plastic(agent["color"], 0.9, 0, 0.6, f"pad_{i}"), G)
    pad = place([pad], F @ Mx((0, 0, WORK_Z)))
    POD.append((bounds(body_w), bounds(body_w + props_w + pad)))  # #195: the five desks are one island: one footprint
    desk = join(f"desk_{i}", body_w)
    things = join(f"desk_{i}_props", props_w)
    things["desk"] = i
    pad = join(f"pad_{i}", pad)
    # #225 plan A: the 87 caps, one node in the keyboard frame (press = local -y by press x key_travel_m)
    Kf = F @ KIT.keyboard_frame()
    caps, keys = KIT.keyed_caps(f"kb_{i}_caps", GP, agent["color"])
    caps = pivot(join(f"kb_{i}_caps", place([caps], Kf)), Kf)
    caps["keys"] = keys
    caps["key_travel_m"] = KIT.KEY_TRAVEL
    caps["desk"] = i
    # live parts: the screen slot and a neon strip under the desk's front edge
    scr = quad(f"screen_work_{i}", 0.57, 0.33, screen_mat(f"screen_glow_{i}", agent["color"], 0.45), "export")
    screen = slot(apply_all(place(scr, F @ Mx((0, h + 0.36, -0.1775)))[0]), 0.57, 0.33)  # #260: 0.5 mm proud of the kit's screen_at
    strip = box(f"neon_desk_{i}", (w - 0.04, 0.006, 0.006), (0, 0, 0), emitter(agent["color"], 3.0, f"neon_desk_{i}"), "export")
    neon = apply_all(place(strip, F @ Mx((0, h - 0.04, d / 2 - 0.004)))[0])
    return [desk, pad], [things, caps], [screen, neon], place_desk_live(F, desk_live)


# ================================================================ DESK PROPS (#43, docs/design/desks.md 2 + 4)
# Each owner's things on their desk. Built in the desk frame (x = right of the seated agent, z + = toward the
# agent, y = height from the floor, desk top at DESK_H). Plain things are baked into desk_<i>; things the app
# changes from data are live nodes (LIVE below), placed like the other live parts. The hands' band in front of
# the keyboard (x ±0.28, z -0.03..0.31) and the mouse spot stay empty.
DESK_H = 0.74
POD = []  # (desk objects, its agent pad) per desk, for the pod's single footprint (#195)
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
        # #263: the walls stand on the floor plate (they shared its edge faces and underside), the back wall and the
        # lip sit between the sides (their ends shared the sides' outer faces); the label 0.5 mm off its plate
        f = h + y0 + 0.003
        s += [box("tray_floor", (tw, 0.003, td), (tx, h + y0 + 0.0015, tz), iron, G, bev=0.001, seg=1),
              box("tray_back", (tw - 0.006, wy - 0.003, 0.003), (tx, f + (wy - 0.003) / 2, tz - td / 2 + 0.0015), back_m, G),
              box("tray_side", (0.003, wy - 0.003, td - 0.02), (tx - tw / 2 + 0.0015, f + (wy - 0.003) / 2, tz - 0.01), side_m, G),
              box("tray_side", (0.003, wy - 0.003, td - 0.02), (tx + tw / 2 - 0.0015, f + (wy - 0.003) / 2, tz - 0.01), side_m, G),
              # the sides sweep down to the low front lip (a real tray's scoop): a short low piece at the front
              box("tray_side", (0.003, 0.013, 0.02), (tx - tw / 2 + 0.0015, f + 0.0065, tz + td / 2 - 0.01), iron, G),
              box("tray_side", (0.003, 0.013, 0.02), (tx + tw / 2 - 0.0015, f + 0.0065, tz + td / 2 - 0.01), iron, G),
              box("tray_lip", (tw - 0.006, 0.013, 0.003), (tx, f + 0.0065, tz + td / 2 - 0.0015), iron, G, bev=0.001, seg=1),
              box("tray_plate", (0.05, 0.012, 0.001), (tx, h + y0 + 0.008, tz + td / 2 + 0.0005), plate_m, G),
              text("tray_label", label, 0.0085, (tx, h + y0 + 0.0082, tz + td / 2 + 0.0015), ink, G)]
        base = h + y0 + 0.003
        sheets = []
        for k in range(5):  # live: the app shows 0..5 (desks.md)
            sh = box("sheet", (0.2, 0.0028, 0.25), (tx + DRNG.uniform(-0.004, 0.004), base + 0.0015 + k * 0.003, tz + 0.012), paper, G)
            sh.rotation_euler = (0, 0, DRNG.uniform(-0.03, 0.03))
            sheets.append(sh)
        L.append(LIVE(f"desk_0_{label.lower()}", "bot", sheets, Mx((tx, base, tz + 0.012)), sheets=5, sheet_h=0.003))
    for px in (tx - tw / 2 + 0.004, tx + tw / 2 - 0.004):  # four posts through both tiers to the lid
        for pz in (tz - td / 2 + 0.004, tz + td / 2 - 0.004):
            top = 0.1505 if pz < tz else 0.117  # the back pair carry the top shelf (the planes), the front pair stop at IN
            s.append(cyl("tray_post", 0.003, top - 0.001, (px, h + 0.001 + (top - 0.001) / 2, pz), iron, G, 8))  # #263: foot 1 mm up
    s += [box("tray_lid", (tw, 0.003, 0.16), (tx, h + 0.152, tz - td / 2 + 0.08), back_m, G, bev=0.001, seg=1),  # on the back posts
          # a 1 cm front lip; #263: 1 mm proud of the lid's front, 0.5 mm under its top, 0.5 mm in at the ends
          box("tray_lid_lip", (tw - 0.001, 0.0095, 0.003), (tx, h + 0.14825, tz - td / 2 + 0.1595), iron, G, bev=0.001, seg=1)]
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
          lathe("stamp_knob", [(0.0, 0.01), (0.009, 0.01), (0.0075, 0.018), (0.0085, 0.024), (0.012, 0.027), (0.015, 0.03), (0.0175, 0.033), (0.019, 0.036),
                               (0.0192, 0.039), (0.0185, 0.0415), (0.0168, 0.0438), (0.014, 0.0455), (0.0105, 0.0466), (0.006, 0.0472), (0.0, 0.0474)],
                (0, 0, 0), wood_h, G, seg=28)]  # a finer head (designer)
    P.append(("prop_stamp", st, Mx((0.535, h + 0.0425, 0.12))))  # home moves 0.51 -> 0.535 with the pad
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


# ================================================================ MESH (seat 1)
_PLASTER = {}


def plaster(name):
    """plaster study shapes (baked): roughness 0.9, the value varying +-3% in a fine noise, fine pits (bump)"""
    if name in _PLASTER:
        return _PLASTER[name]
    m, nodes, links, b = new_mat(name)
    nz = nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 180.0
    nz.inputs["Detail"].default_value = 4
    ramp = nodes.new("ShaderNodeValToRGB")
    lo, hi = [Color(rgba("#ece9e2")[:3]) for _ in range(2)]
    lo.v, hi.v = lo.v * 0.97, min(1.0, hi.v * 1.03)
    ramp.color_ramp.elements[0].color = (*lo, 1.0)
    ramp.color_ramp.elements[1].color = (*hi, 1.0)
    links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.9
    bump(nodes, links, b, 900, 0.35, 0.0002)
    _PLASTER[name] = m
    return m


def seat_mesh(G):
    """desk-props.md 3 MESH: a turntable (round base 0.2, a platter that turns, a front button, a cable behind,
    four rubber feet), a ring light (a 0.25 ring with a phone clamp in the middle, an angle knob, a telescoping pole
    with height collars, a base, a cable), plaster study shapes (sphere, cone, cylinder) and one lavender torus
    (the 3D program's default shape - MESH's joke), the colour checker, MESH's mug (#156 shape, red glaze)"""
    h = DESK_H
    s, L, P = [], [], []
    black = plastic("#1d1f24", 0.55, 0.3, 0.05, "tt_black")
    rubber = plastic("#0e0f12", 0.9, 0, 0.3, "rubber_foot")
    cable_m = plastic("#16171b", 0.85, 0, 0.4, "cable")
    lav_hex = AGENTS[1]["color"]
    # 1 turntable (live platter + rim + cube: spins about local y while MESH bakes)
    tx, tz = -0.43, -0.18
    s.append(lathe("tt_base", [(0, 0.003), (0.097, 0.003), (0.1, 0.006), (0.1, 0.015), (0.097, 0.018), (0, 0.018)], (tx, h, tz), black, G, seg=30))
    for k in range(4):
        a = math.pi / 4 + k * math.pi / 2
        s.append(cyl("tt_foot", 0.008, 0.003, (tx + 0.07 * math.cos(a), h + 0.0015, tz + 0.07 * math.sin(a)), rubber, G, 10))
    s += [cyl("tt_button_ring", 0.0065, 0.002, (tx, h + 0.0105, tz + 0.1005), plastic("#c8ccd4", 0.3, 0.9, 0, "chrome"), G, 14, axis="z"),
          cyl("tt_button", 0.0045, 0.003, (tx, h + 0.0105, tz + 0.1015), emitter(lav_hex, 1.2, "tt_button"), G, 14, axis="z")]
    tc = rail("tt_cable", [(tx, h + 0.008, tz - 0.098), (tx + 0.005, h + 0.003, tz - 0.12), (tx + 0.02, h + 0.003, -0.29), (tx + 0.025, h - 0.01, -0.315)], 0.002, cable_m, G)
    tc.data.resolution_u, tc.data.bevel_resolution = 4, 0
    s.append(tc)
    lav = plastic(lav_hex, 0.4, 0, 0.05, "turntable_rim")
    lb = lav.node_tree.nodes["Principled BSDF"]
    lb.inputs["Emission Color"].default_value = rgba(lav_hex)
    lb.inputs["Emission Strength"].default_value = 0.5
    Tt = Mx((tx, h + 0.018, tz))
    tt = [lathe("tt_platter", [(0, 0), (0.078, 0), (0.08, 0.002), (0.08, 0.008), (0.078, 0.01), (0, 0.01)], (0, 0, 0),
                plastic("#5a5f68", 0.45, 0.4, 0.05, "platter"), G, seg=30),
          torus("tt_rim", 0.0805, 0.0022, (0, 0.006, 0), lav, G, seg=30, rseg=4),  # #263: its 45° faces 0.14 mm off the platter chamfer
          box("tt_cube", (0.05, 0.05, 0.05), (0.02, 0.035, 0), plaster("plaster"), G, bev=0.003, seg=1, rot_y=0.4)]
    L.append(LIVE("desk_1_turntable", "bot", place(tt, Tt), Tt))
    # 2 colour checker on the monitor base (as before; black card = the borders between the chips)
    chips = ["#735244", "#c29682", "#627a9d", "#576c43", "#8580b1", "#67bdaa", "#d67e2c", "#505ba6", "#c15a63", "#5e3c6c",
             "#9dbc40", "#e0a32e", "#383d96", "#469449", "#af363c", "#e7c71f", "#bb5695", "#0885a1", "#f3f3f2", "#c8c8c8",
             "#a0a0a0", "#7a7a79", "#555555", "#343434"]
    card = [box("checker", (0.15, 0.10, 0.003), (0, 0.05, 0), plastic("#111216", 0.6, 0, 0, "checker"), G, bev=0.0008, seg=1)]
    for k, c in enumerate(chips):
        col, row = k % 6, k // 6
        card.append(box("chip", (0.019, 0.019, 0.001), (-0.0575 + col * 0.023, 0.085 - row * 0.023, 0.002), plastic(c, 0.7, 0, 0, f"chip_{c[1:]}"), G))
    s += place(card, Mx((0.15, h, -0.09), rx=-math.radians(20)))
    # 3 ring light (0.25): base, a two-stage pole with height collars, an angle knob, the ring (black housing baked,
    # the diffuser live: lights up, flashes once when a bake ends), a phone clamp in the middle on a cross bar
    rx_, rz_ = 0.46, -0.20
    s += [lathe("rl_base", [(0, 0), (0.058, 0), (0.06, 0.003), (0.06, 0.01), (0.055, 0.013), (0.012, 0.016), (0, 0.016)], (rx_, h, rz_), black, G, seg=28),
          cyl("rl_pole", 0.008, 0.15, (rx_, h + 0.016 + 0.075, rz_), black, G, 10),
          cyl("rl_collar", 0.0105, 0.012, (rx_, h + 0.166, rz_), black, G, 12, bev=0.001),
          cyl("rl_pole2", 0.0058, 0.102, (rx_, h + 0.166 + 0.051, rz_), plastic("#9aa0a8", 0.35, 0.8, 0.08, "rl_alu"), G, 10),
          cyl("rl_collar", 0.008, 0.008, (rx_, h + 0.268, rz_), black, G, 12, bev=0.001),
          cyl("rl_knob", 0.011, 0.012, (rx_ + 0.012, h + 0.282, rz_), black, G, 14, axis="x", bev=0.001)]
    for k in range(1):  # the knob's grip ridge
        s.append(cyl("rl_knob_rib", 0.0118, 0.0012, (rx_ + 0.0085 + k * 0.003, h + 0.282, rz_), black, G, 14, axis="x"))
    R = 0.125 - 0.012
    Rc = Mx((rx_, h + 0.282 + R + 0.012, rz_))  # ring centre, its top level with the monitor's (designer); faces the agent (+z)
    s += place([torus("rl_housing", R, 0.012, (0, 0, 0), black, G, axis="z", seg=40, rseg=4),
                box("rl_yoke", (0.012, 0.016, 0.014), (0, -R - 0.006, 0), black, G, bev=0.001, seg=1),
                box("rl_bar", (0.006, R * 2 - 0.01, 0.005), (0, 0, -0.006), black, G),
                box("rl_clamp", (0.05, 0.012, 0.012), (0, 0.035, 0.0), black, G, bev=0.002, seg=1),
                box("rl_clamp", (0.05, 0.012, 0.012), (0, -0.035, 0.0), black, G, bev=0.002, seg=1),
                box("rl_clamp_pad", (0.04, 0.003, 0.008), (0, 0.0275, 0.002), rubber, G),
                box("rl_clamp_pad", (0.04, 0.003, 0.008), (0, -0.0275, 0.002), rubber, G)], Rc)
    rlc = rail("rl_cable", [(rx_, h + 0.02, rz_ - 0.05), (rx_ - 0.01, h + 0.003, rz_ - 0.07), (rx_ - 0.03, h + 0.003, -0.29), (rx_ - 0.035, h - 0.01, -0.315)], 0.0018, cable_m, G)
    rlc.data.resolution_u, rlc.data.bevel_resolution = 4, 0
    s.append(rlc)
    ring = torus("ringlight", R, 0.0085, (0, 0, 0.006), emitter("#f4f0ff", 3.0, "ringlight"), "export", axis="z", seg=40, rseg=4)
    L.append(LIVE("desk_1_ringlight", "neon", place([ring], Rc), Rc))
    # 4 plaster study shapes + the lavender default torus
    px, pz = -0.42, 0.15
    s += [sphere("prim_sphere", 0.03, (px - 0.06, h + 0.03, pz - 0.03), plaster("plaster"), G, seg=18, rings=10),
          lathe("prim_cone", [(0, 0), (0.029, 0), (0.03, 0.001), (0.0018, 0.0632), (0.0008, 0.0645), (0.0, 0.065)], (px + 0.02, h, pz + 0.035), plaster("plaster"), G, seg=18),
          lathe("prim_cylinder", [(0, 0), (0.023, 0), (0.024, 0.001), (0.024, 0.054), (0.023, 0.055), (0, 0.055)], (px + 0.04, h, pz - 0.035), plaster("plaster"), G, seg=18),
          torus("prim_torus", 0.033, 0.011, (px - 0.065, h + 0.011, pz + 0.075), plastic("#b9a6e6", 0.85, 0, 0.1, "prim_torus"), G, seg=22, rseg=8)]
    # 5 MESH's mug (#156 shape, red glaze #b83a3a) left of the keyboard, the handle toward the agent's right
    red = plastic("#b83a3a", 0.3, 0, 0.05, "mug_glaze_red")
    mug = mug_parts(1, G)
    for o in mug:
        for k, m in enumerate(o.data.materials):
            if m and m.name.startswith("mug_glaze_1"):
                o.data.materials[k] = red
    mx, mz, ry = -0.43, -0.01, -0.6  # the body's centre; the cup frame's origin is 7.2 cm toward the handle
    s += place(mug, Mx((mx + 0.072 * math.cos(ry), h + MUG_H / 2, mz - 0.072 * math.sin(ry)), ry=ry))
    return s, L, P


# ================================================================ HUE (seat 2)
def flipped(o):
    """turn a mesh's faces inside out (a shade's white inner skin)"""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    bm.to_mesh(o.data)
    bm.free()
    return o


def spring(name, a, b, r, turns, material, group, wire=0.0008, per_turn=6):
    """a coil from a to b (web points) of radius r beside an arm"""
    a, b = Vector(a), Vector(b)
    ax = (b - a).normalized()
    u = ax.cross(Vector((0, 1, 0)) if abs(ax.y) < 0.9 else Vector((1, 0, 0))).normalized()
    v = ax.cross(u)
    n = turns * per_turn
    pts = [tuple(a.lerp(b, k / n) + (u * math.cos(2 * math.pi * k / per_turn) + v * math.sin(2 * math.pi * k / per_turn)) * r) for k in range(n + 1)]
    o = rail(name, pts, wire, material, group)
    o.data.resolution_u, o.data.bevel_resolution = 1, 0
    return o


PEN_CUP_Z = 0.0  # HUE's pen cup, desk frame z (was -0.06: 0.78 m from the seat, past the 0.75 reach)


def seat_hue(G):
    """desk-props.md 3 HUE: the swatch fan (+ a grey number band under each chip, a domed pin head), a pen tablet
    0.26 x 0.17 (active-area outline live, four shortcut buttons on the left, a cable off the top, a pen cup), an
    architect lamp (springs beside both arms, joint knobs, a switch on the base, a cable, magenta shade white inside),
    the echeveria. No mouse on this desk (the tablet takes its spot)"""
    h = DESK_H
    s, L, P = [], [], []
    dark = plastic("#22252c", 0.6, 0.1, 0.05, "tablet")
    chrome = plastic("#c8ccd4", 0.3, 0.9, 0, "chrome")
    cable_m = plastic("#16171b", 0.85, 0, 0.4, "cable")
    grey_band = plastic("#4a4e56", 0.7, 0, 0.1, "swatch_band")  # dark grey (designer)
    # 1 swatch fan in the team's four colours, pinned at the bottom; each chip a grey number band at its foot
    fx, fz = -0.40, -0.16
    s.append(box("fan_base", (0.04, 0.014, 0.03), (fx, h + 0.007, fz), plastic("#2c3038", 0.5, 0.2, 0.05, "kb"), G, bev=0.003, seg=1))
    for k, (a, deg) in enumerate(zip(AGENTS, (27, 9, -9, -27))):
        chip = [box("swatch", (0.035, 0.16, 0.003), (0, 0.08, 0), plastic(a["color"], 0.5, 0, 0.05, f"swatch_{k}"), G, bev=0.001, seg=1),
                box("swatch_band", (0.035, 0.024, 0.0006), (0, 0.012, 0.0018), grey_band, G),  # 15% of the chip, at its foot
                box("swatch_num", (0.014, 0.003, 0.0004), (-0.005, 0.014, 0.0022), plastic("#c9ccd2", 0.7, 0, 0, "swatch_num"), G)]
        s += place(chip, Mx((fx, h + 0.01, fz - 0.006 + k * 0.004), rz=math.radians(deg)))
    s += [cyl("fan_pin", 0.0035, 0.024, (fx, h + 0.018, fz + 0.002), chrome, G, 10, axis="z"),
          place([sphere("fan_pin_head", 0.006, (0, 0, 0), chrome, G, scale=(1, 1, 0.5), seg=12, rings=6)], Mx((fx, h + 0.018, fz + 0.015)))[0]]
    # 2 pen tablet in the mouse spot: board, the live active-area outline, four shortcut keys on the left, a cable off
    # the top edge, a pen cup to its right (the pen itself is prop_tablet_pen, #164)
    bx, bz, bw, bd = 0.36, 0.06, 0.26, 0.17
    s += [rounded_slab("tablet", bw, 0.009, bd, 0.012, (bx, h + 0.0045, bz), dark, G, seg=3, edge=0.0015),
          box("tablet_area_bed", (0.18, 0.0004, 0.115), (bx + 0.025, h + 0.0092, bz), plastic("#1a1c21", 0.75, 0, 0.1, "tablet_area"), G)]
    for k in range(4):
        s.append(box("tablet_key", (0.016, 0.003, 0.02), (bx - bw / 2 + 0.022, h + 0.0105, bz - 0.048 + k * 0.032), plastic("#30343c", 0.5, 0, 0.05, "tablet_key"), G, bev=0.001, seg=1))
    mag = emitter(AGENTS[2]["color"], 2.0, "tablet_area")
    aw, ad, t = 0.18, 0.115, 0.0025
    area = [box("area", (aw, 0.001, t), (0, 0, -ad / 2), mag, "export"), box("area", (aw, 0.001, t), (0, 0, ad / 2), mag, "export"),
            box("area", (t, 0.001, ad), (-aw / 2, 0, 0), mag, "export"), box("area", (t, 0.001, ad), (aw / 2, 0, 0), mag, "export")]
    Ta = Mx((bx + 0.025, h + 0.0098, bz))
    L.append(LIVE("desk_2_tablet", "neon", place(area, Ta), Ta))
    tcab = rail("tablet_cable", [(bx - 0.06, h + 0.006, bz - bd / 2), (bx - 0.065, h + 0.003, bz - bd / 2 - 0.03), (bx - 0.04, h + 0.003, -0.25), (bx - 0.03, h - 0.01, -0.315)], 0.0018, cable_m, G)
    tcab.data.resolution_u, tcab.data.bevel_resolution = 4, 0
    s += [tcab, lathe("pen_cup", [(0, 0), (0.017, 0), (0.018, 0.002), (0.018, 0.05), (0.0165, 0.05), (0.0165, 0.004), (0, 0.004)],
                      (0.53, h, PEN_CUP_Z), dark, G, seg=18)]  # #195: 0.73 m from the seat (reach 0.75, coder)
    # the pen's home (designer): standing in the cup, tilted 15 deg back. prop_tablet_pen keeps its #164 mesh (along
    # local z, tip at -z, 7 cm from the centre pivot); only its home moves: tip on the cup's floor, local z up and back
    a15 = math.radians(15)
    P.append(("prop_tablet_pen", None, Mx((0.53, h + 0.004 + 0.07 * math.cos(a15), PEN_CUP_Z - 0.07 * math.sin(a15)), rx=-math.radians(90) - a15)))
    # 3 succulent (as before, #126)
    s += plant_tris("succulent", echeveria("succulent", 0.24, h, -0.18, G))
    # #280 (coder): where watering lands: the soil's centre (pot 5 cm, soil 1.5 cm under its rim), placed with the desk
    soil = bpy.data.objects.new("soil_succulent", None)
    coll("export").objects.link(soil)
    L.append(LIVE("soil_succulent", "anchor", [soil], Mx((0.24, h + 0.05 - 0.015 + 0.003, -0.18)), soil_of="succulent", r=0.034))
    # 4 architect lamp: base (switch, cable), two arms each with a spring beside it, knobs at the joints, the shade
    # magenta outside / white inside over the swatch fan; live = the bulb
    base, elbow, head = (-0.52, h + 0.016, -0.26), (-0.53, h + 0.33, -0.24), (-0.40, h + 0.27, -0.13)
    metal = plastic("#3a3f48", 0.4, 0.5, 0.05, "lamp")
    s += [lathe("lamp_base", [(0, 0), (0.05, 0), (0.052, 0.004), (0.05, 0.012), (0.03, 0.016), (0, 0.016)], (base[0], h, base[2]), metal, G, seg=28),
          box("lamp_switch", (0.012, 0.005, 0.008), (base[0] + 0.022, h + 0.016, base[2] + 0.02), plastic("#16171b", 0.5, 0, 0, "lamp_switch"), G, bev=0.001, seg=1),
          segment("lamp_arm", base, elbow, 0.0055, metal, G, verts=8),
          segment("lamp_arm", elbow, head, 0.0055, metal, G, verts=8),
          sphere("lamp_joint", 0.01, elbow, metal, G, seg=10, rings=6)]
    for a_, b_ in ((base, elbow), (elbow, head)):  # a spring beside each arm, 8.5 mm off it
        A, B = Vector(a_), Vector(b_)
        off = (B - A).cross(Vector((0, 0, 1))).normalized() * 0.0085
        s.append(spring("lamp_spring", tuple(A.lerp(B, 0.15) + off), tuple(A.lerp(B, 0.75) + off), 0.0032, 11, chrome, G, per_turn=8))
    for p_ in (base, elbow):  # knobs on the joints' sides
        s.append(cyl("lamp_knob", 0.008, 0.008, (p_[0] + 0.012, p_[1] + (0.004 if p_ is base else 0), p_[2]), metal, G, 12, axis="x", bev=0.001))
    lc = rail("lamp_cable", [(base[0], h + 0.008, base[2] - 0.04), (base[0] + 0.01, h + 0.003, -0.29), (base[0] + 0.02, h - 0.01, -0.315)], 0.0018, cable_m, G)
    lc.data.resolution_u, lc.data.bevel_resolution = 4, 0
    s.append(lc)
    Sh = Mx((-0.40, h + 0.24, -0.12), rx=math.radians(20))
    magenta = plastic(AGENTS[2]["color"], 0.85, 0, 0.1, "lamp_shade")
    shade_prof = [(0.041, -0.03), (0.04, -0.028), (0.03, 0.0), (0.019, 0.022), (0.016, 0.03), (0, 0.03)]
    inner = flipped(lathe("lamp_shade_in", [(0.0385, -0.029), (0.029, 0.0), (0.018, 0.021), (0, 0.028)], (0, 0, 0), plastic("#f3ead8", 0.8, 0, 0.05, "lamp_shade_in"), G, seg=24))  # designer: bright inside when lit
    s += place([lathe("lamp_shade", shade_prof, (0, 0, 0), magenta, G, seg=24), inner,
                cyl("lamp_cap", 0.016, 0.012, (0, 0.034, 0), metal, G, 12, bev=0.001)], Sh)
    bulb = [cyl("bulb", 0.034, 0.002, (0, -0.02, 0), emitter("#ffe2b0", 4.0, "desk_lamp"), "export", 20),
            sphere("bulb", 0.014, (0, -0.012, 0), emitter("#ffe2b0", 4.0, "desk_lamp"), "export", seg=10, rings=6)]
    L.append(LIVE("desk_2_lamp", "neon", place(bulb, Sh), Sh))
    return s, L, P


# ================================================================ LOOP (seat 3)
def keycap(name, material, row=3, label=None, G="kit"):
    """one loose sculpted keycap (the kit's cap, 20 triangles) standing on its foot at the origin, a legend on top"""
    bm = bmesh.new()
    KIT.cap(bm, 0.0, 0.0, 1, row, 0.0)
    out = [smooth(mesh_obj(name, bm, material, G))]
    if label:
        out.append(text(f"{name}_legend", label, 0.0055, (0, KIT.ROW_H[row] + 0.0002, 0.0), plastic("#2a2c31", 0.6, 0, 0, "legend"), G,
                        facing="up", extrude=0.0))
    return out


def seat_loop(G):
    """desk-props.md 3 LOOP: the signal tower (metal rings between the cells, two screws on the base, a cable down),
    the rubber duck (eyes, a flat bottom; a prop now: prop_duck), the portrait side monitor in the kit's style (7 mm
    bezel, rounded back, a pivot stand), a ceramic keycap dish (9 cm, 1.2 cm deep, a foot ring, a glaze rim) with
    three sculpted caps (Esc, ;, a blank teal one = prop_keycap_0), five C-shaped silicone cable clips"""
    h = DESK_H
    s, L, P = [], [], []
    dark = plastic("#2c3038", 0.5, 0.2, 0.05, "kb")
    metal = plastic("#c8ccd4", 0.3, 0.9, 0, "chrome")
    cable_m = plastic("#16171b", 0.85, 0, 0.4, "cable")
    # 1 signal tower: base (two screws), pole, cap, three live cells with metal rings between them, a cable
    sx_, sz_ = 0.47, -0.24
    s += [lathe("sig_base", [(0, 0), (0.024, 0), (0.025, 0.002), (0.025, 0.008), (0.012, 0.011), (0, 0.011)], (sx_, h, sz_), dark, G, seg=20),
          cyl("sig_pole", 0.006, 0.058, (sx_, h + 0.04, sz_), metal, G, 10),
          lathe("sig_cap", [(0, 0), (0.026, 0), (0.026, 0.006), (0.022, 0.011), (0.008, 0.013), (0, 0.013)], (sx_, h + 0.069 + 3 * 0.045, sz_), dark, G, seg=20)]
    for dx in (-0.017, 0.017):
        s.append(cyl("sig_screw", 0.0022, 0.0012, (sx_ + dx, h + 0.0085, sz_ + 0.012), metal, G, 8))
    for k in range(4):  # rings at the bottom, between the cells and under the cap
        s.append(cyl("sig_ring", 0.0265, 0.003, (sx_, h + 0.069 + k * 0.045, sz_), metal, G, 20))  # #263: 0.5 mm proud of the cap
    sc = rail("sig_cable", [(sx_, h + 0.004, sz_ - 0.02), (sx_ - 0.005, h + 0.003, -0.29), (sx_ - 0.01, h - 0.01, -0.315)], 0.0018, cable_m, G)
    sc.data.resolution_u, sc.data.bevel_resolution = 4, 0
    s.append(sc)
    off = {"g": "#1f3f2c", "y": "#4a4226", "r": "#4a2426"}  # designer #187: a dark lens when off; colour + glow only lit (live)
    for k, (tag, c) in enumerate((("g", "#39d98a"), ("y", "#ffd23f"), ("r", RED))):
        At = Mx((sx_, h + 0.069 + 0.0225 + k * 0.045, sz_))
        lens = emitter(c, 3.0, f"signal_{tag}")
        lens.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = rgba(off[tag])
        lamp = cyl(f"signal_{tag}", 0.025, 0.042, (0, 0, 0), lens, "export", 20)
        L.append(LIVE(f"desk_3_signal_{tag}", "neon", place([lamp], At), At))
    # 2 the rubber duck (prop_duck; origin = the body's centre on the desk, facing +x): a flat bottom, eyes
    dx, dz = -0.34, 0.12
    yellow = plastic("#ffd23f", 0.35, 0, 0.05, "duck")
    body = sphere("duck_body", 0.03, (0, 0, 0), yellow, G, scale=(1.2, 0.8, 1.0), seg=18, rings=10)
    for v in body.data.vertices:  # flatten the bottom 6 mm up: it stands
        v.co.z = max(v.co.z, -0.018)
    body.location = W(0, 0.018, 0)
    duck = [body,
            sphere("duck_head", 0.018, (0.016, 0.05, 0), yellow, G, seg=14, rings=8),
            place([cyl("duck_beak", 0.008, 0.014, (0, 0, 0), plastic("#ff8a3d", 0.5, 0, 0, "beak"), G, 10, axis="x", r2=0.004)],
                  Mx((0.037, 0.047, 0), rz=-0.15))[0],
            cyl("duck_tail", 0.012, 0.02, (-0.036, 0.032, 0), yellow, G, 10, r2=0.002)]
    for ez in (-0.009, 0.009):
        duck.append(sphere("duck_eye", 0.0028, (0.029, 0.056, ez), plastic("#111216", 0.3, 0, 0, "duck_eye"), G, seg=8, rings=5))
    P.append(("prop_duck", duck, Mx((dx, h, dz), ry=-0.5)))
    look = bpy.data.objects.new("desk_3_duck_look", None)
    coll("export").objects.link(look)
    L.append(LIVE("desk_3_duck_look", "anchor", [look], Mx((dx + 0.016, h + 0.052, dz))))
    # 3 portrait side monitor in the kit's style: screen 0.19 x 0.31 with fake code (cyan, softly lit), 7 mm bezels
    # (15 mm chin), a rounded back with a VESA plate, a pivot stand (neck + base)
    M = Mx((-0.46, h, -0.20), ry=0.35)
    body_m = plastic("#2e3138", 0.6, 0.0, 0.08, "mon_body")
    alu = plastic("#9aa0a8", 0.35, 0.8, 0.08, "mon_alu")
    code = emitter(AGENTS[3]["color"], 0.9, "fake_code")
    sw, sh_, cy = 0.19, 0.31, 0.105 + 0.155
    bw, bh = sw + 0.014, sh_ + 0.022
    byc = cy - 0.004
    P2 = Mx((0, byc, 0), rx=math.pi / 2)
    mon = place([rounded_slab("sub_bezel", bw, 0.012, bh, 0.004, (0, 0, 0), body_m, G, seg=2),
                 sphere("sub_back", 1.0, (0, -0.006, 0), body_m, G, scale=(bw / 2 - 0.02, 0.018, bh / 2 - 0.03), seg=20, rings=8)], P2)
    bm = bmesh.new()
    bm.from_mesh(mon[1].data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > 1e-6], context="VERTS")
    bm.to_mesh(mon[1].data)
    bm.free()
    mon += [box("sub_screen", (sw, sh_, 0.001), (0, cy, 0.0065), plastic("#07080a", 0.2, 0, 0, "screen_dark"), G),
            box("sub_vesa", (0.06, 0.06, 0.006), (0, cy, -0.006 - 0.018 - 0.002), body_m, G, bev=0.0015, seg=1),
            box("sub_neck", (0.03, cy - 0.008, 0.016), (0, (cy + 0.008) / 2, -0.04), alu, G, bev=0.002, seg=1),
            rounded_slab("sub_base", 0.11, 0.008, 0.09, 0.025, (0, 0.004, -0.03), alu, G, seg=3, edge=0.0015)]
    rng = random.Random(11)
    for k in range(16):
        indent = rng.choice((0, 0, 0.015, 0.03))
        ln = rng.uniform(0.04, 0.15 - indent)
        mon.append(box("code", (ln, 0.006, 0.001), (-0.08 + indent + ln / 2, cy + 0.135 - 0.018 * k, 0.0072), code, G))
    s += place(mon, M)
    # 4 ceramic keycap dish (9 cm, 1.2 cm deep, a foot ring, a darker glaze rim) and three loose caps:
    # Esc and ; (grey, baked) and a blank teal one (prop_keycap_0, the one LOOP fiddles with)
    kx, kz = 0.50, 0.13  # 6 cm right of desks.md: clear of the kit's mouse pad (its right edge at x 0.425)
    glaze = plastic("#ece6d8", 0.25, 0, 0.05, "dish_glaze")
    s += [lathe("dish", [(0, 0.0015), (0.028, 0.0015), (0.03, 0.0), (0.034, 0.0), (0.035, 0.0025), (0.045, 0.011), (0.0455, 0.012),
                         (0.044, 0.0122), (0.034, 0.0045), (0, 0.0035)], (kx, h, kz), glaze, G, seg=28),
          torus("dish_rim", 0.0448, 0.0012, (kx, h + 0.0118, kz), plastic("#b9ab92", 0.3, 0, 0.05, "dish_rim"), G, seg=28, rseg=4)]
    grey = plastic("#8d929c", 0.55, 0, 0.12, "cap_mod")
    for k, (ox, oz, ry, lab) in enumerate(((-0.013, -0.008, 0.3, "Esc"), (0.014, 0.006, -0.5, ";"))):
        s += place(keycap("keycap", grey, 1, lab, G), Mx((kx + ox, h + 0.0035, kz + oz), ry=ry))
    teal = plastic(AGENTS[3]["color"], 0.5, 0, 0.12, "keycap_teal")
    P.append(("prop_keycap_0", keycap("prop_keycap_0", teal, 3, None, G), Mx((kx - 0.002, h + 0.0035, kz + 0.018), ry=1.1)))
    # 5 five C-shaped silicone clips along the back edge holding the cable, which then goes over the edge and down
    clip_m = plastic("#7d828c", 0.9, 0, 0.3, "clip_silicone")
    cy_, cz_ = h + 0.0045, -0.295
    for x in (0.06, 0.12, 0.18, 0.24, 0.30):
        s.append(box("clip_base", (0.012, 0.0015, 0.012), (x, h + 0.00075, cz_), clip_m, G, bev=0.0005, seg=1))
        # one 1 cm band bent into a C round the cable, open toward the front (+z), flat against the base behind
        arc = [(cy_ + 0.0042 * math.sin(a), cz_ + 0.0042 * math.cos(a)) for a in [math.radians(d) for d in range(35, 326, 29)]]
        bm = bmesh.new()
        rows = [[bm.verts.new(W(x + side, y, z)) for (y, z) in arc] for side in (-0.005, 0.005)]
        for k in range(len(arc) - 1):
            bm.faces.new((rows[0][k], rows[1][k], rows[1][k + 1], rows[0][k + 1]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        c = mesh_obj("clip", bm, clip_m, G)
        c.modifiers.new("band", "SOLIDIFY").thickness = 0.0014
        s.append(smooth(c))
    cable = rail("cable", [(0.0, h + 0.004, -0.24), (0.05, h + 0.0045, -0.29), (0.18, h + 0.0045, -0.295), (0.31, h + 0.0045, -0.295),
                           (0.35, h - 0.01, -0.318), (0.37, h - 0.25, -0.32)], 0.003, cable_m, G)
    cable.data.resolution_u, cable.data.bevel_resolution = 6, 1
    s.append(cable)
    return s, L, P



# ================================================================ ECHO (seat 4, #193)
def seat_echo(G):
    """desks.md ECHO + desk-props.md 3: a pair of near-field speakers (bevelled baffle, silver woofer ring + live cone,
    tweeter dome, bass port, rubber feet, a power LED), a 4-channel mixer (channel strips, a gain knob each (live),
    fader slots + live faders, an 8-cell level meter (live), four screws), a headphone stand with the headphones
    (prop_headphones: padded band, swivel yokes, cups + cushions, a coiled cable), three cassettes (cases, reel
    windows, labels, five screws), an acoustic foam tile (8 wedges) behind the monitor"""
    h = DESK_H
    s, L, P = [], [], []
    black = plastic("#16171b", 0.7, 0.1, 0.05, "spk_body")
    baffle = plastic("#1d1f24", 0.6, 0.1, 0.05, "spk_baffle")
    cone_m = plastic("#3a3d44", 0.85, 0, 0.3, "spk_cone")
    silver = plastic("#b9bec6", 0.3, 0.85, 0.05, "spk_ring")
    dark = plastic("#0c0d10", 0.8, 0, 0, "spk_port")
    rubber = plastic("#0e0f12", 0.9, 0, 0.3, "rubber_foot")
    lime = AGENTS[4]["color"]
    leds = []
    # 1 near-field speakers either side of the monitor, toed in 0.3 rad toward the seat; local +z = their front
    sw, sh_, sd = 0.12, 0.20, 0.14
    for side, sx in (("l", -1), ("r", 1)):
        Ms = Mx((sx * 0.42, h + 0.004, -0.20), ry=-sx * 0.3)
        parts = [box("spk_body", (sw, sh_, sd), (0, sh_ / 2, 0), black, G, bev=0.005, seg=2),
                 box("spk_baffle", (sw - 0.008, sh_ - 0.008, 0.004), (0, sh_ / 2, sd / 2 + 0.001), baffle, G, bev=0.003, seg=1),
                 torus("spk_woofer_ring", 0.043, 0.0028, (0, 0.075, sd / 2 + 0.004), silver, G, axis="z", seg=28, rseg=4),
                 torus("spk_tweeter_ring", 0.019, 0.002, (0, 0.158, sd / 2 + 0.004), silver, G, axis="z", seg=20, rseg=4),
                 place([sphere("spk_tweeter", 0.015, (0, 0, 0), plastic("#2b2e35", 0.4, 0.3, 0.05, "spk_tweeter"), G, half=True, seg=16, rings=6)],
                       Mx((0, 0.158, sd / 2 + 0.003), rx=math.pi / 2))[0],
                 box("spk_port", (0.06, 0.012, 0.004), (0, 0.02, sd / 2 + 0.0015), dark, G, bev=0.003, seg=1)]
        for fx in (-1, 1):
            for fz in (-1, 1):
                parts.append(cyl("spk_foot", 0.008, 0.004, (fx * 0.04, -0.002, fz * 0.05), rubber, G, 10))
        s += place(parts, Ms)
        leds += place([cyl("spk_led", 0.0022, 0.002, (sx * -0.04, 0.188, sd / 2 + 0.0035), emitter(lime, 3.0, "spk_led"), "export", 10, axis="z")], Ms)
        Mc = Ms @ Mx((0, 0.075, sd / 2 + 0.002))  # the woofer cone: moves along local z (travel 3 mm)
        cone = [lathe("spk_cone", [(0.0, 0.004), (0.012, 0.0025), (0.04, -0.008), (0.042, -0.006), (0.0405, -0.004)], (0, 0, 0), cone_m, G, seg=24),
                place([sphere("spk_dust_cap", 0.012, (0, 0, 0), cone_m, G, half=True, seg=14, rings=4, scale=(1, 0.5, 1))], Mx((0, 0, 0.003)))[0]]
        cone = place(cone, Mx(rx=math.pi / 2))  # lathe axis (web y) -> local +z (out of the baffle)
        L.append(LIVE(f"desk_4_spk_{side}", "bot", place(cone, Mc), Mc, travel=0.003, axis="z"))
    L.append(LIVE("desk_4_spk_led", "neon", leds))
    # 2 the mixer, front left: a sloped case, four channel strips (gain knob, fader slot), an 8-cell meter, 4 screws
    mx, mz = -0.46, 0.10
    body = plastic("#2a2d33", 0.6, 0.2, 0.05, "mixer")
    panel = plastic("#33373e", 0.55, 0.2, 0.05, "mixer_panel")
    ivory = plastic("#ece6d8", 0.45, 0, 0.1, "fader_cap")
    Mm = Mx((mx, h, mz), rx=-math.radians(6))  # its top tilts 6 deg toward the seat
    mw, mh, md = 0.16, 0.03, 0.12
    s += place([box("mixer_case", (mw, mh, md), (0, mh / 2, 0), body, G, bev=0.004, seg=2),
                box("mixer_panel", (mw - 0.008, 0.001, md - 0.008), (0, mh + 0.0004, 0), panel, G)], Mm)
    for k in range(4):
        cx = -mw / 2 + 0.018 + k * 0.03
        s += place([box("mixer_div", (0.0008, 0.0006, md - 0.016), (cx + 0.015, mh + 0.001, 0), dark, G),
                    box("fader_slot", (0.003, 0.0006, 0.055), (cx, mh + 0.001, 0.02), dark, G)], Mm)
        Kn = Mm @ Mx((cx, mh + 0.001, -0.035))
        knob = [cyl("knob", 0.0065, 0.008, (0, 0.004, 0), plastic("#16171b", 0.5, 0, 0.05, "knob"), G, 14, bev=0.001),
                box("knob_mark", (0.0012, 0.0005, 0.005), (0, 0.0083, -0.003), ivory, G)]
        L.append(LIVE(f"desk_4_knob_{k}", "bot", place(knob, Kn), Kn, axis="y"))
        Fz = Mm @ Mx((cx, mh + 0.001, 0.02 + 0.0225))  # the fader at zero (the slot's front end); pushed = local -z
        cap_ = [box("fader", (0.012, 0.008, 0.007), (0, 0.004, 0), ivory, G, bev=0.0012, seg=1),
                box("fader_line", (0.012, 0.0004, 0.001), (0, 0.0082, 0), dark, G)]
        L.append(LIVE(f"desk_4_fader_{k}", "bot", place(cap_, Fz), Fz, travel=0.045, axis="-z", zero=0.0))
    meter_m = emitter(lime, 2.5, "meter")
    for k in range(8):  # bottom (front) to top (back); the app lights them from the music's level
        Mk = Mm @ Mx((mw / 2 - 0.016, mh + 0.0012, 0.04 - k * 0.0095))
        L.append(LIVE(f"desk_4_meter_{k}", "neon", place([box("meter", (0.012, 0.0008, 0.006), (0, 0, 0), meter_m, "export")], Mk), Mk))
    for fx in (-1, 1):
        for fz in (-1, 1):
            s += place([cyl("mixer_screw", 0.0018, 0.0008, (fx * (mw / 2 - 0.007), mh + 0.0008, fz * (md / 2 - 0.007)), silver, G, 8)], Mm)
    # 3 the headphone stand (baked) and the headphones on it (prop_headphones; origin = the band's top centre)
    hx, hz = 0.50, 0.08  # 4 cm right of desks.md: clear of the kit's mouse pad (its right edge at x 0.425)
    st = plastic("#1a1b1f", 0.5, 0.3, 0.05, "hp_stand")
    s += [lathe("hp_base", [(0, 0), (0.048, 0), (0.05, 0.003), (0.046, 0.008), (0.012, 0.01), (0, 0.01)], (hx, h, hz), st, G, seg=24),
          cyl("hp_pole", 0.0055, 0.2, (hx, h + 0.11, hz), st, G, 10)]
    s.append(cyl("hp_saddle", 0.008, 0.06, (hx, h + 0.21, hz), st, G, 12, axis="z", bev=0.002))  # the band rests on it
    band_m = plastic("#1c1d22", 0.5, 0.3, 0.05, "hp_band")
    pad_m = plastic("#2e3036", 0.95, 0, 0.5, "hp_pad")
    cup_m = plastic("#202227", 0.5, 0.2, 0.05, "hp_cup")
    R = 0.085
    arc = [(R * math.sin(a), -R * (1 - math.cos(a)), 0.0) for a in [math.radians(d) for d in range(-90, 91, 15)]]
    hp = [rail("hp_band", arc, 0.005, band_m, G),
          rail("hp_pad", arc[3:-3], 0.009, pad_m, G)]
    for c in hp:
        c.data.resolution_u, c.data.bevel_resolution = 2, 1
    for sx in (-1, 1):
        hp += [box("hp_yoke", (0.006, 0.05, 0.012), (sx * (R - 0.001), -R - 0.01, 0), band_m, G, bev=0.002, seg=1),  # #263: off the cup's face
               cyl("hp_cup", 0.045, 0.03, (sx * (R + 0.012), -R - 0.045, 0), cup_m, G, 24, axis="x", bev=0.003),
               place([torus("hp_cushion", 0.036, 0.011, (0, 0, 0), pad_m, G, axis="x", seg=24, rseg=6)], Mx((sx * (R - 0.006), -R - 0.045, 0)))[0]]
    hp.append(spring("hp_cable", (-(R + 0.03), -R - 0.07, 0.0), (-(R + 0.03), -R - 0.2, 0.01), 0.005, 9, band_m, G, wire=0.0012, per_turn=6))
    P.append(("prop_headphones", hp, Mx((hx, h + 0.21 + 0.008 + 0.009, hz), ry=math.pi / 2)))
    # 4 three cassettes stacked flat behind left of the monitor: smoky case, two reel windows, a label, five screws
    case_m = plastic("#5f646d", 0.35, 0.1, 0.05, "cassette_case")
    label = plastic("#efe8d8", 0.85, 0, 0.1, "cassette_label")
    win = plastic("#1e2026", 0.3, 0, 0, "cassette_window")
    for k, (rot, col) in enumerate(((0.05, "#ffb347"), (-0.08, "#8f9bff"), (0.12, "#4df3ff"))):
        # #263: stacked 12.5 mm apart (the 0.4 mm label went into the case above), the stripe on the label and the
        # windows 0.4 mm over it (they sat 0.1-0.15 mm apart and z-fought)
        Mk = Mx((-0.30, h + 0.006 + k * 0.0125, -0.24), ry=rot)
        c = [box("cassette", (0.1, 0.012, 0.064), (0, 0, 0), case_m, G, bev=0.0015, seg=1),
             box("cassette_label", (0.08, 0.0004, 0.03), (0, 0.0062, -0.008), label, G),
             box("cassette_stripe", (0.08, 0.0004, 0.005), (0, 0.0066, -0.018), plastic(col, 0.6, 0, 0.1, f"cassette_{k}"), G)]
        for wx in (-0.022, 0.022):
            c.append(cyl("cassette_window", 0.009, 0.0008, (wx, 0.0064, 0.01), win, G, 14))
        for px_, pz_ in ((-0.045, -0.027), (0.045, -0.027), (-0.045, 0.027), (0.045, 0.027), (0.0, 0.027)):
            c.append(cyl("cassette_screw", 0.0014, 0.0005, (px_, 0.0062, pz_), silver, G, 6))
        s += place(c, Mk)
    # 5 the acoustic foam tile behind the monitor, standing on its base plate: 8 vertical wedges on a backing
    foam = plastic("#3a4452", 0.98, 0, 0.6, "foam")
    fw, fh = 0.3, 0.15
    Mf = Mx((0.0, h + 0.008, -0.287))
    bm = bmesh.new()
    for k in range(8):
        x0, x1 = -fw / 2 + k * fw / 8, -fw / 2 + (k + 1) * fw / 8
        xm = (x0 + x1) / 2
        prof = [(x0, 0.0), (xm, 0.02), (x1, 0.0)]  # (x, z out toward the seat)
        lo = [bm.verts.new(W(x, 0.0, z)) for x, z in prof]
        hi = [bm.verts.new(W(x, fh, z)) for x, z in prof]
        for a in range(2):
            bm.faces.new((lo[a], lo[a + 1], hi[a + 1], hi[a]))
        bm.faces.new((hi[0], hi[1], hi[2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    s += place([mesh_obj("foam_wedges", bm, foam, G), box("foam_back", (fw, fh, 0.01), (0, fh / 2, -0.005), foam, G)], Mf)
    return s, L, P


SEATS = [seat_memo, seat_mesh, seat_hue, seat_loop, seat_echo]


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
LIB_ROWS = (1, 2, 3)  # #280 (user, room-280.md 9.2): three recent projects, one full shelf each; r 0..2 = shelves 1 . 2 . 3
LIB_N = 21  # a full shelf (was 10, then one shelf of 3 x 7)
LIB_GROUP = LIB_N  # one project per shelf: no dividers
SHELFBOOK_ROWS = ((1, 3), (3, 2))  # #280: the five books to take, on the second bookcase (shelf_2), right ends of shelves 1 and 3
BINDER = (0.045, 0.30, 0.26)  # spine width, height, depth
BINDER_GAP = 0.004
LABEL = (0.035, 0.07)  # spine label window = one 64 x 128 px cell of the shared "spines" canvas
SPINES = {"canvas": "spines", "grid": [LIB_N, len(LIB_ROWS)], "px": [64 * LIB_N, 128 * len(LIB_ROWS)]}  # one 64 x 128 cell per label
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
        # the project's name plate on the shelf's front lip, in the middle under its binders (the app writes the
        # name); #280 (room-280.md 9.2): one per shelf again, screen_shelf_r<r> (#67), 0.30 x 0.035
        x0, x1 = binder_x(0), binder_x(LIB_N - 1) + w
        plate = quad(f"screen_shelf_r{r}", 0.30, 0.035, screen_mat(f"shelf_plate_{r}", "#efe6d2", 0.25), G)
        plate = slot(apply_all(place(plate, Mx(((x0 + x1) / 2, 0.08 + s * 0.42 - 0.004, -HZ + 0.01 + SHELF_D + 0.0012)))[0]), 0.30, 0.035)
        out.append((plate, "screen"))
    return out


def library_statics(shelf_m):
    """baked: per binder shelf, a thin graphite divider between the groups (none since one project fills a shelf, #280;
    the old bookend and the books lying flat past it are gone)"""
    G = "wall"
    metal = plastic("#2a2c31", 0.35, 0.8, 0.03, "bookend")
    p = []
    for s in LIB_ROWS:
        y = shelf_top(s)
        for g_ in range(1, LIB_N // LIB_GROUP):
            k = g_ * LIB_GROUP  # the divider stands in the 12 mm gap before this group's first slot
            dx = binder_x(k) - 0.006
            p.append(box("shelf_divider", (0.004, 0.30, BINDER[2] + 0.02), (dx, y + 0.15 + 0.001, SPINE_Z - (BINDER[2] + 0.02) / 2 + 0.005), metal, G, bev=0.001, seg=1))
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
    # #234 / #388 (coder): the whiteboard's click box over its face (1.5 x 1.0 + a margin), on the board face, with the
    # back wall (it fades with it)
    hit("whiteboard", "whiteboard", Mx((WHITEBOARD_X, 1.5, -HZ + 0.04)), (1.6, 1.1, 0.1))["wall"] = "n"


# ================================================================ WALL ITEMS (atlas: wall_items)
def board_mat():
    """#280 3 (room-280.md 6.1): gloss white (roughness 0.25) with faint wiped streaks, about 5% darker, sideways"""
    m, nodes, links, b = new_mat("whiteboard")
    b.inputs["Roughness"].default_value = 0.25
    tc = nodes.new("ShaderNodeTexCoord")
    mp = nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.2, 1.0, 6.0)  # Blender z = web y: streaks along the board
    nz = nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 2.5
    nz.inputs["Detail"].default_value = 3
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position, ramp.color_ramp.elements[1].position = 0.52, 0.72
    ramp.color_ramp.elements[0].color = rgba("#f4f4f0")
    ramp.color_ramp.elements[1].color = rgba("#e6e7e2")
    links.new(tc.outputs["Object"], mp.inputs["Vector"])
    links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    links.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    return m


def build_whiteboard(G, z):
    """#280 3 (room-280.md 6.1): the board (1.5 x 1.0, its front at z + 0.02 = the surface) in an aluminium frame of
    2.2 cm bars with rounded front edges, grey corner caps, a full-width tray with end caps (its floor at 0.9975, the
    markers' home), two wall brackets hooked over the top bar"""
    frame_m = plastic("#b9bec7", 0.3, 0.8, 0.03, "wb_alu")
    cap_m = plastic("#8b8f96", 0.5, 0, 0.05, "wb_cap")
    x0, yc, w, h = WHITEBOARD_X, 1.5, 1.5, 1.0
    fw, fd = 0.022, 0.026  # the bar section: face width, depth (z .. z + 0.026; the board 6 mm in)
    zf = z + fd / 2
    ox, oy = w / 2 + fw, h / 2 + fw  # outer half sizes
    p = [box("wb", (w + 0.01, h + 0.01, 0.012), (x0, yc, z + 0.014), board_mat(), G)]
    for sy in (-1, 1):  # top and bottom bars run the full width; the sides sit between them (caps hide the joins)
        p.append(box("wb_frame", (2 * ox, fw, fd), (x0, yc + sy * (h / 2 + fw / 2), zf), frame_m, G, bev=0.006, seg=3))
    for sx in (-1, 1):
        p.append(box("wb_frame", (fw, h - 0.004, fd), (x0 + sx * (w / 2 + fw / 2), yc, zf), frame_m, G, bev=0.006, seg=3))
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.append(box("wb_corner", (0.03, 0.03, 0.03), (x0 + sx * (ox - 0.013), yc + sy * (oy - 0.013), z + 0.0145), cap_m, G, bev=0.006, seg=2))
    # the tray: a floor from 2 mm inside the bottom bar out to 7 cm, a front lip, end caps
    t0, t1 = z + fd - 0.002, z + 0.07
    tl = 2 * ox - 0.04
    p += [box("wb_tray", (tl, 0.006, t1 - t0), (x0, 0.9945, (t0 + t1) / 2), frame_m, G, bev=0.0015, seg=1),
          box("wb_tray_lip", (tl, 0.02, 0.005), (x0, 1.0005, t1 - 0.002), frame_m, G, bev=0.0015, seg=2)]
    for sx in (-1, 1):
        p.append(box("wb_tray_end", (0.008, 0.026, t1 - t0 + 0.004), (x0 + sx * (tl / 2 + 0.0035), 0.999, (t0 + t1) / 2), cap_m, G, bev=0.002, seg=2))
    # two brackets: a wall plate behind, a hook over the top bar and a short lip down its front
    yt = yc + oy
    for bx in (x0 - 0.5, x0 + 0.5):
        p += [box("wb_bracket", (0.04, 0.06, 0.004), (bx, yt - 0.015, z - 0.0165), cap_m, G, bev=0.001, seg=1),
              box("wb_bracket", (0.04, 0.004, fd + 0.022), (bx, yt + 0.0025, z + (fd - 0.013) / 2), cap_m, G, bev=0.001, seg=1),
              box("wb_bracket", (0.04, 0.014, 0.004), (bx, yt - 0.005, z + fd + 0.0025), cap_m, G, bev=0.001, seg=1)]
    return p


def pin_hole_mat(base_hex_unused, rows):
    """#280 3 (room-280.md 6.2): the bookshelf wood with two rows of shelf-pin holes (4.4 mm, 32 mm apart) printed by
    the shader on the sides' inner faces. rows = the two web z of the hole lines (front and back)"""
    m, nodes, links, b = new_mat("shelf_wood_holes")
    b.inputs["Roughness"].default_value = 0.6
    bump(nodes, links, b, 900, 0.4, 0.0002)  # as plastic(..., grain 0.4): the same wood as shelf_wood
    geo = nodes.new("ShaderNodeNewGeometry")
    sep = nodes.new("ShaderNodeSeparateXYZ")
    links.new(geo.outputs["Position"], sep.inputs["Vector"])

    def op(kind, a, b_=None):
        n = nodes.new("ShaderNodeMath")
        n.operation = kind
        for i, v in enumerate((a, b_)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                n.inputs[i].default_value = v
            else:
                links.new(v, n.inputs[i])
        return n.outputs[0]

    dy = op("MULTIPLY", op("SUBTRACT", op("FRACT", op("DIVIDE", sep.outputs["Z"], 0.032)), 0.5), 0.032)  # web y = Blender z
    dz = op("MINIMUM", *[op("ABSOLUTE", op("ADD", sep.outputs["Y"], z_)) for z_ in rows])  # web z = -Blender y
    mask = op("LESS_THAN", op("ADD", op("MULTIPLY", dy, dy), op("MULTIPLY", dz, dz)), 0.0022 ** 2)
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "CONSTANT"
    ramp.color_ramp.elements[0].color = rgba("#6b4a30")
    ramp.color_ramp.elements[1].position = 0.5
    ramp.color_ramp.elements[1].color = rgba("#24180f")
    links.new(mask, ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    return m


BRNG = random.Random(2806)  # #280 3: the decorative books' spine marks (their own stream: RNG stays as it was)


def spine_marks(cx, y0, bw, bh, zf, col):
    """#280 3 (room-280.md 6.2): on a decorative book's spine: a dark headband at the top, a colour band, a title line"""
    light = col in ("#ecf0f1", "#d4a017")
    ink = plastic("#2c3e50" if light else "#efe6d2", 0.7, 0, 0.05, "spine_title_dark" if light else "spine_title")
    band = plastic(BRNG.choice(("#c9a465", "#efe6d2", "#2b2622")), 0.6, 0.3 if not light else 0, 0.05, "spine_band")
    head = plastic("#2b2622", 0.8, 0, 0.1, "spine_head")
    out = []
    for nm, w_, h_, y_, m in (("spine_head", bw * 0.9, 0.004, y0 + bh - 0.005, head),
                              ("spine_band", bw * 0.9, 0.01, y0 + bh * BRNG.uniform(0.7, 0.8), band),
                              ("spine_title", bw * 0.28, bh * 0.3, y0 + bh * 0.42, ink)):
        q = quad(nm, w_, h_, m, "wall")
        q.location = W(cx, y_, zf + 0.0004)
        out.append(q)
    return out


B2RNG = random.Random(2807)  # #280 3: the second bookcase's contents (its own stream)
SHELF2_X, SHELF2_W = 4.41, 0.654  # #280 3 (room-280.md 9.3): 0.70 over the mouldings, 4 cm off the east wall and the first bookcase


def build_bookcase2(shelf_m):
    """#280 3 (room-280.md 9.3): a narrow second bookcase in the back wall's east corner, the first one's build
    (sides, top, 2 cm moulding, a framed back, five shelves at the same heights, the same wood). No live nodes:
    two document boxes at the bottom, books, a few records, a small pothos with books, books and a lying stack"""
    G = "wall"
    sw, sh, sd = SHELF2_W, 2.1, SHELF_D
    sx, sz = SHELF2_X, -HZ + sd / 2 + 0.01
    p = [box("shelf2_l", (0.03, sh, sd), (sx - sw / 2, sh / 2, sz), shelf_m, G),
         box("shelf2_r", (0.03, sh, sd), (sx + sw / 2, sh / 2, sz), shelf_m, G),
         box("shelf2_top", (sw + 0.034, 0.03, sd + 0.004), (sx, sh, sz + 0.001), shelf_m, G),
         box("shelf2_moulding", (sw + 0.03 + 0.016, 0.02, 0.012), (sx, sh - 0.025, sz + sd / 2 + 0.002), shelf_m, G, bev=0.004, seg=2)]
    for s_ in (-1, 1):
        p.append(box("shelf2_moulding", (0.012, 0.02, sd - 0.004), (sx + s_ * (sw / 2 + 0.017), sh - 0.025, sz - 0.004), shelf_m, G, bev=0.004, seg=2))
    fw, bz = 0.06, -HZ + 0.016
    p += [box("shelf2_back", (fw - 0.015, sh, 0.012), (sx - sw / 2 + 0.015 + (fw - 0.015) / 2, sh / 2, bz), shelf_m, G),
          box("shelf2_back", (fw - 0.015, sh, 0.012), (sx + sw / 2 - 0.015 - (fw - 0.015) / 2, sh / 2, bz), shelf_m, G),
          box("shelf2_back", (sw - 2 * fw, fw, 0.012), (sx, fw / 2, bz), shelf_m, G),
          box("shelf2_back", (sw - 2 * fw, fw, 0.012), (sx, sh - fw / 2, bz), shelf_m, G),
          box("shelf2_back_panel", (sw - 2 * fw, sh - 2 * fw, 0.007), (sx, sh / 2, bz + 0.0025), shelf_m, G)]
    for s in range(5):
        p.append(box("shelf2_board", (sw - 0.03, 0.025, sd - 0.014), (sx, 0.08 + s * 0.42, sz + 0.005), shelf_m, G, bev=0.003, seg=1))
    xl, xr = sx - sw / 2 + 0.015 + 0.006, sx + sw / 2 - 0.015 - 0.006
    zb_ = sz + 0.02  # the books' centre line (as the first bookcase's)
    cols = ["#c0392b", "#2c3e50", "#d4a017", "#16a085", "#8e44ad", "#e67e22", "#ecf0f1", "#34495e", "#7f8c8d"]

    def books(s, x0, x1):
        out, x = [], x0
        while x < x1 - 0.03:
            bw, bh, bd = B2RNG.uniform(0.025, 0.055), B2RNG.uniform(0.22, 0.33), B2RNG.uniform(0.2, 0.27)
            if x + bw > x1:
                break
            col = B2RNG.choice(cols)
            out.append(box("book", (bw, bh, bd), (x + bw / 2, shelf_top(s) + bh / 2, zb_), plastic(col, 0.7, 0, 0.2, "book"), G))
            out += spine_marks(x + bw / 2, shelf_top(s), bw, bh, zb_ + bd / 2, col)
            x += bw + 0.003
        return out

    # 0: two document boxes (kraft, a cream label, a hand hole)
    kraft = plastic("#b8946a", 0.85, 0, 0.4, "doc_box")
    hole = plastic("#3a2e22", 0.9, 0, 0.0, "doc_box_hole")
    bwid = (xr - xl - 0.01) / 2
    for k in range(2):
        cx = xl + bwid / 2 + k * (bwid + 0.01)
        zf_ = sz + sd / 2 - 0.03  # the boxes' front, 2 cm behind the shelf's lip
        p += [box("doc_box", (bwid, 0.25, 0.29), (cx, shelf_top(0) + 0.125 + 0.0005, zf_ - 0.145), kraft, G, bev=0.004, seg=1),
              box("doc_box_label", (0.12, 0.05, 0.001), (cx, shelf_top(0) + 0.1, zf_ + 0.0005), plastic("#efe6d2", 0.8, 0, 0.05, "doc_box_label"), G),
              box("doc_box_hole", (0.07, 0.02, 0.001), (cx, shelf_top(0) + 0.2, zf_ + 0.0005), hole, G, bev=0.0004, seg=1)]
    # 1: books
    p += books(1, xl, xr - 0.135)  # #280: the three books to take stand at the right end (prop_shelfbook_0..2)
    # 2: a few records standing at the left, books at the right
    rec_cols = ["#3b4a5a", "#6b3f3a", "#4a5a3f", "#5a4a6b", "#7a6a4a", "#2f3a40", "#8a5a4a", "#4a6a6a"]
    x = xl
    for _ in range(14):
        col = B2RNG.choice(rec_cols)
        p.append(box("record_spine", (0.004, 0.31, 0.30), (x + 0.002, shelf_top(2) + 0.155, zb_), plastic(col, 0.75, 0, 0.2, f"spine_{col[1:]}"), G))
        x += 0.004 + B2RNG.uniform(0.0005, 0.002)
    p += books(2, x + 0.04, xr)
    # 3: a small pothos in the middle (its own plant stream), books either side
    vine = pothos("vine2", sx, shelf_top(3), sz - 0.03, sz + sd / 2, G)  # in the middle: its leaves stay inside the sides
    p += plant_tris("vine2", vine)
    p += books(3, xl, sx - 0.13) + books(3, sx + 0.13, xr - 0.09)  # #280: prop_shelfbook_3 . 4 at the right end
    # 4: books, then three lying flat at the right
    p += books(4, xl, xr - 0.24)
    yy = shelf_top(4) + 0.0005
    for k in range(3):
        bt = B2RNG.uniform(0.03, 0.045)
        p.append(box("book", (0.21, bt, 0.17), (xr - 0.115 + B2RNG.uniform(-0.01, 0.01), yy + bt / 2, zb_ - 0.02),
                     plastic(B2RNG.choice(cols), 0.7, 0, 0.2, "book"), G, rot_y=B2RNG.uniform(-0.08, 0.08)))
        yy += bt + 0.0005
    return p


def build_wall_items():
    G = "wall"
    z = -HZ + 0.02
    cork = plastic("#a87b4f", 0.95, 0, 0.8, "cork")
    p = build_whiteboard(G, z)
    # the cards and the visitor notes are the app's (surface_whiteboard / surface_bulletin): the boards stay empty
    # the markers on the tray are props (prop_marker_<k>, #164: MEMO writes with them)
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
    holes = pin_hole_mat(shelf_m, (sz + sd / 2 - 0.045, sz - sd / 2 + 0.06))
    sides = [box("shelf_l", (0.03, sh, sd), (sx - sw / 2, sh / 2, sz), shelf_m, G),
             box("shelf_r", (0.03, sh, sd), (sx + sw / 2, sh / 2, sz), shelf_m, G)]
    for o, s_ in zip(sides, (1, -1)):  # #280 3: the pin holes on the inner faces only
        o.data.materials.append(holes)
        for f in o.data.polygons:
            if f.normal.x * s_ > 0.9:
                f.material_index = 1
    p += sides + [
        # #263: the top overhangs the sides by 2 mm all round (its faces sat on theirs and z-fought)
        box("shelf_top", (sw + 0.034, 0.03, sd + 0.004), (sx, sh, sz + 0.001), shelf_m, G)]
    # #280 3 (room-280.md 6.2): a 2 cm crown moulding under the top, round the front and both sides, 8 mm proud
    zf_ = sz + sd / 2
    p += [box("shelf_moulding", (sw + 0.03 + 0.016, 0.02, 0.012), (sx, sh - 0.025, zf_ + 0.002), shelf_m, G, bev=0.004, seg=2)]
    for s_ in (-1, 1):
        p.append(box("shelf_moulding", (0.012, 0.02, sd - 0.004), (sx + s_ * (sw / 2 + 0.015 + 0.002), sh - 0.025, sz - 0.004), shelf_m, G, bev=0.004, seg=2))
    # the back reads as a furniture back from behind (designer, #109: when the n wall is lowered the app fades the
    # shelf to 25% and this side faces the camera): a 6 cm frame and a panel set 5 mm in, not one flat board
    fw, bz = 0.06, -HZ + 0.016
    # #263: the frame starts at the sides' inner faces (its back face overlapped theirs by 1.5 cm)
    p += [box("shelf_back_l", (fw - 0.015, sh, 0.012), (sx - sw / 2 + 0.015 + (fw - 0.015) / 2, sh / 2, bz), shelf_m, G),
          box("shelf_back_r", (fw - 0.015, sh, 0.012), (sx + sw / 2 - 0.015 - (fw - 0.015) / 2, sh / 2, bz), shelf_m, G),
          box("shelf_back_b", (sw - 2 * fw, fw, 0.012), (sx, fw / 2, bz), shelf_m, G),
          box("shelf_back_t", (sw - 2 * fw, fw, 0.012), (sx, sh - fw / 2, bz), shelf_m, G),
          # flush with the frame at the front (a 1 mm step there read as a black dashed seam, designer #211)
          box("shelf_back_panel", (sw - 2 * fw, sh - 2 * fw, 0.007), (sx, sh / 2, bz + 0.0025), shelf_m, G)]
    book_cols = ["#c0392b", "#2c3e50", "#d4a017", "#16a085", "#8e44ad", "#e67e22", "#ecf0f1", "#34495e", "#7f8c8d"]
    for s in range(5):
        y0 = 0.08 + s * 0.42
        # #263: between the sides and in front of the back frame, 2 mm back from the front (it shared their faces)
        p.append(box("shelf", (sw - 0.03, 0.025, sd - 0.014), (sx, y0, sz + 0.005), shelf_m, G, bev=0.003, seg=1))  # #280 3: eased edges
        x = sx - sw / 2 + 0.03
        while x < sx + sw / 2 - 0.08:
            if RNG.random() < 0.08:
                x += RNG.uniform(0.05, 0.12)
                continue
            bw = RNG.uniform(0.025, 0.06)
            bh = RNG.uniform(0.22, 0.34)
            bd = RNG.uniform(0.2, 0.28)
            col = RNG.choice(book_cols)  # drawn even where the binders stand: the rest of the room keeps its randomness
            book_room = SHELF_X + SHELF_W / 2 - 0.015  # #280: shelves 1 . 2 . 3 are all binders; the books to take moved to shelf_2
            if s not in LIB_ROWS and x + bw <= book_room:
                p.append(box("book", (bw, bh, bd), (x + bw / 2, y0 + 0.0125 + bh / 2, sz + 0.02), plastic(col, 0.7, 0, 0.2, "book"), G))
                p += spine_marks(x + bw / 2, y0 + 0.0125, bw, bh, sz + 0.02 + bd / 2, col)
            x += bw + 0.003
    p += library_statics(shelf_m)
    # #126: a pothos on top, over the right half (the decorative top row), hanging at most 0.35 m
    vine = pothos("vine", sx + 0.25, sh + 0.015, sz - 0.04, sz + sd / 2, G)
    leaf_tips("vine", [o for o in vine if "pot" not in o.name and "soil" not in o.name], sx + 0.25, sz - 0.04, hang=True)
    p += plant_tris("vine", vine)
    fp("shelf", p[mark:], "floor", "n")  # stands on the floor against the back wall
    mark_b = len(p)
    p += build_bookcase2(shelf_m)  # #280 3: the second, narrow one in the corner
    fp("shelf_2", p[mark_b:], "floor", "n")
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
    shelf = join("shelf", p[mark:mark_b])  # stands on the floor: no wall (#115). Tall with its back to n: backTo
    shelf["backTo"] = "n"  # the app fades it to 25% when the n wall is lowered (its back faces the camera)
    face = join("wallclock", p[mark2:])
    face["wall"] = "w"
    shelf2 = join("shelf_2", p[mark_b:mark2])
    shelf2["backTo"] = "n"
    return [boards, shelf, shelf2, face]


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


def leaf_tips(name, objs, cx, cz, n=3, hang=False):
    """#185 (watering.md): empties <plant>_tip_0..n-1 at leaf tips, one per 360/n deg sector round the pot axis - the
    vertex that reaches furthest out and up (hang: out and down, the pothos). extras tip_of = the plant"""
    bpy.context.view_layer.update()
    dg = bpy.context.evaluated_depsgraph_get()
    best = [None] * n
    for o in objs:
        if o.type not in ("MESH", "CURVE"):
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            p = o.matrix_world @ v.co
            x, y, z = p.x, p.z, -p.y  # web
            r = math.hypot(x - cx, z - cz)
            score = r + (-0.6 * y if hang else 0.6 * y)
            k = int(((math.atan2(z - cz, x - cx) + math.pi) / (2 * math.pi)) * n) % n
            if best[k] is None or score > best[k][0]:
                best[k] = (score, (x, y, z))
        ev.to_mesh_clear()
    for k, b in enumerate(b for b in best if b):
        e = bpy.data.objects.new(f"{name}_tip_{k}", None)
        coll("export").objects.link(e)
        e.matrix_world = Mx(b[1])
        e["tip_of"] = name
        NODES.append({"obj": e, "tip_of": name})


def pot3(name, x, z, y0, r_top, r_bot, h, body, group, saucer=False, pebbles=4, seg=24, foot=None, chips=0, soil_node=True):
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
    # #184: where watering lands (world-built pots only: soil_node): an empty at the soil's centre, extras r = its radius
    if soil_node:
        e = bpy.data.objects.new(f"soil_{name}", None)
        coll("export").objects.link(e)
        e.matrix_world = Mx((x, soil_y + 0.003, z))
        e["soil_of"], e["r"] = name, round(r_top - 0.006, 4)
        NODES.append({"obj": e, "soil": name})
    if foot:
        o.append(add_bevel(cyl(f"{name}_foot", r_bot, fy - y0, (x, (y0 + fy) / 2, z), foot, group, seg, r2=radius(fy) - 0.001), 0.002, seg=bseg))
    for k in range(pebbles):
        a, r = PRNG.uniform(0, 2 * math.pi), PRNG.uniform(0.2, 0.75) * (r_top - 0.02)
        o.append(sphere(f"{name}_pebble", PRNG.uniform(0.006, 0.011), (x + r * math.cos(a), soil_y + 0.005, z + r * math.sin(a)),
                        stone[k % 2], group, scale=(1.0, 0.6, 0.85), seg=6, rings=4))
    for k in range(chips):  # bark chips: flat, at odd angles on the soil
        a, r = PRNG.uniform(0, 2 * math.pi), PRNG.uniform(0.15, 0.8) * (r_top - 0.025)
        s = PRNG.uniform(0.7, 1.2)
        o.append(box(f"{name}_chip", (0.022 * s, 0.004, 0.012 * s), (x + r * math.cos(a), soil_y + 0.004 + 0.0004 * k, z + r * math.sin(a)),  # #263: tops 0.4 mm apart
                     bark[k % 2], group, rot_y=PRNG.uniform(0, math.pi)))
    if saucer:
        o.append(add_bevel(cyl(f"{name}_saucer", r_bot + 0.035, 0.02, (x, y0 - 0.01, z), foot or body, group, seg, r2=r_bot + 0.045), 0.002, seg=2))
    return o, soil_y


def camera_side(x, z):
    """the horizontal 'right' seen from the default camera at (x, z): leaves built across it face the camera"""
    c = Vector((8.5 - x, 0.0, 9.5 - z)).normalized()
    return UP.cross(c).normalized(), c


FIG_GREENS = ("#2f5a2e", "#5d8a4f", "#7fae55", "#a9c48a")  # top (leathery, a little gloss), underside, young top leaves (lime), veins


def fig_outline(rng):
    """a fiddle (violin) leaf in leaf units (#156, office-quality.md 0.5): narrow rounded base, a waist in the lower 40%,
    the upper two thirds broad and round, a blunt tip; length : width about 1.4; the edge in a gentle wave (3–5 mm on
    a 28 cm leaf). Midrib + 7 pairs of side veins curving up to the edge."""
    def half(u):
        w = 0.06 + 0.16 * math.sin(math.pi * min(1.0, u / 0.3) / 2) ** 0.8  # the base rounding out
        w -= 0.05 * math.exp(-((u - 0.36) / 0.11) ** 2)  # the waist
        w += 0.13 * math.exp(-((u - 0.72) / 0.19) ** 2)  # the broad top
        w *= min(1.0, (1.0 - u) / 0.12) ** 0.55  # the blunt rounded tip
        return max(0.0, w)
    ph = rng.uniform(0, 6.28)
    n = 28
    us = [0.02 + 0.98 * k / n for k in range(n + 1)]
    right = [Vector((u, half(u) * (1 + 0.04 * math.sin(u * 31 + ph)))) for u in us]
    left = [Vector((u, -half(u) * (1 + 0.04 * math.sin(u * 29 + ph + 1.7)))) for u in us]
    outer = [Vector((0.0, 0.0))] + right[:-1] + [Vector((1.0, 0.0))] + list(reversed(left[:-1]))
    veins = [[Vector((0.02, 0.0)), Vector((0.95, 0.0))]]
    for k in range(7):
        u0 = 0.12 + 0.105 * k
        for sgn in (1, -1):
            u1 = min(0.95, u0 + 0.13)
            veins.append([Vector((u0, 0.0)), Vector((u1, sgn * half(u1) * 0.8))])
    return outer, [], veins


def fiddle_fig(name, x, z, group):
    """corner: fiddle-leaf fig 1.5 m in a glazed charcoal pot (38 cm) with an unglazed foot band on a saucer, pebbles
    and bark chips. #156 (user + designer, office-quality.md 0.5): a grey-brown trunk bare to 45% with leaf-scar
    rings, splitting at about half height into three (the leader + two branches 30–45° out); on each stem's upper
    half the leaves alternate in a spiral (137.5°): young lime leaves near upright at the top, the big leaves (25–30
    cm) 30–60° up in the middle, the lower ones level or a little down; a pointed terminal bud on every tip. Violin
    leaves on 2–4 cm petioles, cupped up, the tip dipping. Leaves toward the corner walls short and steep."""
    PRNG.seed(f"156:{name}")  # each plant its own stream: changing one leaves the others as they are
    pot, sy = pot3(name, x, z, 0.02, 0.19, 0.15, 0.36, plastic("#33363d", 0.25, 0, 0.05, "pot_charcoal_glaze"), group,
                   saucer=True, pebbles=5, chips=8, foot=plastic("#8e8478", 0.9, 0, 0.3, "pot_bisque_dark"))
    bark = plastic("#6b5e52", 0.85, 0, 0.5, "fig_bark")
    scar = plastic("#776a5d", 0.85, 0, 0.4, "fig_scar")  # the bark +10% (designer: not a white tape)
    bud_m = plastic("#a7b97a", 0.7, 0, 0.3, "fig_bud")
    stalk = plastic("#5d8a4f", 0.7, 0, 0.2, "fig_petiole")
    H = 1.5
    fork = Vector((x - 0.01, 0.74, z - 0.005))  # about half height
    room = Vector((-0.3, 0.0, -1.0)).normalized()  # into the room, away from the corner walls and the floor lamp (−x)
    walls = Vector((1.0, 0.0, 1.0)).normalized()  # toward the two walls (+x, +z)

    def branch(az, spread, length):
        d = Vector((math.cos(az), 0.0, math.sin(az)))
        a = math.radians(spread)
        mid = fork + (UP * math.cos(a * 0.6) + d * math.sin(a * 0.6)) * (length * 0.5)
        return [fork, mid, mid + (UP * math.cos(a) + d * math.sin(a)) * (length * 0.5)]

    leader = [Vector((x, sy, z)), Vector((x - 0.001, sy + 0.06, z)), fork, Vector((x - 0.03, 1.12, z - 0.03)), Vector((x - 0.04, H, z - 0.05))]
    ra = math.atan2(room.z, room.x)
    br1 = branch(ra - 0.55, 40, 0.62)
    br2 = branch(ra + 0.75, 34, 0.56)
    def tapered(nm, path, radii):
        """a stem tapering along its points (radii in m; designer: the trunk 4.6 cm flaring at the soil, 4.2 cm, 3.0 cm
        at the fork, 1.4 cm at the top; branches 2.0 -> 1.1 cm)"""
        o = rail(nm, [tuple(p) for p in path], max(radii), bark, group)
        o.data.resolution_u, o.data.bevel_resolution = 5, 2
        for bp, r in zip(o.data.splines[0].bezier_points, radii):
            bp.radius = r / max(radii)
        return o

    stems = [tapered(f"{name}_trunk", leader, (0.023, 0.021, 0.015, 0.011, 0.007)),
             tapered(f"{name}_branch", br1, (0.01, 0.0078, 0.0055)),  # 0.65 x the fork
             tapered(f"{name}_branch", br2, (0.0098, 0.0076, 0.0055))]
    for k in range(6):  # leaf scars: fine rings a shade lighter than the bark, just proud of it
        y = sy + 0.08 + (fork.y - sy - 0.12) * (k + PRNG.uniform(0.1, 0.6)) / 6
        f = (y - sy) / (fork.y - sy)
        stems.append(torus(f"{name}_scar", 0.021 - 0.006 * f, 0.0008, (x - 0.01 * f, y, z - 0.005 * f), scar, group, seg=16, rseg=4))
    fol = Foliage(f"{name}_leaves", colors=FIG_GREENS, under=(1, 1, 2, 3))
    fol.mats[0] = plastic(FIG_GREENS[0], 0.6, 0, 0.1, "fig_leaf_top")  # a little gloss (leathery)
    # vein colours (designer #210): a quiet step lighter than the leaf, the midrib a little more (not a variegated leaf)
    fol.vein = (plastic("#86ad6e", 0.85, 0, 0.1, "vein_fig_mid"), plastic("#6f9a5c", 0.85, 0, 0.1, "vein_fig_side"))
    fol.vein_fol = Foliage(f"{name}_veins", colors=(), under=())
    golden = math.radians(137.5)

    def at_path(path, u):
        seg = min(int(u * (len(path) - 1)), len(path) - 2)
        f = u * (len(path) - 1) - seg
        return path[seg].lerp(path[seg + 1], f), (path[seg + 1] - path[seg]).normalized()

    # (stem, leaves, where the leafy part starts along the path)
    for path, count, u0 in ((leader[2:], 15, 0.42), (br1, 15, 0.45), (br2, 14, 0.45)):  # the leader from the fork
        phi = PRNG.uniform(0, 6.28)
        for k in range(count):
            t = (k + PRNG.uniform(0.2, 0.8)) / count  # 0 = the lowest leaf on this stem, 1 = the tip
            at, along = at_path(path, u0 + (0.97 - u0) * t)
            phi += golden
            out = Vector((math.cos(phi), 0.0, math.sin(phi)))
            out = (out + room * 0.5).normalized()
            wall = max(0.0, out.dot(walls))  # 1 = straight at the corner
            if t > 0.76:  # top: young leaves, lime, near upright
                size, up = PRNG.uniform(0.12, 0.18), PRNG.uniform(60, 88)
                mi = 2
            elif t > 0.33:  # middle: the big leaves, 30–60° up
                size, up = PRNG.uniform(0.25, 0.3), PRNG.uniform(30, 60)
                mi = 0
            else:  # lower: level to 15° down
                size, up = PRNG.uniform(0.22, 0.28), PRNG.uniform(-15, 5)
                mi = 0
            size *= (1.0 - 0.35 * wall) * (1.0 - 0.3 * max(0.0, out.x))  # toward the walls (the e wall is the nearer): shorter
            up = up + (90 - up) * 0.5 * wall  # and steeper
            plen = PRNG.uniform(0.02, 0.04)
            pa = math.radians(PRNG.uniform(40, 60))  # the petiole leaves the stem at 40–60°
            base = at + (along * math.cos(pa) + out * math.sin(pa)) * plen
            stems.append(petiole(f"{name}_petiole", at, base, stalk, group))
            laid_leaf(fol, base, out, -up, size, mi, fig_outline(PRNG), fold=PRNG.uniform(10, 15), droop=PRNG.uniform(8, 16),
                      curve=0.3, sub=0.12, veins_w=((0.003, 0.003, 4), (0.002, 0.002, 2)))
    for path in (leader, br1, br2):  # the terminal bud: a pointed sheath (stipule) on every tip
        tip = path[-1]
        d = (path[-1] - path[-2]).normalized()
        stems.append(segment(f"{name}_bud", tuple(tip), tuple(tip + d * PRNG.uniform(0.03, 0.04)), 0.006, bud_m, group, verts=8, r2=0.0008))
    leaves = fol.obj(group)
    for p in leaves.data.polygons:
        p.use_smooth = True
    veins = fol.vein_fol.obj(group)
    veins["vein_node"] = True
    return pot + stems + [leaves, veins]


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


MONSTERA_GREENS = ("#3f6e41", "#5a8a55", "#9ccc6e", "#7aa56a")  # top, underside, young leaf / shoot (lime), veins


def heart_r(th):
    """the monstera outline (#156, designer's sketch): radius from (0.42, 0) in leaf units (length 1) at angle th
    (0 = the tip, pi = the petiole notch). A heart, length : width about 1.15, base lobes rounding back past the
    notch, which dips in where the petiole joins."""
    pts = [(0, 0.58), (30, 0.565), (60, 0.51), (90, 0.45), (120, 0.455), (145, 0.475), (162, 0.445), (172, 0.4),
           (177, 0.37), (180, 0.4)]
    d = math.degrees(th)
    for (a0, r0), (a1, r1) in zip(pts, pts[1:]):
        if d <= a1:
            f = (d - a0) / (a1 - a0)
            f = f * f * (3 - 2 * f)
            return r0 + (r1 - r0) * f
    return pts[-1][1]


def leaf_outline(splits, holes, rng):
    """2D outline of one leaf in leaf units: u along the midrib (0 = the petiole notch, 1 = the tip), v across.
    Returns (outer loop, hole loops, vein polylines). Each side gets `splits` cuts: narrow gaps (2.5% of the leaf
    width, rounded inner end) from the edge toward the midrib along the side-vein direction, 50–85% deep; the lobe
    corners at a cut's mouth are rounded. holes: a row of long ellipses (3:1) beside the midrib, along the veins."""
    C = Vector((0.42, 0.0))
    W = 2 * heart_r(math.pi / 2)
    gap = 0.025 * W
    sides = {}
    veins = [[Vector((0.02, 0.0)), Vector((0.96, 0.0))]]  # the midrib
    hole_loops = []
    for sgn in (1, -1):
        ths = sorted(math.radians(18 + 128 * (j + rng.uniform(0.3, 0.7)) / splits) for j in range(splits)) if splits else []
        depth = [rng.uniform(0.5, 0.85) for _ in ths]

        def edge(th):
            r = heart_r(th)
            for tk in ths:  # round each lobe's corner at a cut's mouth
                dd = abs(th - tk)
                if dd < 0.16:
                    r *= 1 - 0.07 * (1 - dd / 0.16) ** 2
            return C + Vector((math.cos(th), sgn * math.sin(th) * 0.94)) * r  # length : width about 1.15

        loop = []
        steps = 72
        cut_at = {}
        for k in range(steps + 1):  # base notch (pi) to the tip (0)
            th = math.pi * (1 - k / steps)
            nxt = [i for i, tk in enumerate(ths) if abs(th - tk) < math.pi / steps / 2]
            if nxt:
                cut_at[nxt[0]] = len(loop)
            loop.append(edge(th))
        # insert the cuts, from the tip end back so indices hold
        for i in sorted(cut_at, key=lambda i: -cut_at[i]):
            j = cut_at[i]
            E = edge(ths[i])
            M = Vector((max(0.05, E.x - abs(E.y) * 0.75), 0.0))  # where its side vein leaves the midrib
            ax = (M - E).normalized()
            nrm = Vector((-ax.y, ax.x))
            inner = E + (M - E) * depth[i]
            # drop the edge samples inside the gap's mouth
            mouth = [k for k in range(max(0, j - 2), min(len(loop), j + 3)) if (loop[k] - E).length < gap * 0.9]
            lo, hi = (min(mouth), max(mouth)) if mouth else (j, j)
            before = loop[lo - 1] if lo > 0 else loop[0]
            # down the side the outline comes from (slightly wider at the edge), round the inner end, back up
            s0 = 1.0 if (E + nrm * gap - before).length < (E - nrm * gap - before).length else -1.0
            cut = []
            for f in (0.0, 0.5, 1.0):
                p = E.lerp(inner, f)
                cut.append(p + nrm * (gap * (0.6 - 0.15 * f) * s0))
            for a in range(1, 6):
                ang = math.pi * a / 6
                cut.append(inner + ax * (gap * 0.45 * math.sin(ang)) + nrm * (s0 * gap * 0.45 * math.cos(ang)))
            for f in (1.0, 0.5, 0.0):
                p = E.lerp(inner, f)
                cut.append(p - nrm * (gap * (0.6 - 0.15 * f) * s0))
            loop[lo:hi + 1] = cut
        sides[sgn] = loop
        # side veins: one per lobe, from the midrib to near the lobe's tip (the lobe's middle angle)
        bounds = [math.pi * 0.97] + sorted(ths, reverse=True) + [0.12]
        for a0, a1 in zip(bounds, bounds[1:]):
            th = (a0 + a1) / 2
            E = edge(th)
            M = Vector((max(0.04, E.x - abs(E.y) * 0.75), 0.0))
            veins.append([M, M.lerp(E, 0.86)])
        if holes and ths:
            for a0, a1 in zip(bounds[1:-1], bounds[2:]):  # between two cuts, by the midrib, along the vein
                th = (a0 + a1) / 2
                E = edge(th)
                M = Vector((max(0.04, E.x - abs(E.y) * 0.75), 0.0))
                ax = (E - M).normalized()
                c = M + ax * 0.13
                if c.x < 0.12 or c.x > 0.8:
                    continue
                nrm = Vector((-ax.y, ax.x))
                a, b = 0.045, 0.014  # 3:1
                hole_loops.append([c + ax * (a * math.cos(2 * math.pi * k / 12)) + nrm * (b * math.sin(2 * math.pi * k / 12)) for k in range(12)])
    outer = sides[1] + list(reversed(sides[-1]))[1:-1]
    return outer, hole_loops, veins


def orient(pts, ids, up):
    """a face winding that faces up (Foliage wants the front counter-clockwise)"""
    a, b, c = pts[ids[0]], pts[ids[1]], pts[ids[2]]
    return tuple(ids) if (b - a).cross(c - a).dot(up) >= 0 else tuple(reversed(ids))


def monstera_leaf(fol, attach, out, tilt, size, mi, splits=0, holes=False, fold=12.0, droop=20.0, rng=None):
    """a monstera leaf (#156): its 2D outline (leaf_outline) laid on a curved blade (laid_leaf); tilt = the blade's
    angle below the horizontal (the droop adds the last 8°)"""
    laid_leaf(fol, attach, out, max(15.0, tilt - 8.0), size, mi, leaf_outline(splits, holes, rng or PRNG), fold, droop)


def laid_leaf(fol, attach, out, tilt, size, mi, outline, fold=12.0, droop=20.0, curve=0.55, sub=0.07, veins_w=((0.003, 0.003, 8), (0.002, 0.002, 4))):
    """a leaf from a 2D outline (outer loop, hole loops, vein polylines; leaf units: u along the midrib from the
    petiole 0 .. tip 1, v across), filled and subdivided, laid on a curved blade (#156). It leaves the petiole at
    attach and runs outward (out, horizontal), `tilt` degrees below the horizontal (negative: above); V-folded along
    the midrib (fold °) and rounded across (curve); the tip third droops in a curve (droop °). Smooth normals. Light
    veins as strips just over the face: veins_w = (start width, end width in m, segments) for the midrib, then the rest."""
    out = Vector((out.x, 0.0, out.z)).normalized()
    side = UP.cross(out).normalized()
    a = math.radians(tilt)
    d0 = (out * math.cos(a) - UP * math.sin(a)).normalized()
    n0 = side.cross(d0).normalized()
    if n0.y < 0:
        side, n0 = -side, -n0
    # the midrib: straight, then the tip third bending back (droop), sampled finely
    N = 40
    cs, ds, ns = [attach.copy()], [d0], [n0]
    for k in range(1, N + 1):
        u = k / N
        f = max(0.0, (u - 0.6) / 0.4)
        ang = math.radians(droop) * f * f
        d = (d0 * math.cos(ang) - n0 * math.sin(ang)).normalized()
        cs.append(cs[-1] + d * size / N)
        ds.append(d)
        ns.append(side.cross(d).normalized())
    tf = math.tan(math.radians(fold))

    def P(u, v, lift=0.0):
        """leaf units -> world: along the midrib curve, across, up off the face"""
        if u <= 0:
            c, d, n = cs[0] + ds[0] * (u * size), ds[0], ns[0]
        else:
            x = min(u, 1.0) * N
            k = min(int(x), N - 1)
            f = x - k
            c, d, n = cs[k].lerp(cs[k + 1], f), ds[k].lerp(ds[k + 1], f).normalized(), ns[k].lerp(ns[k + 1], f).normalized()
        w = abs(v)
        h = w * tf - curve * w * w  # V at the midrib, rounding down toward the edge
        return c + side * (v * size) + n * (h * size + lift)

    outer, hole_loops, veins = outline
    # fill the outline in 2D, then add interior points so the blade can curve
    bm = bmesh.new()
    edges = []
    for loop in [outer] + hole_loops:
        vs = [bm.verts.new((p.x, p.y, 0.0)) for p in loop]
        edges += [bm.edges.new((vs[i], vs[(i + 1) % len(vs)])) for i in range(len(vs))]
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges)
    # the fold runs along the midrib (v = 0): cut the mesh there so the crease is an edge. A triangle spanning it
    # stood up to ~6 mm over the valley and buried the midrib and the inner half of every side vein (designer #210)
    long = [e for e in bm.edges if e.calc_length() > sub and not e.is_boundary]
    if long:
        bmesh.ops.subdivide_edges(bm, edges=long, cuts=1, use_grid_fill=False)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, 0, 0), plane_no=(0, 1, 0))
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    crease = [e for e in bm.edges if abs(e.verts[0].co.y) < 1e-7 and abs(e.verts[1].co.y) < 1e-7]
    bmesh.ops.beautify_fill(bm, faces=bm.faces[:], edges=[e for e in bm.edges if not e.is_boundary and e not in crease])
    bm.verts.index_update()
    pts = [P(v.co.x, v.co.y) for v in bm.verts]
    faces = [orient(pts, [v.index for v in f.verts], n0) for f in bm.faces]
    bm.free()
    fol.surface(pts, faces, [mi] * len(faces), n0)
    # veins: thin light strips 0.4 mm over the face
    vf_target = getattr(fol, "vein_fol", None) or fol  # #156: veins in their own node (baked at VEIN_DENSITY)
    vms = [vf_target.mat(m) for m in fol.vein] if hasattr(fol, "vein") else [mi, mi]  # (midrib, side veins)
    for k, (A, B) in enumerate(veins):
        w0, w1, segs = veins_w[0] if k == 0 else veins_w[1]
        vm = vms[0] if k == 0 else vms[1]
        if k:  # side veins stop 1 cm short of the edge (designer #210)
            B = B - (B - A).normalized() * min(0.01 / size, (B - A).length * 0.5)
        vp, vf = [], []
        for s in range(segs + 1):
            q = A.lerp(B, s / segs)
            t = (B - A).normalized()
            nn = Vector((-t.y, t.x)) * ((w0 + (w1 - w0) * s / segs) / size / 2)  # veins_w in m
            # 1 mm up (closer, the strips z-fought and broke up), midrib 3 mm, side veins 2 mm (designer #210); enough
            # segments to follow the folded blade (with two, the middle sank under it and the vein looked cut off)
            vp += [P(q.x + nn.x, q.y + nn.y, 0.001), P(q.x - nn.x, q.y - nn.y, 0.001)]
        for s in range(segs):
            i = 2 * s
            vf.append(orient(vp, [i, i + 2, i + 3, i + 1], n0))
        vf_target.surface(vp, vf, [vm] * len(vf), n0)


def monstera(name, x, z, group):
    """by the sofa: a monstera 0.9 m in terracotta (a darker water-stained foot band, pebbles, bark chips) on a
    saucer. #156 (designer, office-quality.md 0.4, the leaf sketch on #156): petioles rise straight from the soil and
    arc outward 25–40° in their top third (0.3–0.58 m, each its own, tapering) to a thicker knee; there the blade
    tips back, 30–55° below the horizontal, so the leaves look up and out, spread all round (2 face the camera).
    Heart-shaped leaves cut by narrow gaps into broad round-tipped lobes, a row of long holes by the midrib on the
    big ones, light veins. 3 large (0.3 m), 3 medium, 2 young (0.15 m, whole, lime) and a rolled new shoot."""
    PRNG.seed(f"156:{name}")  # each plant its own stream: changing one leaves the others as they are
    pot, sy = pot3(name, x, z, 0.02, 0.14, 0.11, 0.26, plastic("#b5654a", 0.85, 0, 0.3, "terracotta"), group, saucer=True,
                   pebbles=4, chips=6, foot=plastic("#96523d", 0.9, 0, 0.3, "terracotta_dark"))
    stem_m = plastic("#5b8a4c", 0.7, 0, 0.2, "petiole_monstera")
    side, cam = camera_side(x, z)
    cam_a = math.atan2(cam.z, cam.x)
    fol = Foliage(f"{name}_leaves", colors=MONSTERA_GREENS, under=(1, 1, 2, 3))
    fol.vein = (plastic("#7aa56a", 0.85, 0, 0.1, "vein_monstera_mid"), plastic("#5f8d55", 0.85, 0, 0.1, "vein_monstera_side"))
    fol.vein_fol = Foliage(f"{name}_veins", colors=(), under=())
    stems = []
    # (azimuth from the camera direction °, petiole length m, arc °, blade tilt °, size m, cuts, holes)
    LEAVES = [(-15, 0.52, 32, 38, 0.3, 6, True), (20, 0.44, 28, 45, 0.29, 7, True), (150, 0.58, 36, 34, 0.3, 5, True),
              (75, 0.4, 38, 50, 0.22, 5, False), (-95, 0.47, 30, 42, 0.23, 6, False), (-150, 0.36, 40, 52, 0.21, 5, False),
              (110, 0.3, 26, 30, 0.15, 0, False), (-55, 0.33, 30, 35, 0.15, 0, False)]
    for az, length, arc, tilt, size, cuts, holes in LEAVES:
        a = cam_a + math.radians(az + PRNG.uniform(-8, 8))
        out = Vector((math.cos(a), 0.0, math.sin(a)))
        f = abs(out.z)  # 1 = along the gap (z), 0 = toward the sofa / the side table (x)
        reach = 0.1 + 0.9 * f
        base = Vector((x, sy, z)) + out * 0.02 + side * PRNG.uniform(-0.015, 0.015)
        arc_r = math.radians(arc)
        # radial from the soil (designer: not a bamboo bundle): together for the first 5 cm, then each leans
        # 10–25° off the vertical toward its leaf; the top third arcs on from there
        # (in x, toward the sofa and the side table, the lean stays small: the gap is 0.45 m)
        lean = math.radians(PRNG.uniform(10, 25))
        lean_out = Vector((out.x * 0.3, 0.0, out.z))
        pts = [base, base + UP * 0.05]
        for frac in (0.3, 0.62):
            pts.append(pts[1] + (UP * math.cos(lean) + lean_out * math.sin(lean)) * ((length - 0.05) * frac))
        for k in (1, 2, 3):  # the top third arcs outward
            ak = lean + arc_r * k / 3
            pts.append(pts[-1] + (UP * math.cos(ak) + out * math.sin(ak) * reach) * (length * 0.38 / 3))
        r = 0.0075 * (size / 0.3) ** 0.5
        stem = rail(f"{name}_petiole", [tuple(q) for q in pts], r, stem_m, group)
        stem.data.resolution_u, stem.data.bevel_resolution = 6, 2
        for bp, rr in zip(stem.data.splines[0].bezier_points, (1.2, 1.1, 1.0, 0.92, 0.85, 0.8, 1.15)):  # tapering, a thicker knee
            bp.radius = rr
        stems.append(stem)
        young = size < 0.2
        monstera_leaf(fol, pts[-1], out, tilt + (1 - f) * 18, size * (0.52 + 0.48 * f), 2 if young else 0, splits=cuts,
                      holes=holes, fold=PRNG.uniform(10, 15), droop=PRNG.uniform(15, 25))
    # the new shoot: a rolled leaf, lime, standing up out of the middle on its own short petiole
    tip = Vector((x, sy + 0.32, z)) + cam * 0.01
    stems.append(lowrail(f"{name}_petiole", [(x, sy, z), (x, sy + 0.18, z), tuple(tip)], 0.005, stem_m, group))
    stems.append(segment(f"{name}_shoot", tuple(tip), tuple(tip + (UP + cam * 0.15).normalized() * 0.11), 0.012,
                         plastic(MONSTERA_GREENS[2], 0.8, 0, 0.2, "shoot"), group, verts=10, r2=0.002))
    leaves = fol.obj(group)
    for p in leaves.data.polygons:  # smooth shading across the curved blade (designer)
        p.use_smooth = True
    veins = fol.vein_fol.obj(group)
    veins["vein_node"] = True
    return pot + stems + [leaves, veins]


def echeveria(name, x, y, z, group):
    """HUE's desk: echeveria rosette in three tiers (8 + 6 + 4 fleshy leaves, 12 triangles a side) curling up, the
    centre lighter; small terracotta pot with pebbles"""
    PRNG.seed(f"126:{name}")  # each plant its own stream: changing one leaves the others as they are
    pot, sy = pot3(name, x, z, y, 0.04, 0.032, 0.05, plastic("#b5654a", 0.85, 0, 0.3, "terracotta"), group, pebbles=2, seg=10, soil_node=False,
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
PLANT_NODES = []  # (node, name): each floor plant is its own baked node in the lounge atlas
VEIN_NODES = []  # #156: the light vein strips of the monstera and the fig, baked at VEIN_DENSITY
VEIN_DENSITY = 4.0


# ================================================================ LOUNGE (atlas: lounge)
OMOK_NODES = []  # the omok board with its bowls: its own baked node in the lounge atlas at OMOK_DENSITY (1.2 mm lines)
OMOK_DENSITY = 3.0
OMOK = dict(n=15, cell=0.0257, board=0.42, top=0.77, stone_d=0.022, stone_h=0.008)
OMOK_BOWLS = {}  # "b" | "w" -> the grab point in the bowl (web): build_props puts prop_piece_a|b there
SRNG = random.Random(135)  # #135's own draws (the stone heaps)


def omok_mat(x0, z0, top):
    """light wood with the 15 x 15 grid drawn in the shader (world position): 1.2 mm lines, the border 2 mm, five
    star points 4 mm. Only on the top face (y >= top - 0.5 mm). Baked into the atlas like any colour."""
    m, nodes, links, b = new_mat("omok_board")
    # matte (designer, app cut): COMBINED baking reads a facing-up surface along its normal, so a glossy top baked
    # the overhead panel into a white sheen (#fee399 in the app)
    b.inputs["Roughness"].default_value = 0.92
    for k in ("Specular IOR Level", "Specular"):
        if k in b.inputs:
            b.inputs[k].default_value = 0.15
    bump(nodes, links, b, 900, 0.06, 0.0002)
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
    dot = op("MULTIPLY", star, op("LESS_THAN", dist, 0.0026))  # star points: a clear dot, twice a line and more
    on_top = op("GREATER_THAN", sep.outputs["Z"], top - 0.0005)  # web y = Blender Z
    ink = op("MULTIPLY", op("MAXIMUM", op("MAXIMUM", line(u, v), line(v, u)), dot), on_top)
    def mix(factor, a, b_):
        """colour a where factor = 0, b_ where 1; a / b_ = hex or a colour socket"""
        n = nodes.new("ShaderNodeMix")
        n.data_type = "RGBA"
        ca, cb = [s for s in n.inputs if s.type == "RGBA" and s.name in ("A", "B")]
        for sock, v in ((ca, a), (cb, b_)):
            if isinstance(v, str):
                sock.default_value = rgba(v)
            else:
                links.new(v, sock)
        links.new(factor, n.inputs["Factor"])
        return [s for s in n.outputs if s.type == "RGBA"][0]

    # designer (app cut): the top #b5844c reads as light wood once baked (x4 exposure, the lamp); the sides a step
    # darker so the thickness reads
    # the top bakes ~1.5x the sides under the overhead panel: #8d683d reads about #d4a463 in the app (measured, #172)
    wood_c = mix(on_top, "#8f6438", "#8d683d")
    # #156 (desk-room standard): a faint grain across the board, bands along z (the halves' long grain)
    wave = nodes.new("ShaderNodeTexWave")
    wave.wave_type, wave.bands_direction = "BANDS", "X"
    wave.inputs["Scale"].default_value = 60.0  # straight, fine grain (a real board), within 8% lightness
    wave.inputs["Distortion"].default_value = 0.6
    wave.inputs["Detail"].default_value = 1.0
    links.new(geo.outputs["Position"], wave.inputs["Vector"])
    grain = op("POWER", wave.outputs["Fac"], 2.0)
    wood_c = mix(op("MULTIPLY", grain, on_top), wood_c, "#83613a")  # grain: 7% darker
    links.new(mix(ink, wood_c, "#2a1d12"), b.inputs["Base Color"])  # ink lines (designer: #2a1d12)
    return m


def lathe(name, profile, center, material, group, seg=32):
    """a turned solid: profile = [(r, y), ...] in web metres from the bottom up, r = 0 points close the ends"""
    bm = bmesh.new()
    rings = []
    for r, y in profile:
        if r < 1e-6:
            rings.append([bm.verts.new((0, 0, y))])
        else:
            rings.append([bm.verts.new((r * math.cos(2 * math.pi * k / seg), r * math.sin(2 * math.pi * k / seg), y)) for k in range(seg)])
    for a, b_ in zip(rings, rings[1:]):
        for k in range(seg):
            k2 = (k + 1) % seg
            if len(a) == 1 and len(b_) > 1:
                bm.faces.new((a[0], b_[k2], b_[k]))
            elif len(b_) == 1 and len(a) > 1:
                bm.faces.new((a[k], a[k2], b_[0]))
            elif len(a) > 1:
                bm.faces.new((a[k], a[k2], b_[k2], b_[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = mesh_obj(name, bm, material, group)
    o.location = W(*center)
    return smooth(o)


def lens(name, d, h, center, material, group, seg=16, rings=8):
    """a go stone: a lens, both faces domed (a flattened sphere)"""
    return sphere(name, d / 2, center, material, group, scale=(1.0, h / d, 1.0), seg=seg, rings=rings)


def stone_mats():
    return (plastic("#1d1f24", 0.25, 0, 0, "stone_b"), plastic("#f2efe8", 0.35, 0, 0, "stone_w"))


def build_omok(gx, gz, G):
    """the board, its bowls, lids and heaps: all baked into the omok_board node"""
    B, top = OMOK["board"], OMOK["top"]
    span = OMOK["cell"] * (OMOK["n"] - 1)
    x0, z0 = gx - span / 2, gz - span / 2  # the (0, 0) intersection: the board's -x, -z corner
    table = 0.74
    # a folding board (#156, real boards): two halves meeting on the middle line with a 0.6 mm seam (it falls inside
    # line 7, so the grid reads whole), two small brass hinges on the front and back edges, an inset foot
    board_m = omok_mat(x0, z0, top)
    st = top - table - 0.008
    half = (B - 0.0006) / 2
    brass_m = brass()
    parts = [box("omok_slab", (half, st, B), (gx - B / 2 + half / 2, table + 0.008 + st / 2, gz), board_m, G, bev=0.003, seg=3),
             box("omok_slab", (half, st, B), (gx + B / 2 - half / 2, table + 0.008 + st / 2, gz), board_m, G, bev=0.003, seg=3),
             box("omok_foot", (B - 0.008, 0.008, B - 0.008), (gx, table + 0.004, gz), plastic("#8f6438", 0.6, 0, 0.2, "omok_foot"), G, bev=0.001, seg=1)]
    for sz in (-1, 1):
        parts.append(box("omok_hinge", (0.016, 0.01, 0.0012), (gx, table + 0.008 + st / 2, gz + sz * (B / 2 + 0.0006)), brass_m, G, bev=0.0004, seg=1))
        for sx in (-1, 1):  # the screw heads
            parts.append(cyl("omok_screw", 0.0012, 0.0006, (gx + sx * 0.005, table + 0.008 + st / 2, gz + sz * (B / 2 + 0.0013)), brass_m, G, 8, axis="z"))
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
    # go bowls (#156, real ones): turned, bulging at 45% height, a narrow foot ring and a rolled lip; the domed lid
    # lies upside down beside it, its lip (the lighter band) up. 0.09 wide, 0.052 high without the lid
    BOWL = [(0.0, 0.0), (0.03, 0.0), (0.033, 0.002), (0.031, 0.004), (0.036, 0.006), (0.042, 0.014), (0.045, 0.024),
            (0.044, 0.033), (0.04, 0.043), (0.035, 0.05), (0.0335, 0.052), (0.031, 0.0515), (0.03, 0.048), (0.0, 0.046)]
    LID = [(0.0, 0.0), (0.016, 0.0008), (0.03, 0.004), (0.04, 0.009), (0.0445, 0.013), (0.0445, 0.0135), (0.0, 0.0135)]
    LIP = [(0.0445, 0.0), (0.0445, 0.004), (0.0425, 0.0045), (0.0385, 0.0045), (0.0385, 0.0), (0.0445, 0.0)]
    bh = 0.052
    for side, dx in (("b", -0.29), ("w", 0.29)):
        bx, bz = gx + dx, gz + 0.06
        parts += [lathe("bowl", BOWL, (bx, table, bz), bowl_m, G, 32),
                  lathe("bowl_lid", LID, (bx, table, gz - 0.07), bowl_m, G, 32),
                  lathe("bowl_lid_rim", LIP, (bx, table + 0.0135, gz - 0.07), rim_m, G, 32)]
        for k in range(9):  # the heap: a ring of stones around the middle, mounded over the rim (grab point clear)
            a, r = 2 * math.pi * (k + SRNG.random() * 0.6) / 9, 0.012 + SRNG.random() * 0.014
            s = lens("heap", OMOK["stone_d"], OMOK["stone_h"], (bx + r * math.cos(a), table + 0.049 + (0.026 - r) * 0.15, bz + r * math.sin(a)),
                     mats[side], G, 10, 5)
            s.rotation_euler = (SRNG.uniform(-0.3, 0.3), SRNG.uniform(-0.3, 0.3), 0)
            parts.append(s)
        parts.append(cyl("bowl_in", 0.03, 0.001, (bx, table + 0.0465, bz), inner, G, 24))
        at = (bx, table + bh + 0.002, bz)
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
    # the seam: a flush colour band on the ball (a ring standing proud read as Saturn and flickered, designer)
    # #280 3 (room-280.md 6.2): 200 triangles (was 1,088): 10 x 8, the seam band, three small stars printed on one face
    ball = sphere("ball", 0.02, (0, 0, 0), plastic("#f7f7f2", 0.8, 0, 0, "ball"), G, seg=10, rings=8)
    ball.data.materials.append(plastic("#dcdcd4", 0.8, 0, 0, "ball_seam"))
    ball.data.materials.append(plastic("#3a3d42", 0.7, 0, 0, "ball_logo"))
    bm = bmesh.new()
    bm.from_mesh(ball.data)
    for z in (0.0005, -0.0005):  # web y = Blender z: cut two rings 1 mm apart round the equator
        g = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=g, plane_co=(0, 0, z), plane_no=(0, 0, 1))
    for f in bm.faces:
        if abs(f.calc_center_median().z) < 0.0005:
            f.material_index = 1
    # the stars: in the plane of an upper-band face, 0.15 mm proud, 3.4 mm apart along it
    face = max((f for f in bm.faces if 0.006 < f.calc_center_median().z < 0.016), key=lambda f: f.calc_center_median().x)
    c0, nrm = face.calc_center_median(), face.normal.copy()
    east = nrm.cross(Vector((0, 0, 1))).normalized()
    north = east.cross(nrm).normalized()
    for k in (-1, 0, 1):
        c = c0 + nrm * 0.00015 + east * (k * 0.0034)
        mid = bm.verts.new(c)
        ring = [bm.verts.new(c + (east * math.cos(a) + north * math.sin(a)) * (0.0015 if j % 2 == 0 else 0.0006))
                for j, a in enumerate(math.pi / 2 + 2 * math.pi * j / 10 for j in range(10))]
        for j in range(10):
            f = bm.faces.new((mid, ring[(j + 1) % 10], ring[j]))  # (east, north) turns clockwise about nrm
            f.material_index = 2
            f.smooth = False
    bm.normal_update()
    bm.to_mesh(ball.data)
    bm.free()
    ball = [ball]
    out.append((pivot(join("pp_ball", place(ball, M)), M), "bot"))
    t = bpy.data.objects.new("pp_table", None)
    coll("export").objects.link(t)
    t.matrix_world = Mx((tx, th, tz))  # +x = the long side
    t["size"], t["net_h"] = [2.05, 1.14], 0.15
    NODES.append({"obj": t, "play": "pingpong"})
    return out


PP_LIVE = []  # the net's mesh (live bot: a 1 cm lattice of 1.5 mm cords has no room in the atlas)


def side_mat(o, m, ny=0.5):
    """material slot 1 on the faces that are not up or down (a top's edge band): before the bevel is applied"""
    o.data.materials.append(m)
    for f in o.data.polygons:
        if abs(f.normal.z) < ny:  # Blender z = web y
            f.material_index = 1
    return o


def build_pingpong(G, metal):
    """#280 3 (room-280.md 6.1): a folding indoor table at 0.75 scale. Two halves (2 cm top, a dark edge band, the
    white lines), a steel apron under each, an A-frame of tubes per half on a foot bar with two casters (6 cm, dark
    rubber), a centre beam and column (the fold), net posts clamped on the long edges, a white 1.5 cm band on top of
    a navy 1 cm lattice (PP_LIVE)"""
    tx, tz = PINGPONG
    tw, td, th = 2.05, 1.14, 0.76  # 0.75 x a real table (2.74 x 1.525), office-quality.md rule 5
    green = plastic("#1f5a46", 0.6, 0, 0.2, "pp_top")
    band = plastic("#14241f", 0.55, 0, 0.1, "pp_band")
    white = plastic("#f2f2f2", 0.5, 0, 0, "pp_line")
    rubber = plastic("#3a3c40", 0.85, 0, 0.1, "pp_wheel")
    clamp_m = plastic("#17191d", 0.5, 0.2, 0.05, "pp_clamp")
    g = 0.006  # the gap between the halves (under the net)
    hw = tw / 2 - g / 2
    lw = 0.02  # edge lines (real 2 cm)
    p = []
    for s in (-1, 1):
        cx = tx + s * (g / 2 + hw / 2)
        x_out = tx + s * tw / 2  # the end line side
        top = box("pp_top", (hw, 0.02, td), (cx, th - 0.01, tz), green, G)
        side_mat(top, band)
        add_bevel(top, 0.002, 1)
        p.append(top)
        # lines (#263: butt, not overlap), 1 mm proud: the long edges, the end line, the centre line
        for sz in (-1, 1):
            p.append(box("pp_edge", (hw - 0.001, 0.004, lw), (cx, th + 0.001, tz + sz * (td / 2 - lw / 2 - 0.0005)), white, G))
        p.append(box("pp_end", (lw, 0.004, td - 2 * lw - 0.002), (x_out - s * (lw / 2 + 0.0005), th + 0.001, tz), white, G))
        p.append(box("pp_mid", (hw - lw - 0.002, 0.004, 0.006), (cx - s * (lw / 2 + 0.0005), th + 0.001, tz), white, G))
        # the apron: a steel band 4 cm in from the edges, under the top
        ay, ah, at = th - 0.0205 - 0.025, 0.05, 0.015  # 0.5 mm under the top (no shared face)
        x_in = tx + s * (g / 2 + 0.04)
        x_end = x_out - s * 0.04
        alen = abs(x_end - x_in)
        for sz in (-1, 1):
            p.append(box("pp_apron", (alen, ah, at), ((x_in + x_end) / 2, ay, tz + sz * (td / 2 - 0.04)), metal, G, bev=0.002, seg=1))
        for xa in (x_in, x_end):
            p.append(box("pp_apron", (at, ah, td - 0.08 - at - 0.004), (xa, ay, tz), metal, G, bev=0.002, seg=1))
        # the A-frame: a rail across the underside, two tubes splaying out to a foot bar, a cross bar
        xl, xf = tx + s * 0.60, tx + s * 0.68
        p.append(box("pp_rail", (0.03, 0.03, td - 0.08 - 2 * at), (xl, th - 0.0355, tz), metal, G, bev=0.002, seg=1))
        legs = []
        for sz in (-1, 1):
            a_, b_ = (xl, th - 0.05, tz + sz * 0.40), (xf, 0.095, tz + sz * 0.47)
            legs.append((a_, b_))
            p.append(segment("pp_leg", a_, b_, 0.016, metal, G, verts=12))
        k = (th - 0.05 - 0.30) / (th - 0.05 - 0.095)  # the cross bar at 0.30 up
        c0, c1 = [tuple(a_[i] + (b_[i] - a_[i]) * k for i in range(3)) for a_, b_ in legs]
        p.append(segment("pp_cross", c0, c1, 0.011, metal, G, verts=10))
        p.append(box("pp_foot", (0.04, 0.03, 1.0), (xf, 0.082, tz), metal, G, bev=0.003, seg=1))
        for sz in (-1, 1):  # casters: a fork under the foot bar's ends, the wheel rolling along x
            wz = tz + sz * 0.47
            p += [box("pp_fork", (0.04, 0.006, 0.036), (xf, 0.0645, wz), metal, G),
                  box("pp_fork", (0.004, 0.04, 0.03), (xf - 0.016, 0.042, wz), metal, G),
                  box("pp_fork", (0.004, 0.04, 0.03), (xf + 0.016, 0.042, wz), metal, G),
                  cyl("pp_wheel", 0.03, 0.022, (xf, 0.03, wz), rubber, G, 20, axis="x", bev=0.004),
                  cyl("pp_hub", 0.011, 0.03, (xf, 0.03, wz), metal, G, 10, axis="x")]
    # the fold: a beam between the foot bars, a column up to a cross-head under the gap
    p += [box("pp_beam", (1.36 - 0.04 + 0.002, 0.026, 0.035), (tx, 0.082, tz), metal, G, bev=0.003, seg=1),
          box("pp_column", (0.035, th - 0.089 - 0.094, 0.035), (tx, (th - 0.089 + 0.094) / 2, tz), metal, G, bev=0.003, seg=1),
          box("pp_head", (0.06, 0.069, 0.5), (tx, th - 0.0555, tz), metal, G, bev=0.003, seg=1)]
    # the net: posts just outside the long edges, a clamp over each edge with a screw under, the white band on top
    zr = td / 2 + 0.03
    for sz in (-1, 1):
        zp = tz + sz * (td / 2 + 0.035)
        p += [box("pp_post", (0.012, 0.155, 0.012), (tx, th + 0.0775, zp), clamp_m, G, bev=0.002, seg=1),
              box("pp_post_cap", (0.018, 0.008, 0.018), (tx, th + 0.157, zp), clamp_m, G, bev=0.002, seg=1),
              box("pp_clamp", (0.028, 0.012, 0.047), (tx, th + 0.0095, tz + sz * (td / 2 + 0.0105)), clamp_m, G, bev=0.002, seg=1),
              box("pp_clamp", (0.025, 0.05, 0.012), (tx, th - 0.012, tz + sz * (td / 2 + 0.031)), clamp_m, G, bev=0.002, seg=1),
              box("pp_clamp", (0.022, 0.012, 0.035), (tx, th - 0.031, tz + sz * (td / 2 + 0.008)), clamp_m, G, bev=0.002, seg=1),
              cyl("pp_screw", 0.004, 0.044, (tx, th - 0.043, tz + sz * (td / 2 - 0.004)), clamp_m, G, 8),
              cyl("pp_knob", 0.011, 0.008, (tx, th - 0.066, tz + sz * (td / 2 - 0.004)), clamp_m, G, 12, bev=0.002)]
    p.append(box("pp_net_band", (0.004, 0.015, 2 * zr), (tx, th + 0.1425, tz), white, G))
    # the lattice: 1 cm cells of 1.5 mm cords from 4 mm over the top up to the band
    navy = plastic("#1d2a4a", 0.9, 0, 0.0, "pp_net")
    y0, y1 = th + 0.004, th + 0.135
    cords = []
    zl = td / 2 + 0.033  # the cords end inside the posts (at their ends a shared face with the post showed after meshopt)
    n = round(2 * zl / 0.01)
    for k in range(n + 1):
        cords.append(box("cord", (0.0016, y1 - y0, 0.0016), (tx, (y0 + y1) / 2, tz - zl + k * 2 * zl / n), navy, "prop"))
    for j in range(round((y1 - y0) / 0.01) + 1):
        cords.append(box("cord", (0.001, 0.0015, 2 * zl), (tx, y0 + j * 0.01, tz), navy, "prop"))
    PP_LIVE.append(join("pp_net", cords))
    return p


DRIP_TOP = 0.955  # #280 3: the drip tray grid's top, where prop_cup_0 stands under the spouts (the counter is 0.94)


def build_espresso(G):
    """#280 3 (room-280.md 6.1): a home espresso machine in the counter frame (local +x = front), 0.28 wide (z -0.26 ..
    0.02), 0.34 high, 0.37 deep with the tank and the tray. Matte metal body on a dark plinth, the head unit over the
    brew bay (its front at x 0.14 keeps COFFEE_BUTTON), a dark panel with a pressure gauge, the group head and a
    portafilter (two spouts 5 mm over the mug on the tray, its handle 30 deg off the front), a drip tray with a chrome
    grid, a steam wand and its knob on the left, a blue-grey tank at the back, a cup warmer with two cups on top"""
    body_m = plastic("#c9ccd1", 0.5, 0.0, 0.05, "esp_body")  # matte paint: any metallic baked into pink / green speckles
    dark = plastic("#2a2d33", 0.5, 0, 0.1, "esp_panel")
    chrome = plastic("#c8ccd4", 0.35, 0.15, 0, "esp_chrome")  # baked: near-dielectric (metallic speckled the grid)
    tank_m = plastic("#9fb0bd", 0.15, 0, 0, "esp_tank")
    handle_m = plastic("#1d1f23", 0.45, 0, 0.05, "esp_handle")
    face_m = plastic("#f2efe6", 0.4, 0, 0, "esp_gauge")
    cup_m = plastic("#f4f4f0", 0.4, 0, 0, "cup")
    zc = -0.12  # the brew axis (the spout and the mug)
    p = [box("esp_plinth", (0.26, 0.012, 0.284), (-0.04, 0.946, zc), dark, G, bev=0.003, seg=1),
         box("esp_body", (0.19, 0.329, 0.28), (-0.005, 1.1155, zc), body_m, G, bev=0.012),
         box("esp_head", (0.055, 0.179, 0.278), (0.1125, 1.1895, zc), body_m, G, bev=0.012),
         box("esp_panel", (0.002, 0.155, 0.2), (0.1405, 1.1925, -0.15), dark, G)]
    # the pressure gauge over the group head
    p += [torus("esp_gauge_ring", 0.024, 0.003, (0.143, 1.225, zc), chrome, G, axis="x", seg=28, rseg=6),
          cyl("esp_gauge", 0.023, 0.002, (0.1427, 1.225, zc), face_m, G, 28, axis="x"),
          box("esp_needle", (0.0018, 0.015, 0.0016), (0.1442, 1.229, zc - 0.004), handle_m, G),
          cyl("esp_needle_hub", 0.003, 0.003, (0.1445, 1.225, zc), handle_m, G, 10, axis="x")]
    # the group head, the portafilter (basket, spout block, two spouts), its handle 30 deg toward -z
    p += [cyl("esp_group", 0.034, 0.015, (0.12, 1.094, zc), chrome, G, 28),
          cyl("esp_basket", 0.032, 0.024, (0.12, 1.076, zc), chrome, G, 28, bev=0.002),
          box("esp_spout_block", (0.02, 0.006, 0.03), (0.12, 1.061, zc), chrome, G, bev=0.001, seg=1)]
    for dz in (-0.008, 0.008):
        p.append(cyl("esp_spout", 0.0035, 0.0045, (0.12, 1.05725, zc + dz), chrome, G, 10))
    a = math.radians(30)
    h0 = (0.15, 1.075, zc)
    h1 = (0.15 + 0.11 * math.cos(a), 1.068, zc - 0.11 * math.sin(a))
    p += [segment("esp_pf_neck", (0.145, 1.076, zc), (0.165, 1.074, zc - 0.0087), 0.007, chrome, G, verts=10),
          segment("esp_pf_handle", h0, h1, 0.010, handle_m, G, verts=12, r2=0.013),
          sphere("esp_pf_end", 0.013, h1, handle_m, G, seg=12, rings=6)]
    # the drip tray under the bay: a dark tray, chrome slats (the grid), a chrome front lip
    p.append(box("esp_tray", (0.117, 0.0115, 0.23), (0.1465, 0.94575, zc), dark, G, bev=0.002, seg=1))
    for k in range(8):
        p.append(box("esp_grid", (0.006, 0.0035, 0.222), (0.098 + k * 0.0143, DRIP_TOP - 0.00175, zc), chrome, G))
    p.append(box("esp_tray_lip", (0.004, 0.018, 0.234), (0.205, 0.949, zc), chrome, G, bev=0.001, seg=1))
    # the steam wand (left, by the tray) and its knob on the panel
    zs = -0.235
    p += [segment("esp_wand", (0.14, 1.16, zs), (0.172, 1.16, zs), 0.005, chrome, G, verts=10),
          sphere("esp_wand_joint", 0.0075, (0.175, 1.16, zs), chrome, G, seg=12, rings=6),
          segment("esp_wand", (0.175, 1.16, zs), (0.186, 1.005, zs - 0.01), 0.0045, chrome, G, verts=10),
          cyl("esp_wand_tip", 0.0055, 0.012, (0.1865, 1.0, zs - 0.0103), chrome, G, 10),
          cyl("esp_knob", 0.014, 0.012, (0.146, 1.245, zs), handle_m, G, 18, axis="x", bev=0.002),
          cyl("esp_knob_cap", 0.006, 0.003, (0.1525, 1.245, zs), chrome, G, 12, axis="x")]
    # the water tank behind the body (blue-grey, a darker water line), its lid
    p += [box("esp_tank", (0.067, 0.2985, 0.26), (-0.1315, 1.10075, zc + 0.01), tank_m, G, bev=0.004, seg=2),
          box("esp_water_line", (0.068, 0.003, 0.261), (-0.1315, 1.17, zc + 0.01), dark, G),
          box("esp_tank_lid", (0.073, 0.012, 0.266), (-0.1315, 1.2555, zc + 0.01), dark, G, bev=0.003, seg=2)]
    # the cup warmer on top: a chrome plate, two small cups upside down
    p.append(box("esp_warmer", (0.22, 0.003, 0.26), (0.02, 1.281, zc), chrome, G, bev=0.001, seg=1))
    for cx, cz in ((-0.035, -0.19), (0.045, -0.075)):
        p.append(cyl("esp_cup", 0.03, 0.055, (cx, 1.2825 + 0.0275 + 0.0005, cz), cup_m, G, 20, r2=0.025, bev=0.002))
    return p


def build_lounge():
    G = "lounge"
    metal = plastic("#2a2c31", 0.35, 0.8, 0.03, "metal")
    p = []
    # ping-pong table (#280 3: room-280.md 6.1, a folding indoor table)
    pp = build_pingpong(G, metal)
    p += pp
    # with the players: nav_pingpong_a|b hover 1.33 m from the center, 0.22 m body -> 0.55 m past each end
    fp("pingpong", pp, "floor", grow=(0.55, 0.0))
    # the paddles and the ball are props now (build_props): agents pick them up
    # #280: the old sofa is gone: the L sofa (build_sofa_l, atlas lounge2) stands in the south-east corner
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
    # its own node at OMOK_DENSITY: the 1.2 mm lines need texels, and the bowls are near-field too (office-quality.md 0:
    # >= 500 px/m up close, #156)
    OMOK_NODES.append(join("omok_board", board))
    # coffee counter against the right wall (#109: it used to cut into the door), built in its own frame: local +x = front
    c = []
    c += [box("counter", (0.6, 0.9, 0.7), (0, 0.45, 0), plastic("#2b2f3a", 0.6, 0, 0.2, "counter"), G, bev=0.01),
          box("counter_top", (0.64, 0.04, 0.74), (0, 0.92, 0), plastic("#e8e4dc", 0.3, 0, 0.3, "counter_top"), G, bev=0.006),
          *build_espresso(G),
          # #164: the brew button the index presses (coffee_button_contact_index), a chrome ring round it
          cyl("coffee_btn", 0.011, 0.006, (COFFEE_BUTTON[0] - 0.003, COFFEE_BUTTON[1], COFFEE_BUTTON[2]), plastic("#2a2d33", 0.5, 0, 0.1, "coffee_btn"), G, 20, axis="x", bev=0.0015),
          torus("coffee_btn_ring", 0.0125, 0.0015, (0.1405, COFFEE_BUTTON[1], COFFEE_BUTTON[2]), plastic("#c8ccd4", 0.3, 0.9, 0, "chrome"), G, axis="x", seg=20, rseg=6)]
    # the cup under the spout and one beside it are props (build_props); the stack stays baked
    for k in range(3):
        c.append(cyl("cup", 0.035, 0.08, (0.05, 0.98 + k * 0.08, 0.2), plastic("#f4f4f0", 0.4, 0, 0, "cup"), G, 16, r2=0.03))
    c = place(c, counter_frame())
    fp("counter", c, "floor", "e")  # stands against the right wall
    p += c
    # floor plants (#126): one species each, each its own node (PLANT_NODES) so its leaves can bake at half density
    for name, species, px, pz in PLANTS:
        objs = plant_tris(name, PLANT_BUILDERS[species](name, px, pz, G))
        # #184: the grid blocks only the pot (core): the canopy is above head height in part, and a watering agent must
        # reach the pot. The slot (overlap check) keeps the whole plant
        pot_parts = [o for o in objs if o.name.split(".")[0] in {f"{name}_{p}" for p in ("body", "rim", "foot", "saucer", "leg", "ring")}]
        fp(name, objs, "decor", core=pot_parts)
        leaf_tips(name, [o for o in objs if o not in pot_parts and "soil" not in o.name and "pot" not in o.name
                         and not o.get("vein_node")], px, pz)
        veins = [o for o in objs if o.get("vein_node")]
        if veins:  # #156: the 3–9 mm vein strips got 1–2 px at the lounge density and baked dark: their own node
            VEIN_NODES.append(join(f"{name}_veins", veins))
        PLANT_NODES.append(join(name, [o for o in objs if not o.get("vein_node")]))
    # floor lamp by the sofa (its shade glows live)
    lx, lz = LAMP  # #280: behind the book table (room-280.md 8)
    p += [cyl("lamp_base", 0.14, 0.03, (lx, 0.015, lz), metal, G, 24),
          cyl("lamp_pole", 0.015, 1.5, (lx, 0.78, lz), metal, G, 10)]
    shade = cyl("lamp_shade", 0.2, 0.26, (lx, 1.62, lz), emitter("#ffcf8a", 2.0, "lamp_shade"), "export", 32, r2=0.13)
    fp("floor_lamp", p[-2:] + [shade], "decor")
    # #185 (user: the can sat too deep in the corner; designer): a low wooden stand in front of the fig, the
    # sansevieria stand's family - a 0.26 disc top 0.36 high with a 1 cm lip, three legs splaying r 0.10 -> 0.12, a
    # ring 0.12 up. The can stands on it (build_props): its handle at about 0.6 m, in reach of a floating agent
    cx, cz = CAN_STAND
    wood_s = plastic("#a07850", 0.6, 0, 0.4, "stand_wood")
    st = [lathe("can_stand_top", [(0, 0.335), (0.128, 0.335), (0.13, 0.338), (0.13, 0.37), (0.122, 0.37), (0.122, 0.36), (0, 0.36)],
                (cx, 0, cz), wood_s, G, seg=32),
          torus("can_stand_ring", 0.112, 0.005, (cx, 0.12, cz), wood_s, G, seg=24, rseg=5)]
    for k in range(3):
        a = 2 * math.pi * k / 3 + math.pi / 6
        st.append(segment("can_stand_leg", (cx + 0.12 * math.cos(a), 0.0, cz + 0.12 * math.sin(a)),
                          (cx + 0.10 * math.cos(a), 0.335, cz + 0.10 * math.sin(a)), 0.004, wood_s, G, verts=8, r2=0.006))
    p += st
    fp("can_stand", st, "decor")
    # #280 3 (user, lounge-props.md 3.1): the small book table is gone, its place left empty; the book rests on the
    # low table (table_low_slot_2)
    lounge = join("lounge", p)
    return lounge, apply_all(shade), (lx, 1.55, lz)


# ================================================================ PROPS (live, real-time lit)
# Things agents pick up while playing. Each is built around its pivot (where a hand holds it: paddle handle end,
# cup and watering-can handle; ball and pieces at their center), exported at its home spot with extras:
#   prop = kind,  home = {pos, rot} (web, Euler XYZ),  grip = {pos, rot} (offset from agent_i_hand_l|r)
# They are left out of the bake (#43): a lifted prop would leave its shadow behind; the app can add a small contact shadow.
#
# #164 hand shapes per object (designer: docs/design/grips.md): empties the app fits the hand to
#   <prop>_grip_r|l               where the hand's _grip frame sits while that hand holds the prop (hand_grip = this);
#                                 only on the hands that really hold it
#   <prop>_contact_<part>[_l]     the point a finger pad (thumb, index, middle, ring, little) or the palm touches;
#                                 local +z = the surface's outward normal. _l = the left hand of a two-handed prop
# Children of the prop (they move with it); on baked things (mouse, coffee button, bowls) they stand alone.
# The hand's _grip frame, measured on the #134 hand (preview hold_piece prints it): fingers along its -y, the palm
# facing -x (right hand) / +x (left hand).
def child_empty(parent, name, M, extras=None):
    e = bpy.data.objects.new(name, None)
    coll("export").objects.link(e)
    if parent:
        e.parent = parent
    e.matrix_world = M
    for k, v in (extras or {}).items():
        e[k] = v
    NODES.append({"obj": e, "hand": name})
    return e


def wv(v):
    """a web vector as a Blender one"""
    return Vector((v[0], -v[2], v[1]))


def grip_frame(pos, fingers, palm, side):
    """the hand-grip frame (Blender matrix in the prop's frame) from the designer's spec: a position and the
    directions the fingers reach and the palm faces (web, prop local)"""
    ey = -Vector(fingers).normalized()
    p = Vector(palm).normalized()
    ex = (-p if side == "r" else p)
    ex = (ex - ex.project(ey)).normalized()
    ez = ex.cross(ey)
    R = Matrix((wv(ex), wv(-ez), wv(ey))).transposed().to_4x4()  # columns: local x, y (= web -z), z (= web y)
    return Matrix.Translation(W(*pos)) @ R


def grip_at(o, side, pos, fingers, palm, M=None):
    """<name>_grip_<side>; o = the prop (None for a baked thing: then M is its frame and the name is o's own)"""
    base = o.matrix_world if hasattr(o, "matrix_world") else M
    name = f"{o.name}_grip_{side}" if hasattr(o, "matrix_world") else f"{o}_grip_{side}"
    return child_empty(o if hasattr(o, "matrix_world") else None, name, base @ grip_frame(pos, fingers, palm, side), {"grip_for": side})


def web_z_along(d):
    """a rotation whose web (glTF) local +z points along the web direction d. The glTF export turns Blender local
    axes too: Blender local -Y becomes glTF local +Z (and Blender +Z becomes glTF +Y). Aligning Blender +Z instead
    left the spout and the contact normals at right angles (#184)."""
    return wv(d).normalized().to_track_quat("-Y", "Z").to_matrix().to_4x4()


def contact(o, part, pos, normal, side="", M=None):
    """<name>_contact_<part>[_side]: pos and the outward normal in the prop's frame (web); o = a prop, or a name
    string for a baked thing (then M is its frame)"""
    n = wv(normal).normalized()
    R = web_z_along(normal)
    obj = hasattr(o, "matrix_world")
    base = o.matrix_world if obj else M
    name = (o.name if obj else o) + f"_contact_{part}" + (f"_{side}" if side else "")
    return child_empty(o if obj else None, name, base @ Matrix.Translation(W(*pos)) @ R, {"contact": part})


def tripod(o, tip_z, r, side="r"):
    """a pen held in the tripod grip (grips.md): grip 3 cm up from the tip at -z, fingers 45° to the axis; thumb,
    index and middle pads around the barrel 120° apart (index on top, +y)"""
    z = tip_z + 0.03
    grip_at(o, side, (0, 0, z), (0, -0.7071, -0.7071), (-1, 0, 0) if side == "r" else (1, 0, 0))
    for part, deg in (("index", 90), ("thumb", 210), ("middle", 330)):
        a = math.radians(deg)
        contact(o, part, (r * math.cos(a), r * math.sin(a), z), (math.cos(a), math.sin(a), 0))


def web_pose(M):
    """a Blender world matrix -> (home_pos, home_rot) in web terms for prop()/Mx: position, Euler XYZ (three.js)"""
    t = M.to_translation()
    P = Matrix(((1, 0, 0), (0, 0, -1), (0, 1, 0)))  # web -> Blender
    R = P.transposed() @ M.to_3x3().normalized() @ P
    ry = math.asin(max(-1.0, min(1.0, R[0][2])))
    if abs(R[0][2]) < 0.9999999:
        rx, rz = math.atan2(-R[1][2], R[2][2]), math.atan2(-R[0][1], R[0][0])
    else:
        rx, rz = math.atan2(R[2][1], R[1][1]), 0.0
    return (t.x, t.z, -t.y), (rx, ry, rz)


def prop(name, kind, objs, home_pos, home_rot=(0.0, 0.0, 0.0), grip_pos=(0.0, 0.0, 0.0), grip_rot=(0.0, 0.0, 0.0)):
    H = Mx(home_pos, *home_rot)
    o = pivot(join(name, place(objs, H)), H)
    o["prop"] = kind
    o["home"] = {"pos": [round(v, 4) for v in home_pos], "rot": [round(v, 4) for v in home_rot]}
    o["grip"] = {"pos": [round(v, 4) for v in grip_pos], "rot": [round(v, 4) for v in grip_rot]}
    return o


PINCH_GRIP = {"l": (0.02, -0.0107, -0.03), "r": (-0.0274, -0.0077, -0.0297)}  # #135: pinch point per hand (web, _grip frame)
BOOK_HALVES = []  # live bot: prop_book_l, prop_book_r


def build_book(G):
    """the book (#135); #280 3 (user, lounge-props.md 3.1): it rests on the low table, centred on table_low_slot_2"""
    T = 0.025
    bx, bz, ry = TABLE_LOW[0] + 0.19, TABLE_LOW[1] + 0.10, 0.15  # the slot (2.80, 2.51, designer #359: inside the east half circle); turned 0.15 like before
    ox, oz = bx - 0.075 * math.cos(ry), bz + 0.075 * math.sin(ry)  # the frame's origin = the spine axis, 7.5 cm from the centre
    return make_book("prop_book", 0.15, 0.22, T, "#2f6f9f", (ox, 0.40 + T / 2, oz), (0.0, ry, 0.0), G, ribbon=True)


def turning_page(name, W_, H_, H, paper, G):
    """#231: one page to turn, live bot <book>_page in the book frame (pivot = the spine axis, turned about local z
    like the _l half): two sheets back to back 0.1 mm apart with opposite normals (the back has its own UV, mirrored
    in u, for the next page's text), 0.3-0.4 mm over the lower half's inner face (hidden inside the closed book).
    16 x 4 quads so the app can bend it; point attributes _PAGE_U (spine 0 -> fore-edge 1), _PAGE_V (bottom 0 -> top 1)"""
    pw, ph = W_ - 0.008, H_ - 0.012
    NU, NV = 16, 4
    bm = bmesh.new()
    lu, lv = bm.verts.layers.float.new("_PAGE_U"), bm.verts.layers.float.new("_PAGE_V")
    uvl = bm.loops.layers.uv.new("UVMap")
    for y, up in ((0.0004, True), (0.0003, False)):
        g = [[None] * (NV + 1) for _ in range(NU + 1)]
        for a in range(NU + 1):
            for b in range(NV + 1):
                v = bm.verts.new(W(0.003 + a / NU * pw, y, -ph / 2 + b / NV * ph))
                v[lu], v[lv] = a / NU, b / NV
                g[a][b] = v
        for a in range(NU):
            for b in range(NV):
                q = [g[a][b], g[a + 1][b], g[a + 1][b + 1], g[a][b + 1]]  # this order faces web -y
                f = bm.faces.new(list(reversed(q)) if up else q)
                for loop in f.loops:
                    u = loop.vert[lu]
                    loop[uvl].uv = (u if up else 1.0 - u, loop.vert[lv])
    # #231 (coder): text lines on both faces (the right face's lines vanished while the page showed). Strips in the same
    # mesh, cut at the 16 columns and carrying _PAGE_U / _PAGE_V like the page, so they bend with it; 0.3 mm off each
    # face (#263), the second material (book_ink)
    lines = []
    for y, up in ((0.0007, True), (0.0, False)):
        for k in range(8):
            vc, dv = 0.15 + k * 0.1, 0.00125 / ph
            last = 14 if k % 3 != 2 else 10  # every third line ends short, like a paragraph
            for a in range(2, last):
                q = []
                for uu, vv in ((a / NU, vc - dv), ((a + 1) / NU, vc - dv), ((a + 1) / NU, vc + dv), (a / NU, vc + dv)):
                    v = bm.verts.new(W(0.003 + uu * pw, y, -ph / 2 + vv * ph))
                    v[lu], v[lv] = uu, vv
                    q.append(v)
                f = bm.faces.new(list(reversed(q)) if up else q)
                for loop in f.loops:
                    loop[uvl].uv = (loop.vert[lu] if up else 1.0 - loop.vert[lu], loop.vert[lv])
                lines.append(f)
    for f in lines:
        f.material_index = 1
    sheet = mesh_obj(name, bm, paper, G)
    sheet.data.materials.append(plastic("#9a948a", 0.9, 0, 0.0, "book_ink"))
    o = pivot(join(name, place([sheet], H)), H)
    o["page_w"], o["page_h"], o["turn_axis"], o["turn_dir"] = round(pw, 4), round(ph, 4), "z", 1
    # #231 (grips.md 2 "한 장 넘기기"): where the right thumb (on top) and index (under it) pinch the page: its top
    # outer corner, 1.2 cm in from both edges
    cx, cz = 0.003 + pw - 0.012, ph / 2 - 0.012
    contact(o, "thumb", (cx, 0.0004, cz), (0, 1, 0))
    contact(o, "index", (cx, 0.0003, cz), (0, -1, 0))
    return live(o, "bot")


def make_book(name, W_, H_, T, cover_hex, home_pos, home_rot, G, ribbon=False):
    """book frame: origin on the spine axis at mid thickness, pages along +x (W_), spine along z (H_), thickness
    along y; the lower half (_r) under y = 0, the upper half (_l, the front cover) above. <name> = the spine's lower
    half (a prop), <name>_l|_r = the halves (live bot, BOOK_HALVES)"""
    cover = plastic(cover_hex, 0.6, 0, 0.3, f"book_cover_{cover_hex[1:]}")
    paper = plastic("#efe8d8", 0.9, 0, 0.1, "book_paper")
    leaf = plastic("#d9d2c2", 0.9, 0, 0.0, "book_leaf")  # the paper lines on the page block's three faces
    dk = [int(cover_hex[i:i + 2], 16) * 0.85 for i in (1, 3, 5)]
    groove = plastic("#%02x%02x%02x" % tuple(int(c) for c in dk), 0.7, 0, 0.3, f"book_groove_{cover_hex[1:]}")  # the cover, 15% darker
    ink = plastic("#9a948a", 0.9, 0, 0.0, "book_ink")
    band = plastic("#a83232", 0.8, 0, 0.3, "book_band")
    gilt = plastic("#c9a465", 0.35, 0.9, 0.1, "book_gilt")
    lt = [int(cover_hex[i:i + 2], 16) * 0.75 + 255 * 0.25 for i in (1, 3, 5)]
    title = plastic("#%02x%02x%02x" % tuple(int(c) for c in lt), 0.6, 0, 0.3, f"book_title_{cover_hex[1:]}")  # 25% lighter
    spine_gilt = plastic("#d9b56c", 0.45, 0, 0.1, "book_spine_gilt")
    H = Mx(home_pos, *home_rot)

    def spine_deco(sgn):
        """#211 (designer): two 2 mm gilt bands 1.5 cm in from head and tail and a title line down the middle
        (60% of the height, 3 mm wide), standing 0.2 mm proud of the spine; split at y = 0 like the spine itself"""
        # not metallic: the books are PBR in the app with no environment map, where a metal gilt went dark brown
        o = [box("spine_band", (0.0004, T / 2 - 0.0012, 0.002), (-0.0032, sgn * (T / 4 - 0.0004), sz * (H_ / 2 - 0.015)),
                 spine_gilt, G) for sz in (-1, 1)]
        return o + [box("spine_title", (0.0004, 0.0015, H_ * 0.6), (-0.0032, sgn * 0.00075, 0), title, G)]

    def half(nm, sgn):
        """sgn = +1: the upper half (cover on top), -1: the lower one"""
        c = T / 2 - 0.001
        objs = [box("cover", (W_, 0.002, H_), (W_ / 2, sgn * c, 0), cover, G, bev=0.0008, seg=1),
                # the page block: the fore-edge hollows a little toward the book's middle (two steps)
                box("pages", (W_ - 0.0075, 0.004, H_ - 0.01), (W_ / 2 - 0.00175, sgn * 0.002, 0), paper, G),
                box("pages", (W_ - 0.006, T / 2 - 0.006, H_ - 0.01), (W_ / 2 - 0.001, sgn * (0.004 + (T / 2 - 0.006) / 2), 0), paper, G)]
        for k in range(4):  # paper lines: thin darker strips on the fore-edge, the head and the tail
            y = sgn * (0.0015 + k * 0.0022)
            objs += [box("leaf", (0.0003, 0.0003, H_ - 0.012), (W_ - (0.0054 if abs(y) < 0.004 else 0.0039), y, 0), leaf, G),
                     box("leaf", (W_ - 0.008, 0.0003, 0.0003), (W_ / 2 - 0.001, y, H_ / 2 - 0.0048), leaf, G),
                     box("leaf", (W_ - 0.008, 0.0003, 0.0003), (W_ / 2 - 0.001, y, -(H_ / 2 - 0.0048)), leaf, G)]
        # #156 (real hardcovers): a red headband at each end of the page block by the spine
        for sz in (-1, 1):
            # #263: 0.5 mm proud of the page block's end (its face sat on the pages' head / tail face)
            objs.append(box("headband", (0.004, T / 2 - 0.003, 0.002), (0.0025, sgn * (T / 4 - 0.0005), sz * (H_ / 2 - 0.0055)), band, G, bev=0.0005, seg=1))
        if sgn > 0:  # the spine's upper half turns with this half (a whole spine would stand up between open pages)
            objs.append(box("spine", (0.003, T / 2, H_), (-0.0015, T / 4, 0), cover, G, bev=0.001, seg=2))
            objs += spine_deco(1)
            # the front cover: a gilt rule by the spine and a cream title label
            objs += [box("groove", (0.0015, 0.0002, H_ - 0.012), (0.012, c + 0.0011, 0), groove, G),  # a shallow hinge groove
                     box("label", (W_ / 2, 0.0004, 0.034), (W_ / 2 + 0.008, c + 0.0012, -H_ * 0.2), paper, G, bev=0.0002, seg=1),
                     box("label_ink", (W_ / 3, 0.0002, 0.004), (W_ / 2 + 0.008, c + 0.0015, -H_ * 0.2 - 0.004), ink, G),
                     box("label_ink", (W_ / 4.7, 0.0002, 0.003), (W_ / 2 + 0.008, c + 0.0015, -H_ * 0.2 + 0.006), ink, G)]
        elif ribbon:  # a ribbon bookmark slips out at the foot and lies on the table
            objs.append(box("ribbon", (0.005, 0.0005, 0.04), (0.055, -T / 2 + 0.0003, H_ / 2 + 0.012), band, G, rot_y=0.25))
        for k in range(8):  # a few grey lines of text on the inner page (seen when open)
            objs.append(box("line", (W_ - 0.04 - (0.03 if k % 3 == 2 else 0), 0.0002, 0.0025),
                            (W_ / 2 - (0.015 if k % 3 == 2 else 0), -sgn * 0.0001, -H_ * 0.34 + k * H_ * 0.09), ink, G))
        return live(pivot(join(nm, place(objs, H)), H), "bot")

    BOOK_HALVES.extend([half(f"{name}_l", 1), half(f"{name}_r", -1), turning_page(f"{name}_page", W_, H_, H, paper, G)])
    spine = [box("spine", (0.003, T / 2, H_), (-0.0015, -T / 4, 0), cover, G, bev=0.001, seg=2)] + spine_deco(-1)  # the lower half of the spine
    return prop(name, "book", spine, home_pos, home_rot,
                grip_pos=(0, -0.04, 0), grip_rot=(-math.pi / 2, 0, 0))


PAPER = (0.21, 0.297, 0.0004)  # #262 A4: width (local x, the short side), length (local z), thickness (local y)


def paper_half(name, sz, H, paper, ink, G):
    """#262 (paper-pass.md 5): one half of the sheet in the paper frame (origin = the sheet's middle, the fold line =
    local x through it, writing face +y). sz -1 = the near half (z < 0, _a), +1 = the far one (_b). A closed slab
    0.4 mm thick whose two outer corners curl up 2 mm, three grey text lines 0.3 mm over the writing face (#263: off
    its plane). Live bot; extras fold = the axis and the sign that folds this half up over the other, writing inside"""
    w, L, t = PAPER
    xs = (-w / 2, -w / 2 + 0.03, -0.025, 0.025, w / 2 - 0.03, w / 2)
    zs = [sz * z for z in (0.0, 0.05, L / 2 - 0.03, L / 2 - 0.015, L / 2)]

    def curl(x, z):
        u = max(0.0, (abs(x) - (w / 2 - 0.03)) / 0.03)
        v = max(0.0, (abs(z) - (L / 2 - 0.03)) / 0.03)
        return 0.002 * (u * v) ** 2

    bm = bmesh.new()
    top = [[bm.verts.new(W(x, t / 2 + curl(x, z), z)) for x in xs] for z in zs]
    bot = [[bm.verts.new(W(x, -t / 2 + curl(x, z), z)) for x in xs] for z in zs]
    nz, nx = len(zs), len(xs)
    for i in range(nz - 1):
        for j in range(nx - 1):
            bm.faces.new((top[i][j], top[i][j + 1], top[i + 1][j + 1], top[i + 1][j]))
            bm.faces.new((bot[i][j], bot[i + 1][j], bot[i + 1][j + 1], bot[i][j + 1]))
    ring = ([(i, 0) for i in range(nz)] + [(nz - 1, j) for j in range(1, nx)] + [(i, nx - 1) for i in range(nz - 2, -1, -1)]
            + [(0, j) for j in range(nx - 2, 0, -1)])
    for k in range(len(ring)):
        (ai, aj), (bi, bj) = ring[k], ring[(k + 1) % len(ring)]
        bm.faces.new((top[ai][aj], top[bi][bj], bot[bi][bj], bot[ai][aj]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    sheet = mesh_obj(f"{name}_sheet", bm, paper, G)
    lines = [box("paper_line", (0.15 - (0.05 if k == 2 else 0), 0.0001, 0.003), (-(0.025 if k == 2 else 0), t / 2 + 0.0003, sz * (0.03 + k * 0.03)), ink, G)
             for k in range(3)]
    o = live(pivot(join(name, place([sheet] + lines, H)), H), "bot")
    o["fold"] = {"axis": "x", "sign": -sz}  # + rx turns +y toward +z: the far half folds up with -rx
    return o


def paper_sheet(home_pos, home_rot, G):
    """#262: prop_paper = the sheet as a prop (its node holds only a 2 mm core inside the sheet's thickness; the app
    moves it) and its two live halves prop_paper_a (near, z < 0) | _b (far), pivot = the sheet's middle on the fold line"""
    paper = plastic("#f4f1ea", 0.85, 0, 0.1, "paper_sheet")
    ink = plastic("#8f8a80", 0.9, 0, 0.0, "paper_ink")
    H = Mx(home_pos, *home_rot)
    paper_half("prop_paper_a", -1, H, paper, ink, G)
    paper_half("prop_paper_b", 1, H, paper, ink, G)
    o = prop("prop_paper", "paper", [box("paper_core", (0.002, 0.0001, 0.002), (0, 0, 0), paper, G)], home_pos, home_rot)
    o["size"] = [PAPER[0], PAPER[1], PAPER[2]]
    return o


MUG_H, MUG_R = 0.095, 0.041


def mug_home(C, bx, bz, base=0.94):
    at = (C @ Mx((bx + 0.072, base + MUG_H / 2, bz))).to_translation()
    return (at.x, at.z, -at.y), (0.0, COUNTER[2], 0.0)


def mug_parts(k, G):
    """a mug in the cup frame (origin on the handle side, body centre x -0.072, y 0 = half height)"""
    cx, h2, R = -0.072, MUG_H / 2, MUG_R
    glaze = plastic(("#efe8dc", "#3a3d42")[k], 0.3, 0, 0.05, f"mug_glaze_{k}")
    inner = plastic("#efe8dc", 0.3, 0, 0.05, "mug_glaze_0")  # ivory inside (both)
    foot = plastic("#d6cbb9", 0.85, 0, 0.3, "mug_foot")
    coffee = plastic("#3d2416", 0.25, 0, 0.0, "coffee")
    crema = plastic("#7a4d2e", 0.4, 0, 0.0, "crema")
    y0 = -h2
    lip_in = R - 0.0045
    # one closed profile (foot ring 2 mm in, the outer wall a little narrower at the foot, a rounded lip, the inner
    # wall, the cavity's floor under the coffee): the normals come out right; materials go on by where a face sits
    prof = [(0.0, y0 + 0.002), (R - 0.0075, y0 + 0.002), (R - 0.0055, y0), (R - 0.0028, y0), (R - 0.002, y0 + 0.004),
            (R - 0.0012, y0 + 0.03), (R, h2 - 0.004), (R - 0.0005, h2 - 0.001), (R - 0.0022, h2),
            (lip_in + 0.0006, h2 - 0.0008), (lip_in, h2 - 0.003), (lip_in, h2 - 0.02), (0.0, h2 - 0.02)]
    body = lathe("mug_body", prof, (cx, 0, 0), glaze, G, 40)
    me = body.data
    me.materials.append(inner)
    me.materials.append(foot)
    for f in me.polygons:
        c = f.center  # Blender local: z = web y, (x, y) radial
        r = (c.x * c.x + c.y * c.y) ** 0.5
        if c.z < y0 + 0.0045 - 1e-4:
            f.material_index = 2  # the unglazed foot
        elif r < lip_in + 0.0007 and c.z > h2 - 0.0205:
            f.material_index = 1  # inside: ivory (for the charcoal mug; the ivory one is the same colour)
    parts = [body]
    cy = h2 - 0.012  # the coffee 1.2 cm under the lip, a 3 mm crema ring round its edge (closed discs)
    parts += [cyl("crema", lip_in - 0.0002, 0.0008, (cx, cy, 0), crema, G, 40),
              cyl("coffee", lip_in - 0.003, 0.0008, (cx, cy + 0.0004, 0), coffee, G, 40)]
    if k == 0:  # a gold band 3 mm under the lip (a closed ring)
        parts.append(lathe("mug_band", [(R - 0.001, h2 - 0.007), (R + 0.0003, h2 - 0.007), (R + 0.0003, h2 - 0.004),
                                        (R - 0.001, h2 - 0.004), (R - 0.001, h2 - 0.007)], (cx, 0, 0),
                           plastic("#c9a46a", 0.3, 0.8, 0.05, "mug_gold"), G, 40))
    # the C handle: from 1.5 cm under the lip to 2 cm over the foot, 6.8 cm outside; its section 0.9 across the loop,
    # 1.4 along z; the opening ~3.8 cm high (2 robot fingers + 4 mm) and ~3.4 cm deep
    xs = cx + R - 0.002
    pts = [(xs, h2 - 0.015, 0), (xs + 0.03, h2 - 0.012, 0), (xs + 0.043, h2 - 0.03, 0), (xs + 0.043, y0 + 0.032, 0),
           (xs + 0.028, y0 + 0.018, 0), (xs, y0 + 0.02, 0)]
    hd = rail("mug_handle", pts, 0.0045, glaze, G)
    hd.data.resolution_u, hd.data.bevel_resolution = 6, 2
    hd.scale = (1.0, 0.007 / 0.0045, 1.0)  # Blender y = web -z: 1.4 cm across
    parts.append(hd)
    return parts


CAN_Y_BOTTOM = -0.235  # the can's bottom under its origin (the handle's top run)


def can_parts(G):
    """the watering can in its frame: origin = the middle of the handle's top run, +x = toward the spout. Returns
    (objects, the rose's centre, the water's direction) in that frame"""
    paint = plastic("#5f7f62", 0.75, 0.1, 0.15, "can_paint")
    band = plastic("#4b6650", 0.75, 0.1, 0.15, "can_band")
    brass = plastic("#b08d57", 0.35, 0.85, 0.05, "can_brass")
    dark = plastic("#1d2420", 0.9, 0, 0.0, "can_dark")
    xb, yb = 0.035, CAN_Y_BOTTOM  # the body's axis and bottom
    H, R0, R1 = 0.16, 0.075, 0.07  # 15 x 11 cm oval (x : z), 16 cm high, 1 cm narrower at the top
    yt = yb + H
    prof = [(0.0, 0.0), (R0 - 0.004, 0.0), (R0, 0.004), (R0 - 0.0008, 0.06), (R1, H - 0.008), (R1 - 0.006, H), (0.0, H)]
    body = lathe("can_body", prof, (xb, yb, 0), paint, G, 40)
    body.data.transform(Matrix.Diagonal((1.0, 0.11 / 0.15, 1.0, 1.0)))  # oval: Blender y = web -z
    rim = lathe("can_band", [(R0 - 0.002, 0.0), (R0 + 0.0006, 0.0), (R0 + 0.0006, 0.01), (R0 - 0.002, 0.01), (R0 - 0.002, 0.0)],
                (xb, yb, 0), band, G, 40)
    rim.data.transform(Matrix.Diagonal((1.0, 0.11 / 0.15, 1.0, 1.0)))
    seam = box("can_seam", (0.0012, H - 0.02, 0.0012), (xb, yb + H / 2, -(0.055 + 0.0004)), band, G)  # a side seam
    # the filling hole: top back third, 6 cm, with a rolled lip and the dark inside
    ox = xb - 0.04
    hole = [torus("can_mouth", 0.03, 0.003, (ox, yt + 0.002, 0), paint, G, seg=28, rseg=6),
            cyl("can_mouth_in", 0.0285, 0.002, (ox, yt + 0.0005, 0), dark, G, 24)]
    # the handle: one arch from low on the back (4 cm up) up and over to the top's front third; Ø1.6 cm; a 10 cm
    # level run on top (the grip, at the origin); room under it for four fingers
    hp = [(xb - 0.069, yb + 0.04, 0), (xb - 0.1, yb + 0.1, 0), (xb - 0.09, -0.012, 0), (-0.05, 0.0, 0), (0.0, 0.0, 0),
          (0.05, 0.0, 0), (xb + 0.04, -0.025, 0), (xb + 0.035, yt + 0.002, 0)]
    handle = rail("can_handle", hp, 0.008, paint, G)
    handle.data.resolution_u, handle.data.bevel_resolution = 5, 2
    # the spout: from 2.5 cm over the bottom at the front, 38° up, 28 cm, Ø1.8 -> 1.0 cm; its tip 2 cm over the top
    a = math.radians(38)
    d = Vector((math.cos(a), math.sin(a), 0.0))
    s0 = Vector((xb + R0 - 0.006, yb + 0.025, 0.0))
    s1 = s0 + d * 0.28
    spout = segment("can_spout", tuple(s0), tuple(s1), 0.009, paint, G, verts=16, r2=0.005)
    # the rose: a brass disc 3.6 cm across on a short cone, turned 10° down from the spout; 19 holes
    a2 = math.radians(38 - 10)
    d2 = Vector((math.cos(a2), math.sin(a2), 0.0))
    neck = segment("can_rose_neck", tuple(s1 - d * 0.004), tuple(s1 + d2 * 0.016), 0.0055, brass, G, verts=16, r2=0.016)
    rc = s1 + d2 * 0.019
    face = lathe("can_rose", [(0.0, -0.004), (0.016, -0.004), (0.018, -0.003), (0.018, 0.0), (0.0, 0.0)], (0, 0, 0), brass, G, 32)
    face.matrix_world = Matrix.Translation(W(*rc)) @ wv(d2).to_track_quat("Z", "Y").to_matrix().to_4x4()  # geometry: lathe axis -> d2
    holes = []
    for k in range(19):  # 1 + 6 + 12 in rings
        ring, j = (0, 0) if k == 0 else ((1, k - 1) if k < 7 else (2, k - 7))
        rr = (0.0, 0.0065, 0.0125)[ring]
        ang = 2 * math.pi * j / (1, 6, 12)[ring]
        hdisc = cyl("can_hole", 0.0011, 0.0004, (0, 0, 0), dark, G, 8)
        hdisc.matrix_world = face.matrix_world @ Matrix.Translation((rr * math.cos(ang), rr * math.sin(ang), 0.0003))
        holes.append(hdisc)
    objs = [body, rim, seam, handle, spout, neck, face] + hole + holes
    return objs, tuple(rc + d2 * 0.002), tuple(d2)


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
    ply, gilt = plastic("#8a5a35", 0.6, 0, 0.3, "paddle_ply"), plastic("#c9a465", 0.35, 0.9, 0.1, "paddle_badge")

    rim_m = plastic("#8a6a2a", 0.4, 0.8, 0.1, "paddle_badge_rim")

    def squash(o, k):
        """flatten the handle across the blade (web z): an oval section. A y-axis cylinder: web z = Blender local -y"""
        o.data.transform(Matrix.Diagonal((1.0, k, 1.0, 1.0)))
        return o

    def oval_plate(name, r, depth, at, m):
        o = cyl(name, r, depth, at, m, G, 20, axis="z")
        o.data.transform(Matrix.Diagonal((1.4, 1.0, 1.0, 1.0)))
        return o

    S = 20  # #280 3 (room-280.md 6.2): blade segments; a paddle ~530 triangles (was 612)

    def oval_obj(name, bm, m, z):
        o = mesh_obj(name, bm, m, G)
        o.location = W(0, 0.17, z)
        o.rotation_euler = (math.pi / 2, 0, 0)  # the cone's local +z = web +z
        o.data.transform(Matrix.Diagonal((1.0, 0.16 / 0.15, 1.0, 1.0)))  # local y = web y after the axis turn
        return smooth(o)

    def blade_band(name, r, depth, z, m):
        """the blade's edge only (its faces lie under the rubbers): an open oval tube"""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=False, segments=S, radius1=r, radius2=r, depth=depth)
        return oval_obj(name, bm, m, z)

    def rubber(name, sign, m):
        """a rubber face flush with the blade's edge, 1 mm: the top inset 2 mm, its ring and edge the dark sponge (the
        rim, designer), no bottom cap (it sits on the blade)"""
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=S, radius1=0.075, radius2=0.075, depth=0.001)
        bm.faces.ensure_lookup_table()
        top = next(f for f in bm.faces if f.normal.z * sign > 0.9)
        bot = next(f for f in bm.faces if f.normal.z * sign < -0.9)
        bmesh.ops.delete(bm, geom=[bot], context="FACES_ONLY")
        bmesh.ops.inset_region(bm, faces=[top], thickness=0.002, depth=0.0)
        for f in bm.faces:
            f.material_index = 0 if f is top else 1
        o = oval_obj(name, bm, m, sign * 0.0025)
        o.data.materials.append(sponge)
        return o

    sponge = plastic("#2a2324", 0.85, 0, 0.1, "paddle_sponge")
    for end, bx, bz, rz in (("a", tx - 0.6, tz + 0.25, -math.pi / 2), ("b", tx + 0.62, tz - 0.25, math.pi / 2)):
        # the handle flares toward its end (FL, 3.4 -> 2.6 cm), a darker centre ply along its sides, a rounded throat
        objs = [squash(cyl("grip", 0.017, 0.1, (0, 0.05, 0), wood_h, G, 12, r2=0.013), 0.8),
                squash(cyl("ply", 0.0172, 0.096, (0, 0.05, 0), ply, G, 12, r2=0.0132), 0.1),
                # the blade's edge in five plies: light wood with two dark lines 0.2 mm proud
                blade_band("blade", 0.075, 0.004, 0.0, wood_h),
                blade_band("blade_ply", 0.0752, 0.0005, 0.0009, ply),
                blade_band("blade_ply", 0.0752, 0.0005, -0.0009, ply),
                rubber("rubber_red", 1, red),
                rubber("rubber_black", -1, black),
                # the throat sits inside the rubber faces (it z-fought them: a sawtooth edge in the app)
                cyl("throat", 0.02, 0.0044, (0, 0.093, 0), wood_h, G, 12, axis="z")]
        for sz in (1, -1):  # the logo plate: a flat oval brass badge on each face of the handle
            o_ = cyl("badge", 0.0062, 0.0006, (0, 0.06, sz * 0.0121), gilt, G, 10, axis="z")
            o_.data.transform(Matrix.Diagonal((1.4, 1.0, 1.0, 1.0)))
            objs.append(o_)
        hx = bx + (-0.17 if end == "a" else 0.17)  # handle end sits 0.17 m behind the blade center
        out.append(prop(f"prop_paddle_{end}", "paddle", objs, (hx, th + 0.003, bz), (-math.pi / 2, 0.0, rz),
                        grip_pos=(0, -0.02, 0), grip_rot=(math.pi, 0, 0)))
    # the ball is pp_ball now (build_play_lives): the app moves it, PropBank must not pick it up
    # mugs (#156, designer: a 350 ml stoneware mug): origin at the handle side (local +x), the body centred at x -0.072.
    # 8.2 cm across, 9.5 cm high, 4.5 mm wall with a rounded lip (the inner wall shows), coffee 1.2 cm under the lip
    # with a crema ring, an unglazed foot ring, a C handle (1.4 x 0.9 cm section) whose opening fits two robot fingers.
    # _0 ivory with a gold band, _1 charcoal with an ivory inside. Home on the counter, handle toward the room
    C = counter_frame()
    for k, (bx, bz) in enumerate(((0.14, -0.12), (0.19, 0.07))):  # counter frame: under the spout, and beside it
        out.append(prop(f"prop_cup_{k}", "cup", mug_parts(k, G), *mug_home(C, bx, bz, DRIP_TOP if k == 0 else 0.94)))  # #280 3: _0 on the drip tray
    # watering can (#156, designer: an indoor 1.5 L metal can): origin at the middle of the handle's top run (the grip),
    # the oval body below, the long spout from low on the front, a brass rose. Home on the floor by the corner plant
    objs, rose_at, rose_dir = can_parts(G)
    # #185: on its stand in front of the fig (designer); the handle toward
    # the fig's stand spot
    # #416: turned 180° (spout north-east), so the hand takes and sets it down without turning it; the stand moved
    # 3.5 cm west with it (CAN_STAND), or the spout's rose crossed the east wall by 5 mm
    can = prop("prop_watering_can", "watering_can", objs, (CAN_STAND[0], 0.36 - CAN_Y_BOTTOM, CAN_STAND[1]), (0.0, math.pi / 4, 0.0))
    out.append(can)
    # the spout's end (#135): where the water starts, local +z = along the spout (the app tilts the can to pour)
    a = math.atan2(0.10, 0.13)
    e = bpy.data.objects.new("prop_watering_can_spout", None)
    coll("export").objects.link(e)
    e.parent = can
    # local +z along the spout (up and out): from the direction itself (an Euler here lost the upward tilt, #184)
    e.matrix_world = can.matrix_world @ Matrix.Translation(W(*rose_at)) @ web_z_along(rose_dir)  # the rose's centre, the water's way
    NODES.append({"obj": e, "play": "spout"})
    # omok stones in the hand (#135: the chess pieces became go stones): a = black, b = white, home on the heap in
    # its bowl, next to the sample stone. Center pivot, held in the pinch ("OK hand", agents.md 2.7): the point where
    # the index and thumb tips meet differs per hand in the _grip frame (measured in the preview, hold_piece), so
    # extras grip_lr = {l, r} gives each hand's offset; grip = the right hand's
    for end, side, m in zip("ab", "bw", stone_mats()):
        x, y, z = OMOK_BOWLS[side]
        o = prop(f"prop_piece_{end}", "piece", [lens("piece", OMOK["stone_d"], OMOK["stone_h"], (0, 0, 0), m, G)],
                 (x + (0.014 if side == "b" else -0.014), y + 0.006, z), grip_pos=PINCH_GRIP["r"])
        o["grip_lr"] = {s: {"pos": list(PINCH_GRIP[s]), "rot": [0, 0, 0]} for s in "lr"}
        out.append(o)
    # a book to read on the sofa (#135, play.md): closed 0.15 x 0.22 x 0.025 on the side table. prop_book is the
    # spine (the prop PropBank carries); its two halves are live bot nodes the app attaches to it and turns
    # about the spine (local z through the pivot): prop_book_l (the upper half) opens by +180° to lie flat at -x
    out.append(build_book(G))
    # #199: five books to take from the library shelves (grips.md 2.1): on shelves 1 · 3 (#280 3; were 1 · 2 · 3), 3 · 2
    # at the right end, past the binders, the bookend and the books lying flat. Standing, spine to the room: the book
    # frame turned by (-90°, 0, 90°) (three.js XYZ) puts the spine axis (local z) up, the pages (+x) into the shelf
    # and the front cover (+y) toward -x. A little lean on the outer one
    SBRNG = random.Random(199)
    COVERS = SBRNG.sample(["#c0392b", "#2c3e50", "#16a085", "#8e44ad", "#d4a017", "#34495e", "#e67e22"], 5)
    right = SHELF2_X + SHELF2_W / 2 - 0.015 - 0.004  # #280 (room-280.md 9.2): the second bookcase's inner right face, a gap
    k = 0
    for row, n in SHELFBOOK_ROWS:  # #280 3: shelves 1 and 3 (3 . 2); shelf 2 is all binders
        x = right
        for slot in range(n):
            T = SBRNG.uniform(0.026, 0.04)
            H_ = SBRNG.uniform(0.22, 0.27)
            W_ = SBRNG.uniform(0.16, 0.19)
            col = COVERS[k]  # five different covers
            x -= T / 2
            pos = (x, shelf_top(row) + H_ / 2, SPINE_Z - 0.004)
            o = make_book(f"prop_shelfbook_{k}", W_, H_, T, col, pos, (-math.pi / 2, 0.0, math.pi / 2), G)
            o["size"], o["spine"], o["cover"] = [round(W_, 3), round(H_, 3), round(T, 3)], "z", col
            o["shelf_row"], o["shelf_slot"] = row, n - 1 - slot  # from the left among the right-end books
            o["shelf"] = 2  # #280: on the second bookcase (shelf_2)
            out.append(o)
            x -= T / 2 + 0.002
            k += 1
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
    # #262 (paper-pass.md 5): a loose A4 sheet, prop_paper, handed over between agents; home on MEMO's IN tray, over
    # the five live sheets (the app keeps it hidden until a hand-off). Its halves fold about the middle line
    out.append(paper_sheet(desk0(TRAY[0], DESK_H + 0.075 + 0.003 + 5 * 0.003 + 0.002, TRAY[1] + 0.012), (0.0, ry0, 0.0), G))
    # sign-off stamp (#43; #187: rubber face, amber body, brass band, waisted neck, turned knob - seat_memo): origin
    # at the body's center, face = local -y. Home: by the ink pad (moved with the kit's mouse pad). Grip: in the fist
    objs, H = SEAT_PROPS["prop_stamp"]
    out.append(prop("prop_stamp", "stamp", objs, *web_pose(H), grip_pos=(0, -0.03, 0), grip_rot=(-math.pi / 2, 0, 0)))
    # #187 (desk-props.md 5): LOOP's rubber duck and one teal keycap are props now (the duck is held up to talk to on a
    # failure, the keycap fiddled with); their grips and contacts are in build_hands
    for name, kind in (("prop_duck", "duck"), ("prop_keycap_0", "keycap"), ("prop_headphones", "headphones")):
        objs, H = SEAT_PROPS[name]
        out.append(prop(name, kind, objs, *web_pose(H), grip_pos=(0, -0.03, 0), grip_rot=(-math.pi / 2, 0, 0)))
    # #164: things written with are props now (HUE draws with the tablet pen, MEMO writes with a marker). Pens lie
    # along local z, the tip at -z, centre pivot; the old grip extras as MEMO's pen
    PEN_GRIP = dict(grip_pos=(0, -0.04, 0), grip_rot=(math.pi / 2, 0, 0))
    # HUE's tablet pen (a stylus: tapered barrel, rubber grip sleeve, nib, two side buttons, end cap), on the tablet
    F2 = frame(AGENTS[2]["at"])
    dark_p, rubber = plastic("#1a1c21", 0.4, 0.2, 0, "pen_dark"), plastic("#2a2d33", 0.85, 0, 0.3, "pen_rubber")
    objs = [cyl("pen_barrel", 0.0055, 0.11, (0, 0, 0.005), dark_p, G, 16, axis="z", r2=0.0045),
            cyl("pen_sleeve", 0.006, 0.035, (0, 0, -0.04), rubber, G, 16, axis="z", r2=0.0058),
            cyl("pen_nib", 0.0045, 0.012, (0, 0, -0.064), plastic("#c8ccd4", 0.3, 0.6, 0, "chrome"), G, 12, axis="z", r2=0.0008),
            cyl("pen_end", 0.0047, 0.006, (0, 0, 0.063), plastic(AGENTS[2]["color"], 0.4, 0, 0.05, "pen_end"), G, 16, axis="z", bev=0.001),
            box("pen_button", (0.003, 0.002, 0.008), (0, 0.0058, -0.012), rubber, G, bev=0.0006, seg=1),
            box("pen_button", (0.003, 0.002, 0.006), (0, 0.0058, -0.002), rubber, G, bev=0.0006, seg=1)]
    # #187 (designer): its home is the pen cup right of the tablet, tip down, tilted 15 deg back (seat_hue)
    out.append(prop("prop_tablet_pen", "tablet_pen", objs, *web_pose(SEAT_PROPS["prop_tablet_pen"][1]), **PEN_GRIP))
    # whiteboard markers on the tray (cap over the tip, white barrel with a colour band, colour end plug)
    zb = -HZ + 0.02
    for k, col in enumerate(("#1f6feb", "#d64545", "#111111")):
        cm = plastic(col, 0.4, 0, 0, f"marker_{k}")
        objs = [cyl("marker_body", 0.0075, 0.08, (0, 0, 0.015), plastic("#ebe8e1", 0.45, 0, 0.05, "marker_body"), G, 16, axis="z", bev=0.0008),
                cyl("marker_cap", 0.0085, 0.035, (0, 0, -0.0425), cm, G, 16, axis="z", bev=0.001),
                box("marker_clip", (0.003, 0.002, 0.022), (0, 0.0092, -0.04), cm, G, bev=0.0005, seg=1),
                cyl("marker_band", 0.008, 0.012, (0, 0, 0.03), cm, G, 16, axis="z"),  # #263: 0.5 mm proud of the body
                cyl("marker_plug", 0.006, 0.006, (0, 0, 0.058), cm, G, 12, axis="z", bev=0.001)]
        out.append(prop(f"prop_marker_{k}", "marker", objs, (WHITEBOARD_X - 0.42 + k * 0.14, 0.9975 + 0.0085, zb + 0.04),
                        (0.0, math.pi / 2, 0.0), **PEN_GRIP))
    return out


def build_hands():
    """#164: grips and contact points per object (grips.md); after every prop and agent is built"""
    O = bpy.data.objects
    R, L = "r", "l"
    # mug (right hand; its mirror for the left): grip 1.5 cm out from the handle's outer middle, fingers through the
    # loop, palm toward the body (#156: the new mug, handle loop out to x = -0.031 + 0.043 + 0.0045)
    hx = -0.072 + MUG_R - 0.002
    for k in range(2):
        o = O[f"prop_cup_{k}"]
        for side, fz in ((R, -1.0), (L, 1.0)):
            grip_at(o, side, (hx + 0.043 + 0.0045 + 0.015, 0, 0), (0, 0, fz), (-1, 0, 0))
        for side in ("", L):
            contact(o, "index", (hx + 0.018, MUG_H / 2 - 0.0125 - 0.0045, 0), (0, -1, 0), side)  # inside the loop, at its top
            contact(o, "thumb", (hx + 0.018, MUG_H / 2 - 0.0125 + 0.0045, 0), (0, 1, 0), side)  # on top of the handle
            contact(o, "ring", (-0.072 + MUG_R - 0.0012, -MUG_H / 2 + 0.03, 0), (1, 0, 0), side)  # the body's lower third
    # paddles (right hand, shakehand): grip mid-handle, fingers wrapping front (red, +z) to back, palm to the axis
    for e in "ab":
        o = O[f"prop_paddle_{e}"]
        grip_at(o, R, (0, 0.05, 0), (0, 0, -1), (-1, 0, 0))
        contact(o, "index", (0.02, 0.115, -0.003), (0, 0, -1))  # the black face, low on the blade
        contact(o, "thumb", (-0.01, 0.1, 0.003), (0, 0, 1))  # the red face where blade meets handle
    # book (both hands, open): left palm under the spine, right palm under the right page; left thumb on the left
    # page, the right index turns the top right corner. Book frame: spine on z, pages +x, open pages at y = 0
    o = O["prop_book"]
    grip_at(o, L, (0, -0.0125, 0), (-1, 0, 0), (0, 1, 0))
    grip_at(o, R, (0.075, -0.0125, 0), (-1, 0, 0), (0, 1, 0))
    contact(o, "thumb", (-0.075, 0, 0), (0, 1, 0), L)["state"] = "open"  # on the left page once open (check-glb skips it)
    contact(o, "index", (0.14, 0, -0.1), (0, 1, 0))
    # watering can (both): right fist round the handle's top run (palm down on it, fingers wrapping), left palm up
    # under the body's front (#156: the new can; its bottom at CAN_Y_BOTTOM)
    o = O["prop_watering_can"]
    grip_at(o, R, (0, 0, 0), (0, 0, 1), (0, -1, 0))
    grip_at(o, L, (0.08, CAN_Y_BOTTOM - 0.012, 0), (1, 0, 0), (0, 1, 0))
    contact(o, "palm", (0, 0.008, 0), (0, 1, 0))
    contact(o, "palm", (0.08, CAN_Y_BOTTOM, 0), (0, -1, 0), L)
    # omok: the hand dips into a bowl (3 cm below the mouth's centre); the stone in hand, go style: middle on top,
    # index under it (the app sticks it to the fingers, agents.md 2.10, #192)
    for side in "bw":
        x, y, z = OMOK_BOWLS[side]
        contact(f"omok_bowl_{side}", "index", (0, 0, 0), (0, 1, 0), M=Mx((x, y - 0.002 - 0.03, z)))
    for e in "ab":
        o = O[f"prop_piece_{e}"]
        contact(o, "middle", (0, OMOK["stone_h"] / 2, 0), (0, 1, 0))  # go style (Nihon Ki-in): the middle finger on top
        contact(o, "index", (0, -OMOK["stone_h"] / 2, 0), (0, -1, 0))  # the index nail under the stone (designer, #192)
    # #262 the A4 sheet: a pinch at each short edge, 1.5 cm in (grip_r near = -z, grip_r_far = +z): the fingers reach
    # into the sheet, the palm faces down; the thumb on the writing face, the index under it. contact_palm: the middle
    # of the underside (a hand passing it on the flat palm)
    o = O["prop_paper"]
    for edge, sz in (("", -1), ("_far", 1)):
        z = sz * (PAPER[1] / 2 - 0.015)
        g_ = grip_at(o, "r" + edge, (0, 0, z), (0, 0, -sz), (0, -1, 0))
        g_["grip_for"], g_["edge"] = "r", "far" if edge else "near"
        nm = "far" if edge else "near"
        contact(o, "thumb", (0, PAPER[2] / 2, z), (0, 1, 0), nm)
        contact(o, "index", (0, -PAPER[2] / 2, z), (0, -1, 0), nm)
    contact(o, "palm", (0, -PAPER[2] / 2, 0), (0, -1, 0))
    # #280 (paper-pass.md 5, user: hold it by the sides to read): prop_paper_grip_side_l | _r on the long edges 1.5 cm
    # in, 45% up from the near short edge (1.5 cm under the fold), children of the near half prop_paper_a (they fold
    # with it). The reader stands at the near edge facing +z: their right is -x. Thumb on the writing face, index
    # behind; the fingers reach into the sheet, palm as the other paper grips
    pa = bpy.data.objects["prop_paper_a"]
    zs_ = -PAPER[1] / 2 + 0.45 * PAPER[1]
    for s_, sx in (("r", -1), ("l", 1)):
        x_ = sx * (PAPER[0] / 2 - 0.015)
        nm = f"prop_paper_grip_side_{s_}"
        child_empty(pa, nm, pa.matrix_world @ grip_frame((x_, 0, zs_), (-sx, 0, 0), (0, -1, 0), s_), {"grip_for": s_, "pose": "side_read"})
        for part, y_, n_ in (("thumb", PAPER[2] / 2, 1), ("index", -PAPER[2] / 2, -1)):
            child_empty(pa, f"{nm}_contact_{part}", pa.matrix_world @ Matrix.Translation(W(x_, y_, zs_)) @ web_z_along((0, n_, 0)), {"contact": part})
    # paper plane (OK pinch): index and thumb 2 cm from the tail (+z), on the top and bottom faces
    o = O["prop_plane"]
    lo, hi = [min(v.co[k] for v in o.data.vertices) for k in range(3)], [max(v.co[k] for v in o.data.vertices) for k in range(3)]
    tail = -lo[1] - 0.02  # Blender local -y = web +z
    contact(o, "index", (0, hi[2], tail), (0, 1, 0))
    contact(o, "thumb", (0, lo[2], tail), (0, -1, 0))
    # shelf books (#199, grips.md 2.1): hook the index on the head 1 cm in from the spine, the thumb on the front cover
    # by the spine, the palm on the spine (pushing it home); the right hand holds the spine, palm to it
    for k in range(5):
        o = O[f"prop_shelfbook_{k}"]
        W_, H_, T = o["size"]
        grip_at(o, R, (-0.012, 0, 0), (0, -1, 0), (1, 0, 0))
        contact(o, "index", (0.01, 0, H_ / 2 - 0.005), (0, 0, 1))  # the page block's head (5 mm under the boards)
        contact(o, "thumb", (0.012, T / 2, 0), (0, 1, 0))
        contact(o, "palm", (-0.003, 0, 0), (-1, 0, 0))
    # #231 1 (grips.md 2, the open book held in both hands): per half, children of the half (they open with it; the
    # bake is flat, the app raises each half 15 deg). In the half's own (closed) frame: spine on z, the page block
    # to +x, the foot at +z (the ribbon's end), the cover's outer face at y = sgn T/2, the inner page at y = 0.
    # _l = the left page (left hand), _r = the right page (right hand). The palm lies on the cover behind the
    # book's lower third, the fingers flat on it toward the spine, the thumb over the fore-edge onto the paper
    for book in ["prop_book"] + [f"prop_shelfbook_{k}" for k in range(5)]:
        W_, H_, T = O[book]["size"] if "size" in O[book].keys() else (0.15, 0.22, 0.025)
        zl = H_ / 3  # the middle of the lower third
        for hs, sgn in (("l", 1), ("r", -1)):
            o = O[f"{book}_{hs}"]
            yc = sgn * T / 2
            child_empty(o, f"{book}_{hs}_grip", o.matrix_world @ grip_frame((W_ - 0.035, yc, zl), (-1, 0, 0), (0, -sgn, 0), hs),
                        {"grip_for": hs, "pose": "open_book"})
            # the thumb on the paper (_r: just over the turning page, 0.3-0.4 mm up; _l: on its text lines' level)
            # #231 (grips.md, #381): 25 mm in from the cover's outer edge (19.5 mm from the paper's): at 15 mm the hand
            # could not reach it within 3 mm without going through the book
            contact(o, "thumb", (W_ - 0.025, 0.0005 if sgn < 0 else -0.0003, zl), (0, -sgn, 0))
            for part, dz in zip(("index", "middle", "ring", "little"), (-0.027, -0.009, 0.009, 0.027)):
                contact(o, part, (W_ * 0.55, yc, min(zl + dz, H_ / 2 - 0.01)), (0, sgn, 0))  # flat on the cover
    # stamp: grip over the knob's head, fingers level, palm down
    grip_at(O["prop_stamp"], R, (0, 0.0574, 0), (0, 0, -1), (0, -1, 0))  # #187: the turned knob's top is at 0.0474
    contact(O["prop_stamp"], "palm", (0, 0.0474, 0), (0, 1, 0))
    # #187: the duck held over its back, fingers toward its head, thumb and index on its flanks
    grip_at(O["prop_duck"], R, (-0.012, 0.05, 0), (1, 0, 0), (0, -1, 0))
    contact(O["prop_duck"], "palm", (-0.012, 0.0404, 0), (0, 1, 0))
    contact(O["prop_duck"], "thumb", (-0.008, 0.02, 0.0293), (0, 0, 1))
    contact(O["prop_duck"], "index", (-0.008, 0.02, -0.0293), (0, 0, -1))
    # #187: the keycap pinched by its skirt (thumb and index on two opposite sides, half way up)
    grip_at(O["prop_keycap_0"], R, (0, 0.025, 0), (0, -0.3, -1), (0, -1, 0))
    contact(O["prop_keycap_0"], "thumb", (0, 0.0036, 0.0077), (0, 0.36, 0.93))
    contact(O["prop_keycap_0"], "index", (0, 0.0036, -0.0077), (0, 0.36, -0.93))
    # #187: the headphones held by the band's middle (grips.md), the palm on the right cup's back when held to an ear
    grip_at(O["prop_headphones"], R, (0, 0.03, 0), (0, 0, -1), (0, -1, 0))
    contact(O["prop_headphones"], "palm", (0.085 + 0.012 + 0.015, -0.085 - 0.045, 0), (1, 0, 0))
    # pens (tripod): MEMO's pen (tip = the capped end, -z), the tablet pen, the markers
    tripod(O["agent_0_pen"], -0.085, 0.009)
    tripod(O["prop_tablet_pen"], -0.07, 0.006)
    # #305 (planning: the tablet stays, the pen draws on it): the nib's end in the pen's frame, and the tablet's active
    # area in desk_2_tablet's frame (centred on its pivot; the area's top 0.4 mm under the pivot)
    O["prop_tablet_pen"]["tip"] = [0.0, 0.0, -0.07]
    O["desk_2_tablet"]["area"] = {"w": 0.18, "d": 0.115, "top": -0.0004}
    for k in range(3):
        tripod(O[f"prop_marker_{k}"], -0.06, 0.0085)
    # baked things: the mouse (palm over it, index on the left button) and the coffee machine's button
    for i, a in enumerate(AGENTS):
        if i == 2:
            continue
        F = frame(a["at"])
        grip_at(f"desk_{i}_mouse", R, (0.3, DESK_H + 0.055, 0.085), (0, -0.3, -1), (0, -1, 0), M=F)  # #187 kit mouse (pad z 0.10)
        contact(f"desk_{i}_mouse", "index", (0.288, DESK_H + 0.0301, 0.04), (0, 1, 0), M=F)  # on desk_<i>_mouse_l
        contact(f"desk_{i}_mouse", "middle", (0.312, DESK_H + 0.0301, 0.04), (0, 1, 0), M=F)  # #187: on desk_<i>_mouse_r
    # #187 (grips.md rows 49-63): the desk things' hand points, in each desk's frame (positions as in seat_*)
    h = DESK_H
    Fd = [frame(a["at"]) for a in AGENTS]
    tx, tz = TRAY[0], TRAY[1]
    top = h + 0.075 + 0.003 + 5 * 0.003  # MEMO's IN stack, 5 sheets: the top sheet's right front corner
    contact("desk_0_in", "thumb", (tx + 0.095, top, tz + 0.012 + 0.12), (0, 1, 0), M=Fd[0])
    contact("desk_0_in", "index", (tx + 0.095, top - 0.003, tz + 0.012 + 0.12), (0, -1, 0), M=Fd[0])
    Hg = Fd[0] @ Mx((-0.50, h + 0.055, -0.22))  # the hourglass: palm over the top plate, thumb on a post
    grip_at("desk_0_hourglass", R, (0, 0.07, 0), (0, 0, -1), (0, -1, 0), M=Hg)
    contact("desk_0_hourglass", "palm", (0, 0.055, 0), (0, 1, 0), M=Hg)
    contact("desk_0_hourglass", "thumb", (0.0305, 0.0, 0.0), (1, 0, 0), M=Hg)
    ttx, ttz = -0.43, -0.18  # MESH's turntable: the button, the platter's rim
    contact("desk_1_turntable", "index", (ttx, h + 0.0105, ttz + 0.103), (0, 0, 1), M=Fd[1])
    contact("desk_1_turntable_rim", "index", (ttx, h + 0.018 + 0.01, ttz + 0.075), (0, 1, 0), M=Fd[1])
    kx_, ky_, kz_ = 0.46 + 0.012, h + 0.282, -0.20  # the ring light's angle knob, pinched from above and below
    contact("desk_1_ringlight", "thumb", (kx_, ky_ + 0.011, kz_), (0, 1, 0), M=Fd[1])
    contact("desk_1_ringlight", "index", (kx_, ky_ - 0.011, kz_), (0, -1, 0), M=Fd[1])
    contact("desk_2_lamp", "index", (-0.52 + 0.022, h + 0.0185, -0.26 + 0.02), (0, 1, 0), M=Fd[2])  # the base switch
    grip_at("desk_2_swatch", "l", (-0.40, h + 0.04, -0.16 + 0.04), (0, -1, 0), (0, 0, -1), M=Fd[2])  # the fan's pin
    contact("desk_2_swatch", "index", (-0.40 + 0.06, h + 0.12, -0.16 + 0.006), (0, 0, 1), M=Fd[2])  # a chip's face
    contact("desk_3_signal", "index", (0.47, h + 0.069 + 0.0225 + 2 * 0.045, -0.24 + 0.025), (0, 0, 1), M=Fd[3])  # top cell
    Mm = Fd[4] @ Mx((-0.46, h, 0.10), rx=-math.radians(6))  # ECHO's faders: the fingertip on the cap's top
    for k in range(4):
        contact(f"desk_4_fader_{k}", "index", (-0.08 + 0.018 + k * 0.03, 0.03 + 0.001 + 0.0084, 0.0425), (0, 1, 0), M=Mm)
    contact("coffee_button", "index", COFFEE_BUTTON, (1, 0, 0), M=counter_frame())


# ================================================================ EXIT DOOR (part of room atlas + live screen)
def build_door():
    G = "door"
    ivory = plastic("#e8e1cf", 0.45, 0, 0.15, "ivory")
    dark = plastic("#16181d", 0.5, 0.3, 0.05, "bezel")
    x = -HX + 0.03
    p = [panel("door_body", 1.05, 2.2, 0.12, 0.12, (0, 0, 0), ivory, G, edge=0.01),
         panel("door_bezel", 0.86, 1.86, 0.02, 0.08, (0, 0, 0.06), dark, G)]
    # #280 3 (room-280.md 6.2, designer PR #347). The door frame: local x across (+x = north, the umbrella stand's
    # side = the hinges), y up (floor at -1.12), z out of the wall (the wall at -0.09, the slab's face at 0.06).
    # The screen is the door's glass: a 1.5 cm metal glass frame round it, no frosted strip; the two knobs are gone
    alu = plastic("#b9bec7", 0.3, 0.8, 0.03, "door_alu")
    gra = plastic("#33373e", 0.45, 0.4, 0.1, "door_casing")
    sw_, sh_, sy_ = 0.8, 1.78, 0.02  # the screen quad (below): its size and height in this frame
    for s_ in (-1, 1):
        p += [box("door_glass_frame", (sw_ + 0.03, 0.015, 0.01), (0, sy_ + s_ * (sh_ / 2 + 0.0075), 0.073), alu, G, bev=0.002, seg=1),
              box("door_glass_frame", (0.015, sh_, 0.01), (s_ * (sw_ / 2 + 0.0075), sy_, 0.073), alu, G, bev=0.002, seg=1)]
    # the casing: 7 cm graphite boards on the wall round the opening, 5 cm proud (the slab stands in it)
    ow, oh = 1.05 / 2 + 0.003, 1.1 + 0.003  # the opening's half width, its top over the centre
    for s_ in (-1, 1):
        p.append(box("door_casing", (0.07, oh + 1.12 + 0.068, 0.05), (s_ * (ow + 0.035), (oh + 0.068 - 1.12) / 2, -0.065), gra, G, bev=0.004, seg=2))
    p.append(box("door_casing", (2 * ow + 0.144, 0.07, 0.052), (0, oh + 0.035, -0.065), gra, G, bev=0.004, seg=2))  # 1 mm proud of the sides (no shared face)
    # three hinges on the north edge, a brushed threshold strip on the floor across the opening
    for hy in (-0.8, 0.0, 0.8):
        p += [cyl("door_hinge", 0.007, 0.09, (ow + 0.004, hy, 0.0), alu, G, 12),
              cyl("door_hinge_tip", 0.004, 0.012, (ow + 0.004, hy + 0.051, 0.0), alu, G, 8),
              cyl("door_hinge_tip", 0.004, 0.012, (ow + 0.004, hy - 0.051, 0.0), alu, G, 8)]
    p.append(box("door_threshold", (2 * ow - 0.002, 0.012, 0.15), (0, -1.12 + 0.006, -0.015), plastic("#9aa0aa", 0.4, 0.7, 0.05, "door_threshold"), G, bev=0.003, seg=1))
    # the lever's plate and rose on the south margin (the screen's side margin, 1.0 m up); the lever is live (below)
    lx_, ly_ = -(sw_ / 2 + 0.015 + (1.05 / 2 - sw_ / 2 - 0.015) / 2), 1.0 - 1.12
    p += [box("door_lever_plate", (0.04, 0.18, 0.006), (lx_, ly_, 0.063), alu, G, bev=0.002, seg=1),
          cyl("door_lever_rose", 0.017, 0.01, (lx_, ly_ + 0.05, 0.071), alu, G, 20, axis="z", bev=0.002)]
    M = Mx((x + 0.06, 1.12, DOOR_Z), ry=math.pi / 2)
    # the lever: its own live node, pivot on the axle (local z = out of the door), the arm toward the hinges; the app
    # presses it 30 deg (the free end down) when an agent comes in or leaves (designer: wrap grip)
    L = M @ Mx((lx_, ly_ + 0.05, 0.07))
    lev = [segment("door_lever_neck", (0, 0, 0), (0, 0, 0.045), 0.008, alu, "export", verts=12),
           segment("door_lever_arm", (0, 0, 0.045), (0.12, 0, 0.045), 0.009, alu, "export", verts=12, r2=0.011),
           sphere("door_lever_end", 0.011, (0.12, 0, 0.045), alu, "export", seg=12, rings=6)]
    lever = live(pivot(join("door_lever", place(lev, L)), L), "bot")
    lever["press"] = {"axis": "z", "sign": -1, "deg": 30, "press_s": 0.3, "release_s": 0.3}
    child_empty(lever, "door_lever_grip", L @ Mx((0.07, 0, 0.045)), {"grip_for": "l", "pose": "wrap"})
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
#   agent_<i>_hand_l|r_f{1..4}_{1,2,3}, _t_{0,1,2}   finger segments (#134), pivot at each root joint, bend = local x
#                             (+ = toward the palm); #282: _t_0 = the thumb CMC wedge (flex x, abduct z, twist y),
#                             the app hangs _t_1 under it; extras joint gives each axis and sign (hand-poses.md 1)
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
    (*_c(-0.75, -0.6), math.pi / 2),  # ECHO: hall_mid, facing west toward its desk
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


# ---------------------------------------------------------------- hands (#134, docs/design/agents.md 2.7)
# Hand frame: fingers = local +y, palm face = local +z (toward the body's centre line), back = -z. Right hand: index
# on +x (the thumb's side); the left hand mirrors x (sx = -1).
HAND_T = 0.045  # palm thickness
FINGERS = [  # x at the palm's top edge (right hand), length, width, rest fan (deg, toward the thumb side +)
    (0.030, 0.058, 0.017, 6.0),  # f1 index
    (0.010, 0.062, 0.017, 2.0),  # f2 middle
    (-0.010, 0.055, 0.016, -2.0),  # f3 ring
    (-0.029, 0.046, 0.014, -6.0),  # f4 little: 4° between neighbours
]
SEG_RATIO = (0.45, 0.30, 0.25)
FINGER_D = 0.016  # finger thickness
GAP = 0.002  # between segments: the joint pin fills it


def hand_palm(shell):
    """palm 0.086 x 0.086 x 0.045 with rounded corners (r 0.022 seen from the back) and a soft edge, so its back is
    flat for the panel: a 0.068 x 0.058 plate 1 mm proud with two horizontal panel lines (the band is the cuff's)"""
    panel = plastic("#e8e3d8", 0.45, 0, 0.05, "hand_panel")
    line = plastic("#8f8a80", 0.6, 0, 0.1, "hand_panel_line")
    palm = rounded_slab("palm", 0.086, HAND_T, 0.086, 0.022, (0, 0, 0), shell, "export", seg=4, edge=0.004)
    palm.rotation_euler = (math.pi / 2, 0, 0)  # the slab's thickness (web y) becomes the hand's z
    back = -HAND_T / 2
    parts = [palm, box("back_panel", (0.068, 0.058, 0.002), (0, 0.004, back - 0.001 + 0.0005), panel, "export", bev=0.0008, seg=1)]
    for y in (0.016, -0.004):
        parts.append(box("panel_line", (0.06, 0.002, 0.0006), (0, y, back - 0.0016), line, "export"))
    return parts


def round_tip(name, w, y0, y1, depth, material, z=0.0, arc=6):
    """a fingertip outline (hand-local web coords, the finger along +y): straight sides from y0, a half circle of
    radius w/2 ending at y1. depth > 0: a solid of that thickness centred on z; depth 0: one flat face at z facing
    +z (the palm side), for the pad"""
    r = w / 2
    yc = y1 - r
    pts = [(-r, y0), (r, y0)] + [(r * math.cos(math.pi * k / arc), yc + r * math.sin(math.pi * k / arc)) for k in range(arc + 1)]
    bm = bmesh.new()
    zs = (z,) if depth == 0 else (z - depth / 2, z + depth / 2)
    rings = [[bm.verts.new(W(x, y, zz)) for x, y in pts] for zz in zs]
    if depth == 0:
        bm.faces.new(rings[0])
    else:
        lo, hi = rings
        bm.faces.new(list(reversed(lo)))
        bm.faces.new(hi)
        for a in range(len(pts)):
            b = (a + 1) % len(pts)
            bm.faces.new((lo[a], lo[b], hi[b], hi[a]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return mesh_obj(name, bm, material, "export")


def hand_fingers(n, Mh, sx, shell, square=False):
    """four fingers of three segments + a thumb of two, each segment its own node with pivot_at = its root joint
    (bend = local x, + = toward the palm; the thumb's first segment also opposes about local z). The joint pin sits
    at the root of each segment and turns with it; the tip segment carries a dark matte pad on its palm side.
    LOOP (square): keycap-like tip segments (corner 0.006)."""
    pin_m = plastic("#3a3f48", 0.45, 0.3, 0.05, "joint_pin")
    pad_m = plastic("#2c3138", 0.9, 0, 0.2, "finger_pad")
    out = []

    def finger(name, F, lengths, width, depth):
        joint = 0.0
        for k, ln in enumerate(lengths):
            w = width - 0.0006 * k
            Mk = F @ Mx((0, joint, 0))
            tip = k == len(lengths) - 1
            seg_len = ln - GAP if not tip else ln - GAP / 2
            y0 = GAP / 2
            parts = [cyl("pin", 0.0045, w + 0.001, (0, 0, 0), pin_m, "export", 6, axis="x")]
            if tip and not square:  # a rounded fingertip: half-width radius, a half circle seen from the back (designer)
                parts.append(round_tip("seg", w, y0, y0 + seg_len, depth, shell))
                # the pad: the same outline 0.86x over the tip's last 2/3, on the palm side
                parts.append(round_tip("pad", w * 0.86, y0 + seg_len * 0.33, y0 + seg_len - 0.0007, 0.0, pad_m, z=depth / 2 + 0.0004))
            else:  # LOOP's keycap tip (corner 0.006), and the middle segments (1.5 mm)
                bev = 0.006 if (tip and square) else 0.0015
                parts.append(box("seg", (w, seg_len, depth), (0, y0 + seg_len / 2, 0), shell, "export", bev=bev, seg=1))
                if tip:  # the pad: 2/3 of the tip segment on the palm side, 1.5 mm
                    # #231: its far end a half circle (round_tip, as the other hands' pads), not a rectangle: the app's
                    # fingertip (rig.ts tipOf) is the vertex farthest from the joint, and a square pad's far corner won
                    # it, 7 mm off the finger's axis (LOOP alone failed the open book by 4-6.5 mm). Now it is the middle
                    # of the arc. The keycap segment itself is unchanged; the pad stays 1.5 mm proud of its palm face
                    pl = seg_len * 0.67
                    parts.append(round_tip("pad", w * 0.86, y0 + seg_len - pl - 0.0015, y0 + seg_len - 0.0015, 0.0015, pad_m, z=depth / 2 + 0.00075))
            out.append(pivot(join(f"{name}_{k + 1}", place(parts, Mk)), Mk))
            joint += ln

    for f, (x, length, width, fan) in enumerate(FINGERS, start=1):
        F = Mh @ Mx((sx * x, 0.043, 0.0)) @ Mx(rz=-sx * math.radians(fan))
        finger(f"{n}_f{f}", F, [length * r for r in SEG_RATIO], width, FINGER_D)
    # #282 (hand-poses.md 1; designer on #288: the thumb rose from the palm face like a knob): the thumb's CMC, _t_0,
    # pivots on the thumb-side face's lower end (1.5 cm up from the wrist corner, 6 mm in, 4 mm toward the palm side)
    # and carries the thumb 2.6 cm out along its 35° line, so _t_1's root sits beside the palm, not over it. Its
    # thenar is a rounded bulge (an ellipsoid) standing ~1 cm proud of the side face, so an opened thumb stays joined.
    # Frame: y toward the thumb's root, x = the palm normal, z = x × y. The app hangs _t_1 under it
    c0 = Vector((sx * 0.037, -0.028, 0.004))
    yl = Vector((sx * math.sin(math.radians(35)), math.cos(math.radians(35)), 0.0))
    root = c0 + yl * 0.026
    xl = Vector((0.0, 0.0, 1.0))
    M0 = Mh @ basis(tuple(c0), xl, yl, xl.cross(yl))
    thenar = sphere("seg", 1.0, (0, 0.008, 0), shell, "export", scale=(0.012, 0.016, 0.009), seg=10, rings=6)
    out.append(pivot(join(f"{n}_t_0", place([thenar], M0)), M0))
    # the thumb: from _t_0's end, 35° out from the finger direction and 20° toward the palm, and (#292, designer: the
    # CMC did not take the thumb across the palm) turned 75° about its own axis like a human thumb at rest - its pad
    # faces the index finger, so its MCP / IP bend it across the palm (a fist: the tip over the middle finger) and an
    # opposed thumb meets the index tip (1.7 mm at the joint limits; 13.8 mm untwisted)
    T = Mh @ Mx(tuple(root)) @ Mx(rz=-sx * math.radians(35)) @ Mx(rx=math.radians(20)) @ Mx(ry=-sx * math.radians(75))
    # #231 (designer, coder): LOOP's keycap tip is chamfered 6 mm, so its fingertip (the pad's far end, rig.ts tipOf)
    # sat 2 mm short of the round tips' apex (thumb 71.3 vs 73.3 mm): its thumb tip segment is 2 mm longer instead
    finger(f"{n}_t", T, [0.030, 0.023 + (0.002 if square else 0.0)], 0.019, 0.017)  # #288 designer: +15% (0.026 + 0.020 reached the index tip only at 6.8 mm)
    joint_axes(out, Mh, sx)
    return out


def joint_axes(nodes, Mh, sx):
    """#282 (hand-poses.md 1): each finger / thumb node says which local axis turns each of its joints and the sign
    that turns it the designer's + way (a right-handed frame cannot give every + its own positive rotation on both
    hands): extras joint = {flex | abduct | twist: {axis, sign}, order}. + flex = toward the palm (the CMC: across
    the palm toward the little finger; the thumb's MCP / IP: across the palm, its pad side), + abduct = away from the
    middle finger (the middle: toward the thumb; the CMC: out of the palm plane toward the palm side), + twist (CMC) =
    the thumb pad turning toward the palm. order = the rotations from the rest frame, the palm-fixed axis first
    ("abduct,flex" on _f{n}_1, "flex,abduct,twist" on _t_0, #292). _f{n}_1 also carries rest_abduct: the fan
    already in the mesh (deg, + = away from the middle finger)."""
    R = Mh.to_3x3()
    hand = lambda a, b, c: (R @ Vector((a, -c, b))).normalized()  # hand-local web -> world (Blender)
    palm, thumb_side = hand(0, 0, 1), hand(sx, 0, 0)
    fan = {f: fn for f, (_, _, _, fn) in enumerate(FINGERS, start=1)}

    def ax(o, web):  # a node's local web axis in the world (Blender): web x, y, z = Blender local X, Z, -Y
        r = o.matrix_world.to_3x3()
        return (r @ {"x": Vector((1, 0, 0)), "y": Vector((0, 0, 1)), "z": Vector((0, -1, 0))}[web]).normalized()

    def sign(a, moved, want):
        return 1 if a.cross(moved).dot(want) > 0 else -1

    by = {o.name.split(".")[0][-4:]: o for o in nodes}
    pad = ax(by["_t_1"], "z")  # the thumb's pad side (its segments' local +z)
    for o in nodes:
        name = o.name.split(".")[0]
        y = ax(o, "y")
        j = {"flex": {"axis": "x", "sign": sign(ax(o, "x"), y, palm)}, "order": "flex"}
        if name[-4:] in ("_t_1", "_t_2"):  # #292: the twisted thumb bends across the palm
            j["flex"]["sign"] = sign(ax(o, "x"), y, (palm * 0.3 - thumb_side).normalized())
        if name.endswith("_t_0"):
            j = {"flex": {"axis": "x", "sign": sign(ax(o, "x"), y, -thumb_side)},
                 "abduct": {"axis": "z", "sign": sign(ax(o, "z"), y, palm)},
                 "twist": {"axis": "y", "sign": sign(y, pad, palm)},
                 "order": "flex,abduct,twist"}
        elif name[-4:-2] in ("f1", "f2", "f3", "f4") and name.endswith("_1"):
            f = int(name[-3])
            away = thumb_side if f <= 2 else -thumb_side
            j["abduct"] = {"axis": "z", "sign": sign(ax(o, "z"), y, away)}
            j["order"] = "abduct,flex"
            o["rest_abduct"] = abs(fan[f]) if f != 2 else fan[f]  # middle: + toward the thumb
        o["joint"] = j


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


def soft_shell(o):
    """#166 (designer, #249): the head's rounded edges read as three or four flat facets in the app - the bevel's
    hardened normals. Shade it smooth and weight the normals by face area (the flat sides stay flat, the round
    edges blend), applied before the head is joined"""
    for p in o.data.polygons:
        p.use_smooth = True
    md = o.modifiers.new("weighted", "WEIGHTED_NORMAL")
    md.mode = "FACE_AREA"
    md.weight = 50
    md.keep_sharp = True
    return apply_all(o)


def seam_split(o, z_web, gap):
    """#166: cut a head's shell into front and back plates: delete the faces in a gap-wide band round the head at
    web z = z_web (the graphite seam band inside shows through it)"""
    bm = bmesh.new()
    bm.from_mesh(o.data)
    yb = -z_web  # web z -> Blender -y
    for c in (yb - gap / 2, yb + gap / 2):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=(0, c, 0), plane_no=(0, 1, 0))
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if abs(f.calc_center_median().y - yb) < gap / 2 - 1e-6], context="FACES")
    bm.to_mesh(o.data)
    bm.free()


def screw(center, axis, sgn, metal, dark, group, r=0.003):
    """#166: a flat-head screw (6 mm) with a cross slot, its face toward web axis * sgn"""
    x, y, z = center
    k = {"x": 0, "y": 1, "z": 2}[axis]
    d = [0.0, 0.0, 0.0]
    d[k] = sgn * 0.0009
    out = [cyl("screw", r, 0.0015, center, metal, group, 8, axis=axis)]
    for rot in (0, 1):
        size = [0.0, 0.0, 0.0]
        size[k] = 0.0004
        others = [j for j in range(3) if j != k]
        size[others[rot]], size[others[1 - rot]] = r * 1.4, 0.0006
        out.append(box("screw_slot", tuple(size), (x + d[0], y + d[1], z + d[2]), dark, group))
    return out


def hexdot(name, r, center, normal, material, group):
    """a flat dark hexagon (4 triangles) facing the web direction normal: grille and mic holes on a live head"""
    n = Vector(normal).normalized()
    u = n.cross(Vector((0, 1, 0)) if abs(n.y) < 0.9 else Vector((1, 0, 0))).normalized()
    v = n.cross(u)
    c = Vector(center)
    bm = bmesh.new()
    vs = [bm.verts.new(W(*(c + (u * math.cos(a) + v * math.sin(a)) * r))) for a in [k * math.pi / 3 for k in range(6)]]
    f = bm.faces.new(vs)
    f.normal_update()
    if f.normal.dot(Vector(W(*n)) - Vector(W(0, 0, 0))) < 0:
        f.normal_flip()
    return mesh_obj(name, bm, material, group)


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
    # #166 (robots.md 2.1): four materials for all five - matte ivory shell, graphite (seams, ears, bezel, plate), metal
    # (screws, rims, collars); the face is the canvas slot (glass); the agent colour as before (emission 0.6)
    shell = plastic("#e9e4d8", 0.55, 0, 0.08, "bot_shell")
    graphite = plastic("#3a3f48", 0.6, 0, 0.05, "bot_graphite")
    metal = plastic("#b9bec7", 0.35, 1.0, 0.03, "bot_metal")
    joint = graphite
    accent = plastic(col, 0.4, 0, 0.05, f"bot_accent_{i}")
    ab = accent.node_tree.nodes["Principled BSDF"]
    ab.inputs["Emission Color"].default_value = rgba(col)
    ab.inputs["Emission Strength"].default_value = 0.6
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

    # -- head (#166 robots.md 2.1): front and back shells split at z = -0.02 by a 2 mm graphite seam, the face bezel,
    #    four screws round it, ear modules, the service plate on the back (seams, screws, name plate RB-1i; inside:
    #    MEMO the post-it clip, MESH/HUE/LOOP five vent slots, ECHO the grille), the thrust ring's metal rim + vents.
    #    MESH keeps its chamfered head; #254: a 6 mm light line down the middle of two chamfers (front-left, back-right),
    #    not the whole chamfer face lit (it read as a big lavender plate stuck beside the face)
    if i == 1:
        head = box("head", HEAD, (0, 0, 0), shell, G, bev=0.06, seg=1)
        head.modifiers["bevel"].harden_normals = False  # see soft_shell
        head = apply_all(head)
        r_in = 0.06
    else:
        head = box("head", HEAD, (0, 0, 0), shell, G, bev=0.08, seg=3)
        head.modifiers["bevel"].harden_normals = False  # see soft_shell
        head = apply_all(head)
        r_in = 0.08
    seam_split(head, -0.02, 0.002)
    head = soft_shell(head)
    hp = [head,
          # the seam's floor: a graphite band 1.5 mm inside the shells, seen through the 2 mm gap
          place([rounded_slab("seam", hw - 0.003, 0.004, hh - 0.003, r_in - 0.0015, (0, 0, 0), graphite, G, seg=3 if i != 1 else 1)],
                Mx((0, 0, -0.02), rx=math.pi / 2))[0],
          panel("face_bezel", 0.32, 0.20, 0.006, 0.025, (0, 0, -hd / 2 + 0.0015), graphite, G)]
    if i == 1:  # #254: the two chamfer light lines (6 mm, 0.6 mm proud), between the top and bottom chamfers
        line_m = emitter("#7d88f5", 0.5, "mesh_facet")  # #284 / #288 designer: a step deeper than the agent lavender, 0.5 (0.8 read white)
        for sx, sz in ((-1, -1), (1, 1)):
            c = (sx * (hw / 2 - 0.03), 0.0, sz * (hd / 2 - 0.03))  # the chamfer's middle (bevel 0.06 each way)
            n = Vector((sx, 0.0, sz)).normalized() * 0.0006
            hp += place([box("facet_line", (0.006, hh - 0.12, 0.0008), (0, 0, 0), line_m, G)],
                        Mx((c[0] + n.x, 0.0, c[2] + n.z), ry=math.atan2(sx, sz)))
        for sy in (-1, 1):
            hp += screw((sx * 0.172, sy * 0.112, -hd / 2 + 0.0105), "z", -1, metal, graphite, G)
    # the service plate on the back: a 0.24 x 0.16 seam rectangle, corner screws, the name plate below
    zb = hd / 2
    for (w, h_, cx, cy) in ((0.24, 0.0015, 0, 0.08), (0.24, 0.0015, 0, -0.08), (0.0015, 0.16, 0.12, 0), (0.0015, 0.16, -0.12, 0)):
        hp.append(box("plate_seam", (w, h_, 0.001), (cx, cy, zb + 0.0002), graphite, G))
    for sx in (-1, 1):
        for sy in (-1, 1):
            hp += screw((sx * 0.105, sy * 0.066, zb + 0.0005), "z", 1, metal, graphite, G)
    if i != 4:  # ECHO's grille covers the plate's middle
        hp += [box("name_plate", (0.06, 0.016, 0.0015), (0, -0.062, zb + 0.0008), shell, G, bev=0.0005, seg=1),
               text("name_plate_txt", f"RB-1{i}", 0.009, (0, -0.0655, zb + 0.0021), graphite, G, facing="+z", extrude=0.0)]  # #263: 0.55 mm off the plate
    if i in (1, 2, 3):  # five vent slots inside the plate
        hp += [box("plate_vent", (0.18, 0.004, 0.002), (0, -0.035 + k * 0.02, zb + 0.0002), graphite, G) for k in range(5)]
    # thrust housing + its metal rim and six vent slots (the glow ring itself is agent_<i>_glow)
    hp += [cyl("thrust", 0.105, 0.03, (0, -hh / 2 - 0.005, 0), graphite, G, 20, r2=0.09),
           torus("thrust_rim", 0.103, 0.004, (0, -hh / 2 - 0.005, 0), metal, G, seg=24, rseg=4)]
    for k in range(6):
        a = 2 * math.pi * k / 6
        hp += place([box("thrust_vent", (0.002, 0.016, 0.014), (0, 0, 0), plastic("#1d2127", 0.8, 0, 0, "bot_dark"), G)],
                    Mx((0.0985 * math.cos(a), -hh / 2 - 0.006, 0.0985 * math.sin(a)), ry=-a))
    ears = {"l": i not in (2, 3), "r": i not in (0, 3)}  # LOOP: the cups cover them; MEMO: the headset; HUE: the dropper (left)
    for s, sx in (("l", -1), ("r", 1)):
        if ears[s]:  # the ear module: graphite cap, an agent-colour band, three screws at 120 deg
            hp += [cyl("ear_cap", 0.035, 0.035, (sx * (hw / 2 + 0.0175), 0, 0), graphite, G, 20, axis="x", bev=0.002),
                   torus("ear_band", 0.035, 0.002, (sx * (hw / 2 + 0.03), 0, 0), accent, G, axis="x", seg=20, rseg=4)]
            if i != 4:
                for k in range(3):
                    a = 2 * math.pi * k / 3 + math.pi / 2
                    hp += screw((sx * (hw / 2 + 0.0355), 0.022 * math.sin(a), 0.022 * math.cos(a)), "x", sx, metal, graphite, G, r=0.0025)
    if i == 0:  # MEMO: antenna (collar, three spring rings), headset (cushion cup, boom joint, grille mic), post-it clip
        ax_, az_ = 0.08, 0.08
        hp += [cyl("antenna", 0.008, 0.138, (ax_, hh / 2 + 0.071, az_), graphite, G, 8),  # #263: 2 mm over the collar's foot
               cyl("antenna_collar", 0.016, 0.014, (ax_, hh / 2 + 0.007, az_), metal, G, 12, bev=0.002)]
        hp += [torus("antenna_spring", 0.0105, 0.0022, (ax_, hh / 2 + 0.04 + k * 0.03, az_), metal, G, seg=10, rseg=4) for k in range(3)]
        # #263: the cushion sat inside the cup, sharing its inner face: the cup now rests on the cushion
        hp += [box("headset", (0.06, 0.14, 0.06), (hw / 2 + 0.008 + 0.03, 0, 0), graphite, G, bev=0.025, seg=2),
               box("headset_cushion", (0.008, 0.12, 0.05), (hw / 2 + 0.004, 0, 0), plastic("#26292f", 0.95, 0, 0.5, "bot_fabric"), G, bev=0.004, seg=1),
               sphere("boom_joint", 0.012, (hw / 2 + 0.045, -0.05, -0.02), metal, G, seg=10, rings=6),
               lowrail("boom", [(hw / 2 + 0.045, -0.05, -0.02), (hw / 2 + 0.01, -0.11, -0.15), (0.09, -0.13, -0.205)], 0.007, graphite, G),
               sphere("mic", 0.02, (0.09, -0.13, -0.205), accent, G, seg=12, rings=8)]
        hp += [torus("mic_grille", 0.0175 - k * 0.004, 0.0012, (0.09, -0.13, -0.205 - 0.006 - k * 0.004), graphite, G, axis="z", seg=12, rseg=3)
               for k in range(3)]
        hp += [box("postit_clip", (0.05, 0.012, 0.006), (0, 0.06, zb + 0.004), metal, G, bev=0.002, seg=1)]
    if i == 1:  # MESH: gizmo (base joint, stalk, three bars ending in arrow cones; the centre sphere is the tip)
        cz = hh / 2 + 0.13
        hp += [sphere("gizmo_joint", 0.016, (0, hh / 2 + 0.004, 0), metal, G, seg=12, rings=6),
               cyl("gizmo_stalk", 0.009, 0.11, (0, hh / 2 + 0.055, 0), graphite, G, 8)]
        for v, c in (((1, 0, 0), "#ff4d5e"), ((0, 1, 0), "#5dde7a"), ((0, 0, 1), "#4d8bff")):
            m = plastic(c, 0.4, 0, 0, f"gizmo_{c}")
            end = (0.11 * v[0], cz + 0.11 * v[1], 0.11 * v[2])
            hp.append(segment("gizmo_bar", (0, cz, 0), end, 0.008, m, G, verts=8))
            tip_end = (0.155 * v[0], cz + 0.155 * v[1], 0.155 * v[2])
            hp.append(segment("gizmo_arrow", end, tip_end, 0.02, m, G, verts=12, r2=0.0))  # the arrow cone
    if i == 2:  # HUE: beret (band, inner band, dome with stitch lines, the tip is its button), palette pin, dropper
        fabric_m = plastic("#5a2147", 0.85, 0, 0.4, "beret")
        stitch = plastic("#3d1630", 0.9, 0, 0, "beret_stitch")
        beret = [cyl("beret_band", 0.215, 0.035, (0, 0, 0), fabric_m, G, 32),
                 cyl("beret_band_in", 0.212, 0.01, (0, -0.0105, 0), stitch, G, 32),  # #263: 2 mm over the band's underside
                 sphere("beret_dome", 0.26, (0, 0.01, 0), fabric_m, G, scale=(1, 0.09 / 0.26, 1), half=True, seg=32, rings=10),
                 cyl("beret_stalk", 0.008, 0.03, (0, 0.11, 0), fabric_m, G, 8)]
        beret += [torus("beret_stitch", r_, 0.0012, (0, 0.011 + 0.09 * math.sqrt(max(0.0, 1 - (r_ / 0.26) ** 2)), 0), stitch, G, seg=32, rseg=3)
                  for r_ in (0.12, 0.2)]
        hp += place(beret, Mx((0, hh / 2 + 0.005, 0), rz=math.radians(-10)))
        pin = [sphere("palette_pin", 0.014, (0, 0, 0), plastic("#ece6d8", 0.5, 0, 0.1, "palette"), G, seg=14, rings=6, scale=(1, 0.7, 0.25))]  # flat toward local +z
        for k, a_ in enumerate(AGENTS[:4]):
            pin.append(sphere("palette_dot", 0.0035, (-0.006 + (k % 2) * 0.012, -0.004 + (k // 2) * 0.008, 0.0036),
                              plastic(a_["color"], 0.4, 0, 0, f"swatch_{k}"), G, seg=8, rings=4))
        hp += place(pin, Mx((0.19, hh / 2 - 0.02, -0.11), ry=math.atan2(0.19, -0.11)))  # pinned on the beret band's front right, facing out
        dx_ = -(hw / 2 + 0.012)  # the dropper in its holder at the left ear: holder ring, glass tube, rubber bulb, band
        hp += [cyl("dropper_holder", 0.02, 0.03, (dx_ - 0.006, 0, 0), graphite, G, 16, axis="x", bev=0.002),
               cyl("dropper_glass", 0.0045, 0.05, (dx_ - 0.028, -0.015, 0), glass_mat("dropper_glass", "#e8f4ff", 0.35), G, 12),
               sphere("dropper_bulb", 0.009, (dx_ - 0.028, 0.017, 0), graphite, G, seg=12, rings=6, scale=(1, 1.4, 1)),
               cyl("dropper_band", 0.0055, 0.004, (dx_ - 0.028, 0.005, 0), accent, G, 12)]
    if i == 3:  # LOOP: headphones (cups with cushions and swivel rings, padded band, a cable down the back)
        fabric = plastic("#26292f", 0.95, 0, 0.5, "bot_fabric")
        for sx in (-1, 1):
            hp += [box("cup", (0.09, 0.18, 0.09), (sx * (hw / 2 + 0.045), 0, 0), graphite, G, bev=0.03, seg=2),
                   box("cup_cushion", (0.012, 0.15, 0.075), (sx * (hw / 2 + 0.004), 0, 0), fabric, G, bev=0.005, seg=1),
                   torus("cup_swivel", 0.03, 0.004, (sx * (hw / 2 + 0.045), 0.09, 0), metal, G, axis="z", seg=16, rseg=4)]
        hp.append(lowrail("band", [(-(hw / 2 + 0.045), 0.09, 0), (-0.2, 0.22, 0), (0, hh / 2 + 0.1, 0), (0.2, 0.22, 0),
                                (hw / 2 + 0.045, 0.09, 0)], 0.02, graphite, G))
        hp.append(lowrail("band_pad", [(-0.12, hh / 2 + 0.06, 0), (0, hh / 2 + 0.085, 0), (0.12, hh / 2 + 0.06, 0)], 0.022, fabric, G))
        hp.append(lowrail("cup_cable", [(-(hw / 2 + 0.06), -0.08, 0.02), (-(hw / 2 + 0.03), -0.14, 0.1), (-0.12, -0.16, 0.18)], 0.004, graphite, G))
    if i == 4:  # ECHO (agents.md 2.11, #193): the round speaker grille on the plate, mic capsules on the ear modules,
        # the tuning fork's stem on the crown (the U and the light ring are live)
        hole_m = plastic("#1d2127", 0.8, 0, 0, "echo_hole")
        hp.append(cyl("grille", 0.11, 0.012, (0, 0, hd / 2 + 0.006), graphite, G, 32, axis="z"))
        for ring_r, n in ((0.0, 1), (0.026, 6), (0.05, 12), (0.074, 18), (0.096, 24)):  # holes: concentric hex rows
            for k in range(n):
                a = 2 * math.pi * k / n
                hp.append(hexdot("grille_hole", 0.0045, (ring_r * math.cos(a), ring_r * math.sin(a), hd / 2 + 0.0122), (0, 0, 1), hole_m, G))
        for sx in (-1, 1):
            hp.append(cyl("mic", 0.03, 0.004, (sx * (hw / 2 + 0.037), 0, 0), graphite, G, 16, axis="x"))
            for dy in (-0.011, 0.0, 0.011):
                for dz in (-0.011, 0.0, 0.011):
                    hp.append(hexdot("mic_hole", 0.0025, (sx * (hw / 2 + 0.0392), dy, dz), (sx, 0, 0), hole_m, G))
        hp.append(cyl("fork_stem", 0.01, 0.05, (0, hh / 2 + 0.025, 0.02), metal, G, 12))
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
    if i < 3 or i == 4:  # ECHO (agents.md 2.11): a sphere in the bottom of the tuning fork's U
        r, T = ((0.026, Hd @ Mx((0.08, hh / 2 + 0.165, 0.08))),
                (0.03, Hd @ Mx((0, hh / 2 + 0.13, 0))),
                (0.022, Hd @ Mx((0, hh / 2 + 0.005, 0), rz=math.radians(-10)) @ Mx((0, 0.13, 0))),
                None, (0.018, Hd @ Mx((0, hh / 2 + 0.05 + 0.012, 0.02))))[i]  # ECHO: in the fork's bend
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
    # #166 (robots.md 2.1): a thin light ring just outside the floor disc (r 0.28, 6 mm), additive like it; top-level
    # with the disc's pivot (a child mesh would be flattened by rebase(); the app moves it with agent_<i>)
    ring = torus(f"agent_{i}_floor_ring", 0.28, 0.003, (0, 0, 0), soft_glow(col, 0.6, 1.6, f"floor_ring_{i}"), "export", seg=48, rseg=3)
    neon.append(pivot(apply_all(place([ring], F0 @ Mx((0, 0.001, 0)))[0]), F0))

    # -- hands (#134, agents.md 2.7): palm with a back panel, four fingers of three segments and a two-segment thumb,
    #    graphite joint pins, dark fingertip pads; wrist cuff + back band (neon), grip empty
    for side, sx in (("l", -1), ("r", 1)):
        Mh = root @ hand_rest(side)
        n = f"agent_{i}_hand_{side}"
        palm_node = pivot(join(n, place(hand_palm(shell), Mh)), Mh)
        # #282 (hand-poses.md 1, grips.md 1.1): the wrist turns the hand about a point 5 cm below the palm centre
        # (the cuff's middle), hand-local web metres; the axes / signs that turn it the + way: flex = toward the palm,
        # deviate = toward the thumb, twist = the palm turning down
        R = Mh.to_3x3()
        hx, hy, hz = ((R @ v).normalized() for v in (Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0))))
        sg = lambda a, moved, want: 1 if a.cross(moved).dot(want) > 0 else -1
        palm_node["wrist"] = {"at": [0.0, -0.05, 0.0], "flex": {"axis": "x", "sign": sg(hx, hy, hz)}, "deviate": {"axis": "z", "sign": sg(hz, hy, sx * hx)},
                              "twist": {"axis": "y", "sign": sg(hy, hz, Vector((0, 0, -1)))}}
        bot.append(palm_node)
        bot += hand_fingers(n, Mh, sx, shell, square=i == 3)
        cuff = [tube("cuff", 0.036, 0.023, (0, -0.05, 0), glow_m, "export", 16),
                cyl("cuff_cap", 0.03, 0.006, (0, -0.06, 0), glow_m, "export", 12),
                # the back band: agent colour like the cuff (HUE's turns with it), on the back panel's lower edge
                box("back_band", (0.04, 0.005, 0.0012), (0, -0.022, -HAND_T / 2 - 0.0023), glow_m, "export")]
        neon.append(pivot(join(f"{n}_cuff", place(cuff, Mh)), Mh))
        g = bpy.data.objects.new(f"{n}_grip", None)
        coll("export").objects.link(g)
        g.parent = palm_node
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
                                                cyl("pen_cap", 0.0095, 0.02, (0, 0, -0.075), accent, G, 12, axis="z"),
                                                box("pen_clip", (0.003, 0.002, 0.05), (0, 0.0098, -0.045), metal, G, bev=0.0007, seg=1)], P)), P)
        pen["prop"] = "pen"
        pen["home_on"] = f"agent_{i}_head"
        pen["home"] = {"pos": [round(-(hw / 2 + 0.025), 4), 0.07, 0.0], "rot": [round(math.radians(25), 4), 0.0, 0.0]}
        pen["grip"] = {"pos": [0.0, -0.04, 0.0], "rot": [round(math.pi / 2, 4), 0.0, 0.0]}
        other.append((pen, "prop"))
        # #166: the post-its hang from the clip at the top of the service plate (1 cm off it, a little fanned), not afloat
        spots = [(-0.012, 0.012, 7), (0.01, 0.01, -5), (-0.004, 0.008, 3), (0.014, 0.006, -8), (-0.016, 0.004, 9)]
        for k, (dx, dy, rz) in enumerate(spots):
            Pk = Hd @ Mx((dx, dy, hd / 2 + 0.01 + 0.0035 * k), rz=math.radians(rz))
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
                    s[ax] = e - t  # #263: the bars stop at the corner spheres (they overlapped each other there)
                    bars.append(box("orbit_bar", tuple(s), tuple(c), orbit_m, "export"))
        bars += [sphere("orbit_corner", 0.011, (u * e / 2, v * e / 2, w_ * e / 2), orbit_m, "export", seg=8, rings=4)  # #166
                 for u in (-1, 1) for v in (-1, 1) for w_ in (-1, 1)]
        cube = place(bars, Mx((0.34, 0, 0), rx=0.6, ry=0.8))
        neon.append(pivot(join("agent_1_orbit", place(cube, Oc)), Oc))
    if i == 3:  # LOOP: ear-cup glow strips (lit while working)
        strips = [box("cup_glow", (0.004, 0.11, 0.025), (sx * (hw / 2 + 0.091), 0, 0), emitter(col, 3.0, "ear_glow"), "export")
                  for sx in (-1, 1)]
        neon.append(pivot(join("agent_3_ear_glow", place(strips, Hd)), Hd))
    if i == 4:  # ECHO: the tuning fork's U (only the tines ring: pivot = the stem's top, shake about local x) and the
        # breathing light ring round the grille (agents.md 2.11)
        steel = plastic("#c9ccd1", 0.35, 0.8, 0.05, "fork")
        rb, L_ = 0.035, 0.14
        u = [(-rb, rb + L_, 0)] + [(-rb * math.cos(a), rb - rb * math.sin(a), 0) for a in [math.radians(d) for d in range(0, 181, 30)]] + [(rb, rb + L_, 0)]
        fork = rail("fork_u", u, 0.0075, steel, G)
        fork.data.resolution_u, fork.data.bevel_resolution = 2, 1
        Fk = Hd @ Mx((0, hh / 2 + 0.05, 0.02))
        tips = [sphere("fork_end", 0.0075, (sx * rb, rb + L_, 0), steel, G, seg=10, rings=6) for sx in (-1, 1)]
        bot.append(pivot(join("agent_4_fork", place([fork] + tips, Fk)), Fk))
        Rg = Hd @ Mx((0, 0, hd / 2 + 0.004))
        neon.append(pivot(join("agent_4_ring", place([torus("echo_ring", 0.12, 0.006, (0, 0, 0), emitter(col, 3.0, "echo_ring"), "export", axis="z", seg=48, rseg=4)], Rg)), Rg))
    return bot, neon, other


# ================================================================ NAVIGATION SPOTS (empties)
# Where agents go and which way they face there. The app links them through the hall nodes into a graph and
# glides agents along it (no teleporting, never through furniture), and gathers a meeting on a ring around a
# meet_center. Each empty: name nav_<id>, extras nav=<kind> (work, stand, sofa, stool, play, meet_center, door,
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


# #195 (desks.md 2.1.6): the pod's desks touch, so a visitor stands off its four corners (the row desks) and beside
# MEMO's head desk on its west (the window's east end holds the chat spots)
DESK_SIDES = [_c(-3.35, -2.75), _c(-3.42, 0.85), _c(-3.42, -2.0), _c(-1.58, -2.0), _c(-1.58, 0.85)]


def build_nav():
    for i, a in enumerate(AGENTS):
        F = frame(a["at"])
        seat = (F @ Mx((0, 0, WORK_Z))).to_translation()
        nav(f"work_{i}", seat.x, -seat.y, a["at"][2], "work")
        sx, sz = DESK_SIDES[i]
        nav(f"desk_side_{i}", sx, sz, facing(sx, sz, seat.x, -seat.y), "stand")
    (ax, az), (bx, bz) = CHAT_SPOTS  # the second conversation (desks.md 2.1.2): face each other
    nav("chat_0", ax, az, facing(ax, az, bx, bz), "chat")
    nav("chat_1", bx, bz, facing(bx, bz, ax, az), "chat")
    stand_z = -HZ + 0.9  # in front of the back wall's boards and the shelf
    nav("whiteboard", WHITEBOARD_X, stand_z, 0.0, "stand")
    # #228: where an agent stands to take or put back a marker on the board's tray (0.5 m from the markers, facing the
    # board): outside the meeting circle, in the strip along the north wall
    nav("board_tray", WHITEBOARD_X - 0.28, -HZ + 0.55, 0.0, "stand")  # the middle marker's x (markers at -0.42 + 0.14 k)
    nav("bulletin", BULLETIN_X, stand_z, 0.0, "stand")
    nav("shelf", SHELF_X, stand_z, 0.0, "stand")
    cs = (counter_frame() @ Mx((COFFEE_SPOT[0], 0, COFFEE_SPOT[1]))).to_translation()
    nav("coffee", cs.x, -cs.y, facing(cs.x, -cs.y, COUNTER[0], COUNTER[1]), "stand")
    nav("pingpong_a", PINGPONG[0] - 1.33, PINGPONG[1], -math.pi / 2, "play")
    nav("pingpong_b", PINGPONG[0] + 1.33, PINGPONG[1], math.pi / 2, "play")
    # #280: the sofa seats (nav_sofa_0..3) and nav_beanbag come with the L sofa and the beanbag (build_lounge2)
    nav("game_a", GAME_TABLE[0] - 0.6, GAME_TABLE[1], -math.pi / 2, "stool")
    nav("game_b", GAME_TABLE[0] + 0.6, GAME_TABLE[1], math.pi / 2, "stool")
    nav("door", -HX + 0.55, DOOR_Z, math.pi / 2, "door")
    # meeting centers (#147, agents.md "대형"): the app stands the people on a 0.75 m ring around one and turns them
    # to its center. ry = the 0° direction (toward the board); r = the floor kept free of furniture around it
    # (ring + a body), checked by check-glb --overlap
    # #195: one circle for the board meeting and the floor meeting; ry = toward the whiteboard's middle (1.1, -3.46),
    # ring = where the people stand, r = ring + a body (kept clear of furniture, check-glb)
    mc = nav("meet_center", MEET_CENTER[0], MEET_CENTER[1], MEET_RY, "meet_center")
    mc["r"], mc["ring"] = MEET_R, MEET_RING
    # hall nodes: the aisles between the zones (#195 layout; the app's nav check #17 links and tests them)
    # #280 (room-280.md 8, old-origin values through _c): the back wall went 0.4 north (hall_north with it) and opened
    # an aisle behind MEMO's seat (hall_memo_back); the coffee counter moved onto the east wall (hall_ne steps aside)
    for name, x, z in (("door", -3.3, 2.6), ("west", -3.0, 1.4), ("work", -0.75, -1.9), ("north", -0.75, -2.7),
                       ("mid", -0.75, -0.6), ("back", 1.0, -0.1), ("east", 3.1, -1.3), ("front", 0.2, 1.3),
                       ("lounge", 3.95, 1.6), ("game", -1.6, 1.4), ("ne", 3.7, -0.7), ("memo_back", -2.5, -3.45)):
        nav(f"hall_{name}", *_c(x, z), 0.0, "hall")


# ================================================================ LIGHTS
def build_lights(lamp_pos):
    # soft overhead "ceiling" panels over the work corner and the lounge (the room has no ceiling)
    # #109: sized to the 9 x 7 room; power scaled with panel area so the light per m2 stays as it was
    # #195: the pod now stands right under this panel's middle and its oak tops baked to (1, 1, 1) (designer #249); they
    # come down by ATLAS_GAIN on their two atlases, not by this light, so the room around them stays as it was
    # #280: the same panels over the moved zones (old-origin points through _c): work over the pod as before, the
    # lounge one over the ping-pong table and the south-east lounge, the wall one 0.4 north with the back wall
    wx, wz = _c(-2.7, -1.5)
    lx_, lz_ = _c(2.9, 2.0)
    mx_, mz_ = _c(-0.9, 1.4)
    bx_, bz_ = _c(2.4, -2.95)
    light("panel_work", "AREA", 160, "#dfe6ff", (wx, 3.2, wz), aim=(wx, 0, wz), size=3.6, size_y=3.6)
    light("panel_lounge", "AREA", 120, "#ffe2c4", (lx_, 3.2, lz_), aim=(lx_, 0, lz_), size=4.0, size_y=3.6)
    light("panel_mid", "AREA", 55, "#ece4dc", (mx_, 3.2, mz_), aim=(mx_, 0, mz_), size=2.8, size_y=2.6)
    light("panel_wall", "AREA", 45, "#e8ecff", (bx_, 3.0, bz_), aim=(bx_, 1.2, -HZ), size=3.6, size_y=0.8)
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


# ================================================================ LOUNGE 2 (#280 PR 2, docs/design/lounge-props.md)
# Nine new things in their own atlas lounge2 (furniture >= 300, small things in reach >= 500 px/m). Old-origin points
# of room-280.md 8 go through _c(); the coffee bar's fridge and water dispenser stand north of the counter (designer:
# the can stand and the fig took its south side), the fridge door hinged on its south edge
L2 = "lounge2"
L2_NODES = []  # (baked object, texel density)
SOFA_L = _c(3.78, 3.745)  # the south row's centre: 2.4 x 0.87 (its front at z 3.11, 0.42 off the low table)
CHAISE = (4.245, 2.6775)  # #280 3 (user: a corner sofa from scratch): the east row past the corner, 0.87 x 0.865 (its front at x 3.81)
TABLE_LOW = (2.61, 2.41)  # #280 3 (user, lounge-props.md 3.1): the knee row 0.45, the east way in 0.80 (was #341 (2.61, 2.415) 0.9 x 0.55)
TABLE_W, TABLE_D = 0.80, 0.50  # a track shape: half circles r 0.25 at both ends (was 0.9 x 0.55 box)
SHELF_REC = _c(0.93, 4.05)  # 0.12 west of the table's 1.05: the monstera (moved 0.1 north in PR 1) took 2 cm of it
BEANBAG = _c(1.95, 2.025)  # #341: 0.325 north (the west way in >= 0.90 to the book table; 0.10 off the ping-pong slot)
FRIDGE_Z, DISP_Z = -0.73, -1.15  # centred room, on the east wall north of the counter, 0.2 off it (the open door clears the coffee spot)


def lounge_oak(c0="#8d7e6b", c1="#978875", name="lounge_oak"):
    """#280 designer: the desk oak, darker for the lounge light (its baked top #c1ad8b-#cdb894 like the desks; the work
    atlas reaches that by ATLAS_GAIN 0.27, lounge2 has none)"""
    m = KIT.oak()
    m.name = name
    ramp = next(n for n in m.node_tree.nodes if n.type == "VALTORGB")
    ramp.color_ramp.elements[0].color = rgba(c0)  # measured: the lounge light lifts this oak ~2x (linear)
    ramp.color_ramp.elements[1].color = rgba(c1)
    return m


def l2(name, objs, density=1.0):
    o = join(name, objs)
    L2_NODES.append((o, density))
    return o


def plump(name, w, h, d, r, mat, bulge=0.015, dip=0.0, ears=0.0, edge=0.02):
    """a soft cushion around its centre: a rounded slab smoothed once, its top domed by bulge (0 at the edges) with
    an optional dip in the middle, the four corners pulled out by ears (a throw pillow)"""
    o = rounded_slab(name, w, h, d, min(r, 0.45 * min(w, d)), (0, 0, 0), mat, L2, seg=3, edge=edge)
    sub = o.modifiers.new("sub", "SUBSURF")
    sub.levels = sub.render_levels = 1
    o = apply_all(o)
    for v in o.data.vertices:  # Blender local: x, y = web -z, z = web y
        u, s_, t = 2 * v.co.x / w, -2 * v.co.y / d, 2 * v.co.z / h
        f = max(0.0, 1 - u * u) * max(0.0, 1 - s_ * s_)
        if t > 0.2:
            v.co.z += bulge * f - dip * math.exp(-(u * u + s_ * s_) / 0.2)
        if ears:
            c = max(0.0, abs(u) - 0.55) * max(0.0, abs(s_) - 0.55) / 0.2
            v.co.x += math.copysign(ears * c, v.co.x)
            v.co.y += math.copysign(ears * c, v.co.y)
    return smooth(o)


def frame_rect(name, x0, x1, z0, z1, y, r, mat):
    """a piping cord round a rectangle (web x/z at height y)"""
    pts = [(x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1), (x0, y, z0 + 0.001)]
    c = rail(name, pts, r, mat, L2)
    c.data.resolution_u, c.data.bevel_resolution = 1, 1
    return c


def build_sofa_l():
    """1 (#280 3, user: from scratch, lounge-props.md 1): one corner sofa (a modular sectional). South row 2.40 =
    arm 0.20 + two seats 0.665 + the corner 0.87; east row 1.735 = the corner + a seat 0.665 + arm 0.20. Depth 0.87,
    seat 0.42, back 0.78, arms 0.56 rounded r 0.05 on top; it floats on a graphite plinth 0.06 set 4 cm in (no legs).
    Four seat cushions 0.18 (2 cm dome, a pressed middle, r 0.04, 4 mm piping), pillow-shaped back cushions 0.22
    leaning 10 deg, two meeting in the corner. Both fronts stay where they were (the table 0.42 off the south row,
    the east way in 0.75)"""
    fab = plastic("#4da8af", 0.9, 0, 0.8, "sofa_l")  # #280 designer: the baked cushion tops ~ the old sofa #5a9c90 (the lounge light shifts it warm)
    pipe = plastic("#3f8f95", 0.85, 0, 0.6, "sofa_piping")
    plinth_m = plastic("#2a2d33", 0.6, 0.1, 0.05, "sofa_plinth")
    x0, x1 = SOFA_L[0] - 1.2, SOFA_L[0] + 1.2  # the south row: x 2.28 .. 4.68
    zf, zb = SOFA_L[1] - 0.435, SOFA_L[1] + 0.435  # z 3.11 .. 3.98 (0.12 off the south wall)
    cx0 = CHAISE[0] - 0.435  # the east row's front x 3.81 (0.12 off the east wall at 4.68)
    bk, arm, seat_w = 0.2, 0.2, 0.665
    cz0 = zf - seat_w - arm  # the east row's north end, z 2.245
    yb, ys, yt = 0.06, 0.24, 0.42  # the plinth's top, the deck under the cushions, the seat
    p = []
    sl = lambda n, a, b, c, d_, y0, y1, e=0.02, r=0.03: rounded_slab(n, b - a, y1 - y0, d_ - c, r, ((a + b) / 2, (y0 + y1) / 2, (c + d_) / 2), fab, L2, seg=2, edge=e)
    # the plinth: two graphite blocks 4 cm in from the body's outline (the sofa floats over it)
    p += [box("sofa_plinth", (x1 - x0 - 0.08, yb, zb - zf - 0.08), ((x0 + x1) / 2, yb / 2, (zf + zb) / 2), plinth_m, L2, bev=0.004, seg=1),
          box("sofa_plinth", (x1 - cx0 - 0.08, yb, zf + 0.04 - (cz0 + 0.04) - 0.001), ((cx0 + x1) / 2, yb / 2, (cz0 + 0.04 + zf + 0.04) / 2 - 0.0005), plinth_m, L2, bev=0.004, seg=1)]
    # the body: the decks, the backs (south along the wall, east along the wall; the south one takes the corner
    # block), the two arms at the free ends (rounded tops)
    p += [sl("sofa_base", x0 + arm, x1 - bk, zf, zb - bk, yb, ys), sl("sofa_base", cx0, x1 - bk, cz0 + arm, zf - 0.001, yb, ys),
          sl("sofa_back", x0 + arm - 0.001, x1, zb - bk, zb, yb, 0.78, 0.04), sl("sofa_back", x1 - bk, x1, cz0 + arm - 0.001, zb - bk - 0.001, yb, 0.78, 0.04),
          sl("sofa_arm", x0, x0 + arm, zf, zb - 0.002, yb, 0.56, 0.05, 0.04), sl("sofa_arm", cx0, x1 - 0.002, cz0, cz0 + arm, yb, 0.56, 0.05, 0.04)]
    # seat cushions: two on the south row, the square corner one, one on the east row; 4 mm gaps
    g = 0.002
    seat = [(x0 + arm + g, x0 + arm + seat_w - g, zf + 2 * g, zb - bk - 2 * g),
            (x0 + arm + seat_w + g, cx0 - g, zf + 2 * g, zb - bk - 2 * g),
            (cx0 + g, x1 - bk - 2 * g, zf + 2 * g, zb - bk - 2 * g),
            (cx0 + 2 * g, x1 - bk - 2 * g, cz0 + arm + g, zf - g)]
    for a, b, c, d_ in seat:
        cu = plump("sofa_cushion", b - a, yt - ys, d_ - c, 0.04, fab, bulge=0.02, dip=0.007)
        p += place([cu], Mx(((a + b) / 2, (ys + yt) / 2, (c + d_) / 2)))
        p.append(frame_rect("sofa_piping", a + 0.012, b - 0.012, c + 0.012, d_ - 0.012, yt - 0.004, 0.002, pipe))
    # back cushions: pillows 0.22 thick, 0.40 high, top rounded r 0.08, 10 deg back. South: over seats 0 and 1 and
    # the corner (it stops at the east cushion's face); east: over the corner (meeting the south one) and seat 3
    th_, hh_ = 0.22, 0.40
    zc_s = zb - bk - th_ / 2 - 0.004  # the south cushions' centre line
    xc_e = x1 - bk - th_ / 2 - 0.004  # the east ones'
    backs_s = [(seat[0][0], seat[0][1]), (seat[1][0], seat[1][1]), (cx0 + g, xc_e - th_ / 2 - 0.004)]
    for a, b in backs_s:
        cu = plump("sofa_back_cushion", b - a, hh_, th_, 0.08, fab, bulge=0.012, edge=0.06)
        p += place([cu], Mx(((a + b) / 2, yt + hh_ / 2 - 0.01, zc_s), rx=math.radians(10)))
    backs_e = [(zf + 2 * g, zc_s - th_ / 2 - 0.004), (seat[3][2], seat[3][3])]
    for c, d_ in backs_e:
        cu = plump("sofa_back_cushion", d_ - c, hh_, th_, 0.08, fab, bulge=0.012, edge=0.06)
        p += place([cu], Mx((xc_e, yt + hh_ / 2 - 0.01, (c + d_) / 2), rx=math.radians(10), ry=math.pi / 2))
    fp_box("sofa", "floor", (x0, 0.0, zf), (x1, 0.8, zb))
    fp_box("sofa_chaise", "floor", (cx0, 0.0, cz0), (x1, 0.8, zf))  # the east row (the old chaise's slot name)
    # the seats (names kept): 0 / 1 the south row west / east (facing north), 2 the corner (facing north-west, the
    # last one picked), 3 the east seat (facing west; lie = a nap, the head on the north arm)
    for k in range(2):
        nav(f"sofa_{k}", (seat[k][0] + seat[k][1]) / 2, (zf + zb - bk) / 2, 0.0, "sofa")
    n_ = nav("sofa_2", (seat[2][0] + seat[2][1]) / 2, (seat[2][2] + seat[2][3]) / 2, math.pi / 4, "sofa")
    n_["last"] = True
    n_ = nav("sofa_3", (seat[3][0] + seat[3][1]) / 2, (seat[3][2] + seat[3][3]) / 2, math.pi / 2, "sofa")
    n_["lie"] = True  # lying down, a nap (lounge-props.md 1)
    n_["head"] = [round((seat[3][0] + seat[3][1]) / 2, 4), round(cz0 + arm, 4)]  # web x, z: the north arm's inner face
    # the two ways into the seats (designer: the last 0.6 m is a side step between the table and the sofa): the west
    # end of the table-sofa gap for seats 0 and 1, the gap between the table and the chaise for seat 2 and the chaise
    # #341 (designer, lounge-props.md 3 / coder): zone_sofa_row = the knee row between the table and the long side,
    # where the planner side-steps (0.4 speed, facing the sofa); the two ways in sit on its line just outside each end:
    # the west one 4 cm past the table's west edge, the east one in the middle of the table-chaise gap (>= 0.75)
    tx, tz = TABLE_LOW
    rx0, rx1, rz0 = tx - TABLE_W / 2, tx + TABLE_W / 2, tz + TABLE_D / 2
    rzc = round((rz0 + zf) / 2, 4)
    z_ = bpy.data.objects.new("zone_sofa_row", None)
    coll("export").objects.link(z_)
    z_.matrix_world = Mx(((rx0 + rx1) / 2, 0, rzc))
    z_["zone"] = "sofa_row"
    z_["ry"] = 0.0  # along the long side (web x)
    z_["size_x"], z_["size_z"] = round(rx1 - rx0, 4), round(zf - rz0, 4)
    NODES.append({"obj": z_})
    for nm, (ax, az), ry, seats in (("sofa_in_w", (rx0 - 0.13, rzc), -math.pi / 2, [0, 1]),  # #280 3: (2.08, 2.885) (designer)
                                    ("sofa_in_e", ((rx1 + cx0) / 2, rzc), math.pi, [2, 3])):
        n_ = nav(nm, round(ax, 4), az, ry, "sofa_in")
        n_["seats"] = seats
    return l2("sofa_l", p)


def pillow(name, hexc, home_pos, home_rot):
    """1a: a 45 cm throw pillow 0.42 x 0.42 x 0.12, domed, corner ears, a seam round its middle; standing up in its
    frame (faces +-z). Grips: both hands on its sides, palms in (the hug)"""
    m = plastic(hexc, 0.92, 0, 0.6, f"pillow_{hexc[1:]}")
    seam = plastic("#%02x%02x%02x" % tuple(int(int(hexc[i:i + 2], 16) * 0.8) for i in (1, 3, 5)), 0.9, 0, 0.5, f"pillow_seam_{hexc[1:]}")
    body = plump("pillow", 0.42, 0.12, 0.42, 0.06, m, bulge=0.03, ears=0.015, edge=0.03)
    body.rotation_euler = (0, 0, 0)
    stand = place([body], Mx(rx=-math.pi / 2))  # its thickness along z: standing
    sm = frame_rect("pillow_seam", -0.2, 0.2, -0.2, 0.2, 0.0, 0.0025, seam)
    sm = place([sm], Mx(rx=-math.pi / 2))
    o = live(prop(name, "pillow", stand + sm, home_pos, home_rot), "prop")
    for side, sx in (("r", 1), ("l", -1)):
        grip_at(o, side, (sx * 0.2, 0, 0), (0, 1, 0), (-sx, 0, 0))
        contact(o, "palm", (sx * 0.21, 0, 0), (sx, 0, 0), side)
    return o


def build_table_low():
    """2: the low oak table; #280 3 (user, lounge-props.md 3.1): a track shape 0.80 x 0.50 x 0.40 (both ends half
    circles r 0.25), a 3 cm top chamfered 5 mm, a shelf of the same shape 3 cm in, 0.15 up, four 4 cm graphite legs,
    magazines on the shelf; slots: the book at the east half (the book rests there), two mugs and a pillow in the
    west half, 2 cm apart (table_low_slot_0..3)"""
    tx, tz = TABLE_LOW
    # #280 3: the track table (its new place, closer under the lounge light) baked 1.37x brighter (linear) than the
    # approved box table (#d0b18c measured): its albedo x 0.73
    oak = lounge_oak("#7a6d5c", "#837665", "table_oak")
    gra = plastic("#3a3f48", 0.5, 0.3, 0.1, "table_leg")
    tw, td = TABLE_W, TABLE_D
    p = [rounded_slab("table_low_top", tw, 0.03, td, td / 2 - 0.0005, (tx, 0.385, tz), oak, L2, seg=12, edge=0.005),
         rounded_slab("table_low_shelf", tw - 0.06, 0.02, td - 0.06, (td - 0.06) / 2 - 0.0005, (tx, 0.15, tz), oak, L2, seg=12, edge=0.003)]
    for sx in (-1, 1):
        for sz in (-1, 1):
            p.append(box("table_low_leg", (0.04, 0.37, 0.04), (tx + sx * 0.2, 0.185, tz + sz * 0.15), gra, L2, bev=0.003, seg=1))
    for k, (c, rot) in enumerate((("#c9b28a", 0.05), ("#7f95a8", -0.12), ("#efe8d8", 0.2))):  # magazines
        p.append(box("magazine", (0.21, 0.006, 0.28), (tx - 0.1 + k * 0.01, 0.163 + k * 0.0065, tz + 0.0), plastic(c, 0.7, 0, 0.2, f"magazine_{k}"), L2, rot_y=rot))
    fp("table_low", p, "floor")
    # mugs on the north edge of the west half 18 cm apart, the pillow south of them (2.9 cm clear; it overhangs the
    # south edge 9 cm), the book on the east half (designer #359: (2.80, 2.51))
    for k, (dx, dz, kind) in enumerate(((-0.30, -0.15, "mug"), (-0.12, -0.15, "mug"), (0.19, 0.10, "book"), (-0.20, 0.13, "pillow"))):
        child_empty(None, f"table_low_slot_{k}", Mx((tx + dx, 0.40, tz + dz)), {"slot_on": "table_low", "for": kind})
    return l2("table_low", p)


def build_records():
    """3 / 3a / 3b: a 2 x 2 cube shelf (0.77, 3.5 cm boards, ivory) against the south wall; records in three cubbies,
    a small speaker in the fourth; on it the belt-drive turntable (walnut sides, graphite top, open dust cover live
    glass, two speed buttons) with the platter and the tonearm live; prop_record (jacket + disc) hidden at rest"""
    sx, sz = SHELF_REC
    sz = HZ - 0.05 - 0.195  # 5 cm off the south wall (its back)
    iv = plastic("#ece6d8", 0.75, 0, 0.2, "shelf_records")
    t = 0.035
    p = [box("rec_board", (0.77, t, 0.39), (sx, 0.77 - t / 2, sz), iv, L2, bev=0.003, seg=1),
         box("rec_board", (0.77, t, 0.39), (sx, t / 2, sz), iv, L2, bev=0.003, seg=1)]
    for dx in (-0.3675, 0.0, 0.3675):
        p.append(box("rec_side", (t, 0.70, 0.39), (sx + dx, 0.385, sz), iv, L2, bev=0.002, seg=1))
    for dx in (-0.1825, 0.1825):
        p.append(box("rec_mid", (0.33, t, 0.39), (sx + dx, 0.385, sz), iv, L2, bev=0.002, seg=1))
    RRNG = random.Random(280)
    spines = ["#3b4a5a", "#6b3f3a", "#4a5a3f", "#5a4a6b", "#7a6a4a", "#2f3a40", "#8a5a4a", "#4a6a6a"]
    for cx, cy in ((-0.1825, 0.035), (0.1825, 0.035), (-0.1825, 0.4025)):  # three cubbies of records
        x = sx + cx - 0.16
        while x < sx + cx + 0.155:
            col = RRNG.choice(spines)
            lean = RRNG.uniform(-0.03, 0.03)
            p.append(box("record_spine", (0.004, 0.31, 0.30), (x + 0.002, cy + 0.155, sz + 0.02), plastic(col, 0.75, 0, 0.2, f"spine_{col[1:]}"), L2, rot_y=lean * 0.1))
            x += 0.004 + RRNG.uniform(0.0005, 0.0025)
    # #280 3 (designer, option 2): a jacket leaning on the records in the lower right cubby (seen from the front: -x;
    # the upper one is prop_record's home, it would pull out through it), dark with
    # a circle and a band in two muted colours, 9 deg back, its foot 1 cm in from the cubby's front
    J = Mx((sx - 0.1825, 0.035 + 0.0005, sz - 0.185), rx=math.radians(9))
    jacket = [box("rec_jacket", (0.30, 0.30, 0.003), (0, 0.15, 0), plastic("#2a2f38", 0.7, 0, 0.1, "rec_jacket"), L2, bev=0.0008, seg=1),
              cyl("rec_jacket_disc", 0.08, 0.0006, (0.03, 0.18, -0.0018), plastic("#c2a46e", 0.7, 0, 0.05, "rec_jacket_ochre"), L2, 40, axis="z"),
              box("rec_jacket_band", (0.296, 0.03, 0.0006), (0, 0.08, -0.0018), plastic("#7d9a94", 0.7, 0, 0.05, "rec_jacket_teal"), L2)]
    p += place(jacket, J)
    spk = plastic("#2b2e33", 0.6, 0.1, 0.1, "rec_speaker")
    cone = plastic("#1b1d21", 0.85, 0, 0.3, "rec_cone")
    p += [box("rec_speaker", (0.2, 0.28, 0.22), (sx + 0.1825, 0.4025 + 0.14, sz), spk, L2, bev=0.008, seg=2),
          cyl("rec_woofer", 0.06, 0.008, (sx + 0.1825, 0.4025 + 0.11, sz - 0.11), cone, L2, 24, axis="z"),
          cyl("rec_tweeter", 0.018, 0.006, (sx + 0.1825, 0.4025 + 0.22, sz - 0.11), cone, L2, 16, axis="z")]
    fp("shelf_records", p, "floor", "s")
    # the turntable on the shelf (front = -z): base 0.44 x 0.10 x 0.34, platter left, tonearm right
    top = 0.77
    walnut = plastic("#6b4f3a", 0.55, 0, 0.4, "tt_walnut")
    gra = plastic("#33373e", 0.45, 0.2, 0.1, "tt_top")
    metal = plastic("#b9bec7", 0.3, 0.85, 0.05, "tt_metal")
    rubber = plastic("#16171a", 0.95, 0, 0.0, "tt_mat")
    bx, bz = sx, sz - 0.01
    tt = [box("tt_base", (0.44, 0.085, 0.34), (bx, top + 0.0425, bz), walnut, L2, bev=0.004, seg=2),
          box("tt_plate", (0.43, 0.015, 0.33), (bx, top + 0.0925, bz), gra, L2, bev=0.002, seg=1)]
    for k in range(2):
        tt.append(cyl("tt_speed", 0.008, 0.006, (bx - 0.17 + k * 0.025, top + 0.103, bz - 0.13), metal, L2, 14))
    tt += [cyl("tt_arm_post", 0.012, 0.03, (bx + 0.155, top + 0.115, bz + 0.09), metal, L2, 16),
           cyl("tt_arm_rest", 0.004, 0.035, (bx + 0.17, top + 0.1175, bz - 0.06), metal, L2, 8)]
    p += tt
    out = [l2("shelf_records", p, 1.6)]
    # #353 (office-ui.md 11.4): the click box over the base, platter and tonearm (pick.ts hitBox), centred on the body
    hit("turntable", "turntable", Mx((bx, top + 0.08, bz)), (0.46, 0.16, 0.36))
    pt = top + 0.1
    P = Mx((bx - 0.07, pt, bz))
    platter = [cyl("tt_platter", 0.15, 0.02, (0, 0.01, 0), metal, "export", 48, bev=0.002),
               cyl("tt_platter_mat", 0.145, 0.003, (0, 0.0215, 0), rubber, "export", 48),
               cyl("tt_spindle", 0.0035, 0.015, (0, 0.03, 0), metal, "export", 10)]
    pl = live(pivot(join("turntable_platter", place(platter, P)), P), "bot")
    pl["spin"] = {"axis": "y", "rps": 0.556}  # 33 1/3 rpm
    A = Mx((bx + 0.155, pt + 0.035, bz + 0.09))
    arm = [segment("tt_arm_pipe", (0, 0, 0), (-0.02, 0.0, -0.21), 0.004, metal, "export", 10),
           box("tt_headshell", (0.02, 0.006, 0.035), (-0.022, -0.004, -0.225), gra, "export", bev=0.001, seg=1),
           box("tt_finger_lift", (0.012, 0.002, 0.004), (-0.035, 0.0, -0.225), metal, "export"),
           cyl("tt_counterweight", 0.014, 0.03, (0, 0, 0.045), metal, "export", 16, axis="z", bev=0.002)]
    am = live(pivot(join("turntable_arm", place(arm, A)), A), "bot")
    am["arm"] = {"axis": "y", "rest_deg": 0, "play_deg": 25, "sign": 1}  # + swings the headshell over the record
    cover = [box("tt_cover", (0.44, 0.08, 0.34), (0, 0.04, -0.17), glass_mat("tt_cover", "#e8f0f4", 0.3), "export")]
    C = Mx((bx, pt + 0.005, bz + 0.17), rx=math.radians(75))  # hinged at the back edge, open (+rx lifts its front)
    cv = live(pivot(join("turntable_cover", place(cover, C)), C), "bot")
    cv["glass"] = True
    out += [pl, am, cv]
    # 3b the record: jacket 0.31 square + a disc half out of it, labels; home standing in the top-left cubby
    jacket = plastic("#7a6a5a", 0.75, 0, 0.2, "record_jacket")
    vinyl = plastic("#0e0f11", 0.25, 0, 0.3, "record_vinyl")
    label = plastic("#c9a465", 0.6, 0, 0.1, "record_label")
    groove = plastic("#2a2c30", 0.4, 0, 0.2, "record_groove")
    rec = [box("record_jacket", (0.31, 0.004, 0.31), (0, 0, 0), jacket, "export", bev=0.0008, seg=1),
           cyl("record_disc", 0.15, 0.002, (0.08, 0.0035, 0), vinyl, "export", 48),
           cyl("record_label", 0.05, 0.0006, (0.08, 0.0048, 0), label, "export", 32),
           torus("record_groove", 0.1, 0.0004, (0.08, 0.0046, 0), groove, "export", seg=48, rseg=3)]
    o = live(prop("prop_record", "record", rec, (sx - 0.1825, 0.4025 + 0.16, sz - 0.15), (math.pi / 2, 0.0, 0.0)), "prop")
    grip_at(o, "r", (-0.15, 0, 0), (1, 0, 0), (0, -1, 0))
    contact(o, "thumb", (-0.14, 0.002, 0), (0, 1, 0))
    contact(o, "index", (-0.14, -0.002, 0), (0, -1, 0))
    o["hidden_at_rest"] = True
    return out


def build_coffee_bar():
    """4: north of the counter on the east wall: a mini fridge 0.48 x 0.50 x 0.85 (door live, hinged on its south edge,
    a vertical bar handle, a 2 mm gap, a vent grille), a water dispenser 0.30 x 0.30 x 1.05 (a blue-grey bottle, two
    taps with red / blue dots, a drip tray) and a cup rail over the counter (a 0.5 m bar, three hooks, three mugs)"""
    iv = plastic("#ece6d8", 0.45, 0, 0.2, "fridge_body")
    gra = plastic("#33373e", 0.45, 0.4, 0.1, "fridge_handle")
    dark = plastic("#1b1d21", 0.85, 0, 0.0, "fridge_grille")
    xw = HX - 0.005  # 5 mm off the wall (#263: their backs lay on its face)
    fz0, fz1 = FRIDGE_Z - 0.24, FRIDGE_Z + 0.24
    p = [box("fridge_body", (0.46, 0.85, 0.48), (xw - 0.23, 0.425, FRIDGE_Z), iv, L2, bev=0.008, seg=2),
         box("fridge_grille", (0.004, 0.05, 0.40), (xw - 0.461, 0.035, FRIDGE_Z), dark, L2)]
    for k in range(4):
        p.append(box("fridge_slot", (0.002, 0.006, 0.38), (xw - 0.4635, 0.018 + k * 0.012, FRIDGE_Z), plastic("#5a5e66", 0.5, 0.3, 0.1, "fridge_slot"), L2))
    # the door: its own live node, pivot on the south hinge line at the front face
    D = Mx((xw - 0.46, 0.0, fz1 - 0.002))
    door = [box("fridge_door", (0.04, 0.78, 0.476), (-0.02, 0.07 + 0.39, -0.24), iv, "export", bev=0.006, seg=2),
            box("fridge_handle", (0.016, 0.4, 0.02), (-0.048, 0.55, -0.43), gra, "export", bev=0.004, seg=1),
            box("fridge_handle_foot", (0.012, 0.02, 0.016), (-0.044, 0.34, -0.43), gra, "export"),
            box("fridge_handle_foot", (0.012, 0.02, 0.016), (-0.044, 0.76, -0.43), gra, "export")]
    # #280 3 (designer): a dark rubber gasket 2 mm proud of the door's outline (behind its face), three magnet memos
    # on its upper half (#efe6d2, a small round magnet each, two pencil lines), all on the door (they swing with it)
    gk = plastic("#202226", 0.9, 0, 0.0, "fridge_gasket")
    door += [box("fridge_gasket", (0.004, 0.002, 0.48), (-0.003, 0.85 + 0.001, -0.24), gk, "export"),
             box("fridge_gasket", (0.004, 0.002, 0.48), (-0.003, 0.07 - 0.001, -0.24), gk, "export"),
             box("fridge_gasket", (0.004, 0.78, 0.002), (-0.003, 0.46, -0.001), gk, "export"),
             box("fridge_gasket", (0.004, 0.78, 0.002), (-0.003, 0.46, -0.479), gk, "export")]
    memo_m = plastic("#efe6d2", 0.85, 0, 0.1, "fridge_memo")
    ink = plastic("#8a8478", 0.8, 0, 0.0, "fridge_memo_ink")
    for (my, mz, deg, w_, h_, mc) in ((0.73, -0.32, 5, 0.075, 0.09, "#d64545"), (0.70, -0.16, -4, 0.07, 0.07, "#3c6fd6"),
                                      (0.58, -0.27, 2, 0.06, 0.08, "#d9a93a")):
        memo = [box("fridge_memo", (0.0015, h_, w_), (0, 0, 0), memo_m, "export"),
                cyl("fridge_magnet", 0.0065, 0.004, (-0.0025, h_ / 2 - 0.012, 0), plastic(mc, 0.4, 0, 0.05, f"magnet_{mc[1:]}"), "export", 14, axis="x", bev=0.0012)]
        for k in range(2):
            memo.append(box("fridge_memo_ink", (0.0004, 0.0015, w_ * 0.62), (-0.0009, h_ / 2 - 0.032 - k * 0.014, -w_ * 0.08), ink, "export"))
        door += place(memo, Mx((-0.04075, my, mz), rx=math.radians(deg)))
    dr = live(pivot(join("fridge_door", place(door, D)), D), "bot")
    dr["open"] = {"axis": "y", "sign": 1, "deg": 100, "open_s": 0.6, "close_s": 0.4}
    child_empty(None, "fridge_door_grip", D @ Mx((-0.06, 0.55, -0.43)), {"grip_for": "r", "pose": "wrap"})
    fp_box("fridge", "floor", (xw - 0.50, 0.0, fz0), (xw, 0.85, fz1), wall="e")
    # water dispenser
    bot_m = glass_mat("disp_bottle", "#9fb4c4", 0.45)
    p += [box("disp_body", (0.30, 0.70, 0.30), (xw - 0.15, 0.35, DISP_Z), iv, L2, bev=0.01, seg=2),
          lathe("disp_bottle", [(0, 0.70), (0.13, 0.70), (0.13, 0.98), (0.10, 1.03), (0.04, 1.05), (0, 1.05)], (xw - 0.15, 0, DISP_Z), bot_m, L2, seg=28),
          # #280 3 (designer: it read as a face): a wide drip tray 0.24 across the front with a grid, not a narrow mouth
          box("disp_tray", (0.09, 0.015, 0.24), (xw - 0.31, 0.30, DISP_Z), gra, L2, bev=0.003, seg=1)]
    # #280 3 (designer): a grid on the drip tray, a paper cup holder (a ring on an arm, three cups nested) on the north
    # side near the front
    for k in range(10):
        p.append(box("disp_grid", (0.08, 0.003, 0.006), (xw - 0.31, 0.309, DISP_Z - 0.105 + k * 0.0233), plastic("#8b8f96", 0.4, 0.5, 0.05, "disp_grid"), L2))
    hx_, hz_ = xw - 0.24, DISP_Z - 0.15 - 0.048
    cup_p = plastic("#f1ece0", 0.8, 0, 0.1, "paper_cup")
    p += [box("cup_arm", (0.012, 0.012, 0.012), (hx_, 0.60, DISP_Z - 0.15 - 0.005), gra, L2, bev=0.002, seg=1),
          torus("cup_ring", 0.04, 0.003, (hx_, 0.60, hz_), gra, L2, seg=24, rseg=6)]
    for k in range(3):
        p.append(cyl("paper_cup", 0.026, 0.08, (hx_, 0.56 + k * 0.015, hz_), cup_p, L2, 20, r2=0.036))
    p.append(torus("paper_cup_lip", 0.036, 0.0015, (hx_, 0.6 + 0.03, hz_), cup_p, L2, seg=24, rseg=4))
    for k, c in enumerate(("#c0504d", "#4f7fbf")):  # #280 3 (designer): the taps themselves red / blue (two black ones read as eyes)
        tz = DISP_Z - 0.045 + k * 0.09
        p += [box("disp_tap", (0.03, 0.03, 0.025), (xw - 0.315, 0.52, tz), plastic(c, 0.45, 0, 0.05, f"tap_{c[1:]}"), L2, bev=0.004, seg=1),
              cyl("disp_dot", 0.006, 0.002, (xw - 0.316, 0.545, tz), plastic("#efe6d2", 0.5, 0, 0, "tap_cap"), L2, 12)]
        child_empty(None, f"water_tap_{k}", Mx((xw - 0.315, 0.535, tz)), {"press": "water", "hot": k == 0})
    fp_box("water_dispenser", "floor", (xw - 0.33, 0.0, DISP_Z - 0.15 - 0.09), (xw, 1.05, DISP_Z + 0.15), wall="e")  # with the cup holder
    # cup rail over the counter: a bar, three hooks, three mugs hanging by their handles
    cz = COUNTER[1]
    p.append(cyl("cup_rail", 0.006, 0.5, (xw - 0.035, 1.5, cz), gra, L2, 12, axis="z"))
    for k, c in enumerate(("#efe8dc", "#3a3d42", "#b5654a")):
        hz = cz - 0.16 + k * 0.16
        p += [torus("cup_hook", 0.015, 0.002, (xw - 0.05, 1.48, hz), gra, L2, axis="z", half=True, seg=10, rseg=4),
              cyl("hung_mug", 0.04, 0.095, (xw - 0.075, 1.40, hz), plastic(c, 0.3, 0, 0.05, f"hung_mug_{k}"), L2, 20),
              torus("hung_mug_handle", 0.025, 0.006, (xw - 0.075, 1.43, hz + 0.045), plastic(c, 0.3, 0, 0.05, f"hung_mug_{k}"), L2, axis="x", seg=12, rseg=6)]
    return l2("coffee_bar", p, 1.4)


def build_hanging_plants():
    """5: two pothos in terracotta pots on macrame cords from wall brackets over the window, 0.7 either side of its
    middle; the vines fall in front of the glass. soil_plant_hang_<k> for the watering (pot3)"""
    out = []
    cord_m = plastic("#d8cbb0", 0.95, 0, 0.6, "macrame")
    gra = plastic("#33373e", 0.45, 0.4, 0.1, "hang_bracket")
    for k, dx in enumerate((-0.7, 0.7)):
        x, z, y0 = WINDOW_X + dx, -HZ + 0.25, 1.73
        name = f"plant_hang_{k}"
        objs = pothos(name, x, y0, z, z + 0.12, L2)
        for o in objs:
            if o.name.startswith(name + "_body") or o.name.startswith(name + "_rim"):
                o.active_material = plastic("#b5654a", 0.8, 0, 0.3, "terracotta")
        top = (x, 2.43, z)
        objs += [box("hang_bracket", (0.02, 0.02, 0.25), (x, 2.45, -HZ + 0.125), gra, L2, bev=0.003, seg=1),
                 torus("hang_hook", 0.012, 0.0025, top, gra, L2, axis="x", seg=12, rseg=4)]
        for a in range(3):
            ang = 2 * math.pi * a / 3
            objs.append(segment("macrame_cord", top, (x + 0.085 * math.cos(ang), y0 + 0.12, z + 0.085 * math.sin(ang)), 0.0025, cord_m, L2, verts=6))
        out.append(l2(name, plant_tris(name, objs), 1.0))
    return out


def build_frames():
    """6: three thin graphite frames on the west wall between the pod and the door, centres 1.4 m up: 0.5 x 0.7 in
    the middle, 0.4 x 0.5 either side. Mat ivory 3 cm; the picture is a live screen slot frame_<k>_art the app draws
    (a shared 512 poster texture), hit_frame_<k> to press"""
    gra = plastic("#33373e", 0.45, 0.4, 0.1, "frame_alu")
    mat_ = plastic("#ece6d8", 0.85, 0, 0.3, "frame_mat")
    xw = -HX
    out = []
    # #280 3 (user: further right on screen; room-280.md 9.1): 1.3 m north, over the pod, 1.55 up (clear of the heads)
    for k, (w, h, z) in enumerate(((0.4, 0.5, -1.6), (0.5, 0.7, -1.0), (0.4, 0.5, -0.4))):
        y = 1.55
        p = [box("frame_bar", (0.015, 0.02, w), (xw + 0.0075, y + h / 2 - 0.01, z), gra, L2, bev=0.002, seg=1),
             box("frame_bar", (0.015, 0.02, w), (xw + 0.0075, y - h / 2 + 0.01, z), gra, L2, bev=0.002, seg=1),
             box("frame_bar", (0.015, h - 0.04, 0.02), (xw + 0.0075, y, z - w / 2 + 0.01), gra, L2, bev=0.002, seg=1),
             box("frame_bar", (0.015, h - 0.04, 0.02), (xw + 0.0075, y, z + w / 2 - 0.01), gra, L2, bev=0.002, seg=1),
             box("frame_mat", (0.004, h - 0.04, w - 0.04), (xw + 0.004, y, z), mat_, L2)]
        fp(f"frame_{k}", p, "wall", "w")
        out.append(l2(f"frame_{k}", p))
        aw, ah = w - 0.04 - 0.06, h - 0.04 - 0.06
        art = quad(f"frame_{k}_art", aw, ah, screen_mat(f"frame_art_{k}", "#ece6d8", 0.1), "export")
        sc = slot(apply_all(place([art], Mx((xw + 0.0065, y, z), ry=math.pi / 2))[0]), aw, ah)
        sc["frame"] = k
        live(sc, "screen")
        hb = hit(f"frame_{k}", "frame", Mx((xw + 0.02, y, z)), (0.04, h + 0.02, w + 0.02))
        hb["frame"] = k
    return out


def build_wall_shelf():
    """7: a floating oak shelf 0.9 x 0.2 x 0.03 on two graphite brackets, east wall over the chaise, 1.25 up: a
    succulent, a little sansevieria, three books and the win trophy (gold cup 0.12, its band live)"""
    oak = lounge_oak()
    gra = plastic("#33373e", 0.45, 0.4, 0.1, "shelf_bracket")
    xw, z, y = HX, _c(0, 3.4)[1], 1.25
    p = [box("shelf_wall", (0.2, 0.03, 0.9), (xw - 0.1, y, z), oak, L2, bev=0.003, seg=1)]
    for dz in (-0.3, 0.3):
        p += [box("shelf_bracket", (0.008, 0.12, 0.025), (xw - 0.004, y - 0.075, z + dz), gra, L2, bev=0.001, seg=1),
              box("shelf_bracket", (0.16, 0.008, 0.025), (xw - 0.088, y - 0.019, z + dz), gra, L2, bev=0.001, seg=1)]
    top = y + 0.015
    p += plant_tris("wall_succulent", echeveria("wall_succulent", xw - 0.1, top, z - 0.33, L2))
    pot = plastic("#ece6d8", 0.3, 0, 0.1, "mini_pot")
    sw = plastic("#4f8f4a", 0.6, 0, 0.2, "mini_sansevieria")
    p.append(cyl("mini_pot", 0.04, 0.07, (xw - 0.1, top + 0.035, z - 0.18), pot, L2, 18, r2=0.034))
    for k in range(5):
        a = 2 * math.pi * k / 5
        p += place([box("mini_sword", (0.016, 0.16 + 0.03 * (k % 2), 0.003), (0, 0.08, 0), sw, L2)],
                   Mx((xw - 0.1 + 0.012 * math.cos(a), top + 0.07, z - 0.18 + 0.012 * math.sin(a)), ry=a, rx=0.12))
    for k, (c, hh) in enumerate((("#6b3f3a", 0.2), ("#3b4a5a", 0.18), ("#c9b28a", 0.21))):
        p.append(box("wall_book", (0.15, hh, 0.028), (xw - 0.1, top + hh / 2, z + 0.02 + k * 0.03), plastic(c, 0.7, 0, 0.2, f"wall_book_{k}"), L2))
    gold = plastic("#d4a84b", 0.25, 0.9, 0.05, "trophy_gold")
    p += [lathe("trophy", [(0, 0), (0.035, 0), (0.035, 0.012), (0.012, 0.02), (0.008, 0.06), (0.03, 0.075), (0.042, 0.12), (0.038, 0.12), (0.026, 0.08), (0, 0.076)],
                (xw - 0.1, top, z + 0.28), gold, L2, seg=24),
          torus("trophy_handle", 0.022, 0.003, (xw - 0.1, top + 0.095, z + 0.28 - 0.04), gold, L2, axis="x", half=True, seg=12, rseg=4),
          torus("trophy_handle", 0.022, 0.003, (xw - 0.1, top + 0.095, z + 0.28 + 0.04), gold, L2, axis="x", half=True, seg=12, rseg=4)]
    fp("shelf_wall", p, "wall", "e")
    band = [cyl("trophy_band", 0.0365, 0.008, (xw - 0.1, top + 0.006, z + 0.28), plastic("#ffffff", 0.5, 0, 0.1, "trophy_band"), "export", 24)]
    B = Mx((xw - 0.1, top + 0.006, z + 0.28))
    tb = live(pivot(join("shelf_wall_trophy_band", place(band, B)), B), "bot")
    tb["paint"] = "winner"
    return [l2("shelf_wall", p, 1.6), tb]


def build_entry():
    """8: by the door: an umbrella stand (r 0.11 x 0.45, graphite, a rim) with two folded umbrellas (navy, mustard,
    crook handles) and a coir door mat 0.8 x 0.5 with a darker band and pixel letters AGENT OFFICE"""
    gra = plastic("#33373e", 0.45, 0.4, 0.1, "umbrella_stand")
    ux, uz = -HX + 0.2, DOOR_Z - 0.75
    p = [lathe("umbrella_stand", [(0, 0), (0.11, 0), (0.11, 0.45), (0.103, 0.45), (0.103, 0.01), (0, 0.01)], (ux, 0, uz), gra, L2, seg=24),
         torus("umbrella_rim", 0.1065, 0.005, (ux, 0.45, uz), gra, L2, seg=24, rseg=5)]
    for k, (c, dx, dz) in enumerate((("#2c3a5a", -0.03, -0.02), ("#d9b45a", 0.035, 0.03))):
        m = plastic(c, 0.8, 0, 0.4, f"umbrella_{k}")
        bx, bz = ux + dx, uz + dz
        p += [lathe("umbrella_fold", [(0, 0.2), (0.012, 0.22), (0.038, 0.5), (0.03, 0.72), (0.006, 0.8), (0, 0.8)], (bx, 0, bz), m, L2, seg=12),
              segment("umbrella_shaft", (bx, 0.02, bz), (bx, 0.86, bz), 0.005, plastic("#c8ccd4", 0.3, 0.8, 0, "chrome"), L2, verts=8),
              torus("umbrella_handle", 0.025, 0.007, (bx + 0.025, 0.86, bz), plastic("#5a3d26", 0.6, 0, 0.3, "umbrella_handle"), L2, axis="z", half=True, seg=12, rseg=6)]
    fp("umbrella_stand", p, "decor")
    coir = plastic("#8a6a4a", 0.98, 0, 0.9, "door_mat")
    band_m = plastic("#5e4630", 0.98, 0, 0.9, "door_mat_band")
    mx_ = -HX + 0.32
    p += [rounded_slab("door_mat", 0.5, 0.015, 0.8, 0.03, (mx_, 0.0075, DOOR_Z), coir, L2, seg=2),
          # along the mat's long side (by the wall), read from the default camera (user, #280): reading north (-z),
          # the letters' tops to the wall (-x). rot pi/2 about the vertical (text() used to ignore rot); 7 cm letters
          text("door_mat_txt", "AGENT OFFICE", 0.07, (mx_, 0.0158, DOOR_Z), band_m, L2, facing="up", extrude=0.0, rot=math.pi / 2)]
    if not _font and os.path.exists(FONT_PATH):  # the pixel letters (lounge-props.md 8): Galmuri, as the stamp
        _font.append(bpy.data.fonts.load(FONT_PATH))
    if _font:
        p[-1].data.font = _font[0]
    for s_ in (-1, 1):
        p.append(box("door_mat_band", (0.44, 0.0004, 0.012), (mx_, 0.0153, DOOR_Z + s_ * 0.36), band_m, L2))
    return l2("entry", p)


def build_beanbag():
    """9: a round beanbag d 0.8 x 0.55, its top sunk 0.15 in the middle, six seams, a handle loop; nav_beanbag"""
    bx, bz = BEANBAG
    m = plastic("#56624d", 0.95, 0, 0.7, "beanbag")  # designer: baked top #9aa070-#aab07f (olive under the lounge light)
    seam = plastic("#474e3d", 0.95, 0, 0.6, "beanbag_seam")
    prof = [(0, 0), (0.30, 0), (0.38, 0.03), (0.40, 0.14), (0.38, 0.32), (0.32, 0.46), (0.22, 0.53), (0.12, 0.45), (0.04, 0.40), (0, 0.40)]
    p = [smooth(lathe("beanbag", prof, (bx, 0, bz), m, L2, seg=24))]
    for k in range(6):
        a = 2 * math.pi * k / 6
        pts = [(bx + r * math.cos(a) * 1.004, y, bz + r * math.sin(a) * 1.004) for r, y in prof[1:-2]]
        c = rail("beanbag_seam", pts, 0.003, seam, L2)
        c.data.resolution_u, c.data.bevel_resolution = 2, 0
        p.append(c)
    p.append(torus("beanbag_handle", 0.035, 0.006, (bx, 0.3, bz - 0.392), seam, L2, axis="z", half=True, seg=12, rseg=4))
    fp("beanbag", p, "decor")
    nb = nav("beanbag", bx, bz, math.pi, "sofa")
    nb["seat_y"] = 0.40  # the sunk middle of its top (coder: sitting at the sofa's 0.44 floated)
    return l2("beanbag", p)


def build_lounge2():
    # #280 3 (user): the beanbag is gone (its quality fell short); build_beanbag stays for the record, unused, its
    # place left empty
    out = [build_sofa_l(), build_table_low(), build_coffee_bar(), build_entry()]
    out += build_records() + build_hanging_plants() + build_frames() + build_wall_shelf()
    # 1a: the throw pillows: mustard against the long side's west back cushion, blue-grey on the chaise by the corner
    x0, zb = SOFA_L[0] - 1.2, SOFA_L[1] + 0.435
    pillow("prop_pillow_0", "#d9b45a", (x0 + 0.2 + 0.09, 0.64, zb - 0.55), (math.radians(-12), -math.pi / 2, 0.0))  # #280 3: against the west arm
    pillow("prop_pillow_1", "#7f95a8", (4.27, 0.64, 3.63), (math.radians(-12), math.pi / 4, 0.0))  # #280 3: in the corner, facing north-west
    return out


# ================================================================ main
room, floor_node = build_room()
door, door_screen = build_door()
baked(room, "room")
baked(floor_node, "floor")  # #280
for side in "nwse":  # #111: four walls, two atlases
    baked(build_wall(side), "walls_nw" if side in "nw" else "walls_se")
baked(door, "walls_se")  # its wall is w (extras), its atlas the roomier se one
door["wall"] = door_screen["wall"] = "w"
live(door_screen, "screen")
work = []
for i, a in enumerate(AGENTS):
    statics, near, lives, desk_live = build_desk(i, a)
    work.append(statics[0])  # the desk body
    baked(statics[1], "room")  # #195: the agent pad on the floor in the room atlas (the work atlas gets ATLAS_GAIN)
    for o in near:  # #187: the kit and the owner's things, near-field
        baked(o, DESK_ATLAS)
    live(lives[0], "screen")
    live(lives[1], "neon")
    for o, kind in desk_live:
        live(o, kind)
lo_c, hi_c = [min(b[0][k] for b, _ in POD) for k in range(3)], [max(b[1][k] for b, _ in POD) for k in range(3)]
lo_u, hi_u = [min(u[0][k] for _, u in POD) for k in range(3)], [max(u[1][k] for _, u in POD) for k in range(3)]
FOOTPRINTS.append({"name": "pod", "kind": "floor", "wall": None, "lo": lo_u, "hi": hi_u, "core": (lo_c, hi_c)})
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
build_lounge2()  # #280 PR 2
for o, dens in L2_NODES:
    baked(o, "lounge2", density=dens)
for o in VEIN_NODES:
    baked(o, "lounge", density=VEIN_DENSITY)
for o in PLANT_NODES:  # #156: full texel density (half density left dark blotches on the leaves, office-quality.md 0)
    baked(o, "lounge")
live(shade, "neon")
for o in PP_LIVE:  # #280 3: the ping-pong net lattice (baked in: its shadow lies on the table)
    live(o, "bot")
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
build_hands()  # #164: after every prop and agent
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


HAND_REST_M = {}  # node name -> its exported (straight) world matrix, for the preview poses


def pose(i, side, c=(0.0, 0.0, 0.0, 0.0), thumb=(0.0, 0.0)):
    """the designer's hand poses (agents.md 2.7, preview only): one bend value c per finger; segment angles are
    root 75°·c, middle 90°·c, tip 60°·c about local x. thumb = (bend, opposition): first segment 55°·bend about x
    and 60°·opposition about z (toward the palm), second 70°·bend. c = 0 is the exported straight hand."""
    sx = -1 if side == "l" else 1
    n = f"agent_{i}_hand_{side}"

    palm = bpy.data.objects[n].matrix_world.copy()

    def chain(prefix, angles):
        names = [f"{prefix}_{k + 1}" for k in range(len(angles))]
        for nm in names:  # rest = the straight segment relative to its palm (agents move between shots)
            HAND_REST_M.setdefault(nm, palm.inverted() @ bpy.data.objects[nm].matrix_world)
        M = None
        for k, (nm, R) in enumerate(zip(names, angles)):
            rest = palm @ HAND_REST_M[nm]
            M = rest @ R if k == 0 else M @ (HAND_REST_M[names[k - 1]].inverted() @ HAND_REST_M[nm]) @ R
            bpy.data.objects[nm].matrix_world = M

    for f, cf in enumerate(c, start=1):
        chain(f"{n}_f{f}", [Mx(rx=math.radians(a * cf)) for a in (75, 90, 60)])
    b, o = thumb
    chain(f"{n}_t", [Mx(rz=sx * math.radians(60 * o)) @ Mx(rx=math.radians(55 * b)), Mx(rx=math.radians(70 * b))])
    bpy.context.view_layer.update()


GRIP_POSE = ((0.85, 0.88, 0.90, 0.92), (0.7, 1.0))
REST_POSE = ((0.25, 0.25, 0.30, 0.35), (0.2, 0.0))


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
        gr = p["grip_lr"][side] if "grip_lr" in p else p["grip"]
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
                                "plan": ((0.0, 17.0, 0.02), (0.0, 0.0, 0.0)),  # #195: straight down, north up (the #206 plan)
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
    if not want or any(w.startswith("robot") for w in want):
        # #166: the five robots lined up on the open floor (preview only), facing north: each close front (its face,
        # -z) and back (the service plate), then the row from the front and from behind
        rows = []
        for i in range(len(AGENTS)):
            x, z, ry = SPAWN[i]
            R_new = Mx((-1.2 + 0.6 * i, 0, 0.05))
            M = R_new @ Mx((x, 0, z), ry=ry).inverted()
            for o in agent_objs(i):
                o.matrix_world = M @ o.matrix_world
            rows.append(R_new)
        for i, R0 in enumerate(rows):
            t = (R0 @ Mx((0, HEAD_Y + 0.02, 0))).to_translation()
            for tag, off in (("front", (0.3, HEAD_Y + 0.1, -0.9)), ("back", (-0.3, HEAD_Y + 0.15, 0.9))):
                c = (R0 @ Mx(off)).to_translation()
                shoot(f"robot_{i}_{tag}", (c.x, c.z, -c.y), (t.x, t.z, -t.y))
        shoot("robots_front", (0.0, 1.45, -2.4), (0.0, 1.05, 0.05))
        shoot("robots_back", (0.0, 1.55, 2.3), (0.0, 1.05, 0.05))
    # 1a) one 3/4 close-up per object, agents hidden, 800 x 600 (#108: "now" column of the quality table)
    QUALITY = {
        # #126: the plants where #109 put them
        # (seen along the default camera, as the visitor does: the monstera faces it)
        "q_plant_corner": ((2.7, 1.6, 1.9), (4.22, 0.95, 3.18)),
        "q_fig_front": ((3.2, 1.25, 1.95), (4.15, 1.05, 3.05)),  # #156: level with the canopy
        "q_fig_high": ((2.75, 2.7, 1.55), (4.12, 1.1, 3.05)),  # #156: from above, as the default camera
        "q_plant_desk": ((0.95, 1.35, -1.85), (0.0, 0.75, -3.2)),
        "q_plant_sofa": ((2.05, 1.35, 3.74), (0.925, 0.6, 2.75)),
        "q_monstera_top": ((1.25, 1.75, 3.45), (0.905, 0.6, 2.75)),  # #156: from above and in front
        "q_monstera_low": ((0.6, 0.85, 3.45), (0.925, 0.6, 2.75)),
        "q_vine": ((3.25, 2.25, -1.95), (4.0, 1.95, -3.2)),
        "q_succulent": ((-3.55, 1.15, -0.9), (-4.32, 0.8, -1.36)),
        "q_sofa": ((-0.75, 1.35, 0.85), (0.35, 0.4, 2.15)),
        "q_lamp": ((2.6, 1.45, 1.15), (1.6, 1.0, 2.25)),
        "q_pingpong": ((3.45, 1.9, -0.65), (1.75, 0.65, 0.95)),
        "pp_close": ((3.0, 1.3, 2.0), (1.6, 0.5, 0.7)),  # #280 3: the folding table
        "pp_under": ((2.75, 0.4, 1.95), (2.1, 0.25, 0.7)),
        "pp_net": ((1.98, 0.98, 1.3), (1.6, 0.82, 1.0)),
        "pp_props": ((2.05, 0.9, 0.78), (2.05, 0.77, 0.5)),  # #280 3: a paddle
        "pp_ball": ((1.92, 0.83, 0.68), (1.85, 0.78, 0.6)),
        "lib_close": ((2.75, 1.5, -2.9), (3.45, 1.2, -3.95)),  # #280 3: the bookshelf
        "lib_top": ((2.85, 2.15, -3.25), (3.2, 1.9, -3.95)),
        "lib_side": ((3.6, 1.15, -3.35), (2.93, 1.05, -3.85)),
        "lib_pins": ((3.12, 0.62, -3.7), (2.915, 0.6, -3.8)),
        "book_table": ((2.35, 0.95, 2.75), (1.85, 0.45, 3.335)),  # #280 3
        "door_close": ((-3.2, 1.4, 3.3), (-4.75, 1.05, 2.4)),
        "sofa_new": ((2.1, 1.55, 1.5), (3.7, 0.4, 3.25)),  # #280 3: the corner sofa, shelves, frames
        "sofa_corner": ((3.0, 1.0, 2.2), (4.3, 0.5, 3.5)),
        "shelf2": ((3.55, 1.4, -2.45), (4.2, 1.05, -3.95)),
        "lib_row2": ((3.25, 1.05, -2.85), (3.45, 0.95, -3.95)),
        "frames": ((-2.7, 1.6, -0.4), (-4.8, 1.5, -1.0)),
        "door_lever": ((-4.25, 1.2, 3.15), (-4.65, 1.03, 2.85)),
        "door_mat": ((-3.85, 1.7, 3.25), (-4.48, 0.0, 2.4)),  # #280: the mat from the south-east (as the default camera)
        "wb_close": ((1.55, 1.45, -2.75), (0.8, 1.4, -4.1)),  # #280 3: the whiteboard
        "wb_corner": ((1.8, 1.2, -3.55), (1.55, 1.0, -4.06)),
        "esp_close": ((3.78, 1.32, 0.5), (4.42, 1.1, 0.2)),  # #280 3: the espresso machine (counter at x 4.48, z 0.1, front -x)
        "esp_side": ((4.05, 1.3, 0.85), (4.45, 1.1, 0.25)),
        "fridge_disp": ((3.55, 1.0, -0.3), (4.5, 0.6, -1.0)),  # #280 3: the gasket, memos, tray grid, cup holder
        "rec_jacket": ((0.4, 0.5, 2.85), (0.45, 0.2, 3.8)),
        "q_game": ((-0.25, 1.5, 0.55), (-1.35, 0.6, 1.55)),
        "q_counter": ((-1.9, 1.55, 0.55), (-3.2, 0.95, 1.32)),
        "q_shelf": ((2.0, 1.3, -0.35), (2.85, 1.0, -2.57)),
        "q_boards": ((1.55, 1.5, 0.3), (1.05, 1.45, -2.73)),
        "q_door": ((-1.35, 1.45, 1.15), (-3.4, 1.1, 2.12)),
        "q_window": ((-1.2, 1.5, -0.55), (-1.8, 1.7, -2.75)),
        "q_rug": ((0.55, 2.7, -0.45), (0.55, 0.0, 1.5)),
        "q_shelfbooks": ((3.35, 1.25, -2.1), (4.1, 1.0, -3.3)),  # #199: the three shelves' right ends
        "q_shelfbook_close": ((3.92, 1.12, -2.78), (4.16, 1.02, -3.22)),
        "q_mug": ((3.62, 1.28, -1.62), (4.0, 0.96, -1.93)),  # #156: from above at a slant, the inside and the coffee
        "q_can": ((3.25, 0.62, 2.75), (3.78, 0.12, 3.3)),
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
        if not want or "q_shelf_empty" in want:  # #199: one book taken out: the shelf baked empty behind it
            gone = [o for o in bpy.data.objects if o.name.startswith("prop_shelfbook_3")]  # shelf 2, the left one
            for o in gone:
                o.hide_render = True
            shoot("q_shelf_empty", (3.92, 1.12, -2.78), (4.16, 1.02, -3.22))
            for o in gone:
                o.hide_render = False
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
    # #280: three shelves, one project each: 18 / 21 / 9 files shown
    secret = {(0, 2), (1, 5), (1, 8), (2, 1)}
    shown = (18, 21, 9)
    for r in range(len(LIB_ROWS)):
        for k in range(LIB_N):
            parts = [bpy.data.objects[f"shelf_r{r}_b{k}{x}"] for x in ("", "_band", "_label", "_secret")]
            n = shown[r]
            if k % LIB_GROUP >= n:
                for o in parts:
                    o.hide_render = True
                continue
            if (r, k) in secret:
                parts[0].material_slots[0].material = manila
            else:
                parts[3].hide_render = True
            if k % LIB_GROUP == n - 1 and n < LIB_GROUP:
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
    pose(0, "r", *GRIP_POSE)
    shoot("hold_paddle", (1.15, 1.15, 1.9), (0.45, 0.85, 1.2))
    hold(3, "r", "prop_cup_1", upright=True)
    pose(3, "r", *GRIP_POSE)
    shoot("hold_cup", (1.15, 1.05, -2.6), (0.6, 0.86, -2.1))
    for n, M in saved.items():
        bpy.data.objects[n].matrix_world = M
    # #135: the book (its halves follow the spine), the watering can, a stone pinched (agents.md 2.7 "집기")
    if not want or any(n in want for n in ("hold_book", "hold_can", "hold_piece", "hold_piece_in", "hold_piece_top")):
        names = ("prop_book", "prop_book_l", "prop_book_r", "prop_watering_can", "prop_piece_a")
        saved = {n: bpy.data.objects[n].matrix_world.copy() for n in names}

        def near(i, side, d=(0.32, 0.12, 0.42)):
            h = bpy.data.objects[f"agent_{i}_hand_{side}"].matrix_world.to_translation()
            t = (h.x, h.z, -h.y)
            return (t[0] + d[0], t[1] + d[1], t[2] + d[2]), t

        hold(1, "r", "prop_book")
        for n in ("prop_book_l", "prop_book_r"):
            bpy.data.objects[n].matrix_world = bpy.data.objects["prop_book"].matrix_world.copy()
        pose(1, "r", *GRIP_POSE)
        shoot("hold_book", *near(1, "r"))
        hold(2, "r", "prop_watering_can")
        pose(2, "r", *GRIP_POSE)
        shoot("hold_can", *near(2, "r", (0.45, 0.1, 0.55)))
        PINCH = ((0.90, 0.25, 0.30, 0.35), (0.0, 0.7))  # agents.md 2.7 "집기" (OK hand)

        def tip(n):
            """the vertex farthest from the segment's pivot (world)"""
            o = bpy.data.objects[n]
            p = o.matrix_world.to_translation()
            return max((o.matrix_world @ v.co for v in o.data.vertices), key=lambda w: (w - p).length)

        for side in "lr":  # where index and thumb tips meet, in each grip frame (web axes): the pinch grip offset
            pose(1, side, *PINCH)
            bpy.context.view_layer.update()
            n = f"agent_1_hand_{side}"
            q = bpy.data.objects[f"{n}_grip"].matrix_world.inverted() @ ((tip(f"{n}_f1_3") + tip(f"{n}_t_2")) / 2)
            print(f"pinch point, {side} grip frame (web):", [round(q.x, 4), round(q.z, 4), round(-q.y, 4)])
            # #164: the hand's fingers and palm directions in its grip frame (web axes): straight hand, then curled
            Gi = bpy.data.objects[f"{n}_grip"].matrix_world.inverted().to_3x3()
            pose(1, side)
            bpy.context.view_layer.update()
            palm_at = bpy.data.objects[n].matrix_world.to_translation()
            straight = tip(f"{n}_f2_3")
            fingers = (Gi @ (straight - palm_at)).normalized()
            pose(1, side, (1, 1, 1, 1))
            bpy.context.view_layer.update()
            curl = Gi @ (tip(f"{n}_f2_3") - straight)
            palm = (curl - curl.project(fingers)).normalized()
            print(f"hand axes, {side} grip frame (web): fingers", [round(fingers.x, 3), round(fingers.z, 3), round(-fingers.y, 3)],
                  "palm", [round(palm.x, 3), round(palm.z, 3), round(-palm.y, 3)])
            # #178: the same in the palm node's own frame and in the agent's frame (web axes), at rest
            curl_w = tip(f"{n}_f2_3") - straight
            pose(1, side)
            bpy.context.view_layer.update()
            fw = (straight - palm_at).normalized()
            pw = (curl_w - curl_w.project(fw)).normalized()
            tw = (bpy.data.objects[f"{n}_t_1"].matrix_world.to_translation() - palm_at).normalized()
            for frame_name, Fm in (("palm node", bpy.data.objects[n].matrix_world), ("agent", bpy.data.objects["agent_1"].matrix_world)):
                Fi = Fm.inverted().to_3x3().normalized()

                def wv3(v):
                    q = (Fi @ v).normalized()
                    return [round(q.x, 3), round(q.z, 3), round(-q.y, 3)]
                print(f"hand axes, {side} {frame_name} frame (web): fingers", wv3(fw), "palm", wv3(pw), "thumb", wv3(tw))
            pose(1, side, *PINCH)
            bpy.context.view_layer.update()
        hold(1, "l", "prop_piece_a")
        shoot("hold_piece", *near(1, "l", (-0.2, 0.08, 0.28)))
        shoot("hold_piece_in", *near(1, "l", (0.22, 0.02, 0.12)))
        shoot("hold_piece_top", *near(1, "l", (0.02, 0.3, 0.05)))
        for n, M in saved.items():
            bpy.data.objects[n].matrix_world = M
    # #164, as the app will do it: the hand moved so its _grip sits on the prop's <prop>_grip_<side>, then posed
    FITS = {  # shot: [(agent, side, grip empty, finger c, thumb)], the empty to aim at
        "fit_cup": ([(3, "r", "prop_cup_1_grip_r", (0.7, 0.75, 0.85, 0.9), (0.4, 0.6))], "prop_cup_1"),
        "fit_paddle": ([(0, "r", "prop_paddle_a_grip_r", (0.3, 0.85, 0.9, 0.92), (0.3, 0.4))], "prop_paddle_a"),
        "fit_pen": ([(2, "r", "prop_tablet_pen_grip_r", (0.5, 0.6, 0.8, 0.85), (0.5, 0.8))], "prop_tablet_pen"),
        "fit_can": ([(2, "r", "prop_watering_can_grip_r", GRIP_POSE[0], GRIP_POSE[1]),
                     (2, "l", "prop_watering_can_grip_l", (0.2, 0.2, 0.25, 0.3), (0.1, 0))], "prop_watering_can"),
        "fit_book": ([(1, "l", "prop_book_grip_l", (0.15, 0.15, 0.2, 0.25), (0.1, 0)),
                      (1, "r", "prop_book_grip_r", (0.15, 0.15, 0.2, 0.25), (0.1, 0))], "prop_book"),
        "fit_mouse": ([(0, "r", "desk_0_mouse_grip_r", (0.3, 0.35, 0.4, 0.45), (0.3, 0.2))], "desk_0_mouse_grip_r"),
    }
    if not want or any(n in want for n in FITS):
        O = bpy.data.objects
        moved = {}
        for name, (fits, aim) in FITS.items():
            if want and name not in want:
                continue
            lift = O.get(aim) if aim.startswith("prop_") else None  # lift the prop clear of its table (children follow)
            if lift:
                moved.setdefault(aim, lift.matrix_world.copy())
                lift.matrix_world = Matrix.Translation(W(0, 0.3, 0)) @ lift.matrix_world
                bpy.context.view_layer.update()
            for i, side, g, c, th in fits:
                n = f"agent_{i}_hand_{side}"
                pose(i, side)  # records the rest frames before the palm moves
                for m in (n, f"{n}_cuff"):
                    moved.setdefault(m, O[m].matrix_world.copy())
                rel = O[f"{n}_grip"].matrix_world.inverted() @ O[n].matrix_world
                O[n].matrix_world = O[f"{n}_cuff"].matrix_world = O[g].matrix_world @ rel
                bpy.context.view_layer.update()
                pose(i, side, c, th)
            if name == "fit_book":
                book = O["prop_book"].matrix_world
                O["prop_book_l"].matrix_world = book @ Mx(rz=math.pi)
            at = O[aim].matrix_world.to_translation()
            t = (at.x, at.z, -at.y)
            shoot(name, (t[0] - 0.32, t[1] + 0.12, t[2] + 0.34), t)
            if name == "fit_book":
                O["prop_book_l"].matrix_world = O["prop_book"].matrix_world.copy()
        for m, M in moved.items():
            O[m].matrix_world = M
        bpy.context.view_layer.update()
    # 3) the four in a row: front, back, at work — hands in the designer's rest pose (#134)
    for i in range(len(AGENTS)):
        for s in "lr":
            pose(i, s, *REST_POSE)
    XS = (-1.05, -0.35, 0.35, 1.05)
    LZ = -0.9
    for i, x in enumerate(XS):
        move_agent(i, x, LZ, math.pi)
    shoot("agents_front", (0, 1.45, 2.75), (0, 0.78, LZ))
    shoot("hands_rest", (XS[1], 1.05, -0.05), (XS[1], 0.87, LZ))

    def hand_close(name, i, side, back=True):
        """close-up of one hand along its palm normal (back = from the back panel's side)"""
        M = bpy.data.objects[f"agent_{i}_hand_{side}"].matrix_world
        c = M.to_translation()
        nz = (M.to_3x3() @ Vector((0, -1, 0))).normalized()  # the palm normal: hand web +z = Blender local -Y (basis())
        cam_b = c + nz * (-0.3 if back else 0.2) + Vector((0, 0, 0.05))
        shoot(name, (cam_b.x, cam_b.z, -cam_b.y), (c.x, c.z, -c.y))

    # the outer hands of the lineup (MEMO right, LOOP left): an inner hand has the neighbour's hand in front of it
    hand_close("hand_back_rest", 0, "r")
    hand_close("hand_palm_rest", 0, "r", back=False)
    pose(0, "r", *GRIP_POSE)
    hand_close("hand_grip", 0, "r", back=False)
    pose(0, "r", (0.0, 0.9, 0.92, 0.95), (0.6, 0.6))
    hand_close("hand_point", 0, "r")
    pose(0, "r", *REST_POSE)
    hand_close("hand_loop_back", 3, "l")
    pose(3, "r", (0.0, 0.9, 0.92, 0.95), (0.6, 0.6))  # pointing
    pose(3, "l", *GRIP_POSE)  # grip / fist
    shoot("hands_pose", (XS[3], 1.05, -0.05), (XS[3], 0.87, LZ))
    pose(3, "r", *REST_POSE)
    pose(3, "l", *REST_POSE)
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
    nm_ = n["obj"].name  # #280: shelf_r<digit> = the library binders (not shelf_records, baked in lounge2)
    if nm_.startswith(("agent_", "clock_", "window_", "prop_book_", "prop_shelfbook_", "prop_paper_", "omok_stone_", "pp_ball")) or n.get("live") == "prop" \
            or (nm_.startswith("shelf_r") and nm_[7:8].isdigit()) \
            or (nm_.startswith("desk_") and "_mouse" in nm_):  # #305: the mouse moves on its pad
        n["obj"].hide_render = True

atlases = {}
for n in NODES:
    if "atlas" in n:
        atlases.setdefault(n["atlas"], []).append(n)
        if n["drop"]:
            drop_hidden_faces(n["obj"])

images = {}
# #280 (designer: the floor >= 200 px/m): the floor atlas alone is 2560 square (84 m2 of floor at 2048 gave ~180 px/m)
ATLAS_SIZE = {"floor": 2560, "desk_props": 2560, "lounge2": 2560}  # #280 3 (room-280.md 9.4): the near-field two up too
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
    size = ATLAS_SIZE.get(name, SIZE)
    print(f"texels {name}: {size * math.sqrt(uv_area / area):.0f} px/m, UV fill {uv_area * 100:.0f}%, {area:.1f} m2")
    img = bpy.data.images.new(name, size, size, float_buffer=True, alpha=False)
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
    if name in ATLAS_GAIN:  # #195: a linear gain on the float bake (the pod's atlases), and the levels it lands at
        import numpy as np
        img = images[name]
        a_ = np.empty(len(img.pixels), dtype=np.float32)
        img.pixels.foreach_get(a_)
        a_ = a_.reshape(-1, 4)
        lum = a_[:, :3].mean(axis=1)
        lit = lum[lum > 0.01]
        if lit.size:
            print(f"levels {name} (linear, before gain {ATLAS_GAIN[name]}): p50 {np.percentile(lit, 50):.3f} p90 "
                  f"{np.percentile(lit, 90):.3f} p99 {np.percentile(lit, 99):.3f}, >1: {100 * (lum > 1).sum() / lit.size:.1f}%")
        if name == "work":  # three points on the desk tops' islands (the layout #249 baked)
            w_ = img.size[0]
            for (u, v) in ((0.10, 0.535), (0.40, 0.58), (0.56, 0.95)):
                print("top sample (linear):", [round(float(c), 3) for c in a_[int((1 - v) * (w_ - 1)) * w_ + int(u * (w_ - 1)), :3]])
        a_[:, :3] *= ATLAS_GAIN[name]
        img.pixels.foreach_set(a_.ravel())
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
                          export_materials="EXPORT", export_image_format="NONE", export_extras=True,
                          export_attributes=True)  # #225: the caps' _KEY, #231: the pages' _PAGE_U / _PAGE_V
print("atlases:", ", ".join(f"{k} ({len(v)})" for k, v in atlases.items()))
print("DONE", OUT)
