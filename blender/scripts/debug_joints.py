# Render joints (spheres + sticks) over a semi-transparent body. Usage: -- <prep.blend> <joints.json> <outdir> [zoom]
import bpy, sys, json
from mathutils import Vector
args = sys.argv[sys.argv.index("--") + 1:]
blend, jpath, outdir = args[:3]
zoom = args[3] if len(args) > 3 else "body"
bpy.ops.wm.open_mainfile(filepath=blend)
J = json.load(open(jpath))
pts = {k: Vector(v) for k, v in J.items() if not k.startswith("_") and isinstance(v, list) and len(v) == 3}
for k in list(pts):
    if k.startswith("Left"):
        p = pts[k]; pts["Right" + k[4:]] = Vector((-p.x, p.y, p.z))
parents = json.load(open(jpath.replace("joints.json", "hierarchy.json"))) if False else None
scene = bpy.context.scene
body = bpy.data.objects["Woman"]
mat = bpy.data.materials.new("ghost"); mat.use_nodes = True
bsdf = mat.node_tree.nodes["Principled BSDF"]; bsdf.inputs["Alpha"].default_value = 0.25 if zoom == "body" else 0.5
bsdf.inputs["Base Color"].default_value = (0.8, 0.8, 0.8, 1)
mat.surface_render_method = 'BLENDED'
body.data.materials.clear(); body.data.materials.append(mat)
red = bpy.data.materials.new("red"); red.use_nodes = True
em = red.node_tree.nodes.new("ShaderNodeEmission"); em.inputs[0].default_value = (1, 0.1, 0.05, 1); em.inputs[1].default_value = 3
red.node_tree.links.new(em.outputs[0], red.node_tree.nodes["Material Output"].inputs[0])
r = 0.008 if zoom == "body" else 0.003
for k, p in pts.items():
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=p)
    bpy.context.object.data.materials.append(red)
chains = [["Hips","Spine","Spine1","Spine2","Neck","Head","HeadTop_End"]]
for side in ("Left", "Right"):
    chains += [["Spine2", side+"Shoulder", side+"Arm", side+"ForeArm", side+"Hand"],
               ["Hips", side+"UpLeg", side+"Leg", side+"Foot", side+"ToeBase", side+"Toe_End"]]
    for f in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
        c = [side+"Hand"] + [f"{side}Hand{f}{i}" for i in range(1, 5)]
        chains.append([n for n in c if n in pts])
for c in chains:
    for a, b in zip(c, c[1:]):
        if a in pts and b in pts:
            A, B = pts[a], pts[b]; d = B - A
            bpy.ops.mesh.primitive_cylinder_add(radius=r * 0.4, depth=d.length, location=(A + B) / 2)
            o = bpy.context.object; o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler(); o.data.materials.append(red)
scene.render.engine = 'BLENDER_EEVEE'
w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.2, 0.2, 0.22, 1)
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam
cd.type = 'ORTHO'
def shoot(name, loc, tgt, scale, res):
    scene.render.resolution_x, scene.render.resolution_y = res
    cam.location = loc; cd.ortho_scale = scale
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f"{outdir}/joints_{zoom}_{name}.png"; bpy.ops.render.render(write_still=True)
if zoom == "body":
    shoot("front", (0, -5, 0.83), (0, 0, 0.83), 1.75, (700, 1000))
    shoot("side", (5, 0, 0.83), (0, 0, 0.83), 1.75, (700, 1000))
else:
    h = pts["LeftHand"]
    shoot("front", h + Vector((0, -2, -0.08)), h + Vector((0, 0, -0.08)), 0.3, (800, 800))
    shoot("side", h + Vector((2, 0, -0.08)), h + Vector((0, 0, -0.08)), 0.3, (800, 800))
