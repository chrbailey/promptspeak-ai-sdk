import { describe, it, expect, beforeEach, vi } from 'vitest';
import { governedTool, resetSharedGatekeeper } from '../src/governed-tool.js';
import type { GovernanceInterception } from '../src/types.js';

describe('governedTool', () => {
  beforeEach(() => {
    resetSharedGatekeeper();
  });

  describe('wrapping', () => {
    it('should preserve tool shape', () => {
      const original = {
        description: 'Test tool',
        parameters: {},
        execute: async (args: Record<string, unknown>) => ({ result: 'ok' }),
      };
      const governed = governedTool(original);
      expect(governed.description).toBe('Test tool');
      expect(governed.execute).toBeDefined();
    });

    it('should preserve custom properties', () => {
      const original = {
        description: 'My tool',
        execute: async () => 'result',
        customProp: 'custom',
      };
      const governed = governedTool(original);
      expect(governed.customProp).toBe('custom');
    });
  });

  describe('execution', () => {
    it('should execute when governance allows', async () => {
      const executeFn = vi.fn().mockResolvedValue({ data: 'success' });
      const governed = governedTool(
        { description: 'safe read', execute: executeFn },
        { frame: '⊕◊▶α', sensitiveDataCheck: false },
      );
      const result = await governed.execute!({ key: 'value' });
      expect(result).toBeDefined();
    });

    it('should block with sensitive data', async () => {
      const executeFn = vi.fn();
      const onBlocked = vi.fn();
      const governed = governedTool(
        { description: 'send data', execute: executeFn },
        { sensitiveDataCheck: true, onBlocked },
      );
      const result = await governed.execute!({ message: 'SSN: 123-45-6789' });
      const interception = result as GovernanceInterception;
      expect(interception.allowed).toBe(false);
      expect(interception.reason).toContain('Sensitive data');
      expect(executeFn).not.toHaveBeenCalled();
    });

    it('should block API keys in arguments', async () => {
      const executeFn = vi.fn();
      const governed = governedTool(
        { description: 'make request', execute: executeFn },
        { sensitiveDataCheck: true },
      );
      const result = await governed.execute!({
        headers: { authorization: 'Bearer sk-1234567890abcdef1234567890abcdef' },
      });
      const interception = result as GovernanceInterception;
      expect(interception.allowed).toBe(false);
      expect(executeFn).not.toHaveBeenCalled();
    });

    it('should throw if tool has no execute function', async () => {
      const governed = governedTool(
        { description: 'no execute' },
        { sensitiveDataCheck: false },
      );
      await expect(governed.execute!({})).rejects.toThrow('no execute function');
    });
  });

  describe('agent tracking', () => {
    it('should use provided agent ID', async () => {
      const onBlocked = vi.fn();
      const governed = governedTool(
        { description: 'tracked', execute: async () => 'ok' },
        { agentId: 'custom-42', sensitiveDataCheck: true, onBlocked },
      );
      await governed.execute!({ data: 'SSN: 999-88-7777' });
      expect(onBlocked).toHaveBeenCalled();
      expect(onBlocked.mock.calls[0][0].agentId).toBe('custom-42');
    });
  });
});
