"use client";

import {
  CalendarDays,
  Check,
  Clock3,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { describeDate, isOverdue, localTodayISO } from "@/lib/dates";
import { PriorityBadge, StatusBadge, SubjectBadge } from "@/components/ui";
import type { Task } from "@/lib/types";

const actionClass =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600";

export function TaskCard({
  task,
  onComplete,
  onReopen,
  onEdit,
  onDelete,
}: {
  task: Task;
  onComplete: (task: Task) => void;
  onReopen?: (task: Task) => void;
  onEdit?: (task: Task) => void;
  onDelete?: (task: Task) => void;
}) {
  const today = localTodayISO();
  const overdue = task.status === "pending" && isOverdue(task.dueDate, today);
  const dateValue = task.plannedDate ?? task.dueDate;

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-900/[0.02]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-400">#{task.id}</span>
            <h3
              className={
                task.status === "completed"
                  ? "min-w-0 break-words text-sm font-semibold text-slate-500 line-through"
                  : "min-w-0 break-words text-sm font-semibold text-slate-900"
              }
            >
              {task.title}
            </h3>
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} />
            {overdue && (
              <span className="rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                Overdue
              </span>
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
            <SubjectBadge subject={task.subject} />
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="h-3.5 w-3.5" aria-hidden />
              {task.plannedDate
                ? `Planned ${describeDate(task.plannedDate, today)}`
                : task.dueDate
                  ? `Due ${describeDate(task.dueDate, today)}`
                  : "No date set"}
            </span>
            {task.plannedDate && task.dueDate && (
              <span className={overdue ? "font-medium text-rose-600" : undefined}>
                Due {describeDate(task.dueDate, today)}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Clock3 className="h-3.5 w-3.5" aria-hidden />
              {task.estimatedMinutes ? `${task.estimatedMinutes} min` : "No estimate"}
            </span>
            {dateValue && task.status === "completed" && task.completedAt && (
              <span>Completed {describeDate(task.completedAt.slice(0, 10), today)}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {task.status === "pending" ? (
            <button
              type="button"
              onClick={() => onComplete(task)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            >
              <Check className="h-3.5 w-3.5" aria-hidden />
              Complete
            </button>
          ) : (
            onReopen && (
              <button type="button" onClick={() => onReopen(task)} className={actionClass}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                Reopen
              </button>
            )
          )}
          {onEdit && (
            <button
              type="button"
              onClick={() => onEdit(task)}
              className={actionClass}
              aria-label={`Edit task ${task.id}: ${task.title}`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              Edit
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={() => onDelete(task)}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-rose-200 px-2.5 py-1.5 text-xs font-medium text-rose-600 transition hover:bg-rose-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
              aria-label={`Delete task ${task.id}: ${task.title}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Delete
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
