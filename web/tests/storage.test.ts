import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STORAGE_KEYS,
  loadHistory,
  loadSettings,
  loadTasks,
  removeAllLocalData,
  saveHistory,
  saveSettings,
  saveTasks,
} from "@/lib/storage";
import type { HistoryEntry, Task } from "@/lib/types";

const task: Task = {
  id: 1,
  title: "Revise DSA",
  subject: "DSA",
  dueDate: null,
  plannedDate: "2026-10-31",
  priority: "Medium",
  estimatedMinutes: 60,
  status: "pending",
  createdAt: "2026-10-30T08:00:00.000Z",
  completedAt: null,
};

const historyEntry: HistoryEntry = {
  id: "entry-1",
  action: "created",
  taskId: 1,
  title: "Revise DSA",
  subject: "DSA",
  timestamp: "2026-10-30T08:00:00.000Z",
  source: "manual",
  tool: null,
  detail: null,
};

const store = new Map<string, string>();
const localStorage = {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
};

beforeEach(() => {
  store.clear();
  vi.stubGlobal("window", { localStorage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser-local persistence", () => {
  it("round-trips tasks and keeps data across a simulated reload", () => {
    expect(saveTasks([task])).toBe(true);
    expect(store.has(STORAGE_KEYS.tasks)).toBe(true);
    expect(loadTasks()).toEqual([task]);
  });

  it("returns safe defaults for corrupted data", () => {
    store.set(STORAGE_KEYS.tasks, "{not-json");
    store.set(STORAGE_KEYS.history, JSON.stringify([{ bad: true }]));
    expect(loadTasks()).toEqual([]);
    expect(loadHistory()).toEqual([]);
  });

  it("does not load storage from another app version with extra fields", () => {
    store.set(
      STORAGE_KEYS.tasks,
      JSON.stringify([{ ...task, privateNote: "do not trust" }]),
    );
    expect(loadTasks()).toEqual([]);
  });

  it("round-trips history and settings", () => {
    expect(saveHistory([historyEntry])).toBe(true);
    expect(loadHistory()).toEqual([historyEntry]);

    expect(saveSettings({ model: "gemini-3.8-flash" })).toBe(true);
    expect(loadSettings("gemini-2.5-flash")).toEqual({ model: "gemini-3.8-flash" });
    expect(loadSettings("gemini-2.5-flash")).not.toHaveProperty("apiKey");
  });

  it("falls back to the default model when settings are missing", () => {
    expect(loadSettings("gemini-2.5-flash")).toEqual({ model: "gemini-2.5-flash" });
  });

  it("clears all application keys only", () => {
    saveTasks([task]);
    saveHistory([historyEntry]);
    saveSettings({ model: "gemini-3.8-flash" });
    store.set("unrelated-key", "keep-me");

    removeAllLocalData();

    expect(store.has(STORAGE_KEYS.tasks)).toBe(false);
    expect(store.has(STORAGE_KEYS.history)).toBe(false);
    expect(store.has(STORAGE_KEYS.settings)).toBe(false);
    expect(store.get("unrelated-key")).toBe("keep-me");
  });

  it("fails safely when localStorage is disabled", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("blocked");
        },
        setItem: () => {
          throw new Error("blocked");
        },
        removeItem: () => {
          throw new Error("blocked");
        },
      },
    });
    expect(loadTasks()).toEqual([]);
    expect(saveTasks([task])).toBe(false);
    expect(() => removeAllLocalData()).not.toThrow();
  });
});
