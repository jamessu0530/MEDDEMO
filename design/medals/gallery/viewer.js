import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { idlePose, entrancePose, celebrationPose, easeInOutCubic, ENTRANCE_DURATION } from './motion.js'
import achievementCatalog from './achievement-data.json'

const styles = [
  {file:'ios-A-orbit', name:'活力圓環', code:'A · ORBIT', accent:0x769bff, description:'以 Fitness 成就徽章為靈感。漸層圓環隨著角度變化反射柔光，深色底與白色主圖形保持清楚鮮明。'},
  {file:'ios-B-soft', name:'柔光方章', code:'B · SOFT', accent:0xa28ce6, description:'連續圓角搭配柔白底與紫色浮雕。輕微浮動、柔和傾斜與彈性進場，讓成就看起來輕盈、安靜。'},
  {file:'ios-C-crystal', name:'晶透徽章', code:'C · CRYSTAL', accent:0x51baca, description:'霧透外殼、淡藍底與青色圖形保留清楚的前後層次。轉動時光澤緩緩流過表面，讓材質更有存在感。'},
]
let style=0, kind='stores', tier='gold', request=0, current=null
const canvas=document.getElementById('model')
const status=document.getElementById('status')
const motionLabel=document.getElementById('motion-label')
const motionButton=document.getElementById('motion')
const unlockButton=document.getElementById('unlock')
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)')
let motionEnabled=!reducedMotion.matches
let inView=true, dragging=false, elapsed=0, lastFrame=null, entranceAge=ENTRANCE_DURATION
let celebration=null, cameraTurn=null, interactionUntil=0, draggingUntil=0, pointerDown=null
let running=false, announcedMode='', reducedTimer=null
const hover=new THREE.Vector2()
const smoothHover=new THREE.Vector2()
const cache=new Map()
const scene=new THREE.Scene()
const stage=new THREE.Group()
scene.add(stage)
const accentMaterials=[]
let renderer, controls, camera, sweepLight, effects, resizeObserver, visibilityObserver, environment

function updateMotionLabel() {
  const mode=dragging?'dragging':celebration?.type==='unlock'?'unlock':celebration?'turn':cameraTurn?'viewing':
    !motionEnabled?'paused':entranceAge<ENTRANCE_DURATION?'entering':'idle'
  if(mode===announcedMode)return
  announcedMode=mode
  canvas.dataset.motionState=mode
  motionLabel.textContent=({dragging:'自由旋轉',unlock:'解鎖中',turn:'翻轉中',viewing:'翻面中',paused:'動態已暫停',entering:'柔和進場',idle:'動態展示'})[mode]
  unlockButton.textContent=celebration?.type==='unlock'?'✦ 重新播放':'✦ 播放解鎖'
  motionButton.textContent=motionEnabled?'暫停動態':'播放動態'
  motionButton.setAttribute('aria-pressed',String(motionEnabled))
}

function createEffects() {
  const group=new THREE.Group()
  group.visible=false
  const rings=[0,1].map(()=>{
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.16,.012,8,96),new THREE.MeshBasicMaterial({
      color:styles[style].accent,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending,
    }))
    ring.position.z=-.25
    group.add(ring)
    return ring
  })
  const textureCanvas=document.createElement('canvas')
  textureCanvas.width=textureCanvas.height=32
  const g=textureCanvas.getContext('2d')
  const glow=g.createRadialGradient(16,16,0,16,16,15)
  glow.addColorStop(0,'rgba(255,255,255,1)')
  glow.addColorStop(.17,'rgba(255,255,255,.95)')
  glow.addColorStop(.5,'rgba(255,255,255,.22)')
  glow.addColorStop(1,'rgba(255,255,255,0)')
  g.fillStyle=glow;g.fillRect(0,0,32,32)
  const positions=new Float32Array(36*3)
  const geometry=new THREE.BufferGeometry()
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3))
  const material=new THREE.PointsMaterial({color:styles[style].accent,size:.075,map:new THREE.CanvasTexture(textureCanvas),
    transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending})
  const sparks=new THREE.Points(geometry,material)
  group.add(sparks)
  stage.add(group)
  return {group,rings,sparks,positions}
}

function resetEffects() {
  if(effects)effects.group.visible=false
}

