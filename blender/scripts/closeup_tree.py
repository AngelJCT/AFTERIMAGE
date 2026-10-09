"""Close-up render of one grove kit mesh with the mask colours, lit low from behind (as the
boards). -- <grove.glb> <mesh name> <out.png> [distance]"""
import bpy, sys
from mathutils import Vector
args = sys.argv[sys.argv.index("--") + 1:]
path, name, out = args[0], args[1], args[2]
dist = float(args[3]) if len(args) > 3 else 6.0
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
obs = [o for o in bpy.data.objects if o.type == 'MESH']
for o in obs:
    if o.name != name: bpy.data.objects.remove(o)
ob = bpy.data.objects[name]
ob.location = (0, 0, 0)
mat = bpy.data.materials.new("m"); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes["Principled BSDF"]
a = nt.nodes.new("ShaderNodeVertexColor"); a.layer_name = ob.data.color_attributes[0].name
sep = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(a.outputs[0], sep.inputs[0])
m1 = nt.nodes.new("ShaderNodeMix"); m1.data_type = 'RGBA'
m1.inputs[6].default_value = (0.03, 0.028, 0.025, 1); m1.inputs[7].default_value = (0.55, 0.5, 0.42, 1)
nt.links.new(sep.outputs[1], m1.inputs[0])
m2 = nt.nodes.new("ShaderNodeMix"); m2.data_type = 'RGBA'; m2.inputs[7].default_value = (0.25, 0.07, 0.03, 1)
nt.links.new(m1.outputs[2], m2.inputs[6]); nt.links.new(sep.outputs[2], m2.inputs[0])
m3 = nt.nodes.new("ShaderNodeMix"); m3.data_type = 'RGBA'; m3.blend_type = 'MULTIPLY'; m3.inputs[0].default_value = 1
nt.links.new(m2.outputs[2], m3.inputs[6]); nt.links.new(sep.outputs[0], m3.inputs[7])
nt.links.new(m3.outputs[2], bsdf.inputs["Base Color"]); bsdf.inputs["Roughness"].default_value = 0.55
ob.data.materials.clear(); ob.data.materials.append(mat)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'; scene.view_settings.view_transform = 'AgX'
w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.8, 0.74, 0.62, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.6
sun = bpy.data.lights.new("s", 'SUN'); sun.energy = 4.0; so = bpy.data.objects.new("s", sun); so.rotation_euler = (1.25, 0.0, 3.0); scene.collection.objects.link(so)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
# Frame the mesh's bounds.
bb = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
centre = sum(bb, Vector()) / 8
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam
cam.location = centre + Vector((0, -dist, dist * 0.18)); cd.lens = 40
cam.rotation_euler = (centre - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.resolution_x, scene.render.resolution_y = 1400, 900
scene.render.filepath = out; bpy.ops.render.render(write_still=True)
