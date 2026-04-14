/**
 * ScheduledTaskRunner — executes one scheduled task via Claude Code CLI.
 *
 * Key design decisions:
 *  - Fresh session per run (no --resume). Token cost is bounded, no context drift.
 *  - Uses ClaudeCodeTransport directly (same mechanism as interactive chat).
 *  - No PreToolUse permission hook — tasks are unattended; if a tool would be
 *    blocked the run fails cleanly rather than waiting for user input.
 *  - System hint is injected so Claude knows how to write to AFFiNE docs.
 */

import { nanoid } from 'nanoid';

import { ClaudeCodeTransport } from '../cli-bridge/transports/claude-code';
import type { TransportStartOptions } from '../cli-bridge/transports/types';
import { logger } from '../logger';
import type { SchedulerTask } from './types';

// ── Prompt envelope ───────────────────────────────────────────────────────────

function buildEnvelope(task: SchedulerTask, now: Date): string {
  const dateStr = now.toLocaleString('en-US', {
    timeZone: task.timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  let envelope = `You are executing a scheduled task in AFFiNE.

Task name: ${task.name}
Date/time: ${dateStr} (${task.timezone})

Instructions:
${task.prompt}

`;

  if (task.destinationDocId) {
    envelope +=
      `Output requirements:\n` +
      `1. First read the destination document: GET /docs/${task.destinationDocId}\n` +
      `2. Append a new section with today's date as the heading and your results below it.\n` +
      `3. Apply the updated content: POST /docs/${task.destinationDocId}/apply\n\n`;
  } else {
    envelope +=
      `Output requirements:\n` +
      `Create a new document with your results: POST /docs\n` +
      `Use the task name and today's date as the title.\n\n`;
  }

  envelope +=
    `After completing the task and writing the output, reply with a brief ` +
    `1–2 sentence summary of what you accomplished.`;

  return envelope;
}

// ── Runner ────────────────────────────────────────────────────────────────────

export interface RunOptions {
  localServerPort?: number;
  model?: string;
}

export interface RunResult {
  success: boolean;
  summary: string;
  errorMessage?: string;
}

export class ScheduledTaskRunner {
  private readonly id = nanoid(6);

  async run(
    task: SchedulerTask,
    opts: RunOptions,
    onProgress?: (summary: string) => void,
    signal?: AbortSignal
  ): Promise<RunResult> {
    const transport = new ClaudeCodeTransport();
    const envelope = buildEnvelope(task, new Date());

    const transportOpts: TransportStartOptions = {
      // Fresh session — intentionally no sessionId
      sessionId: undefined,
      localServerPort: opts.localServerPort,
      // No hookPort — unattended runs skip the permission prompt server
      hookPort: undefined,
      model: opts.model ?? 'claude-sonnet-4-6',
      maxTurns: 30,
    };

    logger.info(`[scheduler-runner:${this.id}] starting`, {
      task: task.name,
      model: transportOpts.model,
    });

    let accumulated = '';
    let sawCompletion = false;

    try {
      for await (const event of transport.prompt(
        envelope,
        transportOpts,
        signal
      )) {
        if (signal?.aborted) break;

        if (event.type === 'text_chunk') {
          accumulated += event.text;
          // Provide rolling progress as the last 200 chars of accumulated text
          onProgress?.(accumulated.slice(-200).trim());
        }

        if (event.type === 'task_complete') {
          sawCompletion = true;
          if (event.text) accumulated = event.text;
          break;
        }

        if (event.type === 'error') {
          logger.warn(`[scheduler-runner:${this.id}] CLI error`, event.message);
          return { success: false, summary: '', errorMessage: event.message };
        }
      }

      if (signal?.aborted) {
        return { success: false, summary: '', errorMessage: 'Aborted' };
      }

      // Extract a short summary from the last paragraph of the reply
      const trimmed = accumulated.trim();
      const paras = trimmed.split(/\n{2,}/);
      const summary = (paras[paras.length - 1] ?? trimmed).slice(0, 300);

      logger.info(`[scheduler-runner:${this.id}] done`, {
        task: task.name,
        completed: sawCompletion,
        summaryLength: summary.length,
      });

      return { success: sawCompletion, summary: summary || 'Task completed.' };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[scheduler-runner:${this.id}] exception`, err);
      return { success: false, summary: '', errorMessage: msg };
    } finally {
      transport.stop();
    }
  }
}
