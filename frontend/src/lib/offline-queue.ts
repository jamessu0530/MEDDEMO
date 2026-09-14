/**
 * 沒網路時錄音存在手機（FR-4.3、NFR-6）：錄完先存進瀏覽器的 IndexedDB，再上傳；
 * 上傳不了就留著，恢復連線或每隔一段時間自動重送。伺服器用錄音編號（client_ref）去重，重送不會多出一筆。
 * 畫面透過 subscribe／getSnapshot 讀狀態（React 的 useSyncExternalStore）。
 */

import { useSyncExternalStore } from "react"

import { ApiError } from "@/api/client"
import { uploadAudio, type Visit } from "@/api/visits"

const DB_NAME = "meddemo"
const STORE = "recordings"
// 訊號不穩時（連得上基地台、連不到伺服器）online 事件不一定會觸發，所以每 30 秒再試一次；
// 一分鐘的錄音約半 MB，重試不會吃掉太多流量
const RETRY_MS = 30_000

export type QueuedRecording = {
  clientRef: string
  customerId: string
  customerName: string
  filename: string
  blob: Blob | null // 送出之後就清掉，只留紀錄給畫面提示
  recordedAt: number
  durationSeconds: number
  state: "pending" | "sent" | "failed"
  visitId: string | null
  error: string | null
}

type Snapshot = { items: QueuedRecording[]; online: boolean; sending: boolean }

function openDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "clientRef" })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** 等整筆交易寫進手機才算完成，關掉網頁也不會掉 */
async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE, mode)
    const request = action(transaction.objectStore(STORE))
    transaction.oncomplete = () => {
      db.close()
      resolve(request.result)
    }
    transaction.onerror = transaction.onabort = () => {
      db.close()
      reject(transaction.error ?? request.error)
    }
  })
}

/** 斷線或伺服器暫時不能用：留著之後重送。其他錯誤（檔案太大、客戶不存在）重送也沒用 */
export function isTemporary(error: unknown) {
  if (error instanceof ApiError) return error.status >= 500 || error.status === 408 || error.status === 429
  return true // fetch 自己丟出的 TypeError 就是連不上
}

class UploadQueue {
  private snapshot: Snapshot = { items: [], online: navigator.onLine, sending: false }
  private readonly listeners = new Set<() => void>()
  // 錄音頁正在自己上傳的錄音，背景重送先跳過，免得同一段同時送兩次
  private readonly inFlight = new Set<string>()
  private starts = 0
  private timer: number | undefined

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.snapshot

  private update(patch: Partial<Snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener()
  }

  private async reload() {
    try {
      const items = await run<QueuedRecording[]>("readonly", (store) => store.getAll())
      this.update({ items: items.sort((a, b) => a.recordedAt - b.recordedAt) })
    } catch {
      // IndexedDB 不能用（例如部分瀏覽器的無痕模式）：佇列就是空的，錄音頁會改成直接上傳
    }
  }

  /** 錄完先存進手機。存不進去時回傳 false，錄音頁照樣直接上傳 */
  save = async (item: QueuedRecording) => {
    try {
      await run("readwrite", (store) => store.put(item))
      await this.reload()
      return true
    } catch {
      return false
    }
  }

  /** 錄音頁直接上傳剛錄好的這一筆；成功就從手機裡刪掉，失敗的錯誤交給錄音頁判斷 */
  sendNow = async (item: QueuedRecording): Promise<Visit> => {
    this.inFlight.add(item.clientRef)
    try {
      const visit = await uploadAudio(item.customerId, item.blob!, item.filename, item.clientRef)
      await this.remove(item.clientRef)
      return visit
    } finally {
      this.inFlight.delete(item.clientRef)
    }
  }

  remove = async (clientRef: string) => {
    try {
      await run("readwrite", (store) => store.delete(clientRef))
    } catch {
      // 刪不掉就留著，下次重送時伺服器會用錄音編號認出來
    }
    await this.reload()
  }

  flush = async () => {
    if (this.snapshot.sending || !navigator.onLine) return
    const pending = this.snapshot.items.filter((item) => item.state === "pending" && item.blob && !this.inFlight.has(item.clientRef))
    if (pending.length === 0) return
    this.update({ sending: true })
    try {
      for (const item of pending) {
        try {
          const visit = await uploadAudio(item.customerId, item.blob!, item.filename, item.clientRef)
          await run("readwrite", (store) => store.put({ ...item, blob: null, state: "sent", visitId: visit.id, error: null }))
        } catch (error) {
          if (isTemporary(error)) break // 還是送不出去，等下一輪
          const message = error instanceof Error ? error.message : "上傳失敗"
          await run("readwrite", (store) => store.put({ ...item, state: "failed", error: message }))
        }
      }
    } finally {
      this.update({ sending: false })
      await this.reload()
    }
  }

  /** App 掛上時開始：讀出手機裡的錄音、恢復連線就送、每 30 秒再試。回傳停止用的函式 */
  start = () => {
    this.starts += 1
    if (this.starts === 1) {
      window.addEventListener("online", this.onOnline)
      window.addEventListener("offline", this.onOffline)
      this.timer = window.setInterval(() => void this.flush(), RETRY_MS)
      void this.reload().then(this.flush)
    }
    return () => {
      this.starts -= 1
      if (this.starts === 0) {
        window.removeEventListener("online", this.onOnline)
        window.removeEventListener("offline", this.onOffline)
        window.clearInterval(this.timer)
      }
    }
  }

  private onOnline = () => {
    this.update({ online: true })
    void this.flush()
  }

  private onOffline = () => this.update({ online: false })
}

export const uploadQueue = new UploadQueue()

export function useUploadQueue() {
  return useSyncExternalStore(uploadQueue.subscribe, uploadQueue.getSnapshot)
}
