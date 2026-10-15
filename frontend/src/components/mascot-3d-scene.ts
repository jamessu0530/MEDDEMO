import * as THREE from "three"
import { SVGLoader, type StrokeStyle } from "three/examples/jsm/loaders/SVGLoader.js"

import { mascotPalette } from "@/lib/mascot-collection"

export type MascotMotion = "idle" | "spin" | "roll" | "sleep" | "stretch"
export type MascotSceneState = { svg: SVGSVGElement; color: string; motion: MascotMotion; motionId: number; split: boolean; foundColor: string | null; taps: number }
export type MascotScene = { sync(state: MascotSceneState): void; destroy(): void }

function release(group: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      geometries.add(object.geometry)
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material)
    }
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
}

/** 同一份 SVG 輪廓、表情和服裝轉成有厚度與圓角的模型；沒有另外畫一隻長手的熊。 */
function figure(svg: string, color: string) {
  const palette = mascotPalette(color)
  const art = new THREE.Group()
  art.scale.setScalar(.01)
  art.position.set(-1.2, 2.15, -.35)
  const paths = new SVGLoader().parse(svg).paths
  paths.forEach((path, index) => {
    const node = path.userData?.node as SVGElement
    if (node.closest(".mascot-shadow")) return
    const body = node.parentElement?.classList.contains("mascot-body") ?? false
    const ear = node.closest(".mascot-ear-l, .mascot-ear-r")
    const cape = node.hasAttribute("data-cape")
    const costume = node.closest("[data-costume]")
    const rawFill = node.getAttribute("fill")
    const swatch = rawFill && rawFill !== "none" ? rawFill : node.getAttribute("stroke")
    const tint = swatch === palette.base ? "base" : swatch === palette.light ? "light" : swatch === palette.ink ? "ink" : null
    const front = cape ? -5 : body ? 0 : ear ? (tint === "light" ? 62 : 5) : 77 + index * .12
    const depth = body ? 68 : ear && tint === "base" ? 54 : costume ? 9 : 3
    const fill = SVGLoader.createFillMaterial(path)
    const stroke = SVGLoader.createStrokeMaterial(path)
    function add(geometry: THREE.BufferGeometry, source: THREE.MeshBasicMaterial, offset = 0) {
      // SVG 的 y 往下；翻成 3D 座標時也反轉三角形順序，讓正面法線與光照一致。
      geometry.scale(1, -1, 1)
      const indices = geometry.getIndex()
      if (indices) {
        for (let index = 0; index < indices.count; index += 3) {
          const second = indices.getX(index + 1)
          indices.setX(index + 1, indices.getX(index + 2)); indices.setX(index + 2, second)
        }
      } else {
        const reversed = []
        for (let index = 0; index < geometry.getAttribute("position").count; index += 3) reversed.push(index, index + 2, index + 1)
        geometry.setIndex(reversed)
      }
      const material = new THREE.MeshStandardMaterial({ color: source.color, roughness: .72, metalness: 0, side: THREE.DoubleSide, transparent: source.opacity < 1, opacity: source.opacity })
      const mesh = new THREE.Mesh(geometry, material)
      mesh.position.z = front + offset
      mesh.userData.tint = tint
      mesh.castShadow = true
      mesh.receiveShadow = true
      art.add(mesh)
    }
    if (fill) {
      for (const shape of path.toShapes()) add(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: body ? 5 : ear ? 2.5 : 1.1, bevelThickness: body ? 5 : 1.2, curveSegments: 20 }), fill)
      fill.dispose()
    }
    if (stroke) {
      for (const curve of path.subPaths) {
        const geometry = SVGLoader.pointsToStroke(curve.getPoints(40), path.userData?.style as StrokeStyle, 8)
        if (geometry) add(geometry, stroke, depth + 2)
      }
      stroke.dispose()
    }
  })
  const pivot = new THREE.Group()
  pivot.position.y = .95
  art.position.y -= .95
  pivot.add(art)
  const root = new THREE.Group()
  root.add(pivot)
  return root
}

