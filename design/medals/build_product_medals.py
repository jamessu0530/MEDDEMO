"""Blender assets for the four product-learning achievement families."""
import sys
import math
import json
from pathlib import Path
import bpy
from mathutils import Vector

sys.path.insert(0,str(Path(__file__).resolve().parent))
import build_ios_medals as ios
import build_medals as base

KINDS=["chronic","otc","wellness","devices"]
LABELS=["CHRONIC","GENERAL","WELLNESS","DEVICES"]
COLORS=["7762C9","5482C7","43876A","327F94"]


def symbol(root,kind,mat,y):
    white=base.material("Symbol inlay","FAFAFF",0,.35)
    if kind=="chronic":
        pts=[]
        for center,start in [(.25,0),(-.25,math.pi)]:
            for j in range(33):
                a=start+math.pi*j/32
                x=.23*math.cos(a);z=center+.23*math.sin(a)
                # A diagonal capsule; the separating seam remains visible.
                pts.append((x*math.cos(.65)-z*math.sin(.65),x*math.sin(.65)+z*math.cos(.65)+.06))
        ios.plate("Capsule relief",pts,.075,y,mat,root,.012)
        base.line("Capsule dividing inlay",[(-.18,y-.045,-.075),(.18,y-.045,.195)],.013,white,root)
    elif kind=="otc":
        base.disc("Tablet relief",.43,.075,y,mat,root,pos=(0,.06))
        base.cube("Tablet score inlay",(0,y-.045,.06),(.59,.018,.028),white,root,.009)
    elif kind=="wellness":
        pts=[]
        for side,steps in [(1,range(41)),(-1,range(40,-1,-1))]:
            for j in steps:
                t=j/40
                width=.20*math.sin(math.pi*t)
                pts.append((-.31+.62*t+side*width*.8,-.31+.8*t-side*width*.62))
        ios.plate("Leaf relief",pts,.075,y,mat,root,.012)
        base.line("Leaf vein inlay",[(-.20,y-.045,-.20),(.01,y-.045,.06),(.22,y-.045,.34)],.012,white,root)
    else:
        pts=ios.round_corners([(-.35,-.39),(.35,-.39),(.35,.49),(-.35,.49)],.10)
        ios.plate("Device housing relief",pts,.075,y,mat,root,.015)
        lcd=ios.round_corners([(-.25,.02),(.25,.02),(.25,.36),(-.25,.36)],.03)
        ios.plate("Device display",lcd,.012,y-.045,white,root,.004)
        base.line("Device signal trace",[(-.19,y-.06,.17),(-.07,y-.06,.17),(-.02,y-.06,.28),(.06,y-.06,.07),(.10,y-.06,.17),(.19,y-.06,.17)],.012,mat,root)
        base.disc("Device round button",.065,.02,y-.049,white,root,pos=(0,-.22))


def build(style):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    roots=[]
    for ki,kind in enumerate(KINDS):
        for tier in (1,2,3):
            root=ios.medallion(style,tier,"stores")
            root.name=f"{ios.STYLES[style]}-{kind}-{base.TIERS[tier-1]}"
            root["kind"]=kind
            for child in list(root.children):
                if child.name.startswith("Rounded pharmacy symbol"):
                    bpy.data.objects.remove(child,do_unlink=True)
                elif child.type=="FONT" and child.name.startswith("Reverse category"):
                    child.data.body=LABELS[ki]
            ink=base.material(f"{kind} symbol", "F7FAFF" if style==0 else COLORS[ki] if style==1 else "276E82",.18,.29)
            symbol(root,kind,ink,[-.226,-.209,-.231][style])
            base.export(root,base.OUT/f"{ios.STYLES[style]}-{kind}-{base.TIERS[tier-1]}.glb")
            roots.append(root)
    ios.studio()
    # Gold glyph previews in the production style.
    if style==1:
        for ki,kind in enumerate(KINDS):
            for i,root in enumerate(roots):
                for child in base.children(root):child.hide_render=i!=ki*3+2
            cam=bpy.context.scene.camera
            cam.location=(.65,-9,1.2)
            cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat("-Z","Y").to_euler()
            cam.data.ortho_scale=2.75
            bpy.context.scene.render.resolution_x=700
            bpy.context.scene.render.resolution_y=700
            bpy.context.scene.cycles.samples=24
            bpy.context.scene.render.filepath=str(base.OUT/f"product-{kind}.png")
            bpy.ops.render.render(write_still=True)
    for i,root in enumerate(roots):
        for child in base.children(root):child.hide_render=False
        root.location=((i%3-1)*2.5,0,(1.5-i//3)*2.5)
    cam=bpy.context.scene.camera
    cam.location=(0,-17,2.7)
    cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat("-Z","Y").to_euler()
    cam.data.ortho_scale=11.8
    base.configure_view()
    bpy.ops.wm.save_as_mainfile(filepath=str(base.SOURCE/f"{ios.STYLES[style]}-products.blend"))
    (base.OUT/f"product-model-stats-{style}.json").write_text(json.dumps(base.all_stats,indent=2))
    print("PRODUCT_FAMILY_COMPLETE",style,flush=True)


if __name__=="__main__":
    requested=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else []
    for style in ([int(requested[0])] if requested else range(3)):build(style)
