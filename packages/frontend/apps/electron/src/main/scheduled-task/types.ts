/**
 * Shared types for the main-process scheduled-task execution engine.
 * Kept separate from the renderer-side types to avoid cross-bundle imports.
 */

export type FrequencyType =
  | 'daily'
  | 'weekdays'
  | 'weekly'
  | 'monthly'
  | 'custom';
export type TaskStatus = 'active' | 'paused' | 'needs-setup' | 'failed';
export type RunStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'missed'
  | 'needs_attention';

/** Minimal task representation the scheduler needs to set up timers. */
export interface SchedulerTask {
  id: string;
  name: string;
  prompt: string;
  frequencyType: FrequencyType;
  /** 'HH:mm' in the user's local timezone */
  localTime: string;
  /** IANA timezone string, e.g. 'America/New_York' */
  timezone: string;
  status: TaskStatus;
  destinationDocId?: string;
  /** Model override for this task, e.g. 'claude-opus-4-6'. Defaults to control plane default. */
  model?: string;
  /** Allow web search in this task's run. Defaults to true. */
  webAccess?: boolean;
  /** Enable extended thinking for this task's runs */
  thinking?: boolean;
  /** Per-task agentic effort level */
  effortLevel?: 'low' | 'medium' | 'high';
}

export interface SchedulerRun {
  id: string;
  taskId: string;
  scheduledFor?: string;
  startedAt?: string;
  finishedAt?: string;
  status: RunStatus;
  summary?: string;
  errorMessage?: string;
  /** Document ID created or updated by this run */
  outputDocId?: string;
  /** Human-readable title of the output document */
  outputDocTitle?: string;
  /**
   * True when this run was started as a catch-up for a slot that was missed
   * while the app was unavailable. The UI should show "ran late".
   */
  catchup?: boolean;
  /**
   * Milliseconds between the intended scheduledFor slot and the actual
   * startedAt. Only set when catchup === true.
   */
  overdueByMs?: number;
  /**
   * What triggered this run: a scheduled timer, a user "Run now" click,
   * or a startup catch-up. Recovery only anchors on 'schedule' or 'catchup'
   * runs — manual runs must not fill a scheduled slot.
   */
  triggeredBy?: 'schedule' | 'manual' | 'catchup';
}

export type RunEventType = 'started' | 'updated' | 'finished';

export interface RunEventPayload {
  event: RunEventType;
  run: SchedulerRun;
  taskId: string;
}