function twin(source: THREE.Group) {
  const group = source.clone(true)
  group.traverse((object) => { if (object instanceof THREE.Mesh) object.material = (object.material as THREE.MeshStandardMaterial).clone() })
  return group
}

function recolor(group: THREE.Group, color: string) {
  const palette = mascotPalette(color)
  group.traverse((object) => {
    if (object instanceof THREE.Mesh && object.userData.tint) (object.material as THREE.MeshStandardMaterial).color.set(palette[object.userData.tint as "base" | "light" | "ink"])
  })
}

/** WebGL 不可用時丟例外，React 端保留 SVG 版本。只在衣櫃切到立體模式時載入。 */
export function createMascotScene({ canvas, host, onDragEnd, onContextLost }: { canvas: HTMLCanvasElement; host: HTMLElement; onDragEnd: (dragged: boolean) => void; onContextLost: () => void }): MascotScene {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  const scene = new THREE.Scene()
  const camera = new THREE.OrthographicCamera(-1.65, 1.65, 1.65, -1.65, .1, 30)
  camera.position.set(.15, 2.5, 7)
  camera.lookAt(0, 1.05, 0)
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb7a0d2, 2.1))
  const light = new THREE.DirectionalLight(0xffffff, 2.7)
  light.position.set(-3, 5, 6); light.castShadow = true
  light.shadow.mapSize.set(1024, 1024)
  light.shadow.camera.left = light.shadow.camera.bottom = -3
  light.shadow.camera.right = light.shadow.camera.top = 3
  light.shadow.bias = -.002
  scene.add(light)
  const stage = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.18, .07, 64), new THREE.MeshStandardMaterial({ color: 0xeee7f5, roughness: .95 }))
  stage.position.y = -.07; stage.receiveShadow = true; scene.add(stage)
  const models = new THREE.Group(); scene.add(models)
  const sparks = new THREE.Group(); scene.add(sparks)
  const sparkGeometry = new THREE.SphereGeometry(.035, 8, 8)
  for (let index = 0; index < 16; index++) sparks.add(new THREE.Mesh(sparkGeometry, new THREE.MeshBasicMaterial({ color: index % 3 ? 0xd3aff4 : 0xffd366, transparent: true })))
  sparks.visible = false
  let current: MascotSceneState | null = null
  let xml = "", source: THREE.Group | null = null, left: THREE.Group | null = null, right: THREE.Group | null = null
  let motionStart = performance.now(), burstStart = 0, yaw = .12, pitch = 0, visible = true, dirty = true
  let dragging: { x: number; y: number; startX: number; startY: number; moved: boolean } | null = null
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
  function resize() {
    const width = host.clientWidth, height = host.clientHeight
    renderer.setSize(width, height, false)
    const halfWidth = Math.max(1.45, (width / Math.max(height, 1)) * 1.65)
    camera.left = -halfWidth; camera.right = halfWidth; camera.updateProjectionMatrix(); dirty = true
  }
  const observer = new ResizeObserver(resize); observer.observe(host)
  const visibility = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; dirty = true }); visibility.observe(host)
  function down(event: PointerEvent) { dragging = { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false }; canvas.setPointerCapture(event.pointerId) }
  function move(event: PointerEvent) {
    if (!dragging) return
    const dx = event.clientX - dragging.x, dy = event.clientY - dragging.y
    if (Math.abs(event.clientX - dragging.startX) + Math.abs(event.clientY - dragging.startY) > 6) dragging.moved = true
    yaw += dx * .012; pitch = THREE.MathUtils.clamp(pitch + dy * .005, -.35, .35)
    dragging.x = event.clientX; dragging.y = event.clientY; dirty = true
  }
  function up() { if (dragging) onDragEnd(dragging.moved); dragging = null }
  function lost(event: Event) { event.preventDefault(); renderer.setAnimationLoop(null); onContextLost() }
  canvas.addEventListener("pointerdown", down); canvas.addEventListener("pointermove", move)
  canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up); canvas.addEventListener("webglcontextlost", lost)
  resize()
  renderer.setAnimationLoop(() => {
    if (!current || !source || !visible || document.hidden || (reduced.matches && !dirty)) return
    const time = performance.now(), elapsed = (time - motionStart) / 1000
    const t = reduced.matches ? 0 : elapsed
    source.visible = !current.split || (!reduced.matches && time - burstStart < 260)
    source.position.set(0, 0, 0); source.scale.set(1, 1, 1)
    source.rotation.set(pitch, yaw, Math.sin(t * 1.8) * .022)
    source.children[0].rotation.z = 0
    if (!current.split) {
      if (current.motion === "idle") source.scale.y = 1 + Math.sin(t * 2) * .018
      if (current.motion === "spin") source.rotation.y += Math.PI * 2 * THREE.MathUtils.smoothstep(t, 0, 1.8)
      if (current.motion === "roll" && t < 2.4) {
        const progress = THREE.MathUtils.smoothstep(t, .25, 2.1)
        source.children[0].rotation.z = -Math.PI * 2 * progress
        const squash = Math.sin(progress * Math.PI)
        source.scale.setScalar(1 - squash * .22); source.position.y = squash * .2
      }
      if (current.motion === "sleep") { source.scale.set(1.05, .82 + Math.sin(t * 1.6) * .014, 1); source.rotation.z = -.10 }
      if (current.motion === "stretch") { const stretch = Math.pow(Math.max(0, Math.sin(t * 1.3)), 2); source.scale.set(1 - stretch * .09, 1 + stretch * .13, 1) }
      if (current.taps >= 4 && !reduced.matches) source.rotation.z += Math.sin(t * (current.taps === 5 ? 85 : 48)) * .055
      if (left) left.visible = false; if (right) right.visible = false; sparks.visible = false
    } else if (left && right) {
      const age = reduced.matches ? 2 : (time - burstStart) / 1000
      const progress = THREE.MathUtils.smoothstep(age, .2, .8)
      source.scale.setScalar(1 + age * .9)
      for (const [model, direction] of [[left, -1], [right, 1]] as const) {
        model.visible = age > .2
        model.scale.setScalar(.56 * progress)
        model.position.set(direction * .70 * progress, Math.sin(Math.min(1, Math.max(0, (age - .2) / .65)) * Math.PI) * .52, 0)
        model.rotation.set(pitch, yaw + direction * .11, direction * Math.sin(age * 2) * .035)
      }
      sparks.visible = age < .9 && age > .18
      sparks.children.forEach((object, index) => {
        const angle = index / 16 * Math.PI * 2, distance = Math.max(0, age - .18) * 2.4
        object.position.set(Math.cos(angle) * distance, 1.05 + Math.sin(angle) * distance, .6)
        const material = (object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>).material
        material.opacity = Math.max(0, 1 - age / .9)
      })
    }
    renderer.render(scene, camera); dirty = false
  })
  return {
    sync(next) {
      const serialized = new XMLSerializer().serializeToString(next.svg)
      if (serialized !== xml) {
        release(models); models.clear()
        source = figure(serialized, next.color); left = twin(source); right = twin(source)
        left.visible = right.visible = false; models.add(source, left, right); xml = serialized
      }
      if (next.motionId !== current?.motionId || next.motion !== current?.motion) motionStart = performance.now()
      if (next.split && !current?.split) burstStart = performance.now()
      if (right) recolor(right, next.foundColor ?? next.color)
      current = next; dirty = true
    },
    destroy() {
      renderer.setAnimationLoop(null); observer.disconnect(); visibility.disconnect()
      canvas.removeEventListener("pointerdown", down); canvas.removeEventListener("pointermove", move)
      canvas.removeEventListener("pointerup", up); canvas.removeEventListener("pointercancel", up); canvas.removeEventListener("webglcontextlost", lost)
      release(scene); renderer.dispose(); renderer.forceContextLoss()
    },
  }
}
