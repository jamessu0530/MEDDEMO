import { finishWork } from "@/lib/background-work"
import type { PoolRequest, PoolResponse } from "@/lib/background-pool"
import {
  pageWork,
  type PageWorkInput,
  type PageWorkResult,
} from "@/lib/page-work"

const scope = self as unknown as {
  onmessage: (event: MessageEvent<PoolRequest<PageWorkInput>>) => void
  postMessage: (response: PoolResponse<PageWorkResult>) => void
}
let owner: number | null = null,
  source: PageWorkInput["source"] | undefined
scope.onmessage = ({ data }) => {
  if (data.type === "clear") {
    if (owner === data.owner) {
      owner = null
      source = undefined
    }
    return
  }
  try {
    if ("source" in data) {
      owner = data.owner
      source = data.source
    }
    if (owner !== data.owner || source === undefined)
      throw new Error("Background dataset unavailable")
    const input = { ...data.params, source } as PageWorkInput
    scope.postMessage({ id: data.id, result: finishWork(pageWork(input)) })
  } catch (error) {
    scope.postMessage({
      id: data.id,
      error:
        error instanceof Error
          ? error.message
          : "Background calculation failed",
    })
  }
}
