import { z } from "zod";
import { tasksSnapshotSchema } from "@/lib/validation";
import type { AppSettings, HistoryEntry, Task } from "@/lib/types";

export const STORAGE_KEYS = {
  tasks: "study-planner.tasks.v1",
  history: "study-planner.history.v1",
  settings: "study-planner.settings.v1",
} as const;

const historyEntrySchema = z
  .object({
    id: z.string(),
    action: z.enum([
      "created",
      "updated",
      "completed",
      "deleted",
      "cleared",
      "history_cleared",
    ]),
    taskId: z.number().int().positive().nullable(),
    title: z.string(),
    subject: z.string().nullable(),
    timestamp: z.string(),
    source: z.enum(["manual", "agent", "system"]),
    tool: z.string().nullable(),
    detail: z.string().nullable(),
  })
  .strict();

const historySchema = z.array(historyEntrySchema);
const settingsSchema = z.object({ model: z.string().max(80) }).strict();

function readJSON(key: string): unknown {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJSON(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadTasks(): Task[] {
  const result = tasksSnapshotSchema.safeParse(readJSON(STORAGE_KEYS.tasks));
  return result.success ? (result.data as Task[]) : [];
}

export function saveTasks(tasks: Task[]): boolean {
  return writeJSON(STORAGE_KEYS.tasks, tasks);
}

export function loadHistory(): HistoryEntry[] {
  const result = historySchema.safeParse(readJSON(STORAGE_KEYS.history));
  return result.success ? (result.data as HistoryEntry[]) : [];
}

export function saveHistory(history: HistoryEntry[]): boolean {
  return writeJSON(STORAGE_KEYS.history, history);
}

export function loadSettings(defaultModel: string): AppSettings {
  const result = settingsSchema.safeParse(readJSON(STORAGE_KEYS.settings));
  return result.success ? (result.data as AppSettings) : { model: defaultModel };
}

export function saveSettings(settings: AppSettings): boolean {
  return writeJSON(STORAGE_KEYS.settings, settings);
}

export function removeAllLocalData(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEYS.tasks);
    window.localStorage.removeItem(STORAGE_KEYS.history);
    window.localStorage.removeItem(STORAGE_KEYS.settings);
  } catch {
    // localStorage may be unavailable (for example, strict private mode).
  }
}
