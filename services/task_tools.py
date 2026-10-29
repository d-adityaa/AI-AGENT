"""Validated, allowlisted study-task tools.

The Gemini model never executes Python. It can only request one of the tools in
``AGENT_TOOL_NAMES``. Arguments are validated here and dispatched to ordinary
Python functions. ``add_task`` is intentionally unavailable to the model so a
task cannot be persisted before the user confirms the proposal. ``delete_task``
requires an explicit confirmation flag and is also unavailable to the model.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any, Optional

from services.database import (
    MAX_SUBJECT_LENGTH,
    Database,
    DatabaseError,
    TaskNotFoundError,
    ValidationError,
    clean_text,
    normalize_date,
    normalize_minutes,
    normalize_priority,
    normalize_status,
    normalize_task_id,
)
from services.study_planner import build_study_plan, format_plan_text

AGENT_TOOL_NAMES = (
    "propose_tasks",
    "list_tasks",
    "mark_task_completed",
    "get_study_plan",
)
UI_TOOL_NAMES = ("add_task", "delete_task")
ALL_TOOL_NAMES = AGENT_TOOL_NAMES + UI_TOOL_NAMES

PROPOSE_FIELDS = {
    "title",
    "subject",
    "due_date",
    "planned_date",
    "priority",
    "estimated_minutes",
}
LIST_FIELDS = {"status", "subject"}
MARK_FIELDS = {"task_id"}
PLAN_FIELDS = {"date"}
DELETE_FIELDS = {"task_id", "confirmed"}

MAX_PROPOSED_TASKS = 20


@dataclass
class ToolResult:
    tool: str
    args: dict[str, Any]
    ok: bool
    message: str
    data: Any = None
    error: Optional[str] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "tool": self.tool,
            "args": self.args,
            "ok": self.ok,
            "message": self.message,
            "data": self.data,
            "error": self.error,
        }


def _check_keys(params: dict[str, Any], allowed: set[str], tool: str) -> None:
    unexpected = sorted(set(params) - allowed)
    if unexpected:
        raise ValidationError(
            f"Unexpected parameter(s) for {tool}: {', '.join(unexpected)}."
        )


def normalize_proposal(params: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(params, dict):
        raise ValidationError("Each proposed task must be an object.")
    _check_keys(params, PROPOSE_FIELDS, "propose_tasks")
    return {
        "title": clean_text(params.get("title"), "Title", max_length=200),
        "subject": clean_text(
            params.get("subject"), "Subject", max_length=MAX_SUBJECT_LENGTH
        ),
        "due_date": normalize_date(params.get("due_date"), "Due date"),
        "planned_date": normalize_date(params.get("planned_date"), "Planned date"),
        "priority": normalize_priority(params.get("priority")),
        "estimated_minutes": normalize_minutes(params.get("estimated_minutes")),
    }


def agent_function_declarations() -> list[dict[str, Any]]:
    """JSON schemas handed to Gemini's native function-calling interface."""

    task_schema = {
        "type": "object",
        "properties": {
            "title": {
                "type": "string",
                "description": "Short action-oriented task title.",
            },
            "subject": {
                "type": "string",
                "description": "Course or topic, for example DSA or Probability.",
            },
            "due_date": {
                "type": "string",
                "description": "Deadline in YYYY-MM-DD format. Omit if not stated.",
            },
            "planned_date": {
                "type": "string",
                "description": "Day the student wants to work on it, YYYY-MM-DD. Omit if not stated.",
            },
            "priority": {
                "type": "string",
                "enum": ["Low", "Medium", "High"],
                "description": "Use High only when the student signals urgency.",
            },
            "estimated_minutes": {
                "type": "integer",
                "description": "Only when the student stated a duration, in minutes.",
            },
        },
        "required": ["title", "subject"],
        "additionalProperties": False,
    }
    return [
        {
            "name": "propose_tasks",
            "description": (
                "Propose one or more study tasks for user review. This validates and "
                "previews the tasks but does NOT save them. Never claim they were saved."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "tasks": {
                        "type": "array",
                        "items": task_schema,
                        "minItems": 1,
                        "maxItems": MAX_PROPOSED_TASKS,
                    }
                },
                "required": ["tasks"],
                "additionalProperties": False,
            },
        },
        {
            "name": "list_tasks",
            "description": "Read saved study tasks from the SQLite database.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "enum": ["all", "pending", "completed"],
                    },
                    "subject": {
                        "type": "string",
                        "description": "Optional exact subject filter.",
                    },
                },
                "additionalProperties": False,
            },
        },
        {
            "name": "mark_task_completed",
            "description": "Mark one existing saved task as completed by its numeric ID.",
            "parameters": {
                "type": "object",
                "properties": {
                    "task_id": {"type": "integer", "minimum": 1},
                },
                "required": ["task_id"],
                "additionalProperties": False,
            },
        },
        {
            "name": "get_study_plan",
            "description": (
                "Build a time-blocked study plan for a date from saved pending tasks. "
                "This reads the database and does not save or modify anything."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "date": {
                        "type": "string",
                        "description": "Plan date in YYYY-MM-DD format.",
                    }
                },
                "required": ["date"],
                "additionalProperties": False,
            },
        },
    ]


