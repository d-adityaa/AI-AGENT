"use client";

import { useId } from "react";
import { Trash2 } from "lucide-react";
import { PRIORITIES, type ProposedTask } from "@/lib/types";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
const labelClass = "mb-1 block text-[11px] font-semibold text-slate-600";

export function ProposalEditor({
  proposals,
  onChange,
  onRemove,
}: {
  proposals: ProposedTask[];
  onChange: (index: number, patch: Partial<ProposedTask>) => void;
  onRemove: (index: number) => void;
}) {
  const id = useId();
  if (proposals.length === 0) return null;

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">
          Proposed tasks ({proposals.length})
        </h3>
        <span className="text-[11px] text-amber-700">Not saved yet</span>
      </div>
      {proposals.map((proposal, index) => (
        <div
          key={`${index}-${proposal.title}`}
          className="rounded-xl border border-amber-200 bg-amber-50/40 p-3"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
              Proposal {index + 1}
            </span>
            <button
              type="button"
              onClick={() => onRemove(index)}
              className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-rose-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              aria-label={`Remove proposal ${index + 1}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor={`${id}-${index}-title`} className={labelClass}>
                Title
              </label>
              <input
                id={`${id}-${index}-title`}
                value={proposal.title}
                onChange={(event) => onChange(index, { title: event.target.value })}
                className={inputClass}
                maxLength={200}
              />
            </div>
            <div>
              <label htmlFor={`${id}-${index}-subject`} className={labelClass}>
                Subject
              </label>
              <input
                id={`${id}-${index}-subject`}
                value={proposal.subject}
                onChange={(event) => onChange(index, { subject: event.target.value })}
                className={inputClass}
                maxLength={80}
              />
            </div>
            <div>
              <label htmlFor={`${id}-${index}-priority`} className={labelClass}>
                Priority
              </label>
              <select
                id={`${id}-${index}-priority`}
                value={proposal.priority}
                onChange={(event) =>
                  onChange(index, {
                    priority: event.target.value as ProposedTask["priority"],
                  })
                }
                className={inputClass}
              >
                {PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${id}-${index}-planned`} className={labelClass}>
                Planned date
              </label>
              <input
                id={`${id}-${index}-planned`}
                type="date"
                value={proposal.plannedDate ?? ""}
                onChange={(event) =>
                  onChange(index, { plannedDate: event.target.value || null })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor={`${id}-${index}-due`} className={labelClass}>
                Deadline
              </label>
              <input
                id={`${id}-${index}-due`}
                type="date"
                value={proposal.dueDate ?? ""}
                onChange={(event) =>
                  onChange(index, { dueDate: event.target.value || null })
                }
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor={`${id}-${index}-minutes`} className={labelClass}>
                Estimated minutes
              </label>
              <input
                id={`${id}-${index}-minutes`}
                type="number"
                min={5}
                max={1440}
                step={5}
                value={proposal.estimatedMinutes ?? ""}
                onChange={(event) =>
                  onChange(index, {
                    estimatedMinutes:
                      event.target.value.trim() === ""
                        ? null
                        : Number(event.target.value),
                  })
                }
                className={inputClass}
                placeholder="Not provided"
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
