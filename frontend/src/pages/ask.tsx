import { Component, lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { Loader2, Mic, Send } from "lucide-react"

import { type Ask, type AskKind } from "@/api/asks"
import { askSessionFor } from "@/ask/ask-session"
import { useConversation } from "@/ask/use-conversation"
import { EntryView } from "@/components/ask/entry-view"
import { AttachButton, DraftFiles } from "@/components/attachments/draft-files"
// type-only：只拿型別，不會把 VoiceDock（跟著它的 src/voice）拉進主 chunk
import type { VoiceSession } from "@/components/ask/voice-dock"
import { BottomNav } from "@/components/bottom-nav"
import { Mascot } from "@/components/mascot"
import { Notice } from "@/components/notice"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { addDraftFiles, shrinkPhoto, type DraftFile } from "@/lib/attachments"
import { useAuth } from "@/lib/auth"
import { askScopeText } from "@/lib/scope"
import { cn } from "@/lib/utils"

// 整包 src/voice（Gemini Live SDK 與音訊處理）只從這裡進來，按了麥克風才載
const loadVoiceDock = () => import("@/components/ask/voice-dock")

const MODES: { kind: AskKind; label: string; placeholder: string; examples: string[] }[] = [
  {
    kind: "data",
    label: "查數字",
    placeholder: "例如：北區這一季保健品為什麼掉？",
    examples: ["北區這一季保健品類為什麼下滑？", "哪幾家客戶進貨間隔拉長，但單次金額持平？"],
  },
  {
    kind: "knowledge",
    label: "查規定",
    placeholder: "例如：近效期的貨要多久前申請退貨？",
    examples: ["近效期的貨要多久前申請退貨？", "我可以直接給客戶幾趴折扣？"],
  },
]

/** 問答（原型 S-07）：打字與語音在同一條對話裡，兩種問法共用同一套查詢與查詢軌跡 */
export function AskPage() {
  const user = useAuth()?.user
  // 對話與還在跑的查詢不放在這個頁面的 state：切去促銷、客戶再回來，要看得到原本的對話，查到一半的也要查完
  const asking = askSessionFor(user?.id ?? "")
  const conversation = asking.conversation
  const sending = useSyncExternalStore(asking.subscribe, asking.isBusy)
  const [kind, setKind] = useState<AskKind>("data")
  const [question, setQuestion] = useState("")
  // 打字提問可以附一個檔案（拍產品盒、仿單、競品海報）；語音不能附
  const [files, setFiles] = useState<DraftFile[]>([])
  const [pickError, setPickError] = useState<string | null>(null)
  const [voiceOn, setVoiceOn] = useState(false)
  const [session, setSession] = useState<VoiceSession | null>(null)
  // React 的 lazy 會把失敗的那一次記在元件身上，之後只會再丟同一個錯；要讓「請稍後再試」是真的，重試就得換一顆新的
  const [VoiceDock, setVoiceDock] = useState(() => lazy(loadVoiceDock))
  // 語音的失敗與掛斷說明放在頁面上，不放 dock 裡：dock 會在收起時整個卸載，訊息要留得住才看得到
  // retryByReload：語音那一包載不下來時才有。瀏覽器會把失敗的動態 import 記在 module map 裡，
  // 同一個網址再 import 會直接失敗而不重抓，所以唯一真的能再試一次的方法是重新整理
  const [notice, setNotice] = useState<{ text: string; retryByReload?: boolean } | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const mode = MODES.find((m) => m.kind === kind)!
  // 模型還在講、逐字稿還沒出來的那一格先不顯示
  const entries = useConversation(conversation).filter((entry) => entry.kind === "tool" || entry.text.trim())

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [entries.length])

  function submit(text: string) {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setQuestion("")
    // 語音會話開著就送進同一個會話，模型保有上下文並用講的回答；entry 由 controller 加
    if (session) {
      session.sendText(trimmed)
      return
    }
    const file = files[0]?.file
    setFiles([])
    setPickError(null)
    // 送出與輪詢都在 asking 裡跑：這一頁卸載了也照樣查完，錯誤寫在那一格卡片上
    void (file ? shrinkPhoto(file) : Promise.resolve(undefined)).then((ready) => asking.ask(kind, trimmed, ready))
  }

  function pick(picked: File[]) {
    // 只能附一個：再選就換掉原本那個
    const result = addDraftFiles([], picked.slice(0, 1), 1)
    if (result.files.length) setFiles(result.files)
    setPickError(result.error)
  }

  const replaceAsk = (id: number, patch: { ask: Ask }) => conversation.replace(id, patch)

  // 開新的一段語音、或把語音收起來，都要把上一段留下的訊息清掉，否則舊的「連線中斷」會跟著下一段對話跑
  const openVoice = () => {
    setNotice(null)
    setVoiceOn(true)
  }
  const closeVoice = () => {
    setVoiceOn(false)
    setNotice(null)
  }
  // 語音那一包載不下來：收掉語音、把原因寫在 notice 上，打字那條路完全不受影響。
  // 換一個新的 lazy 只救得了「失敗發生在 Vite 的 preload 輔助程式」那一種；模組本身抓失敗的話，
  // 瀏覽器已經記住了，所以按鈕給的是重新整理，不是假裝再試一次
  const failVoice = () => {
    setVoiceOn(false)
    setNotice({ text: "語音載入失敗。要再試一次得重新整理頁面，打字問到一半的內容會清空。", retryByReload: true })
    setVoiceDock(() => lazy(loadVoiceDock))
  }

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 pt-4 pb-3 backdrop-blur">
        <p className="text-xs text-muted-foreground">先查公司資料與內部文件，查不到才參考網路公開資料（會另外標示）</p>
        <h1 className="mt-0.5 text-lg font-semibold">問答</h1>
        {/* 語音會話裡是模型自己選要查數字還是查規定，這組切換只對打字有用。
            看的是 session 不是 voiceOn：連線中或掛斷後打字走的還是這裡選的工具，這時候藏起來業務就看不到也改不了 */}
        {!session && (
          <div className="mt-3 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
            {MODES.map((m) => (
              <button
                key={m.kind}
                type="button"
                onClick={() => setKind(m.kind)}
                className={cn(
                  "h-10 rounded-md text-sm font-medium",
                  kind === m.kind ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* 底部最高的那個狀態是 dock（56）＋查詢範圍那行（17）＋輸入框（44），中間兩個 6px 間距，
          加上上下各 8 的留白、border 的 1 與導覽列的 64，約 210px。留到 224px 才不會蓋住最後一格。
          會同時出現是因為查詢範圍那行看的是 session 而不是 voiceOn：連線中與斷線後 dock 還在，但送出走的是打字那條路 */}
      <main className="flex flex-1 flex-col gap-4 px-4 pt-4 pb-56">
        {entries.length === 0 && !voiceOn && (
          <div className="flex flex-col gap-2">
            <Mascot state="hi" size={96} className="self-center" />
            <p className="text-sm text-muted-foreground">可以這樣問，或按右下角的麥克風用說的：</p>
            {mode.examples.map((example) => (
              <button
                key={example}
                type="button"
                onClick={() => submit(example)}
                className="min-h-11 rounded-xl border-2 bg-card px-4 py-2.5 text-left text-sm shadow-lip press"
              >
                {example}
              </button>
            ))}
          </div>
        )}
        {entries.map((entry) => (
          <EntryView key={entry.id} entry={entry} onAskChange={replaceAsk} />
        ))}
        {/* 語音會話的訊息不放按鈕：重試就在下面 dock 的「重新開始」。
            但整包載不下來時沒有 dock，那一種才自己帶重新整理 */}
        {notice && (
          <Notice
            text={notice.text}
            action={
              notice.retryByReload ? { label: "重新整理", onClick: () => window.location.reload() } : undefined
            }
          />
        )}
        <div ref={bottomRef} />
      </main>

      {/* 底色一路墊到最下面，浮著的導覽列兩旁和下面的空隙才不會露出後面捲動的對話 */}
      <div className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md flex-col gap-1.5 border-t bg-background px-3 pt-2 pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
        {voiceOn && (
          <VoiceBoundary onFail={failVoice}>
            <Suspense
              fallback={
                <Button className="h-14 w-full gap-2 text-base" disabled>
                  <Loader2 className="size-5 animate-spin" />
                  載入中…
                </Button>
              }
            >
              <VoiceDock conversation={conversation} polls={asking.polls} onClose={closeVoice} onSession={setSession} onNotice={(text) => setNotice(text ? { text } : null)} />
            </Suspense>
          </VoiceBoundary>
        )}
        {/* 輸入框永遠顯示：會話開著時打字也送進同一個會話，跟語音共用同一條對話 */}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            submit(question)
          }}
          className="flex flex-col gap-1.5"
        >
          {/* 數字查詢只查得到登入者看得到的客戶；規定題查的是公司文件，不分客戶，不必提。
              會話活著時是模型自己選工具，這行文字才對不上；連線中或掛斷後打字仍走這條路，要照樣說清楚查得到誰 */}
          {user && kind === "data" && !session && <p className="px-1 text-[0.6875rem] text-muted-foreground">{askScopeText(user)}</p>}
          {pickError && <p className="px-1 text-[0.6875rem] text-destructive">{pickError}</p>}
          {!session && <DraftFiles files={files} onRemove={() => setFiles([])} disabled={sending} />}
          <div className="flex gap-2">
            {!session && <AttachButton onPick={pick} disabled={sending} multiple={false} />}
            <Input
              value={question}
              onChange={(event) => {
                setQuestion(event.target.value)
                session?.noteActivity()
              }}
              placeholder={session ? "也可以打字問，AI 會用講的回答" : files.length ? "問這個檔案的什麼？" : mode.placeholder}
              aria-label="輸入問題"
              className="h-11 bg-card"
            />
            {!voiceOn && (
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-11 shrink-0"
                onClick={openVoice}
                aria-label="用說的問"
              >
                <Mic className="size-4" />
              </Button>
            )}
            <Button type="submit" size="icon" className="size-11 shrink-0" disabled={sending || !question.trim()} aria-label="送出">
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </form>
      </div>
      <BottomNav />
    </div>
  )
}

/**
 * 語音那一包是按下麥克風的當下才去下載的，藥局裡收訊不好就會失敗。
 * 沒有錯誤邊界的話 React 會把錯誤丟到根節點、卸載整棵樹，連打字問到一半的對話都會跟著不見。
 * 這裡把它擋在語音這一區：原因由頁面的 notice 說，輸入框照常留著。React 的錯誤邊界只能用 class 元件寫。
 */
class VoiceBoundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch() {
    this.props.onFail()
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}
