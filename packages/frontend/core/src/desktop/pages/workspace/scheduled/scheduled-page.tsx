import {
  type CreateTaskInput,
  type FrequencyType,
  type ScheduledRun,
  type ScheduledTask,
  ScheduledTaskService,
} from '@affine/core/modules/scheduled-task';
import { CloseIcon, DateTimeIcon, PlusIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useState } from 'react';

import * as styles from './scheduled-page.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const FREQUENCY_LABELS: Record<FrequencyType, string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'Custom',
};

const FREQUENCY_OPTIONS: FrequencyType[] = [
  'daily',
  'weekdays',
  'weekly',
  'monthly',
  'custom',
];

const STATUS_COLORS: Record<string, string> = {
  active: '#34A853',
  paused: '#9AA0A6',
  'needs-setup': '#FBBC04',
  failed: '#EA4335',
};

const RUN_STATUS_COLORS: Record<string, string> = {
  completed: '#34A853',
  running: '#4285F4',
  failed: '#EA4335',
  pending: '#9AA0A6',
  missed: '#FBBC04',
  interrupted: '#FF6D00',
  needs_attention: '#EA4335',
};

const RUN_STATUS_LABELS: Record<string, string> = {
  completed: 'Completed',
  running: 'Running',
  failed: 'Failed',
  pending: 'Pending',
  missed: 'Missed',
  interrupted: 'Interrupted',
  needs_attention: 'Needs attention',
};

