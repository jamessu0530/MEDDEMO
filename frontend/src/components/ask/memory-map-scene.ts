import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import {
  createMapMascot,
  type MapMascot,
} from "@/components/ask/memory-map-mascot"

import { MAP_COLOR, type MapNode, type MemoryMap } from "@/ask/memory-map"

export type MemoryMapScene = {
  sync: (graph: MemoryMap, selected: string | null) => void
  zoom: (factor: number) => void
  reset: () => void
  dispose: () => void
}

function hash(text: string) {
  let value = 2166136261
  for (const char of text)
    value = Math.imul(value ^ char.charCodeAt(0), 16777619)
  return value >>> 0
}

function position(node: MapNode, graph: MemoryMap) {
  if (node.kind === "root") return new THREE.Vector3()
  const centers: Record<string, [number, number, number]> = {
    "topic:data": [-5.6, 2.2, 0],
    "topic:knowledge": [4.6, 3.5, -1],
    "topic:memory": [1, -5, 1.5],
  }
  if (node.kind === "topic") return new THREE.Vector3(...centers[node.id])
  const seed = hash(node.id)
  const angle = ((seed % 10000) / 10000) * Math.PI * 2
  const depth = (((seed >>> 12) % 100) / 100) * 5 - 2.5
  if (node.kind === "question") {
    const topic = graph.links.find(
      (edge) => edge.target === node.id && edge.source.startsWith("topic:")
    )?.source
    const center = centers[topic ?? ""] ?? [0, 0, 0]
    return new THREE.Vector3(
      center[0] + Math.cos(angle) * 2.6,
      center[1] + Math.sin(angle) * 2.6,
      depth
    )
  }
  const radius = 8.8 + (seed % 31) / 15
  return new THREE.Vector3(
    Math.cos(angle) * radius,
    Math.sin(angle) * radius * 0.75,
    depth * 1.5
  )
}

