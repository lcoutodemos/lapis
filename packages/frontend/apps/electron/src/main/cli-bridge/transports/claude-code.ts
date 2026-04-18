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

/**
 * Convert a data URL (data:<mime>;base64,<data>) into an Anthropic SDK
 * content block.  Returns null for unrecognised or non-base64 URLs so callers
 * can safely filter them out.
 *
 * Supported block types:
 *  - image/*      → { type: "image", source: { type: "base64", ... } }
 *  - application/pdf | text/* → { type: "document", source: { type: "base64", ... } }
 */
function dataUrlToContentBlock(dataUrl: string): unknown | null {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return null;
  const [, mediaType, data] = match;

  if (mediaType.startsWith('image/')) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data },
    };
  }

  if (mediaType === 'application/pdf' || mediaType.startsWith('text/')) {
    return {
      type: 'document',
      source: { type: 'base64', media_type: mediaType, data },
    };
  }

  return null;
}

const buildSystemHint = (port: number): string =>
  `AFFiNE workspace API on 127.0.0.1:${port} — use curl via Bash.

Documents:
  GET    /docs                                           list docs (JSON)
  GET    /docs/:id                                       read doc as markdown with <!-- block:ID --> anchors
  POST   /docs            {"title":"…","content":"…"}    create doc → {docId, title}
  POST   /docs/:id/apply  {"markdown":"…"}               write doc — read first, send full new markdown
  POST   /search          {"query":"…","limit":10}       full-text search across block content → [{docId, title, snippet, blockId?, score, updatedAt?}]; snippets have <b>…</b> highlights — use hits as pointers, then GET /docs/:id for full content
  GET    /selection                                      current editor selection (use when user says "this")

Collections (grouped sets of docs, like folders or tags):
  GET    /collections                                    list collections (JSON)
  POST   /collections            {"name":"…"}            create collection → {collectionId, name}
  POST   /collections/:id/docs   {"docId":"…"}           add doc to collection
  DELETE /collections/:id/docs/:docId                    remove doc from collection
  DELETE /collections/:id                                delete collection

Writes via /apply are immediately visible in the editor. Never emit markdown expecting auto-apply — always POST to /apply.
After any task — whether using tools or not — always write a brief chat reply (1-3 sentences) summarising what you did or answering the question directly.`;

export class ClaudeCodeTransport implements ITransport {
  /** Path to the settings file we write before each session */
  private settingsFilePath: string | null = null;

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
    signal?: AbortSignal,
    attachments?: string[]
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

    // Capture spawn errors so unhandled 'error' events can't crash the process
    // and so the runner never hangs awaiting 'exit' that never fires.
    const spawnErrorRef: { current: Error | null } = { current: null };
    proc.on('error', (err: Error) => {
      spawnErrorRef.current = err;
      logger.error('[claude-code] spawn error', err);
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
    const content: unknown[] = [];

    // Prepend image/document blocks before the text so Claude sees them first.
    if (attachments?.length) {
      for (const dataUrl of attachments) {
        const block = dataUrlToContentBlock(dataUrl);
        if (block) content.push(block);
      }
    }

    content.push({ type: 'text', text });

    const inputMessage =
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content },
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

    // Wait for process exit (or spawn error — whichever fires first).
    // On ENOENT/EACCES the subprocess never reaches 'exit', only 'error'.
    const exitCode = await new Promise<number>(resolve => {
      let settled = false;
      proc.once('exit', (code: number | null) => {
        if (settled) return;
        settled = true;
        resolve(code ?? 0);
      });
      proc.once('error', () => {
        if (settled) return;
        settled = true;
        resolve(1);
      });
    });

    if (spawnErrorRef.current) {
      logger.warn('[claude-code] spawn failed', {
        message: spawnErrorRef.current.message,
      });
    }

    logger.info('[claude-code] exit', {
      exitCode,
      hadSpawnError: !!spawnErrorRef.current,
    });
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

    const affineHint = opts.localServerPort
      ? buildSystemHint(opts.localServerPort)
      : '';
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
    ];
    // Remove web tools if the task has disabled web access
    const finalTools =
      opts.webAccess === false
        ? safeTools.filter(t => t !== 'WebFetch' && t !== 'WebSearch')
        : safeTools;
    if (finalTools.length > 0) {
      args.push('--allowedTools', finalTools.join(','));
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

    // Per-turn accumulator: tracks tool_use blocks by their stream index so
    // we can reconstruct the full input JSON from incremental input_json_delta
    // fragments. Keyed by the 'index' field Claude Code emits on every event.
    const pendingBlocks = new Map<
      number,
      { toolId: string; toolName: string; json: string }
    >();

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
        const event = this.parseLine(line, pendingBlocks);
        if (event) push(event);
      }
    };

    stdout.on('data', processChunk);
    stdout.once('end', () => {
      // Flush any remaining buffer
      if (buffer.trim()) {
        const event = this.parseLine(buffer.trim(), pendingBlocks);
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

  private parseLine(
    line: string,
    pendingBlocks: Map<
      number,
      { toolId: string; toolName: string; json: string }
    >
  ): CLIEvent | null {
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
        const blockIndex = typeof se['index'] === 'number' ? se['index'] : -1;

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

        // Tool call: register block start, accumulate input in subsequent deltas.
        // We do NOT emit yet — wait for content_block_stop so we have the full input.
        if (
          se['type'] === 'content_block_start' &&
          (se['content_block'] as any)?.type === 'tool_use'
        ) {
          const block = se['content_block'] as any;
          if (blockIndex >= 0) {
            pendingBlocks.set(blockIndex, {
              toolId: String(block.id ?? ''),
              toolName: String(block.name ?? ''),
              json: '',
            });
          }
          return null; // defer until input is complete
        }

        // Accumulate streaming input JSON fragments
        if (
          se['type'] === 'content_block_delta' &&
          (se['delta'] as any)?.type === 'input_json_delta'
        ) {
          const pending =
            blockIndex >= 0 ? pendingBlocks.get(blockIndex) : null;
          if (pending) {
            pending.json += String((se['delta'] as any).partial_json ?? '');
          }
          return null;
        }

        // Block complete — emit tool_call with the fully assembled input
        if (se['type'] === 'content_block_stop' && blockIndex >= 0) {
          const pending = pendingBlocks.get(blockIndex);
          if (pending) {
            pendingBlocks.delete(blockIndex);
            let input: unknown = {};
            try {
              input = pending.json ? JSON.parse(pending.json) : {};
            } catch {
              input = {};
            }
            return {
              type: 'tool_call',
              toolName: pending.toolName,
              toolId: pending.toolId,
              input,
            };
          }
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
