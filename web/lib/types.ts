export const PRIORITIES = ["Low", "Medium", "High"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const TASK_STATUSES = ["pending", "completed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface TaskFields {
  title: string;
  subject: string;
  dueDate: string | null;
  plannedDate: string | null;
  priority: Priority;
  estimatedMinutes: number | null;
}

export interface TaskDraft {
  title: string;
  subject: string;
  dueDate?: string | null;
  plannedDate?: string | null;
  priority?: Priority;
  estimatedMinutes?: number | null;
}

export interface Task extends TaskFields {
  id: number;
  status: TaskStatus;
  createdAt: string;
  completedAt: string | null;
}

export type ProposedTask = TaskFields;

export type HistoryAction =
  | "created"
  | "updated"
  | "completed"
  | "deleted"
  | "cleared"
  | "history_cleared";

export type HistorySource = "manual" | "agent" | "system";

export interface HistoryEntry {
  id: string;
  action: HistoryAction;
  taskId: number | null;
  title: string;
  subject: string | null;
  timestamp: string;
  source: HistorySource;
  tool: string | null;
  detail: string | null;
}

export interface TaskStats {
  total: number;
  pending: number;
  completed: number;
  overdue: number;
  completionRate: number;
}

export type ToolName =
  | "add_task"
  | "list_tasks"
  | "mark_task_completed"
  | "get_study_plan"
  | "delete_task";

export type ToolStatus = "executed" | "proposed" | "rejected" | "failed";

export interface ToolEvent {
  tool: ToolName | string;
  args: Record<string, unknown>;
  ok: boolean;
  status: ToolStatus;
  message: string;
  result?: unknown;
}

export interface PendingAction {
  id: string;
  tool: "mark_task_completed" | "delete_task";
  args: { task_id: number };
  task_id: number;
  title: string | null;
  requiresConfirmation: true;
  message: string;
}

export interface StudyPlanItem {
  order: number;
  taskId: number;
  title: string;
  subject: string;
  priority: Priority;
  dueDate: string | null;
  plannedDate: string | null;
  estimatedMinutes: number | null;
  allocatedMinutes: number;
  estimateSource: "provided" | "suggested";
  partial: boolean;
  startTime: string;
  endTime: string;
  reason: string;
}

export interface UnscheduledPlanItem {
  taskId: number;
  title: string;
  subject: string;
  priority: Priority;
  estimatedMinutes: number | null;
  reason: string;
}

export interface StudyPlan {
  date: string;
  availableMinutes: number;
  startTime: string;
  items: StudyPlanItem[];
  unscheduled: UnscheduledPlanItem[];
  scheduledMinutes: number;
  remainingMinutes: number;
  taskCount: number;
  notes: string[];
}

export type AgentMode = "gemini" | "fallback";

export interface AgentResponse {
  mode: AgentMode;
  message: string;
  warning: string | null;
  providerError: string | null;
  model: string;
  proposals: ProposedTask[];
  actions: PendingAction[];
  toolEvents: ToolEvent[];
  plan: StudyPlan | null;
}

export interface AgentStatus {
  configured: boolean;
  provider: string;
  model: string;
  supportedModels: string[];
  docsUrl: string;
  storage: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  response?: AgentResponse;
  createdAt: string;
}

export interface AppSettings {
  model: string;
}
