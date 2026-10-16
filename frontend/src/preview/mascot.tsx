import { createElement } from "react"
import { createRoot } from "react-dom/client"

import { MascotPlay } from "@/components/mascot-play"
import type { MascotState } from "@/lib/mascot"

const hero = document.getElementById("hero")!
const main = document.querySelector("main")!
const pause = document.getElementById("pause")!
const root = createRoot(hero)
let state: MascotState = "blink"
let view = "full"
let replay = 0

function show() {
  hero.classList.toggle("bust", view === "bust")
  root.render(createElement(MascotPlay, { state, size: 300, bust: view === "bust", key: `${state}-${view}-${replay}` }))
}

document.querySelectorAll<HTMLButtonElement>(".motion").forEach((button) => {
  button.addEventListener("click", () => {
    state = button.dataset.state as MascotState
    document.querySelectorAll(".motion").forEach((choice) => {
      const selected = choice === button
      choice.classList.toggle("selected", selected)
      choice.setAttribute("aria-pressed", String(selected))
    })
    document.getElementById("name")!.textContent = button.dataset.name!
    document.getElementById("description")!.textContent = button.dataset.description!
    show()
  })
})

document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    view = button.dataset.view!
    document.querySelectorAll("[data-view]").forEach((choice) => choice.setAttribute("aria-pressed", String(choice === button)))
    show()
  })
})

pause.addEventListener("click", () => {
  const paused = main.classList.toggle("is-paused")
  pause.textContent = paused ? "繼續播放" : "暫停動畫"
  pause.setAttribute("aria-pressed", String(paused))
})
document.getElementById("replay")!.addEventListener("click", () => {
  main.classList.remove("is-paused")
  pause.textContent = "暫停動畫"
  pause.setAttribute("aria-pressed", "false")
  replay++
  show()
})
show()
