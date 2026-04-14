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
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed';

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
}

export type RunEventType = 'started' | 'updated' | 'finished';

export interface RunEventPayload {
  event: RunEventType;
  run: SchedulerRun;
  taskId: string;
}
