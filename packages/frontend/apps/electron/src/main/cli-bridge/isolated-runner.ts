/**
 * Shared isolated-session runner — the single low-level primitive for
 * one-shot Claude prompts that must not resume a prior session.
 *
 * Both the control plane (runIsolated) and the scheduled-task runner
 * import from here so there is exactly one execution path for isolated runs.
 */

import { ClaudeCodeTransport } from './transports/claude-code';
import type { CLIEvent, TransportStartOptions } from './transports/types';

export interface IsolatedRunResult {
  success: boolean;
  summary: string;
  errorMessage?: string;
  /** True when a permission hook blocked an unsafe tool in unattended mode */
  needsAttention?: boolean;
}

export async function runIsolatedPrompt(
  prompt: string,
  opts: TransportStartOptions & { onEvent?: (e: CLIEvent) => void },
  signal?: AbortSignal
): Promise<IsolatedRunResult> {
  const transport = new ClaudeCodeTransport();
  let accumulated = '';
  let sawCompletion = false;
  let errorMessage: string | undefined;

  try {
    for await (const event of transport.prompt(
      prompt,
      // Strip the custom onEvent field before passing to transport
      { ...opts, onEvent: undefined } as TransportStartOptions,
      signal
    )) {
      if (signal?.aborted) break;
      opts.onEvent?.(event);

      if (event.type === 'text_chunk') accumulated += event.text;
      if (event.type === 'task_complete') {
        sawCompletion = true;
        if (event.text) accumulated = event.text;
        break;
      }
      if (event.type === 'error') {
        errorMessage = event.message;
        break;
      }
    }

    const paras = accumulated.trim().split(/\n{2,}/);
    const summary =
      (paras[paras.length - 1] ?? '').slice(0, 300) || 'Task completed.';
    return {
      success: sawCompletion && !errorMessage,
      summary,
      errorMessage,
    };
  } finally {
    transport.stop();
  }
}
