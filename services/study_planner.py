"""Deterministic study-plan generation.

The planner only uses saved task records. Missing durations are shown as
suggested 30-minute blocks and are never presented as user-provided estimates.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Iterable, Optional

from services.database import ValidationError, normalize_date

PRIORITY_RANK = {"High": 0, "Medium": 1, "Low": 2}
SUGGESTED_BLOCK_MINUTES = 30
MIN_AVAILABLE_MINUTES = 15
MAX_AVAILABLE_MINUTES = 1440


def _task_sort_key(task: dict[str, Any], plan_date: str) -> tuple[Any, ...]:
    due = task.get("due_date") or "9999-12-31"
    planned = task.get("planned_date") or "9999-12-31"
    overdue = 0 if task.get("due_date") and task["due_date"] < plan_date else 1
    due_today = 0 if task.get("due_date") == plan_date else 1
    planned_today = 0 if task.get("planned_date") == plan_date else 1
    return (
        overdue,
        due_today,
        planned_today,
        PRIORITY_RANK.get(task.get("priority", "Medium"), 1),
        due,
        planned,
        task.get("created_at", ""),
    )


def _reason_for(task: dict[str, Any], plan_date: str) -> str:
    reasons: list[str] = []
    due = task.get("due_date")
    if due and due < plan_date:
        reasons.append(f"overdue since {due}")
    elif due == plan_date:
        reasons.append("due this day")
    elif due:
        reasons.append(f"due {due}")
    if task.get("planned_date") == plan_date:
        reasons.append("planned for this day")
    priority = task.get("priority", "Medium")
    if priority == "High":
        reasons.append("high priority")
    if not task.get("estimated_minutes"):
        reasons.append("no estimate provided; 30-minute block suggested")
    return "; ".join(reasons) or f"{priority.lower()} priority"


def _minutes_to_clock(start: datetime, minutes: int) -> str:
    return (start + timedelta(minutes=minutes)).strftime("%H:%M")


def build_study_plan(
    tasks: Iterable[dict[str, Any]],
    plan_date: Any,
    *,
    available_minutes: int = 120,
    start_hour: int = 9,
    fallback_note: Optional[str] = None,
) -> dict[str, Any]:
    """Build a time-blocked plan from pending task dictionaries.

    Tasks are sorted by overdue status, due date, priority, and planned date.
    Tasks are never split into shorter sessions unless a task is longer than
    the entire remaining window, in which case the partial allocation is
    explicitly labelled.
    """

    normalized_date = normalize_date(plan_date, "Plan date")
    if normalized_date is None:
        raise ValidationError("Plan date is required.")
    if isinstance(available_minutes, bool) or not isinstance(available_minutes, int):
        raise ValidationError("Available minutes must be a whole number.")
    if not MIN_AVAILABLE_MINUTES <= available_minutes <= MAX_AVAILABLE_MINUTES:
        raise ValidationError(
            f"Available minutes must be between {MIN_AVAILABLE_MINUTES} "
            f"and {MAX_AVAILABLE_MINUTES}."
        )
    if isinstance(start_hour, bool) or not isinstance(start_hour, int) or not 0 <= start_hour <= 23:
        raise ValidationError("Start hour must be between 0 and 23.")

    pending = [dict(task) for task in tasks if task.get("status", "pending") == "pending"]
    pending.sort(key=lambda task: _task_sort_key(task, normalized_date))

    current = datetime.combine(
        date.fromisoformat(normalized_date), datetime.min.time()
    ).replace(hour=start_hour)
    remaining = available_minutes
    items: list[dict[str, Any]] = []
    unscheduled: list[dict[str, Any]] = []
    notes: list[str] = []
    if fallback_note:
        notes.append(fallback_note)

    for order, task in enumerate(pending, start=1):
        provided_estimate = task.get("estimated_minutes")
        estimate_source = "provided" if provided_estimate else "suggested"
        block_minutes = int(provided_estimate or SUGGESTED_BLOCK_MINUTES)
        partial = False

        if remaining < MIN_AVAILABLE_MINUTES:
            unscheduled.append(
                {
                    "task_id": task.get("id"),
                    "title": task.get("title"),
                    "subject": task.get("subject"),
                    "priority": task.get("priority"),
                    "estimated_minutes": provided_estimate,
                    "reason": "Not enough time left in the selected study window.",
                }
            )
            continue

        allocated = block_minutes
        if block_minutes > remaining:
            allocated = remaining
            partial = True

        start_label = current.strftime("%H:%M")
        end_label = _minutes_to_clock(current, allocated)
        items.append(
            {
                "order": order,
                "task_id": task.get("id"),
                "title": task.get("title"),
                "subject": task.get("subject"),
                "priority": task.get("priority"),
                "due_date": task.get("due_date"),
                "planned_date": task.get("planned_date"),
                "estimated_minutes": provided_estimate,
                "allocated_minutes": allocated,
                "estimate_source": estimate_source,
                "partial": partial,
                "start_time": start_label,
                "end_time": end_label,
                "reason": _reason_for(task, normalized_date),
            }
        )
        current = current + timedelta(minutes=allocated)
        remaining -= allocated
        if partial:
            notes.append(
                f"'{task.get('title')}' has a {block_minutes}-minute estimate but only "
                f"{allocated} minutes remain. The block is marked as partial."
            )

    scheduled_minutes = sum(item["allocated_minutes"] for item in items)
    unknown_estimates = sum(
        1 for item in items if item["estimate_source"] == "suggested"
    )
    if unknown_estimates:
        notes.append(
            f"{unknown_estimates} task(s) had no duration. A {SUGGESTED_BLOCK_MINUTES}-minute "
            "block was suggested for planning only."
        )
    if not pending:
        notes.append("There are no pending tasks to schedule for this plan.")

    return {
        "date": normalized_date,
        "available_minutes": available_minutes,
        "start_time": f"{start_hour:02d}:00",
        "items": items,
        "unscheduled": unscheduled,
        "scheduled_minutes": scheduled_minutes,
        "remaining_minutes": max(remaining, 0),
        "task_count": len(items),
        "notes": notes,
    }


def format_plan_text(plan: dict[str, Any]) -> str:
    if not plan["items"]:
        return (
            f"No pending tasks are scheduled for {plan['date']}. "
            "Add tasks or choose another date."
        )

    lines = [
        (
            f"Study plan for {plan['date']} "
            f"({plan['scheduled_minutes']} of {plan['available_minutes']} minutes used):"
        )
    ]
    for item in plan["items"]:
        estimate = (
            f"{item['estimated_minutes']} min estimate"
            if item["estimate_source"] == "provided"
            else "no user estimate; 30 min suggested"
        )
        partial = " [partial block]" if item["partial"] else ""
        lines.append(
            f"{item['order']}. {item['start_time']}-{item['end_time']} "
            f"{item['title']} ({item['subject']}, {item['priority']}, {estimate}){partial}"
        )
    if plan["unscheduled"]:
        lines.append("Not scheduled:")
        for task in plan["unscheduled"]:
            lines.append(f"- {task['title']} ({task['reason']})")
    for note in plan["notes"]:
        lines.append(f"Note: {note}")
    return "\n".join(lines)
