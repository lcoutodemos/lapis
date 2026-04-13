/**
 * IPC events for the aiCli namespace.
 *
 * Registered in main/events.ts → allEvents.aiCli.
 *
 * The renderer subscribes with:
 *   events.aiCli.onEvent(callback)
 *   events.aiCli.onPermissionRequest(callback)
 *
 * The main process pushes events via controlPlane.broadcast() which calls
 * sender.send(AFFINE_EVENT_CHANNEL_NAME, 'aiCli:event', ...) directly.
 * These event registrations declare the channels so they appear in
 * ExposedMeta and the preload builds the subscription machinery.
 *
 * Note: the actual event push happens in CLIControlPlane.broadcast() and
 * does NOT go through these registrar functions. These registrars just need
 * to return a no-op cleanup so the meta is populated correctly.
 */

import type { MainEventRegister } from '../type';

/**
 * Streaming CLI events (text_chunk, tool_call, task_complete, error, etc.)
 * Each payload: { requestId: string, event: CLIEvent }
 */
const onEvent: MainEventRegister = (_cb: (...args: unknown[]) => void) => {
  // Events are pushed directly from CLIControlPlane via sender.send()
  // This registration just surfaces the channel in ExposedMeta.
  return () => {};
};

/**
 * Permission request that needs user approval in the renderer.
 * Payload: PermissionRequest
 */
const onPermissionRequest: MainEventRegister = (
  _cb: (...args: unknown[]) => void
) => {
  return () => {};
};

/**
 * Capability request — main process asks renderer for live Yjs data.
 * Payload: { requestId: string, op: string, args: unknown }
 */
const onCapRequest: MainEventRegister = (_cb: (...args: unknown[]) => void) => {
  return () => {};
};

export const aiCliEvents: Record<string, MainEventRegister> = {
  onEvent,
  onPermissionRequest,
  onCapRequest,
};
