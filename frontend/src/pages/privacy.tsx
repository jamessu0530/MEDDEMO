import { ChevronLeft } from "lucide-react"
import { Link, useNavigate } from "react-router"

/*
 * 隱私權政策（不用登入就看得到）。Google 登入發布給外部使用者、Facebook 登入切上線模式都要求這一頁，
 * Facebook 的「用戶資料刪除說明網址」也指到這裡的 #delete。
 * 內容照系統實際的做法寫：保存期限見 backend/app/services/privacy.py，外部服務見 README「金鑰與供應商」。
 * 改了做法要回來改這一頁。
 */

const UPDATED = "2026 年 9 月 17 日"

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-4 flex-col gap-2">
      <h2 className="text-base font-semibold">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-foreground/90">{children}</div>
    </section>
  )
}

export function PrivacyPage() {
  const navigate = useNavigate()
  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 flex items-center gap-1 border-b bg-background/95 px-2 py-2 backdrop-blur">
        <button
          type="button"
          aria-label="返回"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
          className="flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
        >
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="text-base font-semibold">隱私權政策</h1>
      </header>

      <main className="flex flex-col gap-6 px-4 pt-4 pb-12">
        <p className="text-sm leading-relaxed text-muted-foreground">
          中化裕民業務 AI 助理是參加競賽的展示系統，客戶、交易與拜訪資料都是虛構的。這一頁說明你使用時我們會收到哪些資料、拿去做什麼、交給哪些服務處理、保存多久，以及怎麼刪除。最後更新：{UPDATED}。
        </p>

        <Section title="我們收到哪些資料">
          <ul className="list-disc pl-5">
            <li>
              <b>帳號</b>：你填的名字、Email，以及密碼（只存加密後的雜湊，看不到原本的密碼）。
            </li>
            <li>
              <b>用 Google、GitHub 或 Facebook 登入時</b>：該服務提供的使用者編號、名字與 Email。我們只拿這幾項，不會讀取你在這些服務上的其他內容，也不會替你發文。
            </li>
            <li>
              <b>你輸入或說出的內容</b>：問答的提問、語音問答的聲音、拜訪錄音、逐字稿與整理出來的拜訪紀錄、報價草稿。
            </li>
            <li>
              <b>連線資訊</b>：IP 位址。沒登入時用來計算用量上限，計數在該小時或該天結束後一小時自動清除；伺服器的連線紀錄裡也會出現。
            </li>
          </ul>
        </Section>

        <Section title="拿去做什麼">
          <ul className="list-disc pl-5">
            <li>讓你登入，並照你的帳號決定看得到哪些客戶。</li>
            <li>提供系統功能：回答提問、把錄音轉成文字並整理成拜訪紀錄、寫入模擬的 CRM／SAP／OA。</li>
            <li>限制每個帳號與網路的使用次數，避免服務被濫用。</li>
          </ul>
          <p>我們不販售資料，不用於廣告，也不拿你的資料訓練 AI 模型。</p>
        </Section>

        <Section title="交給哪些服務處理">
          <ul className="list-disc pl-5">
            <li>
              <b>Google Gemini</b>：語音辨識、回答提問、語音問答。錄音、逐字稿與提問會送到 Gemini 處理。
            </li>
            <li>
              <b>Cohere</b>：排序內部文件的段落，會收到提問與相關文件段落。
            </li>
            <li>
              <b>Firecrawl</b>：內部文件答不出來時上網搜尋，只會收到從提問改寫出來的搜尋詞。
            </li>
            <li>
              <b>Google Cloud</b>：主機與資料庫；<b>Cloudflare</b>：網路連線與 HTTPS。
            </li>
          </ul>
        </Section>

        <Section title="保存多久">
          <ul className="list-disc pl-5">
            <li>拜訪錄音：確認送出後 60 天刪除。</li>
            <li>
              逐字稿：確認送出後 6 個月刪除。送出時會先遮掉 Email、電話、身分證字號、系統裡業務與主管的姓名，以及「王藥師」「陳小姐」這類稱呼；只講名字或客戶聯絡人的全名認不出來，不會遮。
            </li>
            <li>沒有送出的拜訪紀錄：建立後 60 天整筆刪除。</li>
            <li>帳號、提問與報價草稿：保留到你刪除帳號為止。</li>
          </ul>
        </Section>

        <Section id="delete" title="刪除你的資料">
          <p>
            登入後到 <b>帳號設定</b>，按最下面的 <b>刪除帳號</b>，確認後會立即刪除：
          </p>
          <ul className="list-disc pl-5">
            <li>你的帳號（名字、Email、密碼）</li>
            <li>綁定的 Google／GitHub／Facebook 登入資訊</li>
            <li>你問過的問題，以及轉給主管的提問與回覆</li>
          </ul>
          <p>
            你開的報價草稿是客戶的交易紀錄，會保留，但不再記錄是誰開的。用 Facebook 登入的，也可以在 Facebook 的「設定和隱私 → 應用程式和網站」移除這個應用程式，移除之後就無法再用 Facebook 登入這個帳號。
          </p>
          <p className="text-muted-foreground">公司示範用的八個帳號（u01～u05、m01～m03）是虛構資料，不能自行刪除。</p>
        </Section>

        <Link to="/login" className="inline-flex min-h-11 items-center text-sm font-medium text-primary">
          回登入頁
        </Link>
      </main>
    </div>
  )
}
