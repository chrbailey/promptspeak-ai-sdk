import {
  Gatekeeper,
  containsSensitiveData,
} from 'promptspeak-mcp-server';

import type { ExecuteResult, DriftAlert } from 'promptspeak-mcp-server';
import type { PromptSpeakMiddlewareConfig, MiddlewareMode, GovernanceEvent } from './types.js';

interface ToolCall {
  toolCallType: 'function';
  toolCallId: string;
  toolName: string;
  args: string;
}

interface GenerateResult {
  text?: string;
  toolCalls?: ToolCall[];
  toolResults?: unknown[];
  finishReason?: string;
  usage?: { promptTokens: number; completionTokens: number };
  [key: string]: unknown;
}

interface GenerateParams {
  prompt?: unknown;
  mode?: unknown;
  [key: string]: unknown;
}

export interface PromptSpeakMiddleware {
  transformParams?: (options: {
    params: GenerateParams;
  }) => Promise<GenerateParams> | GenerateParams;

  wrapGenerate?: (options: {
    doGenerate: () => Promise<GenerateResult>;
    params: GenerateParams;
  }) => Promise<GenerateResult>;

  wrapStream?: (options: {
    doStream: () => Promise<{
      stream: ReadableStream;
      [key: string]: unknown;
    }>;
    params: GenerateParams;
  }) => Promise<{
    stream: ReadableStream;
    [key: string]: unknown;
  }>;
}

let eventCounter = 0;

function generateEventId(): string {
  return `psg_${Date.now()}_${++eventCounter}`;
}

function generateAgentId(): string {
  return `agent_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function createGovernanceEvent(
  tool: string,
  args: Record<string, unknown>,
  decision: 'allowed' | 'blocked' | 'held',
  reason: string,
  agentId: string,
  frame: string,
  extra?: Partial<GovernanceEvent>,
): GovernanceEvent {
  return {
    eventId: generateEventId(),
    timestamp: Date.now(),
    tool,
    arguments: args,
    decision,
    reason,
    agentId,
    frame,
    ...extra,
  };
}

export function promptSpeakMiddleware(
  config: PromptSpeakMiddlewareConfig = {},
): PromptSpeakMiddleware {
  const {
    mode = 'standard',
    driftThreshold = 0.15,
    sensitiveData = true,
    agentId: configAgentId,
    defaultFrame = '⊕◊▶α',
    onBlocked,
    onHeld,
    onDrift,
    onDecision,
  } = config;

  const gatekeeper = new Gatekeeper({
    enablePeriodicCleanup: false,
  });

  gatekeeper.setExecutionControlConfig({
    enablePreFlightDriftPrediction: true,
    driftPredictionThreshold: driftThreshold,
    enableCircuitBreakerCheck: true,
    enableBaselineComparison: true,
    baselineDeviationThreshold: driftThreshold * 2,
    holdOnDriftPrediction: mode !== 'permissive',
    holdOnLowConfidence: mode === 'strict',
    holdOnForbiddenWithOverride: false,
    holdTimeoutMs: 30000,
    enableMcpValidation: false,
    mcpValidationTools: [],
    haltOnCriticalDrift: true,
    haltOnHighDrift: mode === 'strict',
  });

  const agentId = configAgentId || generateAgentId();

  function evaluateToolCall(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): GovernanceEvent {
    if (sensitiveData) {
      const argsString = JSON.stringify(toolArgs);
      if (containsSensitiveData(argsString)) {
        const event = createGovernanceEvent(
          toolName,
          toolArgs,
          'blocked',
          'Sensitive data detected in tool arguments',
          agentId,
          defaultFrame,
        );
        onBlocked?.(event);
        onDecision?.(event);
        return event;
      }
    }

    const result: ExecuteResult = gatekeeper.execute({
      agentId,
      frame: defaultFrame,
      tool: toolName,
      arguments: toolArgs,
    });

    if (result.held && result.holdRequest) {
      const event = createGovernanceEvent(
        toolName,
        toolArgs,
        'held',
        result.holdRequest.reason,
        agentId,
        defaultFrame,
        {
          executeResult: result,
          holdRequest: result.holdRequest,
        },
      );
      onHeld?.(result.holdRequest);
      onDecision?.(event);
      return event;
    }

    if (!result.allowed) {
      const event = createGovernanceEvent(
        toolName,
        toolArgs,
        'blocked',
        result.error || 'Blocked by governance pipeline',
        agentId,
        defaultFrame,
        { executeResult: result },
      );
      onBlocked?.(event);
      onDecision?.(event);
      return event;
    }

    if (result.postAudit?.driftDetected && result.postAudit.alerts.length > 0) {
      onDrift?.(result.postAudit.alerts);
    }

    const event = createGovernanceEvent(
      toolName,
      toolArgs,
      'allowed',
      'Passed governance pipeline',
      agentId,
      defaultFrame,
      {
        executeResult: result,
        driftAlerts: result.postAudit?.alerts,
      },
    );
    onDecision?.(event);
    return event;
  }

  return {
    transformParams({ params }) {
      return {
        ...params,
        _promptSpeak: {
          agentId,
          mode,
          driftThreshold,
          frame: defaultFrame,
        },
      };
    },

    async wrapGenerate({ doGenerate, params: _params }) {
      const result = await doGenerate();

      if (!result.toolCalls || result.toolCalls.length === 0) {
        return result;
      }

      const allowedToolCalls: ToolCall[] = [];
      const blockedMessages: string[] = [];

      for (const toolCall of result.toolCalls) {
        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = JSON.parse(toolCall.args);
        } catch {
          parsedArgs = {};
        }

        const event = evaluateToolCall(toolCall.toolName, parsedArgs);

        if (event.decision === 'allowed') {
          allowedToolCalls.push(toolCall);
        } else {
          blockedMessages.push(
            `[PromptSpeak] Tool "${toolCall.toolName}" ${event.decision}: ${event.reason}`,
          );
        }
      }

      const modifiedResult: GenerateResult = {
        ...result,
        toolCalls: allowedToolCalls,
      };

      if (blockedMessages.length > 0) {
        const governanceNote = blockedMessages.join('\n');
        modifiedResult.text = result.text
          ? `${result.text}\n\n${governanceNote}`
          : governanceNote;
      }

      return modifiedResult;
    },

    async wrapStream({ doStream, params: _params }) {
      const streamResult = await doStream();
      // TODO(v0.2.0): TransformStream that buffers tool call chunks
      return streamResult;
    },
  };
}

export function createGatekeeper(
  config: PromptSpeakMiddlewareConfig = {},
): Gatekeeper {
  const {
    driftThreshold = 0.15,
    mode = 'standard',
  } = config;

  const gatekeeper = new Gatekeeper({
    enablePeriodicCleanup: false,
  });

  gatekeeper.setExecutionControlConfig({
    enablePreFlightDriftPrediction: true,
    driftPredictionThreshold: driftThreshold,
    enableCircuitBreakerCheck: true,
    enableBaselineComparison: true,
    baselineDeviationThreshold: driftThreshold * 2,
    holdOnDriftPrediction: mode !== 'permissive',
    holdOnLowConfidence: mode === 'strict',
    holdOnForbiddenWithOverride: false,
    holdTimeoutMs: 30000,
    enableMcpValidation: false,
    mcpValidationTools: [],
    haltOnCriticalDrift: true,
    haltOnHighDrift: mode === 'strict',
  });

  return gatekeeper;
}
