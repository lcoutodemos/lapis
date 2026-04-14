/**
 * CLIBridge — public façade.
 *
 * Single entry point used by the IPC handlers.
 * Owns both the control plane and the capability server reference.
 */

import type { WebContents } from 'electron';

import type { AFFiNECapability } from '../affine-capability/index';
import type { SessionState } from './control-plane';
import { CLIControlPlane } from './control-plane';
import type {
  CLIEvent,
  PermissionMode,
  RuntimeOptions,
} from './transports/types';

export type { RuntimeOptions, SessionState };

export class CLIBridge {
  private readonly controlPlane: CLIControlPlane;
  private capability: AFFiNECapability | null = null;
  private initialized = false;

  constructor() {
    this.controlPlane = new CLIControlPlane();
  }

  /** Tell the bridge which port the local REST server is on. */
  setLocalServerPort(port: number): void {
    this.controlPlane['config'].localServerPort = port;
  }

  setCapability(capability: AFFiNECapability): void {
    this.capability = capability;
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await this.controlPlane.init();
    this.initialized = true;
  }

  async prompt(
    text: string,
    sender: WebContents,
    signal?: AbortSignal,
    attachments?: string[]
  ): Promise<string> {
    if (!this.initialized) await this.init();

    // Keep capability layer's sender in sync
    if (this.capability) {
      this.capability.setActiveSender(sender);
    }

    return this.controlPlane.submit(text, sender, signal, attachments);
  }

  cancel(requestId: string): void {
    this.controlPlane.cancel(requestId);
  }

  respondPermission(questionId: string, optionId: string): void {
    this.controlPlane.respondPermission(questionId, optionId);
  }

  getStatus(): SessionState {
    return this.controlPlane.getState();
  }

  getRuntimeOptions(): RuntimeOptions {
    return this.controlPlane.getRuntimeOptions();
  }

  updateRuntimeOptions(opts: {
    model?: string | null;
    permissionMode?: PermissionMode;
  }): void {
    this.controlPlane.updateRuntimeOptions(opts);
  }

  async runScheduled(
    prompt: string,
    opts: {
      signal?: AbortSignal;
      model?: string;
      hookPort?: number;
      onEvent?: (event: CLIEvent) => void;
    }
  ): Promise<{ success: boolean; summary: string; errorMessage?: string }> {
    if (!this.initialized) await this.init();
    return this.controlPlane.runIsolated(prompt, opts);
  }

  destroy(): void {
    this.controlPlane.destroy();
  }
}
