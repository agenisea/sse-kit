/**
 * SSE Stream Orchestrator
 *
 * Server-side orchestration for Server-Sent Events streaming.
 * Framework-agnostic - works with any runtime that supports ReadableStream.
 *
 * @example
 * ```typescript
 * const { stream, orchestrator } = createStreamingResponse()
 *
 * // Start heartbeat for long operations
 * orchestrator.startHeartbeat()
 *
 * // Send updates during processing
 * await orchestrator.sendUpdate({ phase: 'processing', message: 'Working...' })
 *
 * // Send final result
 * await orchestrator.sendResult({ data: 'complete' })
 *
 * // Return SSE response
 * return createSSEResponse(stream)
 * ```
 */

import type { SSEUpdate, SSEMetadata } from '../types/sse-events'
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
  onUpdateSent?: (phase: string, bytesSent: number) => void

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

  /** Phase value to use for 'complete' events */
  completePhase?: string

  /** Phase value to use for 'error' events */
  errorPhase?: string

  /** Custom logger function */
  logger?: (message: string, ...args: unknown[]) => void

  /** Observability hooks for metrics/tracing */
  observer?: StreamObserver

  /** Abort signal for cancellation (e.g., request.signal in Next.js) */
  signal?: AbortSignal
}

const DEFAULT_CONFIG: Required<Omit<StreamOrchestratorConfig, 'signal'>> & { signal?: AbortSignal } = {
  heartbeat: DEFAULT_HEARTBEAT_CONFIG,
  completePhase: 'complete',
  errorPhase: 'error',
  logger: console.log,
  observer: {},
  signal: undefined,
}

/**
 * Orchestrates Server-Sent Events streaming.
 * Pure streaming logic - no business rules, just SSE management.
 */
export class StreamOrchestrator<TUpdate extends SSEUpdate = SSEUpdate> {
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
   * Send a streaming update to the client.
   * Automatically handles closed stream errors gracefully.
   */
  async sendUpdate(update: TUpdate): Promise<void> {
    if (this.isClosed) {
      this.config.logger('[stream-orchestrator] Stream closed, skipping update:', update.phase)
      return
    }

    try {
      const data = `data: ${JSON.stringify(update)}\n\n`
      const encoded = this.encoder.encode(data)
      this.controller.enqueue(encoded)

      // Track metrics
      this.bytesSent += encoded.length
      this.config.observer?.onUpdateSent?.(update.phase, encoded.length)
    } catch (error) {
      this.isClosed = true
      this.lastError = error instanceof Error ? error : new Error(String(error))
      this.config.observer?.onError?.(this.lastError)

      if (error instanceof Error && error.message?.includes('Controller is already closed')) {
        this.config.logger('[stream-orchestrator] Stream closed by client, skipping update:', update.phase)
      } else {
        this.config.logger('[stream-orchestrator] Unexpected stream error:', error)
      }
    }
  }

  /**
   * Send a progress update with just a phase.
   */
  async sendProgress(phase: TUpdate['phase'], message?: string): Promise<void> {
    await this.sendUpdate({ phase, message } as TUpdate)
  }

  /**
   * Send the final result and mark as complete.
   */
  async sendResult<TResult>(result: TResult): Promise<void> {
    await this.sendUpdate({
      phase: this.config.completePhase,
      result,
    } as TUpdate)
  }

  /**
   * Send an error message.
   */
  async sendError(error: string, extra?: Record<string, unknown>): Promise<void> {
    await this.sendUpdate({
      phase: this.config.errorPhase,
      error,
      ...extra,
    } as TUpdate)
  }

  /**
   * Send an update with custom metadata.
   */
  async sendWithMetadata<TMeta extends SSEMetadata>(
    phase: TUpdate['phase'],
    metadata: TMeta,
    message?: string
  ): Promise<void> {
    await this.sendUpdate({
      phase,
      message,
      metadata,
    } as TUpdate & { metadata: TMeta })
  }

  /**
   * Send a custom event with event: type prefix.
   * Use for typed events like 'start', 'delta', 'done', 'error'.
   */
  async sendEvent(eventType: string, data: unknown): Promise<void> {
    if (this.isClosed) return

    try {
      const payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`
      this.controller.enqueue(this.encoder.encode(payload))
    } catch (error) {
      this.isClosed = true
      this.config.logger('[stream-orchestrator] Error sending event:', error)
    }
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
export function createStreamingResponse<TUpdate extends SSEUpdate = SSEUpdate>(
  config?: StreamOrchestratorConfig
): { stream: ReadableStream<Uint8Array>; orchestrator: StreamOrchestrator<TUpdate> } {
  let orchestrator!: StreamOrchestrator<TUpdate>

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      orchestrator = new StreamOrchestrator<TUpdate>(controller, config)
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
