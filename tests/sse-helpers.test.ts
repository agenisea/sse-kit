import { describe, it, expect, vi } from 'vitest'
import {
  formatSSEMessage,
  sseStart,
  sseDelta,
  sseDone,
  sseError,
  sseProgress,
  sseHeartbeat,
  sseData,
  sseEvent,
  sseRetry,
  createSSEEncoder,
} from '../src/server/sse-helpers'

describe('formatSSEMessage', () => {
  it('formats simple data message', () => {
    const result = formatSSEMessage({ data: { test: true } })
    expect(result).toBe('data: {"test":true}\n\n')
  })

  it('formats message with event type', () => {
    const result = formatSSEMessage({ event: 'custom', data: { test: true } })
    expect(result).toBe('event: custom\ndata: {"test":true}\n\n')
  })

  it('formats message with id', () => {
    const result = formatSSEMessage({ id: '123', data: { test: true } })
    expect(result).toBe('id: 123\ndata: {"test":true}\n\n')
  })

  it('formats message with retry', () => {
    const result = formatSSEMessage({ retry: 5000, data: { test: true } })
    expect(result).toBe('retry: 5000\ndata: {"test":true}\n\n')
  })

  it('formats message with all fields', () => {
    const result = formatSSEMessage({
      id: '123',
      retry: 5000,
      event: 'custom',
      data: { test: true },
    })
    expect(result).toBe('id: 123\nretry: 5000\nevent: custom\ndata: {"test":true}\n\n')
  })
})

describe('SSE helper functions', () => {
  let controller: ReadableStreamDefaultController<Uint8Array>
  let encoder: TextEncoder
  let chunks: string[]

  function setup() {
    encoder = new TextEncoder()
    chunks = []
    controller = {
      enqueue: vi.fn((data: Uint8Array) => {
        chunks.push(new TextDecoder().decode(data))
      }),
    } as unknown as ReadableStreamDefaultController<Uint8Array>
  }

  describe('sseStart', () => {
    it('sends start event', () => {
      setup()
      sseStart(controller, encoder)
      expect(chunks[0]).toBe('event: start\ndata: {}\n\n')
    })

    it('sends start event with metadata', () => {
      setup()
      sseStart(controller, encoder, { version: '1.0' })
      expect(chunks[0]).toBe('event: start\ndata: {"version":"1.0"}\n\n')
    })

    it('sends start event with id', () => {
      setup()
      sseStart(controller, encoder, {}, { id: '0' })
      expect(chunks[0]).toBe('id: 0\nevent: start\ndata: {}\n\n')
    })
  })

  describe('sseDelta', () => {
    it('sends delta event with text', () => {
      setup()
      sseDelta(controller, encoder, 'Hello')
      expect(chunks[0]).toBe('event: delta\ndata: {"text":"Hello"}\n\n')
    })

    it('sends delta event with id for reconnection', () => {
      setup()
      sseDelta(controller, encoder, 'Hello', { id: '42' })
      expect(chunks[0]).toBe('id: 42\nevent: delta\ndata: {"text":"Hello"}\n\n')
    })
  })

  describe('sseDone', () => {
    it('sends done event with payload', () => {
      setup()
      sseDone(controller, encoder, { success: true, count: 42 })
      expect(chunks[0]).toBe('event: done\ndata: {"success":true,"count":42}\n\n')
    })
  })

  describe('sseError', () => {
    it('sends error event with message', () => {
      setup()
      sseError(controller, encoder, 'Something went wrong')
      expect(chunks[0]).toBe('event: error\ndata: {"error":"Something went wrong"}\n\n')
    })

    it('sends error event with Error object', () => {
      setup()
      sseError(controller, encoder, new Error('Test error'))
      expect(chunks[0]).toBe('event: error\ndata: {"error":"Test error"}\n\n')
    })

    it('sends error event with extra data', () => {
      setup()
      sseError(controller, encoder, 'Error', { code: 'ERR_001', retryable: true })
      expect(chunks[0]).toBe('event: error\ndata: {"error":"Error","code":"ERR_001","retryable":true}\n\n')
    })
  })

  describe('sseProgress', () => {
    it('sends progress event', () => {
      setup()
      sseProgress(controller, encoder, 'processing')
      expect(chunks[0]).toBe('event: progress\ndata: {"phase":"processing"}\n\n')
    })

    it('sends progress event with message', () => {
      setup()
      sseProgress(controller, encoder, 'processing', 'Step 1 of 3')
      expect(chunks[0]).toBe('event: progress\ndata: {"phase":"processing","message":"Step 1 of 3"}\n\n')
    })
  })

  describe('sseHeartbeat', () => {
    it('sends heartbeat comment', () => {
      setup()
      sseHeartbeat(controller, encoder)
      expect(chunks[0]).toBe(': [heartbeat]\n\n')
    })

    it('sends custom heartbeat message', () => {
      setup()
      sseHeartbeat(controller, encoder, 'keep-alive')
      expect(chunks[0]).toBe(': [keep-alive]\n\n')
    })
  })

  describe('sseData', () => {
    it('sends raw data without event type', () => {
      setup()
      sseData(controller, encoder, { key: 'value' })
      expect(chunks[0]).toBe('data: {"key":"value"}\n\n')
    })

    it('sends data with id', () => {
      setup()
      sseData(controller, encoder, { key: 'value' }, { id: '99' })
      expect(chunks[0]).toBe('id: 99\ndata: {"key":"value"}\n\n')
    })
  })

  describe('sseEvent', () => {
    it('sends custom event type', () => {
      setup()
      sseEvent(controller, encoder, 'custom-type', { foo: 'bar' })
      expect(chunks[0]).toBe('event: custom-type\ndata: {"foo":"bar"}\n\n')
    })
  })

  describe('sseRetry', () => {
    it('sends retry field', () => {
      setup()
      sseRetry(controller, encoder, 3000)
      expect(chunks[0]).toBe('retry: 3000\n\n')
    })
  })
})

