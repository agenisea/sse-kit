import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  createCircuitBreaker,
  getSharedCircuitBreaker,
  resetSharedCircuitBreaker,
  removeSharedCircuitBreaker,
  getSharedCircuitBreakerCount,
  clearAllSharedCircuitBreakers,
  CircuitOpenError,
} from '../src/client/circuit-breaker'

describe('createCircuitBreaker', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('starts in closed state', () => {
    const breaker = createCircuitBreaker()

    expect(breaker.getState()).toBe('closed')
    expect(breaker.getFailures()).toBe(0)
    expect(breaker.canPass()).toBe(true)
  })

  it('executes operation successfully', async () => {
    const breaker = createCircuitBreaker()
    const operation = vi.fn().mockResolvedValue('success')

    const result = await breaker.execute(operation)

    expect(result).toBe('success')
    expect(breaker.getState()).toBe('closed')
  })

  it('records failures and opens circuit', async () => {
    const onStateChange = vi.fn()
    const onFailure = vi.fn()
    const breaker = createCircuitBreaker({
      failureThreshold: 3,
      onStateChange,
      onFailure,
    })

    const operation = vi.fn().mockRejectedValue(new Error('fail'))

    await expect(breaker.execute(operation)).rejects.toThrow('fail')
    await expect(breaker.execute(operation)).rejects.toThrow('fail')
    await expect(breaker.execute(operation)).rejects.toThrow('fail')

    expect(breaker.getState()).toBe('open')
    expect(breaker.getFailures()).toBe(3)
    expect(onStateChange).toHaveBeenCalledWith('closed', 'open')
    expect(onFailure).toHaveBeenCalledTimes(3)
  })

  it('throws CircuitOpenError when open', async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 1 })

    await expect(
      breaker.execute(() => Promise.reject(new Error('fail')))
    ).rejects.toThrow('fail')

    await expect(
      breaker.execute(() => Promise.resolve('success'))
    ).rejects.toThrow(CircuitOpenError)

    expect(breaker.canPass()).toBe(false)
  })

  it('transitions to half-open after reset timeout', async () => {
    const onStateChange = vi.fn()
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      onStateChange,
    })

    await expect(
      breaker.execute(() => Promise.reject(new Error('fail')))
    ).rejects.toThrow()

    expect(breaker.getState()).toBe('open')

    await vi.advanceTimersByTimeAsync(1000)

    expect(breaker.getState()).toBe('half_open')
    expect(onStateChange).toHaveBeenCalledWith('open', 'half_open')
  })

  it('closes circuit on success in half-open state', async () => {
    const onSuccess = vi.fn()
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1000,
      successThreshold: 1,
      onSuccess,
    })

    await expect(
      breaker.execute(() => Promise.reject(new Error('fail')))
    ).rejects.toThrow()

    await vi.advanceTimersByTimeAsync(1000)
    expect(breaker.getState()).toBe('half_open')

    await breaker.execute(() => Promise.resolve('success'))

    expect(breaker.getState()).toBe('closed')
    expect(breaker.getFailures()).toBe(0)
    expect(onSuccess).toHaveBeenCalled()
  })

  it('reopens circuit on failure in half-open state', async () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      resetTimeoutMs: 1000,
    })

    await expect(
      breaker.execute(() => Promise.reject(new Error('fail')))
    ).rejects.toThrow()

    await vi.advanceTimersByTimeAsync(1000)
    expect(breaker.getState()).toBe('half_open')

    await expect(
      breaker.execute(() => Promise.reject(new Error('fail again')))
    ).rejects.toThrow()

    expect(breaker.getState()).toBe('open')
  })

  it('resets failure count on success in closed state', async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 3 })

    await expect(
      breaker.execute(() => Promise.reject(new Error('fail')))
    ).rejects.toThrow()
    expect(breaker.getFailures()).toBe(1)

    await breaker.execute(() => Promise.resolve('success'))
    expect(breaker.getFailures()).toBe(0)
  })

  it('supports custom failure detection', async () => {
    const breaker = createCircuitBreaker({
      failureThreshold: 1,
      isFailure: (err) => err instanceof Error && err.message !== 'ignore',
    })

    await expect(
      breaker.execute(() => Promise.reject(new Error('ignore')))
    ).rejects.toThrow()

    expect(breaker.getState()).toBe('closed')

    await expect(
      breaker.execute(() => Promise.reject(new Error('count this')))
    ).rejects.toThrow()

    expect(breaker.getState()).toBe('open')
  })

  it('can be manually reset', async () => {
    const breaker = createCircuitBreaker({ failureThreshold: 1 })

    await expect(
      breaker.execute(() => Promise.reject(new Error('fail')))
    ).rejects.toThrow()
    expect(breaker.getState()).toBe('open')

    breaker.reset()

    expect(breaker.getState()).toBe('closed')
    expect(breaker.getFailures()).toBe(0)
    expect(breaker.canPass()).toBe(true)
  })

  it('can be force opened', () => {
    const breaker = createCircuitBreaker({ failureThreshold: 3 })

    breaker.forceOpen()

    expect(breaker.getState()).toBe('open')
    expect(breaker.canPass()).toBe(false)
  })
})

