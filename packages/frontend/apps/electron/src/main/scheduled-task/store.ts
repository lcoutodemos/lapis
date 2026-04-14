/**
 * SchedulerStore — durable JSON persistence for scheduled tasks and runs.
 *
 * Stored at: userData/affine-scheduled-tasks.json
 *
 * This is the main-process source of truth for task config and run history.
 * It is loaded on app startup and updated on every mutation, so scheduled
 * tasks survive app restarts without waiting for renderer sync.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { app } from 'electron';

import { logger } from '../logger';
import type { SchedulerRun, SchedulerTask } from './types';

interface StoreData {
  schemaVersion: number;
  tasks: SchedulerTask[];
  runs: SchedulerRun[];
}

const SCHEMA_VERSION = 1;
const MAX_RUNS_PER_TASK = 20;

export class SchedulerStore {
  private data: StoreData = {
    schemaVersion: SCHEMA_VERSION,
    tasks: [],
    runs: [],
  };

  private readonly filePath: string;
  private savePending = false;

  constructor() {
    this.filePath = path.join(
      app.getPath('userData'),
      'affine-scheduled-tasks.json'
    );
  }

  async load(): Promise<void> {
    try {
      const content = await fs.readFile(this.filePath, 'utf-8');
      const loaded = JSON.parse(content) as StoreData;
      if (loaded.schemaVersion === SCHEMA_VERSION) {
        this.data = loaded;
      }
      logger.info('[scheduler-store] loaded', {
        tasks: this.data.tasks.length,
        runs: this.data.runs.length,
      });
    } catch {
      logger.info('[scheduler-store] starting fresh (no existing file)');
    }
  }

  // ── Tasks ──────────────────────────────────────────────────────────────

  listTasks(): SchedulerTask[] {
    return [...this.data.tasks];
  }

  getTask(id: string): SchedulerTask | undefined {
    return this.data.tasks.find(t => t.id === id);
  }

  upsertTask(task: SchedulerTask): void {
    const idx = this.data.tasks.findIndex(t => t.id === task.id);
    if (idx === -1) {
      this.data.tasks.push(task);
    } else {
      this.data.tasks[idx] = task;
    }
    this.scheduleSave();
  }

  patchTask(id: string, patch: Partial<SchedulerTask>): SchedulerTask | null {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return null;
    this.data.tasks[idx] = { ...this.data.tasks[idx], ...patch, id };
    this.scheduleSave();
    return this.data.tasks[idx];
  }

  deleteTask(id: string): boolean {
    const idx = this.data.tasks.findIndex(t => t.id === id);
    if (idx === -1) return false;
    this.data.tasks.splice(idx, 1);
    this.data.runs = this.data.runs.filter(r => r.taskId !== id);
    this.scheduleSave();
    return true;
  }

  replaceAll(tasks: SchedulerTask[]): void {
    // Preserve ids and merge — tasks from renderer are authoritative for config
    // but we keep main's view of status if newer
    const newMap = new Map(tasks.map(t => [t.id, t]));
    const existing = new Map(this.data.tasks.map(t => [t.id, t]));

    // Add/update tasks from renderer
    for (const [id, task] of newMap) {
      existing.set(id, task);
    }
    // Remove tasks no longer in renderer's list
    for (const id of existing.keys()) {
      if (!newMap.has(id)) existing.delete(id);
    }

    this.data.tasks = [...existing.values()];
    this.scheduleSave();
  }

  // ── Runs ───────────────────────────────────────────────────────────────

  listRunsForTask(taskId: string): SchedulerRun[] {
    return this.data.runs
      .filter(r => r.taskId === taskId)
      .sort((a, b) => {
        const ta = a.scheduledFor ?? a.startedAt ?? '';
        const tb = b.scheduledFor ?? b.startedAt ?? '';
        return tb.localeCompare(ta);
      });
  }

  createRun(run: SchedulerRun): void {
    this.data.runs.push(run);
    // Trim to MAX_RUNS_PER_TASK for this task
    const taskRuns = this.data.runs.filter(r => r.taskId === run.taskId);
    if (taskRuns.length > MAX_RUNS_PER_TASK) {
      const sorted = [...taskRuns].sort((a, b) =>
        (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? '')
      );
      const toRemove = new Set(
        sorted.slice(0, taskRuns.length - MAX_RUNS_PER_TASK).map(r => r.id)
      );
      this.data.runs = this.data.runs.filter(r => !toRemove.has(r.id));
    }
    this.scheduleSave();
  }

  updateRun(id: string, patch: Partial<SchedulerRun>): SchedulerRun | null {
    const idx = this.data.runs.findIndex(r => r.id === id);
    if (idx === -1) return null;
    this.data.runs[idx] = { ...this.data.runs[idx], ...patch };
    this.scheduleSave();
    return this.data.runs[idx];
  }

  /**
   * On app startup: find any runs left in 'running' state and mark them
   * as interrupted (the app closed mid-run). Returns the affected runs.
   */
  markInterruptedRuns(): SchedulerRun[] {
    const now = new Date().toISOString();
    const interrupted: SchedulerRun[] = [];
    for (let i = 0; i < this.data.runs.length; i++) {
      if (this.data.runs[i].status === 'running') {
        this.data.runs[i] = {
          ...this.data.runs[i],
          status: 'interrupted',
          finishedAt: now,
          errorMessage: 'App was closed during this run',
        };
        interrupted.push(this.data.runs[i]);
      }
    }
    if (interrupted.length > 0) {
      logger.info(
        '[scheduler-store] marked',
        interrupted.length,
        'interrupted runs'
      );
      this.scheduleSave();
    }
    return interrupted;
  }

  // ── Private ────────────────────────────────────────────────────────────

  private scheduleSave(): void {
    if (this.savePending) return;
    this.savePending = true;
    setImmediate(() => {
      this.savePending = false;
      fs.writeFile(
        this.filePath,
        JSON.stringify(this.data, null, 2),
        'utf-8'
      ).catch(err => {
        logger.error('[scheduler-store] save failed', err);
      });
    });
  }
}
