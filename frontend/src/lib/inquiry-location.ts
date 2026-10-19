import type { InquiryLocation } from "@/api/customer-inquiries"
import { readUser } from "@/lib/auth"

const FIX_TIMEOUT = 4000
const MAX_FIX_AGE = 60_000

/** Only called when creating a question; never starts a watcher or reads a prior fix. */
export function captureInquiryLocation(
  signal: AbortSignal
): Promise<InquiryLocation | undefined> {
  if (
    signal.aborted ||
    typeof navigator === "undefined" ||
    !navigator.geolocation ||
    readUser()?.role !== "sales"
  )
    return Promise.resolve(undefined)
  return new Promise((resolve) => {
    let done = false
    const finish = (location?: InquiryLocation) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
      resolve(signal.aborted ? undefined : location)
    }
    const abort = () => finish()
    const timer = setTimeout(finish, FIX_TIMEOUT + 500)
    signal.addEventListener("abort", abort, { once: true })
    try {
      navigator.geolocation.getCurrentPosition(
        ({ coords, timestamp }) => {
          const age = Date.now() - timestamp
          const valid =
            Number.isFinite(coords.latitude) &&
            Math.abs(coords.latitude) <= 90 &&
            Number.isFinite(coords.longitude) &&
            Math.abs(coords.longitude) <= 180 &&
            Number.isFinite(coords.accuracy) &&
            coords.accuracy >= 0 &&
            Number.isFinite(timestamp) &&
            age >= -30_000 &&
            age <= MAX_FIX_AGE
          finish(
            valid
              ? {
                  lat: coords.latitude,
                  lng: coords.longitude,
                  accuracy_m: coords.accuracy,
                  captured_at: new Date(timestamp).toISOString(),
                  place_name: null,
                }
              : undefined
          )
        },
        () => finish(),
        { maximumAge: 0, timeout: FIX_TIMEOUT, enableHighAccuracy: true }
      )
    } catch {
      finish()
    }
  })
}
