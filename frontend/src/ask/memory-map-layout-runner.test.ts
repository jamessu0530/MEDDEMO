import { afterEach, describe, expect, it, vi } from "vitest"
import {
  layoutMemoryMap,
  layoutMemoryMapAsync,
  type MapLayoutInput,
  type MapPositions,
} from "./memory-map-layout"
import {
  createMemoryMapLayoutRunner,
  type LayoutWorker,
  type MapLayoutResponse,
} from "./memory-map-layout-runner"

const graph: MapLayoutInput = {
  nodes: [
    { id: "conversation", kind: "root" },
    { id: "question:1", kind: "question" },
  ],
  links: [{ source: "conversation", target: "question:1" }],
}
const positions: MapPositions = new Map([
  ["conversation", { x: 0, y: 0, z: 0 }],
])

function fakeWorker() {
  const worker: LayoutWorker = {
    onmessage: null,
    onerror: null,
    onmessageerror: null,
    postMessage: vi.fn(),
    terminate: vi.fn(),
  }
  return {
    worker,
    reply(id: number) {
      worker.onmessage?.call(
        worker as Worker,
        { data: { id, positions } } as MessageEvent<MapLayoutResponse>
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

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("memory map layout worker", () => {
  it("重用一個 worker，只保留最新待處理任務，舊回覆不覆蓋新搜尋", () => {
    const fake = fakeWorker()
    const create = vi.fn(() => fake.worker)
    const onResult = vi.fn()
    const runner = createMemoryMapLayoutRunner(onResult, create)
    runner.update(graph)
    runner.update({ ...graph, nodes: graph.nodes.slice(0, 1), links: [] })
    runner.update(graph)
    expect(create).toHaveBeenCalledTimes(1)
    expect(fake.worker.postMessage).toHaveBeenCalledTimes(1)
    fake.reply(1)
    expect(onResult).not.toHaveBeenCalled()
    expect(fake.worker.postMessage).toHaveBeenCalledTimes(2)
    expect(fake.worker.postMessage).toHaveBeenLastCalledWith({ id: 3, graph })
    fake.reply(1)
    expect(onResult).not.toHaveBeenCalled()
    fake.reply(3)
    expect(onResult).toHaveBeenCalledExactlyOnceWith(positions)
    runner.dispose()
  })

  it("只複製排列需要的欄位，不把回答與筆記一起複製", () => {
    const fake = fakeWorker()
    const runner = createMemoryMapLayoutRunner(vi.fn(), () => fake.worker)
    const withContent = {
      ...graph,
      nodes: graph.nodes.map((node) => ({
        ...node,
        detail: "長回答",
        note: "筆記",
      })),
    }
    runner.update(withContent)
    expect(fake.worker.postMessage).toHaveBeenCalledWith({ id: 1, graph })
    runner.dispose()
  })

  it("關閉地圖終止 worker，取消佇列，也忽略已在途的回覆", () => {
    const fake = fakeWorker()
    const onResult = vi.fn()
    const runner = createMemoryMapLayoutRunner(onResult, () => fake.worker)
    runner.update(graph)
    runner.update(graph)
    const lateReply = fake.worker.onmessage
    runner.dispose()
    lateReply?.call(
      fake.worker as Worker,
      { data: { id: 1, positions } } as MessageEvent<MapLayoutResponse>
    )
    runner.update(graph)
    expect(fake.worker.terminate).toHaveBeenCalledTimes(1)
    expect(fake.worker.postMessage).toHaveBeenCalledTimes(1)
    expect(fake.worker.onmessage).toBeNull()
    expect(onResult).not.toHaveBeenCalled()
  })

  it("worker 載入失敗時，以可讓出主執行緒的方式處理最新任務", async () => {
    vi.useFakeTimers()
    const fake = fakeWorker()
    const onResult = vi.fn()
    const runner = createMemoryMapLayoutRunner(onResult, () => fake.worker)
    runner.update({ nodes: [], links: [] })
    runner.update(graph)
    fake.fail()
    expect(onResult).not.toHaveBeenCalled()
    expect(fake.worker.terminate).toHaveBeenCalledTimes(1)
    await vi.runAllTimersAsync()
    expect(onResult).toHaveBeenCalledExactlyOnceWith(layoutMemoryMap(graph))
    runner.dispose()
  })

  it("無法建立或傳送 worker 任務時也能降級，關閉後不回傳", async () => {
    vi.useFakeTimers()
    const onResult = vi.fn()
    const runner = createMemoryMapLayoutRunner(onResult, () => {
      throw new Error("unavailable")
    })
    runner.update(graph)
    runner.dispose()
    await vi.runAllTimersAsync()
    expect(onResult).not.toHaveBeenCalled()

    const fake = fakeWorker()
    vi.mocked(fake.worker.postMessage).mockImplementation(() => {
      throw new Error("cannot clone")
    })
    const fallback = createMemoryMapLayoutRunner(onResult, () => fake.worker)
    fallback.update(graph)
    await vi.runAllTimersAsync()
    expect(onResult).toHaveBeenCalledExactlyOnceWith(layoutMemoryMap(graph))
    fallback.dispose()
  })

  it("降級計算分批讓出執行時間，與 worker 排列結果一致", async () => {
    let now = 0
    vi.spyOn(performance, "now").mockImplementation(() => (now += 3))
    const pause = vi.fn(async () => {})
    expect(await layoutMemoryMapAsync(graph, () => false, pause)).toEqual(
      layoutMemoryMap(graph)
    )
    expect(pause.mock.calls.length).toBeGreaterThan(1)
    let cancelled = false
    const cancelling = async () => {
      cancelled = true
    }
    expect(
      await layoutMemoryMapAsync(graph, () => cancelled, cancelling)
    ).toBeNull()
  })
})
