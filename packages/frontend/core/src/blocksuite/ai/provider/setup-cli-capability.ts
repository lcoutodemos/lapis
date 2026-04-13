/**
 * Setup CLI Capability Registry.
 *
 * Called once during app initialization (with access to DI services).
 * Wires live AFFiNE services (DocsService, WorkspaceService, etc.) into the
 * CLICapabilityRegistry so they can be called from the IPC handler.
 *
 * This is the layer that has full access to:
 *   - DocsService (list/open/create docs)
 *   - Workspace.docCollection (BlockSuite workspace)
 *   - The active editor host (for BlockDiffProvider and selection)
 *   - parsePageDoc (markdown conversion)
 */

import { parsePageDoc } from '@affine/reader';
import type { EditorHost } from '@blocksuite/affine/std';
import { TextSelection } from '@blocksuite/affine/std';
import type { Store } from '@blocksuite/affine/store';

import type { DocsService } from '../../../modules/doc/services/docs';
import type { Workspace } from '../../../modules/workspace/entities/workspace';
import {
  type CLICapabilityRegistry,
  type CLICapabilitySearchResult,
  registerCLICapability,
} from './cli-capability-registry';

// ---------------------------------------------------------------------------
// Global active-editor reference
// Updated by the editor component when it mounts/unmounts
// ---------------------------------------------------------------------------

let _activeEditorHost: EditorHost | null = null;

/** Called by the editor component when it becomes active */
export function setActiveCLIEditorHost(host: EditorHost | null): void {
  _activeEditorHost = host;
}

