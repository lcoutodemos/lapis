/**
 * IPC handlers for the scheduledTasks namespace.
 *
 * Renderer calls:
 *   apis.scheduledTasks.syncTask({ task })       — push a single task
 *   apis.scheduledTasks.patchTask({ id, ...patch }) — partial update
 *   apis.scheduledTasks.removeTask({ id })        — remove from schedule
 *   apis.scheduledTasks.syncAll({ tasks })        — full replace (on page load)
 *   apis.scheduledTasks.runNow({ taskId })        — trigger immediate run
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
} satisfies NamespaceHandlers;
