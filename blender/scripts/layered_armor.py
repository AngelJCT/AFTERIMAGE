"""Fit chipped ceramic lamellae to the existing woman, without changing her rig.

Blender -b -P layered_armor.py -- woman_rigged.blend woman_armored.blend
Coordinates are metres, Z up. A fixed seed makes the build repeatable. Each vertex
inherits barycentric skin weights from the surface beneath it, including helpers
and forearm twist; plates never bridge from one limb to another.
"""
import json
import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


SEED = 221037
NAME = 'WomanArmor'


def build(source, output):
    bpy.ops.wm.open_mainfile(filepath=str(source))
    body = bpy.data.objects['Woman']
    rig = bpy.data.objects['WomanRig']
    assert len(rig.data.bones) == 65, 'Use the finished woman rig, including twist bones'
    assert 'eyesClosed' in bpy.data.objects['WomanHead'].data.shape_keys.key_blocks
    if NAME in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects[NAME], do_unlink=True)
    mesh = body.data
    mesh.calc_loop_triangles()
    triangles = list(mesh.loop_triangles)
    positions = [v.co.copy() for v in mesh.vertices]
    normals = [v.normal.copy() for v in mesh.vertices]
    groups = {g.index: g.name for g in body.vertex_groups}
    weights = [{g.group: g.weight for g in v.groups if g.weight > 0.00001} for v in mesh.vertices]
    bvh = BVHTree.FromPolygons(positions, [t.vertices[:] for t in triangles], all_triangles=True)
    tex = next(n.image for n in mesh.materials[0].node_tree.nodes
               if n.type == 'TEX_IMAGE' and n.image and 'basecolor' in n.image.name)
    pixels = np.empty(len(tex.pixels), dtype=np.float32)
    tex.pixels.foreach_get(pixels)
    pixels = pixels.reshape(tex.size[1], tex.size[0], 4)
    uvs = mesh.uv_layers.active.data
    rng = random.Random(SEED)

    def sample(ti, p):
        tri = triangles[ti]
        a, b, c = (positions[i] for i in tri.vertices)
        v0, v1, v2 = b - a, c - a, p - a
        d00, d01, d11 = v0.dot(v0), v0.dot(v1), v1.dot(v1)
        den = max(d00 * d11 - d01 * d01, 1e-20)
        bv = (d11 * v2.dot(v0) - d01 * v2.dot(v1)) / den
        bw = (d00 * v2.dot(v1) - d01 * v2.dot(v0)) / den
        bary = [max(0, 1 - bv - bw), max(0, bv), max(0, bw)]
        total = sum(bary)
        bary = [w / total for w in bary]
        n, uv, skin = Vector(), Vector((0, 0)), defaultdict(float)
        for vi, li, w in zip(tri.vertices, tri.loops, bary):
            n += normals[vi] * w
            uv += uvs[li].uv * w
            for gi, gw in weights[vi].items():
                skin[gi] += gw * w
        skin = dict(sorted(skin.items(), key=lambda kv: -kv[1])[:4])
        total = sum(skin.values())
        skin = {gi: w / total for gi, w in skin.items()}
        rgb = pixels[min(tex.size[1] - 1, max(0, int(uv.y * tex.size[1]))),
                     min(tex.size[0] - 1, max(0, int(uv.x * tex.size[0]))), :3]
        return n.normalized(), skin, rgb

    port = rig.data.bones['LeftShoulderPort'].head_local
    joints = [rig.data.bones[side + joint].head_local for side in ('Left', 'Right')
              for joint in ('ForeArm', 'Leg')]

    def region(p, skin):
        names = [(groups[i], w) for i, w in skin.items()]
        if p.z < 0.16 or p.z > 1.35 or (p - port).length < 0.039:
            return None
        if any(('Hand' in n or 'Foot' in n or 'Toe' in n or n in ('Head', 'Neck')) and w > 0.08 for n, w in names):
            return None
        if any((p - j).length < 0.032 for j in joints):
            return None
        name = max(names, key=lambda nw: nw[1])[0]
        if 'ForeArm' in name:
            return 'forearm', 0.014, 0.021
        if 'Arm' in name or 'Shoulder' in name:
            return 'shoulder', 0.017, 0.028
        if 'UpLeg' in name or name == 'Hips':
            return 'hip-thigh', 0.020, 0.032
        if 'Leg' in name:
            return 'shin', 0.017, 0.026
        return 'torso', 0.019, 0.031

    def ceramic(rgb, minimum=0.29):
        # Atlas samples are scene-linear. Cyan and very dark mechanical seams stay open.
        r, g, b = map(float, rgb)
        return (r * 0.2126 + g * 0.7152 + b * 0.0722 > minimum
                and b - max(r, g * 0.6) < 0.16)

    areas = np.array([t.area for t in triangles])
    cumulative = np.cumsum(areas)
    vertices, faces, colors, skins = [], [], [], []
    grid, counts, plate_ranges = defaultdict(list), Counter(), []
    cell = 0.065

    def key(p):
        return tuple(math.floor(v / cell) for v in p)

    def add_vertex(p, skin, shade):
        vertices.append(tuple(p)); skins.append(skin)
        colors.append((*shade, 1))
        return len(vertices) - 1

    for attempt in range(26000):
        ti = int(np.searchsorted(cumulative, rng.random() * cumulative[-1]))
        tri = triangles[ti]
        a, b, c = (positions[i] for i in tri.vertices)
        u, v = rng.random(), rng.random()
        if u + v > 1:
            u, v = 1 - u, 1 - v
        center = a + (b - a) * u + (c - a) * v
        normal, skin, rgb = sample(ti, center)
        zone = region(center, skin)
        if zone is None or not ceramic(rgb):
            continue
        label, lo, hi = zone
        radius = rng.uniform(lo, hi)
        grid_key = key(center)
        near = [item for x in range(-1, 2) for y in range(-1, 2) for z in range(-1, 2)
                for item in grid[(grid_key[0] + x, grid_key[1] + y, grid_key[2] + z)]]
        if any((center - cp).length < (radius + cr) * 0.86 for cp, cr in near):
            continue
        # Follow the length of the limb, with a slight diagonal grain on the hips.
        dominant = groups[max(skin, key=skin.get)]
        bone = rig.data.bones[dominant]
        down = bone.tail_local - bone.head_local
        if label == 'torso' or dominant == 'Hips':
            down = Vector((0.16 if center.x > 0 else -0.16, 0, -1))
        down = down - normal * down.dot(normal)
        if down.length < 0.05:
            down = Vector((1, 0, 0)).cross(normal)
        down.normalize()
        across = down.cross(normal).normalized()
        angle = rng.uniform(-0.45, 0.45)
        down, across = down * math.cos(angle) + across * math.sin(angle), across * math.cos(angle) - down * math.sin(angle)
        n = rng.choice((5, 6, 7))
        outline = []
        chip = rng.randrange(n)
        for i in range(n):
            phi = (i + rng.uniform(-0.14, 0.14)) * math.tau / n
            reach = rng.uniform(0.80, 1.14)
            outline.append((math.cos(phi) * reach, math.sin(phi) * reach))
            # Break up every straight edge; one deeper missing chip gives each plate an
            # asymmetric outline. Avoid a regular hexagonal / reptile-scale pattern.
            phi += math.pi / n
            reach = rng.uniform(0.77, 1.05) if i != chip else rng.uniform(0.55, 0.72)
            outline.append((math.cos(phi) * reach, math.sin(phi) * reach))
        n = len(outline)
        # Pull the outline back from painted mechanical seams. This preserves the scan's
        # irregular islands and prevents broad new plates blanketing the exposed workings.
        clipped = []
        for x, y in outline:
            for _ in range(4):
                target = center + across * (x * radius) + down * (y * radius * 1.13)
                hit, _, face, distance = bvh.find_nearest(target)
                if hit is None:
                    break
                _, _, cc = sample(face, hit)
                if ceramic(cc, 0.19):
                    break
                x *= 0.80; y *= 0.80
            clipped.append((x, y))
        outline = clipped
        samples = []
        valid = True
        center_bones = set(skin)
        for ring in (0.53, 0.91, 1.0):
            for x, y in outline:
                target = center + across * (x * radius) + down * (y * radius * 1.13)
                target = center.lerp(target, ring)
                hit, _, face, distance = bvh.find_nearest(target)
                if hit is None or distance > 0.017:
                    valid = False; break
                nn, ss, cc = sample(face, hit)
                if nn.dot(normal) < 0.50 or sum(w for gi, w in ss.items() if gi in center_bones) < 0.84:
                    valid = False; break
                if region(hit, ss) is None or (float(cc[2]) - max(float(cc[0]), float(cc[1]) * 0.6) > 0.16):
                    valid = False; break
                samples.append((hit, nn, ss, y, ring, cc))
            if not valid:
                break
        if not valid:
            continue
        first = len(vertices)
        # Warm ivory faces, broken chalk rims, dark ceramic undercuts. Vertex colors are
        # linear, and survive export as COLOR_0; no extra texture or UV seam is needed.
        tone = rng.uniform(0.88, 1.02)
        top = (0.78 * tone, 0.745 * tone, 0.66 * tone)
        underside = (0.075, 0.072, 0.063)
        lift = rng.uniform(0.0018, 0.0032)
        add_vertex(center + normal * 0.0028, skin, top)
        for hit, nn, ss, y, ring, cc in samples:
            leading = max(0, y) * lift * ring
            height = 0.0028 + leading - (0.00065 if ring == 1 else 0)
            wear = 0.86 + 0.14 * min(1, float(np.mean(cc)) / 0.65)
            chip_tone = rng.uniform(0.69, 1.06) if ring == 1 else 1
            shade = tuple(v * wear * chip_tone for v in top)
            add_vertex(hit + nn * height, ss, shade)
        bottom = len(vertices)
        for hit, nn, ss, _, _, _ in samples[-n:]:
            add_vertex(hit + nn * 0.0004, ss, underside)
        base_center = add_vertex(center + normal * 0.0004, skin, underside)
        # Across × down points outwards. Close every plate, with bevel and side walls.
        for i in range(n):
            j = (i + 1) % n
            faces.append((first, first + 1 + i, first + 1 + j))
            for ring in range(2):
                inner, outer = first + 1 + ring * n, first + 1 + (ring + 1) * n
                faces.append((inner + i, outer + i, outer + j, inner + j))
            edge = first + 1 + 2 * n
            faces.append((edge + i, bottom + i, bottom + j, edge + j))
            faces.append((base_center, bottom + j, bottom + i))
        plate_ranges.append((first, len(vertices)))
        grid[grid_key].append((center, radius))
        counts[label] += 1

    armor_mesh = bpy.data.meshes.new(NAME)
    armor_mesh.from_pydata(vertices, [], faces)
    armor_mesh.update()
    armor = bpy.data.objects.new(NAME, armor_mesh)
    bpy.context.collection.objects.link(armor)
    armor.parent = rig
    armor.matrix_world = body.matrix_world.copy()
    armor['layeredArmor'] = True
    armor['armorSeed'] = SEED
    armor['plateCount'] = len(plate_ranges)
    # Flat bevel/side faces; interpolate normals on the broad ceramic surface only.
    for poly in armor_mesh.polygons:
        poly.use_smooth = poly.index % 5 < 2
    attr = armor_mesh.color_attributes.new(name='Color', type='FLOAT_COLOR', domain='POINT')
    for datum, rgba in zip(attr.data, colors):
        datum.color = rgba
    for gi, name in groups.items():
        group = armor.vertex_groups.new(name=name)
        for i, skin in enumerate(skins):
            if gi in skin:
                group.add([i], skin[gi], 'REPLACE')
    modifier = armor.modifiers.new('Surface-matched skin', 'ARMATURE')
    modifier.object = rig
    mat = bpy.data.materials.new('Layered ceramic')
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Roughness'].default_value = 0.56
    color_node = mat.node_tree.nodes.new('ShaderNodeVertexColor')
    color_node.layer_name = 'Color'
    mat.node_tree.links.new(color_node.outputs['Color'], shader.inputs['Base Color'])
    armor_mesh.materials.append(mat)
    armor_mesh.calc_loop_triangles()
    # Fail the build rather than export malformed or unbound geometry.
    assert vertices and len(plate_ranges) > 100
    assert all(math.isfinite(v) for p in vertices for v in p)
    assert all(1 <= len(s) <= 4 and abs(sum(s.values()) - 1) < 1e-6 for s in skins)
    assert all(t.area > 1e-12 for t in armor_mesh.loop_triangles)
    edge_use = Counter(tuple(sorted((p.vertices[i], p.vertices[(i + 1) % len(p.vertices)])))
                       for p in armor_mesh.polygons for i in range(len(p.vertices)))
    assert all(n == 2 for n in edge_use.values()), 'Every plate must be closed'
    stats = {'seed': SEED, 'plates': len(plate_ranges), 'regions': dict(counts),
             'vertices': len(vertices), 'triangles': len(armor_mesh.loop_triangles),
             'bones': len(rig.data.bones), 'maxInfluences': max(map(len, skins)),
             'maxLiftMeters': 0.0065, 'closed': True}
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output))
    output.with_suffix('.json').write_text(json.dumps(stats, indent=2) + '\n')
    print('ARMOR_OK', json.dumps(stats))


if __name__ == '__main__':
    args = sys.argv[sys.argv.index('--') + 1:]
    build(Path(args[0]).resolve(), Path(args[1]).resolve())
