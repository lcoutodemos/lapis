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

export interface CLICapabilitySearchResult {
  docId: string;
  docTitle: string;
  excerpt: string;
  blockId?: string;
  score: number;
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

  /** Full-text + semantic search across the workspace */
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
