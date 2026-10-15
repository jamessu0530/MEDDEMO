import * as THREE from "three"
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js"
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js"

import type { MedalKind } from "@/api/me"
import { LOCK_SHACKLE, LOCKED_COLORS, MEDAL_ICON, PRODUCT_ACCENTS, TIER_COLORS } from "@/components/me/medal-colors"

/*
 * 個人頁的立體獎牌（docs/superpowers/specs/2026-10-09-tap-to-ride-and-personal-page-design.md〈獎牌牆〉）。
 * 一張 canvas 蓋在整張獎牌牆的卡片上，每一面畫在自己那一格（scissor），只開一個 WebGL。
 * 平常輕輕左右擺；拖著轉（左右繞直立的軸、上下繞水平的軸），放手保留轉速慢慢減，慢下來回到擺動；
 * 幾乎沒動就放開算點一下：解鎖的翻一圈，沒解鎖的抖一下並呼叫 onLockedTap。
 * 這個檔只在個人頁 import()，three.js 跟著拆成自己的檔，首頁不多載。
 */

export type SlotMedal = { id: string; kind: MedalKind; tier: 1 | 2 | 3; open: boolean; back: [string, string]; fresh: boolean }

export type MedalScene = { sync(medals: SlotMedal[]): void; destroy(): void }

type State = { obj: THREE.Group; key: string; vel: THREE.Vector2; phase: number; dragging: boolean; wiggle: number }

// 拖一個 px 轉多少；點一下翻一圈的轉速；新解鎖快轉的轉速
const DRAG = 0.02
const FLICK = 14
const FRESH_SPIN = 10
// 放開時移動不到幾 px 算點一下
const TAP_PX = 6

function faceTexture(m: SlotMedal, back: boolean): THREE.CanvasTexture {
  const c = m.open ? TIER_COLORS[m.tier] : LOCKED_COLORS
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 256
  const g = canvas.getContext("2d")!
  g.fillStyle = m.open ? "#F0EFFB" : c.inner
  g.beginPath()
  g.roundRect(0, 0, 256, 256, 58)
  g.fill()
  g.fillStyle = m.open ? PRODUCT_ACCENTS[m.kind] : c.icon
  g.strokeStyle = m.open ? PRODUCT_ACCENTS[m.kind] : c.icon
  g.textAlign = "center"
  const font = getComputedStyle(document.body).fontFamily
  if (back) {
    g.font = `44px ${font}`
    g.fillText(m.back[0], 128, 128)
    g.font = `24px ${font}`
    g.fillText(m.back[1], 128, 168)
  } else if (m.open) {
    g.save()
    g.translate(128 - 72, 128 - 72)
    g.scale(6, 6)
    g.fill(new Path2D(MEDAL_ICON[m.kind]), "evenodd")
    g.restore()
  } else {
    g.save()
    g.translate(128 - 60, 128 - 66)
    g.scale(5, 5)
    g.beginPath()
    g.roundRect(3, 11, 18, 11, 2)
    g.fill()
    g.lineWidth = 2.4
    g.lineCap = "round"
    g.stroke(new Path2D(LOCK_SHACKLE))
    g.restore()
  }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  return texture
}

const BACK_SHINE = { metalness: 0.15, roughness: 0.7 }

function buildMedal(m: SlotMedal): THREE.Group {
  const metal = m.open
    ? new THREE.MeshStandardMaterial({ color: TIER_COLORS[m.tier].metal, metalness: 0.92, roughness: 0.26 })
    : new THREE.MeshStandardMaterial({ color: 0x9c97a8, metalness: 0.35, roughness: 0.6 })
  const group = new THREE.Group()
  const shape = new THREE.Shape()
  shape.moveTo(-.55, -.97)
  shape.lineTo(.55, -.97); shape.quadraticCurveTo(.97, -.97, .97, -.55)
  shape.lineTo(.97, .55); shape.quadraticCurveTo(.97, .97, .55, .97)
  shape.lineTo(-.55, .97); shape.quadraticCurveTo(-.97, .97, -.97, .55)
  shape.lineTo(-.97, -.55); shape.quadraticCurveTo(-.97, -.97, -.55, -.97)
  const body = new THREE.ExtrudeGeometry(shape, { depth: .12, bevelEnabled: true, bevelThickness: .025, bevelSize: .025, bevelSegments: 3, steps: 1, curveSegments: 16 })
  body.translate(0, 0, -.06)
  group.add(new THREE.Mesh(body, metal))
  for (const back of [false, true]) {
    // 解鎖的背面是字：跟正面一樣亮的話，環境的高光轉到某些角度會整片蓋過去（銅牌的字幾乎看不到），背面霧一點；正面照舊
    const shine = !m.open ? { metalness: 0.1, roughness: 0.8 } : back ? BACK_SHINE : { metalness: 0.5, roughness: 0.38 }
    const face = new THREE.Mesh(
      new THREE.ShapeGeometry(shape, 24),
      new THREE.MeshStandardMaterial({ map: faceTexture(m, back), ...shine })
    )
    const uv = face.geometry.attributes.uv
    const positions = face.geometry.attributes.position
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (positions.getX(i) + .97) / 1.94, (positions.getY(i) + .97) / 1.94)
    face.position.z = back ? -0.087 : 0.087
    if (back) face.rotation.y = Math.PI
    group.add(face)
  }
  group.visible = false
  return group
}

