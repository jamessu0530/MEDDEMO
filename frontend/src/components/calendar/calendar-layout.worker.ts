import { layoutCalendar } from "./calendar-layout"
import type {
  CalendarLayoutRequest,
  CalendarLayoutResponse,
} from "./calendar-layout-runner"

const scope = self as unknown as {
  onmessage: (event: MessageEvent<CalendarLayoutRequest>) => void
  postMessage: (message: CalendarLayoutResponse) => void
}
scope.onmessage = ({ data }) => {
  scope.postMessage({ id: data.id, layout: layoutCalendar(data.input) })
}
