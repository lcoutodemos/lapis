import type { Framework } from '@toeverything/infra';

import { WorkspaceDBService } from '../db';
import { WorkspaceScope } from '../workspace';
import { ScheduledTaskService } from './services/scheduled-task';
import { ScheduledTaskStore } from './stores/scheduled-task';

export { ScheduledTaskService } from './services/scheduled-task';
export type {
  CreateTaskInput,
  FrequencyType,
  RunStatus,
  ScheduledRun,
  ScheduledTask,
  TaskStatus,
} from './types';

export function configureScheduledTaskModule(framework: Framework) {
  framework
    .scope(WorkspaceScope)
    .service(ScheduledTaskService, [ScheduledTaskStore])
    .store(ScheduledTaskStore, [WorkspaceDBService]);
}
