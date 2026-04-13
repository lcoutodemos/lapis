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

export type { SessionState };

export class CLIBridge {
  private readonly controlPlane: CLIControlPlane;
  private capability: AFFiNECapability | null = null;
  private initialized = false;

  constructor() {
    this.controlPlane = new CLIControlPlane();
  }

  /**
   * Must be called once the MCP server is running so the bridge knows
   * which port to pass to Claude sessions.
   */
  setMcpPort(port: number): void {
    this.controlPlane['config'].mcpPort = port;
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
    signal?: AbortSignal
  ): Promise<string> {
    if (!this.initialized) await this.init();

    // Keep capability layer's sender in sync
    if (this.capability) {
      this.capability.setActiveSender(sender);
    }

    return this.controlPlane.submit(text, sender, signal);
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

  destroy(): void {
    this.controlPlane.destroy();
  }
}
