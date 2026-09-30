import type { InkFrame } from "@/ink/controller"
import { bleedLead, type InkEffect } from "@/ink/effects"
import { fragmentShader, UNIFORMS, VERTEX_SHADER } from "@/ink/shaders"

type Uniforms = Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>
type Program = { program: WebGLProgram; fragment: WebGLShader; uniforms: Uniforms | null }

const EFFECTS: InkEffect[] = ["bleed", "spray", "splat", "brush"]

// 畫布解析度是螢幕的幾倍，最多到這個數字。墨的邊緣本來就不規則，不必跟到 3 倍的螢幕；
// 播得卡就往下降一級，降到底還是卡，這次打開就不再播（canDraw 回 false）
const QUALITY = [1.5, 1, 0.75]

/** 把四支著色器接到一張 canvas 上。瀏覽器開不了 WebGL 就回 null */
export function createInkRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false })
  if (!gl) return null

  let programs: Partial<Record<InkEffect, Program | null>> = {}
  let level = 0
  let ratio = 1
  let lost = gl.isContextLost()

  /** 一個蓋住整個畫布的三角形；context 掉了再回來時要重做 */
  function setup() {
    programs = {}
    gl!.bindBuffer(gl!.ARRAY_BUFFER, gl!.createBuffer())
    gl!.bufferData(gl!.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl!.STATIC_DRAW)
    gl!.enableVertexAttribArray(0)
    gl!.vertexAttribPointer(0, 2, gl!.FLOAT, false, 0, 0)
    gl!.disable(gl!.BLEND)
  }

  function compile(type: number, source: string) {
    const shader = gl!.createShader(type)
    if (!shader) return null
    gl!.shaderSource(shader, source)
    gl!.compileShader(shader)
    return shader
  }

  /** 送去編譯、連結，但不等結果：瀏覽器可以在背景做，第一次要畫的時候才問成功了沒（ready） */
  function build(effect: InkEffect): Program | null {
    const vertex = compile(gl!.VERTEX_SHADER, VERTEX_SHADER)
    const fragment = compile(gl!.FRAGMENT_SHADER, fragmentShader(effect))
    const program = gl!.createProgram()
    if (!vertex || !fragment || !program) return null
    gl!.attachShader(program, vertex)
    gl!.attachShader(program, fragment)
    gl!.bindAttribLocation(program, 0, "a")
    gl!.linkProgram(program)
    return { program, fragment, uniforms: null }
  }

  function ready(effect: InkEffect) {
    if (programs[effect] === undefined) programs[effect] = build(effect)
    const built = programs[effect]
    if (!built) return null
    if (!built.uniforms) {
      if (!gl!.getProgramParameter(built.program, gl!.LINK_STATUS)) {
        console.error(`油墨著色器（${effect}）編譯失敗`, gl!.getShaderInfoLog(built.fragment), gl!.getProgramInfoLog(built.program))
        programs[effect] = null
        return null
      }
      const uniforms = {} as Uniforms
      for (const name of UNIFORMS) uniforms[name] = gl!.getUniformLocation(built.program, name)
      built.uniforms = uniforms
    }
    return built as Program & { uniforms: Uniforms }
  }

  const onLost = (event: Event) => {
    event.preventDefault() // 不擋的話瀏覽器不會把 context 還回來
    lost = true
  }
  const onRestored = () => {
    lost = false
    setup()
  }
  canvas.addEventListener("webglcontextlost", onLost)
  canvas.addEventListener("webglcontextrestored", onRestored)
  if (!lost) setup()

  return {
    /** 先把四支都送去編譯，第一次換頁才不會頓一下 */
    warm() {
      if (lost) return
      for (const effect of EFFECTS) if (programs[effect] === undefined) programs[effect] = build(effect)
    },

    canDraw(effect: InkEffect) {
      return !lost && level < QUALITY.length && ready(effect) !== null
    },

    /** 把畫布的像素數調成現在的大小；回傳它在畫面上的位置與大小（CSS px） */
    resize() {
      const rect = canvas.getBoundingClientRect()
      ratio = Math.min(window.devicePixelRatio || 1, QUALITY[Math.min(level, QUALITY.length - 1)])
      const width = Math.round(rect.width * ratio)
      const height = Math.round(rect.height * ratio)
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width
        canvas.height = height
      }
      return rect
    },

    draw(frame: InkFrame) {
      const built = lost ? null : ready(frame.effect)
      if (!built) return
      const width = canvas.width / ratio
      const height = canvas.height / ratio
      const [x, y] = frame.origin
      const u = built.uniforms
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.useProgram(built.program)
      gl.uniform2f(u.uRes, width, height)
      gl.uniform1f(u.uDpr, ratio)
      gl.uniform1f(u.uT, frame.t)
      gl.uniform2f(u.uO, x, y)
      // 起點到最遠角落的距離，著色器裡的距離都除以它
      gl.uniform1f(u.uMaxD, Math.max(Math.hypot(x, y), Math.hypot(width - x, y), Math.hypot(x, height - y), Math.hypot(width - x, height - y)))
      gl.uniform2f(u.uSeed, frame.seed[0], frame.seed[1])
      gl.uniform3fv(u.uColA, frame.colors.from)
      gl.uniform3fv(u.uColB, frame.colors.to)
      gl.uniform3fv(u.uWashA, frame.colors.washFrom)
      gl.uniform3fv(u.uWashB, frame.colors.washTo)
      gl.uniform1f(u.uLead, bleedLead(frame.t))
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },

    clear() {
      if (lost) return
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
    },

    degrade() {
      level++
    },

    dispose() {
      canvas.removeEventListener("webglcontextlost", onLost)
      canvas.removeEventListener("webglcontextrestored", onRestored)
      for (const effect of EFFECTS) {
        const built = programs[effect]
        if (built) gl.deleteProgram(built.program)
      }
      programs = {}
    },
  }
}
