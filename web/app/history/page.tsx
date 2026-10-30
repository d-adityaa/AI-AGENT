"use client";

import { useMemo, useState } from "react";
import { History, Trash2 } from "lucide-react";
import { formatTimestamp } from "@/lib/dates";
import { useTaskStore } from "@/lib/use-task-store";
import { useToast } from "@/components/toast";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { HistoryAction } from "@/lib/types";

const ACTION_STYLES: Record<HistoryAction, string> = {
  created: "border-indigo-200 bg-indigo-50 text-indigo-700",
  updated: "border-sky-200 bg-sky-50 text-sky-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  deleted: "border-rose-200 bg-rose-50 text-rose-700",
  cleared: "border-slate-200 bg-slate-50 text-slate-600",
  history_cleared: "border-slate-200 bg-slate-50 text-slate-600",
};

export default function HistoryPage() {
  const { history, clearHistory } = useTaskStore();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  const completedCount = useMemo(
    () => history.filter((entry) => entry.action === "completed").length,
    [history],
  );

  return (
    <>
      <PageHeader
        eyebrow="History"
        title="Task activity history"
        description="Every task action recorded by this browser, with timestamps and whether it came from you or the AI agent."
        action={
          <button
            type="button"
            onClick={() => setConfirming(true)}
            disabled={history.length === 0}
            className="inline-flex items-center gap-2 rounded-xl border border-rose-200 px-4 py-2.5 text-sm font-semibold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-600"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Clear history
          </button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">History entries</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{history.length}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Tasks completed</p>
          <p className="mt-1 text-2xl font-semibold text-slate-900">{completedCount}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs font-medium text-slate-500">Storage</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">This browser only</p>
        </Card>
      </div>

      {history.length === 0 ? (
        <EmptyState
          icon={History}
          title="No task history yet"
          description="Create, edit, complete, or delete a task and the action will appear here with a timestamp. History is stored in this browser, not on a server."
        />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
                        ACTION_STYLES[entry.action],
                      )}
                    >
                      {entry.action.replace("_", " ")}
                    </span>
                    {entry.taskId !== null && (
                      <span className="text-xs font-medium text-slate-400">#{entry.taskId}</span>
                    )}
                    <span className="break-words text-sm font-medium text-slate-800">
                      {entry.title}
                    </span>
                    {entry.subject && (
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                        {entry.subject}
                      </span>
                    )}
                  </div>
                  {entry.detail && (
                    <p className="mt-1 text-xs leading-5 text-slate-500">{entry.detail}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
                    <span>{formatTimestamp(entry.timestamp)}</span>
                    <span className="capitalize">Source: {entry.source}</span>
                    {entry.tool && (
                      <span>
                        Tool: <code className="rounded bg-slate-100 px-1 py-0.5">{entry.tool}</code>
                      </span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <p className="mt-6 text-xs leading-5 text-slate-500">
        History belongs to this browser profile. It does not sync across devices, and clearing it
        does not change the tasks themselves.
      </p>

      <ConfirmDialog
        open={confirming}
        title="Clear all history?"
        description="This removes every activity entry from this browser. Your tasks and study progress stay where they are. This action cannot be undone."
        confirmLabel="Clear history"
        destructive
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          try {
            clearHistory(true);
            toast.success("Task history cleared.");
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not clear history.");
          } finally {
            setConfirming(false);
          }
        }}
      />
    </>
  );
}