function animateEffects(pose) {
  if(!effects)return
  effects.group.visible=pose.opacity>.002
  for(let i=0;i<effects.rings.length;i++) {
    const ring=effects.rings[i]
    ring.scale.setScalar(.97+pose.burst*(.58+i*.19))
    ring.material.opacity=pose.opacity*(i===0?.6:.24)
  }
  for(let i=0;i<36;i++) {
    const angle=i/36*Math.PI*2+.12*Math.sin(i*1.7)+pose.burst*.24
    const radius=1.08+pose.burst*(.50+(i%5)*.08)
    effects.positions[i*3]=Math.cos(angle)*radius
    effects.positions[i*3+1]=Math.sin(angle)*radius+pose.burst*.14
    effects.positions[i*3+2]=-.08+Math.sin(i*2.1)*.12
  }
  effects.sparks.geometry.attributes.position.needsUpdate=true
  effects.sparks.material.opacity=pose.opacity
}

function shouldRun() {
  return renderer && inView && !document.hidden &&
    (motionEnabled || celebration || cameraTurn || dragging || performance.now()<interactionUntil)
}

function syncLoop() {
  const next=!!shouldRun()
  if(next===running)return
  running=next
  lastFrame=null
  renderer?.setAnimationLoop(next?frame:null)
  if(!next&&renderer&&!document.hidden)renderer.render(scene,camera)
}

function frame(now) {
  const delta=lastFrame===null?0:Math.min((now-lastFrame)/1000,.05)
  lastFrame=now
  if(motionEnabled)elapsed+=delta
  controls.update(delta)
  if(cameraTurn) {
    cameraTurn.age+=delta
    const t=Math.min(1,cameraTurn.age/.82)
    const theta=THREE.MathUtils.lerp(cameraTurn.theta,cameraTurn.target,easeInOutCubic(t))
    const phi=THREE.MathUtils.lerp(cameraTurn.phi,Math.PI/2,easeInOutCubic(t))
    camera.position.setFromSphericalCoords(cameraTurn.radius,phi,theta)
    camera.lookAt(0,0,0)
    if(t===1){cameraTurn=null;controls.enabled=true;controls.update()}
  }
  smoothHover.lerp(hover,1-Math.exp(-delta*5))
  const idle=idlePose(style,elapsed)
  const settling=dragging||now<draggingUntil||!motionEnabled?0:1
  const blend=1-Math.exp(-delta*6)
  if(celebration) {
    celebration.age+=delta
    const pose=celebrationPose(celebration.age,celebration.type)
    stage.rotation.set(pose.x,pose.y,0)
    stage.position.y=pose.lift
    stage.scale.setScalar(pose.scale)
    if(celebration.type==='unlock')animateEffects(pose)
    if(pose.done){celebration=null;stage.rotation.set(0,0,0);resetEffects()}
  } else {
    if(motionEnabled)entranceAge+=delta
    const entrance=entrancePose(entranceAge)
    stage.rotation.x=THREE.MathUtils.lerp(stage.rotation.x,settling*(idle.x-smoothHover.y*.045),blend)
    stage.rotation.y=THREE.MathUtils.lerp(stage.rotation.y,entrance.y+settling*(idle.y+smoothHover.x*.065),blend)
    stage.rotation.z=THREE.MathUtils.lerp(stage.rotation.z,settling*idle.z,blend)
    stage.position.y=THREE.MathUtils.lerp(stage.position.y,entrance.lift+settling*idle.lift,blend)
    stage.scale.setScalar(entrance.scale)
  }
  sweepLight.position.set(-3+Math.sin(elapsed*.48)*2.2,3.4,5)
  for(const mat of accentMaterials)mat.emissiveIntensity=.045+(motionEnabled?Math.sin(elapsed*.8)*.018:0)
  updateMotionLabel()
  renderer.render(scene,camera)
  if(!shouldRun())syncLoop()
}

function wakeForInteraction() {
  interactionUntil=performance.now()+1000
  syncLoop()
}

