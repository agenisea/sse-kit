import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  StreamOrchestrator,
  createStreamingResponse,
  createSSEResponse,
  SSE_HEADERS,
  type StreamObserver,
} from '../src/server/stream-orchestrator'

describe('StreamOrchestrator', () => {
  let controller: ReadableStreamDefaultController<Uint8Array>
  let orchestrator: StreamOrchestrator

  beforeEach(() => {
    vi.useFakeTimers()
    new ReadableStream<Uint8Array>({
      start(ctrl) {
        controller = ctrl
      },
    })
    orchestrator = new StreamOrchestrator(controller)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('sendUpdate', () => {
    it('sends JSON-formatted SSE data', async () => {
      const enqueueSpy = vi.spyOn(controller, 'enqueue')

      await orchestrator.sendUpdate({ phase: 'test', message: 'Hello' })

      expect(enqueueSpy).toHaveBeenCalled()
      const encoded = enqueueSpy.mock.calls[0][0] as Uint8Array
      const decoded = new TextDecoder().decode(encoded)
      expect(decoded).toBe('data: {"phase":"test","message":"Hello"}\n\n')
    })

    it('skips update when stream is closed', async () => {
      const enqueueSpy = vi.spyOn(controller, 'enqueue')

      await orchestrator.close()
      await orchestrator.sendUpdate({ phase: 'test' })

      expect(enqueueSpy).not.toHaveBeenCalled()
    })

    it('handles controller errors gracefully', async () => {
      vi.spyOn(controller, 'enqueue').mockImplementation(() => {
        throw new Error('Controller is already closed')
      })
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await orchestrator.sendUpdate({ phase: 'test' })

      expect(orchestrator.closed).toBe(true)
      logSpy.mockRestore()
    })
  })

  describe('sendProgress', () => {
    it('sends progress update with phase', async () => {
      const enqueueSpy = vi.spyOn(controller, 'enqueue')

      await orchestrator.sendProgress('processing', 'Working...')

      const encoded = enqueueSpy.mock.calls[0][0] as Uint8Array
      const decoded = new TextDecoder().decode(encoded)
      expect(decoded).toContain('"phase":"processing"')
      expect(decoded).toContain('"message":"Working..."')
    })
  })

  describe('sendResult', () => {
    it('sends result with complete phase', async () => {
      const enqueueSpy = vi.spyOn(controller, 'enqueue')

      await orchestrator.sendResult({ data: 'success' })

      const encoded = enqueueSpy.mock.calls[0][0] as Uint8Array
      const decoded = new TextDecoder().decode(encoded)
      expect(decoded).toContain('"phase":"complete"')
      expect(decoded).toContain('"result":{"data":"success"}')
    })
  })

  describe('sendError', () => {
    it('sends error update', async () => {
      const enqueueSpy = vi.spyOn(controller, 'enqueue')

      await orchestrator.sendError('Something went wrong', { code: 'ERR_001' })

      const encoded = enqueueSpy.mock.calls[0][0] as Uint8Array
      const decoded = new TextDecoder().decode(encoded)
      expect(decoded).toContain('"phase":"error"')
      expect(decoded).toContain('"error":"Something went wrong"')
      expect(decoded).toContain('"code":"ERR_001"')
    })
  })

  describe('sendEvent', () => {
    it('sends typed SSE event', async () => {
      const enqueueSpy = vi.spyOn(controller, 'enqueue')

      await orchestrator.sendEvent('custom', { value: 42 })

      const encoded = enqueueSpy.mock.calls[0][0] as Uint8Array
      const decoded = new TextDecoder().decode(encoded)
      expect(decoded).toBe('event: custom\ndata: {"value":42}\n\n')
    })
  })

  describe('heartbeat', () => {
    it('sends heartbeat at configured interval', async () => {
      const enqueueSpy = vi.spyOn(controller, 'enqueue')

      orchestrator.startHeartbeat()

      await vi.advanceTimersByTimeAsync(5000)
      expect(enqueueSpy).toHaveBeenCalled()

      const encoded = enqueueSpy.mock.calls[0][0] as Uint8Array
      const decoded = new TextDecoder().decode(encoded)
      expect(decoded).toBe(': [heartbeat]\n\n')

      orchestrator.stopHeartbeat()
    })

    it('stops heartbeat when stream closes', async () => {
      const enqueueSpy = vi.spyOn(controller, 'enqueue')

      orchestrator.startHeartbeat()
      await orchestrator.close()

      await vi.advanceTimersByTimeAsync(10000)
      expect(enqueueSpy).not.toHaveBeenCalled()
    })

    it('does not start multiple heartbeats', () => {
      orchestrator.startHeartbeat()
      orchestrator.startHeartbeat()

      orchestrator.stopHeartbeat()
    })
  })

  describe('observability', () => {
    it('calls observer hooks', async () => {
      const observer: StreamObserver = {
        onStreamStart: vi.fn(),
        onStreamEnd: vi.fn(),
        onUpdateSent: vi.fn(),
        onHeartbeat: vi.fn(),
        onError: vi.fn(),
      }

      new ReadableStream<Uint8Array>({
        start(ctrl) {
          const obs = new StreamOrchestrator(ctrl, { observer })

          expect(observer.onStreamStart).toHaveBeenCalled()

          obs.sendUpdate({ phase: 'test' }).then(() => {
            expect(observer.onUpdateSent).toHaveBeenCalledWith('test', expect.any(Number))

            obs.close().then(() => {
              expect(observer.onStreamEnd).toHaveBeenCalledWith(
                expect.any(Number),
                true,
                undefined
              )
            })
          })
        },
      })
    })

    it('tracks metrics', async () => {
      await orchestrator.sendUpdate({ phase: 'test' })

      const metrics = orchestrator.getMetrics()
      expect(metrics.bytesSent).toBeGreaterThan(0)
      expect(metrics.durationMs).toBeGreaterThanOrEqual(0)
      expect(metrics.closed).toBe(false)
      expect(metrics.aborted).toBe(false)
    })
  })

  describe('abort', () => {
    it('aborts stream programmatically', async () => {
      const enqueueSpy = vi.spyOn(controller, 'enqueue')

      orchestrator.abort('User cancelled')

      expect(orchestrator.closed).toBe(true)
      expect(orchestrator.aborted).toBe(true)

      await orchestrator.sendUpdate({ phase: 'test' })
      expect(enqueueSpy).not.toHaveBeenCalled()
    })

    it('aborts stream with AbortSignal', async () => {
      const abortController = new AbortController()
      const onStreamEnd = vi.fn()

      let testOrchestrator: StreamOrchestrator
      new ReadableStream<Uint8Array>({
        start(ctrl) {
          testOrchestrator = new StreamOrchestrator(ctrl, {
            signal: abortController.signal,
            observer: { onStreamEnd },
          })
        },
      })

      expect(testOrchestrator!.closed).toBe(false)
      expect(testOrchestrator!.aborted).toBe(false)

      abortController.abort()

      expect(testOrchestrator!.closed).toBe(true)
      expect(testOrchestrator!.aborted).toBe(true)
      expect(onStreamEnd).toHaveBeenCalledWith(
        expect.any(Number),
        false,
        expect.any(Error)
      )
    })

    it('handles already aborted signal', () => {
      const abortController = new AbortController()
      abortController.abort()

      let testOrchestrator: StreamOrchestrator
      new ReadableStream<Uint8Array>({
        start(ctrl) {
          testOrchestrator = new StreamOrchestrator(ctrl, {
            signal: abortController.signal,
          })
        },
      })

      expect(testOrchestrator!.closed).toBe(true)
      expect(testOrchestrator!.aborted).toBe(true)
    })

    it('stops heartbeat on abort', async () => {
      const abortController = new AbortController()
      const enqueueSpy = vi.spyOn(controller, 'enqueue')

      const abortOrchestrator = new StreamOrchestrator(controller, {
        signal: abortController.signal,
      })
      abortOrchestrator.startHeartbeat()

      abortController.abort()

      await vi.advanceTimersByTimeAsync(10000)
      expect(enqueueSpy).not.toHaveBeenCalled()
    })

    it('includes aborted in metrics', () => {
      orchestrator.abort()

      const metrics = orchestrator.getMetrics()
      expect(metrics.closed).toBe(true)
      expect(metrics.aborted).toBe(true)
    })

    it('calls onAbort callback with reason on programmatic abort', () => {
      const onAbort = vi.fn()
      const onStreamEnd = vi.fn()

      let testOrchestrator: StreamOrchestrator
      new ReadableStream<Uint8Array>({
        start(ctrl) {
          testOrchestrator = new StreamOrchestrator(ctrl, {
            observer: { onAbort, onStreamEnd },
          })
        },
      })

      testOrchestrator!.abort('User requested cancellation')

      expect(onAbort).toHaveBeenCalledWith('User requested cancellation')
      expect(onStreamEnd).toHaveBeenCalledWith(
        expect.any(Number),
        false,
        expect.any(Error)
      )
    })

    it('calls onAbort callback when AbortSignal fires', () => {
      const abortController = new AbortController()
      const onAbort = vi.fn()
      const onStreamEnd = vi.fn()

      new ReadableStream<Uint8Array>({
        start(ctrl) {
          new StreamOrchestrator(ctrl, {
            signal: abortController.signal,
            observer: { onAbort, onStreamEnd },
          })
        },
      })

      abortController.abort()

      expect(onAbort).toHaveBeenCalledWith('Stream aborted')
      expect(onStreamEnd).toHaveBeenCalledWith(
        expect.any(Number),
        false,
        expect.any(Error)
      )
    })
  })
})

describe('createStreamingResponse', () => {
  it('returns stream and orchestrator', () => {
    const { stream, orchestrator } = createStreamingResponse()

    expect(stream).toBeInstanceOf(ReadableStream)
    expect(orchestrator).toBeDefined()
    expect(typeof orchestrator.sendUpdate).toBe('function')
  })

  it('accepts configuration', () => {
    const onStart = vi.fn()
    createStreamingResponse({
      observer: { onStreamStart: onStart },
    })

    expect(onStart).toHaveBeenCalled()
  })
})

describe('createSSEResponse', () => {
  it('creates Response with SSE headers', () => {
    const stream = new ReadableStream()
    const response = createSSEResponse(stream)

    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
    expect(response.headers.get('Cache-Control')).toBe('no-cache')
    expect(response.headers.get('Connection')).toBe('keep-alive')
    expect(response.headers.get('X-Accel-Buffering')).toBe('no')
  })

  it('merges additional headers', () => {
    const stream = new ReadableStream()
    const response = createSSEResponse(stream, { 'X-Custom': 'value' })

    expect(response.headers.get('X-Custom')).toBe('value')
    expect(response.headers.get('Content-Type')).toBe('text/event-stream')
  })
})

describe('SSE_HEADERS', () => {
  it('contains required SSE headers', () => {
    expect(SSE_HEADERS['Content-Type']).toBe('text/event-stream')
    expect(SSE_HEADERS['Cache-Control']).toBe('no-cache')
    expect(SSE_HEADERS['Connection']).toBe('keep-alive')
    expect(SSE_HEADERS['X-Accel-Buffering']).toBe('no')
  })
})
