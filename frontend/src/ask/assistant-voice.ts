import type { VoiceSession } from "@/components/ask/voice-dock"
import { onAuthChange, readUser } from "@/lib/auth"

type VoiceState = { active: boolean; session: VoiceSession | null; notice: string | null }
let state: VoiceState = { active: false, session: null, notice: null }
const listeners = new Set<() => void>()
function update(patch: Partial<VoiceState>) {
  if (Object.entries(patch).every(([key, value]) => state[key as keyof VoiceState] === value)) return
  state = { ...state, ...patch }
  listeners.forEach((listener) => listener())
}

export const openAssistantVoice = () => update({ active: true, notice: null })
export const closeAssistantVoice = () => update({ active: false, session: null, notice: null })
export const assistantVoice = {
  getSnapshot: () => state,
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  setSession: (session: VoiceSession | null) => update({ session }),
  setNotice: (notice: string | null) => update({ notice }),
}

let owner = readUser()?.id
onAuthChange(() => {
  const next = readUser()?.id
  if (next !== owner) closeAssistantVoice()
  owner = next
})
