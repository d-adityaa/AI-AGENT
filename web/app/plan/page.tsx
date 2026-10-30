"use client";

import { useState } from "react";
import { CalendarRange, Play, Sparkles } from "lucide-react";
import { formatLongDate, localTodayISO } from "@/lib/dates";
import { buildStudyPlan, tasksForPlanDate } from "@/lib/study-plan";
import { pendingTasks } from "@/lib/tasks";
import { useTaskStore } from "@/lib/use-task-store";
import { useToast } from "@/components/toast";
import { PlanView } from "@/components/plan-view";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import type { StudyPlan } from "@/lib/types";

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
const labelClass = "mb-1.5 block text-xs font-semibold text-slate-700";

export default function StudyPlanPage() {
  const { tasks } = useTaskStore();
  const toast = useToast();
  const [date, setDate] = useState(localTodayISO());
  const [availableMinutes, setAvailableMinutes] = useState("120");
  const [startHour, setStartHour] = useState("9");
  const [includeAllPending, setIncludeAllPending] = useState(true);
  const [plan, setPlan] = useState<StudyPlan | null>(null);

  const pendingCount = pendingTasks(tasks).length;

  const generate = () => {
    try {
      const minutes = Number(availableMinutes);
      const hour = Number(startHour);
      if (!Number.isFinite(minutes) || !Number.isFinite(hour)) {
        throw new Error("Enter a valid study window and start hour.");
      }
      const selected = tasksForPlanDate(tasks, date, includeAllPending);
      const next = buildStudyPlan(selected.tasks, date, {
        availableMinutes: minutes,
        startHour: hour,
        fallbackNote: selected.fallbackNote,
      });
      setPlan(next);
      toast.success(
        next.items.length === 0
          ? "Plan generated, but there are no matching pending tasks."
          : `Generated a plan with ${next.items.length} time block(s).`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate the plan.");
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Study Plan"
        title="Turn pending tasks into time blocks"
        description="This deterministic planner uses real saved tasks. It labels suggested durations, partial blocks, and unscheduled work honestly. It works with or without Gemini."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <CalendarRange className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Plan settings</h2>
              <p className="text-xs text-slate-500">{pendingCount} pending task(s) available</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label htmlFor="plan-date" className={labelClass}>
                Plan date
              </label>
              <input
                id="plan-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className={inputClass}
              />
              <p className="mt-1 text-[11px] text-slate-500">{formatLongDate(date)}</p>
            </div>
            <div>
              <label htmlFor="plan-minutes" className={labelClass}>
                Available study minutes
              </label>
              <input
                id="plan-minutes"
                type="number"
                min={15}
                max={1440}
                step={15}
                value={availableMinutes}
                onChange={(event) => setAvailableMinutes(event.target.value)}
                className={inputClass}
              />
              <p className="mt-1 text-[11px] text-slate-500">Between 15 and 1440 minutes.</p>
            </div>
            <div>
              <label htmlFor="plan-start" className={labelClass}>
                Start hour (0-23)
              </label>
              <input
                id="plan-start"
                type="number"
                min={0}
                max={23}
                step={1}
                value={startHour}
                onChange={(event) => setStartHour(event.target.value)}
                className={inputClass}
              />
            </div>
            <label className="flex items-start gap-2 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">
              <input
                type="checkbox"
                checked={includeAllPending}
                onChange={(event) => setIncludeAllPending(event.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              If no tasks are planned or due on this date, use the full pending queue.
            </label>
            <button
              type="button"
              onClick={generate}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              <Play className="h-4 w-4" aria-hidden />
              Generate plan
            </button>
          </div>
          <div className="mt-5 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3 text-xs leading-5 text-indigo-800">
            <p className="flex items-center gap-1.5 font-semibold">
              <Sparkles className="h-3.5 w-3.5" aria-hidden />
              Local deterministic planner
            </p>
            <p className="mt-1">
              No AI is needed for this page. The agent can call the same planner through the{" "}
              <code className="rounded bg-white/70 px-1">get_study_plan</code> tool.
            </p>
          </div>
        </Card>

        <div className="lg:col-span-2">
          {plan ? (
            <PlanView plan={plan} />
          ) : (
            <Card className="p-5">
              <EmptyState
                icon={CalendarRange}
                title="No plan generated yet"
                description="Choose a date and study window, then generate a plan from your real pending tasks. Durations you did not provide are shown as suggested 30-minute blocks."
              />
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
