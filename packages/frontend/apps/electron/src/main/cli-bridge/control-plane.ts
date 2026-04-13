/**
 * CLI Control Plane — manages a single long-running CLI session.
 *
 * Responsibilities:
 *  - Session lifecycle (start, queue prompts, track state)
 *  - Request queue with backpressure (max 32 queued)
 *  - Idempotency via requestId deduplication
 *  - Broadcast CLIEvents to the registered renderer webContents
 *  - Forward permission requests from PermissionHandler to the renderer
 *
 * V1 has a single session. Multi-session pooling can be added later.
 */

import type { WebContents } from 'electron';
import { nanoid } from 'nanoid';

import { AFFINE_EVENT_CHANNEL_NAME } from '../../shared/type';
import { logger } from '../logger';
import type { PermissionRequest } from './permission-handler';
import { PermissionHandler } from './permission-handler';
import { ClaudeCodeTransport } from './transports/claude-code';
import type {
  CLIEvent,
  CLIModel,
  PermissionMode,
  RuntimeOptions,
  TransportStartOptions,
} from './transports/types';

const MAX_QUEUE_DEPTH = 32;

export interface ControlPlaneConfig {
  workingDir?: string;
  model?: string;
  localServerPort?: number;
  maxTurns?: number;
}

export type SessionStatus = 'idle' | 'running' | 'dead';

interface QueuedRequest {
  requestId: string;
  prompt: string;
  attachments?: string[];
  resolve: () => void;
  reject: (err: Error) => void;
  signal?: AbortSignal;
}

export interface SessionState {
  sessionId: string | null;
  status: SessionStatus;
  model: string;
  tools: string[];
  startedAt: number;
  lastActivityAt: number;
  currentRequestId: string | null;
  queueDepth: number;
  hookPort: number;
}

export class CLIControlPlane {
  static readonly AVAILABLE_MODELS: CLIModel[] = [
    {
      id: 'claude-opus-4-6',
      label: 'Claude Opus 4.6',
      category: 'Claude',
      version: 'Opus 4.6',
    },
    {
      id: 'claude-sonnet-4-6',
      label: 'Claude Sonnet 4.6',
      category: 'Claude',
      version: 'Sonnet 4.6',
    },
    {
      id: 'claude-haiku-4-5-20251001',
      label: 'Claude Haiku 4.5',
      category: 'Claude',
      version: 'Haiku 4.5',
    },
  ];

  private readonly transport: ClaudeCodeTransport;
  private readonly permissionHandler: PermissionHandler;

  private sessionId: string | null = null;
  private status: SessionStatus = 'idle';
  private model = '';
  private tools: string[] = [];
  private startedAt = 0;
  private lastActivityAt = 0;
  private currentRequestId: string | null = null;

  // Runtime user preferences
  private selectedModel: string | null = null;
  private permissionMode: PermissionMode = 'default';

  private readonly queue: QueuedRequest[] = [];
  private readonly inflightRequestIds = new Set<string>();

  private sender: WebContents | null = null;
  private hookPort = 0;

  private readonly config: ControlPlaneConfig;
  private initialized = false;

