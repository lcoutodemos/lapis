/**
 * IPC handlers for the aiCli namespace.
 *
 * Exposed to the renderer via the allHandlers registry in main/handlers.ts.
 * Channel format: aiCli:<key>
 *
 * Renderer calls:
 *   apis.aiCli.prompt({ text })               → requestId
 *   apis.aiCli.cancel({ requestId })
 *   apis.aiCli.respondPermission({ questionId, optionId })
 *   apis.aiCli.status()
 *   apis.aiCli.getRuntimeOptions()            → RuntimeOptions
 *   apis.aiCli.updateRuntimeOptions({ model?, permissionMode? })
 *   apis.aiCli.capabilityResponse({ requestId, data?, error? })
 */

import { ipcMain } from 'electron';

import type { NamespaceHandlers } from '../type';
import { cliBridge } from './singleton';
import type { PermissionMode } from './transports/types';

export const aiCliHandlers = {
  /**
   * Submit a prompt. Returns the requestId immediately.
   * Progress arrives as aiCli:event events on the renderer's event bus.
   */
  prompt: async (
    e: Electron.IpcMainInvokeEvent,
    { text }: { text: string }
  ) => {
    const requestId = await cliBridge.prompt(text, e.sender);
    return { requestId };
  },

  /** Cancel an in-flight or queued request */
  cancel: async (
    _e: Electron.IpcMainInvokeEvent,
    { requestId }: { requestId: string }
  ) => {
    cliBridge.cancel(requestId);
    return { ok: true };
  },

  /** Forward permission decision from renderer to the hook server */
  respondPermission: async (
    _e: Electron.IpcMainInvokeEvent,
    { questionId, optionId }: { questionId: string; optionId: string }
  ) => {
    cliBridge.respondPermission(questionId, optionId);
    return { ok: true };
  },

  /** Health/state snapshot */
  status: async () => {
    return cliBridge.getStatus();
  },

  /**
   * Renderer → main response for a capability IPC request.
   * The capability layer opened a one-shot ipcMain.once listener keyed by
   * requestId. This handler fires it.
   */
  capabilityResponse: async (
    _e: Electron.IpcMainInvokeEvent,
    {
      requestId,
      data,
      error,
    }: { requestId: string; data?: unknown; error?: string }
  ) => {
    // Fire the matching one-shot listener in AFFiNECapability
    ipcMain.emit(`aiCli:capResponse:${requestId}`, null, { data, error });
    return { ok: true };
  },

  /**
   * Renderer signals that its capability handler is registered and ready.
   * No-op for now — kept for future local-server readiness gating.
   */
  capabilityReady: async () => {
    return { ok: true };
  },

  /** Return the available models, selected model, and permission mode */
  getRuntimeOptions: async () => {
    return cliBridge.getRuntimeOptions();
  },

  /**
   * Update runtime preferences — model and/or permission mode.
   * Changes take effect on the next prompt spawn.
   */
  updateRuntimeOptions: async (
    _e: Electron.IpcMainInvokeEvent,
    opts: { model?: string | null; permissionMode?: PermissionMode }
  ) => {
    cliBridge.updateRuntimeOptions(opts);
    return { ok: true };
  },
} satisfies NamespaceHandlers;
