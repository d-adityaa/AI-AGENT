import { isRealISODate } from "@/lib/dates";
import { TaskValidationError } from "@/lib/validation";
import type {
  Priority,
  StudyPlan,
  StudyPlanItem,
  Task,
  UnscheduledPlanItem,
} from "@/lib/types";

const PRIORITY_RANK: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };
export const SUGGESTED_BLOCK_MINUTES = 30;
export const MIN_AVAILABLE_MINUTES = 15;
export const MAX_AVAILABLE_MINUTES = 1440;

interface PlanOptions {
  availableMinutes?: number;
  startHour?: number;
  fallbackNote?: string | null;
}

function sortForPlan(tasks: Task[], planDate: string): Task[] {
  return tasks.slice().sort((a, b) => {
    const aOverdue = a.dueDate && a.dueDate < planDate ? 0 : 1;
    const bOverdue = b.dueDate && b.dueDate < planDate ? 0 : 1;
    if (aOverdue !== bOverdue) return aOverdue - bOverdue;
    const aDueToday = a.dueDate === planDate ? 0 : 1;
    const bDueToday = b.dueDate === planDate ? 0 : 1;
    if (aDueToday !== bDueToday) return aDueToday - bDueToday;
    const aPlanned = a.plannedDate === planDate ? 0 : 1;
    const bPlanned = b.plannedDate === planDate ? 0 : 1;
    if (aPlanned !== bPlanned) return aPlanned - bPlanned;
    const priorityDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    const aDue = a.dueDate ?? "9999-12-31";
    const bDue = b.dueDate ?? "9999-12-31";
    if (aDue !== bDue) return aDue.localeCompare(bDue);
    const aPlannedDate = a.plannedDate ?? "9999-12-31";
    const bPlannedDate = b.plannedDate ?? "9999-12-31";
    if (aPlannedDate !== bPlannedDate) return aPlannedDate.localeCompare(bPlannedDate);
    return a.createdAt.localeCompare(b.createdAt);
  });
}

function reasonFor(task: Task, planDate: string): string {
  const reasons: string[] = [];
  if (task.dueDate && task.dueDate < planDate) {
    reasons.push(`overdue since ${task.dueDate}`);
  } else if (task.dueDate === planDate) {
    reasons.push("due this day");
  } else if (task.dueDate) {
    reasons.push(`due ${task.dueDate}`);
  }
  if (task.plannedDate === planDate) reasons.push("planned for this day");
  if (task.priority === "High") reasons.push("high priority");
  if (!task.estimatedMinutes) {
    reasons.push("no estimate provided; 30-minute block suggested");
  }
  return reasons.join("; ") || `${task.priority.toLowerCase()} priority`;
}

