/**
 * useSSEStream - Generic React Hook for SSE Streaming
 *
 * A framework-agnostic React hook that manages SSE streaming lifecycle
 * with automatic reconnection, cancellation, and state management.
 *
 * @example
 * ```typescript
 * interface MyUpdate {
 *   phase: 'processing' | 'complete' | 'error'
 *   result?: MyResult
 *   error?: string
 * }
 *
 * function MyComponent() {
 *   const { state, start, cancel, reset } = useSSEStream<MyInput, MyResult, MyUpdate>({
 *     endpoint: '/api/my-stream',
 *     onUpdate: (update) => {
 *       if (update.phase === 'complete') {
 *         console.log('Done:', update.result)
 *       }
 *     }
 *   })
 *
 *   return (
 *     <div>
 *       <button onClick={() => start({ query: 'test' })}>Start</button>
 *       <button onClick={cancel} disabled={!state.isStreaming}>Cancel</button>
 *       <p>Phase: {state.phase}</p>
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
export interface SSEStreamState<TPhase extends string, TResult> {
  phase: TPhase
  phaseMessage: string | null
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
type StreamAction<TPhase extends string, TResult> =
  | { type: 'START'; payload: { phase: TPhase } }
  | { type: 'UPDATE_PHASE'; payload: { phase: TPhase; message?: string } }
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
 * Phase lifecycle - state machine configuration.
 */
export interface SSEPhaseConfig<TPhase extends string> {
  initialPhase: TPhase
  completePhase: TPhase
  errorPhase: TPhase
  reconnectingPhase?: TPhase
}

/**
 * Stream callbacks - side effects on stream events.
 */
export interface SSEStreamCallbacks<TResult, TUpdate> {
  onUpdate?: (update: TUpdate) => void
  onComplete?: (result: TResult) => void
  onError?: (error: string) => void
}

/**
 * Custom parsing - for non-standard update shapes.
 */
export interface SSEParseConfig<TResult, TUpdate> {
  extractResult?: (update: TUpdate) => TResult | undefined
  extractError?: (update: TUpdate) => string | undefined
  isComplete?: (update: TUpdate) => boolean
  isError?: (update: TUpdate) => boolean
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
export type UseSSEStreamOptions<TInput, TResult, TUpdate, TPhase extends string> =
  SSEConnectionConfig<TInput> &
  SSEPhaseConfig<TPhase> &
  SSEStreamCallbacks<TResult, TUpdate> &
  SSEParseConfig<TResult, TUpdate> &
  SSEResilienceConfig &
  SSEBrowserConfig

function createReducer<TPhase extends string, TResult>(initialPhase: TPhase) {
  const initialState: SSEStreamState<TPhase, TResult> = {
    phase: initialPhase,
    phaseMessage: null,
    result: null,
    error: null,
    isStreaming: false,
    reconnectionInfo: null,
  }

  return function reducer(
    state: SSEStreamState<TPhase, TResult>,
    action: StreamAction<TPhase, TResult>
  ): SSEStreamState<TPhase, TResult> {
    switch (action.type) {
      case 'START':
        return {
          ...initialState,
          phase: action.payload.phase,
          isStreaming: true,
        }
      case 'UPDATE_PHASE':
        return {
          ...state,
          phase: action.payload.phase,
          phaseMessage: action.payload.message ?? state.phaseMessage,
          reconnectionInfo: null, // Clear reconnection on successful update
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
 */
export function useSSEStream<
  TInput,
  TResult,
  TUpdate extends { phase: TPhase; message?: string; result?: TResult; error?: string },
  TPhase extends string = string
>(options: UseSSEStreamOptions<TInput, TResult, TUpdate, TPhase>) {
  const {
    endpoint,
    method = 'POST',
    initialPhase,
    completePhase,
    errorPhase,
    reconnectingPhase,
    headers = {},
    retry = {},
    onUpdate,
    onComplete,
    onError,
    extractResult = (update) => update.result,
    extractError = (update) => update.error,
    isComplete = (update) => update.phase === completePhase,
    isError = (update) => update.phase === errorPhase,
    streamQueryParam = true,
    warnOnUnload = true,
  } = options

  const retryConfig: RetryConfig = { ...DEFAULT_RETRY_CONFIG, ...retry }
  const reducer = createReducer<TPhase, TResult>(initialPhase)
  const [state, dispatch] = useReducer(reducer, {
    phase: initialPhase,
    phaseMessage: null,
    result: null,
    error: null,
    isStreaming: false,
    reconnectionInfo: null,
  })

  const abortControllerRef = useRef<AbortController | null>(null)

  const start = useCallback(async (input: TInput): Promise<TResult | undefined> => {
    // Abort any existing stream
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    dispatch({ type: 'START', payload: { phase: initialPhase } })

    const reconnect = createReconnectionManager({
      config: retryConfig,
      onReconnecting: (event) => {
        if (reconnectingPhase) {
          dispatch({
            type: 'UPDATE_PHASE',
            payload: { phase: reconnectingPhase },
          })
        }
        dispatch({
          type: 'SET_RECONNECTION',
          payload: {
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            retryDelayMs: event.delayMs,
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
          onMessage: (update) => {
            onUpdate?.(update)

            // Update phase
            dispatch({
              type: 'UPDATE_PHASE',
              payload: { phase: update.phase, message: update.message },
            })

            // Handle completion
            if (isComplete(update)) {
              const result = extractResult(update)
              if (result !== undefined) {
                finalResult = result
                dispatch({ type: 'SET_RESULT', payload: { result } })
                onComplete?.(result)
              }
            }

            // Handle error
            if (isError(update)) {
              const error = extractError(update) || 'Unknown error'
              dispatch({ type: 'SET_ERROR', payload: { error } })
              onError?.(error)
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
      onError?.(errorMessage)
      throw error
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null
      }
    }
  }, [
    endpoint,
    method,
    headers,
    initialPhase,
    completePhase,
    reconnectingPhase,
    retryConfig,
    streamQueryParam,
    onUpdate,
    onComplete,
    onError,
    extractResult,
    extractError,
    isComplete,
    isError,
  ])

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