/** Loaded only after opening the map. Labels remain actual keyboard-accessible buttons. */
export function createMemoryMapScene(
  host: HTMLDivElement,
  onSelect: (id: string) => void,
  onFailure: () => void
): MemoryMapScene {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: "low-power",
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.domElement.setAttribute("aria-hidden", "true")
  host.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  const linkColor =
    getComputedStyle(host).getPropertyValue("--map-link").trim() || "#a4acb8"
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 150)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enablePan = false
  controls.enableDamping = true
  controls.dampingFactor = 0.1
  controls.minDistance = 7
  controls.maxDistance = 65
  controls.minPolarAngle = 0.2
  controls.maxPolarAngle = Math.PI - 0.2
  controls.rotateSpeed = 0.6
  scene.add(new THREE.AmbientLight(0xffffff, 2))
  const light = new THREE.DirectionalLight(0xffffff, 3)
  light.position.set(3, 5, 8)
  scene.add(light)
  const group = new THREE.Group()
  scene.add(group)
  const objects = new Map<
    string,
    {
      mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshPhysicalMaterial>
      button: HTMLButtonElement
      node: MapNode
      mascot?: MapMascot
    }
  >()
  const paths: {
    source: string
    target: string
    line: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>
    curve: THREE.QuadraticBezierCurve3
    spark: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>
  }[] = []
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(0.45, 0.018, 6, 64),
    new THREE.MeshBasicMaterial({
      color: "#007aff",
      transparent: true,
      opacity: 0.9,
    })
  )
  scene.add(halo)
  let graph: MemoryMap = {
    nodes: [],
    links: [],
    latestId: null,
    activeId: null,
    total: 0,
    shown: 0,
  }
  let selected: string | null = null
  let topology = ""
  let frame = 0
  let disposed = false
  let width = 1
  let height = 1
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
  const point = new THREE.Vector3()
  const boundsPoint = new THREE.Vector3()
  const raycaster = new THREE.Raycaster()
  let press = { x: 0, y: 0 }
  let moved = false

  function freeGraph() {
    for (const obj of objects.values()) {
      obj.mascot?.dispose()
      obj.mesh.geometry.dispose()
      obj.mesh.material.dispose()
      obj.button.remove()
    }
    for (const path of paths) {
      path.line.geometry.dispose()
      path.line.material.dispose()
      path.spark.geometry.dispose()
      path.spark.material.dispose()
    }
    group.clear()
    objects.clear()
    paths.length = 0
  }
  function rebuild() {
    freeGraph()
    for (const node of graph.nodes) {
      const radius =
        node.kind === "root"
          ? 0.46
          : node.kind === "topic"
            ? 0.2
            : node.kind === "question"
              ? 0.24
              : 0.16
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 24, 16),
        new THREE.MeshPhysicalMaterial({
          color: MAP_COLOR[node.kind],
          emissive: MAP_COLOR[node.kind],
          emissiveIntensity: 0.08,
          roughness: 0.22,
          metalness: 0.15,
          clearcoat: 1,
          clearcoatRoughness: 0.12,
          transparent: true,
        })
      )
      mesh.position.copy(position(node, graph))
      mesh.userData.id = node.id
      group.add(mesh)
      const button = document.createElement("button")
      button.type = "button"
      button.className = "memory-map-label"
      button.style.setProperty("--node-color", MAP_COLOR[node.kind])
      button.textContent =
        node.label.length > 16 ? `${node.label.slice(0, 16)}…` : node.label
      button.setAttribute("aria-label", `查看${node.label}`)
      button.title = node.label
      button.addEventListener("click", () => onSelect(node.id))
      host.appendChild(button)
      let mascot: MapMascot | undefined
      if (node.kind === "root") {
        // The proxy stays raycastable; the visible bear is ordinary 3D geometry in the same group as the graph.
        mesh.material.visible = false
        mascot = createMapMascot(node.id)
        mascot.setThinking(Boolean(graph.activeId))
        mesh.add(mascot.group)
      }
      objects.set(node.id, { mesh, button, node, mascot })
    }
    graph.links.forEach((edge, index) => {
      const a = objects.get(edge.source)?.mesh.position
      const b = objects.get(edge.target)?.mesh.position
      if (!a || !b) return
      const middle = a.clone().lerp(b, 0.5)
      middle.z += 0.65 + (index % 3) * 0.25
      const curve = new THREE.QuadraticBezierCurve3(
        a.clone(),
        middle,
        b.clone()
      )
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(curve.getPoints(32)),
        new THREE.LineBasicMaterial({
          color: linkColor,
          transparent: true,
          opacity: 0.28,
          depthWrite: false,
        })
      )
      const spark = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 8, 6),
        new THREE.MeshBasicMaterial({ color: "#007aff" })
      )
      group.add(line, spark)
      paths.push({ ...edge, line, curve, spark })
    })
  }
  function reset() {
    group.rotation.set(0, 0, 0)
    const bounds = new THREE.Box3()
    for (const object of objects.values())
      bounds.expandByPoint(object.mesh.position)
    const center = bounds.isEmpty()
      ? new THREE.Vector3()
      : bounds.getCenter(new THREE.Vector3())
    const size = bounds.isEmpty()
      ? new THREE.Vector3(18, 14, 5)
      : bounds.getSize(new THREE.Vector3()).addScalar(3)
    const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
    const distance =
      Math.max(
        16,
        size.y / (2 * tangent * 0.72),
        size.x / (2 * tangent * camera.aspect * 0.78)
      ) +
      size.z / 2
    camera.position.set(
      center.x,
      center.y + 1,
      center.z + Math.min(60, distance)
    )
    controls.target.copy(center)
    controls.update()
  }
  function resize() {
    const oldAspect = camera.aspect
    width = Math.max(1, host.clientWidth)
    height = Math.max(1, host.clientHeight)
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    if (Math.abs(oldAspect - camera.aspect) > 0.25) reset()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()
  reset()

  function draw(time: number) {
    if (disposed) return
    if (!document.hidden) {
      controls.enableDamping = !motion.matches
      controls.update()
      const connected = new Set([selected])
      for (const edge of graph.links) {
        if (edge.source === selected) connected.add(edge.target)
        if (edge.target === selected) connected.add(edge.source)
      }
      scene.updateMatrixWorld(true)
      camera.updateMatrixWorld(true)
      const occupied: {
        x: number
        y: number
        width: number
        height: number
      }[] = []
      // Place the selected and active labels first, then keep surrounding labels apart.
      const priority = (id: string) =>
        objects.get(id)?.node.kind === "root"
          ? 3
          : id === selected
            ? 2
            : id === graph.activeId
              ? 1
              : 0
      const ordered = [...objects.entries()].sort(
        ([a], [b]) => priority(b) - priority(a)
      )
      for (const [id, object] of ordered) {
        object.mascot?.animate(time / 1000, motion.matches)
        const related = !selected || connected.has(id)
        const active = id === graph.activeId
        const mascot = object.node.kind === "root"
        object.mesh.material.opacity = related || active ? 1 : 0.72
        object.mesh.material.emissiveIntensity =
          id === selected || active ? 0.18 : 0.06
        object.mesh.scale.setScalar(
          active && !motion.matches ? 1 + Math.sin(time * 0.003) * 0.12 : 1
        )
        object.mesh.getWorldPosition(point)
        point.project(camera)
        const visible =
          point.z > -1 &&
          point.z < 1 &&
          Math.abs(point.x) < 1.05 &&
          Math.abs(point.y) < 1.05
        object.button.hidden = !visible
        if (!visible) continue
        const x = Math.max(
          80,
          Math.min(width - 80, (point.x * 0.5 + 0.5) * width)
        )
        let y = Math.max(
          12,
          Math.min(height - 36, (-point.y * 0.5 + 0.5) * height + 15)
        )
        if (object.mascot) {
          const bounds = object.mascot.bounds
          let left = Infinity,
            top = Infinity,
            right = -Infinity,
            bottom = -Infinity
          for (const bx of [bounds.min.x, bounds.max.x])
            for (const by of [bounds.min.y, bounds.max.y])
              for (const bz of [bounds.min.z, bounds.max.z]) {
                boundsPoint.set(bx, by, bz)
                object.mascot.group.localToWorld(boundsPoint)
                boundsPoint.project(camera)
                const sx = (boundsPoint.x * 0.5 + 0.5) * width
                const sy = (-boundsPoint.y * 0.5 + 0.5) * height
                left = Math.min(left, sx)
                right = Math.max(right, sx)
                top = Math.min(top, sy)
                bottom = Math.max(bottom, sy)
              }
          occupied.push({
            x: (left + right) / 2,
            y: top - 4,
            width: right - left + 12,
            height: bottom - top + 8,
          })
          y = bottom + 8
        }
        for (let pass = 0; pass < 8; pass++) {
          const clash = occupied.find(
            (other) =>
              Math.abs(x - other.x) < (other.width + 168) / 2 &&
              y + 30 > other.y &&
              y < other.y + other.height
          )
          if (!clash) break
          y = clash.y + clash.height + 4
        }
        object.button.hidden = y > height - 32
        occupied.push({
          x,
          y,
          width: 168,
          height: 30,
        })
        object.button.style.left = `${x}px`
        object.button.style.top = `${y}px`
        object.button.style.opacity = related || active || mascot ? "1" : ".85"
        object.button.classList.toggle("is-selected", id === selected)
        object.button.classList.toggle("is-active", active)
        object.button.setAttribute("aria-pressed", String(id === selected))
      }
      paths.forEach((path, index) => {
        const relevant = path.source === selected || path.target === selected
        const active =
          path.source === graph.activeId || path.target === graph.activeId
        path.line.material.opacity = relevant || active ? 0.85 : 0.42
        path.line.material.color.set(active || relevant ? "#007aff" : linkColor)
        path.spark.visible = active && !motion.matches
        if (path.spark.visible)
          path.spark.position.copy(
            path.curve.getPoint((time * 0.00015 + index * 0.13) % 1)
          )
      })
      const focus = objects.get(selected ?? "")
      halo.visible = !!focus && focus.node.kind !== "root"
      if (focus) {
        focus.mesh.getWorldPosition(halo.position)
        halo.quaternion.copy(camera.quaternion)
        halo.scale.setScalar(focus.node.kind === "root" ? 1.45 : 1)
      }
      renderer.render(scene, camera)
    }
    frame = requestAnimationFrame(draw)
  }
  function down(event: PointerEvent) {
    press = { x: event.clientX, y: event.clientY }
    moved = false
  }
  function move(event: PointerEvent) {
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 5)
      moved = true
  }
  function up(event: PointerEvent) {
    if (moved || event.button !== 0) return
    const rect = renderer.domElement.getBoundingClientRect()
    raycaster.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / width) * 2 - 1,
        (-(event.clientY - rect.top) / height) * 2 + 1
      ),
      camera
    )
    const hit = raycaster.intersectObjects(
      [...objects.values()].map((object) => object.mesh),
      true
    )[0]
    if (hit) onSelect(hit.object.userData.id as string)
  }
  function zoom(factor: number) {
    camera.position
      .sub(controls.target)
      .multiplyScalar(factor)
      .clampLength(controls.minDistance, controls.maxDistance)
      .add(controls.target)
    controls.update()
  }
  function key(event: KeyboardEvent) {
    if (event.target !== host) return
    const actions: Record<string, () => void> = {
      ArrowLeft: () => {
        group.rotation.y -= 0.12
      },
      ArrowRight: () => {
        group.rotation.y += 0.12
      },
      ArrowUp: () => {
        group.rotation.x -= 0.12
      },
      ArrowDown: () => {
        group.rotation.x += 0.12
      },
      "+": () => zoom(0.85),
      "=": () => zoom(0.85),
      "-": () => zoom(1.15),
      Home: reset,
    }
    if (actions[event.key]) {
      event.preventDefault()
      actions[event.key]()
    }
  }
  function lost(event: Event) {
    event.preventDefault()
    onFailure()
  }
  renderer.domElement.addEventListener("pointerdown", down)
  renderer.domElement.addEventListener("pointermove", move)
  renderer.domElement.addEventListener("pointerup", up)
  renderer.domElement.addEventListener("webglcontextlost", lost)
  host.addEventListener("keydown", key)
  frame = requestAnimationFrame(draw)

  return {
    sync(next, selection) {
      const wasThinking = Boolean(graph.activeId)
      graph = next
      selected = selection
      const key = JSON.stringify([
        next.nodes.map((node) => [node.id, node.label]),
        next.links,
      ])
      if (key !== topology) {
        topology = key
        rebuild()
        reset()
      } else if (wasThinking !== Boolean(graph.activeId)) {
        for (const object of objects.values())
          object.mascot?.setThinking(Boolean(graph.activeId))
      }
    },
    zoom,
    reset,
    dispose() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      controls.dispose()
      host.removeEventListener("keydown", key)
      renderer.domElement.removeEventListener("pointerdown", down)
      renderer.domElement.removeEventListener("pointermove", move)
      renderer.domElement.removeEventListener("pointerup", up)
      renderer.domElement.removeEventListener("webglcontextlost", lost)
      freeGraph()
      halo.geometry.dispose()
      halo.material.dispose()
      renderer.dispose()
      if (!renderer.getContext().isContextLost()) renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
