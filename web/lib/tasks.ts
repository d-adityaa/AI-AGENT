import { localTodayISO } from "@/lib/dates";
import { parseTaskDraft, TaskValidationError } from "@/lib/validation";
import type {
  Priority,
  Task,
  TaskDraft,
  TaskStats,
  TaskStatus,
} from "@/lib/types";

export class ConfirmationRequiredError extends Error {
  constructor(message = "Explicit confirmation is required for this action.") {
    super(message);
    this.name = "ConfirmationRequiredError";
  }
}

export class TaskNotFoundError extends Error {
  constructor(taskId: number) {
    super(`Task #${taskId} was not found.`);
    this.name = "TaskNotFoundError";
  }
}

const PRIORITY_RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };

export function nextTaskId(tasks: Task[]): number {
  return tasks.reduce((highest, task) => Math.max(highest, task.id), 0) + 1;
}

export function createTask(
  tasks: Task[],
  draft: TaskDraft | unknown,
  now: Date = new Date(),
): { tasks: Task[]; task: Task } {
  const fields = parseTaskDraft(draft);
  const task: Task = {
    ...fields,
    id: nextTaskId(tasks),
    status: "pending",
    createdAt: now.toISOString(),
    completedAt: null,
  };
  return { tasks: [...tasks, task], task };
}

export function updateTask(
  tasks: Task[],
  taskId: number,
  draft: TaskDraft | unknown,
): { tasks: Task[]; task: Task } {
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index === -1) throw new TaskNotFoundError(taskId);
  const fields = parseTaskDraft(draft);
  const updated: Task = { ...tasks[index], ...fields };
  const next = tasks.slice();
  next[index] = updated;
  return { tasks: next, task: updated };
}

export function completeTask(
  tasks: Task[],
  taskId: number,
  now: Date = new Date(),
): { tasks: Task[]; task: Task; changed: boolean } {
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index === -1) throw new TaskNotFoundError(taskId);
  const existing = tasks[index];
  if (existing.status === "completed") {
    return { tasks, task: existing, changed: false };
  }
  const updated: Task = {
    ...existing,
    status: "completed",
    completedAt: now.toISOString(),
  };
  const next = tasks.slice();
  next[index] = updated;
  return { tasks: next, task: updated, changed: true };
}

export function reopenTask(
  tasks: Task[],
  taskId: number,
): { tasks: Task[]; task: Task; changed: boolean } {
  const index = tasks.findIndex((task) => task.id === taskId);
  if (index === -1) throw new TaskNotFoundError(taskId);
  const existing = tasks[index];
  if (existing.status === "pending") {
    return { tasks, task: existing, changed: false };
  }
  const updated: Task = { ...existing, status: "pending", completedAt: null };
  const next = tasks.slice();
  next[index] = updated;
  return { tasks: next, task: updated, changed: true };
}

export function deleteTask(
  tasks: Task[],
  taskId: number,
  confirmed: boolean,
): { tasks: Task[]; task: Task } {
  if (!confirmed) throw new ConfirmationRequiredError("Deletion cancelled.");
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  return { tasks: tasks.filter((item) => item.id !== taskId), task };
}

export function clearTasks(tasks: Task[], confirmed: boolean): Task[] {
  if (!confirmed) throw new ConfirmationRequiredError("Clearing tasks cancelled.");
  return tasks.length === 0 ? tasks : [];
}

export interface TaskFilters {
  status?: TaskStatus | "all";
  subject?: string;
  priority?: Priority | "all";
  date?: string;
  search?: string;
}

export function filterTasks(tasks: Task[], filters: TaskFilters): Task[] {
  const status = filters.status ?? "all";
  const subject = filters.subject ?? "all";
  const priority = filters.priority ?? "all";
  const date = filters.date?.trim() ?? "";
  const search = filters.search?.trim().toLowerCase() ?? "";

  return tasks.filter((task) => {
    if (status !== "all" && task.status !== status) return false;
    if (subject !== "all" && task.subject.toLowerCase() !== subject.toLowerCase()) {
      return false;
    }
    if (priority !== "all" && task.priority !== priority) return false;
    if (date && task.dueDate !== date && task.plannedDate !== date) return false;
    if (search && !task.title.toLowerCase().includes(search)) return false;
    return true;
  });
}

export function sortTasks(tasks: Task[]): Task[] {
  return tasks.slice().sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
    const priorityDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    const aDate = a.plannedDate ?? a.dueDate ?? "9999-12-31";
    const bDate = b.plannedDate ?? b.dueDate ?? "9999-12-31";
    if (aDate !== bDate) return aDate < bDate ? -1 : 1;
    return a.createdAt < b.createdAt ? 1 : -1;
  });
}

export function getSubjects(tasks: Task[]): string[] {
  return Array.from(new Set(tasks.map((task) => task.subject))).sort((a, b) =>
    a.localeCompare(b),
  );
}

export function computeStats(tasks: Task[], today = localTodayISO()): TaskStats {
  const total = tasks.length;
  const completed = tasks.filter((task) => task.status === "completed").length;
  const pending = total - completed;
  const overdue = tasks.filter(
    (task) =>
      task.status === "pending" && Boolean(task.dueDate && task.dueDate < today),
  ).length;
  return {
    total,
    pending,
    completed,
    overdue,
    completionRate: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

export function todayTasks(tasks: Task[], today = localTodayISO()): Task[] {
  return sortTasks(
    tasks.filter(
      (task) =>
        task.status === "pending" &&
        (task.plannedDate === today || task.dueDate === today),
    ),
  );
}

export function upcomingDeadlines(
  tasks: Task[],
  today = localTodayISO(),
  days = 7,
): Task[] {
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + days);
  const endISO = end.toISOString().slice(0, 10);
  return tasks
    .filter(
      (task) =>
        task.status === "pending" &&
        task.dueDate !== null &&
        task.dueDate >= today &&
        task.dueDate <= endISO,
    )
    .sort((a, b) => {
      if (a.dueDate !== b.dueDate) return (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
      return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    });
}

export function pendingTasks(tasks: Task[]): Task[] {
  return sortTasks(tasks.filter((task) => task.status === "pending"));
}

export function requireTask(tasks: Task[], taskId: number): Task {
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new TaskNotFoundError(taskId);
  return task;
}

export function isTaskValidationError(error: unknown): error is TaskValidationError {
  return error instanceof TaskValidationError;
}
