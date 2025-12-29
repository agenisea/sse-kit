/**
 * Circuit Breaker
 *
 * Implements the circuit breaker pattern for SSE streaming connections.
 * Prevents cascade failures by failing fast when the system is unhealthy.
 *
 * States:
 * - CLOSED: Normal operation, requests flow through
 * - OPEN: Failing fast, requests are rejected immediately
 * - HALF_OPEN: Testing recovery, allowing limited requests
 *
 * @example
 * ```typescript
 * const breaker = createCircuitBreaker({
 *   failureThreshold: 3,
 *   resetTimeoutMs: 30000,
 *   onStateChange: (from, to) => {
 *     console.log(`Circuit breaker: ${from} -> ${to}`)
 *   }
 * })
 *
 * // Wrap your streaming operation
 * try {
 *   const result = await breaker.execute(async () => {
 *     return await streamData()
 *   })
 * } catch (error) {
 *   if (error instanceof CircuitOpenError) {
 *     // Show cached/fallback content
 *   }
 * }
 * ```
 */

import type { CircuitBreakerConfig } from '../types/stream-config'
import { DEFAULT_CIRCUIT_BREAKER_CONFIG } from '../types/stream-config'

/**
 * Circuit breaker states.
 */
export type CircuitState = 'closed' | 'open' | 'half_open'

/**
 * Error thrown when circuit is open and rejecting requests.
 */
export class CircuitOpenError extends Error {
  public readonly resetTimeoutMs: number
  public readonly failures: number

  constructor(message: string, resetTimeoutMs: number, failures: number) {
    super(message)
    this.name = 'CircuitOpenError'
    this.resetTimeoutMs = resetTimeoutMs
    this.failures = failures
  }
}

/**
 * Circuit breaker instance interface.
 */
export interface CircuitBreaker {
  /** Execute an operation through the circuit breaker */
  execute<T>(operation: () => Promise<T>): Promise<T>

  /** Get current circuit state */
  getState(): CircuitState

  /** Get current failure count */
  getFailures(): number

  /** Manually reset the circuit breaker */
  reset(): void

  /** Force the circuit to open (for testing) */
  forceOpen(): void

  /** Check if the circuit will allow a request */
  canPass(): boolean
}

/**
 * Circuit breaker options.
 */
export interface CircuitBreakerOptions extends Partial<CircuitBreakerConfig> {
  /** Called when circuit state changes */
  onStateChange?: (from: CircuitState, to: CircuitState) => void

  /** Called when a failure is recorded */
  onFailure?: (error: Error, failures: number) => void

  /** Called when a success resets the breaker */
  onSuccess?: () => void

  /** Custom failure detection (default: all errors are failures) */
  isFailure?: (error: unknown) => boolean
}

/**
 * Creates a circuit breaker instance.
 */
export function createCircuitBreaker(options: CircuitBreakerOptions = {}): CircuitBreaker {
  const config: CircuitBreakerConfig = {
    ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
    ...options,
  }

  let state: CircuitState = 'closed'
  let failures = 0
  let successes = 0
  let lastFailureTime = 0
  let resetTimeout: ReturnType<typeof setTimeout> | null = null

  const setState = (newState: CircuitState) => {
    if (state !== newState) {
      const oldState = state
      state = newState
      options.onStateChange?.(oldState, newState)
    }
  }

  const recordFailure = (error: Error) => {
    failures++
    lastFailureTime = Date.now()
    options.onFailure?.(error, failures)

    if (failures >= config.failureThreshold) {
      setState('open')
      scheduleHalfOpen()
    }
  }

  const recordSuccess = () => {
    if (state === 'half_open') {
      successes++
      if (successes >= config.successThreshold) {
        reset()
        options.onSuccess?.()
      }
    } else if (state === 'closed') {
      // Reset failure count on success in closed state
      failures = 0
      options.onSuccess?.()
    }
  }

  const scheduleHalfOpen = () => {
    if (resetTimeout) {
      clearTimeout(resetTimeout)
    }

    resetTimeout = setTimeout(() => {
      setState('half_open')
      successes = 0
    }, config.resetTimeoutMs)
  }

  const reset = () => {
    if (resetTimeout) {
      clearTimeout(resetTimeout)
      resetTimeout = null
    }
    failures = 0
    successes = 0
    lastFailureTime = 0
    setState('closed')
  }

  const forceOpen = () => {
    failures = config.failureThreshold
    setState('open')
    scheduleHalfOpen()
  }

  const canPass = (): boolean => {
    switch (state) {
      case 'closed':
        return true
      case 'open':
        return false
      case 'half_open':
        // Only allow limited requests in half-open state
        return true
      default:
        return true
    }
  }

  const execute = async <T>(operation: () => Promise<T>): Promise<T> => {
    if (!canPass()) {
      const timeSinceLastFailure = Date.now() - lastFailureTime
      const remainingTimeout = Math.max(0, config.resetTimeoutMs - timeSinceLastFailure)

      throw new CircuitOpenError(
        `Circuit breaker is open. Retry in ${Math.ceil(remainingTimeout / 1000)}s`,
        remainingTimeout,
        failures
      )
    }

    try {
      const result = await operation()
      recordSuccess()
      return result
    } catch (error) {
      const isFailure = options.isFailure ?? (() => true)

      if (error instanceof Error && isFailure(error)) {
        recordFailure(error)
      }

      throw error
    }
  }

  return {
    execute,
    getState: () => state,
    getFailures: () => failures,
    reset,
    forceOpen,
    canPass,
  }
}

