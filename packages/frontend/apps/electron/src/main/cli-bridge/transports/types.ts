/**
 * Unified event type emitted by any CLI transport.
 * Normalizes Claude Code NDJSON events and Copilot ACP session updates
 * into a single shape the control plane and renderer both consume.
 */

export type PermissionMode = 'default' | 'ask' | 'allow-all';

export interface CLIModel {
  id: string;
  label: string;
  category: string;
  version: string;
}

export interface RuntimeOptions {
  models: CLIModel[];
  selectedModel: string | null;
  permissionMode: PermissionMode;
}

export type CLIEvent =
  | {
      type: 'session_init';
      sessionId: string;
      tools: string[];
      model: string;
    }
  | { type: 'text_chunk'; text: string }
  | {
      type: 'tool_call';
      toolName: string;
      toolId: string;
      input?: unknown;
    }
  | { type: 'tool_result'; toolId: string; success: boolean; output?: string }
  | {
      type: 'task_complete';
      text: string;
      costUsd?: number;
      durationMs?: number;
    }
  | { type: 'error'; message: string }
  | {
      type: 'permission_request';
      questionId: string;
      toolName: string;
      description: string;
      options: PermissionOption[];
    }
  | { type: 'rate_limit'; retryAfterMs: number };

export interface PermissionOption {
  id: string;
  label: string;
  /** Informs the UI how destructive this operation is */
  dangerLevel?: 'low' | 'medium' | 'high';
}

export interface TransportStartOptions {
  /** For resuming a prior Claude session */
  sessionId?: string;
  /** Working directory for CLI process */
  workingDir?: string;
  /** Injected via --append-system-prompt */
  systemPrompt?: string;
  /** Port of the AFFiNE local REST server */
  localServerPort?: number;
  /** Override model (e.g. claude-opus-4-5) */
  model?: string;
  /** Tools that are pre-approved without showing a permission card */
  allowedTools?: string[];
  /** Hard limit on agentic turns */
  maxTurns?: number;
  /** Localhost port of the permission hook HTTP server */
  hookPort?: number;
}

export interface ITransport {
  /**
   * Run one prompt turn. Spawns (or resumes) the CLI process.
   * Yields CLIEvents as they arrive. Resolves when the model's turn ends.
   */
  prompt(
    text: string,
    opts: TransportStartOptions,
    signal?: AbortSignal,
    attachments?: string[]
  ): AsyncIterable<CLIEvent>;

  /** Kill any running process */
  stop(): void;
}
