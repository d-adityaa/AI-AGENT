"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  CalendarRange,
  Database,
  GraduationCap,
  History,
  LayoutDashboard,
  ListTodo,
  Menu,
  Settings,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useTaskStore } from "@/lib/use-task-store";
import { LoadingPanel } from "@/components/ui";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/agent", label: "AI Agent", icon: Sparkles },
  { href: "/tasks", label: "My Tasks", icon: ListTodo },
  { href: "/plan", label: "Study Plan", icon: CalendarRange },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-3 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-indigo-600"
      aria-label="Study Planner home"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-blue-500 text-white shadow-sm shadow-indigo-600/20">
        <GraduationCap className="h-5 w-5" aria-hidden />
      </span>
      <span>
        <span className="block text-sm font-semibold tracking-tight text-slate-900">
          Study Planner
        </span>
        <span className="block text-xs text-slate-500">AI study agent</span>
      </span>
    </Link>
  );
}

function SidebarContent({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-6 pt-5">
        <Brand />
      </div>
      <nav className="flex-1 space-y-1 px-3" aria-label="Main navigation">
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600",
                active
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900",
              )}
            >
              <Icon
                className={cn(
                  "h-[18px] w-[18px]",
                  active ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600",
                )}
                aria-hidden
              />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="space-y-3 p-4">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
            <Database className="h-4 w-4 text-indigo-600" aria-hidden />
            Browser-local data
          </div>
          <p className="mt-1.5 text-xs leading-5 text-slate-500">
            Tasks live in this browser only. They do not sync across devices.
          </p>
        </div>
        <div className="flex items-center gap-2 px-1 text-[11px] text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
          Single-user academic demo
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [mobileOpenPath, setMobileOpenPath] = useState<string | null>(null);
  const mobileOpen = mobileOpenPath === pathname;
  const { hydrated, storageError } = useTaskStore();

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-indigo-600 focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-white"
      >
        Skip to content
      </a>

      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-slate-200 bg-white lg:block">
        <SidebarContent pathname={pathname} />
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setMobileOpenPath(pathname)}
          className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
          aria-label="Open navigation menu"
          aria-expanded={mobileOpen}
        >
          <Menu className="h-5 w-5" aria-hidden />
        </button>
      </header>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/30"
            aria-label="Close navigation menu"
            onClick={() => setMobileOpenPath(null)}
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-slate-200 bg-white shadow-xl">
            <button
              type="button"
              onClick={() => setMobileOpenPath(null)}
              className="absolute right-3 top-3 rounded-lg p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              aria-label="Close navigation menu"
            >
              <X className="h-5 w-5" aria-hidden />
            </button>
            <SidebarContent pathname={pathname} onNavigate={() => setMobileOpenPath(null)} />
          </div>
        </div>
      )}

      <main id="main-content" className="lg:pl-72">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
          {storageError && (
            <div
              role="alert"
              className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
            >
              {storageError}
            </div>
          )}
          {hydrated ? children : <LoadingPanel />}
        </div>
      </main>
    </div>
  );
}
