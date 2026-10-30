import { z } from "zod";
import { isRealISODate, localTodayISO } from "@/lib/dates";
import { buildStudyPlan, formatPlanText, tasksForPlanDate } from "@/lib/study-plan";
import type {
  PendingAction,
  ProposedTask,
  StudyPlan,
  Task,
  ToolEvent,
  ToolName,
} from "@/lib/types";
import { PRIORITIES } from "@/lib/types";

export interface ToolExecution {
  event: ToolEvent;
  proposal?: ProposedTask;
  action?: PendingAction;
  plan?: StudyPlan;
}

const optionalDate = z.preprocess(
  (value) => (value === "" || value === undefined || value === null ? null : value),
  z
    .string({ message: "Date must use YYYY-MM-DD format." })
    .refine(isRealISODate, "Date must be a real date in YYYY-MM-DD format.")
    .nullable(),
);

const optionalInteger = z.preprocess(
  (value) => (value === undefined || value === null || value === "" ? undefined : value),
  z.number({ message: "Value must be a whole number." }).int().optional(),
);

const addTaskArgsSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Title is required.")
      .max(200)
      .transform((value) => value.replace(/\s+/g, " ")),
    subject: z
      .string()
      .trim()
      .min(1, "Subject is required.")
      .max(80)
      .transform((value) => value.replace(/\s+/g, " ")),
    due_date: optionalDate.default(null),
    planned_date: optionalDate.default(null),
    priority: z.enum(PRIORITIES).default("Medium"),
    estimated_minutes: optionalInteger.refine(
      (value) => value === undefined || (value >= 5 && value <= 1440),
      "Estimated minutes must be between 5 and 1440.",
    ),
  })
  .strict();

const listTasksArgsSchema = z
  .object({
    status: z.enum(["all", "pending", "completed"]).default("all"),
    subject: z.string().trim().max(80).optional(),
  })
  .strict();

const taskIdArgsSchema = z
  .object({
    task_id: z.number().int().positive("Task ID must be a positive whole number."),
  })
  .strict();

const planArgsSchema = z
  .object({
    date: optionalDate,
    available_minutes: optionalInteger.refine(
      (value) => value === undefined || (value >= 15 && value <= 1440),
      "Available minutes must be between 15 and 1440.",
    ),
    start_hour: optionalInteger.refine(
      (value) => value === undefined || (value >= 0 && value <= 23),
      "Start hour must be between 0 and 23.",
    ),
  })
  .strict();

export const TOOL_NAMES: ToolName[] = [
  "add_task",
  "list_tasks",
  "mark_task_completed",
  "get_study_plan",
  "delete_task",
];

const TOOL_ALLOWLIST = new Set<string>(TOOL_NAMES);

