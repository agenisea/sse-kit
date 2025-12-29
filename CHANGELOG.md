# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
