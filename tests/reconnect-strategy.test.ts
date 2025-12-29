import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isNetworkError,
  isCancellationError,
  createReconnectionManager,
  withRetry,
  sleep,
} from '../src/client/reconnect-strategy'

describe('isNetworkError', () => {
  it('returns true for network errors', () => {
    expect(isNetworkError(new Error('Network error'))).toBe(true)
    expect(isNetworkError(new Error('Failed to fetch'))).toBe(true)
    expect(isNetworkError(new Error('load failed'))).toBe(true)
    expect(isNetworkError(new Error('ECONNRESET'))).toBe(true)
    expect(isNetworkError(new Error('ECONNREFUSED'))).toBe(true)
    expect(isNetworkError(new Error('timeout'))).toBe(true)
  })

  it('returns false for non-network errors', () => {
    expect(isNetworkError(new Error('Invalid JSON'))).toBe(false)
    expect(isNetworkError(new Error('Not found'))).toBe(false)
    expect(isNetworkError(new Error('Server error 500'))).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isNetworkError('network error')).toBe(false)
    expect(isNetworkError(null)).toBe(false)
    expect(isNetworkError(undefined)).toBe(false)
  })
})

describe('isCancellationError', () => {
  it('returns true for abort errors', () => {
    expect(isCancellationError(new Error('aborted'))).toBe(true)

    const abortError = new Error('Request aborted')
    abortError.name = 'AbortError'
    expect(isCancellationError(abortError)).toBe(true)
  })

  it('returns false for other errors', () => {
    expect(isCancellationError(new Error('Network error'))).toBe(false)
    expect(isCancellationError(new Error('Timeout'))).toBe(false)
  })

  it('returns false for non-Error values', () => {
    expect(isCancellationError('aborted')).toBe(false)
    expect(isCancellationError(null)).toBe(false)
  })
})

describe('sleep', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves after specified duration', async () => {
    const promise = sleep(1000)
    vi.advanceTimersByTime(1000)
    await expect(promise).resolves.toBeUndefined()
  })

  it('rejects immediately if signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(sleep(1000, controller.signal)).rejects.toThrow('Aborted')
  })

  it('rejects when signal is aborted during sleep', async () => {
    const controller = new AbortController()
    const promise = sleep(1000, controller.signal)

    vi.advanceTimersByTime(500)
    controller.abort()

    await expect(promise).rejects.toThrow('Aborted')
  })
})

describe('createReconnectionManager', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('executes operation successfully', async () => {
    const manager = createReconnectionManager({})
    const operation = vi.fn().mockResolvedValue('success')

    const result = await manager.execute(operation)

    expect(result).toBe('success')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('retries on network error', async () => {
    const onReconnecting = vi.fn()
    const onConnected = vi.fn()
    const manager = createReconnectionManager({
      config: { maxRetries: 3, initialDelayMs: 100, jitter: false, backoffMultiplier: 2, maxDelayMs: 10000, jitterFactor: 0 },
      onReconnecting,
      onConnected,
    })

    let attempts = 0
    const operation = vi.fn().mockImplementation(() => {
      attempts++
      if (attempts < 3) {
        return Promise.reject(new Error('Network error'))
      }
      return Promise.resolve('success')
    })

    const resultPromise = manager.execute(operation)

    await vi.runAllTimersAsync()

    const result = await resultPromise

    expect(result).toBe('success')
    expect(operation).toHaveBeenCalledTimes(3)
    expect(onReconnecting).toHaveBeenCalledTimes(2)
    expect(onConnected).toHaveBeenCalled()
  })

  it('fails after max retries', async () => {
    const onFailed = vi.fn()
    const manager = createReconnectionManager({
      config: { maxRetries: 2, initialDelayMs: 100, jitter: false, backoffMultiplier: 2, maxDelayMs: 10000, jitterFactor: 0 },
      onFailed,
    })

    const networkError = new Error('Network error')
    const operation = vi.fn().mockRejectedValue(networkError)

    let caughtError: Error | undefined
    const resultPromise = manager.execute(operation).catch((err) => {
      caughtError = err
    })

    await vi.runAllTimersAsync()
    await resultPromise

    expect(caughtError).toBe(networkError)
    expect(operation).toHaveBeenCalledTimes(3)
    expect(onFailed).toHaveBeenCalled()
  })

  it('does not retry on cancellation', async () => {
    const manager = createReconnectionManager({
      config: { maxRetries: 3 },
    })

    const operation = vi.fn().mockRejectedValue(new Error('aborted'))

    await expect(manager.execute(operation)).rejects.toThrow('aborted')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('does not retry non-network errors', async () => {
    const manager = createReconnectionManager({
      config: { maxRetries: 3 },
    })

    const operation = vi.fn().mockRejectedValue(new Error('Invalid response'))

    await expect(manager.execute(operation)).rejects.toThrow('Invalid response')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('resets state on successful execution', async () => {
    const manager = createReconnectionManager({
      config: { maxRetries: 3, initialDelayMs: 100, jitter: false, backoffMultiplier: 2, maxDelayMs: 10000, jitterFactor: 0 },
    })

    let attempts = 0
    const operation = vi.fn().mockImplementation(() => {
      attempts++
      if (attempts === 1) {
        return Promise.reject(new Error('Network error'))
      }
      return Promise.resolve('success')
    })

    const resultPromise = manager.execute(operation)
    await vi.runAllTimersAsync()
    await resultPromise

    const state = manager.getState()
    expect(state.attempt).toBe(0)
  })
})

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns result on first success', async () => {
    const operation = vi.fn().mockResolvedValue('success')

    const result = await withRetry(operation)

    expect(result).toBe('success')
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('retries and eventually succeeds', async () => {
    let attempts = 0
    const operation = vi.fn().mockImplementation(() => {
      attempts++
      if (attempts < 3) {
        return Promise.reject(new Error('Network error'))
      }
      return Promise.resolve('success')
    })

    const onRetry = vi.fn()
    const resultPromise = withRetry(operation, {
      config: { maxRetries: 3, initialDelayMs: 100, jitter: false, backoffMultiplier: 2, maxDelayMs: 10000, jitterFactor: 0 },
      onRetry,
    })

    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(200)

    const result = await resultPromise

    expect(result).toBe('success')
    expect(onRetry).toHaveBeenCalledTimes(2)
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, 100, expect.any(Error))
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, 200, expect.any(Error))
  })

  it('uses custom shouldRetry function', async () => {
    let attempts = 0
    const operation = vi.fn().mockImplementation(() => {
      attempts++
      if (attempts < 2) {
        return Promise.reject(new Error('custom retryable'))
      }
      return Promise.resolve('success')
    })

    const resultPromise = withRetry(operation, {
      config: { maxRetries: 3, initialDelayMs: 50, jitter: false, backoffMultiplier: 2, maxDelayMs: 10000, jitterFactor: 0 },
      shouldRetry: (err) => err instanceof Error && err.message === 'custom retryable',
    })

    await vi.advanceTimersByTimeAsync(50)

    const result = await resultPromise
    expect(result).toBe('success')
  })

  it('respects abort signal', async () => {
    const controller = new AbortController()
    const operation = vi.fn().mockRejectedValue(new Error('Network error'))

    const resultPromise = withRetry(operation, {
      config: { maxRetries: 3, initialDelayMs: 100, jitter: false, backoffMultiplier: 2, maxDelayMs: 10000, jitterFactor: 0 },
      signal: controller.signal,
    })

    controller.abort()

    await expect(resultPromise).rejects.toThrow()
    expect(operation).toHaveBeenCalledTimes(1)
  })
})
