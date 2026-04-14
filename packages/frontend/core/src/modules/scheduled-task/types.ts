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
export type OutputMode = 'single-doc';

export interface ScheduledTask {
  id: string;
  name: string;
  prompt: string;
  frequencyType: FrequencyType;
  selectedDays?: number[];
  localTime?: string;
  timezone?: string;
  status: TaskStatus;
  outputMode: OutputMode;
  destinationDocId?: string;
  providerConfig?: Record<string, unknown>;
  /** AI model override for this task */
  model?: string;
  /** Whether web access is allowed for this task's runs */
  webAccess?: boolean;
  /** Enable extended thinking for this task's runs */
  thinking?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ScheduledRun {
  id: string;
  taskId: string;
  scheduledFor?: string;
  startedAt?: string;
  finishedAt?: string;
  status: RunStatus;
  summary?: string;
  errorState?: Record<string, unknown>;
  /** Document ID created or updated by this run */
  outputDocId?: string;
}

export interface CreateTaskInput {
  name: string;
  prompt: string;
  frequencyType?: FrequencyType;
  selectedDays?: number[];
  localTime?: string;
  timezone?: string;
  destinationDocId?: string;
  providerConfig?: Record<string, unknown>;
}
