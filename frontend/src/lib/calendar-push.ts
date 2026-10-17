import { deletePushSubscription, savePushSubscription } from "@/api/planner"

export function pushSupported() {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window &&
    window.isSecureContext
  )
}
export async function enableCalendarPush(publicKey: string) {
  if (!pushSupported())
    throw new Error(
      "此瀏覽器不支援背景推播；iPhone 請先將網站加入主畫面，再從主畫面開啟。"
    )
  if ((await Notification.requestPermission()) !== "granted")
    throw new Error("尚未允許通知，請到瀏覽器設定開啟此網站的通知權限。")
  const registration = await navigator.serviceWorker.register("/calendar-sw.js")
  await navigator.serviceWorker.ready
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    const raw = atob(publicKey.replace(/-/g, "+").replace(/_/g, "/"))
    const key = Uint8Array.from(raw, (char) => char.charCodeAt(0))
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    })
  }
  await savePushSubscription(subscription.toJSON())
}
export async function disableCalendarPush() {
  if (!("serviceWorker" in navigator)) return
  const registration =
    await navigator.serviceWorker.getRegistration("/calendar-sw.js")
  const subscription = await registration?.pushManager.getSubscription()
  if (subscription) {
    await deletePushSubscription(subscription.endpoint)
    await subscription.unsubscribe()
  }
}
