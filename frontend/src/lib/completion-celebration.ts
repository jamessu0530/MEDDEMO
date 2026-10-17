export const COMPLETION_CELEBRATION_MS = 2800

export type CompletionCelebration = { id: number; message: string }

let current: CompletionCelebration | null = null
let sequence = 0
const listeners = new Set<() => void>()

function publish() {
  listeners.forEach((listener) => listener())
}

/** Only call after a completed action has been saved successfully. */
export function celebrateCompletion(message: string) {
  current = { id: ++sequence, message }
  publish()
}

export function dismissCompletion(id: number) {
  // An older animation finishing must not dismiss a newer completion.
  if (current?.id !== id) return
  current = null
  publish()
}

export const completionCelebration = {
  getSnapshot: () => current,
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  },
}
