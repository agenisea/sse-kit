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
    it('sends event: + data: SSE format', async () => {
      const enqueueSpy = vi.spyOn(controller, 'enqueue')

      await orchestrator.sendUpdate('stage', { name: 'parsing', status: 'running' })

      expect(enqueueSpy).toHaveBeenCalled()
      const encoded = enqueueSpy.mock.calls[0][0] as Uint8Array
      const decoded = new TextDecoder().decode(encoded)
      expect(decoded).toBe('event: stage\ndata: {"name":"parsing","status":"running"}\n\n')
    })

    it('skips update when stream is closed', async () => {
      const enqueueSpy = vi.spyOn(controller, 'enqueue')

      await orchestrator.close()
      await orchestrator.sendUpdate('stage', { name: 'test' })

      expect(enqueueSpy).not.toHaveBeenCalled()
    })

    it('handles controller errors gracefully', async () => {
      vi.spyOn(controller, 'enqueue').mockImplementation(() => {
        throw new Error('Controller is already closed')
      })
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

      await orchestrator.sendUpdate('stage', { name: 'test' })

      expect(orchestrator.closed).toBe(true)
      logSpy.mockRestore()
    })
  })

  describe('sendData', () => {
    it('sends data with configured complete event', async () => {
      const enqueueSpy = vi.spyOn(controller, 'enqueue')

      await orchestrator.sendData({ sections: 12, title: 'Report' })

      const encoded = enqueueSpy.mock.calls[0][0] as Uint8Array
      const decoded = new TextDecoder().decode(encoded)
      expect(decoded).toBe('event: complete\ndata: {"sections":12,"title":"Report"}\n\n')
    })

    it('uses custom complete event when configured', async () => {
      const { stream, orchestrator: customOrchestrator } = createStreamingResponse({
        completeEvent: 'done',
      })

      await customOrchestrator.sendData({ result: 'ok' })
      await customOrchestrator.close()

      const reader = stream.getReader()
      const { value } = await reader.read()
      const decoded = new TextDecoder().decode(value)
      expect(decoded).toBe('event: done\ndata: {"result":"ok"}\n\n')
    })
  })

  describe('sendError', () => {
    it('sends error with configured error event', async () => {
      const enqueueSpy = vi.spyOn(controller, 'enqueue')

      await orchestrator.sendError('Something went wrong', { code: 'ERR_001' })

      const encoded = enqueueSpy.mock.calls[0][0] as Uint8Array
      const decoded = new TextDecoder().decode(encoded)
      expect(decoded).toBe('event: error\ndata: {"error":"Something went wrong","code":"ERR_001"}\n\n')
    })

    it('sends error without extra fields', async () => {
      const enqueueSpy = vi.spyOn(controller, 'enqueue')

      await orchestrator.sendError('Failed')

      const encoded = enqueueSpy.mock.calls[0][0] as Uint8Array
      const decoded = new TextDecoder().decode(encoded)
      expect(decoded).toBe('event: error\ndata: {"error":"Failed"}\n\n')
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

      const { orchestrator: observed } = createStreamingResponse({ observer })

      expect(observer.onStreamStart).toHaveBeenCalled()

      await observed.sendUpdate('stage', { name: 'test' })
      expect(observer.onUpdateSent).toHaveBeenCalledWith('stage', expect.any(Number))

      await observed.close()
      expect(observer.onStreamEnd).toHaveBeenCalledWith(
        expect.any(Number),
        true,
        undefined
      )
    })

    it('tracks metrics', async () => {
      await orchestrator.sendUpdate('stage', { name: 'test' })

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

      await orchestrator.sendUpdate('stage', { name: 'test' })
      expect(enqueueSpy).not.toHaveBeenCalled()
    })

    it('aborts stream with AbortSignal', async () => {
      const abortController = new AbortController()
      const onStreamEnd = vi.fn()

      const { orchestrator: testOrchestrator } = createStreamingResponse({
        signal: abortController.signal,
        observer: { onStreamEnd },
      })

      expect(testOrchestrator.closed).toBe(false)
      expect(testOrchestrator.aborted).toBe(false)

      abortController.abort()

      expect(testOrchestrator.closed).toBe(true)
      expect(testOrchestrator.aborted).toBe(true)
      expect(onStreamEnd).toHaveBeenCalledWith(
        expect.any(Number),
        false,
        expect.any(Error)
      )
    })

    it('handles already aborted signal', () => {
      const abortController = new AbortController()
      abortController.abort()

      const { orchestrator: testOrchestrator } = createStreamingResponse({
        signal: abortController.signal,
      })

      expect(testOrchestrator.closed).toBe(true)
      expect(testOrchestrator.aborted).toBe(true)
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

      const { orchestrator: testOrchestrator } = createStreamingResponse({
        observer: { onAbort, onStreamEnd },
      })

      testOrchestrator.abort('User requested cancellation')

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

      createStreamingResponse({
        signal: abortController.signal,
        observer: { onAbort, onStreamEnd },
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
    expect(typeof orchestrator.sendData).toBe('function')
    expect(typeof orchestrator.sendError).toBe('function')
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
