/**
 * IPC event registrations for the scheduledTasks namespace.
 *
 * Renderer subscribes with:
 *   events.scheduledTasks.onRunEvent(callback)
 *
 * The actual dispatch is done through the RxJS subject in service.ts,
 * which the events.ts in main/events.ts subscribes to via these registrars.
 */

import type { MainEventRegister } from '../type';
import { scheduledTaskSubjects } from './service';
import type { RunEventPayload } from './types';

const onRunEvent: MainEventRegister = (
  fn: (payload: RunEventPayload) => void
) => {
  const sub = scheduledTaskSubjects.runEvent$.subscribe(fn);
  return () => sub.unsubscribe();
};

export const scheduledTaskEvents: Record<string, MainEventRegister> = {
  onRunEvent,
};
