/**
 * SSE Stream Orchestrator
 *
 * Server-side orchestration for Server-Sent Events streaming.
 * Framework-agnostic - works with any runtime that supports ReadableStream.
 *
 * All methods use `event:` + `data:` format on the wire, matching the SSE spec.
 *
 * @example
 * ```typescript
 * const { stream, orchestrator } = createStreamingResponse()
 *
 * // Start heartbeat for long operations
 * orchestrator.startHeartbeat()
 *
 * // Send updates during processing
 * await orchestrator.sendUpdate('stage', { name: 'parsing', status: 'running' })
 *
 * // Send final data
 * await orchestrator.sendData({ sections: 12 })
 *
 * // Return SSE response
 * return createSSEResponse(stream)
 * ```
 */

import type { HeartbeatConfig } from '../types/stream-config'
import { DEFAULT_HEARTBEAT_CONFIG } from '../types/stream-config'

export type StreamController = ReadableStreamDefaultController<Uint8Array>

/**
 * Observability hooks for stream lifecycle events.
 */
export interface StreamObserver {
  /** Called when a stream is created */
  onStreamStart?: () => void

  /** Called when stream closes (success or error) */
  onStreamEnd?: (durationMs: number, success: boolean, error?: Error) => void

  /** Called on each update sent */
  onUpdateSent?: (event: string, bytesSent: number) => void

  /** Called when heartbeat is sent */
  onHeartbeat?: () => void

  /** Called when an error occurs */
  onError?: (error: Error) => void

  /** Called when stream is aborted (via signal or abort()) */
  onAbort?: (reason: string) => void
}

/**
 * Configuration options for StreamOrchestrator.
 */
export interface StreamOrchestratorConfig {
  heartbeat?: Partial<HeartbeatConfig>

  /** Event type to use for 'complete' events */
  completeEvent?: string

  /** Event type to use for 'error' events */
  errorEvent?: string

  /** Custom logger function */
  logger?: (message: string, ...args: unknown[]) => void

  /** Observability hooks for metrics/tracing */
  observer?: StreamObserver

  /** Abort signal for cancellation (e.g., request.signal in Next.js) */
  signal?: AbortSignal
}

const DEFAULT_CONFIG: Required<Omit<StreamOrchestratorConfig, 'signal'>> & { signal?: AbortSignal } = {
  heartbeat: DEFAULT_HEARTBEAT_CONFIG,
  completeEvent: 'complete',
  errorEvent: 'error',
  logger: console.log,
  observer: {},
  signal: undefined,
}

/**
 * Orchestrates Server-Sent Events streaming.
 * Pure streaming logic - no business rules, just SSE management.
 *
 * All methods write `event:` + `data:` format on the wire.
 */
export class StreamOrchestrator<TData = unknown> {
  private encoder = new TextEncoder()
  private controller: StreamController
  private isClosed = false
  private isAborted = false
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private config: typeof DEFAULT_CONFIG
  private startTime: number
  private bytesSent = 0
  private lastError?: Error
  private abortHandler?: () => void

  constructor(controller: StreamController, config?: StreamOrchestratorConfig) {
    this.controller = controller
    this.startTime = Date.now()
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      heartbeat: { ...DEFAULT_HEARTBEAT_CONFIG, ...config?.heartbeat },
      observer: { ...DEFAULT_CONFIG.observer, ...config?.observer },
    }

    // Set up abort signal listener
    if (this.config.signal) {
      if (this.config.signal.aborted) {
        this.handleAbort()
      } else {
        this.abortHandler = () => this.handleAbort()
        this.config.signal.addEventListener('abort', this.abortHandler)
      }
    }

