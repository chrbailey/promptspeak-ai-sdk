export {
  promptSpeakMiddleware,
  createGatekeeper,
} from './middleware.js';

export type { PromptSpeakMiddleware } from './middleware.js';

export {
  governedTool,
  resetSharedGatekeeper,
} from './governed-tool.js';

export type {
  MiddlewareMode,
  PromptSpeakMiddlewareConfig,
  GovernedToolConfig,
  GovernedMCPClientConfig,
  GovernanceEvent,
  GovernanceInterception,
} from './types.js';

export {
  Gatekeeper,
  DriftDetectionEngine,
  containsSensitiveData,
  checkImmutableConstraints,
  GOVERNANCE_MODES,
  AUTONOMY_RANK,
} from 'promptspeak-mcp-server';

export type {
  GovernanceMode,
  AutonomyLevel,
  ExecuteRequest,
  ExecuteResult,
  HoldRequest,
  HoldDecision,
  DriftAlert,
  InterceptorDecision,
  PreFlightCheck,
  ConfidenceThresholds,
} from 'promptspeak-mcp-server';
