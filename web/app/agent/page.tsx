"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  Send,
  Sparkles,
  Trash2,
  User,
} from "lucide-react";
import { fetchAgentStatus, requestAgent } from "@/lib/client-api";
import { useTaskStore } from "@/lib/use-task-store";
import { useToast } from "@/components/toast";
import { ProposalEditor } from "@/components/proposal-editor";
import { ToolEventList } from "@/components/tool-event-list";
import { PlanView } from "@/components/plan-view";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Card, InlineError, PageHeader, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import type {
  AgentStatus,
  ChatMessage,
  PendingAction,
  ProposedTask,
  Task,
  ToolEvent,
} from "@/lib/types";

const SAMPLE_PROMPTS = [
  "Tomorrow, revise DSA for two hours and finish my AI lab assignment.",
  "Show my pending tasks.",
  "Make a study plan for tomorrow with 3 hours.",
];

function newId(): string {
  const cryptoObject = globalThis.crypto as Crypto | undefined;
  if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
    return cryptoObject.randomUUID();
  }
  return `message-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function taskArgs(task: Task): Record<string, unknown> {
  return {
    title: task.title,
    subject: task.subject,
    due_date: task.dueDate,
    planned_date: task.plannedDate,
    priority: task.priority,
    estimated_minutes: task.estimatedMinutes,
  };
}

const WELCOME: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Hi. I can propose study tasks, list saved tasks, request completion, request a deletion, and build a study plan. I work through typed, validated tools and never save or delete anything without your approval.",
  createdAt: new Date().toISOString(),
};

export default function AgentPage() {
  const {
    tasks,
    settings,
    addTasks,
    completeTaskById,
    deleteTaskById,
  } = useTaskStore();
  const toast = useToast();

  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [proposalEdits, setProposalEdits] = useState<Record<string, ProposedTask[]>>({});
  const [actionEdits, setActionEdits] = useState<Record<string, PendingAction[]>>({});
  const [deletingAction, setDeletingAction] = useState<{
    messageId: string;
    action: PendingAction;
  } | null>(null);

  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetchAgentStatus()
      .then((next) => {
        if (active) setStatus(next);
      })
      .catch(() => {
        if (active) setStatus(null);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  const appendExecutedEvent = (messageId: string, event: ToolEvent) => {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== messageId || !message.response) return message;
        return {
          ...message,
          response: {
            ...message.response,
            toolEvents: [...message.response.toolEvents, event],
          },
        };
      }),
    );
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setError(null);
    const userMessage: ChatMessage = {
      id: newId(),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const history = messages
      .filter((message) => message.role === "user" || message.response)
      .slice(-8)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));
    setMessages((current) => [...current, userMessage]);
    setInput("");
    setLoading(true);

    try {
      const response = await requestAgent({
        message: text,
        tasks,
        model: settings.model,
        history,
      });
      const assistantId = newId();
      const assistantMessage: ChatMessage = {
        id: assistantId,
        role: "assistant",
        content: response.message,
        response,
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, assistantMessage]);
      setProposalEdits((current) => ({
        ...current,
        [assistantId]: response.proposals,
      }));
      setActionEdits((current) => ({
        ...current,
        [assistantId]: response.actions,
      }));
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "The agent request failed.";
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const updateProposal = (
    messageId: string,
    index: number,
    patch: Partial<ProposedTask>,
  ) => {
    setProposalEdits((current) => {
      const proposals = current[messageId] ?? [];
      return {
        ...current,
        [messageId]: proposals.map((proposal, itemIndex) =>
          itemIndex === index ? { ...proposal, ...patch } : proposal,
        ),
      };
    });
  };

  const removeProposal = (messageId: string, index: number) => {
    setProposalEdits((current) => ({
      ...current,
      [messageId]: (current[messageId] ?? []).filter((_, itemIndex) => itemIndex !== index),
    }));
  };

  const saveProposals = (messageId: string) => {
    const proposals = proposalEdits[messageId] ?? [];
    if (proposals.length === 0) return;
    try {
      const saved = addTasks(proposals, "agent");
      setProposalEdits((current) => ({ ...current, [messageId]: [] }));
      for (const task of saved) {
        appendExecutedEvent(messageId, {
          tool: "add_task",
          args: taskArgs(task),
          ok: true,
          status: "executed",
          message: `Saved task #${task.id} "${task.title}" after approval.`,
          result: { saved: true, task },
        });
      }
      toast.success(
        saved.length === 1
          ? `Saved task #${saved[0].id}.`
          : `Saved ${saved.length} approved tasks.`,
      );
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not save the approved tasks.";
      toast.error(message);
      setError(message);
    }
  };

  const discardProposals = (messageId: string) => {
    setProposalEdits((current) => ({ ...current, [messageId]: [] }));
    toast.info("Proposals discarded. Nothing was saved.");
  };

  const executeAction = (messageId: string, action: PendingAction) => {
    try {
      if (action.tool === "mark_task_completed") {
        const task = completeTaskById(action.task_id, "agent");
        appendExecutedEvent(messageId, {
          tool: "mark_task_completed",
          args: action.args,
          ok: true,
          status: "executed",
          message: `Task #${task.id} "${task.title}" is now completed.`,
          result: { applied: true, task },
        });
        toast.success(`Completed task #${task.id}.`);
      } else {
        const task = deleteTaskById(action.task_id, true, "agent");
        appendExecutedEvent(messageId, {
          tool: "delete_task",
          args: action.args,
          ok: true,
          status: "executed",
          message: `Deleted task #${task.id} "${task.title}" after confirmation.`,
          result: { applied: true, deleted: true, task },
        });
        toast.success(`Deleted task #${task.id}.`);
      }
      setActionEdits((current) => ({
        ...current,
        [messageId]: (current[messageId] ?? []).filter((item) => item.id !== action.id),
      }));
    } catch (caught) {
      const message =
        caught instanceof Error ? caught.message : "Could not apply the approved action.";
      toast.error(message);
      setError(message);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="AI Agent"
        title="Delegate with validated tools"
        description="Write a natural-language instruction. The agent classifies intent with Gemini function calling when configured, validates every tool call, and asks before saving, completing, or deleting tasks."
        action={
          <span
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium",
              status?.configured
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-amber-200 bg-amber-50 text-amber-700",
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                status?.configured ? "bg-emerald-500" : "bg-amber-500",
              )}
              aria-hidden
            />
            {status
              ? status.configured
                ? `Gemini configured · ${status.model}`
                : "No API key · local fallback ready"
              : "Checking provider..."}
          </span>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[1fr_20rem]">
        <Card className="flex min-h-[36rem] flex-col overflow-hidden">
          <div className="flex-1 space-y-5 p-4 sm:p-5" aria-live="polite">
            {messages.map((message) => {
              const response = message.response;
              const proposals = proposalEdits[message.id] ?? [];
              const actions = actionEdits[message.id] ?? [];
              const isWelcome = message.id === "welcome";

              if (message.role === "user") {
                return (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[88%] rounded-2xl rounded-br-md bg-indigo-600 px-4 py-3 text-sm leading-6 text-white shadow-sm">
                      <div className="mb-1 flex items-center justify-end gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-200">
                        You
                        <User className="h-3 w-3" aria-hidden />
                      </div>
                      <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    </div>
                  </div>
                );
              }

              return (
                <div key={message.id} className="flex gap-3">
                  <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <Bot className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-slate-700">Study agent</span>
                        {response && (
                          <span
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                              response.mode === "gemini"
                                ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                : "border-amber-200 bg-amber-50 text-amber-700",
                            )}
                          >
                            {response.mode === "gemini"
                              ? `Gemini · ${response.model}`
                              : "Local fallback · not an LLM"}
                          </span>
                        )}
                      </div>
                      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                        {message.content}
                      </p>
                      {response?.warning && (
                        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                          {response.warning}
                        </div>
                      )}
                      {response && <ToolEventList events={response.toolEvents} />}
                      {response?.plan && (
                        <div className="mt-4">
                          <PlanView plan={response.plan} />
                        </div>
                      )}
                      {proposals.length > 0 && (
                        <div className="mt-4">
                          <ProposalEditor
                            proposals={proposals}
                            onChange={(index, patch) =>
                              updateProposal(message.id, index, patch)
                            }
                            onRemove={(index) => removeProposal(message.id, index)}
                          />
                          <div className="mt-3 flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => saveProposals(message.id)}
                              className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                            >
                              <Check className="h-3.5 w-3.5" aria-hidden />
                              Save approved tasks ({proposals.length})
                            </button>
                            <button
                              type="button"
                              onClick={() => discardProposals(message.id)}
                              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-3.5 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                            >
                              Discard
                            </button>
                          </div>
                        </div>
                      )}
                      {actions.length > 0 && (
                        <div className="mt-4 space-y-3">
                          <h3 className="text-sm font-semibold text-slate-900">
                            Actions waiting for approval
                          </h3>
                          {actions.map((action) => (
                            <div
                              key={action.id}
                              className="rounded-xl border border-amber-200 bg-amber-50/50 p-3"
                            >
                              <p className="text-xs leading-5 text-amber-900">{action.message}</p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (action.tool === "delete_task") {
                                      setDeletingAction({ messageId: message.id, action });
                                    } else {
                                      executeAction(message.id, action);
                                    }
                                  }}
                                  className={cn(
                                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                                    action.tool === "delete_task"
                                      ? "bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-600"
                                      : "bg-emerald-600 hover:bg-emerald-700 focus-visible:outline-emerald-600",
                                  )}
                                >
                                  {action.tool === "delete_task" ? (
                                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                                  ) : (
                                    <Check className="h-3.5 w-3.5" aria-hidden />
                                  )}
                                  {action.tool === "delete_task"
                                    ? "Review deletion"
                                    : "Approve & complete"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActionEdits((current) => ({
                                      ...current,
                                      [message.id]: (current[message.id] ?? []).filter(
                                        (item) => item.id !== action.id,
                                      ),
                                    }))
                                  }
                                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {isWelcome && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {SAMPLE_PROMPTS.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => setInput(prompt)}
                            className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-left text-xs text-slate-600 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
                          >
                            {prompt}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {loading && (
              <div className="flex gap-3">
                <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                  <Bot className="h-4 w-4" aria-hidden />
                </span>
                <div className="flex items-center gap-2 rounded-2xl rounded-tl-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500 shadow-sm">
                  <Spinner className="text-indigo-600" />
                  Agent is working...
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="border-t border-slate-200 bg-slate-50/60 p-4">
            {error && (
              <div className="mb-3">
                <InlineError message={error} />
              </div>
            )}
            <label htmlFor="agent-message" className="sr-only">
              Study instruction
            </label>
            <textarea
              id="agent-message"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
              rows={3}
              maxLength={4000}
              disabled={loading}
              placeholder='e.g. "Tomorrow, revise DSA for two hours and finish my AI lab assignment."'
              className="w-full resize-none rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100"
            />
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] text-slate-500">
                Enter to send, Shift+Enter for a new line. {input.length}/4000
              </p>
              <button
                type="button"
                onClick={() => void send()}
                disabled={loading || !input.trim()}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                {loading ? <Spinner /> : <Send className="h-4 w-4" aria-hidden />}
                Send instruction
              </button>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
              <Sparkles className="h-4 w-4 text-indigo-600" aria-hidden />
              How this agent works
            </h2>
            <ol className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
              <li>1. Your instruction goes to a server-side route handler.</li>
              <li>2. Gemini chooses among five typed tools using function calling.</li>
              <li>3. The server validates the tool name and arguments against a strict allowlist.</li>
              <li>4. Read-only tools run immediately; changes wait for your approval.</li>
              <li>5. Approved changes run against your local task store and appear in History.</li>
            </ol>
          </Card>
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-slate-900">Guardrails</h2>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
              <li>No eval, shell commands, or AI-generated code.</li>
              <li>No arbitrary file or browser access.</li>
              <li>Deletion always asks for explicit confirmation.</li>
              <li>The API key stays in the server environment.</li>
              <li>Without a key, the clearly labelled local parser is used.</li>
            </ul>
          </Card>
          <Card className="p-5">
            <h2 className="text-sm font-semibold text-slate-900">Chat and data</h2>
            <p className="mt-2 text-xs leading-5 text-slate-600">
              Chat messages are not persisted. Task changes and activity are saved in this
              browser&apos;s localStorage. They do not sync to other devices.
            </p>
          </Card>
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(deletingAction)}
        title="Confirm deletion"
        description={
          deletingAction
            ? deletingAction.action.message
            : "This task will be deleted from this browser."
        }
        confirmLabel="Delete permanently"
        destructive
        onCancel={() => setDeletingAction(null)}
        onConfirm={() => {
          if (!deletingAction) return;
          const pending = deletingAction;
          setDeletingAction(null);
          executeAction(pending.messageId, pending.action);
        }}
      />
    </>
  );
}