function clock(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const minutes = normalized % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function tasksForPlanDate(
  tasks: Task[],
  planDate: string,
  fallbackToPending = true,
): { tasks: Task[]; fallbackNote: string | null } {
  const matching = tasks.filter(
    (task) =>
      task.status === "pending" &&
      (task.plannedDate === planDate || task.dueDate === planDate),
  );
  if (matching.length > 0 || !fallbackToPending) {
    return { tasks: matching, fallbackNote: null };
  }
  return {
    tasks: tasks.filter((task) => task.status === "pending"),
    fallbackNote:
      "No tasks were planned or due on this date, so all pending tasks are shown as a general study queue.",
  };
}

export function buildStudyPlan(
  tasks: Task[],
  planDate: string,
  options: PlanOptions = {},
): StudyPlan {
  if (!isRealISODate(planDate)) {
    throw new TaskValidationError("Plan date must be a real date in YYYY-MM-DD format.");
  }
  const availableMinutes = options.availableMinutes ?? 120;
  const startHour = options.startHour ?? 9;
  if (!Number.isInteger(availableMinutes) || availableMinutes < MIN_AVAILABLE_MINUTES || availableMinutes > MAX_AVAILABLE_MINUTES) {
    throw new TaskValidationError(
      `Available minutes must be a whole number between ${MIN_AVAILABLE_MINUTES} and ${MAX_AVAILABLE_MINUTES}.`,
    );
  }
  if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) {
    throw new TaskValidationError("Start hour must be between 0 and 23.");
  }

  const pending = sortForPlan(
    tasks.filter((task) => task.status === "pending"),
    planDate,
  );
  let cursor = startHour * 60;
  let remaining = availableMinutes;
  const items: StudyPlanItem[] = [];
  const unscheduled: UnscheduledPlanItem[] = [];
  const notes: string[] = options.fallbackNote ? [options.fallbackNote] : [];

  pending.forEach((task, index) => {
    const provided = task.estimatedMinutes;
    const blockMinutes = provided ?? SUGGESTED_BLOCK_MINUTES;
    let partial = false;

    if (remaining < MIN_AVAILABLE_MINUTES) {
      unscheduled.push({
        taskId: task.id,
        title: task.title,
        subject: task.subject,
        priority: task.priority,
        estimatedMinutes: provided,
        reason: "Not enough time left in the selected study window.",
      });
      return;
    }

    let allocated = blockMinutes;
    if (blockMinutes > remaining) {
      allocated = remaining;
      partial = true;
    }

    items.push({
      order: index + 1,
      taskId: task.id,
      title: task.title,
      subject: task.subject,
      priority: task.priority,
      dueDate: task.dueDate,
      plannedDate: task.plannedDate,
      estimatedMinutes: provided,
      allocatedMinutes: allocated,
      estimateSource: provided ? "provided" : "suggested",
      partial,
      startTime: clock(cursor),
      endTime: clock(cursor + allocated),
      reason: reasonFor(task, planDate),
    });
    cursor += allocated;
    remaining -= allocated;
    if (partial) {
      notes.push(
        `'${task.title}' has a ${blockMinutes}-minute estimate but only ${allocated} minutes remain. The block is marked as partial.`,
      );
    }
  });

  const scheduledMinutes = items.reduce((sum, item) => sum + item.allocatedMinutes, 0);
  const suggestedCount = items.filter((item) => item.estimateSource === "suggested").length;
  if (suggestedCount > 0) {
    notes.push(
      `${suggestedCount} task(s) had no duration. A ${SUGGESTED_BLOCK_MINUTES}-minute block was suggested for planning only.`,
    );
  }
  if (pending.length === 0) {
    notes.push("There are no pending tasks to schedule for this plan.");
  }

  return {
    date: planDate,
    availableMinutes,
    startTime: `${String(startHour).padStart(2, "0")}:00`,
    items,
    unscheduled,
    scheduledMinutes,
    remainingMinutes: Math.max(remaining, 0),
    taskCount: items.length,
    notes,
  };
}

export function formatPlanText(plan: StudyPlan): string {
  if (plan.items.length === 0) {
    return `No pending tasks are scheduled for ${plan.date}. Add tasks or choose another date.`;
  }
  const lines = [
    `Study plan for ${plan.date} (${plan.scheduledMinutes} of ${plan.availableMinutes} minutes used):`,
  ];
  for (const item of plan.items) {
    const estimate =
      item.estimateSource === "provided"
        ? `${item.estimatedMinutes} min estimate`
        : "no user estimate; 30 min suggested";
    const partial = item.partial ? " [partial block]" : "";
    lines.push(
      `${item.order}. ${item.startTime}-${item.endTime} ${item.title} (${item.subject}, ${item.priority}, ${estimate})${partial}`,
    );
  }
  if (plan.unscheduled.length > 0) {
    lines.push("Not scheduled:");
    for (const task of plan.unscheduled) {
      lines.push(`- ${task.title} (${task.reason})`);
    }
  }
  for (const note of plan.notes) lines.push(`Note: ${note}`);
  return lines.join("\n");
}
