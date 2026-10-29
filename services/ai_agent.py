"""Gemini-powered study agent with a clearly labelled local fallback.

Gemini is used through the official ``google-genai`` SDK and native function
calling. Python functions are chosen by the model but always executed by the
validated ``TaskToolbox`` allowlist. The local fallback is deterministic and is
never presented as an AI response.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Optional

from dotenv import load_dotenv

from services.database import PROJECT_ROOT, Database
from services.task_tools import (
    TaskToolbox,
    ToolResult,
    agent_function_declarations,
)

load_dotenv(PROJECT_ROOT / ".env", override=False)

DEFAULT_MODEL = "gemini-3.8-flash"
MAX_MESSAGE_LENGTH = 4000
MAX_TOOL_ROUNDS = 4
WEEKDAYS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}
WORD_NUMBERS = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
}


class AgentError(RuntimeError):
    """Base error for the agent layer."""


class AgentProviderError(AgentError):
    """Raised when the configured AI provider cannot answer."""


@dataclass
class AgentReply:
    message: str
    mode: str
    proposed_tasks: list[dict[str, Any]] = field(default_factory=list)
    tool_events: list[dict[str, Any]] = field(default_factory=list)
    warning: Optional[str] = None
    plan: Optional[dict[str, Any]] = None
    provider_error: Optional[str] = None

    @property
    def is_ai(self) -> bool:
        return self.mode == "gemini"


class AIStudyAgent:
    def __init__(
        self,
        database: Database,
        toolbox: Optional[TaskToolbox] = None,
        *,
        api_key: Optional[str] = None,
        model: Optional[str] = None,
        client: Any = None,
    ) -> None:
        self.db = database
        self.toolbox = toolbox or TaskToolbox(database)
        env_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        self.api_key = (api_key if api_key is not None else env_key) or ""
        self.model = (
            model
            or os.getenv("GEMINI_MODEL")
            or DEFAULT_MODEL
        ).strip()
        self._client = client
        self.last_error: Optional[str] = None

    @property
    def configured(self) -> bool:
        return bool(self._client is not None or self.api_key.strip())

    def provider_status(self) -> dict[str, Any]:
        return {
            "configured": self.configured,
            "provider": "Google Gemini",
            "model": self.model,
            "sdk": "google-genai",
            "mode": "Gemini function calling" if self.configured else "Local fallback",
            "last_error": self.last_error,
        }

    def analyze(
        self,
        message: str,
        history: Optional[list[dict[str, Any]]] = None,
    ) -> AgentReply:
        if not isinstance(message, str):
            raise AgentError("Message must be text.")
        cleaned = message.strip()
        if not cleaned:
            raise AgentError("Please type a study instruction first.")
        if len(cleaned) > MAX_MESSAGE_LENGTH:
            raise AgentError(
                f"Please keep a message under {MAX_MESSAGE_LENGTH} characters."
            )

        if not self.configured:
            return self._local_reply(
                cleaned,
                warning=(
                    "No Gemini API key is configured. This reply came from the "
                    "basic local fallback, not from an AI model."
                ),
            )

        try:
            reply = self._analyze_with_gemini(cleaned, history or [])
            self.last_error = None
            return reply
        except Exception as exc:  # provider/network/response-shape failures
            provider_error = self._describe_error(exc)
            self.last_error = provider_error
            fallback = self._local_reply(
                cleaned,
                warning=(
                    "Gemini was unavailable, so the labelled local fallback was used. "
                    f"{provider_error}"
                ),
            )
            fallback.provider_error = provider_error
            return fallback

    def test_connection(self) -> tuple[bool, str]:
        if not self.configured:
            return (
                False,
                "No Gemini API key is configured. Add GEMINI_API_KEY to .env and reload.",
            )
        try:
            client = self._get_client()
            response = client.models.generate_content(
                model=self.model,
                contents="Reply with exactly the word OK.",
            )
            text = _response_text(response)
            if not text:
                return False, "Gemini responded, but no text was returned."
            self.last_error = None
            return True, f"Connected to {self.model}. Gemini replied successfully."
        except Exception as exc:
            message = self._describe_error(exc)
            self.last_error = message
            return False, message

    def _get_client(self) -> Any:
        if self._client is not None:
            return self._client
        try:
            from google import genai
        except ImportError as exc:
            raise AgentProviderError(
                "The google-genai package is not installed. Run "
                "python -m pip install -r requirements.txt."
            ) from exc
        self._client = genai.Client(api_key=self.api_key)
        return self._client

    def _system_prompt(self) -> str:
        today = date.today().isoformat()
        return f"""You are a careful personal study-planning agent for a college student.
