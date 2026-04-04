import { describe, it, expect } from 'vitest'
import { isNetworkError, isCancellationError } from '../src/client/reconnect-strategy'
import type { SSEConnectionConfig } from '../src/client/use-sse-stream'

describe('useSSEStream error classification', () => {
  describe('HTTP status errors are not network errors', () => {
    it('HTTP 429 is not a network error', () => {
      expect(isNetworkError(new Error('HTTP 429'))).toBe(false)
    })

    it('HTTP 500 is not a network error', () => {
      expect(isNetworkError(new Error('HTTP 500'))).toBe(false)
    })

    it('HTTP 503 is not a network error', () => {
      expect(isNetworkError(new Error('HTTP 503'))).toBe(false)
    })

    it('Too Many Requests is not a network error', () => {
      expect(isNetworkError(new Error('Too Many Requests'))).toBe(false)
    })

    it('Server Error is not a network error', () => {
      expect(isNetworkError(new Error('Server Error'))).toBe(false)
    })
  })

  describe('HTTP status errors are not cancellation errors', () => {
    it('HTTP 429 is not a cancellation', () => {
      expect(isCancellationError(new Error('HTTP 429'))).toBe(false)
    })

    it('HTTP 500 is not a cancellation', () => {
      expect(isCancellationError(new Error('HTTP 500'))).toBe(false)
    })
  })

  describe('network errors are correctly classified for retry', () => {
    it('Failed to fetch is a network error', () => {
      expect(isNetworkError(new Error('Failed to fetch'))).toBe(true)
    })

    it('ECONNREFUSED is a network error', () => {
      expect(isNetworkError(new Error('ECONNREFUSED'))).toBe(true)
    })

    it('timeout is a network error', () => {
      expect(isNetworkError(new Error('timeout'))).toBe(true)
    })
  })
})

describe('SSEConnectionConfig does not include streamQueryParam', () => {
  it('accepts endpoint, method, and headers without streamQueryParam', () => {
    const config: SSEConnectionConfig<{ query: string }> = {
      endpoint: '/api/stream',
      method: 'POST',
      headers: { 'X-Custom': 'value' },
    }
    expect(config.endpoint).toBe('/api/stream')
    expect(config.method).toBe('POST')
    expect(config.headers).toEqual({ 'X-Custom': 'value' })
  })

  it('endpoint with query params is passed through as-is', () => {
    const config: SSEConnectionConfig<void> = {
      endpoint: '/api/chat?stream=true&model=gpt-4',
    }
    expect(config.endpoint).toBe('/api/chat?stream=true&model=gpt-4')
  })

  it('endpoint function is accepted', () => {
    const config: SSEConnectionConfig<{ id: string }> = {
      endpoint: (input) => `/api/${input.id}/stream`,
    }
    expect(typeof config.endpoint).toBe('function')
    const fn = config.endpoint as (input: { id: string }) => string
    expect(fn({ id: '42' })).toBe('/api/42/stream')
  })
})
