import { localAgentReply, extractNaturalLanguageTasks, looksLikeAddIntent } from "@/lib/agent-fallback";
import { executeAgentTool, TOOL_DECLARATIONS } from "@/lib/agent-tools";
import { localTodayISO } from "@/lib/dates";
import type {
  AgentResponse,
  PendingAction,
  ProposedTask,
  StudyPlan,
  Task,
  ToolEvent,
} from "@/lib/types";
import {
  callGemini,
  friendlyGeminiError,
  GeminiError,
  geminiFunctionCalls,
  geminiText,
  resolveModel,
  type GeminiContent,
  type GeminiPart,
  type GeminiResponse,
} from "@/lib/server/gemini";

const MAX_TOOL_ROUNDS = 3;
const MAX_HISTORY_MESSAGES = 8;

export class AgentInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentInputError";
  }
}

export interface RunAgentOptions {
  message: string;
  tasks: Task[];
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string;
  apiKey?: string;
  today?: string;
  fetchImpl?: typeof fetch;
}

function systemPrompt(today: string, tasks: Task[]): string {
  const snapshot = tasks.slice(0, 150).map((task) => ({
    id: task.id,
    title: task.title,
    subject: task.subject,
    priority: task.priority,
    due_date: task.dueDate,
    planned_date: task.plannedDate,
    estimated_minutes: task.estimatedMinutes,
    status: task.status,
  }));
  return `You are a careful personal study-planning agent for a college student.
Today is ${today}.

You have these tools: add_task, list_tasks, mark_task_completed, get_study_plan, delete_task.
Tool execution happens in trusted application code. Never claim a tool ran unless a tool result confirms it.

Rules:
1. For requests to add, plan, or revise tasks, call add_task once per requested task. Afterwards tell the student the tasks are proposals awaiting confirmation. Never say they were saved.
2. For listing tasks, completing a task, or building a study plan, call the matching tool. Use real numeric task IDs from the saved-task snapshot or tool results only.
3. Do not invent deadlines, durations, priorities, subjects, or task IDs.
   - Use due_date only for a stated deadline.
   - Use planned_date for a stated study day, such as "tomorrow".
   - Use estimated_minutes only when a duration was stated.
   - Default priority to Medium. Use High only when the student signals urgency.
4. Resolve relative dates from today's date. Use YYYY-MM-DD.
5. Deletion and completion both require the student's explicit confirmation in the app. The delete_task tool only proposes a deletion; never claim it has been deleted.
6. Never request access to files, environment variables, shell commands, or code. Stay within the study-planning tools.
7. Be concise, friendly, and honest. If a request is ambiguous, ask one short clarification instead of guessing.
8. When a tool returns an error, explain it simply and do not pretend it succeeded.

Current saved tasks (JSON; this is the complete list, up to 150 records):
${JSON.stringify(snapshot)}`;
}

function mergeProposals(existing: ProposedTask[], incoming: ProposedTask[]): ProposedTask[] {
  const seen = new Set(
    existing.map((item) =>
      [item.title.toLowerCase(), item.subject.toLowerCase(), item.dueDate ?? "", item.plannedDate ?? ""].join("|"),
    ),
  );
  const merged = existing.slice();
  for (const task of incoming) {
    const key = [
      task.title.toLowerCase(),
      task.subject.toLowerCase(),
      task.dueDate ?? "",
      task.plannedDate ?? "",
    ].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(task);
    }
  }
  return merged.slice(0, 20);
}

