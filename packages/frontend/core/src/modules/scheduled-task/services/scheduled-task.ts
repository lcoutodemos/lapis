import { Service } from '@toeverything/infra';

import type { ScheduledTaskStore } from '../stores/scheduled-task';
import type { CreateTaskInput, ScheduledRun, ScheduledTask } from '../types';

// ── Electron IPC bridge (no-op in web builds) ─────────────────────────────────

type SchedulerApis = {
  syncTask: (args: { task: unknown }) => Promise<{ ok: boolean }>;
  patchTask: (
    args: { id: string } & Record<string, unknown>
  ) => Promise<{ ok: boolean }>;
  removeTask: (args: { id: string }) => Promise<{ ok: boolean }>;
  syncAll: (args: { tasks: unknown[] }) => Promise<{ ok: boolean }>;
  runNow: (args: { taskId: string }) => Promise<{ ok: boolean }>;
};

type SchedulerEvents = {
  onRunEvent: (cb: (payload: unknown) => void) => () => void;
};

function getSchedulerApis(): SchedulerApis | undefined {
  return (globalThis as any).__apis?.scheduledTasks as
    | SchedulerApis
    | undefined;
}

function getSchedulerEvents(): SchedulerEvents | undefined {
  return (globalThis as any).__events?.scheduledTasks as
    | SchedulerEvents
    | undefined;
}

function toSchedulerTask(t: ScheduledTask) {
  return {
    id: t.id,
    name: t.name,
    prompt: t.prompt,
    frequencyType: t.frequencyType ?? 'daily',
    localTime: t.localTime ?? '09:00',
    timezone: t.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    status: t.status,
    destinationDocId: t.destinationDocId,
  };
}

// ── Service ───────────────────────────────────────────────────────────────────

export class ScheduledTaskService extends Service {
  constructor(private readonly store: ScheduledTaskStore) {
    super();
  }

  // ── Reactive state ─────────────────────────────────────────────────────────

  tasks$ = this.store.watchTasks();

  task$(id: string) {
    return this.store.watchTask(id);
  }

  runsForTask$(taskId: string) {
    return this.store.watchRunsForTask(taskId);
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  createTask(input: CreateTaskInput): ScheduledTask {
    const task = this.store.createTask(input);
    getSchedulerApis()
      ?.syncTask({ task: toSchedulerTask(task) })
      .catch(() => {});
    return task;
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
    getSchedulerApis()
      ?.patchTask({ id, ...patch })
      .catch(() => {});
  }

  deleteTask(id: string) {
    this.store.deleteTask(id);
    getSchedulerApis()
      ?.removeTask({ id })
      .catch(() => {});
  }

  activateTask(id: string) {
    this.store.updateTask(id, { status: 'active' });
    getSchedulerApis()
      ?.patchTask({ id, status: 'active' })
      .catch(() => {});
  }

  pauseTask(id: string) {
    this.store.updateTask(id, { status: 'paused' });
    getSchedulerApis()
      ?.patchTask({ id, status: 'paused' })
      .catch(() => {});
  }

  // ── Run methods (CRDT-backed, updated via IPC events) ──────────────────────

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

  /**
   * Push all current CRDT tasks to the main-process scheduler.
   * Call once after the workspace (and CRDT) has loaded, and then
   * whenever the tasks list changes.
   *
   * Safe to call in non-Electron environments — returns immediately if
   * no scheduler IPC is available.
   */
  syncAllToScheduler(tasks: ScheduledTask[]): void {
    getSchedulerApis()
      ?.syncAll({ tasks: tasks.map(toSchedulerTask) })
      .catch(() => {});
  }

  /**
   * Subscribe to run events pushed from the main-process scheduler and
   * mirror them into the CRDT (so the UI stays reactive).
   *
   * Returns a cleanup function — call it on component unmount / service
   * disposal.
   */
  setupRunEventListener(): () => void {
    const events = getSchedulerEvents();
    if (!events?.onRunEvent) return () => {};

    return events.onRunEvent((raw: unknown) => {
      const payload = raw as {
        event: string;
        run: {
          id: string;
          taskId: string;
          scheduledFor?: string;
          startedAt?: string;
          finishedAt?: string;
          status: string;
          summary?: string;
          errorMessage?: string;
        };
        taskId: string;
      };

      const { event, run } = payload;

      if (event === 'started') {
        // Create a CRDT run record with the id from main process
        const db = (this.store as any).workspaceDBService?.userdataDB$?.value;
        if (db) {
          try {
            db.scheduledRun.create({
              id: run.id,
              taskId: run.taskId,
              scheduledFor: run.scheduledFor,
              startedAt: run.startedAt,
              status: 'running',
            });
          } catch {
            // May fail if record already exists — ignore
          }
        }
      } else if (event === 'updated' || event === 'finished') {
        this.store.updateRun(run.id, {
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          status: run.status as any,
          summary: run.summary,
          errorState: run.errorMessage
            ? { message: run.errorMessage }
            : undefined,
        });
      }
    });
  }
}
