"""Small debris scattered along the walking paths (placed and instanced by game/src/world/debris.ts).

Pieces, each its own object, lying on z = 0 (a little sunk is the game's job):
- bone_shard: a long splinter of bone-pale mineral, tapering to a broken point
- bone_rib: a curved rib fragment, snapped at both ends
- bone_knuckle: a rounded knob of bone with a broken socket
- conduit_scrap: a short bent length of conduit, snapped ends, a strand pulled loose
- plate_scrap: a bent, torn scrap of corroded plate
- chip_a, chip_b: stone chips, fractured faces
Vertex colours match the grove kit: R = baked AO, G = mineral crust, B = rust.

Usage: Blender -b --factory-startup -P debris_kit.py -- out.glb
"""
import sys, math, random
import bpy, bmesh
from mathutils import Vector, Matrix, noise

OUT = sys.argv[sys.argv.index("--") + 1:][0]
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob)
rng = random.Random(3)


def link(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def curve_mesh(name, splines, res=3, bres=2):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'; cu.bevel_depth = 1.0; cu.bevel_resolution = bres; cu.use_fill_caps = True; cu.resolution_u = res
    for pts, radii in splines:
        sp = cu.splines.new('NURBS')
        sp.points.add(len(pts) - 1)
        for p, x, r in zip(sp.points, pts, radii):
            p.co = (x.x, x.y, x.z, 1.0); p.radius = r
        sp.order_u = min(4, len(pts)); sp.use_endpoint_u = True
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target='MESH')
    return bpy.context.object


def rough(ob, amount, scale):
    for v in ob.data.vertices:
        v.co += v.normal * amount * noise.noise(v.co * scale)


# Bone splinter: flattened, tapering, lying on the ground.
pts = [Vector((x, 0.01 * math.sin(x * 20), 0.025 - 0.01 * x)) for x in [i * 0.03 for i in range(9)]]
shard = curve_mesh("bone_shard", [(pts, [0.028, 0.03, 0.028, 0.025, 0.02, 0.016, 0.011, 0.006, 0.002])])
for v in shard.data.vertices: v.co.y *= 1.4; v.co.z = max(0.0, v.co.z * 0.7)
rough(shard, 0.004, 40)

# Rib: a curved arc, snapped ends.
pts = [Vector((math.sin(a) * 0.22, math.cos(a) * 0.22 - 0.22, 0.02 + 0.03 * math.sin(a * 2))) for a in [i * 0.2 - 0.6 for i in range(8)]]
rib = curve_mesh("bone_rib", [(pts, [0.016, 0.02, 0.022, 0.022, 0.021, 0.02, 0.018, 0.015])])
for v in rib.data.vertices: v.co.z = max(0.0, v.co.z); v.co.x *= 1.0; v.co.y *= 0.8
rough(rib, 0.003, 45)

# Knuckle: a knob with a broken socket.
bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=3, radius=0.05)
for v in bm.verts:
    p = v.co
    p.x *= 1.5
    if p.x > 0.045: p.x = 0.045 + (p.x - 0.045) * 0.2            # snapped flat
    p += p.normalized() * 0.006 * noise.noise(p * 50) if p.length else Vector()
    p.z = max(-0.01, p.z) + 0.035
knuckle = link("bone_knuckle", bm)

# Conduit scrap: a short bent length of three strands, one pulled loose.
splines = []
for k in range(3):
    a = k * math.tau / 3
    pts = [Vector((x, math.cos(a + x * 3) * 0.022 + 0.02 * math.sin(x * 4), math.sin(a + x * 3) * 0.022 + 0.035 + 0.04 * math.sin(x * 2.5)))
           for x in [i * 0.07 for i in range(7)]]
    splines.append((pts, [0.017] * 7))
loose = [Vector((0.42, 0.0, 0.04)), Vector((0.5, 0.06, 0.03)), Vector((0.56, 0.14, 0.012))]
splines.append((loose, [0.012, 0.01, 0.006]))
scrap = curve_mesh("conduit_scrap", splines)
rough(scrap, 0.002, 60)

# Plate scrap: a thin sheet, bent over and torn at the edges.
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=8, y_segments=6, size=0.14)
for v in bm.verts:
    p = v.co
    p.x *= 1.3
    p.z = 0.05 * max(0.0, p.x / 0.18) ** 2 + 0.008 * noise.noise(p * 30) + 0.01
    if abs(p.y) > 0.1: p.y *= 1 + 0.25 * noise.noise(p * 20)          # torn edge
bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.006)
plate = link("plate_scrap", bm)


def chip(name, seed, size):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=size)
    r = random.Random(seed)
    planes = [Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-0.3, 1))).normalized() for _ in range(4)]
    for v in bm.verts:
        p = v.co
        d = p.normalized()
        for pl in planes:
            k = d.dot(pl)
            if k > 0.5: p -= pl * (k - 0.5) * size * 0.8
        p.z = max(p.z * 0.6, -size * 0.2) + size * 0.4
    return link(name, bm)


chip_a = chip("chip_a", 1, 0.05)
chip_b = chip("chip_b", 2, 0.08)

pieces = [shard, rib, knuckle, scrap, plate, chip_a, chip_b]
bone = {shard, rib, knuckle}
for ob in pieces:
    smooth = ob in bone or ob is scrap
    for p in ob.data.polygons: p.use_smooth = smooth

# Masks: bone is pale crust, scrap is rust, chips are stone.
for ob in pieces:
    me = ob.data
    col = me.color_attributes.new("Col", 'BYTE_COLOR', 'POINT')
    me.color_attributes.active_color = col
    for v in me.vertices:
        p = v.co
        n = noise.noise(p * 25)
        if ob in bone:
            crust, rust = 0.85 + 0.15 * n, max(0.0, n - 0.6) * 0.5
        elif ob in (scrap, plate):
            crust, rust = 0.15 + 0.2 * max(0.0, n), min(1.0, 0.3 + 0.3 * n)
        else:
            crust, rust = 0.45 + 0.3 * n, 0.05
        col.data[v.index].color = (1.0, max(0.0, min(1.0, crust)), max(0.0, min(1.0, rust)), 1.0)

# AO: each on its own patch of ground.
bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
ground = bpy.context.object
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 32
scene.world = scene.world or bpy.data.worlds.new("w")
scene.world.light_settings.distance = 0.15
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for dv in prefs.devices: dv.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print("GPU unavailable", e)
for i, ob in enumerate(pieces):
    ob.location.x = i * 1.5
for ob in pieces:
    me = ob.data
    ao = me.color_attributes.new("AO", 'BYTE_COLOR', 'POINT')
    me.color_attributes.active_color = ao
    me.materials.clear(); me.materials.append(bpy.data.materials.new(ob.name + "_m"))
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    col = me.color_attributes["Col"]
    for i in range(len(me.vertices)):
        c = col.data[i].color; a = ao.data[i].color[0]
        col.data[i].color = (a, c[1], c[2], 1.0)
    me.color_attributes.remove(ao)
    me.color_attributes.active_color = me.color_attributes["Col"]
    print(ob.name, "tris", sum(len(p.vertices) - 2 for p in me.polygons))
for ob in pieces: ob.location.x = 0
bpy.data.objects.remove(ground)

bpy.ops.object.select_all(action='DESELECT')
for o in pieces: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True,
                          export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_materials='NONE',
                          export_normals=True, export_texcoords=False)
print("DEBRIS_OK", OUT)