function mergeActions(existing: PendingAction[], incoming: PendingAction[]): PendingAction[] {
  const seen = new Set(existing.map((item) => `${item.tool}:${item.task_id}`));
  const merged = existing.slice();
  for (const action of incoming) {
    const key = `${action.tool}:${action.task_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(action);
    }
  }
  return merged;
}

function summarize(events: ToolEvent[], proposals: ProposedTask[]): string {
  if (proposals.length > 0) {
    return `I prepared ${proposals.length} task proposal(s). Review the details below, edit anything you need, and save them when ready. Nothing has been saved yet.`;
  }
  if (events.length > 0) {
    const last = events[events.length - 1];
    return `Tool ${last.tool} finished: ${last.message}`;
  }
  return "I could not complete that request. Please rephrase it.";
}

function blockedReason(response: GeminiResponse): string | null {
  if (response.promptFeedback?.blockReason) {
    return `Gemini blocked the request (${response.promptFeedback.blockReason}). Rephrase it without unsafe content.`;
  }
  const reason = response.candidates?.[0]?.finishReason;
  if (reason && reason !== "STOP" && reason !== "MAX_TOKENS") {
    return `Gemini stopped without a usable answer (${reason}).`;
  }
  return null;
}

function historyContents(
  history: Array<{ role: "user" | "assistant"; content: string }> | undefined,
): GeminiContent[] {
  if (!history) return [];
  return history
    .slice(-MAX_HISTORY_MESSAGES)
    .filter((item) => item.content.trim())
    .map((item) => ({
      role: item.role === "user" ? "user" : "model",
      parts: [{ text: item.content.trim().slice(0, 2000) }],
    }));
}

function responsePayload(event: ToolEvent): Record<string, unknown> {
  return {
    ok: event.ok,
    status: event.status,
    message: event.message,
    result: event.result ?? null,
  };
}

export async function runAgent(options: RunAgentOptions): Promise<AgentResponse> {
  const today = options.today ?? localTodayISO();
  const message = options.message.trim();
  const apiKey = options.apiKey?.trim() ?? "";

  if (!apiKey) {
    return localAgentReply(message, options.tasks, {
      today,
      warning:
        "No Gemini API key is configured. This reply came from the basic local rule-based fallback, not from an AI model.",
    });
  }

  let model: string;
  try {
    model = resolveModel(options.model);
  } catch (error) {
    throw new AgentInputError(friendlyGeminiError(error));
  }

  const contents: GeminiContent[] = [
    ...historyContents(options.history),
    { role: "user", parts: [{ text: message }] },
  ];
  const proposals: ProposedTask[] = [];
  const actions: PendingAction[] = [];
  const events: ToolEvent[] = [];
  let plan: StudyPlan | null = null;
  let finalText = "";

  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const response = await callGemini({
        model,
        apiKey,
        fetchImpl: options.fetchImpl,
        body: {
          systemInstruction: { parts: [{ text: systemPrompt(today, options.tasks) }] },
          contents,
          tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
          toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        },
      });

      const blocked = blockedReason(response);
      if (blocked) throw new GeminiError("invalid_response", blocked);

      const text = geminiText(response);
      if (text) finalText = text;
      const calls = geminiFunctionCalls(response);
      const parts = response.candidates?.[0]?.content?.parts ?? [];
      if (calls.length === 0) {
        if (!text) throw new GeminiError("invalid_response", "Gemini returned an empty response.");
        break;
      }

      contents.push({ role: "model", parts: parts as GeminiPart[] });

      const responseParts: GeminiPart[] = [];
      for (const call of calls) {
        const execution = executeAgentTool(call.name, call.args, options.tasks, today);
        events.push(execution.event);
        if (execution.proposal) {
          const merged = mergeProposals(proposals, [execution.proposal]);
          proposals.splice(0, proposals.length, ...merged);
        }
        if (execution.action) {
          const merged = mergeActions(actions, [execution.action]);
          actions.splice(0, actions.length, ...merged);
        }
        if (execution.plan) plan = execution.plan;

        const functionResponse: Record<string, unknown> = {
          name: execution.event.tool,
          response: responsePayload(execution.event),
        };
        if (call.id) functionResponse.id = call.id;
        responseParts.push({ functionResponse });
      }
      contents.push({ role: "user", parts: responseParts });
    }
  } catch (error) {
    const providerError = friendlyGeminiError(error, model);
    const fallback = localAgentReply(message, options.tasks, {
      today,
      warning: `Gemini was unavailable, so the labelled local fallback was used. ${providerError}`,
    });
    return { ...fallback, providerError };
  }

  if (!finalText) finalText = summarize(events, proposals);

  if (events.length === 0 && proposals.length === 0 && looksLikeAddIntent(message.toLowerCase())) {
    const localProposals = extractNaturalLanguageTasks(message, today);
    if (localProposals.length > 0) {
      const localEvents: ToolEvent[] = [];
      const prepared: ProposedTask[] = [];
      for (const proposal of localProposals) {
        const execution = executeAgentTool(
          "add_task",
          {
            title: proposal.title,
            subject: proposal.subject,
            due_date: proposal.dueDate,
            planned_date: proposal.plannedDate,
            priority: proposal.priority,
            estimated_minutes: proposal.estimatedMinutes,
          },
          options.tasks,
          today,
        );
        localEvents.push(execution.event);
        if (execution.proposal) prepared.push(execution.proposal);
      }
      return {
        mode: "gemini",
        message: `${finalText}\n\nGemini did not request a task tool call, so the labelled local rule parser prepared this proposal instead. Nothing has been saved.`,
        warning:
          "The model reply was kept, but the task extraction came from the local fallback parser.",
        providerError: null,
        model,
        proposals: prepared,
        actions,
        toolEvents: localEvents,
        plan,
      };
    }
  }

  if (!finalText) finalText = summarize(events, proposals);

  return {
    mode: "gemini",
    message: finalText,
    warning: null,
    providerError: null,
    model,
    proposals,
    actions,
    toolEvents: events,
    plan,
  };
}
