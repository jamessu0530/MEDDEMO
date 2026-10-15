"""Second design round: iOS-inspired achievement medals, built in Blender.

Reference: Apple's app icon guidance (simple motifs and layered depth) and
Fitness awards. These are original 3D assets, not native iOS interface materials.
Run: blender -b --factory-startup -t 4 --python design/medals/build_ios_medals.py
"""
import sys
import math
import json
from pathlib import Path
import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_medals as base

OUT=base.OUT
SOURCE=base.SOURCE
STYLES=["ios-A-orbit","ios-B-soft","ios-C-crystal"]
METALS=["B78662","CAD1DA","E1BE7A"]
INKS=["262538","7762C9","276E82"]
FACES=["1B1E2B","F0EFFB","D1E5EF"]
TAU=math.tau


def round_corners(points, radius=.085, steps=6):
    result=[]
    for i,p in enumerate(points):
        p=Vector(p)
        prev=Vector(points[i-1]); nxt=Vector(points[(i+1)%len(points)])
        cut=min(radius,(prev-p).length*.35,(nxt-p).length*.35)
        a=p+(prev-p).normalized()*cut
        b=p+(nxt-p).normalized()*cut
        for j in range(steps+1):
            t=j/steps
            q=(1-t)**2*a+2*t*(1-t)*p+t*t*b
            result.append(tuple(q))
    return result


def squircle(radius=1, exponent=4.4, n=128):
    points=[]
    for i in range(n):
        a=TAU*i/n
        x=math.cos(a); z=math.sin(a)
        points.append((radius*math.copysign(abs(x)**(2/exponent),x),
                       radius*math.copysign(abs(z)**(2/exponent),z)))
    return points


def plate(name, shape, depth, y, mat, root, bevel=.055):
    ob=base.prism(name,shape,depth,y,mat,root,bevel)
    ob.modifiers["Soft machined edges"].segments=6
    return ob


def dot(root, mat, x, z, y, r=.033):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,radius=1,location=(x,y,z))
    ob=bpy.context.object
    ob.scale=(r,r*.4,r)
    return base.finish(ob,"Level indicator",mat,root)


def cross(root, mat, y, scale=.92):
    points=[(-.17,.50),(.17,.50),(.17,.17),(.50,.17),(.50,-.17),(.17,-.17),
            (.17,-.50),(-.17,-.50),(-.17,-.17),(-.50,-.17),(-.50,.17),(-.17,.17)]
    points=round_corners([(x*scale,z*scale+.055) for x,z in points],.10*scale)
    return plate("Rounded pharmacy symbol",points,.075,y,mat,root,.012)


def marker(root, mat, y, scale=.88):
    # One continuous silhouette with a true hole through the raised pin.
    points=[(.40*math.cos(TAU*i/64),.40*math.sin(TAU*i/64)+.19) for i in range(33)]
    points += [(-.40,.16),(-.33,-.11),(-.17,-.38),(0,-.60),(.17,-.38),(.33,-.11),(.40,.16)]
    curve=bpy.data.curves.new("Rounded destination symbol","CURVE")
    curve.dimensions="2D"
    curve.fill_mode="BOTH"
    curve.resolution_u=2
    curve.extrude=.028
    curve.bevel_depth=.014
    curve.bevel_resolution=4
    for pts in [points,[(.145*math.cos(-TAU*i/48),.145*math.sin(-TAU*i/48)+.19) for i in range(48)]]:
        spline=curve.splines.new("POLY")
        spline.points.add(len(pts)-1)
        for p,(x,z) in zip(spline.points,pts):p.co=(x*scale,z*scale+.04,0,1)
        spline.use_cyclic_u=True
    ob=bpy.data.objects.new("Open-centered destination pin",curve)
    bpy.context.collection.objects.link(ob)
    ob.location=(0,y,0)
    ob.rotation_euler=(math.pi/2,0,0)
    return base.finish(ob,"Open-centered destination pin",mat,root)


