import { layoutMemoryMap } from "./memory-map-layout"
import type {
  MapLayoutRequest,
  MapLayoutResponse,
} from "./memory-map-layout-runner"

const scope = self as unknown as {
  onmessage: (event: MessageEvent<MapLayoutRequest>) => void
  postMessage: (message: MapLayoutResponse) => void
}

scope.onmessage = ({ data }) => {
  scope.postMessage({ id: data.id, positions: layoutMemoryMap(data.graph) })
}
