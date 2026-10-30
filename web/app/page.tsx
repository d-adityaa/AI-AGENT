"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  Clock3,
  ListTodo,
  Plus,
  Sparkles,
  Target,
} from "lucide-react";
import { formatLongDate, formatShortDate, localTodayISO } from "@/lib/dates";
import {
  computeStats,
  pendingTasks,
  todayTasks,
  upcomingDeadlines,
} from "@/lib/tasks";
import { useTaskStore } from "@/lib/use-task-store";
import { useToast } from "@/components/toast";
import { TaskCard } from "@/components/task-card";
import {
  Card,
  EmptyState,
  PageHeader,
  PriorityBadge,
  ProgressBar,
  StatCard,
  SubjectBadge,
} from "@/components/ui";

export default function DashboardPage() {
  const { tasks, completeTaskById, reopenTaskById } = useTaskStore();
  const toast = useToast();
  const today = localTodayISO();
  const stats = computeStats(tasks, today);
  const todayList = todayTasks(tasks, today);
  const deadlines = upcomingDeadlines(tasks, today, 7);
  const pending = pendingTasks(tasks);

  return (
    <>
      <PageHeader
        eyebrow="Dashboard"
        title="Your study command center"
        description={`${formatLongDate(today)}. Plan sessions, track real progress, and let the agent work only through validated tools.`}
        action={
          <Link
            href="/agent"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            Plan with AI
          </Link>
        }
      />

      <section aria-label="Task statistics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Pending" value={stats.pending} hint="Tasks still open" icon={ListTodo} />
        <StatCard
          label="Completed"
          value={stats.completed}
          hint="Tasks finished"
          icon={CheckCircle2}
          tone="emerald"
        />
        <StatCard
          label="Overdue"
          value={stats.overdue}
          hint="Pending past deadline"
          icon={AlertTriangle}
          tone={stats.overdue > 0 ? "rose" : "slate"}
        />
        <StatCard
          label="Completion"
          value={`${stats.completionRate}%`}
          hint={`${stats.completed} of ${stats.total} tasks`}
          icon={Target}
          tone="indigo"
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Today&apos;s schedule</h2>
                <p className="mt-1 text-xs text-slate-500">
                  Pending tasks planned or due today.
                </p>
              </div>
              <CalendarClock className="h-5 w-5 text-indigo-500" aria-hidden />
            </div>
            {todayList.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="Nothing scheduled for today"
                description="Add a task with today's planned or due date, or ask the agent to plan your day."
                action={
                  <Link
                    href="/tasks"
                    className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    Add a task
                  </Link>
                }
              />
            ) : (
              <div className="space-y-3">
                {todayList.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onComplete={(item) => {
                      completeTaskById(item.id);
                      toast.success(`Completed "${item.title}".`);
                    }}
                    onReopen={(item) => {
                      reopenTaskById(item.id);
                      toast.info(`Reopened "${item.title}".`);
                    }}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Pending tasks</h2>
                <p className="mt-1 text-xs text-slate-500">
                  The next open tasks in your queue.
                </p>
              </div>
              <Link
                href="/tasks"
                className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
              >
                View all
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </div>
            {pending.length === 0 ? (
              <EmptyState
                icon={ListTodo}
                title="No pending tasks"
                description="Your queue is clear. Add a task manually or ask the agent to propose a study plan."
              />
            ) : (
              <ul className="divide-y divide-slate-100">
                {pending.slice(0, 5).map((task) => (
                  <li key={task.id} className="flex flex-wrap items-center gap-2 py-3 first:pt-0 last:pb-0">
                    <span className="text-xs font-medium text-slate-400">#{task.id}</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">
                      {task.title}
                    </span>
                    <SubjectBadge subject={task.subject} />
                    <PriorityBadge priority={task.priority} />
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Clock3 className="h-3.5 w-3.5" aria-hidden />
                      {task.plannedDate
                        ? formatShortDate(task.plannedDate)
                        : task.dueDate
                          ? `Due ${formatShortDate(task.dueDate)}`
                          : "No date"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="text-base font-semibold text-slate-900">Study progress</h2>
            <p className="mt-1 text-xs text-slate-500">
              Based only on tasks saved in this browser.
            </p>
            <div className="mt-5">
              <ProgressBar value={stats.completionRate} label="Overall completion" />
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Total tasks</dt>
                <dd className="mt-1 text-lg font-semibold text-slate-900">{stats.total}</dd>
              </div>
              <div className="rounded-xl bg-slate-50 p-3">
                <dt className="text-xs text-slate-500">Still pending</dt>
                <dd className="mt-1 text-lg font-semibold text-slate-900">{stats.pending}</dd>
              </div>
            </dl>
            <Link
              href="/plan"
              className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
            >
              <CalendarClock className="h-4 w-4" aria-hidden />
              Build a study plan
            </Link>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">Upcoming deadlines</h2>
              <span className="text-xs text-slate-400">Next 7 days</span>
            </div>
            {deadlines.length === 0 ? (
              <p className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-500">
                No pending deadlines in the next 7 days.
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {deadlines.map((task) => (
                  <li key={task.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{task.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{task.subject}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <PriorityBadge priority={task.priority} />
                      <span className="text-xs text-slate-500">
                        {formatShortDate(task.dueDate)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