describe('createSSEEncoder', () => {
  it('creates encoder with bound controller', () => {
    const chunks: string[] = []
    const controller = {
      enqueue: vi.fn((data: Uint8Array) => {
        chunks.push(new TextDecoder().decode(data))
      }),
    } as unknown as ReadableStreamDefaultController<Uint8Array>

    const sse = createSSEEncoder(controller)

    sse.start()
    sse.delta('Hello')
    sse.done({ complete: true })

    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toBe('event: start\ndata: {}\n\n')
    expect(chunks[1]).toBe('event: delta\ndata: {"text":"Hello"}\n\n')
    expect(chunks[2]).toBe('event: done\ndata: {"complete":true}\n\n')
  })

  it('supports all methods', () => {
    const chunks: string[] = []
    const controller = {
      enqueue: vi.fn((data: Uint8Array) => {
        chunks.push(new TextDecoder().decode(data))
      }),
    } as unknown as ReadableStreamDefaultController<Uint8Array>

    const sse = createSSEEncoder(controller)

    sse.start({ version: '1' })
    sse.delta('Hi', { id: '1' })
    sse.progress('processing', 'Working')
    sse.error('Oops')
    sse.heartbeat()
    sse.data({ raw: true })
    sse.event('custom', { value: 42 })
    sse.retry(5000)
    sse.done({ ok: true })

    expect(chunks).toHaveLength(9)
  })

  it('format method returns string without sending', () => {
    const controller = {
      enqueue: vi.fn(),
    } as unknown as ReadableStreamDefaultController<Uint8Array>

    const sse = createSSEEncoder(controller)
    const formatted = sse.format({ event: 'test', data: { x: 1 } })

    expect(formatted).toBe('event: test\ndata: {"x":1}\n\n')
    expect(controller.enqueue).not.toHaveBeenCalled()
  })
})
