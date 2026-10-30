"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import {
  fetchAgentStatus,
  testGeminiConnection,
  type ConnectionTestResult,
} from "@/lib/client-api";
import { useTaskStore } from "@/lib/use-task-store";
import { useToast } from "@/components/toast";
import { Card, InlineError, PageHeader, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { AgentStatus } from "@/lib/types";

const selectClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-100";
const labelClass = "mb-1.5 block text-xs font-semibold text-slate-700";

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="mt-2 overflow-x-auto rounded-xl bg-slate-900 p-3 text-[11px] leading-5 text-slate-100">
      {children}
    </pre>
  );
}

export default function SettingsPage() {
  const { settings, setModel } = useTaskStore();
  const toast = useToast();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(true);
  const [selectedModel, setSelectedModel] = useState(settings.model);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const loadStatus = async () => {
    setLoadingStatus(true);
    setStatusError(null);
    try {
      const next = await fetchAgentStatus();
      setStatus(next);
      setSelectedModel((current) =>
        next.supportedModels.includes(current) ? current : next.model,
      );
    } catch (error) {
      setStatusError(
        error instanceof Error ? error.message : "Could not load provider status.",
      );
    } finally {
      setLoadingStatus(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetchAgentStatus()
      .then((next) => {
        if (!active) return;
        setStatus(next);
        setStatusError(null);
        setSelectedModel((current) =>
          next.supportedModels.includes(current) ? current : next.model,
        );
      })
      .catch((error: unknown) => {
        if (!active) return;
        setStatusError(
          error instanceof Error ? error.message : "Could not load provider status.",
        );
      })
      .finally(() => {
        if (active) setLoadingStatus(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const models = useMemo(
    () => status?.supportedModels ?? Array.from(new Set([settings.model])),
    [status, settings.model],
  );
  const dirty = selectedModel !== settings.model;

  const runTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testGeminiConnection(selectedModel);
      setTestResult(result);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "The connection test failed.";
      setTestResult({ ok: false, message });
      toast.error(message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Provider, model, and setup"
        description="The Gemini key is read only on the server. This page never receives or displays the key. Browser-local task storage stays available with or without a key."
        action={
          <button
            type="button"
            onClick={() => void loadStatus()}
            disabled={loadingStatus}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          >
            {loadingStatus ? <Spinner /> : <RefreshCw className="h-4 w-4" aria-hidden />}
            Refresh status
          </button>
        }
      />

      {statusError && (
        <div className="mb-6">
          <InlineError message={statusError} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <Server className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">AI provider</h2>
              <p className="text-xs text-slate-500">Server-side route handlers only</p>
            </div>
          </div>
          <div className="space-y-4">
            <div>
              <label htmlFor="provider" className={labelClass}>
                Provider
              </label>
              <select id="provider" value="Google Gemini" disabled className={selectClass}>
                <option value="Google Gemini">Google Gemini</option>
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                This build uses the Gemini generateContent API with native function calling.
              </p>
            </div>
            <div>
              <label htmlFor="model" className={labelClass}>
                Model
              </label>
              <select
                id="model"
                value={selectedModel}
                onChange={(event) => setSelectedModel(event.target.value)}
                className={selectClass}
              >
                {models.map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                The server validates this against its supported model allowlist. Your Google AI
                Studio project must have access to the selected model.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setModel(selectedModel);
                  toast.success(`Saved model preference: ${selectedModel}.`);
                }}
                disabled={!dirty}
                className="inline-flex items-center gap-2 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                <Save className="h-3.5 w-3.5" aria-hidden />
                Save model
              </button>
              {dirty && <span className="text-[11px] text-amber-700">Unsaved change</span>}
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  {status?.configured ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden />
                  )}
                  {loadingStatus
                    ? "Checking server configuration..."
                    : status?.configured
                      ? "GEMINI_API_KEY is configured on the server"
                      : "No server API key configured"}
                </div>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                    status?.configured
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-amber-200 bg-amber-50 text-amber-700",
                  )}
                >
                  {status?.configured ? "Gemini mode" : "Local fallback"}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                {status?.configured
                  ? `Server default: ${status.model}. The key itself is never returned to this page.`
                  : "Manual tasks and the deterministic study-plan generator remain fully usable. The agent labels rule-based replies as local fallback."}
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={() => void runTest()}
                disabled={testing}
                className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-3.5 py-2 text-xs font-semibold text-indigo-700 hover:bg-indigo-100 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              >
                {testing ? <Spinner /> : <Sparkles className="h-3.5 w-3.5" aria-hidden />}
                {testing ? "Testing Gemini..." : "Test Gemini connection"}
              </button>
              <p className="mt-1.5 text-[11px] text-slate-500">
                This makes one real request to the selected model. Failures are reported exactly as
                returned by the server.
              </p>
            </div>
            {testResult && (
              <div
                role={testResult.ok ? "status" : "alert"}
                className={cn(
                  "flex items-start gap-2 rounded-xl border px-3 py-2 text-xs leading-5",
                  testResult.ok
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-rose-200 bg-rose-50 text-rose-700",
                )}
              >
                {testResult.ok ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                ) : (
                  <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
                <div>
                  <p>{testResult.message}</p>
                  {(testResult.model || testResult.latencyMs !== undefined) && (
                    <p className="mt-1 text-[10px] opacity-70">
                      {testResult.model ? `Model: ${testResult.model}` : ""}
                      {testResult.latencyMs !== undefined
                        ? ` · ${testResult.latencyMs} ms`
                        : ""}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
              <KeyRound className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Local key setup</h2>
              <p className="text-xs text-slate-500">web/.env.local, never committed</p>
            </div>
          </div>
          <p className="text-xs leading-5 text-slate-600">
            Copy the example file, then paste a key from Google AI Studio. Use{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5">GEMINI_API_KEY</code> without a{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5">NEXT_PUBLIC_</code> prefix so it stays
            server-only.
          </p>
          <CodeBlock>{`cd "D:\\AI AGENT\\ai-study-planner-agent\\web"
Copy-Item .env.example .env.local
notepad .env.local`}</CodeBlock>
          <CodeBlock>{`GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.8-flash`}</CodeBlock>
          <p className="mt-3 text-[11px] leading-5 text-slate-500">
            Restart <code className="rounded bg-slate-100 px-1">npm run dev</code> after changing
            the file. On Vercel, add the same variables in Project Settings and redeploy.
          </p>
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
          >
            Open Google AI Studio
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
          {status?.docsUrl && (
            <a
              href={status.docsUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-700"
            >
              Gemini model documentation
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden />
            Security and privacy
          </h2>
          <ul className="mt-3 space-y-2 text-xs leading-5 text-slate-600">
            <li>The API key is read from the server environment only.</li>
            <li>It is never sent to this page, logged, or stored in localStorage.</li>
            <li>Provider errors are shown without the key.</li>
            <li>The agent cannot run shell commands, eval, or arbitrary code.</li>
            <li>Unknown tools and unexpected tool parameters are rejected.</li>
            <li>Deletion needs explicit confirmation in the UI.</li>
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
            <Database className="h-4 w-4 text-indigo-600" aria-hidden />
            Browser-local storage
          </h2>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            Tasks, task history, and your model preference are stored in this browser&apos;s
            localStorage. They persist across refreshes but do not sync across browsers or devices.
            Clearing browser site data removes them. This demonstration has no login, multi-user
            sharing, or enterprise security.
          </p>
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            No external database is used. If you clear this browser&apos;s storage, tasks cannot be
            recovered from another device.
          </div>
        </Card>
      </div>
    </>
  );
}
