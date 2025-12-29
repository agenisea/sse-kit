/**
 * Client-side SSE exports
 *
 * Import from '@sse-lib/client' for tree-shaking optimization.
 */

export {
  createSSEParser,
  parseSSEStream,
  SSEStreamError,
  StreamCancelledError,
  type SSEEventHandlers,
  type SSEParserOptions,
} from './sse-parser'

export {
  createReconnectionManager,
  withRetry,
  sleep,
  isNetworkError,
  isCancellationError,
  type ReconnectionState,
  type ReconnectionEvent,
} from './reconnect-strategy'

export {
  useSSEStream,
  type SSEStreamState,
  type ReconnectionInfo,
  type UseSSEStreamOptions,
  type SSEConnectionConfig,
  type SSEPhaseConfig,
  type SSEStreamCallbacks,
  type SSEParseConfig,
  type SSEResilienceConfig,
  type SSEBrowserConfig,
} from './use-sse-stream'

export {
  createCircuitBreaker,
  getSharedCircuitBreaker,
  resetSharedCircuitBreaker,
  removeSharedCircuitBreaker,
  getSharedCircuitBreakerCount,
  clearAllSharedCircuitBreakers,
  CircuitOpenError,
  type CircuitBreaker,
  type CircuitState,
  type CircuitBreakerOptions,
} from './circuit-breaker'

export {
  createTimeoutController,
  createIdleTimeout,
  fetchWithTimeout,
  readStreamWithIdleTimeout,
  isTimeoutError,
  isRequestTimeoutError,
  isIdleTimeoutError,
  TimeoutError,
} from './timeout'
