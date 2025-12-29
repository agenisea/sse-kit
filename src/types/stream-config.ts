/**
 * Stream Configuration Types
 *
 * Configuration options for SSE streaming behavior including
 * retry strategies, timeouts, and circuit breaker settings.
 */

/**
 * Retry strategy configuration with exponential backoff.
 */
export interface RetryConfig {
  /** Maximum number of retry attempts before giving up */
  maxRetries: number

  /** Initial delay in milliseconds before first retry */
  initialDelayMs: number

  /** Maximum delay between retries (caps exponential growth) */
  maxDelayMs: number

  /** Multiplier for exponential backoff (typically 2) */
  backoffMultiplier: number

  /** Whether to add jitter to prevent thundering herd */
  jitter: boolean

  /** Maximum jitter as percentage of delay (0.0 - 1.0) */
  jitterFactor: number
}

/**
 * Heartbeat configuration for keeping connections alive.
 */
export interface HeartbeatConfig {
  /** Interval between heartbeat comments in milliseconds */
  intervalMs: number

  /** Whether heartbeat is enabled */
  enabled: boolean

  /** Custom heartbeat message (comment format) */
  message?: string
}

/**
 * Circuit breaker configuration for failure handling.
 */
export interface CircuitBreakerConfig {
  /** Number of failures before opening the circuit */
  failureThreshold: number

  /** Time in milliseconds before attempting to half-open */
  resetTimeoutMs: number

  /** Number of successful requests to close the circuit from half-open */
  successThreshold: number
}

/**
 * Timeout configuration for stream operations.
 */
export interface TimeoutConfig {
  /** Total request timeout in milliseconds (0 = no timeout) */
  requestMs: number

  /** Idle timeout - max time between data chunks (0 = no idle timeout) */
  idleMs: number
}

/**
 * Complete stream configuration.
 */
export interface StreamConfig {
  retry: RetryConfig
  heartbeat: HeartbeatConfig
  circuitBreaker?: CircuitBreakerConfig
  timeout?: TimeoutConfig
}

/**
 * Default timeout configuration.
 */
export const DEFAULT_TIMEOUT_CONFIG: TimeoutConfig = {
  requestMs: 120000, // 2 minutes total
  idleMs: 30000,     // 30 seconds between chunks
}

/**
 * Default retry configuration following best practices.
 * Uses exponential backoff with jitter to prevent thundering herd.
 */
export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
  jitterFactor: 0.3,
}

/**
 * Default heartbeat configuration.
 * 5-second interval prevents browser/proxy timeouts.
 */
export const DEFAULT_HEARTBEAT_CONFIG: HeartbeatConfig = {
  intervalMs: 5000,
  enabled: true,
  message: 'heartbeat',
}

/**
 * Default circuit breaker configuration.
 */
export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 30000,
  successThreshold: 1,
}

/**
 * Complete default configuration.
 */
export const DEFAULT_STREAM_CONFIG: StreamConfig = {
  retry: DEFAULT_RETRY_CONFIG,
  heartbeat: DEFAULT_HEARTBEAT_CONFIG,
  circuitBreaker: DEFAULT_CIRCUIT_BREAKER_CONFIG,
  timeout: DEFAULT_TIMEOUT_CONFIG,
}

/**
 * Calculate delay with exponential backoff and optional jitter.
 */
export function calculateBackoffDelay(
  attempt: number,
  config: RetryConfig
): number {
  const exponentialDelay = config.initialDelayMs * Math.pow(config.backoffMultiplier, attempt)
  const cappedDelay = Math.min(exponentialDelay, config.maxDelayMs)

  if (config.jitter) {
    const jitterAmount = cappedDelay * config.jitterFactor * Math.random()
    return Math.floor(cappedDelay + jitterAmount)
  }

  return cappedDelay
}
