"""Blender 5.2: four editable medal families, 24 web models, and studio previews.

Run: blender --background --python design/medals/build_medals.py
Only generated design artifacts are written; the existing app is untouched.
"""
from pathlib import Path
import math
import json
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "design" / "medals"
OUT = ROOT / "frontend" / "public" / "medal-designs"
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
TAU = math.tau
STYLES = ["A-laurel", "B-hexagon", "C-compass", "D-paw"]
NAMES = ["LAUREL / CLASSIC", "HEXAGON / FUTURE", "COMPASS / JOURNEY", "PAW / FRIENDLY"]
TIERS = ["bronze", "silver", "gold"]
METALS = ["B97745", "CCD7E1", "EBC371"]
ENAMELS = ["23343F", "163E42", "EDE4CB", "F5D8AD"]
ACCENTS = ["E1AD68", "4ECDC5", "276F70", "AA683F"]
all_stats = []


def rgb(h):
    # Convert display hex colors to Blender linear values.
    vals = [int(h[i:i+2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in vals)


def material(name, color, metallic=0, roughness=.3):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb(color), 1)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = mat.diffuse_color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Coat Weight"].default_value = .22 if metallic < .5 else .12
    return mat


def finish(obj, name, mat, parent, bevel=0, smooth=True):
    obj.name = name
    obj.parent = parent
    obj.data.materials.append(mat)
    if bevel:
        mod = obj.modifiers.new("Soft machined edges", "BEVEL")
        mod.width = bevel
        mod.segments = 3
    if obj.type == "MESH" and smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
        n = obj.modifiers.new("Weighted highlights", "WEIGHTED_NORMAL")
        n.keep_sharp = True
    return obj


def cube(name, pos, size, mat, parent, bevel=.02):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat, parent, bevel)


