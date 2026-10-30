import { describe, expect, it, vi } from "vitest";
import { runAgent } from "@/lib/server/agent";
import type { Task } from "@/lib/types";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(text: string): Response {
  return jsonResponse({
    candidates: [
      {
        content: { role: "model", parts: [{ text }] },
        finishReason: "STOP",
      },
    ],
  });
}

function callResponse(
  name: string,
  args: Record<string, unknown>,
  id = "call-1",
): Response {
  return jsonResponse({
    candidates: [
      {
        content: {
          role: "model",
          parts: [{ functionCall: { name, args, id } }],
        },
        finishReason: "STOP",
      },
    ],
  });
}

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

describe("agent workflow", () => {
  it("uses the labelled local fallback when no key is configured", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const result = await runAgent({
      message:
        "Tomorrow, revise DSA for two hours and finish my AI lab assignment.",
      tasks: [],
      apiKey: "",
      today: "2026-10-30",
      fetchImpl,
    });

    expect(result.mode).toBe("fallback");
    expect(result.proposals).toHaveLength(2);
    expect(result.proposals[0]).toMatchObject({
      subject: "DSA",
      plannedDate: "2026-10-31",
      estimatedMinutes: 120,
    });
    expect(result.warning).toMatch(/not from an AI model/i);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("handles Gemini function calling and returns an unsaved proposal", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        callResponse("add_task", {
          title: "Revise graphs",
          subject: "DSA",
          planned_date: "2026-10-31",
          priority: "Medium",
          estimated_minutes: 60,
        }),
      )
      .mockResolvedValueOnce(
        textResponse("I prepared one task proposal. Nothing has been saved yet."),
      ) as unknown as typeof fetch;

    const tasks = [sample()];
    const result = await runAgent({
      message: "Revise graphs tomorrow for an hour",
      tasks,
      apiKey: "test-key",
      today: "2026-10-30",
      fetchImpl,
    });

    expect(result.mode).toBe("gemini");
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].title).toBe("Revise graphs");
    expect(result.toolEvents).toHaveLength(1);
    expect(result.toolEvents[0]).toMatchObject({ tool: "add_task", status: "proposed" });
    expect(tasks).toHaveLength(1);

    const mock = fetchImpl as unknown as ReturnType<typeof vi.fn>;
    expect(mock.mock.calls).toHaveLength(2);
    const secondBody = JSON.parse(
      (mock.mock.calls[1] as [string, RequestInit])[1].body as string,
    ) as { contents: Array<{ role: string; parts: Array<Record<string, unknown>> }> };
    expect(secondBody.contents.some((content) =>
      content.parts.some((part) => "functionResponse" in part),
    )).toBe(true);
  });

  it("turns delete_task into a pending action and never deletes on the server", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(callResponse("delete_task", { task_id: 1 }))
      .mockResolvedValueOnce(
        textResponse("Deletion is waiting for your confirmation."),
      ) as unknown as typeof fetch;

    const tasks = [sample()];
    const result = await runAgent({
      message: "Delete task 1",
      tasks,
      apiKey: "test-key",
      today: "2026-10-30",
      fetchImpl,
    });

    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toMatchObject({
      tool: "delete_task",
      task_id: 1,
      requiresConfirmation: true,
    });
    expect(tasks).toHaveLength(1);
    expect(result.toolEvents[0].status).toBe("proposed");
  });

  it("rejects an unknown tool requested by the model", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(callResponse("run_shell", { command: "del /s" }))
      .mockResolvedValueOnce(textResponse("That tool is not available.")) as unknown as typeof fetch;

    const result = await runAgent({
      message: "Run a shell command",
      tasks: [sample()],
      apiKey: "test-key",
      today: "2026-10-30",
      fetchImpl,
    });

    expect(result.toolEvents[0]).toMatchObject({
      tool: "run_shell",
      status: "rejected",
      ok: false,
    });
    expect(result.proposals).toHaveLength(0);
  });

  it("reports a real rate-limit error and falls back honestly", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ error: { message: "quota exceeded" } }, 429),
    ) as unknown as typeof fetch;

    const result = await runAgent({
      message: "Show my pending tasks",
      tasks: [sample()],
      apiKey: "test-key",
      today: "2026-10-30",
      fetchImpl,
    });

    expect(result.mode).toBe("fallback");
    expect(result.providerError).toMatch(/rate limit/i);
    expect(result.warning).toMatch(/Gemini was unavailable/i);
    expect(result.toolEvents[0].tool).toBe("list_tasks");
  });

  it("does not fabricate a save when Gemini returns no tool call for an add request", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(textResponse("Here is a suggestion.")) as unknown as typeof fetch;

    const result = await runAgent({
      message: "Tomorrow revise DSA for two hours",
      tasks: [],
      apiKey: "test-key",
      today: "2026-10-30",
      fetchImpl,
    });

    expect(result.mode).toBe("gemini");
    expect(result.proposals).toHaveLength(1);
    expect(result.warning).toMatch(/local fallback parser/i);
    expect(result.toolEvents[0].status).toBe("proposed");
    expect(result.message).toMatch(/Nothing has been saved/i);
  });

  it("rejects an unsupported model before calling the provider", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      runAgent({
        message: "Show tasks",
        tasks: [],
        apiKey: "test-key",
        model: "gpt-4o",
        fetchImpl,
      }),
    ).rejects.toThrow(/not valid|unsupported model/i);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
