import { describe, expect, it } from "vitest";
import { executeAgentTool } from "@/lib/agent-tools";
import type { Task } from "@/lib/types";

function sample(overrides: Partial<Task> = {}): Task {
  return {
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
    ...overrides,
  };
}

describe("structured agent action validation", () => {
  it("turns add_task into an unsaved proposal", () => {
    const tasks = [sample()];
    const result = executeAgentTool(
      "add_task",
      {
        title: "  Finish AI lab  ",
        subject: " AI Lab ",
        due_date: "2026-11-02",
        planned_date: "2026-11-01",
        priority: "High",
        estimated_minutes: 90,
      },
      tasks,
      "2026-10-30",
    );

    expect(result.proposal).toEqual({
      title: "Finish AI lab",
      subject: "AI Lab",
      dueDate: "2026-11-02",
      plannedDate: "2026-11-01",
      priority: "High",
      estimatedMinutes: 90,
    });
    expect(result.event.status).toBe("proposed");
    expect(result.event.ok).toBe(true);
    expect(result.event.result).toMatchObject({ saved: false, requiresConfirmation: true });
    expect(tasks).toHaveLength(1);
  });

  it("rejects unexpected add_task parameters", () => {
    const result = executeAgentTool(
      "add_task",
      { title: "Bad task", subject: "DSA", command: "rm -rf" },
      [sample()],
    );
    expect(result.event.ok).toBe(false);
    expect(result.event.status).toBe("failed");
    expect(result.event.message).toMatch(/unrecognized|invalid/i);
    expect(result.proposal).toBeUndefined();
  });

  it("rejects invalid dates and durations", () => {
    const badDate = executeAgentTool(
      "add_task",
      { title: "Task", subject: "DSA", due_date: "2026-02-30" },
      [],
    );
    expect(badDate.event.ok).toBe(false);
    expect(badDate.event.message).toMatch(/real date/i);

    const badDuration = executeAgentTool(
      "add_task",
      { title: "Task", subject: "DSA", estimated_minutes: 2 },
      [],
    );
    expect(badDuration.event.ok).toBe(false);
    expect(badDuration.event.message).toMatch(/between 5 and 1440/i);
  });

  it("rejects unknown tools and arbitrary actions", () => {
    const result = executeAgentTool("run_shell", { cmd: "whoami" }, []);
    expect(result.event.ok).toBe(false);
    expect(result.event.status).toBe("rejected");
    expect(result.event.tool).toBe("run_shell");
  });

  it("requires confirmation for completion and does not mutate the snapshot", () => {
    const tasks = [sample()];
    const result = executeAgentTool(
      "mark_task_completed",
      { task_id: 1 },
      tasks,
      "2026-10-30",
    );

    expect(result.action).toMatchObject({
      tool: "mark_task_completed",
      task_id: 1,
      requiresConfirmation: true,
    });
    expect(result.event.status).toBe("proposed");
    expect(tasks[0].status).toBe("pending");
  });

  it("requires confirmation for deletion and rejects a model-supplied bypass flag", () => {
    const tasks = [sample()];
    const proposed = executeAgentTool("delete_task", { task_id: 1 }, tasks);
    expect(proposed.action).toMatchObject({
      tool: "delete_task",
      task_id: 1,
      requiresConfirmation: true,
    });
    expect(proposed.event.result).toMatchObject({ applied: false });

    const bypass = executeAgentTool(
      "delete_task",
      { task_id: 1, confirmed: true },
      tasks,
    );
    expect(bypass.event.ok).toBe(false);
    expect(bypass.event.status).toBe("failed");
    expect(tasks).toHaveLength(1);
  });

  it("fails cleanly for missing tasks and invalid IDs", () => {
    expect(executeAgentTool("mark_task_completed", { task_id: 99 }, []).event.ok).toBe(false);
    expect(executeAgentTool("mark_task_completed", { task_id: -1 }, []).event.ok).toBe(false);
  });

  it("executes read-only list_tasks against the supplied snapshot", () => {
    const tasks = [
      sample({ id: 1, title: "DSA", status: "pending" }),
      sample({ id: 2, title: "AI", subject: "AI Lab", status: "completed" }),
    ];
    const result = executeAgentTool("list_tasks", { status: "pending" }, tasks);
    expect(result.event.status).toBe("executed");
    expect(result.event.ok).toBe(true);
    expect(result.event.result).toMatchObject({ count: 1, status: "pending" });
  });

  it("executes get_study_plan read-only with validated options", () => {
    const tasks = [
      sample({ id: 1, plannedDate: "2026-10-31", estimatedMinutes: 60 }),
      sample({ id: 2, title: "No estimate", plannedDate: "2026-10-31", estimatedMinutes: null }),
    ];
    const result = executeAgentTool(
      "get_study_plan",
      { date: "2026-10-31", available_minutes: 120, start_hour: 10 },
      tasks,
      "2026-10-30",
    );
    expect(result.event.status).toBe("executed");
    expect(result.plan?.date).toBe("2026-10-31");
    expect(result.plan?.startTime).toBe("10:00");
    expect(result.plan?.items[0].startTime).toBe("10:00");
    expect(result.plan?.items[1].estimateSource).toBe("suggested");
  });

  it("rejects an invalid plan window", () => {
    const result = executeAgentTool(
      "get_study_plan",
      { date: "2026-10-31", available_minutes: 5 },
      [sample()],
    );
    expect(result.event.ok).toBe(false);
    expect(result.event.status).toBe("failed");
  });
});