def gradient_arc(root,radius,thickness,y,start,end,colors):
    # Continuous vertex colors keep the spectrum ring to a single draw call.
    count=160
    sides=12
    verts=[]; values=[]; faces=[]
    for i in range(count+1):
        progress=i/count
        q=progress*(len(colors)-1)
        left=int(q); right=min(left+1,len(colors)-1); t=q-left
        a=base.rgb(colors[left]); b=base.rgb(colors[right])
        linear=tuple(a[k]*(1-t)+b[k]*t for k in range(3))
        angle=start+(end-start)*progress
        for j in range(sides):
            u=TAU*j/sides
            r=radius+thickness*math.cos(u)
            verts.append((r*math.cos(angle),y+thickness*math.sin(u),r*math.sin(angle)))
            values.append((*linear,1))
    for i in range(count):
        for j in range(sides):
            k=(j+1)%sides
            faces.append((i*sides+j,i*sides+k,(i+1)*sides+k,(i+1)*sides+j))
    mesh=bpy.data.meshes.new("Continuous spectrum arc")
    mesh.from_pydata(verts,[],faces); mesh.update()
    attr=mesh.color_attributes.new(name="Spectrum",type="FLOAT_COLOR",domain="POINT")
    for point,value in zip(attr.data,values):point.color=value
    mat=base.material("Continuous spectrum finish","FFFFFF",.16,.27)
    node=mat.node_tree.nodes.new("ShaderNodeVertexColor")
    node.layer_name="Spectrum"
    mat.node_tree.links.new(node.outputs["Color"],mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    ob=bpy.data.objects.new("Continuous spectrum arc",mesh)
    bpy.context.collection.objects.link(ob)
    base.finish(ob,"Continuous spectrum arc",mat,root)
    # Rounded termini make the ring read cleanly at icon size.
    for angle,color in [(start,colors[0]),(end,colors[-1])]:
        mat=base.material("Arc rounded end",color,.16,.27)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,radius=thickness,
            location=(radius*math.cos(angle),y,radius*math.sin(angle)))
        base.finish(bpy.context.object,"Arc rounded end",mat,root)


def medallion(style,tier,kind):
    tag=f"{STYLES[style]}-{kind}-{base.TIERS[tier-1]}"
    root=bpy.data.objects.new(tag,None)
    bpy.context.collection.objects.link(root)
    root["style"]=STYLES[style]; root["tier"]=tier; root["kind"]=kind
    metal=base.material(tag+" / satin metal",METALS[tier-1],.70,.36)
    field=base.material(tag+" / body",FACES[style],.07,.33)
    ink=base.material(tag+" / symbol",INKS[style],.18,.29)
    white=base.material(tag+" / porcelain white","F7FAFF",.05,.26)

    if style==0:
        base.disc("Thin satin-metal edge",1.025,.17,0,metal,root)
        base.disc("Graphite ceramic dial",.973,.105,-.10,field,root)
        base.ring("Single polished lip",.998,.012,-.094,metal,root)
        gradient_arc(root,.827,.065,-.181,math.radians(-59),math.radians(241),
            ["8C74EF","628AF6","39CAD1"] if kind=="cities" else ["43CAD2","6AA5F4","A48CEA"])
        muted=base.material(tag+" / arc track","41465F",.05,.42)
        points=[(.827*math.cos(math.radians(248+j*48/20)),-.181,
                 .827*math.sin(math.radians(248+j*48/20))) for j in range(21)]
        base.line("Quiet ring segment",points,.031,muted,root)
        cross(root,white,-.226,.88) if kind=="stores" else marker(root,white,-.221,.86)
        for i in range(tier):dot(root,metal,(i-(tier-1)/2)*.13,-.59,-.21,.033)
    elif style==1:
        plate("Continuous-radius satin back",squircle(.98),.19,0,metal,root,.075)
        plate("Porcelain rounded-square face",squircle(.953),.14,-.083,field,root,.070)
        cross(root,ink,-.209,1.02) if kind=="stores" else marker(root,ink,-.205,.99)
        for i in range(tier):dot(root,metal,(i-(tier-1)/2)*.14,-.69,-.171,.039)
    else:
        # A modeled translucent object inspired by layered app-icon artwork.
        # Opaque symbol and tinted backing maintain contrast on light surfaces.
        glass=base.material(tag+" / frosted crystal","D4EBF2",.03,.22)
        bsdf=glass.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Transmission Weight"].default_value=.38
        bsdf.inputs["IOR"].default_value=1.44
        bsdf.inputs["Coat Weight"].default_value=.4
        plate("Soft crystal silhouette",squircle(1,3.6),.22,0,glass,root,.085)
        plate("Suspended pale-blue backing",squircle(.87,3.6),.018,.038,field,root,.006)
        # A fine metal band keeps tier colors distinct without heavy decoration.
        points=[(x,-.148,z) for x,z in squircle(.942,3.6)]
        points.append(points[0])
        base.line("Fine satin tier band",points,.017,metal,root)
        cross(root,ink,-.231,.96) if kind=="stores" else marker(root,ink,-.226,.93)
        for i in range(tier):dot(root,metal,(i-(tier-1)/2)*.14,-.66,-.170,.033)

    reverse=base.material(tag+" / reverse", "242736" if style==0 else "E6E9F2",.08,.4)
    base.disc("Reverse center",.72,.018,.12,reverse,root)
    base.text("Reverse category","PHARMACY" if kind=="stores" else "EXPLORER",0,.10,.136,.12,
              white if style==0 else ink,root,back=True)
    base.text("Reverse level",["I","II","III"][tier-1],0,-.15,.136,.18,metal,root,back=True)
    return root


