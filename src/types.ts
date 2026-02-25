import type {
  AutonomyLevel,
  ExecuteResult,
  HoldRequest,
  DriftAlert,
} from 'promptspeak-mcp-server';

export type MiddlewareMode = 'strict' | 'standard' | 'flexible' | 'permissive';

export interface PromptSpeakMiddlewareConfig {
  mode?: MiddlewareMode;
  driftThreshold?: number;
  sensitiveData?: boolean;
  maxAutonomyLevel?: AutonomyLevel;
  agentId?: string;
  defaultFrame?: string;
  onBlocked?: (result: GovernanceEvent) => void;
  onHeld?: (holdRequest: HoldRequest) => void;
  onDrift?: (alerts: DriftAlert[]) => void;
  onDecision?: (event: GovernanceEvent) => void;
}

export interface GovernedToolConfig {
  frame?: string;
  sensitiveDataCheck?: boolean;
  maxAutonomyLevel?: AutonomyLevel;
  agentId?: string;
  onBlocked?: (result: GovernanceEvent) => void;
  onHeld?: (holdRequest: HoldRequest) => void;
}

export interface GovernedMCPClientConfig {
  transport: unknown;
  governance: {
    defaultFrame?: string;
    holdPatterns?: string[];
    toolFrames?: Record<string, string>;
    maxAutonomyLevel?: AutonomyLevel;
  };
}

export interface GovernanceEvent {
  eventId: string;
  timestamp: number;
  tool: string;
  arguments: Record<string, unknown>;
  decision: 'allowed' | 'blocked' | 'held';
  reason: string;
  agentId: string;
  frame: string;
  executeResult?: ExecuteResult;
  holdRequest?: HoldRequest;
  driftScore?: number;
  driftAlerts?: DriftAlert[];
}

export interface GovernanceInterception {
  allowed: false;
  held: boolean;
  reason: string;
  holdId?: string;
  suggestion?: string;
}
