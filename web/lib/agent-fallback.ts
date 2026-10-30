import { addDaysISO, isRealISODate, localTodayISO, weekdayIndex } from "@/lib/dates";
import { executeAgentTool, formatTaskList } from "@/lib/agent-tools";
import type {
  AgentResponse,
  ProposedTask,
  Task,
  ToolEvent,
} from "@/lib/types";

const WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

interface DateExpression {
  date: string;
  phrase: string;
}

export function findDateExpression(
  text: string,
  today: string = localTodayISO(),
): DateExpression | null {
  const lower = text.toLowerCase();

  const isoMatch = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(lower);
  if (isoMatch && isRealISODate(isoMatch[1])) {
    return { date: isoMatch[1], phrase: isoMatch[0] };
  }

  if (/\bday after tomorrow\b/.test(lower)) {
    return { date: addDaysISO(today, 2), phrase: "day after tomorrow" };
  }
  if (/\btomorrow\b/.test(lower)) {
    return { date: addDaysISO(today, 1), phrase: "tomorrow" };
  }
  if (/\b(today|tonight)\b/.test(lower)) {
    return { date: today, phrase: /\btonight\b/.test(lower) ? "tonight" : "today" };
  }

  const inDays = /\bin\s+(\d{1,3})\s+days?\b/.exec(lower);
  if (inDays) {
    const days = Math.min(Number(inDays[1]), 365);
    return { date: addDaysISO(today, days), phrase: inDays[0] };
  }

  if (/\bnext week\b/.test(lower)) {
    return { date: addDaysISO(today, 7), phrase: "next week" };
  }

  const weekdayMatch =
    /\b(?:(next|this)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/.exec(
      lower,
    );
  if (weekdayMatch) {
    const targetIndex = weekdayIndex(weekdayMatch[2]);
    const [year, month, day] = today.split("-").map(Number);
    const currentIndex = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    let daysAhead = (targetIndex - currentIndex + 7) % 7;
    if (daysAhead === 0) daysAhead = 7;
    return { date: addDaysISO(today, daysAhead), phrase: weekdayMatch[0] };
  }

  const monthMatch =
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/.exec(
      lower,
    );
  if (monthMatch) {
    const monthIndex = MONTHS.indexOf(monthMatch[1]);
    const day = Number(monthMatch[2]);
    const [year] = today.split("-").map(Number);
    let candidate = new Date(Date.UTC(year, monthIndex, day));
    if (
      candidate.getUTCMonth() !== monthIndex ||
      candidate.getUTCDate() !== day
    ) {
      return null;
    }
    let iso = candidate.toISOString().slice(0, 10);
    if (iso < today) {
      candidate = new Date(Date.UTC(year + 1, monthIndex, day));
      iso = candidate.toISOString().slice(0, 10);
    }
    return { date: iso, phrase: monthMatch[0] };
  }

  return null;
}

function segmentHasDuePhrase(segment: string, phrase: string): boolean {
  const index = segment.toLowerCase().indexOf(phrase.toLowerCase());
  if (index === -1) return false;
  const prefix = segment.toLowerCase().slice(Math.max(0, index - 16), index);
  return /\b(due|by|deadline|before|submit)\b/.test(prefix);
}

function durationMinutes(segment: string): { minutes: number | null; cleaned: string } {
  const words = Object.keys(WORD_NUMBERS).join("|");
  const match = new RegExp(
    `\\b(?:for\\s+)?(\\d+(?:\\.\\d+)?|an?|half\\s+an?|${words})\\s*(hours?|hrs?|h|minutes?|mins?|m)\\b`,
    "i",
  ).exec(segment);
  if (!match) return { minutes: null, cleaned: segment };

  const rawAmount = match[1].toLowerCase();
  const unit = match[2].toLowerCase();
  let amount: number;
  if (rawAmount === "a" || rawAmount === "an") amount = 1;
  else if (rawAmount.startsWith("half")) amount = 0.5;
  else if (rawAmount in WORD_NUMBERS) amount = WORD_NUMBERS[rawAmount];
  else amount = Number(rawAmount);

  let minutes = unit.startsWith("h") ? Math.round(amount * 60) : Math.round(amount);
  if (minutes < 5 || minutes > 1440) minutes = -1;

  let cleaned = `${segment.slice(0, match.index)} ${segment.slice(match.index + match[0].length)}`;
  cleaned = cleaned.replace(/\bfor\s*$/i, "").replace(/\s+/g, " ").trim();
  return { minutes: minutes === -1 ? null : minutes, cleaned };
}

function subjectFor(title: string): string {
  const lowered = title.toLowerCase();
  const aliases: Array<[string, string]> = [
    ["ai lab", "AI Lab"],
    ["machine learning", "Machine Learning"],
    ["artificial intelligence", "AI"],
    ["data structures", "DSA"],
    ["algorithms", "DSA"],
    ["operating systems", "Operating Systems"],
    ["computer networks", "Computer Networks"],
    ["probability", "Probability"],
    ["statistics", "Statistics"],
    ["database", "DBMS"],
    ["dbms", "DBMS"],
    ["dsa", "DSA"],
    ["math", "Mathematics"],
    ["physics", "Physics"],
    ["chemistry", "Chemistry"],
    ["english", "English"],
    ["history", "History"],
    ["economics", "Economics"],
    ["ml", "Machine Learning"],
    ["ai", "AI"],
    ["os", "Operating Systems"],
    ["cn", "Computer Networks"],
  ];
  for (const [needle, subject] of aliases) {
    if (new RegExp(`\\b${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(lowered)) {
      return subject;
    }
  }

  let cleaned = title.replace(
    /^(?:please\s+)?(?:study|revise|review|finish|complete|read|practice|practise|prepare|write|solve|learn|work\s+on|do|make|submit|watch)\s+/i,
    "",
  );
  cleaned = cleaned.replace(/^(?:my|the|a|an)\s+/i, "");
  cleaned = cleaned
    .replace(/\b(?:assignment|homework|task|exam|test|notes?|reading|lab work)\b\s*$/i, "")
    .replace(/^[ .:-]+|[ .:-]+$/g, "");
  if (!cleaned) return "General";
  return cleaned
    .slice(0, 80)
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function cleanSegment(segment: string): string {
  let cleaned = segment.replace(/^[ \t\r\n\-*•.]+|[ \t\r\n\-*•.]+$/g, "");
  cleaned = cleaned.replace(
    /^(?:and\s+|then\s+|also\s+|please\s+|can you\s+|could you\s+|i want to\s+|i need to\s+|i have to\s+|help me\s+)/i,
    "",
  );
  cleaned = cleaned.replace(/^(?:tomorrow|today|tonight|next week)\b[,\s]*/i, "");
  cleaned = cleaned.replace(
    /\b(?:due|by|deadline|before|submit(?:ted)?(?:\s+by)?|on)\s+(?:tomorrow|today|tonight|next week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|20\d{2}-\d{2}-\d{2})\b/gi,
    "",
  );
  cleaned = cleaned.replace(/^(?:my|the)\s+/i, "");
  return cleaned.replace(/\s+/g, " ").replace(/^[ ,;]+|[ ,;]+$/g, "");
}

function titleFor(segment: string): string {
  let title = cleanSegment(segment).replace(/\bmy\s+/i, "");
  if (!title) return "";
  title = title.charAt(0).toUpperCase() + title.slice(1);
  return title.slice(0, 200);
}

function dedupeProposals(proposals: ProposedTask[]): ProposedTask[] {
  const seen = new Set<string>();
  const result: ProposedTask[] = [];
  for (const proposal of proposals) {
    const key = [
      proposal.title.toLowerCase(),
      proposal.subject.toLowerCase(),
      proposal.dueDate ?? "",
      proposal.plannedDate ?? "",
    ].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(proposal);
    }
  }
  return result;
}

export function extractNaturalLanguageTasks(
  message: string,
  today: string = localTodayISO(),
): ProposedTask[] {
  const text = message.trim();
  if (!text) return [];

  const globalDate = findDateExpression(text, today);
  const globalIsDue = Boolean(
    globalDate && segmentHasDuePhrase(text, globalDate.phrase),
  );

  let body = text.replace(
    /^(?:please\s+|can you\s+|could you\s+|help me\s+|i want to\s+|i need to\s+|i have to\s+)/i,
    "",
  );
  body = body.replace(/^(?:tomorrow|today|tonight|next week)\b[,\s]*/i, "");
  body = body.replace(/\b(?:due|by|deadline)\s+\S+/gi, "");

  const splitPattern =
    /[,;\n]+|\s+and\s+(?=(?:study|revise|review|finish|complete|read|practice|practise|prepare|write|solve|learn|work\s+on|do|make|submit|watch)\b)/i;
  const segments = body.split(splitPattern).filter((part) => part.trim());

  const proposals: ProposedTask[] = [];
  for (const segment of segments.slice(0, 20)) {
    const { minutes, cleaned } = durationMinutes(segment);
    const segmentDate = findDateExpression(segment, today);
    let dueDate: string | null = null;
    let plannedDate: string | null = null;

    if (segmentDate && segmentHasDuePhrase(segment, segmentDate.phrase)) {
      dueDate = segmentDate.date;
    } else if (globalIsDue && globalDate) {
      dueDate = globalDate.date;
    } else if (globalDate) {
      plannedDate = globalDate.date;
    } else if (segmentDate) {
      plannedDate = segmentDate.date;
    }

    const title = titleFor(cleaned);
    if (!title || title.length < 3) continue;
    if (/^(?:study|revise|review|plan|add|create|tasks?)$/i.test(title)) continue;
    if (/\b(?:study plan|a plan|my tasks|all tasks)\b/i.test(title)) continue;

    proposals.push({
      title,
      subject: subjectFor(title),
      dueDate,
      plannedDate,
      priority: "Medium",
      estimatedMinutes: minutes,
    });
  }

  return dedupeProposals(proposals);
}

function looksLikeListIntent(message: string): boolean {
  return (
    /\b(list|show|view|display)\b.*\b(tasks?|to-?dos?)\b/.test(message) ||
    /\b(my|all|pending|completed)\s+tasks?\b/.test(message) ||
    /\bwhat\s+(tasks?|do i have)\b/.test(message)
  );
}

function looksLikePlanIntent(message: string): boolean {
  return /\b(study plan|plan my (?:day|study|schedule)|make (?:me )?a plan|what should i study|schedule my|plan for)\b/.test(
    message,
  );
}

export function looksLikeAddIntent(message: string): boolean {
  return /\b(add|create|study|revise|review|finish|complete|read|practice|prepare|write|solve|learn|work on|assignment|homework|exam)\b/.test(
    message,
  );
}

function proposalToArgs(proposal: ProposedTask): Record<string, unknown> {
  return {
    title: proposal.title,
    subject: proposal.subject,
    due_date: proposal.dueDate,
    planned_date: proposal.plannedDate,
    priority: proposal.priority,
    estimated_minutes: proposal.estimatedMinutes,
  };
}

export interface FallbackOptions {
  today?: string;
  warning?: string;
}

export function localAgentReply(
  message: string,
  tasks: Task[],
  options: FallbackOptions = {},
): AgentResponse {
  const today = options.today ?? localTodayISO();
  const lower = message.toLowerCase().trim();
  const warning =
    options.warning ??
    "This reply came from the basic local rule-based fallback, not from an AI model.";

  const base: AgentResponse = {
    mode: "fallback",
    message: "",
    warning,
    providerError: null,
    model: "local-fallback",
    proposals: [],
    actions: [],
    toolEvents: [],
    plan: null,
  };

  const deleteMatch = /\b(?:delete|remove)\b[^\d#]{0,30}#?(\d+)\b/.exec(lower);
  if (deleteMatch) {
    const execution = executeAgentTool(
      "delete_task",
      { task_id: Number(deleteMatch[1]) },
      tasks,
      today,
    );
    return {
      ...base,
      message: execution.action
        ? `${execution.action.message} Confirm it below before anything is deleted.`
        : execution.event.message,
      actions: execution.action ? [execution.action] : [],
      toolEvents: [execution.event],
    };
  }

  const markMatch =
    /\b(?:mark|set)\s+(?:task\s*)?#?(\d+)\s+(?:as\s+)?(?:complete|completed|done)\b/.exec(lower) ??
    /\b(?:complete|finish|close)\s+(?:task\s*)?#?(\d+)\b/.exec(lower) ??
    /\btask\s*#?(\d+)\s+(?:is\s+)?(?:complete|completed|done)\b/.exec(lower);
  if (markMatch) {
    const execution = executeAgentTool(
      "mark_task_completed",
      { task_id: Number(markMatch[1]) },
      tasks,
      today,
    );
    return {
      ...base,
      message: execution.action
        ? `${execution.action.message} Approve it below to apply the change.`
        : execution.event.message,
      actions: execution.action ? [execution.action] : [],
      toolEvents: [execution.event],
    };
  }

  if (looksLikeListIntent(lower)) {
    let status: "all" | "pending" | "completed" = "pending";
    if (/\bcompleted\b|\bdone\b|\bfinished\b/.test(lower)) status = "completed";
    else if (/\ball\b|\beverything\b/.test(lower)) status = "all";
    const execution = executeAgentTool("list_tasks", { status }, tasks, today);
    const result = execution.event.result as { tasks?: Task[] } | undefined;
    return {
      ...base,
      message: formatTaskList(result?.tasks ?? [], status),
      toolEvents: [execution.event],
    };
  }

  if (looksLikePlanIntent(lower)) {
    const dateMatch = findDateExpression(lower, today);
    const planDate = dateMatch?.date ?? today;
    const execution = executeAgentTool("get_study_plan", { date: planDate }, tasks, today);
    return {
      ...base,
      message: execution.event.message,
      toolEvents: [execution.event],
      plan: execution.plan ?? null,
    };
  }

  const proposals = extractNaturalLanguageTasks(message, today);
  if (proposals.length > 0) {
    const events: ToolEvent[] = [];
    const prepared: ProposedTask[] = [];
    for (const proposal of proposals) {
      const execution = executeAgentTool("add_task", proposalToArgs(proposal), tasks, today);
      events.push(execution.event);
      if (execution.proposal) prepared.push(execution.proposal);
    }
    return {
      ...base,
      message: `I prepared ${prepared.length} task proposal(s) using the local rule parser. Review and edit them below, then save the ones you approve. Nothing has been saved yet.`,
      proposals: prepared,
      toolEvents: events,
    };
  }

  if (looksLikeAddIntent(lower)) {
    return {
      ...base,
      message:
        "I could not confidently turn that into a task. Please include the task title, subject, and any date or duration you know. For example: \"Tomorrow, revise DSA for two hours.\"",
    };
  }

  return {
    ...base,
    message:
      "I can help you add study tasks, list saved tasks, complete a task, request a deletion, or build a study plan. Try: \"Tomorrow I want to study DSA for two hours, revise probability, and finish my AI lab assignment.\"",
  };
}