def studio():
    base.studio(1500,1000)
    scene=bpy.context.scene
    scene.cycles.samples=36
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value=.55
    scene.view_settings.view_transform="AgX"
    for obj in scene.objects:
        if obj.type=="LIGHT":
            obj.data.color=(1,1,1)
            if obj.name=="Large softbox":obj.data.energy=700
            if obj.name=="Warm rim":obj.data.energy=300
    cam=scene.camera
    cam.location=(2.2,-11,2.7)
    cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat("-Z","Y").to_euler()
    cam.data.ortho_scale=5.30


def build_family(style):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    roots=[]
    for kind in ["stores","cities"]:
        for tier in [1,2,3]:
            root=medallion(style,tier,kind)
            base.export(root,OUT/f"{STYLES[style]}-{kind}-{base.TIERS[tier-1]}.glb")
            roots.append(root)
    studio()
    for i,root in enumerate(roots):
        for obj in base.children(root):obj.hide_render=i not in [2,5]
    roots[2].location=(-1.16,0,0); roots[5].location=(1.16,.035,0)
    roots[2].rotation_euler.z=-.045; roots[5].rotation_euler.z=.045
    bpy.context.scene.render.filepath=str(OUT/f"{STYLES[style]}.png")
    bpy.ops.render.render(write_still=True)
    for i,root in enumerate(roots):
        for obj in base.children(root):obj.hide_render=False
        root.location=((i%3-1)*2.55,0,1.35 if i<3 else -1.35)
        root.rotation_euler=(0,0,0)
    cam=bpy.context.scene.camera
    cam.location=(0,-14,2.3)
    cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat("-Z","Y").to_euler()
    cam.data.ortho_scale=8.8
    bpy.context.scene.render.resolution_x=1600
    bpy.context.scene.render.resolution_y=1050
    bpy.context.scene.render.filepath=str(OUT/f"{STYLES[style]}-family.png")
    base.configure_view()
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/f"{STYLES[style]}.blend"))
    bpy.ops.render.render(write_still=True)
    print("FAMILY_COMPLETE",STYLES[style],flush=True)


if __name__=="__main__":
    requested=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
    for style in ([int(requested[0])] if requested else range(3)):build_family(style)
    stats_name=f"ios-model-stats-{requested[0]}.json" if requested else "ios-model-stats.json"
    (OUT/stats_name).write_text(json.dumps(base.all_stats,indent=2))
    print("DONE",flush=True)
