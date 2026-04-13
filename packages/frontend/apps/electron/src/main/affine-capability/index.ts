/**
 * AFFiNE Capability Layer — main-process side.
 *
 * Bridges the local REST server (which Claude reaches via Bash/curl) to the
 * renderer (which owns the live Yjs store) via IPC.
 *
 * Read operations: send an IPC request to the renderer, wait for the
 * renderer to respond with serialised data.
 *
 * Write operations: send the proposed markdown to the renderer, which feeds
 * it into insertFromMarkdown directly — changes are visible immediately.
 *
 * The renderer registers a listener on 'aiCli:capRequest' events and
 * responds via ipcMain.once('aiCli:capResponse:<requestId>').
 */

import type { WebContents } from 'electron';
import { ipcMain } from 'electron';
import { nanoid } from 'nanoid';

import { AFFINE_EVENT_CHANNEL_NAME } from '../../shared/type';

const CAP_TIMEOUT_MS = 15_000;

export interface DocMeta {
  id: string;
  title: string;
  tags: string[];
  updatedAt: string;
}

export interface SearchResult {
  docId: string;
  docTitle: string;
  excerpt: string;
  blockId?: string;
  score: number;
}

export interface SelectionInfo {
  docId: string;
  blockIds: string[];
  markdown: string;
}

export class AFFiNECapability {
  private sender: WebContents | null = null;

  setActiveSender(sender: WebContents): void {
    this.sender = sender;
  }

  /** Read a document as markdown with <!-- block:ID --> annotations */
  async readDoc(docId: string): Promise<string> {
    const result = await this.request('readDoc', { docId });
    return result as string;
  }

  /** List all documents in the active workspace */
  async listDocs(): Promise<DocMeta[]> {
    const result = await this.request('listDocs', {});
    return result as DocMeta[];
  }

  /** Keyword + semantic search across the workspace */
  async searchWorkspace(
    query: string,
    opts: { limit?: number } = {}
  ): Promise<SearchResult[]> {
    const result = await this.request('searchWorkspace', { query, ...opts });
    return result as SearchResult[];
  }

  /** Get the current editor selection as markdown + block IDs */
  async getSelection(): Promise<SelectionInfo> {
    const result = await this.request('getSelection', {});
    return result as SelectionInfo;
  }

  /** Get the block tree structure of a document */
  async getBlockTree(docId: string): Promise<unknown> {
    const result = await this.request('getBlockTree', { docId });
    return result;
  }

  /**
   * Propose changes to a document.
   * The renderer feeds the proposed markdown into BlockDiffService,
   * which shows the diff widget for accept/reject.
   * Returns when the renderer has received (not yet accepted) the proposal.
   */
  async applyChanges(docId: string, proposedMarkdown: string): Promise<void> {
    await this.request('applyChanges', { docId, proposedMarkdown });
  }

  /**
   * Create a new page in the workspace.
   * Returns the new document's ID.
   */
  async createPage(title: string, initialContent?: string): Promise<string> {
    const result = await this.request('createPage', {
      title,
      initialContent,
    });
    return result as string;
  }

  // ---------------------------------------------------------------------------

  private request(op: string, args: unknown): Promise<unknown> {
    if (!this.sender || this.sender.isDestroyed()) {
      return Promise.reject(
        new Error('No active renderer for capability request')
      );
    }

    const sender = this.sender;
    const requestId = nanoid();

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        ipcMain.removeAllListeners(`aiCli:capResponse:${requestId}`);
        reject(
          new Error(
            `Capability request "${op}" timed out after ${CAP_TIMEOUT_MS}ms`
          )
        );
      }, CAP_TIMEOUT_MS);

      ipcMain.once(
        `aiCli:capResponse:${requestId}`,
        (_event, response: { data?: unknown; error?: string }) => {
          clearTimeout(timeoutHandle);
          if (response.error) {
            reject(new Error(response.error));
          } else {
            resolve(response.data);
          }
        }
      );

      try {
        sender.send(AFFINE_EVENT_CHANNEL_NAME, 'aiCli:onCapRequest', {
          requestId,
          op,
          args,
        });
      } catch (err) {
        clearTimeout(timeoutHandle);
        ipcMain.removeAllListeners(`aiCli:capResponse:${requestId}`);
        reject(err);
      }
    });
  }
}
