import { describe, it, expect } from 'vitest'
import {
  calculateBackoffDelay,
  DEFAULT_RETRY_CONFIG,
  DEFAULT_HEARTBEAT_CONFIG,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  DEFAULT_TIMEOUT_CONFIG,
  DEFAULT_STREAM_CONFIG,
} from '../src/types/stream-config'

describe('calculateBackoffDelay', () => {
  it('calculates exponential delay', () => {
    const config = {
      ...DEFAULT_RETRY_CONFIG,
      jitter: false,
    }

    expect(calculateBackoffDelay(0, config)).toBe(1000)
    expect(calculateBackoffDelay(1, config)).toBe(2000)
    expect(calculateBackoffDelay(2, config)).toBe(4000)
    expect(calculateBackoffDelay(3, config)).toBe(8000)
  })

  it('caps at maxDelayMs', () => {
    const config = {
      ...DEFAULT_RETRY_CONFIG,
      jitter: false,
      maxDelayMs: 5000,
    }

    expect(calculateBackoffDelay(0, config)).toBe(1000)
    expect(calculateBackoffDelay(1, config)).toBe(2000)
    expect(calculateBackoffDelay(2, config)).toBe(4000)
    expect(calculateBackoffDelay(3, config)).toBe(5000)
    expect(calculateBackoffDelay(10, config)).toBe(5000)
  })

  it('adds jitter when enabled', () => {
    const config = {
      ...DEFAULT_RETRY_CONFIG,
      jitter: true,
      jitterFactor: 0.3,
    }

    const delays = Array.from({ length: 100 }, () => calculateBackoffDelay(0, config))
    const uniqueDelays = new Set(delays)

    expect(uniqueDelays.size).toBeGreaterThan(1)

    const min = Math.min(...delays)
    const max = Math.max(...delays)

    expect(min).toBeGreaterThanOrEqual(1000)
    expect(max).toBeLessThanOrEqual(1300)
  })

  it('respects custom backoff multiplier', () => {
    const config = {
      ...DEFAULT_RETRY_CONFIG,
      jitter: false,
      backoffMultiplier: 3,
    }

    expect(calculateBackoffDelay(0, config)).toBe(1000)
    expect(calculateBackoffDelay(1, config)).toBe(3000)
    expect(calculateBackoffDelay(2, config)).toBe(9000)
  })
})

describe('default configurations', () => {
  it('has sensible retry defaults', () => {
    expect(DEFAULT_RETRY_CONFIG.maxRetries).toBe(3)
    expect(DEFAULT_RETRY_CONFIG.initialDelayMs).toBe(1000)
    expect(DEFAULT_RETRY_CONFIG.maxDelayMs).toBe(30000)
    expect(DEFAULT_RETRY_CONFIG.backoffMultiplier).toBe(2)
    expect(DEFAULT_RETRY_CONFIG.jitter).toBe(true)
    expect(DEFAULT_RETRY_CONFIG.jitterFactor).toBe(0.3)
  })

  it('has sensible heartbeat defaults', () => {
    expect(DEFAULT_HEARTBEAT_CONFIG.intervalMs).toBe(5000)
    expect(DEFAULT_HEARTBEAT_CONFIG.enabled).toBe(true)
    expect(DEFAULT_HEARTBEAT_CONFIG.message).toBe('heartbeat')
  })

  it('has sensible circuit breaker defaults', () => {
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.failureThreshold).toBe(3)
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.resetTimeoutMs).toBe(30000)
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.successThreshold).toBe(1)
  })

  it('has sensible timeout defaults', () => {
    expect(DEFAULT_TIMEOUT_CONFIG.requestMs).toBe(120000)
    expect(DEFAULT_TIMEOUT_CONFIG.idleMs).toBe(30000)
  })

  it('aggregates all configs in DEFAULT_STREAM_CONFIG', () => {
    expect(DEFAULT_STREAM_CONFIG.retry).toEqual(DEFAULT_RETRY_CONFIG)
    expect(DEFAULT_STREAM_CONFIG.heartbeat).toEqual(DEFAULT_HEARTBEAT_CONFIG)
    expect(DEFAULT_STREAM_CONFIG.circuitBreaker).toEqual(DEFAULT_CIRCUIT_BREAKER_CONFIG)
    expect(DEFAULT_STREAM_CONFIG.timeout).toEqual(DEFAULT_TIMEOUT_CONFIG)
  })
})
