/* 僅處理行事曆通知，不攔截或快取網頁／API。 */
self.addEventListener("push", (event) => {
  let notice
  try { notice = event.data?.json() } catch { return }
  if (!notice?.title) return
  const target = new URL(notice.url || "/calendar", self.location.origin)
  if (target.origin !== self.location.origin || target.pathname !== "/calendar") return
  event.waitUntil(self.registration.showNotification(notice.title, {
    body: notice.body || "行程即將開始", tag: notice.tag, data: { url: target.href }, icon: "/brand/meddemo-app-icon.png",
  }))
})
self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || "/calendar", self.location.origin)
  if (target.origin !== self.location.origin) return
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
    const active = windows.find((client) => new URL(client.url).origin === target.origin)
    if (active) { await active.navigate(target.href); return active.focus() }
    return self.clients.openWindow(target.href)
  }))
})