/** Returns a human-readable "Xm late" / "Xh late" string for catch-up runs. */
function formatLate(run: ScheduledRun): string | null {
  if (!run.catchup || !run.overdueByMs) return null;
  const ms = run.overdueByMs;
  if (ms < 5 * 60_000) return null;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m late`;
  return `${(ms / 3_600_000).toFixed(1)}h late`;
}

function formatSchedule(task: ScheduledTask): string {
  const freq = FREQUENCY_LABELS[task.frequencyType];
  if (!task.localTime) return freq;
  return `${freq} · ${task.localTime}`;
}

function formatDate(iso?: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

// ── Run status (per-task runtime state from IPC events) ───────────────────────

interface LiveRunState {
  status: 'running' | 'completed' | 'failed';
  summary?: string;
  lastRunAt?: string;
}

// ── Create / Edit form ────────────────────────────────────────────────────────

interface FormModalProps {
  task?: ScheduledTask;
  onClose: () => void;
  onSave: (input: CreateTaskInput) => void;
}

function FormModal({ task, onClose, onSave }: FormModalProps) {
  const [name, setName] = useState(task?.name ?? '');
  const [prompt, setPrompt] = useState(task?.prompt ?? '');
  const [frequencyType, setFrequencyType] = useState<FrequencyType>(
    task?.frequencyType ?? 'daily'
  );
  const [localTime, setLocalTime] = useState(task?.localTime ?? '09:00');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const canSave = name.trim().length > 0 && prompt.trim().length > 0;

  const handleSave = useCallback(() => {
    if (!canSave) return;
    onSave({
      name: name.trim(),
      prompt: prompt.trim(),
      frequencyType,
      localTime,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
  }, [canSave, frequencyType, localTime, name, onSave, prompt]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitleBlock}>
            <span className={styles.panelTitle}>
              {task ? 'Edit task' : 'New scheduled task'}
            </span>
          </div>
          <button className={styles.panelClose} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className={styles.panelBody}>
          <div className={styles.formField}>
            <label className={styles.formLabel}>Task name</label>
            <input
              className={styles.formInput}
              placeholder="e.g. Weekly AI launches digest"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className={styles.formField}>
            <label className={styles.formLabel}>What should AI do?</label>
            <textarea
              className={styles.formTextarea}
              placeholder="Describe the task in plain language…"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={4}
            />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Frequency</label>
              <select
                className={styles.formSelect}
                value={frequencyType}
                onChange={e =>
                  setFrequencyType(e.target.value as FrequencyType)
                }
              >
                {FREQUENCY_OPTIONS.map(f => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>
            <div className={styles.formField}>
              <label className={styles.formLabel}>Time</label>
              <input
                className={styles.formInput}
                type="time"
                value={localTime}
                onChange={e => setLocalTime(e.target.value)}
              />
            </div>
          </div>

          <button
            className={styles.advancedToggle}
            onClick={() => setShowAdvanced(v => !v)}
          >
            <span>{showAdvanced ? '▾' : '▸'}</span>
            <span>Advanced options</span>
          </button>

          {showAdvanced && (
            <div className={styles.formField}>
              <label className={styles.formLabel}>Timezone</label>
              <input
                className={styles.formInput}
                value={Intl.DateTimeFormat().resolvedOptions().timeZone}
                readOnly
                style={{ opacity: 0.6 }}
              />
            </div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button className={styles.btnSecondary} onClick={onClose}>
            Cancel
          </button>
          <button
            className={styles.btnPrimary}
            disabled={!canSave}
            onClick={handleSave}
          >
            {task ? 'Save changes' : 'Create task'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Task detail panel ─────────────────────────────────────────────────────────

interface DetailPanelProps {
  task: ScheduledTask;
  liveRun?: LiveRunState;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePause: () => void;
  onRunNow: () => void;
}

function DetailPanel({
  task,
  liveRun,
  onClose,
  onEdit,
  onDelete,
  onTogglePause,
  onRunNow,
}: DetailPanelProps) {
  const scheduledTaskService = useService(ScheduledTaskService);
  const runs = useLiveData(
    scheduledTaskService.runsForTask$(task.id)
  ) as ScheduledRun[];
  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.panel} onClick={e => e.stopPropagation()}>
        <div className={styles.panelHeader}>
          <div className={styles.panelTitleBlock}>
            <h2 className={styles.panelTitle}>{task.name}</h2>
            <div className={styles.panelMeta}>
              <span className={styles.statusChip}>
                <span
                  className={styles.statusDot}
                  style={{
                    background: STATUS_COLORS[task.status] ?? '#9AA0A6',
                  }}
                />
                {task.status.replace('-', ' ')}
              </span>
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--affine-text-secondary-color)',
                }}
              >
                {formatSchedule(task)}
              </span>
            </div>
          </div>
          <button className={styles.panelClose} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className={styles.panelBody}>
          <div className={styles.panelActions}>
            <button className={styles.actionBtn} onClick={onEdit}>
              Edit
            </button>
            <button className={styles.actionBtn} onClick={onTogglePause}>
              {task.status === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button className={styles.actionBtn} onClick={onRunNow}>
              Run now
            </button>
            <button className={styles.actionBtnDanger} onClick={onDelete}>
              Delete
            </button>
          </div>

          <div>
            <div className={styles.sectionLabel}>Instruction</div>
            <div className={styles.sectionText}>{task.prompt}</div>
          </div>

          <div>
            <div className={styles.sectionLabel}>Output</div>
            <div className={styles.sectionText} style={{ opacity: 0.7 }}>
              {task.destinationDocId
                ? '📄 Destination document linked'
                : 'A destination document will be created on first run.'}
            </div>
          </div>

          {/* Live run status (from IPC events) */}
          {liveRun && (
            <div>
              <div className={styles.sectionLabel}>Current run</div>
              <div className={styles.runRow}>
                <span
                  className={styles.runDot}
                  style={{
                    background: RUN_STATUS_COLORS[liveRun.status] ?? '#9AA0A6',
                    animation:
                      liveRun.status === 'running'
                        ? 'pulse 1.2s infinite'
                        : 'none',
                  }}
                />
                <span className={styles.runDate}>
                  {formatDate(liveRun.lastRunAt)}
                </span>
                {liveRun.summary && (
                  <span className={styles.runSummary}>{liveRun.summary}</span>
                )}
                <span className={styles.runStatusText}>
                  {RUN_STATUS_LABELS[liveRun.status] ?? liveRun.status}
                </span>
              </div>
            </div>
          )}

          <div>
            <div className={styles.sectionLabel}>Recent runs</div>
            {runs.length === 0 ? (
              <p className={styles.noRuns}>No runs yet.</p>
            ) : (
              <div className={styles.runsList}>
                {runs.slice(0, 8).map((run: ScheduledRun) => {
                  const lateLabel = formatLate(run);
                  return (
                    <div key={run.id} className={styles.runRow}>
                      <span
                        className={styles.runDot}
                        style={{
                          background:
                            RUN_STATUS_COLORS[run.status] ?? '#9AA0A6',
                        }}
                      />
                      <span className={styles.runDate}>
                        {formatDate(run.scheduledFor ?? run.startedAt)}
                      </span>
                      {lateLabel && (
                        <span
                          className={styles.runLateTag}
                          title={`Scheduled for ${formatDate(run.scheduledFor)}, ran at ${formatDate(run.startedAt)}`}
                        >
                          {lateLabel}
                        </span>
                      )}
                      {run.summary && (
                        <span className={styles.runSummary}>{run.summary}</span>
                      )}
                      <span className={styles.runStatusText}>
                        {RUN_STATUS_LABELS[run.status] ?? run.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Task card ─────────────────────────────────────────────────────────────────

interface TaskCardProps {
  task: ScheduledTask;
  liveRun?: LiveRunState;
  onClick: () => void;
}

function TaskCard({ task, liveRun, onClick }: TaskCardProps) {
  const displayColor = liveRun
    ? (RUN_STATUS_COLORS[liveRun.status] ?? '#9AA0A6')
    : (STATUS_COLORS[task.status] ?? '#9AA0A6');

  return (
    <div className={styles.card} onClick={onClick} role="button" tabIndex={0}>
      <div className={styles.cardTop}>
        <span className={styles.cardName}>{task.name}</span>
        <span className={styles.statusChip}>
          <span
            className={styles.statusDot}
            style={{ background: displayColor }}
          />
          {liveRun ? liveRun.status : task.status.replace('-', ' ')}
        </span>
      </div>

      <div className={styles.cardSchedule}>{formatSchedule(task)}</div>

      <div className={styles.cardPrompt}>{task.prompt}</div>

      <div className={styles.cardFooter}>
        <span className={styles.cardMeta}>
          {task.createdAt ? `Created ${formatDate(task.createdAt)}` : ''}
        </span>
        <span className={styles.cardMeta}>
          {liveRun?.lastRunAt
            ? `Last run ${formatDate(liveRun.lastRunAt)}`
            : 'No runs yet'}
        </span>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon}>
        <DateTimeIcon />
      </div>
      <h2 className={styles.emptyTitle}>No scheduled tasks yet</h2>
      <p className={styles.emptyDescription}>
        Write what you want AI to do, pick when to run it, and AFFiNE writes the
        results directly into a document.
      </p>
      <button className={styles.emptyCta} onClick={onCreateClick}>
        <PlusIcon />
        Create a task
      </button>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────

type ModalState =
  | { type: 'none' }
  | { type: 'create' }
  | { type: 'detail'; task: ScheduledTask }
  | { type: 'edit'; task: ScheduledTask };

export function ScheduledPage() {
  const scheduledTaskService = useService(ScheduledTaskService);
  const tasks = useLiveData(scheduledTaskService.tasks$);

  const [modal, setModal] = useState<ModalState>({ type: 'none' });
  // Per-task live run status received from main-process IPC events
  const [liveRuns, setLiveRuns] = useState<Record<string, LiveRunState>>({});

  const openCreate = useCallback(() => setModal({ type: 'create' }), []);
  const closeModal = useCallback(() => setModal({ type: 'none' }), []);

  // ── Sync tasks to main-process scheduler ───────────────────────────────────
  useEffect(() => {
    scheduledTaskService.syncAllToScheduler(tasks as ScheduledTask[]);
  }, [scheduledTaskService, tasks]);

  // ── Subscribe to run events from main process ──────────────────────────────
  useEffect(() => {
    const cleanup = scheduledTaskService.setupRunEventListener();
    return cleanup;
  }, [scheduledTaskService]);

  // ── Listen to raw IPC events for live card status ──────────────────────────
  useEffect(() => {
    const schedulerEvents = (window as any).__events?.scheduledTasks as
      | { onRunEvent?: (cb: (p: unknown) => void) => () => void }
      | undefined;
    if (!schedulerEvents?.onRunEvent) return;

    const cleanup = schedulerEvents.onRunEvent((raw: unknown) => {
      const payload = raw as {
        event: string;
        run: {
          status: string;
          summary?: string;
          startedAt?: string;
          finishedAt?: string;
        };
        taskId: string;
      };
      const { event, run, taskId } = payload;
      if (!taskId) return;

      setLiveRuns(prev => ({
        ...prev,
        [taskId]: {
          status: run.status as LiveRunState['status'],
          summary: run.summary,
          lastRunAt:
            event === 'finished'
              ? (run.finishedAt ?? run.startedAt)
              : run.startedAt,
        },
      }));
    });

    return cleanup;
  }, []);

  // ── Modal mutations ────────────────────────────────────────────────────────
  const handleSave = useCallback(
    (input: CreateTaskInput) => {
      if (modal.type === 'edit') {
        scheduledTaskService.updateTask(modal.task.id, input);
      } else {
        scheduledTaskService.createTask(input);
      }
      closeModal();
    },
    [closeModal, modal, scheduledTaskService]
  );

  const handleDelete = useCallback(
    (taskId: string) => {
      scheduledTaskService.deleteTask(taskId);
      closeModal();
    },
    [closeModal, scheduledTaskService]
  );

  const handleTogglePause = useCallback(
    (task: ScheduledTask) => {
      if (task.status === 'paused') {
        scheduledTaskService.activateTask(task.id);
      } else {
        scheduledTaskService.pauseTask(task.id);
      }
      closeModal();
    },
    [closeModal, scheduledTaskService]
  );

  const handleRunNow = useCallback((taskId: string) => {
    const schedulerApis = (window as any).__apis?.scheduledTasks as
      | { runNow?: (args: { taskId: string }) => Promise<unknown> }
      | undefined;
    schedulerApis?.runNow?.({ taskId }).catch(() => {});
  }, []);

  // Keep detail panel in sync if task data updates
  useEffect(() => {
    if (modal.type === 'detail' || modal.type === 'edit') {
      const updated = (tasks as ScheduledTask[]).find(
        (t: ScheduledTask) => t.id === modal.task.id
      );
      if (!updated) closeModal();
    }
  }, [closeModal, modal, tasks]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.pageTitle}>Scheduled</span>
        <button className={styles.newTaskButton} onClick={openCreate}>
          <PlusIcon />
          New task
        </button>
      </div>

      <div className={styles.scrollArea}>
        {(tasks as ScheduledTask[]).length === 0 ? (
          <EmptyState onCreateClick={openCreate} />
        ) : (
          <div className={styles.grid}>
            {(tasks as ScheduledTask[]).map((task: ScheduledTask) => (
              <TaskCard
                key={task.id}
                task={task}
                liveRun={liveRuns[task.id]}
                onClick={() => setModal({ type: 'detail', task })}
              />
            ))}
          </div>
        )}
      </div>

      {(modal.type === 'create' || modal.type === 'edit') && (
        <FormModal
          task={modal.type === 'edit' ? modal.task : undefined}
          onClose={closeModal}
          onSave={handleSave}
        />
      )}

      {modal.type === 'detail' && (
        <DetailPanel
          task={modal.task}
          liveRun={liveRuns[modal.task.id]}
          onClose={closeModal}
          onEdit={() => setModal({ type: 'edit', task: modal.task })}
          onDelete={() => handleDelete(modal.task.id)}
          onTogglePause={() => handleTogglePause(modal.task)}
          onRunNow={() => handleRunNow(modal.task.id)}
        />
      )}
    </div>
  );
}