try {
  renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true})
  renderer.setPixelRatio(Math.min(devicePixelRatio,2))
  renderer.toneMapping=THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure=1.05
  const pmrem=new THREE.PMREMGenerator(renderer)
  environment=pmrem.fromScene(new RoomEnvironment(),.04)
  scene.environment=environment.texture
  pmrem.dispose()
  camera=new THREE.PerspectiveCamera(30,1,.01,100)
  camera.position.set(.6,.3,6.8)
  controls=new OrbitControls(camera,canvas)
  controls.enableDamping=true
  controls.enablePan=false
  controls.minDistance=3.9
  controls.maxDistance=9
  controls.addEventListener('start',()=>{
    dragging=true;celebration=null;cameraTurn=null;resetEffects();updateMotionLabel();wakeForInteraction()
  })
  controls.addEventListener('end',()=>{
    dragging=false;draggingUntil=performance.now()+900;updateMotionLabel();wakeForInteraction()
  })
  controls.addEventListener('change',()=>{if(!running)wakeForInteraction()})
  sweepLight=new THREE.DirectionalLight(0xffffff,2.4)
  sweepLight.position.set(-3,4,6)
  scene.add(sweepLight)
  const fill=new THREE.DirectionalLight(0xd9eeff,1.5)
  fill.position.set(4,0,2)
  scene.add(fill)
  effects=createEffects()
  resizeObserver=new ResizeObserver(()=>{
    const {width,height}=canvas.getBoundingClientRect()
    if(!width||!height)return
    renderer.setSize(width,height,false)
    camera.aspect=width/height
    camera.updateProjectionMatrix()
    renderer.render(scene,camera)
  })
  resizeObserver.observe(canvas)
  visibilityObserver=new IntersectionObserver(entries=>{
    inView=entries[0].isIntersecting
    syncLoop()
  },{threshold:.02})
  visibilityObserver.observe(canvas)
  syncLoop()
} catch(e) {
  renderer=undefined
  status.textContent='這個瀏覽器無法開啟 3D，仍可用上方渲染圖比較。'
  unlockButton.disabled=true;motionButton.disabled=true
  console.error(e)
}

function stopTransient() {
  celebration=null;cameraTurn=null;controls.enabled=true;resetEffects()
  stage.rotation.set(0,0,0);stage.position.set(0,0,0);stage.scale.setScalar(1)
}

function play(type='unlock') {
  if(!renderer||!current)return
  stopTransient()
  entranceAge=ENTRANCE_DURATION
  if(reducedMotion.matches) {
    motionLabel.textContent=type==='unlock'?'已解鎖':'正面展示'
    clearTimeout(reducedTimer)
    reducedTimer=setTimeout(()=>{announcedMode='';updateMotionLabel()},1800)
    renderer.render(scene,camera)
    return
  }
  camera.position.set(.35,.18,6.8);controls.update()
  celebration={type,age:0}
  updateMotionLabel();syncLoop()
}

function turnCamera(back) {
  if(!renderer||!current)return
  stopTransient();entranceAge=ENTRANCE_DURATION
  const bounds=canvas.getBoundingClientRect()
  if(bounds.bottom<100||bounds.top>innerHeight-100)canvas.scrollIntoView({block:'center',behavior:reducedMotion.matches?'instant':'smooth'})
  const sphere=new THREE.Spherical().setFromVector3(camera.position)
  const target=back?Math.PI:0
  const distance=Math.atan2(Math.sin(target-sphere.theta),Math.cos(target-sphere.theta))
  if(reducedMotion.matches) {
    camera.position.set(0,0,back?-sphere.radius:sphere.radius);controls.update();renderer.render(scene,camera)
  } else {
    cameraTurn={age:0,theta:sphere.theta,target:sphere.theta+distance,phi:sphere.phi,radius:sphere.radius}
    controls.enabled=false;syncLoop()
  }
}

const loader=new GLTFLoader()
async function load() {
  const version=++request
  const selected=styles[style]
  document.getElementById('detail-title').textContent=selected.name
  document.getElementById('detail-code').textContent=selected.code
  document.getElementById('detail-description').textContent=selected.description
  document.getElementById('family-image').src=`./${selected.file}-family.png`
  document.getElementById('family-image').alt=`${selected.name}六面完整獎牌`
  const rank=['bronze','silver','gold'].indexOf(tier)+1
  const achievement=achievementCatalog.find(m=>m.kind===kind&&m.tier===rank)
  const exampleHave=({stores:3,cities:2,chronic:1,otc:0,wellness:2,devices:1})[kind]
  document.getElementById('achievement-title').textContent=achievement.title
  document.getElementById('achievement-condition').textContent=achievement.condition
  const progress=document.getElementById('achievement-progress')
  progress.max=achievement.need;progress.value=Math.min(achievement.need,exampleHave)
  document.getElementById('achievement-count').textContent=`示例進度：${Math.min(achievement.need,exampleHave)} / ${achievement.need} ${achievement.unit}`
  document.querySelector('.family').hidden=!['stores','cities'].includes(kind)
  const file=`./${selected.file}-${kind}-${tier}.glb`
  document.getElementById('model-link').href=file
  if(!renderer)return
  stopTransient();unlockButton.disabled=true;delete canvas.dataset.loaded
  status.textContent='正在載入立體獎牌…'
  try {
    if(!cache.has(file))cache.set(file,loader.loadAsync(file).then(g=>g.scene))
    const next=await cache.get(file)
    if(version!==request)return
    if(current)stage.remove(current)
    current=next;stage.add(current)
    accentMaterials.length=0
    current.traverse(obj=>{
      if(!obj.isMesh)return
      for(const mat of Array.isArray(obj.material)?obj.material:[obj.material]) {
        if(mat.name.includes('Continuous spectrum')&&!accentMaterials.includes(mat)) {
          mat.emissive.set(styles[style].accent);accentMaterials.push(mat)
        }
      }
    })
    effects.rings.forEach(r=>r.material.color.set(selected.accent))
    effects.sparks.material.color.set(selected.accent)
    entranceAge=motionEnabled&&!reducedMotion.matches?0:ENTRANCE_DURATION
    stage.scale.setScalar(entrancePose(entranceAge).scale)
    stage.position.y=entrancePose(entranceAge).lift
    stage.rotation.y=entrancePose(entranceAge).y
    status.textContent='';unlockButton.disabled=false;canvas.dataset.loaded=file
    updateMotionLabel();renderer.render(scene,camera);syncLoop()
  } catch(e) {status.textContent='模型載入失敗，請重新整理。';console.error(e)}
}

