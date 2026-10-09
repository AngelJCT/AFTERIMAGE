"""Render the same close-ups with the original vs baked normal map. -- <prep.blend> <baked.png> <outdir>"""
import bpy, sys
from mathutils import Vector
blend, baked, outdir = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.open_mainfile(filepath=blend)
body = bpy.data.objects["Woman"]; mat = body.active_material
ntex = [n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and 'normal' in n.image.name][0]
orig = ntex.image
new = bpy.data.images.load(baked); new.colorspace_settings.name = 'Non-Color'
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'; scene.view_settings.view_transform = 'AgX'
w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.35, 0.37, 1)
# Low, raking key light to reveal relief.
l = bpy.data.lights.new("key", 'SUN'); l.energy = 4.0; l.angle = 0.05
lo = bpy.data.objects.new("key", l); lo.rotation_euler = (1.1, 0.0, -0.9); scene.collection.objects.link(lo)
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam
shots = {
    "hand": ((0.28 - 0.05, -0.42, 0.82), (0.29, -0.02, 0.8), 85),
    "chest": ((0.05, -0.75, 1.25), (0.05, 0, 1.22), 70),
    "port": ((0.55, -0.35, 1.3), (0.18, 0.03, 1.29), 85),
    "head": ((-0.35, -0.55, 1.55), (0, 0, 1.52), 70),
    "knee": ((0.35, -0.6, 0.5), (0.09, 0, 0.47), 70),
}
for key, img in (("tripo", orig), ("baked", new)):
    ntex.image = img
    for name, (loc, tgt, lens) in shots.items():
        scene.render.resolution_x = scene.render.resolution_y = 700
        cam.location = loc; cd.lens = lens
        cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = f"{outdir}/nrm_{name}_{key}.png"; bpy.ops.render.render(write_still=True)
