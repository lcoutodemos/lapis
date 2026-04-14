/**
 * SchedulerService — main-process orchestration layer for scheduled tasks.
 *
 * Design:
 *  - In-memory task registry. Tasks are pushed from the renderer via IPC
 *    whenever they are created / updated / deleted there.
 *  - Single next-run timer (not a cron scan). Recomputed after every mutation
 *    or completed run.
 *  - One concurrent run at a time.  runNow() queues if a run is active.
 *  - Emits RxJS subjects that the event layer subscribes to and forwards to
 *    every subscribed renderer WebContents.
 */

import { nanoid } from 'nanoid';
import { Subject } from 'rxjs';

import { logger } from '../logger';
import { ScheduledTaskRunner } from './runner';
import type {
  FrequencyType,
  RunEventPayload,
  SchedulerRun,
  SchedulerTask,
} from './types';

// ── Subjects (event bus) ──────────────────────────────────────────────────────

export const scheduledTaskSubjects = {
  runEvent$: new Subject<RunEventPayload>(),
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Compute the UTC timestamp of the next valid run after `after` for `task`.
 * Searches up to 8 days forward to handle weekly/custom frequencies.
 */
function computeNextRunAt(task: SchedulerTask, after: number): number {
  const [hh, mm] = (task.localTime ?? '09:00')
    .split(':')
    .map(n => parseInt(n, 10));
  const tz = task.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const minMs = after + 60_000; // must be at least 1 min in the future

  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const probe = new Date(after + dayOffset * 86_400_000);

    // Get the calendar date in target timezone (YYYY-MM-DD)
    const localDate = probe.toLocaleDateString('en-CA', { timeZone: tz });
    const runUtcMs = localTimeToUtc(localDate, hh, mm, tz);

    if (runUtcMs < minMs) continue;
    if (!isValidDay(runUtcMs, task.frequencyType, tz)) continue;

    return runUtcMs;
  }

  // Fallback: 24 h from now
  return after + 86_400_000;
}

/** Map 'YYYY-MM-DD' + HH:MM + timezone to UTC ms (DST-safe). */
function localTimeToUtc(
  dateStr: string,
  hh: number,
  mm: number,
  tz: string
): number {
  const [yr, mo, da] = dateStr.split('-').map(Number);
  // Start with a naive UTC guess
  const roughUtc = Date.UTC(yr, mo - 1, da, hh, mm, 0, 0);
  // Ask Intl what local hour/minute that naive UTC resolves to
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
      return day === 1; // Monday
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

export class SchedulerService {
  private readonly tasks = new Map<string, SchedulerTask>();
  private readonly runner = new ScheduledTaskRunner();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private abortController: AbortController | null = null;
  private readonly runQueue: string[] = []; // taskIds queued for runNow

  private localServerPort: number | undefined;

  // ── Public API ─────────────────────────────────────────────────────────

  setLocalServerPort(port: number): void {
    this.localServerPort = port;
  }

  /**
   * Full-replace a task in the registry.
   * Called when the renderer creates or updates a task.
   */
  syncTask(task: SchedulerTask): void {
    this.tasks.set(task.id, task);
    logger.info('[scheduler] syncTask', { id: task.id, status: task.status });
    this.scheduleNext();
  }

  /**
   * Partial-update a task (e.g. status change without re-sending full payload).
   */
  patchTask(id: string, patch: Partial<SchedulerTask>): void {
    const existing = this.tasks.get(id);
    if (!existing) {
      // Nothing to patch — renderer may follow up with a full syncTask
      return;
    }
    this.tasks.set(id, { ...existing, ...patch, id });
    logger.info('[scheduler] patchTask', { id, patch });
    this.scheduleNext();
  }

  /** Remove a task from the registry. */
  removeTask(id: string): void {
    this.tasks.delete(id);
    logger.info('[scheduler] removeTask', id);
    this.scheduleNext();
  }

  /** Replace the entire in-memory registry (initial sync on page load). */
  syncAll(tasks: SchedulerTask[]): void {
    this.tasks.clear();
    for (const t of tasks) {
      this.tasks.set(t.id, t);
    }
    logger.info('[scheduler] syncAll', this.tasks.size, 'tasks');
    this.scheduleNext();
  }

  /**
   * Trigger an immediate run for `taskId`.
   * If a run is already active, the request is queued and will execute after
   * the current run finishes.
   */
  async runNow(taskId: string): Promise<{ ok: boolean }> {
    const task = this.tasks.get(taskId);
    if (!task) {
      logger.warn('[scheduler] runNow: task not found', taskId);
      return { ok: false };
    }

    if (this.running) {
      this.runQueue.push(taskId);
      logger.info('[scheduler] runNow queued', taskId);
      return { ok: true };
    }

    this.executeRun(task);
    return { ok: true };
  }

  destroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.abortController?.abort();
    this.tasks.clear();
  }

  // ── Scheduling ─────────────────────────────────────────────────────────

  private scheduleNext(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const activeTasks = [...this.tasks.values()].filter(
      t => t.status === 'active'
    );
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
    const inMinutes = Math.round(delay / 60_000);
    logger.info(
      `[scheduler] next run: "${earliestTask.name}" in ${inMinutes} min`
    );

    const scheduledTaskId = earliestTask.id;
    this.timer = setTimeout(() => {
      this.timer = null;
      const latest = this.tasks.get(scheduledTaskId);
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
      logger.warn('[scheduler] executeRun: already running, ignoring', task.id);
      return;
    }

    this.running = true;
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    const run: SchedulerRun = {
      id: nanoid(),
      taskId: task.id,
      scheduledFor: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      status: 'running',
    };

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
        { localServerPort: this.localServerPort },
        summary => {
          scheduledTaskSubjects.runEvent$.next({
            event: 'updated',
            run: { ...run, summary, status: 'running' },
            taskId: task.id,
          });
        },
        signal
      )
      .then(result => {
        const finishedRun: SchedulerRun = {
          ...run,
          status: result.success ? 'completed' : 'failed',
          finishedAt: new Date().toISOString(),
          summary: result.summary,
          errorMessage: result.errorMessage,
        };

        scheduledTaskSubjects.runEvent$.next({
          event: 'finished',
          run: finishedRun,
          taskId: task.id,
        });

        logger.info('[scheduler] run finished', {
          task: task.name,
          success: result.success,
        });

        // If the task failed, mark it so the user sees a warning in the UI
        if (!result.success) {
          this.patchTask(task.id, { status: 'failed' });
        }
      })
      .catch(err => {
        logger.error('[scheduler] run error', err);
        scheduledTaskSubjects.runEvent$.next({
          event: 'finished',
          run: {
            ...run,
            status: 'failed',
            finishedAt: new Date().toISOString(),
            errorMessage: String(err),
          },
          taskId: task.id,
        });
      })
      .finally(() => {
        this.running = false;
        this.abortController = null;

        // Drain the runNow queue
        const nextTaskId = this.runQueue.shift();
        if (nextTaskId) {
          const nextTask = this.tasks.get(nextTaskId);
          if (nextTask) {
            this.executeRun(nextTask);
            return;
          }
        }

        // Otherwise resume the timer schedule
        this.scheduleNext();
      });
  }
}
