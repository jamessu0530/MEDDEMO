import * as THREE from "three"
import { createMascotRearMark } from "@/components/mascot-3d-details"
import { mascotEyeOpenness } from "@/lib/mascot-blink"

/** The existing bear silhouette, with a rounded volume and a face attached to its front. */
export function createMapMascot(id: string) {
  const group = new THREE.Group()
  group.name = "熊熊滾"
  const purple = new THREE.MeshPhysicalMaterial({
    color: "#9b51e0",
    roughness: 0.38,
    metalness: 0.02,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
  })
  const light = new THREE.MeshStandardMaterial({
    color: "#eadbfd",
    roughness: 0.65,
  })
  const ink = new THREE.MeshStandardMaterial({
    color: "#2b1b47",
    roughness: 0.48,
  })
  const white = new THREE.MeshBasicMaterial({ color: "#fff" })
  const unit = 0.014
  const x = (value: number) => (value - 120) * unit
  const y = (value: number) => (136 - value) * unit

  // Same continuous head/body and split feet as MascotFigure; bevels round the front and back.
  const shape = new THREE.Shape()
  shape.moveTo(x(56), y(118))
  shape.bezierCurveTo(x(56), y(80), x(84), y(56), x(120), y(56))
  shape.bezierCurveTo(x(156), y(56), x(184), y(80), x(184), y(118))
  shape.lineTo(x(184), y(188))
  shape.bezierCurveTo(x(184), y(204), x(173), y(215), x(159), y(215))
  shape.bezierCurveTo(x(147), y(215), x(139), y(209), x(135), y(200))
  shape.lineTo(x(105), y(200))
  shape.bezierCurveTo(x(101), y(209), x(93), y(215), x(81), y(215))
  shape.bezierCurveTo(x(67), y(215), x(56), y(204), x(56), y(188))
  shape.closePath()
  const bodyGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.72,
    bevelEnabled: true,
    bevelThickness: 0.14,
    bevelSize: 0.12,
    bevelSegments: 5,
    curveSegments: 24,
    steps: 1,
  })
  bodyGeometry.translate(0, 0, -0.36)
  group.add(new THREE.Mesh(bodyGeometry, purple))
  const rearMark = createMascotRearMark("#2b1b47", .098, .0175)
  rearMark.position.set(0, y(188), -.52)
  group.add(rearMark)
  const sphere = new THREE.SphereGeometry(1, 24, 16)
  function ball(
    material: THREE.Material,
    at: [number, number, number],
    scale: [number, number, number]
  ) {
    const mesh = new THREE.Mesh(sphere, material)
    mesh.position.set(...at)
    mesh.scale.set(...scale)
    group.add(mesh)
    return mesh
  }
  for (const side of [-1, 1]) {
    ball(purple, [side * 0.56, y(62), 0], [0.31, 0.31, 0.32])
    ball(light, [side * 0.56, y(62), 0.28], [0.147, 0.147, 0.065])
  }
  const eyes = [-1, 1].map((side) => {
    const eye = ball(ink, [side * 0.406, y(108), 0.49], [0.106, 0.134, 0.045])
    const shine = new THREE.Mesh(sphere, white)
    shine.position.set(0.3, 0.35, 0.95)
    shine.scale.set(0.34, 0.26, 0.22)
    eye.add(shine)
    return eye
  })
  ball(light, [0, y(129), 0.49], [0.336, 0.238, 0.12])
  // Nose and mouth have their own depth, so the face disappears naturally when viewed from behind.
  const nose = new THREE.Shape()
  nose.moveTo(-0.126, y(120))
  nose.quadraticCurveTo(0, y(116), 0.126, y(120))
  nose.quadraticCurveTo(0.147, y(125), 0, y(130))
  nose.quadraticCurveTo(-0.147, y(125), -0.126, y(120))
  const noseGeometry = new THREE.ExtrudeGeometry(nose, {
    depth: 0.025,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.01,
    bevelSegments: 2,
    curveSegments: 16,
  })
  const noseMesh = new THREE.Mesh(noseGeometry, ink)
  noseMesh.position.z = 0.615
  group.add(noseMesh)
  const smile = new THREE.Group()
  const stem = new THREE.LineCurve3(
    new THREE.Vector3(0, y(129), 0.624),
    new THREE.Vector3(0, y(132.5), 0.624)
  )
  smile.add(
    new THREE.Mesh(new THREE.TubeGeometry(stem, 2, 0.018, 8, false), ink)
  )
  for (const side of [-1, 1]) {
    const curve = new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(0, y(133.5), 0.624),
      new THREE.Vector3(side * 0.05, y(140), 0.624),
      new THREE.Vector3(side * 0.098, y(133.5), 0.624)
    )
    smile.add(
      new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.018, 8, false), ink)
    )
  }
  group.add(smile)
  const thinkingMouth = ball(ink, [0.049, y(137), 0.61], [0.047, 0.042, 0.025])
  thinkingMouth.visible = false
  group.traverse((object) => {
    object.userData.id = id
  })
  // Fixed local bounds let the HTML name remain readable without turning the model into a billboard.
  const bounds = new THREE.Box3().setFromObject(group)

  return {
    group,
    bounds,
    animate(seconds: number, reducedMotion: boolean) {
      const openness = reducedMotion ? 1 : mascotEyeOpenness(seconds)
      const scale = .134 * openness
      const changed = eyes.some((eye) => eye.scale.y !== scale)
      if (changed) for (const eye of eyes) eye.scale.y = scale
      return changed
    },
    setThinking(thinking: boolean) {
      smile.visible = !thinking
      thinkingMouth.visible = thinking
      eyes.forEach((eye, index) => {
        eye.position.x = (index === 0 ? -0.406 : 0.406) + (thinking ? 0.04 : 0)
        eye.position.y = y(108) + (thinking ? 0.055 : 0)
      })
    },
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>()
      const materials = new Set<THREE.Material>()
      group.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry)
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            materials.add(material)
        }
      })
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
    },
  }
}

export type MapMascot = ReturnType<typeof createMapMascot>
