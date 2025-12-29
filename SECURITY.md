# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in sse-kit, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Use [GitHub's private vulnerability reporting](https://github.com/agenisea/sse-kit/security/advisories/new)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a detailed response within 7 days.

## Security Design

This library is designed with minimal attack surface:

- **Zero runtime dependencies** — no supply chain risk in production
- **No authentication handling** — consumers manage auth at integration layer
- **No data persistence** — ephemeral streams only
- **No external network calls** — only stream handling by design
- **No file system access** — pure in-memory operations