describe('CircuitOpenError', () => {
  it('contains timeout and failure info', () => {
    const error = new CircuitOpenError('Circuit open', 5000, 3)

    expect(error.message).toBe('Circuit open')
    expect(error.name).toBe('CircuitOpenError')
    expect(error.resetTimeoutMs).toBe(5000)
    expect(error.failures).toBe(3)
  })
})

describe('shared circuit breakers', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearAllSharedCircuitBreakers()
  })

  afterEach(() => {
    clearAllSharedCircuitBreakers()
    vi.useRealTimers()
  })

  it('returns same breaker for same name', () => {
    const breaker1 = getSharedCircuitBreaker('test')
    const breaker2 = getSharedCircuitBreaker('test')

    expect(breaker1).toBe(breaker2)
    expect(getSharedCircuitBreakerCount()).toBe(1)
  })

  it('returns different breakers for different names', () => {
    const breaker1 = getSharedCircuitBreaker('test1')
    const breaker2 = getSharedCircuitBreaker('test2')

    expect(breaker1).not.toBe(breaker2)
    expect(getSharedCircuitBreakerCount()).toBe(2)
  })

  it('resets shared breaker', async () => {
    const breaker = getSharedCircuitBreaker('test', { failureThreshold: 1 })

    await expect(
      breaker.execute(() => Promise.reject(new Error('fail')))
    ).rejects.toThrow()
    expect(breaker.getState()).toBe('open')

    resetSharedCircuitBreaker('test')

    expect(breaker.getState()).toBe('closed')
  })

  it('removes shared breaker', () => {
    getSharedCircuitBreaker('test')
    expect(getSharedCircuitBreakerCount()).toBe(1)

    removeSharedCircuitBreaker('test')

    expect(getSharedCircuitBreakerCount()).toBe(0)
  })

  it('cleans up after TTL', async () => {
    getSharedCircuitBreaker('test', { ttlMs: 1000 })
    expect(getSharedCircuitBreakerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(1000)

    expect(getSharedCircuitBreakerCount()).toBe(0)
  })

  it('resets TTL on access', async () => {
    getSharedCircuitBreaker('test', { ttlMs: 1000 })

    await vi.advanceTimersByTimeAsync(500)
    getSharedCircuitBreaker('test', { ttlMs: 1000 })

    await vi.advanceTimersByTimeAsync(500)
    expect(getSharedCircuitBreakerCount()).toBe(1)

    await vi.advanceTimersByTimeAsync(500)
    expect(getSharedCircuitBreakerCount()).toBe(0)
  })

  it('clears all shared breakers', () => {
    getSharedCircuitBreaker('test1')
    getSharedCircuitBreaker('test2')
    getSharedCircuitBreaker('test3')
    expect(getSharedCircuitBreakerCount()).toBe(3)

    clearAllSharedCircuitBreakers()

    expect(getSharedCircuitBreakerCount()).toBe(0)
  })
})
