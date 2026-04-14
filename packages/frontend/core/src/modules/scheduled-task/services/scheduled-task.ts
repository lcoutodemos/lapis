import { Service } from '@toeverything/infra';

import type { ScheduledTaskStore } from '../stores/scheduled-task';
import type { CreateTaskInput, ScheduledRun, ScheduledTask } from '../types';

export class ScheduledTaskService extends Service {
  constructor(private readonly store: ScheduledTaskStore) {
    super();
  }

  // ── Reactive state ─────────────────────────────────────────────────────

  tasks$ = this.store.watchTasks();

  task$(id: string) {
    return this.store.watchTask(id);
  }

  runsForTask$(taskId: string) {
    return this.store.watchRunsForTask(taskId);
  }

  // ── Mutations ──────────────────────────────────────────────────────────

  createTask(input: CreateTaskInput): ScheduledTask {
    return this.store.createTask(input);
  }

  updateTask(
    id: string,
    patch: Partial<
      Pick<
        ScheduledTask,
        | 'name'
        | 'prompt'
        | 'frequencyType'
        | 'selectedDays'
        | 'localTime'
        | 'timezone'
        | 'status'
        | 'destinationDocId'
        | 'providerConfig'
      >
    >
  ) {
    this.store.updateTask(id, patch);
  }

  deleteTask(id: string) {
    this.store.deleteTask(id);
  }

  activateTask(id: string) {
    this.store.updateTask(id, { status: 'active' });
  }

  pauseTask(id: string) {
    this.store.updateTask(id, { status: 'paused' });
  }

  createRun(taskId: string, scheduledFor?: string): ScheduledRun {
    return this.store.createRun(taskId, scheduledFor);
  }

  completeRun(runId: string, summary?: string) {
    this.store.updateRun(runId, {
      finishedAt: new Date().toISOString(),
      status: 'completed',
      summary,
    });
  }

  failRun(runId: string, error: Record<string, unknown>) {
    this.store.updateRun(runId, {
      finishedAt: new Date().toISOString(),
      status: 'failed',
      errorState: error,
    });
  }
}
