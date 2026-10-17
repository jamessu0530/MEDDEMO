import { onAuthChange, readUser } from "@/lib/auth"

let open = false
let owner = readUser()?.id
const listeners = new Set<() => void>()
function setOpen(next: boolean) {
  open = next
  listeners.forEach((listener) => listener())
}
export const openAssistant = () => setOpen(true)
export const closeAssistant = () => setOpen(false)
export const assistantWindow = {
  getSnapshot: () => open,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}
onAuthChange(() => {
  const next = readUser()?.id
  if (next !== owner) closeAssistant()
  owner = next
})
