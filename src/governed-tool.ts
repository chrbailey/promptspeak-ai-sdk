import {
  Gatekeeper,
  containsSensitiveData,
} from 'promptspeak-mcp-server';

import type { GovernedToolConfig, GovernanceEvent, GovernanceInterception } from './types.js';

interface AiSdkTool<TParams = Record<string, unknown>, TResult = unknown> {
  description?: string;
  parameters?: unknown;
  execute?: (args: TParams, options?: unknown) => Promise<TResult>;
  [key: string]: unknown;
}

let toolEventCounter = 0;

function generateToolEventId(): string {
  return `pst_${Date.now()}_${++toolEventCounter}`;
}

function generateToolAgentId(): string {
  return `tool_agent_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

let sharedGatekeeper: Gatekeeper | null = null;

function getSharedGatekeeper(): Gatekeeper {
  if (!sharedGatekeeper) {
    sharedGatekeeper = new Gatekeeper({
      enablePeriodicCleanup: false,
    });
  }
  return sharedGatekeeper;
}

export function resetSharedGatekeeper(): void {
  if (sharedGatekeeper) {
    sharedGatekeeper.stopPeriodicCleanup();
    sharedGatekeeper = null;
  }
}

export function governedTool<
  TParams extends Record<string, unknown> = Record<string, unknown>,
  TResult = unknown,
>(
  aiTool: AiSdkTool<TParams, TResult>,
  config: GovernedToolConfig = {},
): AiSdkTool<TParams, TResult | GovernanceInterception> {
  const {
    frame = '⊕◊▶α',
    sensitiveDataCheck = true,
    agentId: configAgentId,
    onBlocked,
    onHeld,
  } = config;

  const agentId = configAgentId || generateToolAgentId();
  const gatekeeper = getSharedGatekeeper();

  const toolName = (aiTool.description || 'unnamed_tool')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .substring(0, 64);

  const governed: AiSdkTool<TParams, TResult | GovernanceInterception> = {
    ...aiTool,
    execute: async (
      args: TParams,
      options?: unknown,
    ): Promise<TResult | GovernanceInterception> => {
      if (!aiTool.execute) {
        throw new Error('Tool has no execute function');
      }

      const toolArgs = args as Record<string, unknown>;

      if (sensitiveDataCheck) {
        const argsString = JSON.stringify(toolArgs);
        if (containsSensitiveData(argsString)) {
          const event: GovernanceEvent = {
            eventId: generateToolEventId(),
            timestamp: Date.now(),
            tool: toolName,
            arguments: toolArgs,
            decision: 'blocked',
            reason: 'Sensitive data detected in tool arguments',
            agentId,
            frame,
          };
          onBlocked?.(event);
          return {
            allowed: false,
            held: false,
            reason: event.reason,
          };
        }
      }

      const result = gatekeeper.execute({
        agentId,
        frame,
        tool: toolName,
        arguments: toolArgs,
      });

      if (result.held && result.holdRequest) {
        const event: GovernanceEvent = {
          eventId: generateToolEventId(),
          timestamp: Date.now(),
          tool: toolName,
          arguments: toolArgs,
          decision: 'held',
          reason: result.holdRequest.reason,
          agentId,
          frame,
          executeResult: result,
          holdRequest: result.holdRequest,
        };
        onHeld?.(result.holdRequest);
        return {
          allowed: false,
          held: true,
          reason: result.holdRequest.reason,
          holdId: result.holdRequest.holdId,
        };
      }

      if (!result.allowed) {
        const event: GovernanceEvent = {
          eventId: generateToolEventId(),
          timestamp: Date.now(),
          tool: toolName,
          arguments: toolArgs,
          decision: 'blocked',
          reason: result.error || 'Blocked by governance pipeline',
          agentId,
          frame,
          executeResult: result,
        };
        onBlocked?.(event);
        return {
          allowed: false,
          held: false,
          reason: event.reason,
        };
      }

      return aiTool.execute(args, options);
    },
  };

  return governed;
}
