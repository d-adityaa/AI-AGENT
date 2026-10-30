import { z } from "zod";
import { isRealISODate } from "@/lib/dates";
import { PRIORITIES, TASK_STATUSES, type TaskDraft, type TaskFields } from "@/lib/types";

export class TaskValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskValidationError";
  }
}

const nullableDate = z.preprocess(
  (value) => (value === "" || value === undefined || value === null ? null : value),
  z
    .string({ message: "Dates must use YYYY-MM-DD format." })
    .refine(isRealISODate, "Enter a real date in YYYY-MM-DD format.")
    .nullable(),
);

const nullableMinutes = z.preprocess(
  (value) => {
    if (value === "" || value === undefined || value === null) return null;
    if (typeof value === "string" && value.trim() !== "") return Number(value);
    return value;
  },
  z
    .number({ message: "Estimated minutes must be a whole number." })
    .int("Estimated minutes must be a whole number.")
    .min(5, "Estimated minutes must be at least 5.")
    .max(1440, "Estimated minutes must be 1440 or fewer.")
    .nullable(),
);

export const taskDraftSchema = z
  .object({
    title: z
      .string({ message: "Title is required." })
      .trim()
      .min(1, "Title is required.")
      .max(200, "Title must be 200 characters or fewer.")
      .transform((value) => value.replace(/\s+/g, " ")),
    subject: z
      .string({ message: "Subject is required." })
      .trim()
      .min(1, "Subject is required.")
      .max(80, "Subject must be 80 characters or fewer.")
      .transform((value) => value.replace(/\s+/g, " ")),
    dueDate: nullableDate.default(null),
    plannedDate: nullableDate.default(null),
    priority: z
      .enum(PRIORITIES, { message: "Priority must be Low, Medium, or High." })
      .default("Medium"),
    estimatedMinutes: nullableMinutes.default(null),
  })
  .strict();

export function parseTaskDraft(input: unknown): TaskFields {
  const result = taskDraftSchema.safeParse(input);
  if (!result.success) {
    throw new TaskValidationError(
      result.error.issues[0]?.message ?? "The task data is invalid.",
    );
  }
  return result.data;
}

export const taskSchema = z
  .object({
    id: z.number().int().positive(),
    title: z.string().min(1).max(200),
    subject: z.string().min(1).max(80),
    dueDate: z.string().nullable(),
    plannedDate: z.string().nullable(),
    priority: z.enum(PRIORITIES),
    estimatedMinutes: z.number().int().min(5).max(1440).nullable(),
    status: z.enum(TASK_STATUSES),
    createdAt: z.string().min(1),
    completedAt: z.string().nullable(),
  })
  .strict();

export const tasksSnapshotSchema = z.array(taskSchema).max(500);

export const agentRequestSchema = z
  .object({
    message: z
      .string({ message: "Message is required." })
      .trim()
      .min(1, "Please type a study instruction first.")
      .max(4000, "Please keep a message under 4000 characters."),
    tasks: z.array(taskSchema).max(500, "Too many tasks were supplied."),
    model: z.string().trim().max(80).optional(),
    history: z
      .array(
        z
          .object({
            role: z.enum(["user", "assistant"]),
            content: z.string().max(4000),
          })
          .strict(),
      )
      .max(12)
      .optional(),
  })
  .strict();

export const testRequestSchema = z
  .object({
    model: z.string().trim().max(80).optional(),
  })
  .strict();

export function friendlyTaskError(error: unknown): string {
  if (error instanceof TaskValidationError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong while saving the task.";
}

export function toDraft(fields: TaskFields): TaskDraft {
  return {
    title: fields.title,
    subject: fields.subject,
    dueDate: fields.dueDate,
    plannedDate: fields.plannedDate,
    priority: fields.priority,
    estimatedMinutes: fields.estimatedMinutes,
  };
}