    // Notify observer that stream started
    this.config.observer?.onStreamStart?.()
  }

  /**
   * Handle abort signal.
   */
  private handleAbort(reason = 'Stream aborted'): void {
    if (this.isClosed) return

    this.isAborted = true
    this.lastError = new Error(reason)
    this.stopHeartbeat()
    this.isClosed = true

    // Notify observer of abort specifically
    this.config.observer?.onAbort?.(reason)

    // Notify observer of stream end
    const durationMs = Date.now() - this.startTime
    this.config.observer?.onStreamEnd?.(durationMs, false, this.lastError)

    // Try to close controller
    try {
      this.controller.close()
    } catch {
      // Controller may already be closed
    }

    // Clean up abort listener
    this.cleanupAbortListener()
  }

  /**
   * Clean up abort signal listener.
   */
  private cleanupAbortListener(): void {
    if (this.config.signal && this.abortHandler) {
      this.config.signal.removeEventListener('abort', this.abortHandler)
      this.abortHandler = undefined
    }
  }

  /**
   * Send an SSE message with event type and data.
   * Produces: `event: <eventType>\ndata: <JSON>\n\n`
   */
  async sendUpdate(eventType: string, data: TData): Promise<void> {
    if (this.isClosed) {
      this.config.logger('[stream-orchestrator] Stream closed, skipping update:', eventType)
      return
    }

    try {
      const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
      const encoded = this.encoder.encode(payload)
      this.controller.enqueue(encoded)

      // Track metrics
      this.bytesSent += encoded.length
      this.config.observer?.onUpdateSent?.(eventType, encoded.length)
    } catch (error) {
      this.isClosed = true
      this.lastError = error instanceof Error ? error : new Error(String(error))
      this.config.observer?.onError?.(this.lastError)

      if (error instanceof Error && error.message?.includes('Controller is already closed')) {
        this.config.logger('[stream-orchestrator] Stream closed by client, skipping update:', eventType)
      } else {
        this.config.logger('[stream-orchestrator] Unexpected stream error:', error)
      }
    }
  }

  /**
   * Send data with the configured complete event type.
   * Produces: `event: <completeEvent>\ndata: <JSON>\n\n`
   */
  async sendData(data: TData): Promise<void> {
    await this.sendUpdate(this.config.completeEvent, data)
  }

  /**
   * Send an error message.
   * Produces: `event: <errorEvent>\ndata: {"error":"...","...extra"}\n\n`
   */
  async sendError(error: string, extra?: Record<string, unknown>): Promise<void> {
    await this.sendUpdate(this.config.errorEvent, { error, ...extra } as TData)
  }

  /**
   * Start sending periodic heartbeat to keep connection alive.
   *
   * SSE connections can timeout if no data is sent for extended periods.
   * This sends a comment line periodically to prevent browser/proxy timeouts.
   */
  startHeartbeat(): void {
    const heartbeatConfig = this.config.heartbeat as HeartbeatConfig
    if (!heartbeatConfig.enabled || this.heartbeatInterval) {
      return
    }

    this.heartbeatInterval = setInterval(() => {
      if (this.isClosed) {
        this.stopHeartbeat()
        return
      }

      try {
        const message = heartbeatConfig.message ?? 'heartbeat'
        const heartbeat = `: [${message}]\n\n`
        const encoded = this.encoder.encode(heartbeat)
        this.controller.enqueue(encoded)
        this.bytesSent += encoded.length
        this.config.observer?.onHeartbeat?.()
      } catch (error) {
        this.isClosed = true
        this.stopHeartbeat()
        this.lastError = error instanceof Error ? error : new Error(String(error))
        this.config.observer?.onError?.(this.lastError)

        if (error instanceof Error && !error.message?.includes('Controller is already closed')) {
          this.config.logger('[stream-orchestrator:heartbeat] Unexpected error:', error)
        }
      }
    }, heartbeatConfig.intervalMs)
  }

  /**
   * Stop heartbeat interval.
   */
  stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  /**
   * Close the stream safely.
   */
  async close(): Promise<void> {
    if (!this.isClosed) {
      this.stopHeartbeat()
      this.cleanupAbortListener()
      try {
        this.controller.close()
        this.isClosed = true

        // Notify observer that stream ended
        const durationMs = Date.now() - this.startTime
        const success = !this.lastError
        this.config.observer?.onStreamEnd?.(durationMs, success, this.lastError)
      } catch (error) {
        this.config.logger('[stream-orchestrator] Error closing stream:', error)
      }
    }
  }

  /**
   * Abort the stream programmatically.
   * Use this to cancel from server-side code.
   */
  abort(reason?: string): void {
    this.handleAbort(reason ?? 'Stream aborted')
  }

  /**
   * Check if stream is closed.
   */
  get closed(): boolean {
    return this.isClosed
  }

  /**
   * Check if stream was aborted.
   */
  get aborted(): boolean {
    return this.isAborted
  }

  /**
   * Get stream metrics.
   */
  getMetrics(): { durationMs: number; bytesSent: number; closed: boolean; aborted: boolean } {
    return {
      durationMs: Date.now() - this.startTime,
      bytesSent: this.bytesSent,
      closed: this.isClosed,
      aborted: this.isAborted,
    }
  }
}

/**
 * Creates a streaming response with orchestrator.
 *
 * @example
 * ```typescript
 * const { stream, orchestrator } = createStreamingResponse()
 * // Use orchestrator to send updates...
 * return createSSEResponse(stream)
 * ```
 */
export function createStreamingResponse<TData = unknown>(
  config?: StreamOrchestratorConfig
): { stream: ReadableStream<Uint8Array>; orchestrator: StreamOrchestrator<TData> } {
  let orchestrator!: StreamOrchestrator<TData>

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      orchestrator = new StreamOrchestrator<TData>(controller, config)
    },
  })

  return { stream, orchestrator }
}

/**
 * Standard SSE response headers.
 */
export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no', // Disable nginx buffering
}

/**
 * Create Response object with proper SSE headers.
 *
 * @example
 * ```typescript
 * const { stream } = createStreamingResponse()
 * return createSSEResponse(stream, { 'X-Custom': 'header' })
 * ```
 */
export function createSSEResponse(
  stream: ReadableStream,
  additionalHeaders?: Record<string, string>
): Response {
  const headers: Record<string, string> = {
    ...SSE_HEADERS,
    ...additionalHeaders,
  }

  return new Response(stream, { headers })
}