Today is {today}.

You have these tools: propose_tasks, list_tasks, mark_task_completed, get_study_plan.
Tool execution happens in trusted Python code. Never claim a tool ran unless a tool
result confirms it.

Rules:
1. For requests to add, plan, or revise tasks, call propose_tasks once with every
   requested task. Afterwards, tell the student the tasks are proposals awaiting
   confirmation. Never say they were saved.
2. For listing tasks, completing a task, or building a study plan, call the matching
   read/update tool. Use real numeric task IDs from tool results only.
3. Do not invent deadlines, durations, priorities, subjects, or task IDs.
   - Use due_date only for a stated deadline.
   - Use planned_date for a stated study day, such as "tomorrow".
   - Use estimated_minutes only when a duration was stated.
   - Default priority to Medium. Use High only when the student signals urgency.
4. Resolve relative dates from today's date. Use YYYY-MM-DD.
5. You cannot delete tasks. If asked, tell the student deletion must be confirmed on
   the My Tasks page.
6. Never request access to files, environment variables, shell commands, or code.
   Stay within the study-planning tools.
7. Be concise, friendly, and honest. If a request is ambiguous, ask one short
   clarification instead of guessing.
8. When a tool returns an error, explain it simply and do not pretend it succeeded.
"""

    def _analyze_with_gemini(
        self,
        message: str,
        history: list[dict[str, Any]],
    ) -> AgentReply:
        from google.genai import types

        client = self._get_client()
        declarations = [
            types.FunctionDeclaration(
                name=declaration["name"],
                description=declaration["description"],
                parameters_json_schema=declaration["parameters"],
            )
            for declaration in agent_function_declarations()
        ]
        config = types.GenerateContentConfig(
            system_instruction=self._system_prompt(),
            tools=[types.Tool(function_declarations=declarations)],
        )

        contents: list[Any] = []
        for item in history[-8:]:
            if not isinstance(item, dict):
                continue
            role = "user" if item.get("role") == "user" else "model"
            content = str(item.get("content", "")).strip()
            if content:
                contents.append(
                    types.Content(
                        role=role,
                        parts=[types.Part.from_text(text=content[:2000])],
                    )
                )
        contents.append(
            types.Content(role="user", parts=[types.Part.from_text(text=message)])
        )

        events: list[dict[str, Any]] = []
        proposals: list[dict[str, Any]] = []
        final_text = ""
        plan: Optional[dict[str, Any]] = None

        for _ in range(MAX_TOOL_ROUNDS):
            response = client.models.generate_content(
                model=self.model,
                contents=contents,
                config=config,
            )
            calls = list(_function_calls(response))
            if not calls:
                final_text = _response_text(response)
                break

            model_content = _first_content(response)
            if model_content is not None:
                contents.append(model_content)

            response_parts = []
            for call in calls:
                name = getattr(call, "name", "") or ""
                raw_args = getattr(call, "args", None) or {}
                call_id = getattr(call, "id", None)
                if not isinstance(raw_args, dict):
                    result = ToolResult(
                        tool=name,
                        args={},
                        ok=False,
                        message="Tool arguments must be an object.",
                        error="Invalid tool arguments.",
                    )
                else:
                    result = self.toolbox.execute_agent_tool(name, raw_args)

                event = {
                    "tool": name,
                    "args": _json_safe(raw_args),
                    "ok": result.ok,
                    "message": result.message,
                    "result": _json_safe(result.data),
                }
                events.append(event)

                if name == "propose_tasks" and result.ok and isinstance(result.data, dict):
                    proposals = _merge_proposals(
                        proposals, result.data.get("tasks", [])
                    )
                if name == "get_study_plan" and result.ok and isinstance(result.data, dict):
                    plan = result.data

                response_payload = {
                    "ok": result.ok,
                    "message": result.message,
                    "result": _json_safe(result.data),
                }
                function_response_kwargs: dict[str, Any] = {
                    "name": name,
                    "response": response_payload,
                }
                if call_id:
                    function_response_kwargs["id"] = call_id
                response_parts.append(
                    types.Part(
                        function_response=types.FunctionResponse(
                            **function_response_kwargs
                        )
                    )
                )
            if not response_parts:
                raise AgentProviderError("Gemini requested an invalid empty tool call.")
            contents.append(types.Content(role="user", parts=response_parts))

        if not final_text:
            final_text = self._summarize_events(events, proposals)

        if not events and _looks_like_add_intent(message) and not proposals:
            local = self._local_reply(message)
            if local.proposed_tasks:
                return AgentReply(
                    message=(
                        f"{final_text or 'Gemini returned no summary.'}\n\n"
                        "Gemini did not request a task-proposal tool call, so the "
                        "labelled local rule parser prepared this proposal instead. "
                        "Nothing has been saved."
                    ),
                    mode="gemini",
                    proposed_tasks=local.proposed_tasks,
                    tool_events=events + local.tool_events,
                    warning=(
                        "The model reply was kept, but the task extraction came from "
                        "the local fallback parser."
                    ),
                    plan=plan,
                )

        if not final_text:
            raise AgentProviderError("Gemini returned an empty response.")

        return AgentReply(
            message=final_text.strip(),
            mode="gemini",
            proposed_tasks=proposals,
            tool_events=events,
            plan=plan,
        )

    def _summarize_events(
        self,
        events: list[dict[str, Any]],
        proposals: list[dict[str, Any]],
    ) -> str:
        if proposals:
            return (
                f"I prepared {len(proposals)} task proposal(s). Review the details "
                "below, edit anything you need, and save them when ready. Nothing "
                "has been saved yet."
            )
        if events:
            last = events[-1]
            return f"Tool {last['tool']} finished: {last['message']}"
        return "I could not complete that request. Please rephrase it."

    def _local_reply(self, message: str, warning: Optional[str] = None) -> AgentReply:
        today = date.today()
        lower = message.lower().strip()

        delete_match = re.search(
            r"\b(?:delete|remove)\b(?:[^\d#]{0,30})#?(\d+)\b", lower
        )
        if delete_match:
            task_id = delete_match.group(1)
            return AgentReply(
                message=(
                    f"For safety, deletion is not performed from chat. Open My Tasks, "
                    f"find task #{task_id}, and use the Delete confirmation control."
                ),
                mode="fallback",
                warning=warning,
            )

        mark_match = (
            re.search(
                r"\b(?:mark|set)\s+(?:task\s*)?#?(\d+)\s+(?:as\s+)?"
                r"(?:complete|completed|done)\b",
                lower,
            )
            or re.search(
                r"\b(?:complete|finish|close)\s+(?:task\s*)?#?(\d+)\b", lower
            )
            or re.search(
                r"\btask\s*#?(\d+)\s+(?:is\s+)?(?:complete|completed|done)\b",
                lower,
            )
        )
        if mark_match:
            result = self.toolbox.execute_agent_tool(
                "mark_task_completed", {"task_id": int(mark_match.group(1))}
            )
            text = result.message
            if result.ok and isinstance(result.data, dict):
                text = (
                    f"Done. Task #{result.data['id']} '{result.data['title']}' "
                    "is marked completed."
                )
            return AgentReply(
                message=text,
                mode="fallback",
                tool_events=[_event_from_result(result)],
                warning=warning,
            )

        if _looks_like_list_intent(lower):
            status = "pending"
            if re.search(r"\bcompleted\b|\bdone\b|\bfinished\b", lower):
                status = "completed"
            elif re.search(r"\ball\b|\beverything\b", lower):
                status = "all"
            result = self.toolbox.execute_agent_tool(
                "list_tasks", {"status": status}
            )
            tasks = (result.data or {}).get("tasks", []) if result.ok else []
            return AgentReply(
                message=_format_task_list(tasks, status),
                mode="fallback",
                tool_events=[_event_from_result(result)],
                warning=warning,
            )

        proposals = extract_natural_language_tasks(message, today)
        if proposals:
            result = self.toolbox.execute_agent_tool(
                "propose_tasks", {"tasks": proposals}
            )
            prepared = (
                result.data.get("tasks", [])
                if result.ok and isinstance(result.data, dict)
                else []
            )
            if result.ok:
                text = (
                    f"I prepared {len(prepared)} task proposal(s) using the local rule "
                    "parser. Review and edit them below, then click Save confirmed "
                    "tasks. Nothing has been saved yet."
                )
            else:
                text = f"I could not prepare those tasks: {result.message}"
            return AgentReply(
                message=text,
                mode="fallback",
                proposed_tasks=prepared,
                tool_events=[_event_from_result(result)],
                warning=warning,
            )

        if _looks_like_plan_intent(lower):
            plan_date = find_date_expression(lower, today)
            selected = plan_date[0] if plan_date else today.isoformat()
            result = self.toolbox.execute_agent_tool(
                "get_study_plan", {"date": selected}
            )
            return AgentReply(
                message=result.message,
                mode="fallback",
                tool_events=[_event_from_result(result)],
                warning=warning,
                plan=result.data if result.ok else None,
            )

        return AgentReply(
            message=(
                "I can help you add study tasks, list saved tasks, complete a task, "
                "or build a study plan. Try: \"Tomorrow I want to study DSA for two "
                "hours, revise probability, and finish my AI lab assignment.\""
            ),
            mode="fallback",
            warning=warning,
        )

    def _describe_error(self, exc: Exception) -> str:
        raw = str(exc).strip()
        status = getattr(exc, "code", None) or getattr(exc, "status_code", None)
        status_text = str(status).upper() if status is not None else ""
        if self.api_key:
            raw = raw.replace(self.api_key, "[redacted]")
        raw = raw[:300]

        lower_raw = raw.lower()
        if (
            "429" in status_text
            or "RESOURCE_EXHAUSTED" in raw.upper()
            or "rate limit" in lower_raw
            or "rate-limit" in lower_raw
            or "quota" in lower_raw
        ):
            return (
                "Gemini rate limit reached (HTTP 429). Free-tier quotas are limited "
                "and not guaranteed. Wait a minute and try again, or check your quota "
                "in Google AI Studio."
            )
        if "401" in status_text or "403" in status_text or "API key" in raw:
            return (
                "Gemini rejected the API key or the project does not have access "
                "(HTTP 401/403). Check GEMINI_API_KEY in .env."
            )
        if "404" in status_text or "not found" in raw.lower():
            return (
                f"Gemini model '{self.model}' was not available for this key. "
                "Set GEMINI_MODEL in .env to a model available in your AI Studio project."
            )
        if "timeout" in raw.lower() or "connect" in raw.lower():
            return (
                "Could not reach the Gemini API. Check your internet connection and "
                "try again."
            )
        if isinstance(exc, AgentProviderError):
            return raw
        return f"Gemini request failed: {raw or exc.__class__.__name__}"


def _event_from_result(result: ToolResult) -> dict[str, Any]:
    return {
        "tool": result.tool,
        "args": _json_safe(result.args),
        "ok": result.ok,
        "message": result.message,
        "result": _json_safe(result.data),
    }


def _format_task_list(tasks: Iterable[dict[str, Any]], status: str) -> str:
    tasks = list(tasks)
    if not tasks:
        return f"No {status} tasks were found."
    lines = [f"Here are your {status} tasks:"]
    for task in tasks:
        bits = [f"#{task['id']} {task['title']}", f"subject: {task['subject']}"]
        bits.append(f"priority: {task['priority']}")
        if task.get("due_date"):
            bits.append(f"due: {task['due_date']}")
        if task.get("planned_date"):
            bits.append(f"planned: {task['planned_date']}")
        if task.get("estimated_minutes"):
            bits.append(f"{task['estimated_minutes']} min")
        bits.append(task["status"])
        lines.append("- " + " | ".join(bits))
    return "\n".join(lines)


def _function_calls(response: Any) -> list[Any]:
    calls = getattr(response, "function_calls", None)
    if calls:
        return list(calls)
    found: list[Any] = []
    for candidate in getattr(response, "candidates", None) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            call = getattr(part, "function_call", None)
            if call is not None:
                found.append(call)
    return found


def _first_content(response: Any) -> Any:
    for candidate in getattr(response, "candidates", None) or []:
        content = getattr(candidate, "content", None)
        if content is not None:
            return content
    return None


def _response_text(response: Any) -> str:
    pieces: list[str] = []
    for candidate in getattr(response, "candidates", None) or []:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            text = getattr(part, "text", None)
            if text:
                pieces.append(text)
    if pieces:
        return "\n".join(pieces).strip()
    try:
        return (getattr(response, "text", None) or "").strip()
    except Exception:
        return ""


def _json_safe(value: Any) -> Any:
    try:
        return json.loads(json.dumps(value, default=str))
    except (TypeError, ValueError):
        return str(value)


def _merge_proposals(
    existing: list[dict[str, Any]], new_tasks: Iterable[dict[str, Any]]
) -> list[dict[str, Any]]:
    merged = list(existing)
    seen = {
        (
            item.get("title", "").lower(),
            item.get("subject", "").lower(),
            item.get("due_date"),
            item.get("planned_date"),
        )
        for item in merged
    }
    for task in new_tasks:
        key = (
            str(task.get("title", "")).lower(),
            str(task.get("subject", "")).lower(),
            task.get("due_date"),
            task.get("planned_date"),
        )
        if key not in seen:
            merged.append(task)
            seen.add(key)
    return merged[:20]


def _looks_like_list_intent(message: str) -> bool:
    return bool(
        re.search(r"\b(list|show|view|display)\b.*\b(tasks?|to-?dos?)\b", message)
        or re.search(r"\b(my|all|pending|completed)\s+tasks?\b", message)
        or re.search(r"\bwhat\s+(tasks?|do i have)\b", message)
    )


def _looks_like_plan_intent(message: str) -> bool:
    return bool(
        re.search(
            r"\b(study plan|plan my (?:day|study|schedule)|make (?:me )?a plan|"
            r"what should i study|schedule my|plan for)\b",
            message,
        )
    )


def _looks_like_add_intent(message: str) -> bool:
    return bool(
        re.search(
            r"\b(add|create|study|revise|review|finish|complete|read|practice|"
            r"prepare|write|solve|learn|work on|assignment|homework|exam)\b",
            message,
        )
    )


def find_date_expression(text: str, today: Optional[date] = None) -> Optional[tuple[str, str]]:
    """Return (ISO date, matched phrase) for common natural-language dates."""

    current = today or date.today()
    lower = text.lower()

    iso_match = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", lower)
    if iso_match:
        try:
            parsed = date.fromisoformat(iso_match.group(1))
            return parsed.isoformat(), iso_match.group(0)
        except ValueError:
            pass

    if re.search(r"\bday after tomorrow\b", lower):
        return (current + timedelta(days=2)).isoformat(), "day after tomorrow"
    if re.search(r"\btomorrow\b", lower):
        return (current + timedelta(days=1)).isoformat(), "tomorrow"
    if re.search(r"\b(today|tonight)\b", lower):
        return current.isoformat(), "today"

    in_days = re.search(r"\bin\s+(\d{1,3})\s+days?\b", lower)
    if in_days:
        days = min(int(in_days.group(1)), 365)
        return (current + timedelta(days=days)).isoformat(), in_days.group(0)

    if re.search(r"\bnext week\b", lower):
        return (current + timedelta(days=7)).isoformat(), "next week"

    weekday_match = re.search(
        r"\b(?:(next|this)\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
        lower,
    )
    if weekday_match:
        target = WEEKDAYS[weekday_match.group(2)]
        days_ahead = (target - current.weekday()) % 7
        modifier = weekday_match.group(1)
        if days_ahead == 0:
            days_ahead = 7
        elif modifier == "next" and days_ahead < 7:
            days_ahead += 0
        return (
            (current + timedelta(days=days_ahead)).isoformat(),
            weekday_match.group(0),
        )

    month_match = re.search(
        r"\b(january|february|march|april|may|june|july|august|september|"
        r"october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b",
        lower,
    )
    if month_match:
        try:
            parsed = datetime.strptime(
                f"{month_match.group(1)} {month_match.group(2)} {current.year}",
                "%B %d %Y",
            ).date()
            if parsed < current:
                parsed = parsed.replace(year=current.year + 1)
            return parsed.isoformat(), month_match.group(0)
        except ValueError:
            pass

    return None


def _duration_minutes(segment: str) -> tuple[Optional[int], str]:
    word_pattern = "|".join(WORD_NUMBERS)
    match = re.search(
        rf"\b(?:for\s+)?(\d+(?:\.\d+)?|an?|half\s+an?|{word_pattern})\s*"
        r"(hours?|hrs?|h|minutes?|mins?|m)\b",
        segment,
        re.IGNORECASE,
    )
    if not match:
        return None, segment
    raw_amount = match.group(1).lower()
    unit = match.group(2).lower()
    if raw_amount in ("a", "an"):
        amount = 1.0
    elif raw_amount.startswith("half"):
        amount = 0.5
    elif raw_amount in WORD_NUMBERS:
        amount = float(WORD_NUMBERS[raw_amount])
    else:
        amount = float(raw_amount)
    minutes = int(round(amount * 60)) if unit.startswith("h") else int(round(amount))
    if minutes < 5 or minutes > 1440:
        minutes = None
    cleaned = (segment[: match.start()] + " " + segment[match.end() :]).strip()
    cleaned = re.sub(r"\bfor\s*$", "", cleaned, flags=re.IGNORECASE).strip()
    return minutes, cleaned


def _subject_for(title: str) -> str:
    lowered = title.lower()
    aliases = [
        ("ai lab", "AI Lab"),
        ("machine learning", "Machine Learning"),
        ("artificial intelligence", "AI"),
        ("data structures", "DSA"),
        ("algorithms", "DSA"),
        ("operating systems", "Operating Systems"),
        ("computer networks", "Computer Networks"),
        ("probability", "Probability"),
        ("statistics", "Statistics"),
        ("database", "DBMS"),
        ("dbms", "DBMS"),
        ("dsa", "DSA"),
        ("math", "Mathematics"),
        ("physics", "Physics"),
        ("chemistry", "Chemistry"),
        ("english", "English"),
        ("history", "History"),
        ("economics", "Economics"),
        ("ml", "Machine Learning"),
        ("ai", "AI"),
        ("os", "Operating Systems"),
        ("cn", "Computer Networks"),
    ]
    for needle, subject in aliases:
        if re.search(rf"\b{re.escape(needle)}\b", lowered):
            return subject

    cleaned = re.sub(
        r"^(?:please\s+)?(?:study|revise|review|finish|complete|read|practice|"
        r"practise|prepare|write|solve|learn|work\s+on|do|make|submit|watch)\s+",
        "",
        title,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"^(?:my|the|a|an)\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(
        r"\b(?:assignment|homework|task|exam|test|notes?|reading|lab work)\b\s*$",
        "",
        cleaned,
        flags=re.IGNORECASE,
    ).strip(" .:-")
    if not cleaned:
        return "General"
    return cleaned[:80].title()


def _clean_segment(segment: str) -> str:
    cleaned = segment.strip(" \t\r\n-*•.")
    cleaned = re.sub(
        r"^(?:and\s+|then\s+|also\s+|please\s+|can you\s+|could you\s+|"
        r"i want to\s+|i need to\s+|i have to\s+|help me\s+)",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"^(?:tomorrow|today|tonight|next week)\b[,\s]*", "", cleaned, flags=re.IGNORECASE
    )
    cleaned = re.sub(
        r"\b(?:due|by|deadline|before|submit(?:ted)?(?:\s+by)?|on)\s+"
        r"(?:tomorrow|today|tonight|next week|"
        r"monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
        r"20\d{2}-\d{2}-\d{2})\b",
        "",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(r"^(?:my|the)\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = " ".join(cleaned.split()).strip(" ,;")
    return cleaned


def _title_for(segment: str) -> str:
    title = _clean_segment(segment)
    title = re.sub(r"\bmy\s+", "", title, count=1, flags=re.IGNORECASE)
    if not title:
        return ""
    title = title[0].upper() + title[1:]
    return title[:200]


def _segment_has_due_phrase(segment: str, matched_phrase: str) -> bool:
    lower = segment.lower()
    phrase = matched_phrase.lower()
    index = lower.find(phrase)
    if index == -1:
        return False
    prefix = lower[max(0, index - 16) : index]
    return bool(re.search(r"\b(due|by|deadline|before|submit)\b", prefix))


def extract_natural_language_tasks(
    message: str, today: Optional[date] = None
) -> list[dict[str, Any]]:
    """Rule-based extraction used only by the clearly labelled local fallback."""

    current = today or date.today()
    text = message.strip()
    if not text:
        return []

    global_date = find_date_expression(text, current)
    global_is_due = bool(
        global_date and _segment_has_due_phrase(text, global_date[1])
    )

    body = re.sub(
        r"^(?:please\s+|can you\s+|could you\s+|help me\s+|i want to\s+|"
        r"i need to\s+|i have to\s+)",
        "",
        text,
        flags=re.IGNORECASE,
    )
    body = re.sub(
        r"^(?:tomorrow|today|tonight|next week)\b[,\s]*",
        "",
        body,
        flags=re.IGNORECASE,
    )
    body = re.sub(r"\b(?:due|by|deadline)\s+\S+", "", body, flags=re.IGNORECASE)

    split_pattern = (
        r"[,;\n]+"
        r"|\s+and\s+(?=(?:study|revise|review|finish|complete|read|practice|"
        r"practise|prepare|write|solve|learn|work\s+on|do|make|submit|watch)\b)"
    )
    segments = [part for part in re.split(split_pattern, body, flags=re.IGNORECASE) if part.strip()]

    proposals: list[dict[str, Any]] = []
    for segment in segments[:20]:
        minutes, segment_without_duration = _duration_minutes(segment)
        segment_date = find_date_expression(segment, current)
        due_date = None
        planned_date = None

        if segment_date and _segment_has_due_phrase(segment, segment_date[1]):
            due_date = segment_date[0]
        elif global_is_due and global_date:
            due_date = global_date[0]
        elif global_date:
            planned_date = global_date[0]
        elif segment_date:
            planned_date = segment_date[0]

        title = _title_for(segment_without_duration)
        if not title or len(title) < 3:
            continue
        if re.fullmatch(r"(?:study|revise|review|plan|add|create|tasks?)", title, re.IGNORECASE):
            continue
        if re.search(r"\b(?:study plan|a plan|my tasks|all tasks)\b", title, re.IGNORECASE):
            continue

        subject = _subject_for(title)
        proposals.append(
            {
                "title": title,
                "subject": subject,
                "due_date": due_date,
                "planned_date": planned_date,
                "priority": "Medium",
                "estimated_minutes": minutes,
            }
        )

    deduped: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for proposal in proposals:
        key = (
            proposal["title"].lower(),
            proposal["subject"].lower(),
            proposal["due_date"],
            proposal["planned_date"],
        )
        if key not in seen:
            deduped.append(proposal)
            seen.add(key)
    return deduped
