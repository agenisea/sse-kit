# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-03-28

### Changed

- **Breaking**: `start()` no longer rejects on non-retriable stream errors (e.g., HTTP 429, 500). Errors are reported exclusively via the `onError` callback and `state.error`. This eliminates unhandled promise rejections when `start()` is called from React event handlers (the primary usage pattern).

  **Migration**: If you previously relied on `start()` rejecting on errors, move your error handling to the `onError` callback:

  ```typescript
  // Before (0.2.x) — try/catch pattern
  try {
    await start(input)
  } catch (e) {
    showError(e.message)
  }

  // Before (0.2.x) — .catch() pattern
  start(input).catch((e) => showError(e.message))

  // After (0.3.0) — use onError callback
  const { start } = useSSEStream({
    onError: (message) => showError(message),
    // ...
  })
  await start(input) // always resolves with TResult | undefined
  ```

### Fixed

- Added explicit guard against double `onError`/`SET_ERROR` dispatch. The error is now reported exactly once regardless of error source (HTTP status, SSE event, or network failure). Previously, the single-dispatch behavior relied implicitly on the SSE parser's internal try/catch — the guard now makes the intent explicit.

## [0.2.0] - 2026-02-11

### Breaking Changes

- **Parser:** `onMessage` signature changed from `(data: T)` to `(event: string | undefined, data: T)` — event first
- **Hook:** `phase` renamed to `event` throughout (`state.event`, `initialEvent`, `completeEvent`, `errorEvent`, `TEvent`, `SSEEventConfig`)
- **Hook:** `TUpdate` constraint removed — `TUpdate = unknown`, data can be any shape
- **Hook:** `onUpdate` signature changed from `(update: TUpdate)` to `(event: string | undefined, data: TUpdate)`
- **Hook:** `isComplete`/`isError` callbacks removed — `event:` line drives lifecycle
- **Hook:** `phaseMessage` removed from state — message is application data, not protocol
- **Server:** `StreamOrchestrator` methods now use `event:` + `data:` wire format
- **Server:** `sendResult` renamed to `sendData(data: TData)`
- **Server:** `sendEvent`, `sendProgress`, `sendWithMetadata` removed
- **Server:** `StreamOrchestrator<TUpdate extends SSEUpdate>` changed to `StreamOrchestrator<TData = unknown>`
- **Server:** `completePhase`/`errorPhase` config renamed to `completeEvent`/`errorEvent`

### Added

- Parser: `onComment` callback for `:` comment lines (previously silently dropped)
- Hook: Smart defaults for `extractResult` (data IS the result) and `extractError` (tries `error`, `message`, `detail` fields)
- Hook: Callback identity fix — `optionsRef` pattern stabilizes `start` useCallback

## [0.1.2] - 2025-12-29

### Changed

- Simplified `files` array in package.json (README, CHANGELOG, LICENSE auto-included by npm)
- Moved logo to `assets/` folder (not included in published package)

## [0.1.1] - 2025-12-29

### Changed

- Restructured README to minimal format
- Moved full API reference to `docs/API.md`
- Moved security considerations to `docs/SECURITY.md`

### Added

- `docs/` folder for detailed documentation
- `CHANGELOG.md` for version history

## [0.1.0] - 2025-12-29

### Added

- Initial release
- Server-side streaming with `createStreamingResponse` and `StreamOrchestrator`
- SSE response helper `createSSEResponse`
- Low-level `createSSEEncoder` for custom streaming
- `StreamObserver` for observability hooks
- React hook `useSSEStream` with full lifecycle management
- Circuit breaker pattern with `createCircuitBreaker`
- Retry utility `withRetry` with exponential backoff and jitter
- Timeout wrapper `fetchWithTimeout` for request and idle timeouts
- Heartbeat support with configurable intervals
- Tree-shakeable exports (`/server`, `/client`, `/types`)
- Full TypeScript support with comprehensive type definitions
