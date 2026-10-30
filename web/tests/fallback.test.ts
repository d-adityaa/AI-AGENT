import { describe, expect, it } from "vitest";
import {
  extractNaturalLanguageTasks,
  findDateExpression,
  localAgentReply,
} from "@/lib/agent-fallback";
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

describe("local date parsing", () => {
  it.each([
    ["Revise tomorrow", "2026-10-31"],
    ["Revise today", "2026-10-30"],
    ["Revise the day after tomorrow", "2026-11-01"],
    ["Revise in 3 days", "2026-11-02"],
    ["Revise on 2026-11-15", "2026-11-15"],
    ["Revise on November 5", "2026-11-05"],
    ["Revise next monday", "2026-11-02"],
  ])("parses %s", (text, expected) => {
    expect(findDateExpression(text, "2026-10-30")?.date).toBe(expected);
  });

  it("rejects impossible dates instead of rolling them over", () => {
    expect(findDateExpression("Submit on 2026-02-30", "2026-10-30")).toBeNull();
  });
});

describe("natural-language task extraction", () => {
  it("extracts multiple tasks, duration, subject, and planned date", () => {
    const proposals = extractNaturalLanguageTasks(
      "Tomorrow, revise DSA for two hours and finish my AI lab assignment.",
      "2026-10-30",
    );

    expect(proposals).toHaveLength(2);
    expect(proposals[0]).toMatchObject({
      subject: "DSA",
      plannedDate: "2026-10-31",
      dueDate: null,
      estimatedMinutes: 120,
    });
    expect(proposals[1]).toMatchObject({
      subject: "AI Lab",
      plannedDate: "2026-10-31",
      estimatedMinutes: null,
    });
  });

  it("treats explicit due language as a deadline", () => {
    const proposals = extractNaturalLanguageTasks(
      "Submit AI lab assignment by tomorrow",
      "2026-10-30",
    );
    expect(proposals[0].dueDate).toBe("2026-10-31");
    expect(proposals[0].plannedDate).toBeNull();
  });

  it("does not invent a task from an empty message", () => {
    expect(extractNaturalLanguageTasks("   ", "2026-10-30")).toEqual([]);
  });
});

describe("local fallback replies", () => {
  it("builds a study plan for plan intent instead of a task proposal", () => {
    const result = localAgentReply(
      "What should I study tomorrow?",
      [sample()],
      { today: "2026-10-30" },
    );
    expect(result.mode).toBe("fallback");
    expect(result.proposals).toHaveLength(0);
    expect(result.plan?.date).toBe("2026-10-31");
    expect(result.toolEvents[0].tool).toBe("get_study_plan");
  });

  it("lists real pending tasks", () => {
    const result = localAgentReply("Show my pending tasks", [sample()], {
      today: "2026-10-30",
    });
    expect(result.toolEvents[0].tool).toBe("list_tasks");
    expect(result.message).toContain("Revise DSA");
  });

  it("creates an approval-gated delete action", () => {
    const result = localAgentReply("Delete task 1", [sample()], {
      today: "2026-10-30",
    });
    expect(result.actions[0]).toMatchObject({
      tool: "delete_task",
      task_id: 1,
      requiresConfirmation: true,
    });
    expect(result.message).toMatch(/confirm/i);
  });

  it("creates an approval-gated completion action", () => {
    const result = localAgentReply("Mark task 1 as complete", [sample()], {
      today: "2026-10-30",
    });
    expect(result.actions[0]).toMatchObject({
      tool: "mark_task_completed",
      task_id: 1,
      requiresConfirmation: true,
    });
  });

  it("returns task proposals without saving them", () => {
    const result = localAgentReply(
      "Tomorrow revise DSA for two hours",
      [sample()],
      { today: "2026-10-30" },
    );
    expect(result.proposals).toHaveLength(1);
    expect(result.message).toMatch(/nothing has been saved/i);
    expect(result.toolEvents[0].result).toMatchObject({ saved: false });
  });
});