function activate(selector,button) {
  document.querySelectorAll(selector).forEach(b=>{
    b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button))
  })
}
document.querySelectorAll('[data-style]').forEach(b=>b.addEventListener('click',()=>{
  style=Number(b.dataset.style)
  document.querySelectorAll('[data-style]').forEach(c=>{
    c.classList.toggle('selected',c===b);c.setAttribute('aria-pressed',String(c===b))
  })
  load()
}))
document.querySelectorAll('[data-kind]').forEach(b=>b.addEventListener('click',()=>{kind=b.dataset.kind;activate('[data-kind]',b);load()}))
document.querySelectorAll('[data-tier]').forEach(b=>b.addEventListener('click',()=>{tier=b.dataset.tier;activate('[data-tier]',b);load()}))
document.getElementById('front').addEventListener('click',()=>turnCamera(false))
document.getElementById('back').addEventListener('click',()=>turnCamera(true))
unlockButton.addEventListener('click',()=>play())
motionButton.addEventListener('click',()=>{
  motionEnabled=!motionEnabled
  if(!motionEnabled&&renderer){stopTransient();entranceAge=ENTRANCE_DURATION;interactionUntil=0}
  announcedMode='';updateMotionLabel();syncLoop()
})
document.getElementById('appearance').addEventListener('click',e=>{
  const dark=document.documentElement.dataset.appearance!=='dark'
  document.documentElement.dataset.appearance=dark?'dark':'light'
  e.currentTarget.setAttribute('aria-pressed',String(dark));e.currentTarget.textContent=dark?'淺色預覽':'深色預覽'
})
canvas.addEventListener('pointerdown',e=>{pointerDown={x:e.clientX,y:e.clientY}})
canvas.addEventListener('pointermove',e=>{
  const box=canvas.getBoundingClientRect()
  hover.set((e.clientX-box.left)/box.width*2-1,(e.clientY-box.top)/box.height*2-1)
})
canvas.addEventListener('pointerleave',()=>hover.set(0,0))
canvas.addEventListener('pointerup',e=>{
  if(pointerDown&&Math.hypot(e.clientX-pointerDown.x,e.clientY-pointerDown.y)<6)play('turn')
  pointerDown=null
})
canvas.addEventListener('pointercancel',()=>{pointerDown=null})
document.addEventListener('visibilitychange',syncLoop)
reducedMotion.addEventListener('change',()=>{
  motionEnabled=!reducedMotion.matches
  if(renderer){stopTransient();entranceAge=ENTRANCE_DURATION}
  announcedMode='';updateMotionLabel();syncLoop()
})
window.addEventListener('pagehide',event=>{
  if(event.persisted){renderer?.setAnimationLoop(null);running=false;lastFrame=null;return}
  renderer?.setAnimationLoop(null);resizeObserver?.disconnect();visibilityObserver?.disconnect()
  controls?.dispose();environment?.dispose();renderer?.dispose();clearTimeout(reducedTimer)
  cache.forEach(p=>p.then(root=>root.traverse(obj=>{
    obj.geometry?.dispose()
    const mats=Array.isArray(obj.material)?obj.material:obj.material?[obj.material]:[]
    mats.forEach(mat=>mat.dispose())
  })).catch(()=>{}))
})
window.addEventListener('pageshow',event=>{if(event.persisted)syncLoop()})
updateMotionLabel()
load()
