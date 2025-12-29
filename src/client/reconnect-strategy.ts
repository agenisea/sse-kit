/**
 * Reconnection Strategy
 *
 * Implements exponential backoff with jitter for SSE stream reconnection.
 * Provides utilities for detecting network errors and managing retry state.
 */

import type { RetryConfig } from '../types/stream-config'
import { DEFAULT_RETRY_CONFIG, calculateBackoffDelay } from '../types/stream-config'

/**
 * Network error patterns to detect retryable failures.
 * These indicate transient network issues that may resolve on retry.
 */
const NETWORK_ERROR_PATTERNS = [
  'network',
  'failed to fetch',
  'load failed',
  'err_network_changed',
  'networkerror',
  'aborted',
  'timeout',
  'econnreset',
  'econnrefused',
  'enetunreach',
]

/**
 * Check if an error is a retryable network error.
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()
  return NETWORK_ERROR_PATTERNS.some(pattern => message.includes(pattern))
}

/**
 * Check if an error was caused by user cancellation.
 */
export function isCancellationError(error: unknown): boolean {
  if (!(error instanceof Error)) return false

  const message = error.message.toLowerCase()
  return message.includes('aborted') || error.name === 'AbortError'
}

/**
 * Reconnection state for tracking retry attempts.
 */
export interface ReconnectionState {
  attempt: number
  maxAttempts: number
  nextDelayMs: number
  lastError?: Error
}

/**
 * Reconnection event for UI updates.
 */
export interface ReconnectionEvent {
  type: 'reconnecting' | 'connected' | 'failed'
  attempt: number
  maxAttempts: number
  delayMs: number
  error?: Error
}

/**
 * Creates a reconnection manager with configurable retry logic.
 *
 * @example
 * ```typescript
 * const reconnect = createReconnectionManager({
 *   maxRetries: 3,
 *   onReconnecting: (event) => {
 *     showToast(`Reconnecting... (${event.attempt}/${event.maxAttempts})`)
 *   }
 * })
 *
 * const result = await reconnect.execute(async (signal) => {
 *   return await fetch('/api/stream', { signal })
 * })
 * ```
 */
export function createReconnectionManager(options: {
  config?: Partial<RetryConfig>
  onReconnecting?: (event: ReconnectionEvent) => void
  onConnected?: () => void
  onFailed?: (error: Error) => void
}) {
  const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...options.config }
  let state: ReconnectionState = {
    attempt: 0,
    maxAttempts: config.maxRetries,
    nextDelayMs: config.initialDelayMs,
  }

  function reset(): void {
    state = {
      attempt: 0,
      maxAttempts: config.maxRetries,
      nextDelayMs: config.initialDelayMs,
    }
  }

  function shouldRetry(error: unknown): boolean {
    return isNetworkError(error) && state.attempt < config.maxRetries
  }

  function getDelay(): number {
    return calculateBackoffDelay(state.attempt, config)
  }

  async function waitForRetry(signal?: AbortSignal): Promise<void> {
    const delay = getDelay()
    state.nextDelayMs = delay

    options.onReconnecting?.({
      type: 'reconnecting',
      attempt: state.attempt + 1,
      maxAttempts: config.maxRetries,
      delayMs: delay,
      error: state.lastError,
    })

    await sleep(delay, signal)
    state.attempt++
  }

  async function execute<T>(
    operation: (signal?: AbortSignal) => Promise<T>,
    signal?: AbortSignal
  ): Promise<T> {
    reset()

    while (true) {
      try {
        const result = await operation(signal)
        options.onConnected?.()
        reset()
        return result
      } catch (error) {
        state.lastError = error instanceof Error ? error : new Error(String(error))

        // Don't retry if cancelled
        if (isCancellationError(error) || signal?.aborted) {
          throw error
        }

        // Check if we should retry
        if (!shouldRetry(error)) {
          options.onFailed?.(state.lastError)
          throw error
        }

        await waitForRetry(signal)
      }
    }
  }

  return {
    execute,
    reset,
    shouldRetry,
    getState: () => ({ ...state }),
  }
}

/**
 * Sleep for a duration with optional abort signal.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'))
      return
    }

    const timeout = setTimeout(resolve, ms)

    signal?.addEventListener('abort', () => {
      clearTimeout(timeout)
      reject(new Error('Aborted'))
    })
  })
}

/**
 * Simple retry wrapper with exponential backoff.
 *
 * @example
 * ```typescript
 * const response = await withRetry(
 *   () => fetch('/api/stream'),
 *   {
 *     maxRetries: 3,
 *     onRetry: (attempt, delay, error) => {
 *       console.log(`Retry ${attempt} in ${delay}ms: ${error.message}`)
 *     }
 *   }
 * )
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options?: {
    config?: Partial<RetryConfig>
    signal?: AbortSignal
    shouldRetry?: (error: unknown) => boolean
    onRetry?: (attempt: number, delayMs: number, error: Error) => void
  }
): Promise<T> {
  const config: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...options?.config }
  const shouldRetryFn = options?.shouldRetry ?? isNetworkError
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry if cancelled
      if (isCancellationError(error) || options?.signal?.aborted) {
        throw error
      }

      // Check if we should retry
      if (!shouldRetryFn(error) || attempt >= config.maxRetries) {
        throw error
      }

      const delay = calculateBackoffDelay(attempt, config)
      options?.onRetry?.(attempt + 1, delay, lastError)

      await sleep(delay, options?.signal)
    }
  }

  throw lastError ?? new Error('Max retries exceeded')
}
