import { Wrench } from "lucide-react";
import { ToolStatusBadge } from "@/components/ui";
import type { ToolEvent } from "@/lib/types";

function pretty(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ToolEventList({ events }: { events: ToolEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Wrench className="h-3.5 w-3.5" aria-hidden />
        Tool activity
      </h3>
      <ul className="mt-2 space-y-2">
        {events.map((event, index) => (
          <li
            key={`${event.tool}-${index}`}
            className="rounded-lg border border-slate-200 bg-white p-2.5"
          >
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">
                {event.tool}
              </code>
              <ToolStatusBadge status={event.status} />
              <span className="text-xs text-slate-600">{event.message}</span>
            </div>
            <details className="mt-2 group">
              <summary className="cursor-pointer text-[11px] font-medium text-indigo-600 hover:text-indigo-700">
                View arguments and result
              </summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Arguments
                  </p>
                  <pre className="max-h-44 overflow-auto rounded-md bg-slate-900 p-2 text-[10px] leading-4 text-slate-100">
                    {pretty(event.args)}
                  </pre>
                </div>
                <div>
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Result
                  </p>
                  <pre className="max-h-44 overflow-auto rounded-md bg-slate-900 p-2 text-[10px] leading-4 text-slate-100">
                    {pretty(event.result ?? null)}
                  </pre>
                </div>
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}