class TaskToolbox:
    """Strict tool dispatcher shared by the UI and the AI agent."""

    def __init__(self, database: Database) -> None:
        self.db = database

    def execute(self, tool: str, params: Optional[dict[str, Any]] = None) -> ToolResult:
        if not isinstance(tool, str) or tool not in ALL_TOOL_NAMES:
            return ToolResult(
                tool=str(tool),
                args={},
                ok=False,
                message="Unknown or disallowed tool.",
                error="Unknown or disallowed tool.",
            )
        if params is None:
            params = {}
        if not isinstance(params, dict):
            return ToolResult(
                tool=tool,
                args={},
                ok=False,
                message="Tool parameters must be an object.",
                error="Tool parameters must be an object.",
            )
        try:
            if tool == "add_task":
                return self._add_task(params)
            if tool == "delete_task":
                return self._delete_task(params)
            if tool == "list_tasks":
                return self._list_tasks(params)
            if tool == "mark_task_completed":
                return self._mark_task_completed(params)
            if tool == "get_study_plan":
                return self._get_study_plan(params)
            if tool == "propose_tasks":
                return self._propose_tasks(params)
        except (ValidationError, TaskNotFoundError) as exc:
            return ToolResult(
                tool=tool,
                args=params,
                ok=False,
                message=str(exc),
                error=str(exc),
            )
        except DatabaseError as exc:
            return ToolResult(
                tool=tool,
                args=params,
                ok=False,
                message=str(exc),
                error=str(exc),
            )
        except Exception:
            return ToolResult(
                tool=tool,
                args=params,
                ok=False,
                message="The tool could not complete this request.",
                error="Unexpected tool failure.",
            )
        return ToolResult(
            tool=tool,
            args=params,
            ok=False,
            message="Unknown or disallowed tool.",
            error="Unknown or disallowed tool.",
        )

    def execute_agent_tool(self, tool: str, params: Optional[dict[str, Any]] = None) -> ToolResult:
        """Model-facing entry point. Add/delete are deliberately not reachable."""

        if tool not in AGENT_TOOL_NAMES:
            return ToolResult(
                tool=str(tool),
                args=params if isinstance(params, dict) else {},
                ok=False,
                message=(
                    f"Tool '{tool}' is not available to the AI agent. "
                    "Tasks are added only after user confirmation, and deletion "
                    "requires confirmation in My Tasks."
                ),
                error="Tool not allowed for AI agent.",
            )
        return self.execute(tool, params)

    def _add_task(self, params: dict[str, Any]) -> ToolResult:
        _check_keys(
            params,
            {"title", "subject", "due_date", "planned_date", "priority", "estimated_minutes"},
            "add_task",
        )
        task = self.db.add_task(
            title=params.get("title"),
            subject=params.get("subject"),
            due_date=params.get("due_date"),
            planned_date=params.get("planned_date"),
            priority=params.get("priority", "Medium"),
            estimated_minutes=params.get("estimated_minutes"),
        )
        return ToolResult(
            tool="add_task",
            args=params,
            ok=True,
            message=f"Saved task #{task['id']}: {task['title']}.",
            data=task,
        )

    def _delete_task(self, params: dict[str, Any]) -> ToolResult:
        _check_keys(params, DELETE_FIELDS, "delete_task")
        if params.get("confirmed") is not True:
            return ToolResult(
                tool="delete_task",
                args=params,
                ok=False,
                message="Deletion cancelled. Explicit confirmation is required.",
                error="confirmation_required",
                data={"deleted": False},
            )
        deleted = self.db.delete_task(params.get("task_id"))
        return ToolResult(
            tool="delete_task",
            args=params,
            ok=True,
            message=f"Deleted task #{deleted['id']}: {deleted['title']}.",
            data={"deleted": True, "task": deleted},
        )

    def _list_tasks(self, params: dict[str, Any]) -> ToolResult:
        _check_keys(params, LIST_FIELDS, "list_tasks")
        status = normalize_status(params.get("status", "all"))
        subject = params.get("subject")
        if subject is not None:
            subject = clean_text(
                subject, "Subject filter", max_length=MAX_SUBJECT_LENGTH, required=False
            )
        tasks = self.db.list_tasks(status=status, subject=subject)
        label = "task" if len(tasks) == 1 else "tasks"
        return ToolResult(
            tool="list_tasks",
            args=params,
            ok=True,
            message=f"Found {len(tasks)} {label} (status: {status}).",
            data={"tasks": tasks, "count": len(tasks), "status": status, "subject": subject},
        )

    def _mark_task_completed(self, params: dict[str, Any]) -> ToolResult:
        _check_keys(params, MARK_FIELDS, "mark_task_completed")
        task_id = normalize_task_id(params.get("task_id"))
        task = self.db.mark_task_completed(task_id)
        return ToolResult(
            tool="mark_task_completed",
            args=params,
            ok=True,
            message=f"Task #{task['id']} '{task['title']}' is now completed.",
            data=task,
        )

    def _get_study_plan(self, params: dict[str, Any]) -> ToolResult:
        _check_keys(params, PLAN_FIELDS, "get_study_plan")
        raw_date = params.get("date") or date.today().isoformat()
        plan_date = normalize_date(raw_date, "Plan date")
        assert plan_date is not None
        tasks = self.db.tasks_for_date(plan_date)
        fallback_note = None
        if not tasks:
            tasks = self.db.list_tasks(status="pending")
            fallback_note = (
                "No tasks were planned or due on this date, so all pending tasks "
                "are shown as a general study queue."
            )
        plan = build_study_plan(tasks, plan_date, fallback_note=fallback_note)
        return ToolResult(
            tool="get_study_plan",
            args=params,
            ok=True,
            message=format_plan_text(plan),
            data=plan,
        )

    def _propose_tasks(self, params: dict[str, Any]) -> ToolResult:
        _check_keys(params, {"tasks"}, "propose_tasks")
        proposals = params.get("tasks")
        if not isinstance(proposals, list) or not proposals:
            raise ValidationError("propose_tasks requires a non-empty task list.")
        if len(proposals) > MAX_PROPOSED_TASKS:
            raise ValidationError(
                f"At most {MAX_PROPOSED_TASKS} tasks can be proposed at once."
            )
        normalized = [normalize_proposal(item) for item in proposals]
        payload = {"tasks": normalized, "count": len(normalized), "saved": False}
        return ToolResult(
            tool="propose_tasks",
            args={"tasks": normalized},
            ok=True,
            message=(
                f"Prepared {len(normalized)} task proposal(s). "
                "Nothing has been saved yet; confirm them in the AI Agent page."
            ),
            data=payload,
        )
