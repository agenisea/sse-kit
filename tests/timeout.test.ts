import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  TimeoutError,
  createTimeoutController,
  createIdleTimeout,
  fetchWithTimeout,
  readStreamWithIdleTimeout,
  isTimeoutError,
  isRequestTimeoutError,
  isIdleTimeoutError,
} from '../src/client/timeout'

describe('TimeoutError', () => {
  it('creates request timeout error', () => {
    const error = new TimeoutError('request', 5000)

    expect(error.message).toBe('Request timeout after 5000ms')
    expect(error.name).toBe('TimeoutError')
    expect(error.type).toBe('request')
    expect(error.timeoutMs).toBe(5000)
  })

  it('creates idle timeout error', () => {
    const error = new TimeoutError('idle', 10000)

    expect(error.message).toBe('Idle timeout: no data received for 10000ms')
    expect(error.type).toBe('idle')
    expect(error.timeoutMs).toBe(10000)
  })
})

describe('createTimeoutController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('creates controller that aborts after timeout', async () => {
    const { controller, clear } = createTimeoutController(1000)

    expect(controller.signal.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)

    expect(controller.signal.aborted).toBe(true)
    expect(controller.signal.reason).toBeInstanceOf(TimeoutError)
    expect(controller.signal.reason.type).toBe('request')

    clear()
  })

  it('can be cleared before timeout', async () => {
    const { controller, clear } = createTimeoutController(1000)

    clear()

    await vi.advanceTimersByTimeAsync(1500)

    expect(controller.signal.aborted).toBe(false)
  })

  it('links to existing signal', () => {
    const existing = new AbortController()
    const { controller, clear } = createTimeoutController(1000, existing.signal)

    existing.abort('user cancelled')

    expect(controller.signal.aborted).toBe(true)
    expect(controller.signal.reason).toBe('user cancelled')

    clear()
  })

  it('aborts immediately if existing signal is already aborted', () => {
    const existing = new AbortController()
    existing.abort('already aborted')

    const { controller, clear } = createTimeoutController(1000, existing.signal)

    expect(controller.signal.aborted).toBe(true)

    clear()
  })
})

describe('createIdleTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls onTimeout after idle period', async () => {
    const onTimeout = vi.fn()
    const idle = createIdleTimeout(1000, onTimeout)

    await vi.advanceTimersByTimeAsync(1000)

    expect(onTimeout).toHaveBeenCalledTimes(1)

    idle.clear()
  })

  it('resets timeout on touch', async () => {
    const onTimeout = vi.fn()
    const idle = createIdleTimeout(1000, onTimeout)

    await vi.advanceTimersByTimeAsync(500)
    idle.touch()

    await vi.advanceTimersByTimeAsync(500)
    expect(onTimeout).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(500)
    expect(onTimeout).toHaveBeenCalledTimes(1)

    idle.clear()
  })

  it('can be cleared', async () => {
    const onTimeout = vi.fn()
    const idle = createIdleTimeout(1000, onTimeout)

    await vi.advanceTimersByTimeAsync(500)
    idle.clear()

    await vi.advanceTimersByTimeAsync(1000)

    expect(onTimeout).not.toHaveBeenCalled()
  })
})

describe('fetchWithTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns response on success', async () => {
    const mockResponse = new Response('ok')
    const fetchFn = vi.fn().mockResolvedValue(mockResponse)

    const result = await fetchWithTimeout(fetchFn, { requestMs: 1000 })

    expect(result).toBe(mockResponse)
    expect(fetchFn).toHaveBeenCalledWith(expect.any(AbortSignal))
  })

  it('aborts on timeout', async () => {
    const fetchFn = vi.fn().mockImplementation(
      () => new Promise((resolve) => setTimeout(resolve, 2000))
    )

    void fetchWithTimeout(fetchFn, { requestMs: 1000 })

    await vi.advanceTimersByTimeAsync(1000)

    const signal = fetchFn.mock.calls[0][0] as AbortSignal
    expect(signal.aborted).toBe(true)
  })

  it('skips timeout when requestMs is 0', async () => {
    const mockResponse = new Response('ok')
    const fetchFn = vi.fn().mockResolvedValue(mockResponse)

    const result = await fetchWithTimeout(fetchFn, { requestMs: 0, idleMs: 0 })

    expect(result).toBe(mockResponse)
  })

  it('respects existing abort signal', async () => {
    const existing = new AbortController()
    existing.abort()

    const fetchFn = vi.fn().mockImplementation((signal: AbortSignal) => {
      if (signal.aborted) {
        return Promise.reject(new Error('aborted'))
      }
      return Promise.resolve(new Response('ok'))
    })

    await expect(
      fetchWithTimeout(fetchFn, { requestMs: 1000 }, existing.signal)
    ).rejects.toThrow()
  })
})