  constructor(config: ControlPlaneConfig = {}) {
    this.config = config;
    this.transport = new ClaudeCodeTransport();
    this.permissionHandler = new PermissionHandler();

    this.permissionHandler.setOnRequest(req => {
      this.emitPermissionRequest(req);
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.hookPort = await this.permissionHandler.start();
    this.initialized = true;
    logger.info('[control-plane] initialized, hook port', this.hookPort);
  }

  /** Register the renderer that should receive streaming events */
  setActiveSender(sender: WebContents): void {
    this.sender = sender;
  }

  /** State snapshot for IPC status queries */
  getState(): SessionState {
    return {
      sessionId: this.sessionId,
      status: this.status,
      model: this.model,
      tools: this.tools,
      startedAt: this.startedAt,
      lastActivityAt: this.lastActivityAt,
      currentRequestId: this.currentRequestId,
      queueDepth: this.queue.length,
      hookPort: this.hookPort,
    };
  }

  /** Current CLI runtime options (models, selected model, permission mode) */
  getRuntimeOptions(): RuntimeOptions {
    return {
      models: CLIControlPlane.AVAILABLE_MODELS,
      selectedModel: this.selectedModel,
      permissionMode: this.permissionMode,
    };
  }

  /** Update runtime preferences — applied on the next prompt spawn */
  updateRuntimeOptions(
    opts: Partial<{ model: string | null; permissionMode: PermissionMode }>
  ): void {
    if (opts.model !== undefined) {
      this.selectedModel = opts.model;
      logger.info('[control-plane] model set to', opts.model);
    }
    if (opts.permissionMode !== undefined) {
      this.permissionMode = opts.permissionMode;
      this.permissionHandler.setPermissionMode(opts.permissionMode);
      logger.info('[control-plane] permissionMode set to', opts.permissionMode);
    }
  }

  /**
   * Submit a prompt. Returns a requestId.
   * The caller can track progress by listening to aiCli events.
   */
  async submit(
    prompt: string,
    sender: WebContents,
    signal?: AbortSignal,
    attachments?: string[]
  ): Promise<string> {
    if (!this.initialized) await this.init();

    if (this.queue.length >= MAX_QUEUE_DEPTH) {
      throw new Error(
        'CLI request queue is full. Please wait before submitting more requests.'
      );
    }

    const requestId = nanoid();

    // Idempotency guard (shouldn't happen in normal flow)
    if (this.inflightRequestIds.has(requestId)) {
      throw new Error('Duplicate requestId');
    }

    this.setActiveSender(sender);
    logger.info('[control-plane] submit', { prompt: prompt.slice(0, 80) });

    return new Promise<string>((outerResolve, outerReject) => {
      this.queue.push({
        requestId,
        prompt,
        attachments,
        signal,
        resolve: () => outerResolve(requestId),
        reject: outerReject,
      });

      // Start processing if idle
      if (this.status === 'idle') {
        this.processNext().catch(err => {
          logger.error('[control-plane] processNext error', err);
        });
      }

      outerResolve(requestId);
    });
  }

  /** Cancel in-flight request by requestId */
  cancel(requestId: string): void {
    // Remove from queue if not yet started
    const idx = this.queue.findIndex(r => r.requestId === requestId);
    if (idx !== -1) {
      const req = this.queue.splice(idx, 1)[0];
      req.reject(new Error('Cancelled'));
      return;
    }

    // If currently running, abort the transport
    if (this.currentRequestId === requestId) {
      this.transport.stop();
    }
  }

  /** Forward a permission decision from the renderer to the hook server */
  respondPermission(questionId: string, optionId: string): void {
    this.permissionHandler.respond(questionId, optionId);
  }

  /** Teardown — called on app quit */
  destroy(): void {
    this.transport.stop();
    this.permissionHandler.stop();
    for (const req of this.queue) {
      req.reject(new Error('Control plane destroyed'));
    }
    this.queue.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Private

  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.status = 'idle';
      return;
    }

    const request = this.queue.shift();
    if (!request) {
      this.status = 'idle';
      return;
    }

    if (request.signal?.aborted) {
      // Skip cancelled requests
      return this.processNext();
    }

    this.status = 'running';
    this.currentRequestId = request.requestId;
    this.inflightRequestIds.add(request.requestId);
    this.lastActivityAt = Date.now();

    const opts: TransportStartOptions = {
      sessionId: this.sessionId ?? undefined,
      workingDir: this.config.workingDir,
      // selectedModel takes precedence over the static config default
      model: this.selectedModel ?? this.config.model,
      localServerPort: this.config.localServerPort,
      maxTurns: this.config.maxTurns ?? 50,
      hookPort: this.hookPort,
    };

    try {
      let accumulated = '';
      let sawCompletion = false;

      for await (const event of this.transport.prompt(
        request.prompt,
        opts,
        request.signal,
        request.attachments
      )) {
        this.lastActivityAt = Date.now();

        // Capture session ID from first init event
        if (event.type === 'session_init') {
          if (!this.sessionId) {
            this.sessionId = event.sessionId;
            this.startedAt = Date.now();
          }
          this.model = event.model;
          this.tools = event.tools;
        }

        // Accumulate text for the fallback completion event
        if (event.type === 'text_chunk') {
          accumulated += event.text;
        }

        // Track whether the transport already sent a completion signal
        if (event.type === 'task_complete' || event.type === 'error') {
          sawCompletion = true;
        }

        logger.debug('[control-plane] broadcast', {
          requestId: request.requestId,
          type: event.type,
        });
        this.broadcast(event, request.requestId);
      }

      // Guarantee the renderer always receives a completion signal.
      // Without this, promptViaCLI()'s async iterator never exits and
      // the UI stays on "AI is generating..." forever.
      if (!sawCompletion) {
        logger.warn(
          '[control-plane] no task_complete from transport — emitting synthetic',
          { requestId: request.requestId }
        );
        this.broadcast(
          { type: 'task_complete', text: accumulated },
          request.requestId
        );
      }

      this.status = 'idle';
      this.currentRequestId = null;
      this.inflightRequestIds.delete(request.requestId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error('[control-plane] prompt error', err);

      this.broadcast({ type: 'error', message }, request.requestId);

      this.status = 'dead';
      this.currentRequestId = null;
      this.inflightRequestIds.delete(request.requestId);

      // Invalidate session on fatal errors
      if (
        message.includes('ENOENT') ||
        message.includes('spawn') ||
        message.includes('killed')
      ) {
        this.sessionId = null;
      }
    }

    // Process next queued request
    this.status = 'idle';
    await this.processNext();
  }

  private broadcast(event: CLIEvent, requestId: string): void {
    if (!this.sender || this.sender.isDestroyed()) return;
    try {
      this.sender.send(AFFINE_EVENT_CHANNEL_NAME, 'aiCli:onEvent', {
        requestId,
        event,
      });
    } catch (err) {
      logger.error('[control-plane] broadcast error', err);
    }
  }

  private emitPermissionRequest(req: PermissionRequest): void {
    if (!this.sender || this.sender.isDestroyed()) return;
    try {
      this.sender.send(
        AFFINE_EVENT_CHANNEL_NAME,
        'aiCli:onPermissionRequest',
        req
      );
    } catch (err) {
      logger.error('[control-plane] emit permission error', err);
    }
  }
}
