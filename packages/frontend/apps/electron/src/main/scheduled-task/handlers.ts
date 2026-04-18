/**
 * IPC handlers for the scheduledTasks namespace.
 *
 * Renderer calls:
 *   apis.scheduledTasks.syncTask({ task })       — push a single task
 *   apis.scheduledTasks.patchTask({ id, ...patch }) — partial update
 *   apis.scheduledTasks.removeTask({ id })        — remove from schedule
 *   apis.scheduledTasks.syncAll({ tasks })        — full replace (on page load)
 *   apis.scheduledTasks.runNow({ taskId })        — trigger immediate run
 *   apis.scheduledTasks.listAllRuns()             — fetch every run so the
 *                                                   renderer can reconcile its
 *                                                   CRDT against main on mount
 */

import type { NamespaceHandlers } from '../type';
import { schedulerService } from './singleton';
import type { SchedulerTask } from './types';

export const scheduledTaskHandlers = {
  syncTask: async (
    _e: Electron.IpcMainInvokeEvent,
    { task }: { task: SchedulerTask }
  ) => {
    schedulerService.syncTask(task);
    return { ok: true };
  },

  patchTask: async (
    _e: Electron.IpcMainInvokeEvent,
    { id, ...patch }: { id: string } & Partial<SchedulerTask>
  ) => {
    schedulerService.patchTask(id, patch);
    return { ok: true };
  },

  removeTask: async (
    _e: Electron.IpcMainInvokeEvent,
    { id }: { id: string }
  ) => {
    schedulerService.removeTask(id);
    return { ok: true };
  },

  syncAll: async (
    _e: Electron.IpcMainInvokeEvent,
    { tasks }: { tasks: SchedulerTask[] }
  ) => {
    schedulerService.syncAll(tasks);
    return { ok: true };
  },

  runNow: async (
    _e: Electron.IpcMainInvokeEvent,
    { taskId }: { taskId: string }
  ) => {
    return schedulerService.runNow(taskId);
  },

  listAllRuns: async (_e: Electron.IpcMainInvokeEvent) => {
    // Serialize defensively via JSON round-trip to guarantee the returned
    // payload is structured-clonable (no prototypes, no functions, no cycles).
    // This prevents "An object could not be cloned" IPC errors.
    const runs = JSON.parse(JSON.stringify(schedulerService.listAllRuns()));
    return { runs };
  },
} satisfies NamespaceHandlers;
