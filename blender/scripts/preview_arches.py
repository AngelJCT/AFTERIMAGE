"""Line up the arcade and render it with the mask colours. -- <grove.glb> <out.png>"""
import bpy, sys
from mathutils import Vector
path, out = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
obs = [o for o in bpy.data.objects if o.type == 'MESH']
mat = bpy.data.materials.new("m"); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes["Principled BSDF"]
a = nt.nodes.new("ShaderNodeVertexColor"); a.layer_name = obs[0].data.color_attributes[0].name
sep = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(a.outputs[0], sep.inputs[0])
m1 = nt.nodes.new("ShaderNodeMix"); m1.data_type = 'RGBA'
m1.inputs[6].default_value = (0.03, 0.028, 0.025, 1); m1.inputs[7].default_value = (0.55, 0.5, 0.42, 1)
nt.links.new(sep.outputs[1], m1.inputs[0])
m2 = nt.nodes.new("ShaderNodeMix"); m2.data_type = 'RGBA'; m2.inputs[7].default_value = (0.25, 0.07, 0.03, 1)
nt.links.new(m1.outputs[2], m2.inputs[6]); nt.links.new(sep.outputs[2], m2.inputs[0])
m3 = nt.nodes.new("ShaderNodeMix"); m3.data_type = 'RGBA'; m3.blend_type = 'MULTIPLY'; m3.inputs[0].default_value = 1
nt.links.new(m2.outputs[2], m3.inputs[6]); nt.links.new(sep.outputs[0], m3.inputs[7])
nt.links.new(m3.outputs[2], bsdf.inputs["Base Color"]); bsdf.inputs["Roughness"].default_value = 0.6
for i, o in enumerate(obs):
    o.data.materials.clear(); o.data.materials.append(mat)
    pass
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'; scene.view_settings.view_transform = 'AgX'
w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.75, 0.72, 0.64, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.8
sun = bpy.data.lights.new("s", 'SUN'); sun.energy = 3.5; so = bpy.data.objects.new("s", sun); so.rotation_euler = (0.9, 0.3, 2.4); scene.collection.objects.link(so)
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam
cam.location = (-6, -34, 3.5); cd.lens = 30
cam.rotation_euler = (Vector((-4, 0, 6.5)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.render.filepath = out; bpy.ops.render.render(write_still=True)
