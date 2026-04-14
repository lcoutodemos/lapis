/**
 * SchedulerService — main-process orchestration for scheduled tasks.
 *
 * Design:
 *  - Owns a JSON-backed SchedulerStore: tasks survive app restarts.
 *  - Bootstrap on app start: loads store, marks interrupted runs,
 *    schedules or catches up overdue tasks.
 *  - Renderer syncAll/syncTask calls update the store (renderer is
 *    authoritative for task config, main is authoritative for execution).
 *  - Runs go through runIsolatedPrompt via CLIBridge — shared execution path
 *    with interactive chat, isolated session per run.
 *  - Own PermissionHandler in 'unattended' mode: never hangs waiting for UI;
 *    blocks write tools and marks the run needs_attention instead.
 *  - Recovery: interrupted runs marked on startup, overdue runs caught up
 *    or recorded as missed.
 */

import { nanoid } from 'nanoid';
import { Subject } from 'rxjs';

import { PermissionHandler } from '../cli-bridge/permission-handler';
import { cliBridge } from '../cli-bridge/singleton';
import { logger } from '../logger';
import { ScheduledTaskRunner } from './runner';
import { SchedulerStore } from './store';
import type {
  FrequencyType,
  RunEventPayload,
  SchedulerRun,
  SchedulerTask,
} from './types';

// ── Event subjects ────────────────────────────────────────────────────────────

export const scheduledTaskSubjects = {
  runEvent$: new Subject<RunEventPayload>(),
};

// ── Next-run computation ──────────────────────────────────────────────────────

function computeNextRunAt(task: SchedulerTask, after: number): number {
  const [hh, mm] = (task.localTime ?? '09:00')
    .split(':')
    .map(n => parseInt(n, 10));
  const tz = task.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const minMs = after + 60_000;

  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const probe = new Date(after + dayOffset * 86_400_000);
    const localDate = probe.toLocaleDateString('en-CA', { timeZone: tz });
    const runUtcMs = localTimeToUtc(localDate, hh, mm, tz);
    if (runUtcMs < minMs) continue;
    if (!isValidDay(runUtcMs, task.frequencyType, tz)) continue;
    return runUtcMs;
  }
  return after + 86_400_000;
}

function localTimeToUtc(
  dateStr: string,
  hh: number,
  mm: number,
  tz: string
): number {
  const [yr, mo, da] = dateStr.split('-').map(Number);
  const roughUtc = Date.UTC(yr, mo - 1, da, hh, mm, 0, 0);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    dtf.formatToParts(new Date(roughUtc)).map(p => [p.type, p.value])
  );
  const localHh = parseInt(parts['hour'] ?? '0', 10);
  const localMm = parseInt(parts['minute'] ?? '0', 10);
  const diffMs = ((hh - localHh) * 60 + (mm - localMm)) * 60_000;
  return roughUtc + diffMs;
}

function isValidDay(utcMs: number, freq: FrequencyType, tz: string): boolean {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
  });
  const dayName = dtf.format(new Date(utcMs));
  const dayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const day = dayMap[dayName] ?? 0;
  switch (freq) {
    case 'daily':
      return true;
    case 'weekdays':
      return day >= 1 && day <= 5;
    case 'weekly':
      return day === 1;
    case 'monthly': {
      const dayOfMonth = parseInt(
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          day: 'numeric',
        }).format(new Date(utcMs)),
        10
      );
      return dayOfMonth === 1;
    }
    case 'custom':
      return true;
    default:
      return true;
  }
}

// ── Service ───────────────────────────────────────────────────────────────────

/** Overdue threshold: runs missed by < this are caught up immediately. */
const CATCHUP_WINDOW_MS = 30 * 60_000; // 30 minutes

export class SchedulerService {
  private readonly store = new SchedulerStore();
  private readonly runner = new ScheduledTaskRunner();
  private readonly permissionHandler = new PermissionHandler();

  private hookPort: number | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private abortController: AbortController | null = null;
  private readonly runQueue: string[] = [];
  private initialized = false;

  /** Set when the permission handler blocks a write tool in the current run */
  private currentRunNeedsAttention = false;

  // ── Bootstrap ──────────────────────────────────────────────────────────

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Start the unattended permission server
    this.hookPort = await this.permissionHandler.start();
    this.permissionHandler.setPermissionMode('unattended');
    logger.info('[scheduler] unattended permission hook port', this.hookPort);

