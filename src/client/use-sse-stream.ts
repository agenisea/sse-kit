/**
 * useSSEStream - Generic React Hook for SSE Streaming
 *
 * A framework-agnostic React hook that manages SSE streaming lifecycle
 * with automatic reconnection, cancellation, and state management.
 *
 * Phase is driven exclusively by the SSE `event:` line — data can be any shape.
 *
 * @example
 * ```typescript
 * function MyComponent() {
 *   const { state, start, cancel, reset } = useSSEStream<MyInput, MyResult>({
 *     endpoint: '/api/my-stream',
 *     initialEvent: 'idle',
 *     completeEvent: 'complete',
 *     errorEvent: 'error',
 *     onUpdate: (event, data) => {
 *       if (event === 'stage') {
 *         console.log('Stage:', data)
 *       }
 *     }
 *   })
 *
 *   return (
 *     <div>
 *       <button onClick={() => start({ query: 'test' })}>Start</button>
 *       <button onClick={cancel} disabled={!state.isStreaming}>Cancel</button>
 *       <p>Event: {state.event}</p>
 *       {state.error && <p>Error: {state.error}</p>}
 *     </div>
 *   )
 * }
 * ```
 */

import { useReducer, useCallback, useRef, useEffect } from 'react'
import { createSSEParser } from './sse-parser'
import { createReconnectionManager, isCancellationError } from './reconnect-strategy'
import type { RetryConfig } from '../types/stream-config'
import { DEFAULT_RETRY_CONFIG } from '../types/stream-config'

/**
 * Generic stream state shape.
 */
export interface SSEStreamState<TEvent extends string, TResult> {
  event: TEvent
  result: TResult | null
  error: string | null
  isStreaming: boolean
  reconnectionInfo: ReconnectionInfo | null
}

export interface ReconnectionInfo {
  attempt: number
  maxAttempts: number
  retryDelayMs: number
}

/**
 * Actions for the stream reducer.
 */
type StreamAction<TEvent extends string, TResult> =
  | { type: 'START'; payload: { event: TEvent } }
  | { type: 'UPDATE_EVENT'; payload: { event: TEvent } }
  | { type: 'SET_RECONNECTION'; payload: ReconnectionInfo }
  | { type: 'SET_RESULT'; payload: { result: TResult } }
  | { type: 'SET_ERROR'; payload: { error: string } }
  | { type: 'CANCEL' }
  | { type: 'RESET' }

/**
 * Connection configuration - how to reach the SSE endpoint.
 */
export interface SSEConnectionConfig<TInput> {
  endpoint: string | ((input: TInput) => string)
  method?: 'POST' | 'GET' | 'PUT' | 'PATCH'
  headers?: Record<string, string>
  streamQueryParam?: boolean
}

/**
 * Event lifecycle - state machine configuration.
 */
export interface SSEEventConfig<TEvent extends string> {
  initialEvent: TEvent
  completeEvent: TEvent
  errorEvent: TEvent
  reconnectingEvent?: TEvent
}

/**
 * Stream callbacks - side effects on stream events.
 */
export interface SSEStreamCallbacks<TResult, TUpdate> {
  onUpdate?: (event: string | undefined, data: TUpdate) => void
  onComplete?: (result: TResult) => void
  onError?: (error: string) => void
}

/**
 * Custom parsing - extract result/error from data payloads.
 */
export interface SSEParseConfig<TResult, TUpdate> {
  extractResult?: (data: TUpdate) => TResult | undefined
  extractError?: (data: TUpdate) => string | undefined
}

/**
 * Resilience configuration - retry behavior.
 */
export interface SSEResilienceConfig {
  retry?: Partial<RetryConfig>
}

/**
 * Browser UX - browser-specific behaviors.
 */
export interface SSEBrowserConfig {
  warnOnUnload?: boolean
}

/**
 * Full options for useSSEStream hook.
 */
export type UseSSEStreamOptions<TInput, TResult, TUpdate, TEvent extends string> =
  SSEConnectionConfig<TInput> &
  SSEEventConfig<TEvent> &
  SSEStreamCallbacks<TResult, TUpdate> &
  SSEParseConfig<TResult, TUpdate> &
  SSEResilienceConfig &
  SSEBrowserConfig

function createReducer<TEvent extends string, TResult>(initialEvent: TEvent) {
  const initialState: SSEStreamState<TEvent, TResult> = {
    event: initialEvent,
    result: null,
    error: null,
    isStreaming: false,
    reconnectionInfo: null,
  }

  return function reducer(
    state: SSEStreamState<TEvent, TResult>,
    action: StreamAction<TEvent, TResult>
  ): SSEStreamState<TEvent, TResult> {
    switch (action.type) {
      case 'START':
        return {
          ...initialState,
          event: action.payload.event,
          isStreaming: true,
        }
      case 'UPDATE_EVENT':
        return {
          ...state,
          event: action.payload.event,
          reconnectionInfo: null,
        }
      case 'SET_RECONNECTION':
        return {
          ...state,
          reconnectionInfo: action.payload,
        }
      case 'SET_RESULT':
        return {
          ...state,
          result: action.payload.result,
          isStreaming: false,
        }
      case 'SET_ERROR':
        return {
          ...state,
          error: action.payload.error,
          isStreaming: false,
        }
      case 'CANCEL':
        return {
          ...state,
          isStreaming: false,
        }
      case 'RESET':
        return initialState
      default:
        return state
    }
  }
}

