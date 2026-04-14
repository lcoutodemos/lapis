/**
 * ScheduledTaskRunner — executes one scheduled task via the shared isolated runner.
 *
 * Routes through runIsolatedPrompt (same primitive the control plane uses),
 * ensuring a single execution path for both interactive and scheduled prompts.
 * Fresh session per run (no --resume), unattended permission handler.
 *
 * After a successful run the runner attempts:
 *   1. DOC_ID extraction from the summary text
 *   2. Write verification against the local REST API
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
      `1. Read the destination document: GET /docs/${task.destinationDocId}\n` +
      `2. Append a new section with today's date as the heading and your results below it.\n` +
      `3. Apply the updated content: POST /docs/${task.destinationDocId}/apply\n\n`;
  } else {
    envelope +=
      `Output requirements:\n` +
      `Create a new document with your results using POST /docs.\n` +
      `Use the task name and today's date as the title.\n\n`;
  }

  envelope +=
    `After completing the task and writing the output, reply with a brief 1–2 sentence ` +
    `summary of what you accomplished. If you created or updated a document, include its ` +
    `ID on a separate line in the format: DOC_ID: <document-id>`;

  return envelope;
}

// ── Write verification ────────────────────────────────────────────────────────

async function verifyDocUpdated(
  port: number,
  docId: string,
  since: number
): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/docs/${docId}`);
    if (!res.ok) return false;
    const data = (await res.json()) as { updatedAt?: string };
    const updatedAt = new Date(data.updatedAt ?? 0).getTime();
    // 10 s tolerance to account for write latency
    return updatedAt > since - 10_000;
  } catch {
    return false;
  }
}

function extractDocId(text: string): string | undefined {
  const match = text.match(/DOC_ID:\s*([a-zA-Z0-9_-]+)/);
  return match?.[1];
}

// ── Runner ────────────────────────────────────────────────────────────────────

export interface RunOptions {
  hookPort?: number;
  localServerPort?: number;
}

export interface RunResult {
  success: boolean;
  summary: string;
  errorMessage?: string;
  outputDocId?: string;
  /** True when a permission hook blocked a tool in unattended mode */
  needsAttention?: boolean;
}

export class ScheduledTaskRunner {
  async run(
    task: SchedulerTask,
    opts: RunOptions,
    onProgress?: (summary: string) => void,
    signal?: AbortSignal
  ): Promise<RunResult> {
    const envelope = buildEnvelope(task, new Date());
    const startedAt = Date.now();

    logger.info('[scheduler-runner] starting', {
      task: task.name,
      model: task.model ?? 'default',
    });

    let needsAttention = false;

    const result = await cliBridge.runScheduled(envelope, {
      signal,
      model: task.model,
      hookPort: opts.hookPort,
      webAccess: task.webAccess,
      onEvent: (event: CLIEvent) => {
        if (event.type === 'text_chunk' && onProgress) {
          onProgress(event.text.slice(-200).trim());
        }
      },
    });

    if (result.needsAttention) {
      needsAttention = true;
    }

    if (!result.success) {
      return { ...result, needsAttention };
    }

    // ── Post-run: extract output doc ID ────────────────────────────────────
    let outputDocId = extractDocId(result.summary);
    if (!outputDocId && task.destinationDocId) {
      outputDocId = task.destinationDocId;
    }

    // ── Write verification ─────────────────────────────────────────────────
    if (task.destinationDocId && opts.localServerPort) {
      const verified = await verifyDocUpdated(
        opts.localServerPort,
        task.destinationDocId,
        startedAt
      );
      if (!verified) {
        logger.warn('[scheduler-runner] write verification failed', {
          task: task.name,
          docId: task.destinationDocId,
        });
        return {
          success: false,
          summary: result.summary,
          errorMessage:
            'Write verification failed: destination document was not updated.',
          outputDocId,
          needsAttention: false,
        };
      }
    }

    return { ...result, outputDocId, needsAttention };
  }
}
