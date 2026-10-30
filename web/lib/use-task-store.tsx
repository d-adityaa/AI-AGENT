"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  clearTasks as clearTasksRecord,
  completeTask as completeTaskRecord,
  createTask,
  deleteTask as deleteTaskRecord,
  reopenTask as reopenTaskRecord,
  updateTask as updateTaskRecord,
} from "@/lib/tasks";
import {
  loadHistory,
  loadSettings,
  loadTasks,
  saveHistory,
  saveSettings,
  saveTasks,
} from "@/lib/storage";
import type {
  AppSettings,
  HistoryAction,
  HistoryEntry,
  HistorySource,
  Task,
  TaskDraft,
} from "@/lib/types";

const DEFAULT_MODEL = "gemini-3.8-flash";
const MAX_HISTORY_ENTRIES = 300;

type HistoryMeta = {
  action: HistoryAction;
  taskId: number | null;
  title: string;
  subject: string | null;
  source: HistorySource;
  tool: string | null;
  detail: string | null;
};

interface TaskStoreValue {
  hydrated: boolean;
  storageError: string | null;
  tasks: Task[];
  history: HistoryEntry[];
  settings: AppSettings;
  addTask: (draft: TaskDraft, source?: HistorySource, tool?: string | null) => Task;
  addTasks: (drafts: TaskDraft[], source?: HistorySource) => Task[];
  updateTaskById: (
    taskId: number,
    draft: TaskDraft,
    source?: HistorySource,
  ) => Task;
  completeTaskById: (taskId: number, source?: HistorySource) => Task;
  reopenTaskById: (taskId: number) => Task;
  deleteTaskById: (
    taskId: number,
    confirmed: boolean,
    source?: HistorySource,
  ) => Task;
  clearAllTasks: (confirmed: boolean) => void;
  clearHistory: (confirmed: boolean) => void;
  setModel: (model: string) => void;
}

const TaskStoreContext = createContext<TaskStoreValue | null>(null);
const emptySubscribe = () => () => {};

