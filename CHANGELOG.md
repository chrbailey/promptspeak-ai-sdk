# Changelog

All notable changes to `@promptspeak/ai-sdk` are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- `CHANGELOG.md` (this file).
- GitHub Actions CI workflow (`.github/workflows/ci.yml`): typecheck + build + tests on Node 20 and Node 22.

### Notes
- A local development branch exists (not in main) that ports the package to Vercel AI SDK v6 (`LanguageModelV3Middleware`) and bumps the package version to `0.2.0`. That branch is **not** shipped and is not reflected in `package.json` on `main`. The `0.2.0` release will be cut from that branch after streaming interception (`wrapStream`) is implemented — see Status below.

## [0.1.0] — 2026-02-25

Initial experimental release. Tagged in git as commit `94612ca`.

### Added
- `promptSpeakMiddleware(config)` — a `LanguageModelV1Middleware` for AI SDK v4 that intercepts tool calls in `wrapGenerate` and allows / blocks / holds them via `Gatekeeper`.
- `governedTool(aiTool, config)` — wraps an individual AI SDK tool so its `execute()` runs through `Gatekeeper` before the tool body.
- Re-exports from `promptspeak-mcp-server`: `Gatekeeper`, `DriftDetectionEngine`, `containsSensitiveData`, mode and level constants.
- Two test files: `tests/middleware.test.ts`, `tests/governed-tool.test.ts`.

### Status (as-shipped)

This is an **experimental, pre-1.0** package. The following caveats apply to `0.1.0` as published in the git tag:

- **Not published to npm.** Install from GitHub if you want to experiment. The primary product — [`@chrbailey/promptspeak-mcp-server`](https://github.com/chrbailey/promptspeak-mcp-server) — is on npm at v0.4.2 with 834 passing tests and 55 MCP tools. If you are not on the Vercel AI SDK, use the MCP server directly.
- **`wrapStream` is a pass-through.** The TransformStream that buffers tool-call chunks is explicitly `TODO(v0.2.0)` in the source. If you use `streamText` instead of `generateText`, tool calls are **not** intercepted.
- **AI SDK version.** `peerDependencies` declare `ai >= 4.0.0`. Compatibility with `ai` v5+ and v6 has not been verified on `main`.
- **Not battle-tested in production.** The MCP server is; this adapter is not.

## Why this adapter exists

Vercel AI SDK agents can benefit from the same pre-execution governance that the PromptSpeak MCP server provides (drift detection, circuit breakers, sensitive-data scanning, hold queue for human-in-the-loop approval) — but wiring up an MCP server from inside an `ai`-package agent is high-friction. This adapter collapses the integration to one middleware call or one tool wrapper.
