import {
  type CreateTaskInput,
  type FrequencyType,
  type ScheduledRun,
  type ScheduledTask,
  ScheduledTaskService,
} from '@affine/core/modules/scheduled-task';
import { CloseIcon, DateTimeIcon, PlusIcon } from '@blocksuite/icons/rc';
import { useLiveData, useService } from '@toeverything/infra';
import { useCallback, useEffect, useMemo, useState } from 'react';

import * as styles from './scheduled-page.css';

// ── Helpers ────────────────────────────────────────────────────────────────────

const FREQUENCY_LABELS: Record<FrequencyType, string> = {
  daily: 'Daily',
  weekdays: 'Weekdays',
  weekly: 'Weekly',
  monthly: 'Monthly',
  custom: 'Custom',
};

function formatNextRun(task: ScheduledTask): string {
  if (task.status === 'paused') return 'Paused';
  if (task.status === 'needs-setup') return 'Setup needed';
  if (!task.localTime) return FREQUENCY_LABELS[task.frequencyType];
  return `${FREQUENCY_LABELS[task.frequencyType]} at ${task.localTime}`;
}

function formatRunDate(iso?: string): string {
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
};

// ── Create / Edit modal ────────────────────────────────────────────────────────

interface TaskModalProps {
  task?: ScheduledTask;
  onClose: () => void;
  onSave: (input: CreateTaskInput) => void;
}

const FREQUENCY_OPTIONS: FrequencyType[] = [
  'daily',
  'weekdays',
  'weekly',
  'monthly',
  'custom',
];

