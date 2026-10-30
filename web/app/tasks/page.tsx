"use client";

import { useMemo, useState } from "react";
import { Filter, ListTodo, Plus, Search, SlidersHorizontal } from "lucide-react";
import { filterTasks, getSubjects, sortTasks } from "@/lib/tasks";
import { useTaskStore } from "@/lib/use-task-store";
import { useToast } from "@/components/toast";
import { TaskForm } from "@/components/task-form";
import { TaskCard } from "@/components/task-card";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Modal } from "@/components/modal";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { PRIORITIES, type Priority, type Task, type TaskStatus } from "@/lib/types";

const selectClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100";
const filterLabel = "mb-1.5 block text-xs font-semibold text-slate-700";

export default function TasksPage() {
  const {
    tasks,
    addTask,
    updateTaskById,
    completeTaskById,
    reopenTaskById,
    deleteTaskById,
  } = useTaskStore();
  const toast = useToast();

  const [status, setStatus] = useState<TaskStatus | "all">("all");
  const [subject, setSubject] = useState("all");
  const [priority, setPriority] = useState<Priority | "all">("all");
  const [date, setDate] = useState("");
  const [search, setSearch] = useState("");

  const [editing, setEditing] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState<Task | null>(null);

  const subjects = useMemo(() => getSubjects(tasks), [tasks]);
  const visible = useMemo(
    () =>
      sortTasks(
        filterTasks(tasks, {
          status,
          subject,
          priority,
          date,
          search,
        }),
      ),
    [tasks, status, subject, priority, date, search],
  );

  const filtersActive =
    status !== "all" || subject !== "all" || priority !== "all" || Boolean(date) || Boolean(search);

  const clearFilters = () => {
    setStatus("all");
    setSubject("all");
    setPriority("all");
    setDate("");
    setSearch("");
  };

  return (
    <>
      <PageHeader
        eyebrow="My Tasks"
        title="Manage every study task"
        description="Add, edit, complete, and delete tasks. Changes save to this browser immediately, so a refresh will not erase them."
        action={
          <a
            href="#add-task"
            className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add task
          </a>
        }
      />

      <Card className="p-5" id="add-task">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
            <Plus className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Add a task manually</h2>
            <p className="text-xs text-slate-500">
              Only enter a deadline or duration when you actually have one.
            </p>
          </div>
        </div>
        <TaskForm
          submitLabel="Save task"
          resetOnSubmit
          onSubmit={(draft) => {
            try {
              const task = addTask(draft);
              toast.success(`Saved task #${task.id}: ${task.title}.`);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not save the task.");
            }
          }}
        />
      </Card>

      <Card className="mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-indigo-500" aria-hidden />
            <h2 className="text-sm font-semibold text-slate-900">Filters</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">
              Showing {visible.length} of {tasks.length}
            </span>
            {filtersActive && (
              <button
                type="button"
                onClick={clearFilters}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                <Filter className="h-3.5 w-3.5" aria-hidden />
                Clear filters
              </button>
            )}
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label htmlFor="filter-search" className={filterLabel}>
              Search title
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <input
                id="filter-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search..."
                className={`${selectClass} pl-9`}
              />
            </div>
          </div>
          <div>
            <label htmlFor="filter-status" className={filterLabel}>
              Status
            </label>
            <select
              id="filter-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as TaskStatus | "all")}
              className={selectClass}
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <div>
            <label htmlFor="filter-subject" className={filterLabel}>
              Subject
            </label>
            <select
              id="filter-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className={selectClass}
            >
              <option value="all">All subjects</option>
              {subjects.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-priority" className={filterLabel}>
              Priority
            </label>
            <select
              id="filter-priority"
              value={priority}
              onChange={(event) => setPriority(event.target.value as Priority | "all")}
              className={selectClass}
            >
              <option value="all">All priorities</option>
              {PRIORITIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="filter-date" className={filterLabel}>
              Planned or due date
            </label>
            <input
              id="filter-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className={selectClass}
            />
          </div>
        </div>
      </Card>

      <section className="mt-6" aria-label="Task list">
        {visible.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title={tasks.length === 0 ? "No tasks yet" : "No tasks match these filters"}
            description={
              tasks.length === 0
                ? "Add your first task above, or use the AI Agent to propose a study plan. Nothing is saved until you approve it."
                : "Clear the filters or change the search to see more tasks."
            }
            action={
              tasks.length > 0 ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        ) : (
          <div className="space-y-3">
            {visible.map((task) => (
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
                onEdit={(item) => setEditing(item)}
                onDelete={(item) => setDeleting(item)}
              />
            ))}
          </div>
        )}
      </section>

      <p className="mt-6 text-xs leading-5 text-slate-500">
        Tasks and history are stored in this browser&apos;s localStorage. They are not synced to
        another browser or device and are not a multi-user database.
      </p>

      {editing && (
        <Modal
          title={`Edit task #${editing.id}`}
          description="Update the task details. The change is saved only when you submit this form."
          onClose={() => setEditing(null)}
        >
          <TaskForm
            initialValues={editing}
            submitLabel="Save changes"
            onCancel={() => setEditing(null)}
            onSubmit={(draft) => {
              try {
                const updated = updateTaskById(editing.id, draft);
                toast.success(`Updated task #${updated.id}.`);
                setEditing(null);
              } catch (error) {
                toast.error(
                  error instanceof Error ? error.message : "Could not update the task.",
                );
              }
            }}
          />
        </Modal>
      )}

      <ConfirmDialog
        open={Boolean(deleting)}
        title="Delete this task?"
        description={
          deleting
            ? `Task #${deleting.id} "${deleting.title}" will be removed from this browser. This cannot be undone.`
            : ""
        }
        confirmLabel="Delete task"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          try {
            const deleted = deleteTaskById(deleting.id, true);
            toast.success(`Deleted task #${deleted.id}.`);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "Could not delete the task.");
          } finally {
            setDeleting(null);
          }
        }}
      />
    </>
  );
}
