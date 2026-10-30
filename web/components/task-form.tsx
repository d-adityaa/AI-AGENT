"use client";

import { useId, useState } from "react";
import { Save, X } from "lucide-react";
import { parseTaskDraft } from "@/lib/validation";
import type { TaskDraft, TaskFields } from "@/lib/types";
import { PRIORITIES } from "@/lib/types";

const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
const labelClass = "mb-1.5 block text-xs font-semibold text-slate-700";

export function TaskForm({
  initialValues,
  onSubmit,
  onCancel,
  submitLabel = "Add task",
  resetOnSubmit = false,
}: {
  initialValues?: Partial<TaskFields>;
  onSubmit: (draft: TaskDraft) => void;
  onCancel?: () => void;
  submitLabel?: string;
  resetOnSubmit?: boolean;
}) {
  const id = useId();
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [subject, setSubject] = useState(initialValues?.subject ?? "");
  const [dueDate, setDueDate] = useState(initialValues?.dueDate ?? "");
  const [plannedDate, setPlannedDate] = useState(initialValues?.plannedDate ?? "");
  const [priority, setPriority] = useState(initialValues?.priority ?? "Medium");
  const [minutes, setMinutes] = useState(
    initialValues?.estimatedMinutes ? String(initialValues.estimatedMinutes) : "",
  );
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle("");
    setSubject("");
    setDueDate("");
    setPlannedDate("");
    setPriority("Medium");
    setMinutes("");
    setError(null);
  };

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        try {
          const draft = parseTaskDraft({
            title,
            subject,
            dueDate: dueDate || null,
            plannedDate: plannedDate || null,
            priority,
            estimatedMinutes: minutes.trim() === "" ? null : Number(minutes),
          });
          onSubmit(draft);
          if (resetOnSubmit) reset();
        } catch (caught) {
          setError(caught instanceof Error ? caught.message : "The task is invalid.");
        }
      }}
      className="space-y-4"
      aria-describedby={error ? `${id}-error` : undefined}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`${id}-title`} className={labelClass}>
            Task title
          </label>
          <input
            id={`${id}-title`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={inputClass}
            placeholder="e.g. Revise graph traversal"
            maxLength={200}
            required
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor={`${id}-subject`} className={labelClass}>
            Subject
          </label>
          <input
            id={`${id}-subject`}
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className={inputClass}
            placeholder="e.g. DSA"
            maxLength={80}
            required
            autoComplete="off"
          />
        </div>
        <div>
          <label htmlFor={`${id}-priority`} className={labelClass}>
            Priority
          </label>
          <select
            id={`${id}-priority`}
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value as TaskFields["priority"])
            }
            className={inputClass}
          >
            {PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`${id}-planned`} className={labelClass}>
            Planned study date <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id={`${id}-planned`}
            type="date"
            value={plannedDate}
            onChange={(event) => setPlannedDate(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`${id}-due`} className={labelClass}>
            Deadline <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id={`${id}-due`}
            type="date"
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor={`${id}-minutes`} className={labelClass}>
            Estimated minutes <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id={`${id}-minutes`}
            type="number"
            min={5}
            max={1440}
            step={5}
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            className={inputClass}
            placeholder="e.g. 60"
          />
        </div>
        <div className="flex items-end text-xs leading-5 text-slate-500">
          Leave a field blank rather than guessing. Plans are generated only from saved values.
        </div>
      </div>

      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-rose-600">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
        >
          <Save className="h-4 w-4" aria-hidden />
          {submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <X className="h-4 w-4" aria-hidden />
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