function TaskModal({ task, onClose, onSave }: TaskModalProps) {
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
  }, [canSave, name, prompt, frequencyType, localTime, onSave]);

  return (
    <div className={styles.modalOverlay} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <span className={styles.modalTitle}>
            {task ? 'Edit task' : 'New scheduled task'}
          </span>
          <button className={styles.modalClose} onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className={styles.modalBody}>
          {/* Name */}
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

          {/* Prompt */}
          <div className={styles.formField}>
            <label className={styles.formLabel}>What should AI do?</label>
            <textarea
              className={styles.formTextarea}
              placeholder="e.g. Search online for new trending AI launches and papers from the past week. Write a concise summary with key takeaways."
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              rows={4}
            />
          </div>

          {/* Frequency + Time */}
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

          {/* Advanced toggle */}
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

// ── Task detail ────────────────────────────────────────────────────────────────

interface TaskDetailProps {
  task: ScheduledTask;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePause: () => void;
}

function TaskDetail({
  task,
  onEdit,
  onDelete,
  onTogglePause,
}: TaskDetailProps) {
  const scheduledTaskService = useService(ScheduledTaskService);
  const runs = useLiveData(scheduledTaskService.runsForTask$(task.id));

  const statusColor = STATUS_COLORS[task.status] ?? '#9AA0A6';

  return (
    <div className={styles.detail}>
      {/* Header */}
      <div className={styles.detailHeader}>
        <div className={styles.detailActions}>
          <button className={styles.actionButton} onClick={onEdit}>
            Edit
          </button>
          <button className={styles.actionButton} onClick={onTogglePause}>
            {task.status === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button className={styles.actionButtonDanger} onClick={onDelete}>
            Delete
          </button>
        </div>
        <h1 className={styles.detailTitle}>{task.name}</h1>
        <div className={styles.detailStatusRow}>
          <span className={styles.detailStatusChip}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: statusColor,
                display: 'inline-block',
              }}
            />
            {task.status.replace('-', ' ')}
          </span>
          <span className={styles.detailScheduleLine}>
            {formatNextRun(task)}
          </span>
          {task.timezone && (
            <span className={styles.detailScheduleLine}>· {task.timezone}</span>
          )}
        </div>
      </div>

      <div className={styles.divider} />

      {/* Prompt */}
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Instruction</span>
        <div className={styles.sectionContent}>{task.prompt}</div>
      </div>

      {/* Output */}
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Output</span>
        {task.destinationDocId ? (
          <div className={styles.sectionContent}>
            <span className={styles.destinationLink}>
              📄 Destination document
            </span>
          </div>
        ) : (
          <div className={styles.sectionContent} style={{ opacity: 0.6 }}>
            A destination document will be created on first run.
          </div>
        )}
      </div>

      {/* Runs */}
      <div className={styles.section}>
        <span className={styles.sectionLabel}>Recent runs</span>
        {runs.length === 0 ? (
          <p className={styles.noRuns}>No runs yet.</p>
        ) : (
          <div className={styles.runsList}>
            {(runs as ScheduledRun[]).slice(0, 10).map((run: ScheduledRun) => (
              <div key={run.id} className={styles.runItem}>
                <span
                  className={styles.runStatusDot}
                  style={{
                    background: RUN_STATUS_COLORS[run.status] ?? '#9AA0A6',
                  }}
                />
                <span className={styles.runItemDate}>
                  {formatRunDate(run.scheduledFor ?? run.startedAt)}
                </span>
                {run.summary && (
                  <span className={styles.runItemSummary}>{run.summary}</span>
                )}
                <span className={styles.runItemStatus}>{run.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────────

const EXAMPLES = [
  {
    icon: '🔭',
    text: 'Every Monday, search online for new trending AI launches and summarise the week.',
  },
  {
    icon: '🎨',
    text: 'Every morning, find fresh design inspiration for ambient computing products.',
  },
  {
    icon: '📰',
    text: "Every Friday, summarise the week's top news in my industry.",
  },
];

function EmptyState({ onCreateClick }: { onCreateClick: () => void }) {
  return (
    <div className={styles.emptyState}>
      <div className={styles.emptyIcon}>
        <DateTimeIcon />
      </div>
      <h2 className={styles.emptyTitle}>Schedule AI tasks</h2>
      <p className={styles.emptyDescription}>
        Write what you want AI to do, pick when to run it, and AFFiNE takes care
        of the rest — writing results directly into a document.
      </p>
      <div className={styles.emptyExamples}>
        {EXAMPLES.map((ex, i) => (
          <div key={i} className={styles.emptyExample}>
            <span className={styles.emptyExampleIcon}>{ex.icon}</span>
            <span className={styles.emptyExampleText}>{ex.text}</span>
          </div>
        ))}
      </div>
      <button className={styles.emptyPrimaryCta} onClick={onCreateClick}>
        <PlusIcon />
        Create your first task
      </button>
    </div>
  );
}

// ── Rail item ──────────────────────────────────────────────────────────────────

function RailItem({
  task,
  active,
  onClick,
}: {
  task: ScheduledTask;
  active: boolean;
  onClick: () => void;
}) {
  const dotClass =
    task.status === 'active'
      ? styles.statusDotActive
      : task.status === 'paused'
        ? styles.statusDotPaused
        : task.status === 'failed'
          ? styles.statusDotFailed
          : styles.statusDotSetup;

  return (
    <div
      className={styles.railItem}
      data-active={active}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick()}
    >
      <span className={styles.railItemName}>{task.name}</span>
      <div className={styles.railItemMeta}>
        <span className={styles.railItemStatus}>
          <span className={dotClass} />
          <span style={{ color: STATUS_COLORS[task.status], fontSize: 11 }}>
            {task.status.replace('-', ' ')}
          </span>
        </span>
        <span className={styles.railItemNextRun}>{formatNextRun(task)}</span>
      </div>
    </div>
  );
}

// ── Root component ─────────────────────────────────────────────────────────────

export function ScheduledPage() {
  const scheduledTaskService = useService(ScheduledTaskService);
  const tasks = useLiveData(scheduledTaskService.tasks$);

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingTask, setEditingTask] = useState<ScheduledTask | undefined>();

  const selectedTask = useMemo(
    () =>
      (tasks as ScheduledTask[]).find(
        (t: ScheduledTask) => t.id === selectedTaskId
      ) ?? null,
    [tasks, selectedTaskId]
  );

  const openCreate = useCallback(() => {
    setEditingTask(undefined);
    setShowModal(true);
  }, []);

  const openEdit = useCallback((task: ScheduledTask) => {
    setEditingTask(task);
    setShowModal(true);
  }, []);

  const handleSave = useCallback(
    (input: CreateTaskInput) => {
      if (editingTask) {
        scheduledTaskService.updateTask(editingTask.id, input);
      } else {
        const newTask = scheduledTaskService.createTask(input);
        setSelectedTaskId(newTask.id);
      }
      setShowModal(false);
    },
    [editingTask, scheduledTaskService]
  );

  const handleDelete = useCallback(
    (taskId: string) => {
      scheduledTaskService.deleteTask(taskId);
      if (selectedTaskId === taskId) setSelectedTaskId(null);
    },
    [scheduledTaskService, selectedTaskId]
  );

  const handleTogglePause = useCallback(
    (task: ScheduledTask) => {
      if (task.status === 'paused') {
        scheduledTaskService.activateTask(task.id);
      } else {
        scheduledTaskService.pauseTask(task.id);
      }
    },
    [scheduledTaskService]
  );

  // auto-select first task when none is selected
  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) {
      setSelectedTaskId((tasks as ScheduledTask[])[0].id);
    }
  }, [selectedTaskId, tasks]);

  return (
    <div className={styles.root}>
      {/* Left rail */}
      <div className={styles.rail}>
        <div className={styles.railHeader}>
          <span className={styles.railTitle}>Scheduled</span>
          <button
            className={styles.createButton}
            onClick={openCreate}
            title="New scheduled task"
          >
            <PlusIcon />
          </button>
        </div>
        <div className={styles.railList}>
          {tasks.length === 0 ? (
            <p className={styles.railEmpty}>
              No tasks yet.
              <br />
              Create one to get started.
            </p>
          ) : (
            (tasks as ScheduledTask[]).map((task: ScheduledTask) => (
              <RailItem
                key={task.id}
                task={task}
                active={selectedTaskId === task.id}
                onClick={() => setSelectedTaskId(task.id)}
              />
            ))
          )}
        </div>
      </div>

      {/* Main panel */}
      <div className={styles.main}>
        {!selectedTask ? (
          <EmptyState onCreateClick={openCreate} />
        ) : (
          <TaskDetail
            task={selectedTask}
            onEdit={() => openEdit(selectedTask)}
            onDelete={() => handleDelete(selectedTask.id)}
            onTogglePause={() => handleTogglePause(selectedTask)}
          />
        )}
      </div>

      {/* Create / Edit modal */}
      {showModal && (
        <TaskModal
          task={editingTask}
          onClose={() => setShowModal(false)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
