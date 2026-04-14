import { LiveData, Store } from '@toeverything/infra';

import type { WorkspaceDBService } from '../../db';
import type { WorkspaceDBWithTables } from '../../db/entities/db';
import type { AFFiNEWorkspaceUserdataDbSchema } from '../../db/schema/schema';
import type {
  CreateTaskInput,
  FrequencyType,
  RunStatus,
  ScheduledRun,
  ScheduledTask,
  TaskStatus,
} from '../types';

export class ScheduledTaskStore extends Store {
  constructor(private readonly workspaceDBService: WorkspaceDBService) {
    super();
  }

  // ── Tasks ──────────────────────────────────────────────────────────────

  watchTasks(): LiveData<ScheduledTask[]> {
    type DB = WorkspaceDBWithTables<AFFiNEWorkspaceUserdataDbSchema>;
    return (this.workspaceDBService.userdataDB$ as LiveData<DB>)
      .map((db: DB) => LiveData.from(db.scheduledTask.find$(), []))
      .flat()
      .map((rows: unknown[]) =>
        rows
          .map(r => this.rowToTask(r as Parameters<typeof this.rowToTask>[0]))
          .filter((t): t is ScheduledTask => t !== null)
      ) as LiveData<ScheduledTask[]>;
  }

  watchTask(id: string): LiveData<ScheduledTask | null> {
    type DB = WorkspaceDBWithTables<AFFiNEWorkspaceUserdataDbSchema>;
    return (this.workspaceDBService.userdataDB$ as LiveData<DB>)
      .map((db: DB) => LiveData.from(db.scheduledTask.get$(id), null))
      .flat()
      .map((r: unknown) =>
        r ? this.rowToTask(r as Parameters<typeof this.rowToTask>[0]) : null
      ) as LiveData<ScheduledTask | null>;
  }

  createTask(input: CreateTaskInput): ScheduledTask {
    const db = this.workspaceDBService.userdataDB$.value;
    const now = new Date().toISOString();
    const row = db.scheduledTask.create({
      name: input.name,
      prompt: input.prompt,
      frequencyType: input.frequencyType ?? 'daily',
      selectedDays: input.selectedDays,
      localTime: input.localTime,
      timezone:
        input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      status: 'needs-setup',
      outputMode: 'single-doc',
      destinationDocId: input.destinationDocId,
      providerConfig: input.providerConfig,
      createdAt: now,
      updatedAt: now,
    });
    return this.rowToTask(row) as ScheduledTask;
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
    const db = this.workspaceDBService.userdataDB$.value;
    db.scheduledTask.update(id, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  }

  deleteTask(id: string) {
    const db = this.workspaceDBService.userdataDB$.value;
    db.scheduledTask.delete(id);
  }

  // ── Runs ───────────────────────────────────────────────────────────────

  watchRunsForTask(taskId: string): LiveData<ScheduledRun[]> {
    type DB = WorkspaceDBWithTables<AFFiNEWorkspaceUserdataDbSchema>;
    return (this.workspaceDBService.userdataDB$ as LiveData<DB>)
      .map((db: DB) => LiveData.from(db.scheduledRun.find$({ taskId }), []))
      .flat()
      .map((rows: unknown[]) =>
        rows
          .map(r => this.rowToRun(r as Parameters<typeof this.rowToRun>[0]))
          .filter((r): r is ScheduledRun => r !== null)
          .sort((a: ScheduledRun, b: ScheduledRun) => {
            const ta = a.scheduledFor ?? a.startedAt ?? '';
            const tb = b.scheduledFor ?? b.startedAt ?? '';
            return tb.localeCompare(ta);
          })
      ) as LiveData<ScheduledRun[]>;
  }

  createRun(taskId: string, scheduledFor?: string): ScheduledRun {
    const db = this.workspaceDBService.userdataDB$.value;
    const row = db.scheduledRun.create({
      taskId,
      scheduledFor,
      status: 'pending',
    });
    return this.rowToRun(row) as ScheduledRun;
  }

  updateRun(
    id: string,
    patch: Partial<
      Pick<
        ScheduledRun,
        'startedAt' | 'finishedAt' | 'status' | 'summary' | 'errorState'
      >
    >
  ) {
    const db = this.workspaceDBService.userdataDB$.value;
    db.scheduledRun.update(id, patch);
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private rowToTask(
    row: {
      id?: string | null;
      name?: string | null;
      prompt?: string | null;
      frequencyType?: string | null;
      selectedDays?: unknown;
      localTime?: string | null;
      timezone?: string | null;
      status?: string | null;
      destinationDocId?: string | null;
      providerConfig?: unknown;
      createdAt?: string | null;
      updatedAt?: string | null;
    } | null
  ): ScheduledTask | null {
    if (!row || !row.id || !row.name || !row.prompt) return null;
    return {
      id: row.id,
      name: row.name,
      prompt: row.prompt,
      frequencyType: (row.frequencyType as FrequencyType) ?? 'daily',
      selectedDays: row.selectedDays as number[] | undefined,
      localTime: row.localTime ?? undefined,
      timezone: row.timezone ?? undefined,
      status: (row.status as TaskStatus) ?? 'needs-setup',
      outputMode: 'single-doc',
      destinationDocId: row.destinationDocId ?? undefined,
      providerConfig: row.providerConfig as Record<string, unknown> | undefined,
      createdAt: row.createdAt ?? undefined,
      updatedAt: row.updatedAt ?? undefined,
    };
  }

  private rowToRun(
    row: {
      id?: string | null;
      taskId?: string | null;
      scheduledFor?: string | null;
      startedAt?: string | null;
      finishedAt?: string | null;
      status?: string | null;
      summary?: string | null;
      errorState?: unknown;
    } | null
  ): ScheduledRun | null {
    if (!row || !row.id || !row.taskId) return null;
    return {
      id: row.id,
      taskId: row.taskId,
      scheduledFor: row.scheduledFor ?? undefined,
      startedAt: row.startedAt ?? undefined,
      finishedAt: row.finishedAt ?? undefined,
      status: (row.status as RunStatus) ?? 'pending',
      summary: row.summary ?? undefined,
      errorState: row.errorState as Record<string, unknown> | undefined,
    };
  }
}
