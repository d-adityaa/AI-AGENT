"use client";

import type { ReactNode } from "react";
import { TaskProvider } from "@/lib/use-task-store";
import { ToastProvider } from "@/components/toast";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <TaskProvider>{children}</TaskProvider>
    </ToastProvider>
  );
}
