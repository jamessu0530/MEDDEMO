import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import {
  createMapMascot,
  type MapMascot,
} from "@/components/ask/memory-map-mascot"

import { MAP_COLOR, type MapNode, type MemoryMap } from "@/ask/memory-map"
import type { MapPositions } from "@/ask/memory-map-layout"
import { createMemoryMapLayoutRunner } from "@/ask/memory-map-layout-runner"

export type MemoryMapScene = {
  sync: (graph: MemoryMap, selected: string | null) => void
  zoom: (factor: number) => void
  reset: () => void
  focus: (id: string) => void
  dispose: () => void
}

/** Loaded only after opening the map. Labels remain actual keyboard-accessible buttons. */
export function createMemoryMapScene(
  host: HTMLDivElement,
  onSelect: (id: string) => void,
  onFailure: () => void,
  onReady: () => void
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
      labelWidth: number
      mascot?: MapMascot
    }
  >()
  let ordered = [...objects.entries()]
  const geometries = new Map<number, THREE.SphereGeometry>()
  const sparkGeometry = new THREE.SphereGeometry(0.045, 8, 6)
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
  let labelsDirty = true
  let sceneDirty = true
  let lastRender = -Infinity
  let interacting = false
  let pendingFocus: string | null = null
  let width = 1
  let height = 1
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
  const point = new THREE.Vector3()
  const boundsPoint = new THREE.Vector3()
  const raycaster = new THREE.Raycaster()
  let press = { x: 0, y: 0 }
  let moved = false

  const layoutRunner = createMemoryMapLayoutRunner((positions) => {
    if (disposed) return
    try {
      const focusAfter = pendingFocus
      pendingFocus = null
      rebuild(positions)
      host.setAttribute("aria-busy", "false")
      reset()
      if (focusAfter) focus(focusAfter)
      invalidate()
      onReady()
    } catch {
      onFailure()
    }
  })

  function freeGraph() {
    for (const obj of objects.values()) {
      obj.mascot?.dispose()
      obj.mesh.material.dispose()
      obj.button.remove()
    }
    for (const path of paths) {
      path.line.geometry.dispose()
      path.line.material.dispose()
      path.spark.material.dispose()
    }
    group.clear()
    objects.clear()
    paths.length = 0
  }
  function rebuild(positions: MapPositions) {
    freeGraph()
    const labels = document.createDocumentFragment()
    for (const node of graph.nodes) {
      const radius =
        node.kind === "root"
          ? 0.46
          : node.kind === "topic"
            ? 0.2
            : node.kind === "question"
              ? 0.24
              : 0.16
      let geometry = geometries.get(radius)
      if (!geometry) {
        geometry = new THREE.SphereGeometry(radius, 24, 16)
        geometries.set(radius, geometry)
      }
      const mesh = new THREE.Mesh(
        geometry,
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
      const position = positions.get(node.id)!
      mesh.position.set(position.x, position.y, position.z)
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
      labels.appendChild(button)
      let mascot: MapMascot | undefined
      if (node.kind === "root") {
        // The proxy stays raycastable; the visible bear is ordinary 3D geometry in the same group as the graph.
        mesh.material.visible = false
        mascot = createMapMascot(node.id)
        mascot.setThinking(Boolean(graph.activeId))
        mesh.add(mascot.group)
      }
      objects.set(node.id, {
        mesh,
        button,
        node,
        mascot,
        labelWidth: 0,
      })
    }
    host.appendChild(labels)
    for (const object of objects.values())
      object.labelWidth = object.button.getBoundingClientRect().width
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
        sparkGeometry,
        new THREE.MeshBasicMaterial({ color: "#007aff" })
      )
      group.add(line, spark)
      paths.push({ ...edge, line, curve, spark })
    })
    refreshSelection()
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
    controls.maxDistance = Math.max(65, distance * 1.5)
    camera.far = Math.max(150, distance * 3)
    camera.updateProjectionMatrix()
    camera.position.set(center.x, center.y + 1, center.z + distance)
    controls.target.copy(center)
    controls.update()
    invalidate()
  }
  function resize() {
    const oldAspect = camera.aspect
    width = Math.max(1, host.clientWidth)
    height = Math.max(1, host.clientHeight)
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    const labels = [...objects.values()].map((object) => ({
      object,
      hidden: object.button.hidden,
    }))
    for (const { object } of labels) object.button.hidden = false
    for (const { object } of labels)
      object.labelWidth = object.button.getBoundingClientRect().width
    for (const { object, hidden } of labels) object.button.hidden = hidden
    if (Math.abs(oldAspect - camera.aspect) > 0.25) reset()
    invalidate()
  }
  const observer = new ResizeObserver(resize)
  observer.observe(host)
  resize()
  reset()

  function refreshSelection() {
    const connected = new Set([selected])
    for (const edge of graph.links) {
      if (edge.source === selected) connected.add(edge.target)
      if (edge.target === selected) connected.add(edge.source)
    }
    const priority = (id: string) =>
      objects.get(id)?.node.kind === "root"
        ? 3
        : id === selected
          ? 2
          : id === graph.activeId
            ? 1
            : 0
    ordered = [...objects.entries()].sort(
      ([a], [b]) => priority(b) - priority(a)
    )
    for (const [id, object] of ordered) {
      const active = id === graph.activeId
      const related = !selected || connected.has(id)
      object.mesh.material.opacity = related || active ? 1 : 0.72
      object.mesh.material.emissiveIntensity =
        id === selected || active ? 0.18 : 0.06
      object.button.style.opacity =
        related || active || object.mascot ? "1" : ".85"
      object.button.classList.toggle("is-selected", id === selected)
      object.button.classList.toggle("is-active", active)
      object.button.setAttribute("aria-pressed", String(id === selected))
      object.mascot?.setThinking(Boolean(graph.activeId))
    }
    for (const path of paths) {
      const relevant = path.source === selected || path.target === selected
      const active =
        path.source === graph.activeId || path.target === graph.activeId
      path.line.material.opacity = relevant || active ? 0.85 : 0.42
      path.line.material.color.set(active || relevant ? "#007aff" : linkColor)
      path.spark.visible = active && !motion.matches
    }
    invalidate()
  }
  function updateLabels() {
    scene.updateMatrixWorld(true)
    camera.updateMatrixWorld(true)
    const occupied: {
      x: number
      y: number
      width: number
      height: number
    }[] = []
    for (const [, object] of ordered) {
      object.mesh.getWorldPosition(point)
      point.project(camera)
      const visible =
        point.z > -1 &&
        point.z < 1 &&
        Math.abs(point.x) < 1.05 &&
        Math.abs(point.y) < 1.05
      if (!visible) {
        object.button.hidden = true
        continue
      }
      const labelWidth = object.labelWidth + 6
      const labelHeight = 32
      const x = (point.x * 0.5 + 0.5) * width
      let y = (-point.y * 0.5 + 0.5) * height + 15
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
        y = bottom + 16
      }
      // Keep captions close to their node. Crowded captions become available
      // when rotating/zooming, rather than stacking far away from their point.
      const candidates = object.mascot
        ? [[x, y]]
        : [
            [x, y],
            [x, y - labelHeight - 28],
            [x - labelWidth / 2 - 16, y - 28],
            [x + labelWidth / 2 + 16, y - 28],
            [x, y + labelHeight + 8],
            [x, y - labelHeight * 2 - 36],
          ]
      const placement = candidates.find(
        ([cx, cy]) =>
          cx - labelWidth / 2 >= 6 &&
          cx + labelWidth / 2 <= width - 6 &&
          cy >= 6 &&
          cy + labelHeight <= height - 6 &&
          !occupied.some(
            (other) =>
              Math.abs(cx - other.x) < (other.width + labelWidth) / 2 + 6 &&
              cy + labelHeight + 6 > other.y &&
              cy < other.y + other.height + 6
          )
      )
      object.button.hidden = !placement
      if (!placement) continue
      const [labelX, labelY] = placement
      occupied.push({
        x: labelX,
        y: labelY,
        width: labelWidth,
        height: labelHeight,
      })
      object.button.style.left = `${labelX}px`
      object.button.style.top = `${labelY}px`
    }
  }
  function schedule() {
    if (!disposed && !document.hidden && !frame)
      frame = requestAnimationFrame(draw)
  }
  function invalidate() {
    labelsDirty = sceneDirty = true
    schedule()
  }
  function visibilityChanged() {
    if (document.hidden) {
      cancelAnimationFrame(frame)
      frame = 0
    } else {
      lastRender = -Infinity
      invalidate()
    }
  }
  function motionChanged() {
    refreshSelection()
  }
  function interactionStarted() {
    interacting = true
    lastRender = -Infinity
    invalidate()
  }
  function interactionEnded() {
    interacting = false
  }
  function draw(time: number) {
    frame = 0
    if (disposed || document.hidden) return
    schedule()
    if (time - lastRender < 1000 / (interacting ? 60 : 30)) return
    lastRender = time
    controls.enableDamping = !motion.matches
    const cameraChanged = controls.update()
    let animated = false
    if (!motion.matches || sceneDirty) {
      for (const [id, object] of ordered) {
        if (object.mascot?.animate(time / 1000, motion.matches)) animated = true
        const scale =
          id === graph.activeId && !motion.matches
            ? 1 + Math.sin(time * 0.003) * 0.12
            : 1
        if (object.mesh.scale.x !== scale) {
          object.mesh.scale.setScalar(scale)
          animated = true
        }
      }
      paths.forEach((path, index) => {
        if (path.spark.visible) {
          animated = true
          path.spark.position.copy(
            path.curve.getPoint((time * 0.00015 + index * 0.13) % 1)
          )
        }
      })
    }
    if (labelsDirty || cameraChanged) {
      updateLabels()
      labelsDirty = false
    }
    const focus = objects.get(selected ?? "")
    halo.visible = !!focus && focus.node.kind !== "root"
    if (focus) {
      focus.mesh.getWorldPosition(halo.position)
      halo.quaternion.copy(camera.quaternion)
    }
    if (animated || sceneDirty || cameraChanged) renderer.render(scene, camera)
    sceneDirty = false
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
    if (hit) {
      let object: THREE.Object3D | null = hit.object
      while (object && !object.userData.id) object = object.parent
      if (object?.userData.id) onSelect(object.userData.id as string)
    }
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
      invalidate()
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
  controls.addEventListener("change", invalidate)
  controls.addEventListener("start", interactionStarted)
  controls.addEventListener("end", interactionEnded)
  document.addEventListener("visibilitychange", visibilityChanged)
  motion.addEventListener("change", motionChanged)
  schedule()

  function focus(id: string) {
    if (host.getAttribute("aria-busy") === "true") {
      pendingFocus = id
      return
    }
    const object = objects.get(id)
    if (!object) return
    object.mesh.getWorldPosition(point)
    camera.position.add(point.clone().sub(controls.target))
    controls.target.copy(point)
    controls.update()
    invalidate()
  }

  return {
    sync(next, selection) {
      graph = next
      selected = selection
      const key = JSON.stringify([
        next.nodes.map((node) => [node.id, node.kind]),
        next.links.map((link) => [link.source, link.target]),
      ])
      if (key !== topology) {
        topology = key
        host.setAttribute("aria-busy", "true")
        layoutRunner.update(next)
      } else {
        // Renaming, notes and progress updates do not rebuild geometry or rerun physics.
        const changed = []
        for (const node of next.nodes) {
          const object = objects.get(node.id)
          if (!object) continue
          if (object.node.label !== node.label) {
            object.button.textContent =
              node.label.length > 16
                ? `${node.label.slice(0, 16)}…`
                : node.label
            object.button.setAttribute("aria-label", `查看${node.label}`)
            object.button.title = node.label
            object.button.hidden = false
            changed.push(object)
          }
          object.node = node
        }
        for (const object of changed)
          object.labelWidth = object.button.getBoundingClientRect().width
      }
      refreshSelection()
    },
    zoom,
    reset,
    focus,
    dispose() {
      if (disposed) return
      disposed = true
      cancelAnimationFrame(frame)
      layoutRunner.dispose()
      host.removeAttribute("aria-busy")
      controls.removeEventListener("change", invalidate)
      controls.removeEventListener("start", interactionStarted)
      controls.removeEventListener("end", interactionEnded)
      document.removeEventListener("visibilitychange", visibilityChanged)
      motion.removeEventListener("change", motionChanged)
      observer.disconnect()
      controls.dispose()
      host.removeEventListener("keydown", key)
      renderer.domElement.removeEventListener("pointerdown", down)
      renderer.domElement.removeEventListener("pointermove", move)
      renderer.domElement.removeEventListener("pointerup", up)
      renderer.domElement.removeEventListener("webglcontextlost", lost)
      freeGraph()
      for (const geometry of geometries.values()) geometry.dispose()
      sparkGeometry.dispose()
      halo.geometry.dispose()
      halo.material.dispose()
      renderer.dispose()
      if (!renderer.getContext().isContextLost()) renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
