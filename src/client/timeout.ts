/**
 * Timeout Utilities
 *
 * Provides timeout wrappers for stream operations including:
 * - Request timeout: Total time limit for the entire operation
 * - Idle timeout: Max time between data chunks
 */

import type { TimeoutConfig } from '../types/stream-config'
import { DEFAULT_TIMEOUT_CONFIG } from '../types/stream-config'

/**
 * Error thrown when a timeout occurs.
 */
export class TimeoutError extends Error {
  public readonly type: 'request' | 'idle'
  public readonly timeoutMs: number

  constructor(type: 'request' | 'idle', timeoutMs: number) {
    const message = type === 'request'
      ? `Request timeout after ${timeoutMs}ms`
      : `Idle timeout: no data received for ${timeoutMs}ms`
    super(message)
    this.name = 'TimeoutError'
    this.type = type
    this.timeoutMs = timeoutMs
  }
}

/**
 * Creates a timeout controller that can abort after a specified duration.
 * Returns an AbortController that will automatically abort.
 */
export function createTimeoutController(
  timeoutMs: number,
  existingSignal?: AbortSignal
): { controller: AbortController; clear: () => void } {
  const controller = new AbortController()

  // If there's an existing signal, link them
  if (existingSignal) {
    if (existingSignal.aborted) {
      controller.abort(existingSignal.reason)
    } else {
      existingSignal.addEventListener('abort', () => {
        controller.abort(existingSignal.reason)
      })
    }
  }

  const timeout = setTimeout(() => {
    controller.abort(new TimeoutError('request', timeoutMs))
  }, timeoutMs)

  return {
    controller,
    clear: () => clearTimeout(timeout),
  }
}

/**
 * Creates an idle timeout tracker that resets on each data chunk.
 */
export function createIdleTimeout(
  timeoutMs: number,
  onTimeout: () => void
): { touch: () => void; clear: () => void } {
  let timeout: ReturnType<typeof setTimeout> | null = null

  const touch = () => {
    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(onTimeout, timeoutMs)
  }

  const clear = () => {
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
  }

  // Start the initial timeout
  touch()

  return { touch, clear }
}

/**
 * Wraps a fetch operation with request and idle timeout support.
 *
 * @example
 * ```typescript
 * const response = await fetchWithTimeout(
 *   () => fetch('/api/stream'),
 *   { requestMs: 60000, idleMs: 10000 }
 * )
 * ```
 */
export async function fetchWithTimeout(
  fetchFn: (signal: AbortSignal) => Promise<Response>,
  config?: Partial<TimeoutConfig>,
  existingSignal?: AbortSignal
): Promise<Response> {
  const timeout = { ...DEFAULT_TIMEOUT_CONFIG, ...config }

  // If no timeout configured, just call fetch directly
  if (timeout.requestMs === 0) {
    return fetchFn(existingSignal ?? new AbortController().signal)
  }

  const { controller, clear } = createTimeoutController(timeout.requestMs, existingSignal)

  try {
    const response = await fetchFn(controller.signal)
    return response
  } finally {
    clear()
  }
}

/**
 * Reads a stream with idle timeout support.
 * Calls touch() on each chunk to reset the idle timer.
 *
 * @example
 * ```typescript
 * await readStreamWithIdleTimeout(
 *   reader,
 *   { idleMs: 10000 },
 *   (chunk) => {
 *     // Process chunk
 *   }
 * )
 * ```
 */
export async function readStreamWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  config: Partial<TimeoutConfig>,
  onChunk: (chunk: Uint8Array) => void
): Promise<void> {
  const timeout = { ...DEFAULT_TIMEOUT_CONFIG, ...config }

  // If no idle timeout, read without timeout
  if (timeout.idleMs === 0) {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      onChunk(value)
    }
    return
  }

  // Create idle timeout that throws on timeout
  let idleTimeout: ReturnType<typeof createIdleTimeout> | null = null

  try {
    idleTimeout = createIdleTimeout(timeout.idleMs, () => {
      reader.cancel(new TimeoutError('idle', timeout.idleMs))
    })

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      idleTimeout.touch()
      onChunk(value)
    }
  } finally {
    idleTimeout?.clear()
  }
}

/**
 * Check if an error is a timeout error.
 */
export function isTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError
}

/**
 * Check if an error is a request timeout error.
 */
export function isRequestTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError && error.type === 'request'
}

/**
 * Check if an error is an idle timeout error.
 */
export function isIdleTimeoutError(error: unknown): error is TimeoutError {
  return error instanceof TimeoutError && error.type === 'idle'
}
