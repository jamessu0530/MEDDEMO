import { useEffect, useSyncExternalStore } from "react"
import { useNavigate } from "react-router"
import { askSessionFor } from "@/ask/ask-session"
import type { TaskSession } from "@/ask/task-session"
import { useAuth } from "@/lib/auth"

/** Keep task navigation mounted on routes that have no assistant panel. */
export function AssistantTaskNavigation() {
  const user = useAuth()?.user
  const asking = askSessionFor(user?.id ?? "")
  useSyncExternalStore(asking.threads.subscribe, asking.threads.getSnapshot, asking.threads.getSnapshot)
  return user ? <TaskNavigation session={asking.tasks} /> : null
}

function TaskNavigation({ session }: { session: TaskSession }) {
  const navigation = useSyncExternalStore(session.subscribe, session.getNavigation, session.getNavigation)
  const navigate = useNavigate()
  useEffect(() => {
    if (!navigation) return
    session.acknowledgeNavigation(navigation.key)
    void navigate(navigation.path)
  }, [navigation, navigate, session])
  return null
}
