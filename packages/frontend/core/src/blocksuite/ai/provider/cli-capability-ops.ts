/**
 * CLI Capability Operations — renderer side.
 *
 * Thin dispatch layer called by the capability IPC handler in cli-provider.ts.
 * Delegates to the registered CLICapabilityRegistry, which is set up by
 * setup-cli-capability.ts during app initialization.
 */

import type {
  CLICapabilityCollectionMeta,
  CLICapabilityDocMeta,
  CLICapabilitySearchResult,
  CLICapabilitySelectionInfo,
} from './cli-capability-registry';
import { getCLICapability } from './cli-capability-registry';

export type CollectionMeta = CLICapabilityCollectionMeta;
export type DocMeta = CLICapabilityDocMeta;
export type SearchResult = CLICapabilitySearchResult;
export type SelectionInfo = CLICapabilitySelectionInfo;

export async function readDocAsMarkdown(docId: string): Promise<string> {
  return getCLICapability().readDoc(docId);
}

export async function listWorkspaceDocs(): Promise<DocMeta[]> {
  return getCLICapability().listDocs();
}

export async function searchWorkspace(
  query: string,
  opts?: { limit?: number }
): Promise<SearchResult[]> {
  return getCLICapability().searchWorkspace(query, opts);
}

export async function getEditorSelection(): Promise<SelectionInfo> {
  return getCLICapability().getSelection();
}

export async function getBlockTree(docId: string): Promise<unknown> {
  return getCLICapability().getBlockTree(docId);
}

export async function applyProposedChanges(
  docId: string,
  proposedMarkdown: string
): Promise<void> {
  return getCLICapability().applyChanges(docId, proposedMarkdown);
}

export async function createNewPage(
  title: string,
  initialContent?: string
): Promise<string> {
  return getCLICapability().createPage(title, initialContent);
}

export async function listWorkspaceCollections(): Promise<CollectionMeta[]> {
  return getCLICapability().listCollections();
}

export async function createWorkspaceCollection(name: string): Promise<string> {
  return getCLICapability().createCollection(name);
}

export async function addDocToWorkspaceCollection(
  collectionId: string,
  docId: string
): Promise<void> {
  return getCLICapability().addDocToCollection(collectionId, docId);
}

export async function removeDocFromWorkspaceCollection(
  collectionId: string,
  docId: string
): Promise<void> {
  return getCLICapability().removeDocFromCollection(collectionId, docId);
}

export async function deleteWorkspaceCollection(id: string): Promise<void> {
  return getCLICapability().deleteCollection(id);
}

// Stubs to satisfy the import in cli-provider.ts
export function getActiveEditorHost(): null {
  return null;
}
export function getActiveDocId(): string | null {
  return null;
}
export function getActiveWorkspaceId(): string | null {
  return null;
}
