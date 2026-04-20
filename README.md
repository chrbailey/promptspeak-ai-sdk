# @promptspeak/ai-sdk

> Vercel AI SDK companion for [promptspeak-mcp-server](https://github.com/chrbailey/promptspeak-mcp-server). Middleware and tool wrappers that route agent tool calls through PromptSpeak's governance pipeline.

## What this is

A small TypeScript library (~15KB source across 4 files) that adapts PromptSpeak's `Gatekeeper` for use with Vercel AI SDK (`ai` package v4+). It exposes two integration points:

- `promptSpeakMiddleware(config)` — a `LanguageModelV1Middleware` that intercepts tool calls returned by `generateText` / `streamText` and allows, blocks, or holds them based on governance rules.
- `governedTool(aiTool, config)` — a wrapper that adds governance to individual AI SDK tools so `execute()` runs through the `Gatekeeper` before reaching the tool body.

Under the hood it re-exports the governance primitives from `promptspeak-mcp-server` (the primary product), so consumers can import `Gatekeeper`, `DriftDetectionEngine`, `containsSensitiveData`, and the mode/level constants from this package directly.

## When to use it

- You are building an agent on the Vercel AI SDK and want pre-execution governance on tool calls.
- You want drift detection, circuit breakers, sensitive-data scanning, and a hold queue for human-in-the-loop approval.
- You already know about [promptspeak-mcp-server](https://github.com/chrbailey/promptspeak-mcp-server) and want a lower-friction integration than wiring the MCP server yourself.

If you are not on the Vercel AI SDK, use the MCP server directly instead.

## Install

```bash
npm install @promptspeak/ai-sdk ai
# zod is an optional peer dep if your tools use zod schemas
```

Requires Node.js >= 20 and `ai` >= 4.0.0.

## Minimal example

```ts
import { generateText } from 'ai';
import { promptSpeakMiddleware } from '@promptspeak/ai-sdk';
import { wrapLanguageModel } from 'ai';

const model = wrapLanguageModel({
  model: yourProviderModel,
  middleware: promptSpeakMiddleware({
    mode: 'standard',           // 'strict' | 'standard' | 'flexible' | 'permissive'
    driftThreshold: 0.15,
    sensitiveData: true,
    onBlocked: (event) => console.warn('blocked', event),
    onHeld:    (hold)  => console.warn('held', hold.holdId),
    onDrift:   (alerts) => console.warn('drift', alerts),
  }),
});

const result = await generateText({ model, prompt: '...', tools: {...} });
```

For per-tool governance:

```ts
import { governedTool } from '@promptspeak/ai-sdk';

const safeSend = governedTool(sendEmailTool, {
  sensitiveDataCheck: true,
  onHeld: (hold) => queueForApproval(hold),
});
```

## Status

**Experimental / pre-1.0.** Version is `0.1.0`. Published behavior:

- `wrapGenerate` path is implemented and tested.
- `wrapStream` is a pass-through — a TransformStream that buffers tool-call chunks is explicitly marked `TODO(v0.2.0)` in the source. If you use `streamText`, tool calls are currently **not** intercepted.
- `peerDependencies` declare `ai >= 4.0.0`. Compatibility with `ai` v5+ has not been verified.
- Not published to npm as of this writing. Install from the GitHub repo if you want to experiment.

## What this is NOT

- **Not the primary PromptSpeak product.** That is [promptspeak-mcp-server](https://github.com/chrbailey/promptspeak-mcp-server) — 62K LOC, 834 tests, 55 MCP tools, v0.4.1 on npm as `@chrbailey/promptspeak-mcp-server`. This package is a thin adapter on top of it.
- Not a drop-in replacement for the MCP server. Features like the hold queue UI, audit trail export, and approval bridge live in the server.
- Not battle-tested in production. The MCP server is; this adapter is not.

## Tests

```bash
npm install
npm test           # vitest run
```

Two test files: `tests/middleware.test.ts`, `tests/governed-tool.test.ts`.

## Related

- [promptspeak-mcp-server](https://github.com/chrbailey/promptspeak-mcp-server) — primary product, MCP server implementation
- npm: `@chrbailey/promptspeak-mcp-server`

## License

MIT. See [LICENSE](LICENSE).
