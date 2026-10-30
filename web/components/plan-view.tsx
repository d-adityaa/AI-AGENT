import { AlertCircle, CalendarClock, Clock3, Info } from "lucide-react";
import { formatLongDate } from "@/lib/dates";
import { Card, EmptyState, PriorityBadge } from "@/components/ui";
import type { StudyPlan } from "@/lib/types";

export function PlanView({ plan }: { plan: StudyPlan }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Plan date
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {formatLongDate(plan.date)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Scheduled
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            {plan.scheduledMinutes} / {plan.availableMinutes} min
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Tasks in plan
          </p>
          <p className="mt-1 text-sm font-semibold text-slate-900">{plan.taskCount}</p>
        </div>
      </div>

      {plan.items.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="Nothing scheduled for this date"
          description="Add pending tasks, choose another date, or include the general pending queue."
        />
      ) : (
        <ol className="space-y-3">
          {plan.items.map((item) => (
            <li key={`${item.taskId}-${item.order}`}>
              <Card className="p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <div className="w-28 shrink-0 rounded-lg bg-indigo-50 px-3 py-2 text-center">
                    <p className="text-sm font-semibold text-indigo-700">
                      {item.startTime}
                    </p>
                    <p className="text-[11px] text-indigo-500">to {item.endTime}</p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{item.title}</h3>
                      <PriorityBadge priority={item.priority} />
                      {item.partial && (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          Partial block
                        </span>
                      )}
                      {item.estimateSource === "suggested" && (
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                          30 min suggested
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {item.subject} | {item.allocatedMinutes} min allocated
                      {item.estimatedMinutes
                        ? ` | ${item.estimatedMinutes} min estimated`
                        : ""}
                    </p>
                    <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-slate-500">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                      {item.reason}
                    </p>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ol>
      )}

      {plan.unscheduled.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-rose-800">
            <AlertCircle className="h-4 w-4" aria-hidden />
            Not scheduled
          </h3>
          <ul className="mt-2 space-y-1 text-sm text-rose-700">
            {plan.unscheduled.map((task) => (
              <li key={task.taskId}>
                #{task.taskId} {task.title}: {task.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.notes.length > 0 && (
        <div className="space-y-2">
          {plan.notes.map((note) => (
            <p
              key={note}
              className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600"
            >
              <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
              {note}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
