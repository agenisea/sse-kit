import { describe, it, expect } from 'vitest'
import { isNetworkError, isCancellationError } from '../src/client/reconnect-strategy'

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
