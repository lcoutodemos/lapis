/**
 * CLI Provider — renderer side.
 *
 * Overrides every AIProvider action so that requests are routed through the
 * Electron CLI bridge (Claude Code / Copilot ACP) instead of AFFiNE's cloud
 * copilot provider.
 *
 * Capability requests flow:
 *   1. Main process (AFFiNECapability) sends 'aiCli:capRequest' event
 *   2. This module's handler reads live Yjs state and responds via
 *      apis.aiCli.capabilityResponse({ requestId, data })
 *
 * Action call flow (stream mode):
 *   1. AIProvider action calls promptViaCLI(prompt, opts)
 *   2. apis.aiCli.prompt({ text }) → main process → Claude CLI
 *   3. Renderer listens for aiCli:onEvent events → yields text chunks
 *   4. task_complete event resolves the stream
 *
 * This module is a no-op in browser/web builds (no electron APIs).
 */

import { readBlobAsURL } from '../utils/image';
import { AIProvider } from './ai-provider';

// ---------------------------------------------------------------------------
// Environment guard — only run inside Electron renderer
// ---------------------------------------------------------------------------

export interface CLIModelInfo {
  id: string;
  label: string;
  category: string;
  version: string;
}

export interface CLIRuntimeOptions {
  models: CLIModelInfo[];
  selectedModel: string | null;
  permissionMode: string;
}

declare global {
  interface Window {
    // Exposed by AFFiNE's preload script
    readonly __apis?: {
      aiCli?: {
        prompt: (args: { text: string }) => Promise<{ requestId: string }>;
        cancel: (args: { requestId: string }) => Promise<{ ok: boolean }>;
        respondPermission: (args: {
          questionId: string;
          optionId: string;
        }) => Promise<{ ok: boolean }>;
        capabilityResponse: (args: {
          requestId: string;
          data?: unknown;
          error?: string;
        }) => Promise<{ ok: boolean }>;
        capabilityReady: () => Promise<{ ok: boolean }>;
        status: () => Promise<unknown>;
        getRuntimeOptions: () => Promise<CLIRuntimeOptions>;
        updateRuntimeOptions: (opts: {
          model?: string | null;
          permissionMode?: string;
        }) => Promise<{ ok: boolean }>;
      };
      // Raw event subscription (built by preload)
      __eventEmitter?: unknown;
    };
    readonly __events?: {
      aiCli?: {
        onEvent: (
          cb: (payload: { requestId: string; event: CLIEventPayload }) => void
        ) => () => void;
        onPermissionRequest: (
          cb: (req: PermissionRequest) => void
        ) => () => void;
        onCapRequest: (cb: (req: CapRequest) => void) => () => void;
      };
    };
  }
}

interface CLIEventPayload {
  type: string;
  text?: string;
  message?: string;
  sessionId?: string;
  toolName?: string;
  toolId?: string;
  input?: unknown;
  costUsd?: number;
  durationMs?: number;
  questionId?: string;
  options?: Array<{ id: string; label: string; dangerLevel?: string }>;
}

interface PermissionRequest {
  questionId: string;
  toolName: string;
  description: string;
  options: Array<{ id: string; label: string; dangerLevel?: string }>;
}