function getActiveHost(): EditorHost | null {
  return _activeEditorHost;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function docStoreToMarkdown(
  store: Store,
  workspaceId: string
): Promise<string> {
  const spaceDoc = (store as any).doc?.spaceDoc ?? (store as any).spaceDoc;
  if (!spaceDoc) {
    throw new Error('Could not access underlying YDoc for markdown conversion');
  }

  const parsed = parsePageDoc({
    doc: spaceDoc,
    workspaceId,
    buildBlobUrl: (blobId: string) => `/${workspaceId}/blobs/${blobId}`,
    buildDocUrl: (docId: string) => `/workspace/${workspaceId}/${docId}`,
    aiEditable: true,
  });

  return parsed.md;
}

function getBlockTreeFromStore(store: Store): unknown {
  const notes = store.getBlocksByFlavour('affine:note');
  const buildTree = (block: any): unknown => ({
    id: block.id,
    flavour: block.flavour,
    text: block.model?.text?.toString?.() ?? '',
    children: (block.model?.children ?? []).map(buildTree),
  });
  return notes.map(buildTree);
}

// ---------------------------------------------------------------------------
// Public setup function
// ---------------------------------------------------------------------------

export interface CLICapabilitySetupOptions {
  docsService: DocsService;
  workspace: Workspace;
}

export function setupCLICapability({
  docsService,
  workspace,
}: CLICapabilitySetupOptions): void {
  const registry: CLICapabilityRegistry = {
    // -----------------------------------------------------------------------
    async readDoc(docId: string): Promise<string> {
      const bsDoc = (docsService as any)['store'].getBlockSuiteDoc(docId);
      if (!bsDoc) throw new Error(`Doc not found: ${docId}`);

      if (!bsDoc.loaded) {
        bsDoc.load();
        // Wait a tick for sync
        await new Promise(r => setTimeout(r, 50));
      }

      // getBlockSuiteDoc returns a Store directly (via doc.getStore())
      return docStoreToMarkdown(bsDoc, workspace.id);
    },

    // -----------------------------------------------------------------------
    async listDocs() {
      const docIds = docsService.list.docs$.value
        .filter((r: any) => !r.trash$.value)
        .map((r: any) => r.id as string);

      return docIds.map((id: string) => {
        const record = docsService.list.doc$(id).value;
        return {
          id,
          title: (record as any)?.title$.value ?? '(Untitled)',
          tags: ((record as any)?.meta$.value?.tags as string[]) ?? [],
          updatedAt: record
            ? new Date(
                (record as any).meta$.value?.updatedDate ?? Date.now()
              ).toISOString()
            : new Date().toISOString(),
        };
      });
    },

    // -----------------------------------------------------------------------
    async searchWorkspace(query, opts = {}) {
      const limit = opts.limit ?? 10;

      // Simple keyword search across all docs
      // TODO: integrate AFFiNE's semantic search endpoint for richer results
      const allDocs = docsService.list.docs$.value.filter(
        (r: any) => !r.trash$.value
      );

      const results: CLICapabilitySearchResult[] = [];
      const lowerQuery = query.toLowerCase();

      for (const record of allDocs as any[]) {
        const title: string = record.title$.value ?? '';
        if (title.toLowerCase().includes(lowerQuery)) {
          results.push({
            docId: record.id as string,
            docTitle: title,
            excerpt: `Document title matches "${query}"`,
            score: 1.0,
          });
          if (results.length >= limit) break;
        }
      }

      return results;
    },

    // -----------------------------------------------------------------------
    async getSelection() {
      const host = getActiveHost();
      if (!host) {
        return {
          docId: '',
          blockIds: [],
          markdown: '(No editor active)',
        };
      }

      const textSel = host.selection.find(TextSelection);
      let markdown = '';
      let blockIds: string[] = [];

      if (textSel) {
        // Get the focused block's text content
        try {
          const focusBlockId = textSel.blockId;
          const block = focusBlockId ? host.store.getBlock(focusBlockId) : null;
          blockIds = focusBlockId ? [focusBlockId] : [];
          markdown = (block?.model as any)?.text?.toString() ?? '';
        } catch {
          markdown = '';
        }
      } else {
        // Block selections
        const blockSels = host.selection.filter(
          (sel: any) => sel.type === 'block'
        );
        blockIds = blockSels
          .map((s: any) => s.blockId)
          .filter(Boolean) as string[];
        if (blockIds.length > 0) {
          const texts = blockIds
            .map(
              id =>
                (host.store.getBlock(id)?.model as any)?.text?.toString() ?? ''
            )
            .filter(Boolean);
          markdown = texts.join('\n\n');
        }
      }

      return {
        docId: host.store.id,
        blockIds,
        markdown: markdown || '(nothing selected)',
      };
    },

    // -----------------------------------------------------------------------
    async getBlockTree(docId: string) {
      const bsDoc = (docsService as any)['store'].getBlockSuiteDoc(docId);
      if (!bsDoc) throw new Error(`Doc not found: ${docId}`);
      if (!bsDoc.loaded) bsDoc.load();
      return getBlockTreeFromStore(bsDoc);
    },

    // -----------------------------------------------------------------------
    async applyChanges(docId: string, proposedMarkdown: string) {
      const host = getActiveHost();

      if (!host || host.store.id !== docId) {
        throw new Error(
          `Cannot apply changes to "${docId}": it is not the currently open document. ` +
            'Please navigate to that document first.'
        );
      }

      const store = host.store;

      // If the markdown starts with a top-level heading, use it as the doc
      // title and strip it from the body content so it's not also inserted
      // as a heading block inside the note.
      let bodyMarkdown = proposedMarkdown.trimStart();
      const titleHeadingMatch = bodyMarkdown.match(/^#\s+(.+?)(\r?\n|$)/);
      if (titleHeadingMatch) {
        const extractedTitle = titleHeadingMatch[1].trim();
        bodyMarkdown = bodyMarkdown
          .slice(titleHeadingMatch[0].length)
          .trimStart();
        docsService.changeDocTitle(docId, extractedTitle).catch(() => {});
      }

      // Get the first note block — all editable page content lives there.
      const notes = store.getBlocksByFlavour('affine:note');
      if (!notes.length) {
        throw new Error(`No note block found in doc "${docId}"`);
      }
      const note = notes[0].model;

      // Snapshot the current child IDs before deletion (the array is live).
      const existingChildIds = note.children.map(c => c.id);

      // Delete all existing content so we start fresh.
      // BlockSuite deleteBlock removes the block and all its descendants.
      for (const childId of existingChildIds) {
        store.deleteBlock(childId);
      }

      // Insert the proposed markdown content into the note.
      // Passing `host` lets the transformer resolve inline references correctly.
      const { insertFromMarkdown } = await import('../../utils/markdown-utils');
      if (bodyMarkdown) {
        await insertFromMarkdown(host, bodyMarkdown, store, note.id, 0);
      }

      // Post-write verification log.
      const afterNotes = store.getBlocksByFlavour('affine:note');
      const blockCount = afterNotes[0]?.model.children.length ?? 0;
      console.info(
        `[cli-capability] applyChanges done — doc=${docId} blocks=${blockCount}`
      );
    },

    // -----------------------------------------------------------------------
    async createPage(title: string, initialContent?: string) {
      const docRecord = docsService.createDoc();
      docsService.changeDocTitle(docRecord.id, title).catch(() => {});

      if (initialContent) {
        // Apply initial content via insertFromMarkdown after a brief settle
        await new Promise(r => setTimeout(r, 100));
        try {
          const bsDoc = (docsService as any)['store'].getBlockSuiteDoc(
            docRecord.id
          );
          if (bsDoc) {
            bsDoc.load();
            // getBlockSuiteDoc returns a Store directly
            const note = bsDoc.getBlocksByFlavour('affine:note')[0];
            if (note) {
              const { insertFromMarkdown } =
                await import('../../utils/markdown-utils');
              await insertFromMarkdown(
                undefined,
                initialContent,
                bsDoc,
                note.id,
                0
              );
            }
          }
        } catch (err) {
          console.warn(
            '[cli-capability] could not insert initial content',
            err
          );
        }
      }

      return docRecord.id;
    },
  };

  registerCLICapability(registry);
}
