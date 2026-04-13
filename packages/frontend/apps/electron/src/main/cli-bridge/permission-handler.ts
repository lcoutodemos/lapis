/**
 * HTTP hook server for Claude Code's PreToolUse permission system.
 *
 * Claude is spawned with --settings pointing to a config that contains:
 *   hooks.PreToolUse[].hooks[].command = "curl -s -X POST http://127.0.0.1:<PORT>/hook -d @-"
 *
 * When Claude wants to run a tool:
 *   1. It executes the hook command with tool info as JSON on stdin
 *   2. The hook command POSTs the JSON to this server
 *   3. This server blocks waiting for the UI to call respondPermission()
 *   4. The server returns the decision to curl
 *   5. curl echoes the JSON back to Claude on stdout
 *   6. Claude reads the decision and proceeds or aborts
 */

import http from 'node:http';

import { nanoid } from 'nanoid';

import { logger } from '../logger';
import type { PermissionOption } from './transports/types';

export interface PermissionRequest {
  questionId: string;
  toolName: string;
  toolInput: unknown;
  description: string;
  options: PermissionOption[];
}

type PendingPermission = {
  request: PermissionRequest;
  resolve: (decision: any) => void;
  reject: (err: Error) => void;
  timeoutHandle: ReturnType<typeof setTimeout>;
};

const PERMISSION_TIMEOUT_MS = 120_000; // 2 minutes

// All Claude Code built-in tools are auto-approved — they run in the main
// process and are sandboxed. Only AFFiNE write tools (affine_apply_changes,
// affine_create_page) require user approval.
const SAFE_TOOLS = new Set([
  // Claude Code built-ins (from session init tools list)
  'Task',
  'AskUserQuestion',
  'Bash',
  'CronCreate',
  'CronDelete',
  'CronList',
  'Edit',
  'EnterPlanMode',
  'EnterWorktree',
  'ExitPlanMode',
  'ExitWorktree',
  'Glob',
  'Grep',
  'LS',
  'ListMcpResourcesTool',
  'Monitor',
  'NotebookEdit',
  'Read',
  'ReadMcpResourceTool',
  'RemoteTrigger',
  'ScheduleWakeup',
  'TaskCreate',
  'TaskGet',
  'TaskList',
  'TaskOutput',
  'TaskStop',
  'TaskUpdate',
  'TodoRead',
  'TodoWrite',
  'ToolSearch',
  'WebFetch',
  'WebSearch',
  'Write',
  // AFFiNE read-only MCP tools
  'affine_read_doc',
  'affine_list_docs',
  'affine_search_workspace',
  'affine_get_selection',
  'affine_get_block_tree',
]);

export class PermissionHandler {
  private readonly server: http.Server;
  private port = 0;
  private readonly pending = new Map<string, PendingPermission>();
  private onRequest?: (req: PermissionRequest) => void;

  constructor() {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch(err => logger.error(err));
    });
  }

  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server.address() as { port: number };
        this.port = addr.port;
        logger.info('[permission-handler] listening on port', this.port);
        resolve(this.port);
      });
      this.server.once('error', reject);
    });
  }

  stop(): void {
    // Reject all pending permissions so Claude doesn't hang
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutHandle);
      pending.reject(new Error('Permission server stopped'));
    }
    this.pending.clear();
    this.server.close();
  }

  /** Register a callback that fires when a new permission request arrives */
  setOnRequest(cb: (req: PermissionRequest) => void) {
    this.onRequest = cb;
  }

  /** Called from the renderer (via IPC) when the user makes a decision */
  respond(questionId: string, optionId: string): void {
    const pending = this.pending.get(questionId);
    if (!pending) {
      logger.warn('[permission-handler] no pending request for', questionId);
      return;
    }
    clearTimeout(pending.timeoutHandle);
    this.pending.delete(questionId);

    const action = optionId === 'deny' ? 'block' : 'approve';
    pending.resolve({ action });
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ) {
    if (req.method !== 'POST' || req.url !== '/hook') {
      res.writeHead(404).end();
      return;
    }

    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }

    let hookData: any;
    try {
      hookData = JSON.parse(body);
    } catch {
      // Claude Code PreToolUse hook expects {decision: 'block'} not {action}
      res
        .writeHead(400)
        .end(JSON.stringify({ decision: 'block', reason: 'Invalid JSON' }));
      return;
    }

    const toolName: string = hookData.tool_name || hookData.tool?.name || '';

    // Auto-approve safe tools without UI
    if (SAFE_TOOLS.has(toolName)) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Empty response = approved in Claude Code hook protocol
      res.end('{}');
      return;
    }

    logger.info('[permission] waiting for UI approval', { toolName });

    // Build a permission request for the UI
    const questionId = nanoid();
    const options: PermissionOption[] = [
      { id: 'allow', label: 'Allow', dangerLevel: 'low' },
      { id: 'allow_always', label: 'Allow always', dangerLevel: 'low' },
      { id: 'deny', label: 'Deny', dangerLevel: 'medium' },
    ];

    const permRequest: PermissionRequest = {
      questionId,
      toolName,
      toolInput: hookData.tool_input || hookData.tool?.input || {},
      description: `${toolName} wants to run`,
      options,
    };

    // Block until the user decides (or timeout)
    const userDecision = await new Promise<{
      decision: string;
      reason?: string;
    }>((resolve, _reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(questionId);
        logger.warn('[permission] timed out, blocking', {
          questionId,
          toolName,
        });
        resolve({ decision: 'block', reason: 'Timed out — no UI response' });
      }, PERMISSION_TIMEOUT_MS);

      this.pending.set(questionId, {
        request: permRequest,
        resolve: (d: { action: string; reason?: string }) => {
          resolve({
            decision: d.action === 'deny' ? 'block' : 'approve',
            reason: d.reason,
          });
        },
        reject: _reject,
        timeoutHandle,
      });

      // Notify renderer
      this.onRequest?.(permRequest);
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(userDecision));
  }
}
