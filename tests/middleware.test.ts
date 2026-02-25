import { describe, it, expect, vi } from 'vitest';
import { promptSpeakMiddleware, createGatekeeper } from '../src/middleware.js';
import type { PromptSpeakMiddlewareConfig, GovernanceEvent } from '../src/types.js';

describe('promptSpeakMiddleware', () => {
  describe('factory', () => {
    it('should create middleware with default config', () => {
      const middleware = promptSpeakMiddleware();
      expect(middleware).toBeDefined();
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
    });
  });

  describe('transformParams', () => {
    it('should inject governance metadata into params', () => {
      const middleware = promptSpeakMiddleware({
        agentId: 'test-agent-123',
        mode: 'strict',
      });
      const result = middleware.transformParams!({ params: { prompt: 'hello' } });
      expect(result).toBeDefined();
      const meta = (result as Record<string, unknown>)._promptSpeak as Record<string, unknown>;
      expect(meta.agentId).toBe('test-agent-123');
      expect(meta.mode).toBe('strict');
    });

    it('should preserve existing params', () => {
      const middleware = promptSpeakMiddleware();
      const result = middleware.transformParams!({ params: { prompt: 'hello' } });
      expect((result as Record<string, unknown>).prompt).toBe('hello');
    });
  });

  describe('wrapGenerate', () => {
    it('should pass through responses with no tool calls', async () => {
      const middleware = promptSpeakMiddleware();
      const mockResult = { text: 'Hello!', toolCalls: [], finishReason: 'stop' };
      const result = await middleware.wrapGenerate!({
        doGenerate: async () => mockResult,
        params: {},
      });
      expect(result.text).toBe('Hello!');
    });

    it('should evaluate tool calls through governance', async () => {
      const onDecision = vi.fn();
      const middleware = promptSpeakMiddleware({ mode: 'standard', onDecision });
      const mockResult = {
        text: '',
        toolCalls: [{
          toolCallType: 'function' as const,
          toolCallId: 'call_1',
          toolName: 'readFile',
          args: JSON.stringify({ path: '/tmp/test.txt' }),
        }],
        finishReason: 'tool-calls',
      };
      const result = await middleware.wrapGenerate!({
        doGenerate: async () => mockResult,
        params: {},
      });
      expect(onDecision).toHaveBeenCalled();
      expect(result).toBeDefined();
    });

    it('should block tool calls with sensitive data', async () => {
      const onBlocked = vi.fn();
      const middleware = promptSpeakMiddleware({ sensitiveData: true, onBlocked });
      const mockResult = {
        text: '',
        toolCalls: [{
          toolCallType: 'function' as const,
          toolCallId: 'call_1',
          toolName: 'sendEmail',
          args: JSON.stringify({ body: 'SSN is 123-45-6789' }),
        }],
        finishReason: 'tool-calls',
      };
      const result = await middleware.wrapGenerate!({
        doGenerate: async () => mockResult,
        params: {},
      });
      expect(onBlocked).toHaveBeenCalled();
      expect(result.toolCalls?.length).toBe(0);
      expect(result.text).toContain('[PromptSpeak]');
    });

    it('should handle malformed tool call args', async () => {
      const middleware = promptSpeakMiddleware();
      const mockResult = {
        text: '',
        toolCalls: [{
          toolCallType: 'function' as const,
          toolCallId: 'call_1',
          toolName: 'action',
          args: 'not valid json{{{',
        }],
        finishReason: 'tool-calls',
      };
      const result = await middleware.wrapGenerate!({
        doGenerate: async () => mockResult,
        params: {},
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
        text: '',
        toolCalls: [
          { toolCallType: 'function' as const, toolCallId: '1', toolName: 'a', args: '{}' },
          { toolCallType: 'function' as const, toolCallId: '2', toolName: 'b', args: '{}' },
        ],
        finishReason: 'tool-calls',
      };
      await middleware.wrapGenerate!({
        doGenerate: async () => mockResult,
        params: {},
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
