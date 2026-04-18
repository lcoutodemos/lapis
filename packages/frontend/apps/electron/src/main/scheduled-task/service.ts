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

import { powerMonitor } from 'electron';
import { nanoid } from 'nanoid';
import { ReplaySubject } from 'rxjs';

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

/**
 * ReplaySubject with a large buffer so run events emitted before the renderer
 * subscribes (e.g., the 'finished' events for interrupted runs emitted during
 * main-process init) are replayed to the renderer on subscribe — rather than
 * being lost, which would leave ghost 'running' records in the CRDT.
 */
export const scheduledTaskSubjects = {
  runEvent$: new ReplaySubject<RunEventPayload>(500),
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

/**
 * How far back we scan for missed slots on startup/resume.
 * Slots older than this are ignored (prevent backfilling months of runs).
 */
const MAX_RECOVERY_LOOKBACK_MS = 7 * 86_400_000; // 7 days

/** Max overdue slots to process per task per recovery pass (avoids loops). */
const MAX_CATCHUP_SLOTS = 14;

export class SchedulerService {
  private readonly store = new SchedulerStore();
  private readonly runner = new ScheduledTaskRunner();
  private readonly permissionHandler = new PermissionHandler();

  private hookPort: number | undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private clockRecheckInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private abortController: AbortController | null = null;

  /** Queue entries carry the intended slot time and origin so run records are accurate. */
  private readonly runQueue: Array<{
    taskId: string;
    scheduledFor: string;
    triggeredBy: 'schedule' | 'manual' | 'catchup';
  }> = [];

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

    // ── Load tasks from durable JSON store ────────────────────────────────
    // This is intentionally renderer-independent: tasks were written to disk
    // on every create/update mutation (via IPC syncTask/patchTask/syncAll).
    // Recovery does NOT wait for the renderer to mount or call syncAll.
    await this.store.load();
    logger.info(
      '[scheduler] loaded from disk:',
      this.store.listTasks().length,
      'tasks — renderer sync not required for recovery'
    );

    // Mark any runs that were left in 'running' state
    const interrupted = this.store.markInterruptedRuns();
    for (const run of interrupted) {
      scheduledTaskSubjects.runEvent$.next({
        event: 'finished',
        run,
        taskId: run.taskId,
      });
    }

    // Product policy: scan back up to 7 days, mark older missed slots as
    // 'missed', and run only the most recent overdue slot immediately.
    // This prevents backfill storms while ensuring the user sees their
    // task run as soon as possible after the app was unavailable.
    this.recoverOverdueTasks();
    this.drainQueueIfIdle();

    // Schedule the next timer for future occurrences
    this.scheduleNext();

    // Re-check on system resume — Node timers do not fire while the machine sleeps
    powerMonitor.on('resume', () => {
      logger.info('[scheduler] system resumed, re-checking overdue tasks');
      this.recoverOverdueTasks();
      this.drainQueueIfIdle();
      this.scheduleNext();
    });

    // Hourly re-arm: guards against NTP corrections and system clock jumps.
    // IANA timezone strings are stored per task, so DST transitions are handled
    // automatically by Intl at computation time — this is just a safety net for
    // cases where a large clock delta would cause a setTimeout to fire late.
    this.clockRecheckInterval = setInterval(
      () => {
        this.recoverOverdueTasks();
        this.drainQueueIfIdle();
        this.scheduleNext();
      },
      60 * 60_000 // 1 hour
    );
    // Don't hold the event loop open if the app is quitting
    this.clockRecheckInterval.unref();

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
    if (this.clockRecheckInterval) {
      clearInterval(this.clockRecheckInterval);
      this.clockRecheckInterval = null;
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
      const queueIdx = this.runQueue.findIndex(e => e.taskId === id);
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
    const queueIdx = this.runQueue.findIndex(e => e.taskId === id);
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
   * Reconcile from renderer. Renderer config is authoritative for task
   * definitions; main is authoritative for execution state.
   *
   * This is NOT the bootstrap path — the scheduler bootstraps from the
   * durable JSON store on app launch without waiting for this call.
   * Renderer sync is a "latest-config" reconcile that runs after the
   * Scheduled page mounts.
   */
  syncAll(tasks: SchedulerTask[]): void {
    this.store.replaceAll(tasks);
    logger.info('[scheduler] syncAll (reconcile):', tasks.length, 'tasks');
    this.scheduleNext();
  }

  async runNow(taskId: string): Promise<{ ok: boolean }> {
    const task = this.store.getTask(taskId);
    if (!task) {
      logger.warn('[scheduler] runNow: task not found', taskId);
      return { ok: false };
    }
    const now = new Date().toISOString();
    if (this.running) {
      this.runQueue.push({ taskId, scheduledFor: now, triggeredBy: 'manual' });
      return { ok: true };
    }
    this.executeRun(task, now, 'manual');
    return { ok: true };
  }

  listTasks(): SchedulerTask[] {
    return this.store.listTasks();
  }

  listRunsForTask(taskId: string): SchedulerRun[] {
    return this.store.listRunsForTask(taskId);
  }

  /**
   * Returns every run across every task. Used by the renderer to reconcile
   * its CRDT against main on mount — covers cases where events were emitted
   * before any subscriber existed.
   */
  listAllRuns(): SchedulerRun[] {
    const all: SchedulerRun[] = [];
    for (const task of this.store.listTasks()) {
      all.push(...this.store.listRunsForTask(task.id));
    }
    return all;
  }

  // ── Scheduling ─────────────────────────────────────────────────────────

  /**
   * Scans all active tasks for missed slots and either queues a catch-up run
   * or records a 'missed' entry for each one.
   *
   * Policy (explicit product decision for v1):
   *   - Look back at most MAX_RECOVERY_LOOKBACK_MS (7 days).
   *   - If multiple slots were missed, mark all but the most recent as 'missed'.
   *   - Enqueue only the most-recent missed slot for immediate catch-up.
   *
   * Timezone safety: computeNextRunAt uses Intl.DateTimeFormat with the task's
   * stored IANA timezone, so DST transitions and timezone changes are handled
   * automatically at computation time without any special recovery logic.
   */
  private recoverOverdueTasks(): void {
    const now = Date.now();
    const lookbackStart = now - MAX_RECOVERY_LOOKBACK_MS;
    let totalOverdue = 0;
    let totalCatchUp = 0;
    let totalMissed = 0;

    for (const task of this.store.listTasks()) {
      if (task.status !== 'active') continue;

      const runs = this.store.listRunsForTask(task.id);
      // Ignore manual runs when computing the anchor — a "Run now" click
      // must NOT be treated as fulfilling the scheduled slot.
      const latestScheduledRun = runs.find(r => r.triggeredBy !== 'manual');
      const lastRunAt = latestScheduledRun
        ? new Date(
            latestScheduledRun.scheduledFor ?? latestScheduledRun.startedAt ?? 0
          ).getTime()
        : 0;

      // Don't scan further back than MAX_RECOVERY_LOOKBACK_MS
      const anchor = Math.max(lastRunAt, lookbackStart);

      // Collect every overdue slot since anchor (up to MAX_CATCHUP_SLOTS)
      const overdueSlots: number[] = [];
      let scanFrom = anchor;

      for (let i = 0; i < MAX_CATCHUP_SLOTS; i++) {
        const slot = computeNextRunAt(task, scanFrom);
        if (slot >= now) break; // future — stop
        overdueSlots.push(slot);
        scanFrom = slot;
      }

      if (overdueSlots.length === 0) continue;
      totalOverdue += overdueSlots.length;

      // Mark all but the most-recent slot as 'missed' (skip already-recorded ones)
      let newMissed = 0;
      for (let i = 0; i < overdueSlots.length - 1; i++) {
        const slotTs = overdueSlots[i];
        const alreadyRecorded = runs.some(r => {
          const t = new Date(r.scheduledFor ?? r.startedAt ?? 0).getTime();
          return Math.abs(t - slotTs) < 60_000;
        });
        if (alreadyRecorded) continue;

        const missedRun: SchedulerRun = {
          id: nanoid(),
          taskId: task.id,
          scheduledFor: new Date(slotTs).toISOString(),
          status: 'missed',
          finishedAt: new Date().toISOString(),
          errorMessage: 'App was unavailable when this run was due',
        };
        this.store.createRun(missedRun);
        scheduledTaskSubjects.runEvent$.next({
          event: 'finished',
          run: missedRun,
          taskId: task.id,
        });
        newMissed++;
      }
      totalMissed += newMissed;

      // Queue the most-recent overdue slot for immediate catch-up (idempotent)
      const catchUpSlot = overdueSlots[overdueSlots.length - 1];
      const alreadyQueued = this.runQueue.some(e => e.taskId === task.id);
      const alreadyRan = runs.some(r => {
        if (r.triggeredBy === 'manual') return false;
        const t = new Date(r.scheduledFor ?? r.startedAt ?? 0).getTime();
        return (
          Math.abs(t - catchUpSlot) < 60_000 &&
          r.status !== 'interrupted' &&
          r.status !== 'needs_attention'
        );
      });

      if (!alreadyQueued && !alreadyRan) {
        logger.info('[scheduler] recovery decision: catch-up queued', {
          task: task.name,
          overdueSlots: overdueSlots.length,
          newMissed,
          catchUpSlot: new Date(catchUpSlot).toISOString(),
          overdueByMin: Math.round((Date.now() - catchUpSlot) / 60_000),
        });
        this.runQueue.push({
          taskId: task.id,
          scheduledFor: new Date(catchUpSlot).toISOString(),
          triggeredBy: 'catchup',
        });
        totalCatchUp++;
      } else {
        logger.info('[scheduler] recovery decision: no action needed', {
          task: task.name,
          overdueSlots: overdueSlots.length,
          newMissed,
          reason: alreadyQueued ? 'already queued' : 'already ran',
        });
      }
    }

    if (totalOverdue > 0 || totalCatchUp > 0) {
      logger.info('[scheduler] recovery pass complete', {
        overdueSlots: totalOverdue,
        markedMissed: totalMissed,
        catchUpQueued: totalCatchUp,
      });
    }
  }

  /** Start the next queued run if nothing is currently running. */
  private drainQueueIfIdle(): void {
    if (this.running || this.runQueue.length === 0) return;
    const entry = this.runQueue.shift();
    if (!entry) return;
    const task = this.store.getTask(entry.taskId);
    if (task) {
      this.executeRun(task, entry.scheduledFor, entry.triggeredBy);
    } else {
      // Task deleted — try the next entry
      this.drainQueueIfIdle();
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
    const scheduledFor = new Date(earliestAt).toISOString();
    this.timer = setTimeout(() => {
      this.timer = null;
      const latest = this.store.getTask(scheduledTaskId);
      if (latest?.status === 'active') {
        this.executeRun(latest, scheduledFor, 'schedule');
      } else {
        this.scheduleNext();
      }
    }, delay);
  }

  // ── Execution ──────────────────────────────────────────────────────────

  private executeRun(
    task: SchedulerTask,
    scheduledFor?: string,
    triggeredBy: 'schedule' | 'manual' | 'catchup' = 'schedule'
  ): void {
    if (this.running) {
      logger.warn('[scheduler] already running, ignoring', task.id);
      return;
    }

    // Check the task wasn't deleted while queued
    const current = this.store.getTask(task.id);
    if (!current || current.status !== 'active') {
      logger.info('[scheduler] task no longer active, skipping', task.id);
      this.drainQueueIfIdle();
      this.scheduleNext();
      return;
    }

    this.running = true;
    this.currentRunNeedsAttention = false;
    this.abortController = new AbortController();
    const { signal } = this.abortController;
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();

    // Determine whether this is a catch-up run (slot passed while app was unavailable)
    const isCatchup =
      scheduledFor !== undefined &&
      nowMs - new Date(scheduledFor).getTime() > 2 * 60_000; // >2 min late = catch-up
    const overdueByMs =
      isCatchup && scheduledFor
        ? nowMs - new Date(scheduledFor).getTime()
        : undefined;

    const run: SchedulerRun = {
      id: nanoid(),
      taskId: task.id,
      // Use the intended slot time if provided (catch-up runs), else now
      scheduledFor: scheduledFor ?? nowIso,
      startedAt: nowIso,
      status: 'running',
      catchup: isCatchup || undefined,
      overdueByMs,
      triggeredBy: triggeredBy,
    };

    this.store.createRun(run);
    scheduledTaskSubjects.runEvent$.next({
      event: 'started',
      run,
      taskId: task.id,
    });

    if (isCatchup) {
      logger.info('[scheduler] catch-up run starting', {
        task: task.name,
        scheduledFor,
        overdueByMin: Math.round((overdueByMs ?? 0) / 60_000),
      });
    }

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
        // Permission hook may have flagged needs_attention via the callback
        const needsAttention =
          result.needsAttention || this.currentRunNeedsAttention;
        const finalStatus = needsAttention
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

        if (!result.success && !needsAttention) {
          // A single run failure must NOT disable the task. The run record
          // itself captures the failure; the task remains 'active' so the
          // next scheduled slot still fires and the user can Run Now again
          // without manually reactivating.
          logger.warn('[scheduler] run failed — task stays active', {
            task: task.name,
            error: result.errorMessage,
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
        // Try to start the next queued run; if none, arm the next timer
        if (this.runQueue.length > 0) {
          this.drainQueueIfIdle();
        } else {
          this.scheduleNext();
        }
      });
  }
}