/**
 * Shared circuit breaker registry with TTL-based cleanup.
 * Prevents memory leaks by automatically removing unused breakers.
 */
interface BreakerEntry {
  breaker: CircuitBreaker
  lastAccess: number
  cleanupTimeout: ReturnType<typeof setTimeout> | null
}

const globalBreakers = new Map<string, BreakerEntry>()
const DEFAULT_BREAKER_TTL_MS = 5 * 60 * 1000 // 5 minutes of inactivity

/**
 * Get or create a named circuit breaker.
 * Useful for sharing circuit state across components.
 * Automatically cleans up after TTL of inactivity.
 *
 * @example
 * ```typescript
 * // In component A
 * const breaker = getSharedCircuitBreaker('api-stream')
 *
 * // In component B (same breaker instance)
 * const breaker = getSharedCircuitBreaker('api-stream')
 * ```
 */
export function getSharedCircuitBreaker(
  name: string,
  options?: CircuitBreakerOptions & { ttlMs?: number }
): CircuitBreaker {
  const ttlMs = options?.ttlMs ?? DEFAULT_BREAKER_TTL_MS
  let entry = globalBreakers.get(name)

  if (entry) {
    // Reset TTL on access
    entry.lastAccess = Date.now()
    if (entry.cleanupTimeout) {
      clearTimeout(entry.cleanupTimeout)
    }
    entry.cleanupTimeout = scheduleCleanup(name, ttlMs)
    return entry.breaker
  }

  // Create new breaker
  const breaker = createCircuitBreaker(options)
  entry = {
    breaker,
    lastAccess: Date.now(),
    cleanupTimeout: scheduleCleanup(name, ttlMs),
  }
  globalBreakers.set(name, entry)

  return breaker
}

function scheduleCleanup(name: string, ttlMs: number): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    globalBreakers.delete(name)
  }, ttlMs)
}

/**
 * Reset a shared circuit breaker by name.
 */
export function resetSharedCircuitBreaker(name: string): void {
  const entry = globalBreakers.get(name)
  entry?.breaker.reset()
}

/**
 * Remove a shared circuit breaker immediately.
 */
export function removeSharedCircuitBreaker(name: string): void {
  const entry = globalBreakers.get(name)
  if (entry?.cleanupTimeout) {
    clearTimeout(entry.cleanupTimeout)
  }
  globalBreakers.delete(name)
}

/**
 * Get count of active shared circuit breakers.
 * Useful for debugging/monitoring.
 */
export function getSharedCircuitBreakerCount(): number {
  return globalBreakers.size
}

/**
 * Clear all shared circuit breakers.
 * Useful for testing cleanup.
 */
export function clearAllSharedCircuitBreakers(): void {
  for (const [, entry] of globalBreakers) {
    if (entry.cleanupTimeout) {
      clearTimeout(entry.cleanupTimeout)
    }
  }
  globalBreakers.clear()
}