interface CapRequest {
  requestId: string;
  op: string;
  args: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers to access the Electron API from the renderer
// ---------------------------------------------------------------------------

function getElectronApis() {
  // AFFiNE's preload exposes window.__apis and window.__events (double underscore)
  return {
    apis: window.__apis?.aiCli,
    events: window.__events?.aiCli,
  };
}

function isElectron(): boolean {
  return !!window.__apis?.aiCli;
}

// ---------------------------------------------------------------------------
// Core streaming primitive
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Tool activity labels — shown inline as Claude calls tools
// ---------------------------------------------------------------------------

/**
 * Parse a Bash command directed at our local REST API and return a
 * human-readable label describing what the command does.
 */
function parseBashActivity(command: string): string {
  if (/\/docs\/[^/\s]+\/apply/.test(command))
    return 'Applying changes to document';
  if (
    /POST[^|]*\/docs\b/.test(command) ||
    /-X\s*POST[^|]*\/docs\b/.test(command) ||
    /\/docs\s*['"]?\s*-d/.test(command)
  )
    return 'Creating document';
  if (/\/search/.test(command)) return 'Searching workspace';
  if (/\/docs\/[^/\s"']+/.test(command)) return 'Reading document';
  if (/\/docs/.test(command)) return 'Listing documents';
  // Truncate long raw commands for display
  const bare = command.replace(/^(curl\s+(-[a-zA-Z]+\s+)*)/i, '').trim();
  return bare.length > 60
    ? `Running: ${bare.slice(0, 57)}…`
    : `Running: ${bare}`;
}

function getToolActivityLabel(toolName: string, input: unknown): string {
  const inp = input as Record<string, unknown> | null | undefined;
  switch (toolName) {
    case 'Bash': {
      const cmd = inp?.command ? String(inp.command) : '';
      return cmd ? parseBashActivity(cmd) : 'Running command';
    }
    case 'Read': {
      const p = inp?.file_path ? String(inp.file_path).split('/').pop() : '';
      return p ? `Reading ${p}` : 'Reading file';
    }
    case 'Write': {
      const p = inp?.file_path ? String(inp.file_path).split('/').pop() : '';
      return p ? `Writing ${p}` : 'Writing file';
    }
    case 'Edit': {
      const p = inp?.file_path ? String(inp.file_path).split('/').pop() : '';
      return p ? `Editing ${p}` : 'Editing file';
    }
    case 'Grep':
      return inp?.pattern
        ? `Searching: ${String(inp.pattern).slice(0, 40)}`
        : 'Searching';
    case 'Glob':
      return 'Finding files';
    case 'WebSearch':
      return inp?.query
        ? `Web search: ${String(inp.query).slice(0, 40)}`
        : 'Searching web';
    case 'WebFetch':
      return inp?.url
        ? `Fetching ${String(inp.url).slice(0, 50)}`
        : 'Fetching URL';
    case 'Task':
      return 'Running subtask';
    case 'TodoRead':
      return 'Checking task list';
    case 'TodoWrite':
      return 'Updating task list';
    default:
      return `Using ${toolName}`;
  }
}

// ---------------------------------------------------------------------------
// Tool-activity event emitter
// Lets the chat UI show ephemeral chips while tools are running without
// injecting any text into the stored message content.
// ---------------------------------------------------------------------------

export type ToolActivityEvent =
  | { status: 'active'; label: string }
  | { status: 'done'; toolCount: number }
  | { status: 'idle' };

type ToolActivityListener = (event: ToolActivityEvent) => void;

const _activityListeners = new Set<ToolActivityListener>();

export const cliActivity = {
  subscribe(fn: ToolActivityListener): () => void {
    _activityListeners.add(fn);
    return () => _activityListeners.delete(fn);
  },
  emit(event: ToolActivityEvent): void {
    _activityListeners.forEach(fn => fn(event));
  },
};

/**
 * Send a prompt to the CLI bridge and return an AsyncIterable<string>
 * that yields each text chunk as it streams.
 */
function promptViaCLI(
  prompt: string,
  signal?: AbortSignal,
  attachments?: string[]
): { [Symbol.asyncIterator](): AsyncIterableIterator<string> } {
  const { apis, events } = getElectronApis();

  return {
    [Symbol.asyncIterator]: async function* () {
      if (!apis || !events) {
        throw new Error('CLI bridge not available (not running in Electron)');
      }

      const { requestId } = await apis.prompt({ text: prompt, attachments });
      console.info('[cli-provider] requestId', requestId);

      if (signal?.aborted) {
        await apis.cancel({ requestId });
        return;
      }

      const chunks: string[] = [];
      let wakeUp: (() => void) | null = null;
      let done = false;
      let error: string | null = null;
      // Track whether any text was streamed incrementally.
      // If not, we fall back to the task_complete result text so the chat
      // always shows something even when Claude spent the whole turn using tools.
      let streamedText = false;
      // Count tool calls so we can show "N tools used" in the done chip.
      let toolCount = 0;

      const push = (chunk: string) => {
        chunks.push(chunk);
        wakeUp?.();
      };

      const unsub = events.onEvent(payload => {
        if (payload.requestId !== requestId) return;
        const ev = payload.event;
        console.info('[cli-provider] event', ev.type);

        if (ev.type === 'text_chunk' && ev.text) {
          streamedText = true;
          push(ev.text);
        } else if (ev.type === 'tool_call' && ev.toolName) {
          toolCount += 1;
          const label = getToolActivityLabel(ev.toolName, ev.input);
          // Emit ephemeral chip event — no text is injected into the message
          cliActivity.emit({ status: 'active', label });
        } else if (ev.type === 'task_complete') {
          console.info('[cli-provider] task_complete — stream done');
          // If Claude only used tools and produced no streaming text, the
          // result summary is the only human-readable response. Push it as a
          // chunk so the chat panel always shows the assistant's reply.
          if (!streamedText && ev.text) {
            push(ev.text);
          } else if (!streamedText && toolCount > 0) {
            // Claude used tools but sent no streaming text and no summary.
            // This is the "silent action" case — e.g., wrote to the document.
            // Show a minimal confirmation so the chat panel never shows a blank bubble.
            push('Done.');
          } else if (!streamedText) {
            // Completely empty — likely a cold-start or session init issue.
            push('_(No response received — please send your message again.)_');
          }
          // Emit done chip, then clear after 1800 ms
          cliActivity.emit({ status: 'done', toolCount });
          setTimeout(() => cliActivity.emit({ status: 'idle' }), 1800);
          done = true;
          wakeUp?.();
        } else if (ev.type === 'error') {
          console.error('[cli-provider] error', ev.message);
          cliActivity.emit({ status: 'idle' });
          error = ev.message ?? 'Unknown error';
          done = true;
          wakeUp?.();
        }
      });

      const abortHandler = () => {
        apis.cancel({ requestId }).catch(() => {});
        done = true;
        wakeUp?.();
      };
      signal?.addEventListener('abort', abortHandler, { once: true });

      try {
        while (true) {
          if (chunks.length === 0) {
            if (done) break;
            await new Promise<void>(resolve => {
              wakeUp = resolve;
            });
            wakeUp = null;
            continue;
          }
          const chunk = chunks.shift();
          if (chunk !== undefined) yield chunk;
        }

        if (error) throw new Error(error);
      } finally {
        unsub();
        signal?.removeEventListener('abort', abortHandler);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Action prompt templates
// Convert AIProvider action IDs into natural-language prompts for the CLI
// ---------------------------------------------------------------------------

function buildActionPrompt(
  actionId: keyof BlockSuitePresets.AIActions,
  opts: BlockSuitePresets.AITextActionOptions
): string {
  const input = opts.input ?? '';
  const lang = (opts as any).lang ?? 'English';
  const tone = (opts as any).tone ?? 'professional';

  const docContext = opts.docId
    ? `\n\nThis is being performed on the document with ID: ${opts.docId}.`
    : '';

  switch (actionId) {
    case 'chat':
      return input + docContext;

    case 'summary':
      return `Summarise the following content concisely:\n\n${input}${docContext}`;

    case 'improveWriting':
      return `Improve the writing of the following, preserving the author's voice and intent:\n\n${input}${docContext}`;

    case 'improveGrammar':
      return `Fix grammar and spelling errors in the following without changing the meaning:\n\n${input}${docContext}`;

    case 'fixSpelling':
      return `Fix only spelling errors in the following:\n\n${input}${docContext}`;

    case 'makeLonger':
      return `Expand and elaborate on the following to make it longer and more detailed:\n\n${input}${docContext}`;

    case 'makeShorter':
      return `Shorten the following to be more concise while keeping the key points:\n\n${input}${docContext}`;

    case 'continueWriting':
      return `Continue writing from where the following ends. Match the style and tone:\n\n${input}${docContext}`;

    case 'createHeadings':
      return `Add appropriate headings and structure to the following content:\n\n${input}${docContext}`;

    case 'brainstorm':
      return `Brainstorm 5–10 creative ideas related to the following:\n\n${input}${docContext}`;

    case 'writeArticle':
      return `Write a comprehensive article about:\n\n${input}${docContext}`;

    case 'writeBlogPost':
      return `Write an engaging blog post about:\n\n${input}${docContext}`;

    case 'writePoem':
      return `Write a poem about:\n\n${input}${docContext}`;

    case 'writeTwitterPost':
      return `Write a compelling tweet (280 chars max) about:\n\n${input}${docContext}`;

    case 'writeOutline':
      return `Create a detailed outline for content about:\n\n${input}${docContext}`;

    case 'explain':
      return `Explain the following clearly and simply:\n\n${input}${docContext}`;

    case 'explainCode':
      return `Explain what the following code does, step by step:\n\n${input}${docContext}`;

    case 'checkCodeErrors':
      return `Review the following code for bugs, errors, or issues. Explain each problem and how to fix it:\n\n${input}${docContext}`;

    case 'translate':
      return `Translate the following into ${lang}:\n\n${input}${docContext}`;

    case 'changeTone':
      return `Rewrite the following in a ${tone} tone:\n\n${input}${docContext}`;

    case 'brainstormMindmap':
      return `Create a structured mind map outline for the topic:\n\n${input}${docContext}\n\nFormat as a nested list.`;

    case 'expandMindmap':
      return `Expand the following mind map with more detail and sub-topics:\n\n${input}${docContext}`;

    case 'createSlides':
      return `Create a slide deck outline for a presentation about:\n\n${input}${docContext}`;

    case 'findActions':
      return `Find and list all actionable tasks, to-dos, and action items in the following:\n\n${input}${docContext}`;

    case 'explainImage':
      return `Describe and explain the content of the attached image.${docContext}`;

    case 'generateCaption':
      return `Generate a concise, descriptive caption for the attached image.${docContext}`;

    case 'makeItReal':
      return `Convert the following description into functional HTML/CSS code:\n\n${input}${docContext}`;

    default:
      return (
        input ||
        `Perform the ${String(actionId)} action on the current document.${docContext}`
      );
  }
}

// ---------------------------------------------------------------------------
// Capability handler — handles 'aiCli:capRequest' events from main
// ---------------------------------------------------------------------------

let capabilityHandlerRegistered = false;

function ensureCapabilityHandler() {
  if (capabilityHandlerRegistered) return;
  capabilityHandlerRegistered = true;

  const { events, apis } = getElectronApis();
  if (!events || !apis) return;

  events.onCapRequest((req: CapRequest) => {
    const { requestId, op, args } = req;
    handleCapabilityOp(op, args)
      .then(data => apis.capabilityResponse({ requestId, data }))
      .catch((err: unknown) => {
        const error = err instanceof Error ? err.message : String(err);
        return apis.capabilityResponse({ requestId, error });
      })
      .catch(() => {});
  });

  // Signal to main that the renderer capability layer is ready.
  // This triggers ~/.claude.json to be written so Claude Code can find the MCP server.
  apis.capabilityReady().catch((err: unknown) => {
    console.warn('[cli-provider] capabilityReady signal failed', err);
  });
}

/**
 * Execute a capability operation using live browser/Yjs state.
 * These operations are called by AFFiNECapability in the main process.
 */
async function handleCapabilityOp(
  op: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (op) {
    case 'readDoc': {
      const { readDocAsMarkdown } = await import('./cli-capability-ops');
      return readDocAsMarkdown(String(args['docId']));
    }

    case 'listDocs': {
      const { listWorkspaceDocs } = await import('./cli-capability-ops');
      return listWorkspaceDocs();
    }

    case 'searchWorkspace': {
      const { searchWorkspace } = await import('./cli-capability-ops');
      return searchWorkspace(String(args['query']), {
        limit: typeof args['limit'] === 'number' ? args['limit'] : 10,
      });
    }

    case 'getSelection': {
      const { getEditorSelection } = await import('./cli-capability-ops');
      return getEditorSelection();
    }

    case 'getBlockTree': {
      const { getBlockTree } = await import('./cli-capability-ops');
      return getBlockTree(String(args['docId']));
    }

    case 'applyChanges': {
      const { applyProposedChanges } = await import('./cli-capability-ops');
      await applyProposedChanges(
        String(args['docId']),
        String(args['proposedMarkdown'])
      );
      return { ok: true };
    }

    case 'createPage': {
      const { createNewPage } = await import('./cli-capability-ops');
      return createNewPage(
        String(args['title']),
        args['initialContent'] ? String(args['initialContent']) : undefined
      );
    }

    default:
      throw new Error(`Unknown capability op: ${op}`);
  }
}

// ---------------------------------------------------------------------------
// Public — call this once during app init to wire up the CLI provider
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Local in-memory session store (Electron only)
// Provides the AIProvider.session / AIProvider.histories contracts without
// making any cloud API calls.
// ---------------------------------------------------------------------------

interface LocalSession {
  sessionId: string;
  workspaceId: string;
  docId: string | null;
  pinned: boolean;
  promptName: string;
  model: string;
  optionalModels: string[];
  action: string | null;
  parentSessionId: string | null;
  title: string | null;
  tokens: number;
  createdAt: string;
  updatedAt: string;
  messages: unknown[];
}

const localSessions: LocalSession[] = [];

function makeLocalSession(
  workspaceId: string,
  docId: string | null,
  overrides: Partial<LocalSession> = {}
): LocalSession {
  return {
    sessionId: `cli-${Math.random().toString(36).slice(2, 10)}`,
    workspaceId,
    docId,
    pinned: false,
    promptName: 'Chat With AFFiNE AI',
    model: 'claude',
    optionalModels: [],
    action: null,
    parentSessionId: null,
    title: null,
    tokens: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

export function registerCLIProvider(): void {
  if (!isElectron()) {
    // Not in Electron — keep AFFiNE's default cloud provider
    return;
  }

  console.info(
    '[cli-provider] Electron detected — registering CLI as AI brain'
  );

  // Register capability IPC handler
  ensureCapabilityHandler();

  // -------------------------------------------------------------------------
  // Session service — local in-memory, no cloud calls.
  // Calling AIProvider.provide('session', ...) automatically fires
  // AIProvider.slots.sessionReady.next(true), which unblocks the chat panel.
  // -------------------------------------------------------------------------
  AIProvider.provide('session', {
    createSession: async (options: any): Promise<string> => {
      if (options?.sessionId) return options.sessionId as string;
      const s = makeLocalSession(
        options?.workspaceId ?? '',
        options?.docId ?? null,
        {
          pinned: !!options?.pinned,
        }
      );
      localSessions.push(s);
      return s.sessionId;
    },
    createSessionWithHistory: async (options: any) => {
      const existing = localSessions.find(
        s =>
          s.workspaceId === options?.workspaceId &&
          s.docId === (options?.docId ?? null)
      );
      if (existing) return existing as any;
      const s = makeLocalSession(
        options?.workspaceId ?? '',
        options?.docId ?? null,
        {
          pinned: !!options?.pinned,
        }
      );
      localSessions.push(s);
      return s as any;
    },
    getSession: async (_workspaceId: string, sessionId: string) => {
      return (localSessions.find(s => s.sessionId === sessionId) ??
        null) as any;
    },
    getSessions: async (workspaceId: string, docId?: string, options?: any) => {
      let results = localSessions.filter(s => s.workspaceId === workspaceId);
      if (docId !== undefined) results = results.filter(s => s.docId === docId);
      if (options?.pinned !== undefined)
        results = results.filter(s => s.pinned === options.pinned);
      const limit = options?.limit ?? results.length;
      return results.slice(0, limit) as any;
    },
    getRecentSessions: async (workspaceId: string, limit?: number) => {
      const results = localSessions
        .filter(s => s.workspaceId === workspaceId)
        .slice(0, limit ?? 10);
      return results as any;
    },
    updateSession: async (options: any): Promise<string> => {
      const s = localSessions.find(s => s.sessionId === options?.sessionId);
      if (s && options?.pinned !== undefined) {
        s.pinned = options.pinned;
        s.updatedAt = new Date().toISOString();
      }
      return options?.sessionId ?? '';
    },
  } as unknown as BlockSuitePresets.AISessionService);

  // -------------------------------------------------------------------------
  // History service — persists messages in localSessions (in-memory, SPA-safe)
  // -------------------------------------------------------------------------
  AIProvider.provide('histories', {
    actions: async () => [],
    chats: async (workspaceId: string, sessionId: string) => {
      const session = localSessions.find(
        s => s.sessionId === sessionId && s.workspaceId === workspaceId
      );
      if (!session || session.messages.length === 0) return [];
      return [
        {
          sessionId: session.sessionId,
          tokens: session.tokens,
          action: session.action,
          createdAt: session.createdAt,
          messages: session.messages,
        },
      ] as any;
    },
    cleanup: async (
      _workspaceId: string,
      _docId: string | undefined,
      sessionIds: string[]
    ) => {
      for (const id of sessionIds) {
        const idx = localSessions.findIndex(s => s.sessionId === id);
        if (idx !== -1) localSessions.splice(idx, 1);
      }
    },
    ids: async () => [],
  } as unknown as BlockSuitePresets.AIHistoryService);

  // -------------------------------------------------------------------------
  // Helper: append a message to a session's persisted message list
  // -------------------------------------------------------------------------
  function storeMessage(
    sessionId: string | undefined,
    workspaceId: string | undefined,
    role: 'user' | 'assistant',
    content: string
  ) {
    if (!sessionId || !workspaceId || !content) return;
    const session = localSessions.find(
      s => s.sessionId === sessionId && s.workspaceId === workspaceId
    );
    if (!session) return;
    (session.messages as any[]).push({
      id: `cli-msg-${Date.now()}-${role}`,
      role,
      content,
      createdAt: new Date().toISOString(),
    });
    session.updatedAt = new Date().toISOString();
  }

  // Override all text-based AI actions
  const textActions: (keyof BlockSuitePresets.AIActions)[] = [
    'chat',
    'summary',
    'improveWriting',
    'improveGrammar',
    'fixSpelling',
    'makeLonger',
    'makeShorter',
    'continueWriting',
    'createHeadings',
    'brainstorm',
    'writeArticle',
    'writeBlogPost',
    'writePoem',
    'writeTwitterPost',
    'writeOutline',
    'explain',
    'explainCode',
    'checkCodeErrors',
    'translate',
    'changeTone',
    'brainstormMindmap',
    'expandMindmap',
    'createSlides',
    'findActions',
    'explainImage',
    'generateCaption',
    'makeItReal',
  ];

  for (const actionId of textActions) {
    // Cast needed: we're overriding the generic action dispatch with a
    // single implementation that handles all text-based action IDs.
    AIProvider.provide(actionId as any, async (opts: any) => {
      const prompt = buildActionPrompt(
        actionId,
        opts as BlockSuitePresets.AITextActionOptions
      );
      console.info(
        '[cli-provider] dispatching action via CLI:',
        actionId,
        prompt.slice(0, 80)
      );

      const sessionId: string | undefined = opts?.sessionId;
      const workspaceId: string | undefined = opts?.workspaceId;

      // The user's original input (not the transformed CLI prompt) for display
      const userText = (opts?.input as string | undefined) ?? prompt;

      // Collect image / file data URLs to forward as content blocks.
      // opts.attachments is Blob[] (from the chat input component). Convert
      // each Blob to a data URL so they can be serialised over IPC to main.
      const rawAttachments: Blob[] | undefined = opts?.attachments as
        | Blob[]
        | undefined;
      const attachments: string[] | undefined = rawAttachments?.length
        ? await Promise.all(rawAttachments.map(b => readBlobAsURL(b)))
        : undefined;

      if (opts.stream) {
        // Store messages AFTER the stream ends, not before.
        // Storing the user message before the stream mutates session.messages
        // in place. React picks this up on the next re-render (triggered by
        // setStatus('transmitting')) and sees hasSessionHistory = true, which
        // changes contentKey from doc.id to session.sessionId, tearing down
        // and recreating AIChatContent mid-stream, losing the first response.
        const inner = promptViaCLI(prompt, opts.signal, attachments);
        return {
          [Symbol.asyncIterator]: async function* () {
            let fullText = '';
            for await (const chunk of inner) {
              fullText += chunk;
              yield chunk;
            }
            storeMessage(sessionId, workspaceId, 'user', userText);
            storeMessage(sessionId, workspaceId, 'assistant', fullText);
          },
        };
      } else {
        let result = '';
        for await (const chunk of promptViaCLI(
          prompt,
          opts.signal,
          attachments
        )) {
          result += chunk;
        }
        storeMessage(sessionId, workspaceId, 'user', userText);
        storeMessage(sessionId, workspaceId, 'assistant', result);
        return result;
      }
    });
  }
}
