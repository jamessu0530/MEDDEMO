export type Work<T> = Generator<void, T>

export function finishWork<T>(work: Work<T>): T {
  let result = work.next()
  while (!result.done) result = work.next()
  return result.value
}

/** The same solver runs in workers or in cancellable batches on older browsers. */
export async function scheduleWork<T>(work: Work<T>, cancelled: () => boolean) {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  let started = performance.now()
  while (!cancelled()) {
    const result = work.next()
    if (result.done) return result.value
    if (performance.now() - started >= 4) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      started = performance.now()
    }
  }
  return null
}

/** Stable merge sort with checkpoints even when one dataset is very large. */
export function* sortWork<T>(
  items: T[],
  compare: (a: T, b: T) => number
): Work<T[]> {
  let source = items.slice(),
    target = new Array<T>(items.length),
    operations = 0
  for (let width = 1; width < items.length; width *= 2) {
    for (let start = 0; start < items.length; start += width * 2) {
      const middle = Math.min(start + width, items.length),
        end = Math.min(start + width * 2, items.length)
      let left = start,
        right = middle
      for (let index = start; index < end; index++) {
        target[index] =
          right >= end ||
          (left < middle && compare(source[left], source[right]) <= 0)
            ? source[left++]
            : source[right++]
        if (++operations % 128 === 0) yield
      }
    }
    ;[source, target] = [target, source]
  }
  return source
}
