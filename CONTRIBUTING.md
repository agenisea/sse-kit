# Contributing to sse-kit

Thanks for your interest in contributing to sse-kit! This document outlines how to get started.

## Getting Started

1. Fork the repository
2. Clone your fork locally
3. Install dependencies with `pnpm install`
4. Run tests with `pnpm test`
5. Run the build with `pnpm build`

## Development Workflow

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Type check
pnpm typecheck

# Lint
pnpm lint

# Build
pnpm build
```

## How to Contribute

### Reporting Bugs

- Check existing issues first to avoid duplicates
- Use a clear, descriptive title
- Include steps to reproduce the issue
- Describe expected vs actual behavior

### Suggesting Features

- Open an issue describing the feature
- Explain the use case and why it would be valuable
- Be open to discussion about implementation approaches

### Pull Requests

1. Create a branch from `main` for your changes
2. Make your changes with clear, focused commits
3. Ensure all tests pass (`pnpm test`)
4. Ensure types are correct (`pnpm typecheck`)
5. Ensure linting passes (`pnpm lint`)
6. Open a PR with a clear description of changes
7. Link any related issues

## Code Style

- Follow existing patterns in the codebase
- Use meaningful variable and function names
- Add JSDoc comments to public functions
- Include unit tests for new functionality
- Keep the library focused—no runtime dependencies

## Areas for Contribution

- **Client features**: New React hooks, additional retry strategies
- **Server features**: Framework-specific helpers, compression support
- **Resilience**: Circuit breaker improvements, observability hooks
- **Testing**: Edge cases, browser environment tests
- **Documentation**: Examples, API documentation, tutorials

## Questions?

Open an issue or reach out to the maintainers. We're happy to help!
