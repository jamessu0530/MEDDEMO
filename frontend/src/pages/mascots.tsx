import { useEffect, useState } from "react"

import { encounterMascot, equipMascot, getMascotCollection } from "@/api/mascot"
import { MascotWardrobe } from "@/components/mascot-wardrobe"
import { Notice } from "@/components/notice"
import { PageHeader } from "@/components/page-header"
import { avatars } from "@/lib/avatars"
import { useAuth } from "@/lib/auth"
import type { MascotCollection } from "@/lib/mascot-collection"

export function MascotsPage() {
  const user = useAuth()?.user
  const [collection, setCollection] = useState<MascotCollection | null>(null)
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const refresh = () => setAttempt((value) => value + 1)
    window.addEventListener("mascot-achievement-unlocked", refresh)
    return () => window.removeEventListener("mascot-achievement-unlocked", refresh)
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    getMascotCollection(controller.signal).then(setCollection).catch((err) => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "收藏暫時載入不了")
    })
    return () => controller.abort()
  }, [attempt])
  return <div className="min-h-svh"><PageHeader title="熊熊衣櫃" backTo={user?.role === "sales" ? "/me" : "/settings"} /><main className="mx-auto max-w-6xl px-4 pt-5 pb-10 lg:px-6">
    {error ? <Notice text={error} action={{ label: "再試一次", onClick: () => { setError(""); setAttempt((value) => value + 1) } }} /> : !collection ? <p className="py-10 text-center text-sm text-muted-foreground">打開熊熊滾的衣櫃中…</p> : <MascotWardrobe showHeading={false} collection={collection} onEquip={async (look, asAvatar) => {
      const next = await equipMascot(look, asAvatar)
      setCollection(next)
      if (user) avatars.updateMascot(user.id, next.use_as_avatar ? next.equipped : null)
    }} onEncounter={async (eventId) => {
      const result = await encounterMascot(eventId)
      setCollection(result.collection)
      return result
    }} />}
  </main></div>
}
