/**
 * Claude Code CLI transport.
 *
 * Interaction model:
 *   - Each prompt turn spawns `claude -p` with `--input-format stream-json
 *     --output-format stream-json`. The prompt is written to stdin.
 *   - The CLI exits after one agentic turn. Multi-turn conversations are
 *     handled by passing `--resume <sessionId>` on subsequent spawns.
 *   - Permission requests are intercepted via a PreToolUse hook that POSTs
 *     to the PermissionHandler HTTP server before each tool call.
 *   - All stdout lines are parsed as NDJSON and normalised into CLIEvent.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { nanoid } from 'nanoid';

import { logger } from '../../logger';
import type { CLIEvent, ITransport, TransportStartOptions } from './types';

const buildSystemHint = (port: number): string =>
  `You are running inside AFFiNE, a collaborative knowledge workspace.
Access your AFFiNE workspace via the local REST API:

  List all documents:  curl -s http://127.0.0.1:${port}/docs
  Read a document:     curl -s http://127.0.0.1:${port}/docs/DOC_ID
  Search workspace:    curl -s -X POST http://127.0.0.1:${port}/search -H 'Content-Type: application/json' -d '{"query":"QUERY","limit":10}'
  Get selection:       curl -s http://127.0.0.1:${port}/selection
  Get block tree:      curl -s http://127.0.0.1:${port}/docs/DOC_ID/blocks
  Apply edits:         curl -s -X POST http://127.0.0.1:${port}/docs/DOC_ID/apply -H 'Content-Type: application/json' -d '{"markdown":"FULL_DOC_MARKDOWN","reason":"why"}'
  Create page:         curl -s -X POST http://127.0.0.1:${port}/docs -H 'Content-Type: application/json' -d '{"title":"Title","content":"optional markdown"}'

Always read a document before editing it. To write content, POST to /docs/DOC_ID/apply with the full document markdown — the changes are applied immediately and visible to the user. Never output markdown and expect it to be applied automatically.
Block IDs appear as HTML comments in read output. You can omit block IDs when writing new content; they will be assigned automatically.`;

export class ClaudeCodeTransport implements ITransport {
  /** Maps questionId → resolver function for pending permission responses */
  private readonly pendingPermissions = new Map<
    string,
    (optionId: string) => void
  >();

  /** Path to the settings file we write before each session */
  private settingsFilePath: string | null = null;

  respondPermission(questionId: string, optionId: string): void {
    const resolver = this.pendingPermissions.get(questionId);
    if (resolver) {
      resolver(optionId);
      this.pendingPermissions.delete(questionId);
    }
  }

  stop(): void {
    // Individual processes are per-prompt; nothing persistent to kill here.
    // Clean up settings file if present.
    if (this.settingsFilePath) {
      fs.unlink(this.settingsFilePath).catch(() => {});
      this.settingsFilePath = null;
    }
  }

  async *prompt(
    text: string,
    opts: TransportStartOptions,
    signal?: AbortSignal
  ): AsyncIterable<CLIEvent> {
    // Build settings file for this session (hooks + MCP config)
    const settingsPath = await this.writeSettingsFile(opts);
    this.settingsFilePath = settingsPath;

    const args = this.buildArgs(opts, settingsPath);

    logger.info('[claude-code] spawning', { args: args.slice(0, 6) });

    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: opts.workingDir || os.homedir(),
      env: { ...process.env },
    });

    // Abort support: kill on signal
    if (signal) {
      const onAbort = () => {
        try {
          proc.kill('SIGTERM');
        } catch {}
      };
      signal.addEventListener('abort', onAbort, { once: true });
      proc.once('exit', () => signal.removeEventListener('abort', onAbort));
    }

    // Write prompt to stdin using the --input-format stream-json envelope.
    // The outer { type, message } wrapper is required — sending a bare
    // { role, content } object causes Claude to exit silently with no output.
    const inputMessage =
      JSON.stringify({
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'text', text }],
        },
      }) + '\n';

    // Write the message, then close stdin only after the write has flushed.
    // Calling stdin.end() before the kernel buffer drains can cause Claude to
    // receive a truncated message and exit without producing any output.
    try {
      proc.stdin.write(inputMessage, () => {
        proc.stdin.end();
      });
    } catch (err) {
      logger.error('[claude-code] stdin write failed', err);
    }

    // Capture stderr for debugging
    const stderrLines: string[] = [];
    proc.stderr?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n').filter(Boolean);
      stderrLines.push(...lines);
      lines.forEach(l => logger.debug('[claude-code stderr]', l));
    });

    // Stream NDJSON events from stdout
    if (proc.stdout) {
      yield* this.streamEvents(proc.stdout, signal);
    }

    // Wait for process exit
    const exitCode = await new Promise<number>(resolve => {
      proc.once('exit', (code: number | null) => resolve(code ?? 0));
    });

    logger.info('[claude-code] exit', { exitCode });
    if (exitCode !== 0 && !signal?.aborted) {
      const stderrTail = stderrLines.slice(-5).join('\n');
      logger.warn('[claude-code] non-zero exit', exitCode, stderrTail);
    }
  }

  // ---------------------------------------------------------------------------

  private buildArgs(
    opts: TransportStartOptions,
    settingsPath: string
  ): string[] {
    const args = [
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--include-partial-messages',
      '--settings',
      settingsPath,
    ];

    const affineHint = opts.mcpPort ? buildSystemHint(opts.mcpPort) : '';
    if (opts.systemPrompt) {
      args.push(
        '--append-system-prompt',
        affineHint ? `${affineHint}\n\n${opts.systemPrompt}` : opts.systemPrompt
      );
    } else if (affineHint) {
      args.push('--append-system-prompt', affineHint);
    }

    if (opts.sessionId) {
      args.push('--resume', opts.sessionId);
    }

    if (opts.model) {
      args.push('--model', opts.model);
    }

    if (opts.maxTurns) {
      args.push('--max-turns', String(opts.maxTurns));
    }

    // Pre-approve all tools at the Claude Code CLI level so the CLI's own
    // permission UI never interrupts. Our PreToolUse hook server handles the
    // actual approval flow for AFFiNE write operations.
    const safeTools = opts.allowedTools ?? [
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
      'affine_read_doc',
      'affine_list_docs',
      'affine_search_workspace',
      'affine_get_selection',
      'affine_get_block_tree',
      'affine_apply_changes',
      'affine_create_page',
    ];
    if (safeTools.length > 0) {
      args.push('--allowedTools', safeTools.join(','));
    }

    return args;
  }

  private async writeSettingsFile(
    opts: TransportStartOptions
  ): Promise<string> {
    const settings: Record<string, unknown> = {};

    // Register the permission hook so the PermissionHandler can intercept writes
    if (opts.hookPort) {
      settings['hooks'] = {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [
              {
                type: 'command',
                command: `curl -s -X POST http://127.0.0.1:${opts.hookPort}/hook -H "Content-Type: application/json" -d @-`,
              },
            ],
          },
        ],
      };
    }

    const tmpFile = path.join(
      os.tmpdir(),
      `affine-claude-settings-${nanoid()}.json`
    );
    await fs.writeFile(tmpFile, JSON.stringify(settings, null, 2), 'utf-8');
    return tmpFile;
  }

  private async *streamEvents(
    stdout: NodeJS.ReadableStream,
    signal?: AbortSignal
  ): AsyncIterable<CLIEvent> {
    const queue: CLIEvent[] = [];
    let wakeUp: (() => void) | null = null;
    let ended = false;

    const push = (event: CLIEvent) => {
      queue.push(event);
      wakeUp?.();
    };

    // Buffer chunks into lines ourselves — readline.createInterface
    // can re-emit lines after the stream ends, causing missed events.
    let buffer = '';
    const processChunk = (chunk: Buffer | string) => {
      buffer += chunk.toString();
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        logger.debug('[claude-code] stdout line', line.slice(0, 200));
        const event = this.parseLine(line);
        if (event) push(event);
      }
    };

    stdout.on('data', processChunk);
    stdout.once('end', () => {
      // Flush any remaining buffer
      if (buffer.trim()) {
        const event = this.parseLine(buffer.trim());
        if (event) push(event);
      }
      ended = true;
      wakeUp?.();
    });

    try {
      while (true) {
        if (queue.length === 0) {
          if (ended) break;
          if (signal?.aborted) break;
          await new Promise<void>(resolve => {
            wakeUp = resolve;
          });
          wakeUp = null;
          continue;
        }
        const event = queue.shift();
        if (!event) break;
        yield event;
        // Stop streaming after the model's turn ends
        if (event.type === 'task_complete' || event.type === 'error') {
          break;
        }
      }
    } finally {
      stdout.removeAllListeners('data');
    }
  }

  private parseLine(line: string): CLIEvent | null {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(line);
    } catch {
      return null;
    }

    if (!raw || typeof raw !== 'object') return null;

    logger.debug('[claude-code] raw event', {
      type: raw['type'],
      subtype: raw['subtype'],
    });

    switch (raw['type']) {
      case 'system': {
        if (raw['subtype'] === 'init') {
          const tools = (raw['tools'] as any[]) ?? [];
          return {
            type: 'session_init',
            sessionId: String(raw['session_id'] ?? ''),
            tools: tools.map((t: any) =>
              typeof t === 'string' ? t : (t?.name ?? '')
            ),
            model: String(raw['model'] ?? 'unknown'),
          };
        }
        return null;
      }

      case 'stream_event': {
        // Claude Code NDJSON uses the field name 'event', not 'stream_event'
        const se = (raw['event'] ?? raw['stream_event']) as
          | Record<string, unknown>
          | undefined;
        if (!se) return null;
        logger.debug('[claude-code] stream subevent', { type: se['type'] });

        // Text streaming
        if (
          se['type'] === 'content_block_delta' &&
          (se['delta'] as any)?.type === 'text_delta'
        ) {
          return {
            type: 'text_chunk',
            text: String((se['delta'] as any).text ?? ''),
          };
        }

        // Tool call starts
        if (
          se['type'] === 'content_block_start' &&
          (se['content_block'] as any)?.type === 'tool_use'
        ) {
          const block = se['content_block'] as any;
          return {
            type: 'tool_call',
            toolName: String(block.name ?? ''),
            toolId: String(block.id ?? ''),
            input: block.input,
          };
        }

        return null;
      }

      case 'assistant': {
        // Suppress: the full assistant message is a replay of what the
        // streaming text_delta events already delivered. Parsing it would
        // duplicate every response in the UI.
        return null;
      }

      case 'result': {
        return {
          type: 'task_complete',
          text: String(raw['result'] ?? ''),
          costUsd:
            typeof raw['total_cost_usd'] === 'number'
              ? raw['total_cost_usd']
              : undefined,
          durationMs:
            typeof raw['duration_ms'] === 'number'
              ? raw['duration_ms']
              : undefined,
        };
      }

      case 'rate_limit_event': {
        return {
          type: 'rate_limit',
          retryAfterMs:
            typeof raw['reset_after_ms'] === 'number'
              ? raw['reset_after_ms']
              : 60_000,
        };
      }

      default:
        return null;
    }
  }
}
