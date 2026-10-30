import { describe, expect, it } from "vitest";
import {
  ConfirmationRequiredError,
  TaskNotFoundError,
  completeTask,
  computeStats,
  createTask,
  deleteTask,
  filterTasks,
  reopenTask,
  updateTask,
} from "@/lib/tasks";
import type { Task } from "@/lib/types";

function sample(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    title: "Revise DSA",
    subject: "DSA",
    dueDate: null,
    plannedDate: "2026-11-01",
    priority: "Medium",
    estimatedMinutes: 60,
    status: "pending",
    createdAt: "2026-10-30T08:00:00.000Z",
    completedAt: null,
    ...overrides,
  };
}

describe("task creation", () => {
  it("creates a pending task with validated defaults", () => {
    const now = new Date("2026-10-30T10:00:00.000Z");
    const result = createTask(
      [],
      {
        title: "  Revise   DSA  ",
        subject: " DSA ",
      },
      now,
    );

    expect(result.task).toMatchObject({
      id: 1,
      title: "Revise DSA",
      subject: "DSA",
      dueDate: null,
      plannedDate: null,
      priority: "Medium",
      estimatedMinutes: null,
      status: "pending",
      completedAt: null,
    });
    expect(result.task.createdAt).toBe(now.toISOString());
    expect(result.tasks).toHaveLength(1);
  });

  it("increments IDs and keeps supplied dates and duration", () => {
    const first = createTask([], {
      title: "Task one",
      subject: "Math",
    });
    const second = createTask(first.tasks, {
      title: "Task two",
      subject: "AI",
      dueDate: "2026-11-05",
      plannedDate: "2026-11-03",
      priority: "High",
      estimatedMinutes: 90,
    });

    expect(second.task.id).toBe(2);
    expect(second.task.dueDate).toBe("2026-11-05");
    expect(second.task.priority).toBe("High");
    expect(second.task.estimatedMinutes).toBe(90);
  });
});

describe("task editing and completion", () => {
  it("edits fields while preserving identity and status", () => {
    const original = sample({ status: "completed", completedAt: "2026-10-30T11:00:00.000Z" });
    const result = updateTask([original], 1, {
      title: "Revise graphs",
      subject: "DSA",
      priority: "High",
      estimatedMinutes: 45,
    });

    expect(result.task.id).toBe(1);
    expect(result.task.createdAt).toBe(original.createdAt);
    expect(result.task.status).toBe("completed");
    expect(result.task.completedAt).toBe("2026-10-30T11:00:00.000Z");
    expect(result.task.title).toBe("Revise graphs");
    expect(result.task.priority).toBe("High");
  });

  it("rejects editing a missing task", () => {
    expect(() =>
      updateTask([], 99, { title: "Missing", subject: "None" }),
    ).toThrow(TaskNotFoundError);
  });

  it("marks a task complete with a timestamp and is idempotent", () => {
    const now = new Date("2026-10-30T12:00:00.000Z");
    const first = completeTask([sample()], 1, now);
    expect(first.changed).toBe(true);
    expect(first.task.status).toBe("completed");
    expect(first.task.completedAt).toBe(now.toISOString());

    const second = completeTask(first.tasks, 1, new Date());
    expect(second.changed).toBe(false);
    expect(second.task.completedAt).toBe(now.toISOString());
  });

  it("reopens a completed task", () => {
    const result = reopenTask(
      [sample({ status: "completed", completedAt: "2026-10-30T12:00:00.000Z" })],
      1,
    );
    expect(result.task.status).toBe("pending");
    expect(result.task.completedAt).toBeNull();
  });
});

describe("task deletion confirmation", () => {
  it("refuses deletion without explicit confirmation", () => {
    const tasks = [sample()];
    expect(() => deleteTask(tasks, 1, false)).toThrow(ConfirmationRequiredError);
    expect(tasks).toHaveLength(1);
  });

  it("deletes only after confirmation", () => {
    const tasks = [sample(), sample({ id: 2, title: "Second" })];
    const result = deleteTask(tasks, 1, true);
    expect(result.task.id).toBe(1);
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe(2);
  });

  it("reports a missing task even when confirmed", () => {
    expect(() => deleteTask([], 7, true)).toThrow(TaskNotFoundError);
  });
});

describe("invalid task input", () => {
  it.each([
    [{ title: "", subject: "DSA" }, "Title is required"],
    [{ title: "   ", subject: "DSA" }, "Title is required"],
    [{ title: "Task", subject: "" }, "Subject is required"],
    [{ title: "Task", subject: "DSA", dueDate: "2026-02-30" }, "real date"],
    [{ title: "Task", subject: "DSA", priority: "Urgent" }, "Priority"],
    [{ title: "Task", subject: "DSA", estimatedMinutes: 4 }, "at least 5"],
    [{ title: "Task", subject: "DSA", estimatedMinutes: 1441 }, "1440 or fewer"],
    [{ title: "Task", subject: "DSA", extra: "nope" }, "Unrecognized key"],
  ])("rejects invalid task data %#", (draft, message) => {
    expect(() => createTask([], draft)).toThrow(new RegExp(message, "i"));
  });
});

describe("filters and statistics", () => {
  const tasks = [
    sample({ id: 1, title: "DSA lab", subject: "DSA", priority: "High", plannedDate: "2026-10-30" }),
    sample({
      id: 2,
      title: "Probability revision",
      subject: "Probability",
      priority: "Low",
      plannedDate: "2026-10-31",
      dueDate: "2026-10-29",
    }),
    sample({
      id: 3,
      title: "AI assignment",
      subject: "AI Lab",
      priority: "Medium",
      status: "completed",
      plannedDate: null,
      dueDate: null,
      completedAt: "2026-10-30T10:00:00.000Z",
    }),
  ];

  it("filters by status, subject, priority, date, and search", () => {
    expect(filterTasks(tasks, { status: "pending" })).toHaveLength(2);
    expect(filterTasks(tasks, { subject: "AI Lab" })).toHaveLength(1);
    expect(filterTasks(tasks, { priority: "High" })).toHaveLength(1);
    expect(filterTasks(tasks, { date: "2026-10-30" })).toHaveLength(1);
    expect(filterTasks(tasks, { search: "prob" })).toHaveLength(1);
  });

  it("computes real counts and completion rate", () => {
    expect(computeStats(tasks, "2026-10-30")).toEqual({
      total: 3,
      pending: 2,
      completed: 1,
      overdue: 1,
      completionRate: 33,
    });
  });

  it("handles an empty task list", () => {
    expect(computeStats([], "2026-10-30")).toEqual({
      total: 0,
      pending: 0,
      completed: 0,
      overdue: 0,
      completionRate: 0,
    });
  });
});
