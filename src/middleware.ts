import {
  Gatekeeper,
  containsSensitiveData,
} from 'promptspeak-mcp-server';

import type { ExecuteResult, DriftAlert } from 'promptspeak-mcp-server';
import type { PromptSpeakMiddlewareConfig, MiddlewareMode, GovernanceEvent } from './types.js';

// V3 content types — matches LanguageModelV3ToolCallPart
interface ToolCallContent {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  input: unknown;
  providerExecuted?: boolean;
}

interface TextContent {
  type: 'text';
  text: string;
}

type ContentItem = ToolCallContent | TextContent | { type: string; [key: string]: unknown };

interface GenerateResult {
  content: ContentItem[];
  finishReason: { type: string; [key: string]: unknown };
  usage: { inputTokens: number; outputTokens: number };
  providerMetadata?: Record<string, unknown>;
  request?: { body?: unknown };
  response?: Record<string, unknown>;
  [key: string]: unknown;
}

interface CallOptions {
  [key: string]: unknown;
}

interface StreamResult {
  stream: ReadableStream;
  [key: string]: unknown;
}

interface ModelRef {
  [key: string]: unknown;
}

export interface PromptSpeakMiddleware {
  readonly specificationVersion: 'v3';

  transformParams?: (options: {
    type: 'generate' | 'stream';
    params: CallOptions;
    model: ModelRef;
  }) => Promise<CallOptions>;

  wrapGenerate?: (options: {
    doGenerate: () => Promise<GenerateResult>;
    doStream: () => Promise<StreamResult>;
    params: CallOptions;
    model: ModelRef;
  }) => Promise<GenerateResult>;

  wrapStream?: (options: {
    doGenerate: () => Promise<GenerateResult>;
    doStream: () => Promise<StreamResult>;
    params: CallOptions;
    model: ModelRef;
  }) => Promise<StreamResult>;
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
    specificationVersion: 'v3' as const,

    async transformParams({ params }) {
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

    async wrapGenerate({ doGenerate }) {
      const result = await doGenerate();

      // Extract tool calls from V3 content array
      const toolCalls = result.content.filter(
        (item): item is ToolCallContent => item.type === 'tool-call',
      );

      if (toolCalls.length === 0) {
        return result;
      }

      const allowedContent: ContentItem[] = [];
      const blockedMessages: string[] = [];

      for (const item of result.content) {
        if (item.type !== 'tool-call') {
          allowedContent.push(item);
          continue;
        }

        const toolCall = item as ToolCallContent;
        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = typeof toolCall.input === 'string'
            ? JSON.parse(toolCall.input)
            : (toolCall.input as Record<string, unknown>) ?? {};
        } catch {
          parsedArgs = {};
        }

        const event = evaluateToolCall(toolCall.toolName, parsedArgs);

        if (event.decision === 'allowed') {
          allowedContent.push(toolCall);
        } else {
          blockedMessages.push(
            `[PromptSpeak] Tool "${toolCall.toolName}" ${event.decision}: ${event.reason}`,
          );
        }
      }

      if (blockedMessages.length > 0) {
        allowedContent.push({
          type: 'text',
          text: blockedMessages.join('\n'),
        });
      }

      return {
        ...result,
        content: allowedContent,
      };
    },

    async wrapStream({ doStream }) {
      const streamResult = await doStream();
      // TODO(v0.3.0): TransformStream that buffers tool call chunks
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