function dispose(group: THREE.Group) {
  group.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose()
      const materials = Array.isArray(obj.material) ? obj.material : [obj.material]
      materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) material.map?.dispose()
        material.dispose()
      })
    }
  })
}

/** 建不起 WebGL 會丟例外：呼叫端退回平塗的獎牌 */
export function createMedalScene({
  canvas,
  card,
  wall,
  still,
  onLockedTap,
  onContextLost,
}: {
  canvas: HTMLCanvasElement
  card: HTMLElement
  wall: HTMLElement
  still: boolean
  onLockedTap: (id: string) => void
  /** WebGL 被瀏覽器收回（GPU 重置、分頁太多）：畫布一片空白，呼叫端換回平塗的獎牌 */
  onContextLost: () => void
}): MedalScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
  const lost = () => {
    renderer.setAnimationLoop(null)
    onContextLost()
  }
  canvas.addEventListener("webglcontextlost", lost)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  const scene = new THREE.Scene()
  const pmrem = new THREE.PMREMGenerator(renderer)
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  const key = new THREE.DirectionalLight(0xffffff, 1.1)
  key.position.set(3, 4, 5)
  scene.add(key)
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50)
  camera.position.set(0, 0, 4.6)

  const states = new Map<string, State>()
  const loader = new GLTFLoader()
  let destroyed = false
  const opened = new Map<string, boolean>()
  const Y = new THREE.Vector3(0, 1, 0)
  const X = new THREE.Vector3(1, 0, 0)
  const Z = new THREE.Vector3(0, 0, 1)
  const turn = (s: State, axis: THREE.Vector3, a: number) =>
    s.obj.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis, a))

  let drag: { id: string; x: number; y: number; t: number; moved: number } | null = null
  const onDown = (e: PointerEvent) => {
    const slot = (e.target as Element).closest<HTMLElement>("[data-medal-id]")
    const state = slot && states.get(slot.dataset.medalId!)
    if (!slot || !state) return
    slot.setPointerCapture(e.pointerId)
    drag = { id: slot.dataset.medalId!, x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }
    state.dragging = true
    state.vel.set(0, 0)
  }
  const onMove = (e: PointerEvent) => {
    const state = drag && states.get(drag.id)
    if (!drag || !state) return
    const now = performance.now()
    const dx = (e.clientX - drag.x) * DRAG
    const dy = (e.clientY - drag.y) * DRAG
    drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y)
    turn(state, Y, dx)
    turn(state, X, dy)
    const dt = Math.max((now - drag.t) / 1000, 0.008)
    state.vel.set(dx / dt, dy / dt)
    drag = { ...drag, x: e.clientX, y: e.clientY, t: now }
  }
  const onUp = () => {
    const state = drag && states.get(drag.id)
    if (drag && state) {
      if (drag.moved < TAP_PX) {
        if (opened.get(drag.id)) state.vel.set(FLICK, 0)
        else {
          state.wiggle = 0.6
          onLockedTap(drag.id)
        }
      }
      state.dragging = false
    }
    drag = null
  }
  wall.addEventListener("pointerdown", onDown)
  wall.addEventListener("pointermove", onMove)
  wall.addEventListener("pointerup", onUp)
  wall.addEventListener("pointercancel", onUp)

  const target = new THREE.Quaternion()
  const euler = new THREE.Euler()
  let prev = performance.now()
  renderer.setAnimationLoop((t) => {
    const dt = Math.min((t - prev) / 1000, 0.05)
    prev = t
    const w = card.clientWidth
    const h = card.clientHeight
    const ratio = renderer.getPixelRatio()
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) renderer.setSize(w, h, false)
    renderer.setScissorTest(false)
    renderer.setClearColor(0x000000, 0)
    renderer.clear()
    renderer.setScissorTest(true)
    const box = canvas.getBoundingClientRect()
    for (const slot of wall.querySelectorAll<HTMLElement>("[data-medal-id]")) {
      const state = states.get(slot.dataset.medalId!)
      if (!state) continue
      if (!state.dragging) {
        // 甩出去的轉速慢慢減；慢下來之後跟著「平常輕輕左右擺」的姿勢走（減少動態效果時停在正面）
        state.vel.multiplyScalar(Math.exp(-dt * 1.6))
        turn(state, Y, state.vel.x * dt)
        turn(state, X, state.vel.y * dt)
        const calm = Math.max(0, 1 - state.vel.length() / 3)
        if (calm > 0) {
          const sway = still ? 0 : 1
          target.setFromEuler(euler.set(0.045 * sway * Math.sin(t / 1700 + state.phase), 0.14 * sway * Math.sin(t / 1600 + state.phase), 0))
          state.obj.quaternion.slerp(target, Math.min(dt * 2.4 * calm, 1))
        }
        if (state.wiggle > 0) {
          state.wiggle -= dt
          turn(state, Z, Math.sin(state.wiggle * 40) * 0.05)
        }
      }
      const r = slot.getBoundingClientRect()
      if (r.bottom < 0 || r.top > window.innerHeight) continue
      if (r.bottom < box.top || r.top > box.bottom) continue
      const left = r.left - box.left
      const bottom = box.bottom - r.bottom
      state.obj.visible = true
      renderer.setViewport(left, bottom, r.width, r.height)
      renderer.setScissor(left, bottom, r.width, r.height)
      renderer.render(scene, camera)
      state.obj.visible = false
    }
  })

  return {
    sync(medals) {
      medals.forEach((m, index) => {
        const key = `${m.open}:${m.back.join("|")}`
        const old = states.get(m.id)
        opened.set(m.id, m.open)
        if (old?.key === key) return
        const obj = buildMedal(m)
        scene.add(obj)
        if (old) {
          obj.quaternion.copy(old.obj.quaternion)
          scene.remove(old.obj)
          dispose(old.obj)
        }
        const vel = new THREE.Vector2(m.fresh && !still ? FRESH_SPIN : 0, 0)
        states.set(m.id, { obj, key, vel, phase: index * 1.3, dragging: false, wiggle: 0 })
        if (m.open) {
          const tier = ["bronze", "silver", "gold"][m.tier - 1]
          void loader.loadAsync(`/medal-designs/ios-B-soft-${m.kind}-${tier}.glb`).then(({ scene: asset }) => {
            const current = states.get(m.id)
            if (destroyed || !current || current.key !== key) { dispose(asset); return }
            const back = new THREE.Mesh(new THREE.CircleGeometry(.705, 64), new THREE.MeshStandardMaterial({ map: faceTexture(m, true), metalness: .08, roughness: .7 }))
            back.position.z = -.152
            back.rotation.y = Math.PI
            asset.add(back)
            asset.quaternion.copy(current.obj.quaternion)
            asset.visible = false
            scene.remove(current.obj); dispose(current.obj)
            current.obj = asset
            scene.add(asset)
          }).catch(() => { /* Offline or missing asset: keep the procedural 3D medal. */ })
        }
      })
    },
    destroy() {
      destroyed = true
      canvas.removeEventListener("webglcontextlost", lost)
      renderer.setAnimationLoop(null)
      wall.removeEventListener("pointerdown", onDown)
      wall.removeEventListener("pointermove", onMove)
      wall.removeEventListener("pointerup", onUp)
      wall.removeEventListener("pointercancel", onUp)
      for (const state of states.values()) dispose(state.obj)
      pmrem.dispose()
      renderer.dispose()
      // 馬上把 WebGL 還給瀏覽器：來回進出個人頁時不會一直佔著，等到上限才被收回最舊的
      renderer.forceContextLoss()
    },
  }
}