def disc(name, radius, depth, y, mat, parent, vertices=96, pos=(0, 0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth,
        location=(pos[0], y, pos[1]), rotation=(math.pi / 2, 0, 0))
    return finish(bpy.context.object, name, mat, parent, min(.018, depth / 4))


def ring(name, radius, thickness, y, mat, parent, pos=(0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=radius, minor_radius=thickness,
        major_segments=96, minor_segments=10, location=(pos[0], y, pos[1]),
        rotation=(math.pi / 2, 0, 0))
    return finish(bpy.context.object, name, mat, parent)


def prism(name, points, depth, y, mat, parent, bevel=.02):
    n = len(points)
    verts = [(x, y - depth / 2, z) for x, z in points] + [(x, y + depth / 2, z) for x, z in points]
    faces = [tuple(range(n)), tuple(range(2*n-1, n-1, -1))]
    faces += [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat, parent, bevel)


def polygon(n, radius, rotate=0):
    return [(radius*math.cos(rotate+TAU*i/n), radius*math.sin(rotate+TAU*i/n)) for i in range(n)]


def line(name, points, thickness, mat, parent):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 2
    curve.bevel_depth = thickness
    curve.bevel_resolution = 3
    spline = curve.splines.new("POLY")
    spline.points.add(len(points)-1)
    for p, coord in zip(spline.points, points):
        p.co = (*coord, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat, parent)


def text(name, value, x, z, y, size, mat, parent, back=False):
    curve = bpy.data.curves.new(name, "FONT")
    curve.body = value
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.size = size
    curve.extrude = .006
    curve.bevel_depth = .001
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.location = (x, y, z)
    obj.rotation_euler = (math.pi / 2, 0, math.pi) if back else (math.pi / 2, 0, 0)
    return finish(obj, name, mat, parent)


def cross(parent, mat, y=-.28, scale=.72, z=.06):
    s = scale
    pts = [(-.18,.5),(.18,.5),(.18,.18),(.5,.18),(.5,-.18),(.18,-.18),
        (.18,-.5),(-.18,-.5),(-.18,-.18),(-.5,-.18),(-.5,.18),(-.18,.18)]
    return prism("Raised pharmacy cross", [(x*s, a*s+z) for x,a in pts], .09, y, mat, parent, .035)


def pin(parent, mat, field, y=-.29, scale=.85, z=.08):
    pts = [(.35*math.cos(TAU*i/48), (.35*math.sin(TAU*i/48)+.16)) for i in range(25)]
    pts += [(-.35,.13),(-.29,-.08),(-.17,-.30),(0,-.53),(.17,-.30),(.29,-.08),(.35,.13)]
    prism("Raised destination pin", [(x*scale,a*scale+z) for x,a in pts], .10, y, mat, parent, .025)
    disc("Pin enamel inset", .135*scale, .026, y-.065, field, parent, pos=(0,.16*scale+z))


def stars(parent, mat, tier, y=-.29, z=-.61):
    for i in range(tier):
        x = (i-(tier-1)/2)*.19
        pts = [(x+( .07 if j%2==0 else .033)*math.cos(math.pi/2+j*math.pi/5),
            z+( .07 if j%2==0 else .033)*math.sin(math.pi/2+j*math.pi/5)) for j in range(10)]
        prism("Tier star", pts, .028, y, mat, parent, .005)


def leaf(parent, mat, x, z, angle, length=.19, width=.085, y=-.275):
    pts = [(length*math.cos(TAU*i/20), width*math.sin(TAU*i/20)) for i in range(20)]
    pts = [(x+a*math.cos(angle)-b*math.sin(angle),z+a*math.sin(angle)+b*math.cos(angle)) for a,b in pts]
    return prism("Laurel leaf", pts, .04, y, mat, parent, .01)


def medallion(style, tier, kind):
    tag = f"{STYLES[style]}-{kind}-{TIERS[tier-1]}"
    root = bpy.data.objects.new(tag, None)
    bpy.context.collection.objects.link(root)
    root["style"] = STYLES[style]
    root["kind"] = kind
    root["tier"] = tier
    root["front"] = "Blender -Y / glTF +Z"
    metal = material(tag+" / metal", METALS[tier-1], .83, .26)
    edge = material(tag+" / brushed edge", METALS[tier-1], .72, .38)
    enamel = material(tag+" / enamel", ENAMELS[style], .05, .28)
    accent = material(tag+" / accent", ACCENTS[style], .28, .30)
    dark = material(tag+" / engraving", "383D40", .05, .55)
    cream = material(tag+" / ivory", "FFF4DA", 0, .38)

    if style == 0:
        disc("Classic machined medal body", 1.02, .20, 0, edge, root)
        disc("Recessed navy enamel", .91, .07, -.117, enamel, root)
        ring("Sculpted outer rim", .985, .052, -.125, metal, root)
        ring("Fine interior bezel", .865, .018, -.172, metal, root)
        for i in range(64):
            a=TAU*i/64
            ob=cube("Coin edge reed",(1.025*math.cos(a),0,1.025*math.sin(a)),(.018,.14,.037),edge,root,.005)
            ob.rotation_euler.y=-a
        for side in [-1,1]:
            path=[]
            for j in range(25):
                a=math.radians(-65+j*130/24)
                path.append((side*.74*math.cos(a),-.225,.74*math.sin(a)))
            line("Laurel branch",path,.014,metal,root)
            for j in range(8):
                a=math.radians(-53+j*15)
                x=side*.74*math.cos(a); z=.74*math.sin(a)
                leaf(root,metal,x,z,(a+side*.50) if side==1 else math.pi-a-side*.50,length=.125,width=.054)
        cross(root,metal,scale=.85,z=.10) if kind=="stores" else pin(root,metal,enamel,scale=.9,z=.15)
        stars(root,metal,tier,z=-.60)
    elif style == 1:
        shape=polygon(6,1.13,math.pi/6)
        prism("Hexagonal machined shell",shape,.24,0,edge,root,.065)
        prism("Layered hexagonal bezel",polygon(6,1.04,math.pi/6),.07,-.144,metal,root,.025)
        prism("Petrol enamel inset",polygon(6,.945,math.pi/6),.05,-.187,enamel,root,.035)
        for side in [-1,1]:
            line("Circuit trace",[(side*.70,-.232,-.38),(side*.70,-.232,.11),(side*.54,-.232,.26),(side*.54,-.232,.49)],.012,accent,root)
            for z in [-.38,.49]:
                disc("Circuit terminal",.038,.028,-.241,metal,root,pos=(side*(.70 if z<0 else .54),z))
        cross(root,metal,scale=.85,z=.04) if kind=="stores" else pin(root,metal,enamel,scale=.93,z=.15)
        stars(root,accent,tier,y=-.255,z=-.57)
        for side in [-1,1]:
            ob=cube("Bezel highlight",(side*.49,-.205,.74),(.26,.028,.027),accent,root,.008)
            ob.rotation_euler.y=side*.52
    elif style == 2:
        disc("Compass barrel",1.045,.23,0,edge,root)
        disc("Ivory compass dial",.90,.052,-.146,enamel,root)
        ring("Wide compass bezel",.989,.062,-.144,metal,root)
        ring("Dial inner accent",.837,.012,-.185,accent,root)
        for i in range(48):
            a=TAU*i/48
            length=.083 if i%4==0 else .033
            ob=cube("Compass engraved tick",(.934*math.sin(a),-.207,.934*math.cos(a)),(.012,.012,length),accent,root,.003)
            ob.rotation_euler.y=a
        for x,z,label in [(0,.74,"N"),(.73,0,"E"),(-.73,0,"W")]:
            text("Cardinal direction",label,x,z,-.208,.102,accent,root)
        # A real route motif makes the two categories feel related.
        for i in range(9):
            a=i/8
            disc("Route dot",.019,.014,-.20,accent,root,pos=(-.49+a*.26,-.35+math.sin(a*math.pi)*.22))
        cross(root,metal,scale=.72,z=.1) if kind=="stores" else pin(root,accent,enamel,scale=.88,z=.16)
        prism("North compass needle",[(-.085,.48),(0,.64),(.085,.48)],.03,-.234,metal,root,.008)
        stars(root,accent,tier,y=-.224,z=-.58)
    else:
        # Soft scallops and a raised paw refer to the app's bear mascot.
        pts=[]
        for i in range(192):
            a=TAU*i/192
            r=1.0+.060*math.cos(10*a)
            pts.append((r*math.cos(a),r*math.sin(a)))
        prism("Soft scalloped medal",pts,.23,0,edge,root,.055)
        disc("Warm enamel center",.895,.058,-.154,enamel,root)
        ring("Rounded jewelry border",.872,.026,-.195,metal,root)
        # Pads are separate sculpted meshes, with soft specular highlights.
        for x,z,sx,sz in [(-.33,.29,.14,.18),(-.12,.43,.145,.19),(.12,.43,.145,.19),(.33,.29,.14,.18),(0,-.055,.35,.28)]:
            bpy.ops.mesh.primitive_uv_sphere_add(segments=28,ring_count=16,radius=1,location=(x,-.246,z))
            ob=bpy.context.object
            ob.scale=(sx,.07,sz)
            finish(ob,"Sculpted bear paw pad",accent,root)
        if kind=="stores":
            cross(root,cream,y=-.335,scale=.25,z=-.045)
        else:
            pin(root,cream,accent,y=-.332,scale=.28,z=-.02)
        stars(root,metal,tier,y=-.255,z=-.57)
        for side in [-1,1]:
            disc("Enamel sparkle",.035,.025,-.223,cream,root,pos=(side*.61,.11))
            cube("Sparkle ray",(side*.61,-.239,.11),(.019,.018,.14),cream,root,.006)
    # A finished reverse, included in every GLB, is useful when spun in the app.
    disc("Reverse enamel panel",.77,.025,.123,enamel,root)
    ring("Reverse fine rim",.81,.015,.144,metal,root)
    text("Maker's mark","MEDDEMO",0,.27,.159,.16,metal,root,back=True)
    text("Achievement category","PHARMACY" if kind=="stores" else "EXPLORER",0,-.02,.159,.11,accent if style>=2 else metal,root,back=True)
    text("Achievement tier",["I","II","III"][tier-1],0,-.27,.159,.19,metal,root,back=True)
    return root


def children(root):
    return [root]+list(root.children_recursive)


def export(root, target):
    bpy.ops.object.select_all(action="DESELECT")
    selected=children(root)
    for obj in selected:
        obj.select_set(True)
    bpy.context.view_layer.objects.active=root
    # Curves and type are converted on duplicates, preserving editable source.
    bpy.ops.object.duplicate()
    copies=list(bpy.context.selected_objects)
    empty_copies=[obj for obj in copies if obj.type=="EMPTY"]
    for obj in copies:
        if obj.type in {"MESH","CURVE","FONT"}:
            bpy.ops.object.select_all(action="DESELECT")
            obj.select_set(True)
            bpy.context.view_layer.objects.active=obj
            bpy.ops.object.convert(target="MESH")
            # Apply normals and bevels before grouping by material.
            for mod in list(obj.modifiers):
                bpy.ops.object.modifier_apply(modifier=mod.name)
    # Collapse each material to one draw call.
    grouped={}
    for obj in copies:
        if obj.type=="MESH":
            grouped.setdefault(obj.data.materials[0].name,[]).append(obj)
    meshes=[]
    for group in grouped.values():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in group:
            obj.select_set(True)
        bpy.context.view_layer.objects.active=group[0]
        bpy.ops.object.join()
        meshes.append(bpy.context.object)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active=meshes[0]
    bpy.ops.export_scene.gltf(filepath=str(target),export_format="GLB",use_selection=True,
        export_yup=True,export_apply=True,export_materials="EXPORT",export_cameras=False,export_lights=False)
    evaluated=[obj.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh() for obj in meshes]
    triangles=sum(sum(len(p.vertices)-2 for p in mesh.polygons) for mesh in evaluated)
    all_stats.append({"file":target.name,"triangles":triangles,"drawCalls":len(meshes)})
    for obj in list(bpy.context.selected_objects):
        bpy.data.objects.remove(obj,do_unlink=True)
    for obj in empty_copies:
        bpy.data.objects.remove(obj,do_unlink=True)


def camera(pos, target, ortho):
    bpy.ops.object.camera_add(location=pos)
    obj=bpy.context.object
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat("-Z","Y").to_euler()
    obj.data.type="ORTHO"
    obj.data.ortho_scale=ortho
    bpy.context.scene.camera=obj
    return obj


def area(name,pos,power,size,color,target=(0,0,0)):
    data=bpy.data.lights.new(name,"AREA")
    data.energy=power
    data.shape="DISK"
    data.size=size
    data.color=rgb(color)
    ob=bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(ob)
    ob.location=pos
    ob.rotation_euler=(Vector(target)-ob.location).to_track_quat("-Z","Y").to_euler()


def studio(width=1400,height=1000):
    scene=bpy.context.scene
    scene.render.engine="CYCLES"
    scene.cycles.samples=40
    scene.cycles.use_denoising=True
    scene.cycles.device="CPU"
    scene.render.resolution_x=width
    scene.render.resolution_y=height
    scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG"
    scene.render.film_transparent=True
    scene.world=bpy.data.worlds.new("Neutral studio environment")
    scene.world.use_nodes=True
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value=(.35,.35,.35,1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value=.45
    scene.view_settings.view_transform="AgX"
    area("Large softbox",(-3,-5,6),600,5,"FFFFFF")
    area("Warm rim",(4,-1,4),500,3,"FFEAC5")
    area("Cool reflection",(-4,1,1),700,4,"CEE8FF")
    area("Front fill",(1,-6,-1),150,4,"FFFFFF")
    camera((3,-10,3.3),(0,0,0),5.5)


def configure_view():
    for screen in bpy.data.screens:
        for a in screen.areas:
            if a.type=="VIEW_3D":
                a.spaces.active.region_3d.view_perspective="CAMERA"
                a.spaces.active.shading.type="MATERIAL"


def build_family(style):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    roots=[]
    for kind in ["stores","cities"]:
        for tier in [1,2,3]:
            root=medallion(style,tier,kind)
            export(root,OUT/f"{STYLES[style]}-{kind}-{TIERS[tier-1]}.glb")
            roots.append(root)
    studio(1600,1080)
    # Gold pair for the large preview.
    for i,root in enumerate(roots):
        for obj in children(root):
            obj.hide_render=i not in [2,5]
    roots[2].location=(-1.20,0,0)
    roots[5].location=(1.20,.05,0)
    roots[2].rotation_euler.z=-.10
    roots[5].rotation_euler.z=.10
    bpy.context.scene.render.filepath=str(OUT/f"{STYLES[style]}.png")
    bpy.ops.render.render(write_still=True)
    # Six editable models with presentation lights and camera in each .blend.
    for i,root in enumerate(roots):
        for obj in children(root):
            obj.hide_render=False
        root.location=((i%3-1)*2.65,0,1.45 if i<3 else -1.45)
        root.rotation_euler=(0,0,0)
    cam=bpy.context.scene.camera
    cam.location=(0,-14,3.2)
    cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat("-Z","Y").to_euler()
    cam.data.ortho_scale=9.2
    bpy.context.scene.render.resolution_x=1800
    bpy.context.scene.render.resolution_y=1250
    bpy.context.scene.render.filepath=str(OUT/f"{STYLES[style]}-family.png")
    configure_view()
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/f"{STYLES[style]}.blend"))
    bpy.ops.render.render(write_still=True)
    print("FAMILY_COMPLETE",STYLES[style],flush=True)


if __name__=="__main__":
    import sys
    requested=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
    for style in ([int(requested[0])] if requested else range(4)):
        build_family(style)
    stats_name=f"model-stats-{requested[0]}.json" if requested else "model-stats.json"
    (OUT/stats_name).write_text(json.dumps(all_stats,indent=2))
    print("DONE",flush=True)