export const TOOL_DECLARATIONS = [
  {
    name: "add_task",
    description:
      "Propose one study task for the student to review and approve. This does NOT save the task. Always use this instead of claiming a task was added.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short action-oriented task title." },
        subject: {
          type: "string",
          description: "Course or topic, for example DSA or Probability.",
        },
        due_date: {
          type: "string",
          description: "Deadline in YYYY-MM-DD format. Omit if not stated.",
        },
        planned_date: {
          type: "string",
          description: "Study day in YYYY-MM-DD format. Use for phrases like tomorrow.",
        },
        priority: {
          type: "string",
          enum: ["Low", "Medium", "High"],
          description: "Default to Medium unless the student signals urgency.",
        },
        estimated_minutes: {
          type: "integer",
          description: "Only when the student stated a duration, in minutes.",
        },
      },
      required: ["title", "subject"],
      additionalProperties: false,
    },
  },
  {
    name: "list_tasks",
    description:
      "Read the student's saved tasks from this browser's local task list. This is a read-only tool.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["all", "pending", "completed"] },
        subject: { type: "string", description: "Optional exact subject filter." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "mark_task_completed",
    description:
      "Request that one saved task be marked completed. The student must approve the action before it is applied.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "integer", minimum: 1 },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_study_plan",
    description:
      "Build a deterministic time-blocked plan from saved pending tasks. This is read-only and never saves changes.",
    parameters: {
      type: "object",
      properties: {
        date: { type: "string", description: "Plan date in YYYY-MM-DD format." },
        available_minutes: {
          type: "integer",
          description: "Optional study window in minutes, between 15 and 1440.",
        },
        start_hour: {
          type: "integer",
          description: "Optional start hour from 0 to 23. Defaults to 9.",
        },
      },
      required: ["date"],
      additionalProperties: false,
    },
  },
  {
    name: "delete_task",
    description:
      "Request deletion of one saved task. Never delete directly: the student must confirm the deletion in the app.",
    parameters: {
      type: "object",
      properties: {
        task_id: { type: "integer", minimum: 1 },
      },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
];

function actionId(): string {
  const maybe = globalThis.crypto as Crypto | undefined;
  if (maybe && typeof maybe.randomUUID === "function") return maybe.randomUUID();
  return `action-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function failed(tool: string, args: Record<string, unknown>, message: string): ToolExecution {
  return {
    event: { tool, args, ok: false, status: "failed", message },
  };
}

export function formatTaskList(tasks: Task[], status: string): string {
  if (tasks.length === 0) return `No ${status === "all" ? "" : `${status} `}tasks were found.`;
  const lines = [`Here are your ${status === "all" ? "" : `${status} `}tasks:`];
  for (const task of tasks) {
    const bits = [`#${task.id} ${task.title}`, `subject: ${task.subject}`];
    bits.push(`priority: ${task.priority}`);
    if (task.dueDate) bits.push(`due: ${task.dueDate}`);
    if (task.plannedDate) bits.push(`planned: ${task.plannedDate}`);
    if (task.estimatedMinutes) bits.push(`${task.estimatedMinutes} min`);
    bits.push(task.status);
    lines.push(`- ${bits.join(" | ")}`);
  }
  return lines.join("\n");
}

export function executeAgentTool(
  tool: unknown,
  rawArgs: unknown,
  tasks: Task[],
  today: string = localTodayISO(),
): ToolExecution {
  const toolName = typeof tool === "string" ? tool : String(tool ?? "");
  const args =
    rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};

  if (!TOOL_ALLOWLIST.has(toolName)) {
    return {
      event: {
        tool: toolName || "unknown",
        args,
        ok: false,
        status: "rejected",
        message: "Unknown or disallowed tool.",
      },
    };
  }

  if (toolName === "add_task") {
    const parsed = addTaskArgsSchema.safeParse(args);
    if (!parsed.success) {
      return failed(toolName, args, parsed.error.issues[0]?.message ?? "Invalid task data.");
    }
    const proposal: ProposedTask = {
      title: parsed.data.title,
      subject: parsed.data.subject,
      dueDate: parsed.data.due_date,
      plannedDate: parsed.data.planned_date,
      priority: parsed.data.priority,
      estimatedMinutes: parsed.data.estimated_minutes ?? null,
    };
    return {
      proposal,
      event: {
        tool: toolName,
        args,
        ok: true,
        status: "proposed",
        message: `Proposed "${proposal.title}". Nothing has been saved yet; approve it in the proposal editor.`,
        result: { saved: false, requiresConfirmation: true, proposal },
      },
    };
  }

  if (toolName === "list_tasks") {
    const parsed = listTasksArgsSchema.safeParse(args);
    if (!parsed.success) {
      return failed(toolName, args, parsed.error.issues[0]?.message ?? "Invalid filters.");
    }
    const status = parsed.data.status;
    const subject = parsed.data.subject?.trim();
    const matches = tasks
      .filter((task) => status === "all" || task.status === status)
      .filter(
        (task) =>
          !subject || task.subject.toLowerCase() === subject.toLowerCase(),
      )
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
        const dateA = a.dueDate ?? a.plannedDate ?? "9999-12-31";
        const dateB = b.dueDate ?? b.plannedDate ?? "9999-12-31";
        return dateA.localeCompare(dateB) || a.id - b.id;
      });
    return {
      event: {
        tool: toolName,
        args,
        ok: true,
        status: "executed",
        message: `Found ${matches.length} ${matches.length === 1 ? "task" : "tasks"} (status: ${status}).`,
        result: { tasks: matches, count: matches.length, status, subject: subject ?? null },
      },
    };
  }

  if (toolName === "mark_task_completed" || toolName === "delete_task") {
    const parsed = taskIdArgsSchema.safeParse(args);
    if (!parsed.success) {
      return failed(toolName, args, parsed.error.issues[0]?.message ?? "Invalid task ID.");
    }
    const task = tasks.find((item) => item.id === parsed.data.task_id);
    if (!task) {
      return failed(toolName, args, `Task #${parsed.data.task_id} was not found.`);
    }
    const isDelete = toolName === "delete_task";
    const action: PendingAction = {
      id: actionId(),
      tool: toolName,
      args: { task_id: task.id },
      task_id: task.id,
      title: task.title,
      requiresConfirmation: true,
      message: isDelete
        ? `Delete task #${task.id} "${task.title}"? This cannot be undone.`
        : `Mark task #${task.id} "${task.title}" as completed?`,
    };
    return {
      action,
      event: {
        tool: toolName,
        args,
        ok: true,
        status: "proposed",
        message: `${isDelete ? "Deletion" : "Completion"} of task #${task.id} is waiting for your confirmation.`,
        result: { requiresConfirmation: true, applied: false, task_id: task.id },
      },
    };
  }

  if (toolName === "get_study_plan") {
    const parsed = planArgsSchema.safeParse(args);
    if (!parsed.success) {
      return failed(toolName, args, parsed.error.issues[0]?.message ?? "Invalid plan request.");
    }
    const planDate = parsed.data.date ?? today;
    const { tasks: planTasks, fallbackNote } = tasksForPlanDate(tasks, planDate);
    const plan = buildStudyPlan(planTasks, planDate, {
      availableMinutes: parsed.data.available_minutes,
      startHour: parsed.data.start_hour,
      fallbackNote,
    });
    return {
      plan,
      event: {
        tool: toolName,
        args,
        ok: true,
        status: "executed",
        message: formatPlanText(plan),
        result: plan,
      },
    };
  }

  return {
    event: {
      tool: toolName,
      args,
      ok: false,
      status: "rejected",
      message: "Unknown or disallowed tool.",
    },
  };
}