    // Wire up permission-blocked callback: abort current run and flag it
    this.permissionHandler.setOnPermissionBlocked(toolName => {
      logger.warn('[scheduler] permission blocked in unattended run', {
        toolName,
      });
      this.currentRunNeedsAttention = true;
      this.abortController?.abort();
    });

    // Load persisted tasks and runs
    await this.store.load();

    // Mark any runs that were left in 'running' state
    const interrupted = this.store.markInterruptedRuns();
    for (const run of interrupted) {
      scheduledTaskSubjects.runEvent$.next({
        event: 'finished',
        run,
        taskId: run.taskId,
      });
    }

    // Catch up or skip overdue tasks
    this.recoverOverdueTasks();

    // Schedule the next timer
    this.scheduleNext();

    logger.info(
      '[scheduler] initialized with',
      this.store.listTasks().length,
      'tasks'
    );
  }

  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.abortController?.abort();
    this.permissionHandler.stop();
  }

  // ── Task registry (renderer-pushed) ────────────────────────────────────

  syncTask(task: SchedulerTask): void {
    this.store.upsertTask(task);
    logger.info('[scheduler] syncTask', { id: task.id, status: task.status });
    this.scheduleNext();
  }

  patchTask(id: string, patch: Partial<SchedulerTask>): void {
    this.store.patchTask(id, patch);
    logger.info('[scheduler] patchTask', { id, patch });

    // If the task is being paused/deactivated while queued, remove from queue
    if (patch.status && patch.status !== 'active') {
      const queueIdx = this.runQueue.indexOf(id);
      if (queueIdx !== -1) {
        this.runQueue.splice(queueIdx, 1);
        logger.info('[scheduler] removed patched task from queue', id);
      }
    }

    this.scheduleNext();
  }

  removeTask(id: string): void {
    this.store.deleteTask(id);
    logger.info('[scheduler] removeTask', id);

    // Remove from queue if it was waiting
    const queueIdx = this.runQueue.indexOf(id);
    if (queueIdx !== -1) {
      this.runQueue.splice(queueIdx, 1);
      logger.info('[scheduler] removed deleted task from queue', id);
    }

    // Abort if this task is currently running
    if (this.running) {
      // We can't easily check which task is running right now without
      // tracking it explicitly — abort conservatively only if id matches
      // the current timer's task (handled below in executeRun)
    }

    this.scheduleNext();
  }

  /**
   * Full replacement from renderer. Uses a merge strategy: renderer config
   * is authoritative but existing main-side status is preserved if newer.
   */
  syncAll(tasks: SchedulerTask[]): void {
    this.store.replaceAll(tasks);
    logger.info('[scheduler] syncAll', tasks.length, 'tasks');
    this.scheduleNext();
  }

  async runNow(taskId: string): Promise<{ ok: boolean }> {
    const task = this.store.getTask(taskId);
    if (!task) {
      logger.warn('[scheduler] runNow: task not found', taskId);
      return { ok: false };
    }
    if (this.running) {
      this.runQueue.push(taskId);
      return { ok: true };
    }
    this.executeRun(task);
    return { ok: true };
  }

  listTasks(): SchedulerTask[] {
    return this.store.listTasks();
  }

  listRunsForTask(taskId: string): SchedulerRun[] {
    return this.store.listRunsForTask(taskId);
  }

  // ── Scheduling ─────────────────────────────────────────────────────────

  private recoverOverdueTasks(): void {
    const now = Date.now();
    for (const task of this.store.listTasks()) {
      if (task.status !== 'active') continue;

      const runs = this.store.listRunsForTask(task.id);
      const lastRunAt = runs[0]
        ? new Date(runs[0].scheduledFor ?? runs[0].startedAt ?? 0).getTime()
        : 0;

      const nextDue = computeNextRunAt(task, lastRunAt || now - 86_400_000);

      if (nextDue < now) {
        const overdueBy = now - nextDue;
        if (overdueBy < CATCHUP_WINDOW_MS) {
          logger.info('[scheduler] catching up overdue task', {
            task: task.name,
            overdueByMinutes: Math.round(overdueBy / 60_000),
          });
          this.runQueue.push(task.id);
        } else {
          logger.info('[scheduler] skipping stale task', {
            task: task.name,
            overdueByMinutes: Math.round(overdueBy / 60_000),
          });
          const missedRun: SchedulerRun = {
            id: nanoid(),
            taskId: task.id,
            scheduledFor: new Date(nextDue).toISOString(),
            status: 'missed',
            finishedAt: new Date().toISOString(),
            errorMessage: 'App was offline when this run was due',
          };
          this.store.createRun(missedRun);
          scheduledTaskSubjects.runEvent$.next({
            event: 'finished',
            run: missedRun,
            taskId: task.id,
          });
        }
      }
    }
  }

  private scheduleNext(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const activeTasks = this.store
      .listTasks()
      .filter(t => t.status === 'active');
    if (activeTasks.length === 0) return;

    const now = Date.now();
    let earliestTask: SchedulerTask | null = null;
    let earliestAt = Infinity;

    for (const task of activeTasks) {
      const nextAt = computeNextRunAt(task, now);
      if (nextAt < earliestAt) {
        earliestAt = nextAt;
        earliestTask = task;
      }
    }

    if (!earliestTask) return;

    const delay = Math.max(1_000, earliestAt - now);
    logger.info(
      `[scheduler] next run: "${earliestTask.name}" in ${Math.round(delay / 60_000)} min`
    );

    const scheduledTaskId = earliestTask.id;
    this.timer = setTimeout(() => {
      this.timer = null;
      const latest = this.store.getTask(scheduledTaskId);
      if (latest?.status === 'active') {
        this.executeRun(latest);
      } else {
        this.scheduleNext();
      }
    }, delay);
  }

  // ── Execution ──────────────────────────────────────────────────────────

  private executeRun(task: SchedulerTask): void {
    if (this.running) {
      logger.warn('[scheduler] already running, ignoring', task.id);
      return;
    }

    // Check the task wasn't deleted while queued
    const current = this.store.getTask(task.id);
    if (!current || current.status !== 'active') {
      logger.info('[scheduler] task no longer active, skipping', task.id);
      this.scheduleNext();
      return;
    }

    this.running = true;
    this.currentRunNeedsAttention = false;
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const run: SchedulerRun = {
      id: nanoid(),
      taskId: task.id,
      scheduledFor: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      status: 'running',
    };

    this.store.createRun(run);
    scheduledTaskSubjects.runEvent$.next({
      event: 'started',
      run,
      taskId: task.id,
    });

    logger.info('[scheduler] executing run', {
      task: task.name,
      runId: run.id,
    });

    this.runner
      .run(
        task,
        {
          hookPort: this.hookPort,
          localServerPort: cliBridge.getLocalServerPort(),
        },
        summary => {
          const updated = this.store.updateRun(run.id, {
            summary: summary.slice(0, 200),
          });
          if (updated) {
            scheduledTaskSubjects.runEvent$.next({
              event: 'updated',
              run: updated,
              taskId: task.id,
            });
          }
        },
        signal
      )
      .then(result => {
        const finalStatus = result.needsAttention
          ? 'needs_attention'
          : result.success
            ? 'completed'
            : 'failed';

        const finishedRun = this.store.updateRun(run.id, {
          status: finalStatus,
          finishedAt: new Date().toISOString(),
          summary: result.summary,
          errorMessage: result.errorMessage,
          outputDocId: result.outputDocId,
        });

        if (finishedRun) {
          scheduledTaskSubjects.runEvent$.next({
            event: 'finished',
            run: finishedRun,
            taskId: task.id,
          });
        }

        if (!result.success && !result.needsAttention) {
          this.store.patchTask(task.id, { status: 'failed' });
          scheduledTaskSubjects.runEvent$.next({
            event: 'finished',
            run: finishedRun ?? run,
            taskId: task.id,
          });
        }

        logger.info('[scheduler] run finished', {
          task: task.name,
          status: finalStatus,
        });
      })
      .catch(err => {
        logger.error('[scheduler] run error', err);
        const failedRun = this.store.updateRun(run.id, {
          status: 'failed',
          finishedAt: new Date().toISOString(),
          errorMessage: String(err),
        });
        scheduledTaskSubjects.runEvent$.next({
          event: 'finished',
          run: failedRun ?? { ...run, status: 'failed' },
          taskId: task.id,
        });
      })
      .finally(() => {
        this.running = false;
        this.abortController = null;
        this.currentRunNeedsAttention = false;
        const nextTaskId = this.runQueue.shift();
        if (nextTaskId) {
          const nextTask = this.store.getTask(nextTaskId);
          if (nextTask) {
            this.executeRun(nextTask);
            return;
          }
        }
        this.scheduleNext();
      });
  }
}
