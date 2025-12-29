import { describe, it, expect, vi } from 'vitest'
import {
  createSSEParser,
  parseSSEStream,
  SSEStreamError,
  StreamCancelledError,
} from '../src/client/sse-parser'

describe('createSSEParser', () => {
  it('parses single complete message', () => {
    const onMessage = vi.fn()
    const parser = createSSEParser({ onMessage })

    parser('data: {"phase":"test"}\n\n')

    expect(onMessage).toHaveBeenCalledWith({ phase: 'test' })
  })

  it('parses multiple messages in one chunk', () => {
    const onMessage = vi.fn()
    const parser = createSSEParser({ onMessage })

    parser('data: {"phase":"first"}\n\ndata: {"phase":"second"}\n\n')

    expect(onMessage).toHaveBeenCalledTimes(2)
    expect(onMessage).toHaveBeenNthCalledWith(1, { phase: 'first' })
    expect(onMessage).toHaveBeenNthCalledWith(2, { phase: 'second' })
  })

  it('handles chunked messages across multiple calls', () => {
    const onMessage = vi.fn()
    const parser = createSSEParser({ onMessage })

    parser('data: {"pha')
    expect(onMessage).not.toHaveBeenCalled()

    parser('se":"test"}\n\n')
    expect(onMessage).toHaveBeenCalledWith({ phase: 'test' })
  })

  it('skips SSE comments (heartbeats)', () => {
    const onMessage = vi.fn()
    const parser = createSSEParser({ onMessage })

    parser(': [heartbeat]\n\ndata: {"phase":"test"}\n\n')

    expect(onMessage).toHaveBeenCalledTimes(1)
    expect(onMessage).toHaveBeenCalledWith({ phase: 'test' })
  })

  it('handles JSON parse errors gracefully', () => {
    const onMessage = vi.fn()
    const onError = vi.fn()
    const parser = createSSEParser({ onMessage, onError })

    parser('data: not valid json\n\n')

    expect(onMessage).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.stringContaining('not valid json')
    )
  })

  it('skips empty messages', () => {
    const onMessage = vi.fn()
    const parser = createSSEParser({ onMessage })

    parser('\n\ndata: {"phase":"test"}\n\n\n\n')

    expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it('handles complex nested JSON', () => {
    const onMessage = vi.fn()
    const parser = createSSEParser({ onMessage })

    const complexData = {
      phase: 'complete',
      result: {
        items: [1, 2, 3],
        nested: { key: 'value' },
      },
    }

    parser(`data: ${JSON.stringify(complexData)}\n\n`)

    expect(onMessage).toHaveBeenCalledWith(complexData)
  })
})

describe('parseSSEStream', () => {
  function createMockResponse(chunks: string[]): Response {
    const encoder = new TextEncoder()
    let chunkIndex = 0

    const stream = new ReadableStream({
      pull(controller) {
        if (chunkIndex < chunks.length) {
          controller.enqueue(encoder.encode(chunks[chunkIndex]))
          chunkIndex++
        } else {
          controller.close()
        }
      },
    })

    return new Response(stream)
  }

  it('calls onStart for start events', async () => {
    const response = createMockResponse(['event: start\ndata: {"ready":true}\n\n'])
    const handlers = { onStart: vi.fn() }

    await parseSSEStream(response, handlers)

    expect(handlers.onStart).toHaveBeenCalledWith({ ready: true })
  })

  it('calls onDelta for delta events', async () => {
    const response = createMockResponse([
      'event: delta\ndata: {"text":"Hello"}\n\n',
      'event: delta\ndata: {"text":" World"}\n\n',
    ])
    const handlers = { onDelta: vi.fn() }

    await parseSSEStream(response, handlers)

    expect(handlers.onDelta).toHaveBeenCalledTimes(2)
    expect(handlers.onDelta).toHaveBeenNthCalledWith(1, 'Hello')
    expect(handlers.onDelta).toHaveBeenNthCalledWith(2, ' World')
  })

  it('calls onDone and returns result for done events', async () => {
    const response = createMockResponse(['event: done\ndata: {"success":true}\n\n'])
    const handlers = { onDone: vi.fn() }

    const result = await parseSSEStream<{ success: boolean }>(response, handlers)

    expect(handlers.onDone).toHaveBeenCalledWith({ success: true })
    expect(result).toEqual({ success: true })
  })

  it('calls onError and throws for error events', async () => {
    const response = createMockResponse([
      'event: error\ndata: {"error":"Something went wrong"}\n\n',
    ])
    const handlers = { onError: vi.fn() }

    await expect(parseSSEStream(response, handlers)).rejects.toThrow(SSEStreamError)
    expect(handlers.onError).toHaveBeenCalledWith('Something went wrong')
  })

  it('calls onProgress for progress events', async () => {
    const response = createMockResponse([
      'data: {"phase":"processing","message":"Working..."}\n\n',
    ])
    const handlers = { onProgress: vi.fn() }

    await parseSSEStream(response, handlers)

    expect(handlers.onProgress).toHaveBeenCalledWith('processing', 'Working...')
  })

  it('handles full SSE conversation', async () => {
    const response = createMockResponse([
      'event: start\ndata: {}\n\n',
      'event: delta\ndata: {"text":"Hi"}\n\n',
      'event: done\ndata: {"complete":true}\n\n',
    ])
    const handlers = {
      onStart: vi.fn(),
      onDelta: vi.fn(),
      onDone: vi.fn(),
    }

    const result = await parseSSEStream(response, handlers)

    expect(handlers.onStart).toHaveBeenCalled()
    expect(handlers.onDelta).toHaveBeenCalledWith('Hi')
    expect(handlers.onDone).toHaveBeenCalledWith({ complete: true })
    expect(result).toEqual({ complete: true })
  })

  it('skips heartbeat comments', async () => {
    const response = createMockResponse([
      ': [heartbeat]\n\n',
      'event: done\ndata: {"ok":true}\n\n',
    ])
    const handlers = { onDone: vi.fn() }

    await parseSSEStream(response, handlers)

    expect(handlers.onDone).toHaveBeenCalledTimes(1)
  })

  it('throws when response has no body', async () => {
    const response = new Response(null)
    await expect(parseSSEStream(response, {})).rejects.toThrow('No response body')
  })
})

describe('SSEStreamError', () => {
  it('preserves error message and payload', () => {
    const error = new SSEStreamError('Test error', {
      code: 'TEST_CODE',
      retryable: true,
    })

    expect(error.message).toBe('Test error')
    expect(error.name).toBe('SSEStreamError')
    expect(error.code).toBe('TEST_CODE')
    expect(error.retryable).toBe(true)
    expect(error.payload).toEqual({ code: 'TEST_CODE', retryable: true })
  })

  it('handles missing optional fields', () => {
    const error = new SSEStreamError('Simple error')

    expect(error.code).toBeUndefined()
    expect(error.retryable).toBeUndefined()
    expect(error.payload).toEqual({})
  })
})

describe('StreamCancelledError', () => {
  it('has default message', () => {
    const error = new StreamCancelledError()

    expect(error.message).toBe('Stream cancelled')
    expect(error.name).toBe('StreamCancelledError')
  })

  it('accepts custom message', () => {
    const error = new StreamCancelledError('User cancelled')

    expect(error.message).toBe('User cancelled')
  })
})