describe('readStreamWithIdleTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads all chunks without timeout', async () => {
    const chunks = [
      new Uint8Array([1, 2]),
      new Uint8Array([3, 4]),
      new Uint8Array([5, 6]),
    ]
    let index = 0

    const reader = {
      read: vi.fn().mockImplementation(async () => {
        if (index < chunks.length) {
          return { done: false, value: chunks[index++] }
        }
        return { done: true, value: undefined }
      }),
      cancel: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>

    const onChunk = vi.fn()

    await readStreamWithIdleTimeout(reader, { idleMs: 0, requestMs: 0 }, onChunk)

    expect(onChunk).toHaveBeenCalledTimes(3)
    expect(onChunk).toHaveBeenNthCalledWith(1, chunks[0])
    expect(onChunk).toHaveBeenNthCalledWith(2, chunks[1])
    expect(onChunk).toHaveBeenNthCalledWith(3, chunks[2])
  })

  it('cancels reader on idle timeout', async () => {
    const reader = {
      read: vi.fn().mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5000))
      ),
      cancel: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>

    const onChunk = vi.fn()
    void readStreamWithIdleTimeout(
      reader,
      { idleMs: 1000, requestMs: 0 },
      onChunk
    )

    await vi.advanceTimersByTimeAsync(1000)

    expect(reader.cancel).toHaveBeenCalledWith(expect.any(TimeoutError))
  })

  it('resets idle timeout on each chunk', async () => {
    const chunks = [new Uint8Array([1]), new Uint8Array([2])]
    let index = 0
    let readResolve: (() => void) | null = null

    const reader = {
      read: vi.fn().mockImplementation(() => {
        return new Promise((resolve) => {
          if (index < chunks.length) {
            readResolve = () => resolve({ done: false, value: chunks[index++] })
          } else {
            resolve({ done: true, value: undefined })
          }
        })
      }),
      cancel: vi.fn(),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>

    const onChunk = vi.fn()
    void readStreamWithIdleTimeout(
      reader,
      { idleMs: 1000, requestMs: 0 },
      onChunk
    )

    await vi.advanceTimersByTimeAsync(500)
    ;(readResolve as (() => void) | null)?.()
    await vi.advanceTimersByTimeAsync(0)

    await vi.advanceTimersByTimeAsync(500)
    ;(readResolve as (() => void) | null)?.()
    await vi.advanceTimersByTimeAsync(0)

    expect(reader.cancel).not.toHaveBeenCalled()
    expect(onChunk).toHaveBeenCalledTimes(2)
  })
})

describe('type guards', () => {
  it('isTimeoutError detects TimeoutError', () => {
    expect(isTimeoutError(new TimeoutError('request', 1000))).toBe(true)
    expect(isTimeoutError(new TimeoutError('idle', 1000))).toBe(true)
    expect(isTimeoutError(new Error('regular error'))).toBe(false)
    expect(isTimeoutError('not an error')).toBe(false)
  })

  it('isRequestTimeoutError detects request timeout', () => {
    expect(isRequestTimeoutError(new TimeoutError('request', 1000))).toBe(true)
    expect(isRequestTimeoutError(new TimeoutError('idle', 1000))).toBe(false)
    expect(isRequestTimeoutError(new Error('regular error'))).toBe(false)
  })

  it('isIdleTimeoutError detects idle timeout', () => {
    expect(isIdleTimeoutError(new TimeoutError('idle', 1000))).toBe(true)
    expect(isIdleTimeoutError(new TimeoutError('request', 1000))).toBe(false)
    expect(isIdleTimeoutError(new Error('regular error'))).toBe(false)
  })
})
