/**
 * CLI Capability Registry.
 *
 * A simple global registry that decouples the capability-ops handler
 * (which must be importable without any DI context) from the actual
 * implementation (which needs access to services like DocsService,
 * WorkspaceService, and the live editor host).
 *
 * Usage:
 *   // At app init (has access to DI services):
 *   registerCLICapability({ readDoc: ..., applyChanges: ..., ... });
 *
 *   // In the capability handler (no DI context needed):
 *   const cap = getCLICapability();
 *   const markdown = await cap.readDoc(docId);
 */

export interface CLICapabilityDocMeta {
  id: string;
  title: string;
  tags: string[];
  updatedAt: string;
}

export interface CLICapabilityCollectionMeta {
  id: string;
  name: string;
}

export interface CLICapabilitySearchResult {
  docId: string;
  title: string;
  /** Highlighted block content excerpt (may contain <b>…</b> markers) */
  snippet: string;
  /** ID of the matched block, if any */
  blockId?: string;
  /** Relevance score from the FTS engine */
  score: number;
  /** ISO timestamp of doc's last update */
  updatedAt?: string;
}

export interface CLICapabilitySelectionInfo {
  docId: string;
  blockIds: string[];
  markdown: string;
}

export interface CLICapabilityRegistry {
  /** Read a document as markdown with <!-- block:ID --> annotations */
  readDoc(docId: string): Promise<string>;

  /** List all non-trashed documents */
  listDocs(): Promise<CLICapabilityDocMeta[]>;

  /**
   * Full-text search across all block content in the workspace.
   * Backed by SQLite FTS5 via the indexer — matches on block content, not
   * just titles. Returns metadata-only hits (no chunks) so the agent can
   * decide which docs to read in full.
   */
  searchWorkspace(
    query: string,
    opts?: { limit?: number }
  ): Promise<CLICapabilitySearchResult[]>;

  /** Get the current editor's selection */
  getSelection(): Promise<CLICapabilitySelectionInfo>;

  /** Get hierarchical block tree for a document */
  getBlockTree(docId: string): Promise<unknown>;

  /**
   * Propose changes to a document via the diff widget.
   * Shows the accept/reject UI to the user.
   */
  applyChanges(docId: string, proposedMarkdown: string): Promise<void>;

  /** Create a new page in the workspace, return new docId */
  createPage(title: string, initialContent?: string): Promise<string>;

  /** List all collections in the workspace */
  listCollections(): Promise<CLICapabilityCollectionMeta[]>;

  /** Create a new collection, return its ID */
  createCollection(name: string): Promise<string>;

  /** Add a document to a collection's allowList */
  addDocToCollection(collectionId: string, docId: string): Promise<void>;

  /** Remove a document from a collection's allowList */
  removeDocFromCollection(collectionId: string, docId: string): Promise<void>;

  /** Permanently delete a collection */
  deleteCollection(id: string): Promise<void>;
}

let _registry: CLICapabilityRegistry | null = null;

export function registerCLICapability(registry: CLICapabilityRegistry): void {
  _registry = registry;
}

export function getCLICapability(): CLICapabilityRegistry {
  if (!_registry) {
    throw new Error(
      'CLI capability registry not initialized. Call registerCLICapability() during app setup.'
    );
  }
  return _registry;
}
