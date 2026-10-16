import * as THREE from "three"

/** 屁股後側的小星號，三條圓頭短線；尺寸使用呼叫端模型的座標單位。 */
export function createMascotRearMark(ink: string, radius: number, stroke: number) {
  const mark = new THREE.Group()
  mark.name = "mascot-rear-mark"
  const geometry = new THREE.CapsuleGeometry(stroke, (radius - stroke) * 2, 4, 8)
  const material = new THREE.MeshStandardMaterial({ color: ink, roughness: .85 })
  for (let index = 0; index < 3; index++) {
    const line = new THREE.Mesh(geometry, material)
    line.rotation.z = index * Math.PI / 3
    line.userData.tint = "ink"
    mark.add(line)
  }
  return mark
}
