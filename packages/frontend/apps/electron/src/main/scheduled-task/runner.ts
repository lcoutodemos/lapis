/**
 * ScheduledTaskRunner — executes one scheduled task via the shared CLIBridge.
 *
 * Routes through CLIControlPlane.runIsolated() to ensure a single execution
 * path for both interactive and scheduled prompts. Fresh session per run
 * (no --resume), with an unattended permission handler that never blocks.
 */

import { cliBridge } from '../cli-bridge/singleton';
import type { CLIEvent } from '../cli-bridge/transports/types';
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
  hookPort?: number;
}

export interface RunResult {
  success: boolean;
  summary: string;
  errorMessage?: string;
}

export class ScheduledTaskRunner {
  async run(
    task: SchedulerTask,
    opts: RunOptions,
    onProgress?: (summary: string) => void,
    signal?: AbortSignal
  ): Promise<RunResult> {
    const envelope = buildEnvelope(task, new Date());

    logger.info('[scheduler-runner] starting via control plane', {
      task: task.name,
      model: task.model ?? 'default',
    });

    const result = await cliBridge.runScheduled(envelope, {
      signal,
      model: task.model,
      hookPort: opts.hookPort,
      onEvent: (event: CLIEvent) => {
        if (event.type === 'text_chunk' && onProgress) {
          onProgress(event.text.slice(-200).trim());
        }
      },
    });

    return result;
  }
}