/**
 * Generic React hook for SSE streaming.
 *
 * Event-driven: the SSE `event:` line drives state transitions.
 * Data can be any shape — no TUpdate constraint.
 */
export function useSSEStream<
  TInput,
  TResult,
  TUpdate = unknown,
  TEvent extends string = string
>(options: UseSSEStreamOptions<TInput, TResult, TUpdate, TEvent>) {
  const {
    endpoint,
    method = 'POST',
    initialEvent,
    completeEvent,
    errorEvent,
    reconnectingEvent,
    streamQueryParam = true,
    warnOnUnload = true,
  } = options

  const retryConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...(options.retry ?? {}) }
  const reducer = createReducer<TEvent, TResult>(initialEvent)
  const [state, dispatch] = useReducer(reducer, {
    event: initialEvent,
    result: null,
    error: null,
    isStreaming: false,
    reconnectionInfo: null,
  })

  const abortControllerRef = useRef<AbortController | null>(null)

  // Store all callback/object options in a ref to stabilize `start` identity
  const optionsRef = useRef(options)
  optionsRef.current = options

  const start = useCallback(async (input: TInput): Promise<TResult | undefined> => {
    const currentOptions = optionsRef.current
    const headers = currentOptions.headers ?? {}

    // Smart defaults
    const extractResult = currentOptions.extractResult ?? ((data: TUpdate) => data as unknown as TResult | undefined)
    const extractError = currentOptions.extractError ?? ((data: TUpdate) => {
      const record = data as Record<string, unknown>
      const message = record.error ?? record.message ?? record.detail
      return typeof message === 'string' ? message : undefined
    })

    // Abort any existing stream
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    dispatch({ type: 'START', payload: { event: initialEvent } })

    const reconnect = createReconnectionManager({
      config: retryConfig,
      onReconnecting: (reconnectEvent) => {
        if (reconnectingEvent) {
          dispatch({
            type: 'UPDATE_EVENT',
            payload: { event: reconnectingEvent },
          })
        }
        dispatch({
          type: 'SET_RECONNECTION',
          payload: {
            attempt: reconnectEvent.attempt,
            maxAttempts: reconnectEvent.maxAttempts,
            retryDelayMs: reconnectEvent.delayMs,
          },
        })
      },
    })

    try {
      return await reconnect.execute(async (signal) => {
        const url = typeof endpoint === 'function' ? endpoint(input) : endpoint
        const finalUrl = streamQueryParam ? `${url}?stream=true` : url

        const response = await fetch(finalUrl, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...headers,
          },
          body: method !== 'GET' ? JSON.stringify(input) : undefined,
          signal,
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          throw new Error(errorData.error || `HTTP ${response.status}`)
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let finalResult: TResult | undefined

        const parser = createSSEParser<TUpdate>({
          onMessage: (event, data) => {
            // Protocol layer: event: line drives state
            const eventType = event as TEvent | undefined

            if (eventType) {
              dispatch({ type: 'UPDATE_EVENT', payload: { event: eventType } })
            }

            // Pass raw data to consumer — event first
            currentOptions.onUpdate?.(event, data)

            // Lifecycle: completion
            if (eventType === completeEvent) {
              const result = extractResult(data)
              if (result !== undefined) {
                finalResult = result
                dispatch({ type: 'SET_RESULT', payload: { result } })
                currentOptions.onComplete?.(result)
              }
            }

            // Lifecycle: error (terminal)
            if (eventType === errorEvent) {
              const error = extractError(data) || 'Unknown error'
              dispatch({ type: 'SET_ERROR', payload: { error } })
              currentOptions.onError?.(error)
              throw new Error(error)
            }
          },
          onError: (err) => {
            console.warn('[useSSEStream] Parse error:', err)
          },
        })

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            parser(decoder.decode(value, { stream: true }))
          }
        } finally {
          reader.releaseLock()
        }

        return finalResult
      }, controller.signal)
    } catch (error) {
      if (isCancellationError(error) || controller.signal.aborted) {
        dispatch({ type: 'CANCEL' })
        return undefined
      }

      const errorMessage = error instanceof Error ? error.message : 'Stream failed'
      dispatch({ type: 'SET_ERROR', payload: { error: errorMessage } })
      currentOptions.onError?.(errorMessage)
      throw error
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
    }
  }, [endpoint, method, initialEvent, completeEvent, errorEvent, reconnectingEvent, streamQueryParam, retryConfig])

  const cancel = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    dispatch({ type: 'CANCEL' })
  }, [])

  const reset = useCallback(() => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    dispatch({ type: 'RESET' })
  }, [])

  // Warn before unload when streaming
  useEffect(() => {
    if (!warnOnUnload || typeof window === 'undefined') return

    const handleBeforeUnload = (event: BeforeUnloadEvent): string | undefined => {
      if (abortControllerRef.current) {
        event.preventDefault()
        return ''
      }
      return undefined
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      abortControllerRef.current?.abort()
    }
  }, [warnOnUnload])

  return {
    state,
    start,
    cancel,
    reset,
    isStreaming: state.isStreaming,
  }
}

export type { RetryConfig }
