import { describe, it, expect, vi } from 'vitest';
import { promptSpeakMiddleware, createGatekeeper } from '../src/middleware.js';
import type { PromptSpeakMiddlewareConfig, GovernanceEvent } from '../src/types.js';

describe('promptSpeakMiddleware', () => {
  describe('factory', () => {
    it('should create middleware with default config', () => {
      const middleware = promptSpeakMiddleware();
      expect(middleware).toBeDefined();
      expect(middleware.specificationVersion).toBe('v3');
      expect(typeof middleware.transformParams).toBe('function');
      expect(typeof middleware.wrapGenerate).toBe('function');
      expect(typeof middleware.wrapStream).toBe('function');
    });

    it('should accept all configuration options', () => {
      const config: PromptSpeakMiddlewareConfig = {
        mode: 'strict',
        driftThreshold: 0.1,
        sensitiveData: true,
        maxAutonomyLevel: 'guided',
        agentId: 'test-agent',
        defaultFrame: '⊘◈▶α',
        onBlocked: () => {},
        onHeld: () => {},
        onDrift: () => {},
        onDecision: () => {},
      };
      const middleware = promptSpeakMiddleware(config);
      expect(middleware).toBeDefined();
      expect(middleware.specificationVersion).toBe('v3');
    });
  });

  describe('transformParams', () => {
    it('should inject governance metadata into params', async () => {
      const middleware = promptSpeakMiddleware({
        agentId: 'test-agent-123',
        mode: 'strict',
      });
      const result = await middleware.transformParams!({
        type: 'generate',
        params: { prompt: 'hello' },
        model: {},
      });
      expect(result).toBeDefined();
      const meta = (result as Record<string, unknown>)._promptSpeak as Record<string, unknown>;
      expect(meta.agentId).toBe('test-agent-123');
      expect(meta.mode).toBe('strict');
    });

    it('should preserve existing params', async () => {
      const middleware = promptSpeakMiddleware();
      const result = await middleware.transformParams!({
        type: 'generate',
        params: { prompt: 'hello' },
        model: {},
      });
      expect((result as Record<string, unknown>).prompt).toBe('hello');
    });
  });

  describe('wrapGenerate', () => {
    it('should pass through responses with no tool calls', async () => {
      const middleware = promptSpeakMiddleware();
      const mockResult = {
        content: [{ type: 'text' as const, text: 'Hello!' }],
        finishReason: { type: 'stop' },
        usage: { inputTokens: 10, outputTokens: 5 },
      };
      const result = await middleware.wrapGenerate!({
        doGenerate: async () => mockResult,
        doStream: async () => ({ stream: new ReadableStream() }),
        params: {},
        model: {},
      });
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toEqual({ type: 'text', text: 'Hello!' });
    });

    it('should evaluate tool calls through governance', async () => {
      const onDecision = vi.fn();
      const middleware = promptSpeakMiddleware({ mode: 'standard', onDecision });
      const mockResult = {
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: 'call_1',
            toolName: 'readFile',
            input: { path: '/tmp/test.txt' },
          },
        ],
        finishReason: { type: 'tool-calls' },
        usage: { inputTokens: 10, outputTokens: 5 },
      };
      const result = await middleware.wrapGenerate!({
        doGenerate: async () => mockResult,
        doStream: async () => ({ stream: new ReadableStream() }),
        params: {},
        model: {},
      });
      expect(onDecision).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should block tool calls with sensitive data', async () => {
      const onBlocked = vi.fn();
      const middleware = promptSpeakMiddleware({ sensitiveData: true, onBlocked });
      const mockResult = {
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: 'call_1',
            toolName: 'sendEmail',
            input: { body: 'SSN is 123-45-6789' },
          },
        ],
        finishReason: { type: 'tool-calls' },
        usage: { inputTokens: 10, outputTokens: 5 },
      };
      const result = await middleware.wrapGenerate!({
        doGenerate: async () => mockResult,
        doStream: async () => ({ stream: new ReadableStream() }),
        params: {},
        model: {},
      });
      expect(onBlocked).toHaveBeenCalled();
      const toolCalls = result.content.filter(c => c.type === 'tool-call');
      expect(toolCalls.length).toBe(0);
      const textItems = result.content.filter(c => c.type === 'text');
      expect(textItems.length).toBeGreaterThan(0);
      expect((textItems[0] as { text: string }).text).toContain('[PromptSpeak]');
    });

    it('should handle malformed tool call input', async () => {
      const middleware = promptSpeakMiddleware();
      const mockResult = {
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: 'call_1',
            toolName: 'action',
            input: 'not valid json{{{',
          },
        ],
        finishReason: { type: 'tool-calls' },
        usage: { inputTokens: 10, outputTokens: 5 },
      };
      const result = await middleware.wrapGenerate!({
        doGenerate: async () => mockResult,
        doStream: async () => ({ stream: new ReadableStream() }),
        params: {},
        model: {},
      });
      expect(result).toBeDefined();
    });
  });

  describe('callbacks', () => {
    it('should invoke onDecision for every tool call', async () => {
      const decisions: GovernanceEvent[] = [];
      const middleware = promptSpeakMiddleware({
        onDecision: (event) => decisions.push(event),
      });
      const mockResult = {
        content: [
          { type: 'tool-call' as const, toolCallId: '1', toolName: 'a', input: {} },
          { type: 'tool-call' as const, toolCallId: '2', toolName: 'b', input: {} },
        ],
        finishReason: { type: 'tool-calls' },
        usage: { inputTokens: 10, outputTokens: 5 },
      };
      await middleware.wrapGenerate!({
        doGenerate: async () => mockResult,
        doStream: async () => ({ stream: new ReadableStream() }),
        params: {},
        model: {},
      });
      expect(decisions.length).toBe(2);
    });
  });
});

describe('createGatekeeper', () => {
  it('should create a configured Gatekeeper', () => {
    const gk = createGatekeeper({ mode: 'strict', driftThreshold: 0.1 });
    expect(gk).toBeDefined();
    expect(typeof gk.execute).toBe('function');
    gk.stopPeriodicCleanup();
  });
});