function newId(): string {
  const cryptoObject = globalThis.crypto as Crypto | undefined;
  if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
    return cryptoObject.randomUUID();
  }
  return `entry-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function makeEntry(meta: HistoryMeta, timestamp: string): HistoryEntry {
  return { id: newId(), timestamp, ...meta };
}

export function TaskProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<Task[]>(() => loadTasks());
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [settings, setSettings] = useState<AppSettings>(() =>
    loadSettings(DEFAULT_MODEL),
  );
  const [storageError, setStorageError] = useState<string | null>(null);
  const hydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const tasksRef = useRef<Task[]>(tasks);
  const historyRef = useRef<HistoryEntry[]>(history);

  const commitTasks = useCallback((next: Task[]) => {
    tasksRef.current = next;
    setTasks(next);
    if (!saveTasks(next)) {
      setStorageError(
        "Your browser could not save tasks to localStorage. Check available storage or private-mode settings.",
      );
    } else {
      setStorageError(null);
    }
  }, []);

  const appendHistory = useCallback(
    (entries: HistoryEntry[]) => {
      if (entries.length === 0) return;
      const next = [...entries, ...historyRef.current].slice(0, MAX_HISTORY_ENTRIES);
      historyRef.current = next;
      setHistory(next);
      if (!saveHistory(next)) {
        setStorageError("Your browser could not save task history to localStorage.");
      }
    },
    [],
  );

  const addTask = useCallback(
    (draft: TaskDraft, source: HistorySource = "manual", tool: string | null = "add_task") => {
      const now = new Date();
      const result = createTask(tasksRef.current, draft, now);
      commitTasks(result.tasks);
      appendHistory([
        makeEntry(
          {
            action: "created",
            taskId: result.task.id,
            title: result.task.title,
            subject: result.task.subject,
            source,
            tool,
            detail: `Priority: ${result.task.priority}${
              result.task.dueDate ? `; due ${result.task.dueDate}` : ""
            }`,
          },
          now.toISOString(),
        ),
      ]);
      return result.task;
    },
    [appendHistory, commitTasks],
  );

  const addTasks = useCallback(
    (drafts: TaskDraft[], source: HistorySource = "agent") => {
      const now = new Date();
      let next = tasksRef.current;
      const created: Task[] = [];
      const entries: HistoryEntry[] = [];
      for (const draft of drafts) {
        const result = createTask(next, draft, now);
        next = result.tasks;
        created.push(result.task);
        entries.push(
          makeEntry(
            {
              action: "created",
              taskId: result.task.id,
              title: result.task.title,
              subject: result.task.subject,
              source,
              tool: "add_task",
              detail: `Approved from an agent proposal. Priority: ${result.task.priority}`,
            },
            now.toISOString(),
          ),
        );
      }
      commitTasks(next);
      appendHistory(entries.reverse());
      return created;
    },
    [appendHistory, commitTasks],
  );

  const updateTaskById = useCallback(
    (taskId: number, draft: TaskDraft, source: HistorySource = "manual") => {
      const now = new Date();
      const result = updateTaskRecord(tasksRef.current, taskId, draft);
      commitTasks(result.tasks);
      appendHistory([
        makeEntry(
          {
            action: "updated",
            taskId: result.task.id,
            title: result.task.title,
            subject: result.task.subject,
            source,
            tool: null,
            detail: "Task details were edited.",
          },
          now.toISOString(),
        ),
      ]);
      return result.task;
    },
    [appendHistory, commitTasks],
  );

  const completeTaskById = useCallback(
    (taskId: number, source: HistorySource = "manual") => {
      const now = new Date();
      const result = completeTaskRecord(tasksRef.current, taskId, now);
      if (result.changed) {
        commitTasks(result.tasks);
        appendHistory([
          makeEntry(
            {
              action: "completed",
              taskId: result.task.id,
              title: result.task.title,
              subject: result.task.subject,
              source,
              tool: "mark_task_completed",
              detail: "Task marked completed.",
            },
            now.toISOString(),
          ),
        ]);
      }
      return result.task;
    },
    [appendHistory, commitTasks],
  );

  const reopenTaskById = useCallback(
    (taskId: number) => {
      const now = new Date();
      const result = reopenTaskRecord(tasksRef.current, taskId);
      if (result.changed) {
        commitTasks(result.tasks);
        appendHistory([
          makeEntry(
            {
              action: "updated",
              taskId: result.task.id,
              title: result.task.title,
              subject: result.task.subject,
              source: "manual",
              tool: null,
              detail: "Task reopened and marked pending.",
            },
            now.toISOString(),
          ),
        ]);
      }
      return result.task;
    },
    [appendHistory, commitTasks],
  );

  const deleteTaskById = useCallback(
    (taskId: number, confirmed: boolean, source: HistorySource = "manual") => {
      const now = new Date();
      const result = deleteTaskRecord(tasksRef.current, taskId, confirmed);
      commitTasks(result.tasks);
      appendHistory([
        makeEntry(
          {
            action: "deleted",
            taskId: result.task.id,
            title: result.task.title,
            subject: result.task.subject,
            source,
            tool: "delete_task",
            detail: "Task deleted after explicit confirmation.",
          },
          now.toISOString(),
        ),
      ]);
      return result.task;
    },
    [appendHistory, commitTasks],
  );

  const clearAllTasks = useCallback(
    (confirmed: boolean) => {
      const before = tasksRef.current;
      const next = clearTasksRecord(before, confirmed);
      if (before.length === 0) return;
      commitTasks(next);
      appendHistory([
        makeEntry(
          {
            action: "cleared",
            taskId: null,
            title: `${before.length} task(s) cleared`,
            subject: null,
            source: "system",
            tool: null,
            detail: "All local tasks were cleared after confirmation.",
          },
          new Date().toISOString(),
        ),
      ]);
    },
    [appendHistory, commitTasks],
  );

  const clearHistory = useCallback((confirmed: boolean) => {
    if (!confirmed) {
      throw new Error("Clearing history was cancelled. Explicit confirmation is required.");
    }
    historyRef.current = [];
    setHistory([]);
    if (!saveHistory([])) {
      setStorageError("Your browser could not clear history in localStorage.");
    }
  }, []);

  const setModel = useCallback((model: string) => {
    const next = { model };
    setSettings(next);
    if (!saveSettings(next)) {
      setStorageError("Your browser could not save settings to localStorage.");
    }
  }, []);

  const value = useMemo<TaskStoreValue>(
    () => ({
      hydrated,
      storageError,
      tasks,
      history,
      settings,
      addTask,
      addTasks,
      updateTaskById,
      completeTaskById,
      reopenTaskById,
      deleteTaskById,
      clearAllTasks,
      clearHistory,
      setModel,
    }),
    [
      hydrated,
      storageError,
      tasks,
      history,
      settings,
      addTask,
      addTasks,
      updateTaskById,
      completeTaskById,
      reopenTaskById,
      deleteTaskById,
      clearAllTasks,
      clearHistory,
      setModel,
    ],
  );

  return <TaskStoreContext.Provider value={value}>{children}</TaskStoreContext.Provider>;
}

export function useTaskStore(): TaskStoreValue {
  const context = useContext(TaskStoreContext);
  if (!context) {
    throw new Error("useTaskStore must be used inside TaskProvider.");
  }
  return context;
}
