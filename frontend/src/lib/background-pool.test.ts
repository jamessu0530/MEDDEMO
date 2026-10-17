import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createBackgroundPool,
  type BackgroundWorker,
  type PoolRequest,
  type PoolResponse,
} from "@/lib/background-pool"
import { scheduleWork } from "@/lib/background-work"

type Input = { source: number[]; query: string }
function fakeWorker() {
  const worker: BackgroundWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  }
  return {
    worker,
    runs: () =>
      vi
        .mocked(worker.postMessage)
        .mock.calls.map(([message]) => message as PoolRequest<Input>)
        .filter((message) => message.type === "run"),
    reply(id: number, result = "done") {
      worker.onmessage?.call(
        worker as Worker,
        { data: { id, result } } as MessageEvent<PoolResponse<string>>
      )
    },
    fail() {
      worker.onerror?.call(
        worker as Worker,
        { preventDefault: vi.fn() } as unknown as ErrorEvent
      )
    },
  }
}
const source = [1, 2, 3]
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("共用頁面 worker 排程", () => {
  it("同一畫面連續打字維持一個執行中工作，另一個名額留給其他畫面", () => {
    const workers: ReturnType<typeof fakeWorker>[] = []
    const create = vi.fn(() => {
      const fake = fakeWorker()
      workers.push(fake)
      return fake.worker
    })
    const pool = createBackgroundPool<Input, string>(create, vi.fn())
    const a = pool.connect(vi.fn(), vi.fn()),
      b = pool.connect(vi.fn(), vi.fn())
    a.update({ source, query: "a0" })
    a.update({ source, query: "a1" })
    a.update({ source, query: "a2" })
    expect(create).toHaveBeenCalledTimes(1)
    b.update({ source, query: "b" })
    expect(create).toHaveBeenCalledTimes(2)
    workers[0].reply(1)
    expect(workers[0].runs().at(-1)?.params).toEqual({ query: "a2" })
    expect(workers[0].runs().at(-1)).not.toHaveProperty("source")
    a.dispose()
    b.dispose()
  })

  it("有多個閒置 worker 時選擇已保留該畫面資料的那一個", () => {
    const workers = [fakeWorker(), fakeWorker()]
    let index = 0
    const pool = createBackgroundPool<Input, string>(
      () => workers[index++].worker,
      vi.fn()
    )
    const a = pool.connect(vi.fn(), vi.fn()),
      b = pool.connect(vi.fn(), vi.fn())
    a.update({ source, query: "a" })
    b.update({ source, query: "b" })
    workers[0].reply(1)
    workers[1].reply(2)
    b.update({ source, query: "b2" })
    expect(workers[0].runs()).toHaveLength(1)
    expect(workers[1].runs()).toHaveLength(2)
    expect(workers[1].runs()[1]).not.toHaveProperty("source")
    a.dispose()
    b.dispose()
  })

  it("最多同時兩個 worker，佇列公平且每個畫面只保留最後一次輸入", () => {
    const workers: ReturnType<typeof fakeWorker>[] = []
    const create = vi.fn(() => {
      const fake = fakeWorker()
      workers.push(fake)
      return fake.worker
    })
    const pool = createBackgroundPool<Input, string>(create, vi.fn(), 20)
    const results = [vi.fn(), vi.fn(), vi.fn()]
    const clients = results.map((result) => pool.connect(result, vi.fn()))
    clients[0].update({ source, query: "old" })
    clients[1].update({ source, query: "b" })
    clients[2].update({ source, query: "c" })
    for (let i = 0; i < 100; i++)
      clients[0].update({ source, query: `new-${i}` })
    expect(create).toHaveBeenCalledTimes(2)
    workers[0].reply(1)
    expect(results[0]).not.toHaveBeenCalled()
    expect(workers[0].runs().at(-1)?.params).toEqual({ query: "c" })
    workers[1].reply(2)
    expect(workers[1].runs().at(-1)?.params).toEqual({ query: "new-99" })
    workers[0].reply(1)
    expect(results[0]).not.toHaveBeenCalled()
    workers[0].reply(3, "c")
    workers[1].reply(103, "latest")
    expect(results[0]).toHaveBeenCalledExactlyOnceWith("latest", {
      source,
      query: "new-99",
    })
    expect(workers.flatMap((fake) => fake.runs())).toHaveLength(4)
    clients.forEach((client) => client.dispose())
    expect(
      workers.every(
        (fake) => vi.mocked(fake.worker.terminate).mock.calls.length === 1
      )
    ).toBe(true)
  })

  it("同一畫面的資料只複製一次，換資料或換畫面一定傳送新來源", () => {
    const fake = fakeWorker()
    const pool = createBackgroundPool<Input, string>(
      () => fake.worker,
      vi.fn(),
      1
    )
    const a = pool.connect(vi.fn(), vi.fn()),
      b = pool.connect(vi.fn(), vi.fn())
    a.update({ source, query: "a" })
    fake.reply(1)
    a.update({ source, query: "b" })
    expect(fake.runs()[1]).not.toHaveProperty("source")
    fake.reply(2)
    a.update({ source: [4], query: "c" })
    expect(fake.runs()[2].source).toEqual([4])
    fake.reply(3)
    b.update({ source, query: "d" })
    expect(fake.runs()[3].source).toBe(source)
    fake.reply(4)
    b.dispose()
    a.dispose()
  })

  it("離開畫面清除待辦和資料，最後一個畫面離開即終止 worker，忽略在途回覆", () => {
    const fake = fakeWorker(),
      onResult = vi.fn()
    const pool = createBackgroundPool<Input, string>(
      () => fake.worker,
      vi.fn(),
      1
    )
    const client = pool.connect(onResult, vi.fn())
    client.update({ source, query: "a" })
    client.update({ source, query: "b" })
    const late = fake.worker.onmessage
    client.dispose()
    late?.call(
      fake.worker as Worker,
      { data: { id: 1, result: "late" } } as MessageEvent<PoolResponse<string>>
    )
    client.update({ source, query: "ignored" })
    expect(fake.worker.terminate).toHaveBeenCalledTimes(1)
    expect(fake.runs()).toHaveLength(1)
    expect(onResult).not.toHaveBeenCalled()
  })

  it.each(["load", "decode", "clone"])(
    "worker %s 失敗時重算各畫面的最新任務",
    async (mode) => {
      vi.useFakeTimers()
      const fake = fakeWorker(),
        resultA = vi.fn(),
        resultB = vi.fn()
      if (mode === "clone")
        vi.mocked(fake.worker.postMessage).mockImplementation(() => {
          throw new Error("cannot clone")
        })
      const fallback = vi.fn((input: Input, cancelled: () => boolean) =>
        scheduleWork(
          (function* () {
            yield
            return input.query
          })(),
          cancelled
        )
      )
      const pool = createBackgroundPool<Input, string>(
        () => fake.worker,
        fallback,
        1
      )
      const a = pool.connect(resultA, vi.fn()),
        b = pool.connect(resultB, vi.fn())
      a.update({ source, query: "old" })
      a.update({ source, query: "latest" })
      b.update({ source, query: "b" })
      if (mode === "load") fake.fail()
      if (mode === "decode")
        fake.worker.onmessageerror?.call(
          fake.worker as Worker,
          {} as MessageEvent
        )
      await vi.runAllTimersAsync()
      expect(resultA).toHaveBeenCalledExactlyOnceWith("latest", {
        source,
        query: "latest",
      })
      expect(resultB).toHaveBeenCalledExactlyOnceWith("b", {
        source,
        query: "b",
      })
      a.dispose()
      b.dispose()
    }
  )

  it("無法建立 worker 也不阻塞；降級任務取消或拋錯仍可繼續處理其他畫面", async () => {
    vi.useFakeTimers()
    const onError = vi.fn(),
      onResult = vi.fn()
    const pool = createBackgroundPool<Input, string>(
      () => {
        throw new Error("unsupported")
      },
      (input, cancelled) => {
        if (input.query === "bad") throw new Error("bad task")
        return scheduleWork(
          (function* () {
            yield
            return input.query
          })(),
          cancelled
        )
      },
      1
    )
    const a = pool.connect(onResult, onError),
      b = pool.connect(onResult, onError)
    a.update({ source, query: "bad" })
    b.update({ source, query: "good" })
    await vi.runAllTimersAsync()
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "bad task" }),
      { source, query: "bad" }
    )
    expect(onResult).toHaveBeenCalledExactlyOnceWith("good", {
      source,
      query: "good",
    })
    a.update({ source, query: "cancelled" })
    a.dispose()
    b.dispose()
    await vi.runAllTimersAsync()
    expect(onResult).toHaveBeenCalledTimes(1)
  })

  it("計算錯誤交給對應畫面，不影響下一個工作", () => {
    const fake = fakeWorker(),
      onError = vi.fn(),
      onResult = vi.fn()
    const pool = createBackgroundPool<Input, string>(
      () => fake.worker,
      vi.fn(),
      1
    )
    const client = pool.connect(onResult, onError)
    const input = { source, query: "a" }
    client.update(input)
    fake.worker.onmessage?.call(
      fake.worker as Worker,
      { data: { id: 1, error: "invalid" } } as MessageEvent<
        PoolResponse<string>
      >
    )
    expect(onError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ message: "invalid" }),
      input
    )
    client.update({ source, query: "b" })
    fake.reply(2)
    expect(onResult).toHaveBeenCalledTimes(1)
    client.dispose()
  })
})
