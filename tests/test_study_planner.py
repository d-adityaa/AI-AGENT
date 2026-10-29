from __future__ import annotations

import pytest

from services.database import ValidationError
from services.study_planner import build_study_plan, format_plan_text


def task(**overrides):
    base = {
        "id": 1,
        "title": "Study DSA",
        "subject": "DSA",
        "priority": "High",
        "due_date": None,
        "planned_date": "2026-10-30",
        "estimated_minutes": 60,
        "status": "pending",
        "created_at": "2026-10-29T10:00:00+00:00",
    }
    base.update(overrides)
    return base


def test_plan_orders_by_priority_and_due_date():
    tasks = [
        task(id=1, title="Low task", priority="Low", due_date=None),
        task(id=2, title="Due today", priority="Medium", due_date="2026-10-30"),
        task(id=3, title="High task", priority="High"),
    ]
    plan = build_study_plan(tasks, "2026-10-30", available_minutes=180)

    assert [item["title"] for item in plan["items"]] == [
        "Due today",
        "High task",
        "Low task",
    ]
    assert plan["items"][0]["start_time"] == "09:00"
    assert plan["scheduled_minutes"] == 180


def test_unknown_duration_is_labelled_suggested():
    plan = build_study_plan(
        [task(estimated_minutes=None)], "2026-10-30", available_minutes=120
    )
    item = plan["items"][0]
    assert item["estimated_minutes"] is None
    assert item["allocated_minutes"] == 30
    assert item["estimate_source"] == "suggested"
    assert any("no duration" in note.lower() for note in plan["notes"])
    assert "no user estimate" in format_plan_text(plan)


def test_partial_allocation_is_explicit():
    plan = build_study_plan(
        [task(estimated_minutes=240)], "2026-10-30", available_minutes=60
    )
    item = plan["items"][0]
    assert item["partial"] is True
    assert item["allocated_minutes"] == 60
    assert any("partial" in note.lower() for note in plan["notes"])


def test_unscheduled_when_window_is_full():
    tasks = [
        task(id=1, title="First", estimated_minutes=120),
        task(id=2, title="Second", estimated_minutes=60),
    ]
    plan = build_study_plan(tasks, "2026-10-30", available_minutes=120)
    assert len(plan["items"]) == 1
    assert len(plan["unscheduled"]) == 1
    assert plan["remaining_minutes"] == 0


def test_completed_tasks_are_ignored():
    plan = build_study_plan(
        [task(status="completed")], "2026-10-30", available_minutes=120
    )
    assert plan["items"] == []


@pytest.mark.parametrize("minutes", [0, 10, 2000, "60", True])
def test_invalid_available_minutes(minutes):
    with pytest.raises(ValidationError):
        build_study_plan([task()], "2026-10-30", available_minutes=minutes)


def test_invalid_plan_date():
    with pytest.raises(ValidationError):
        build_study_plan([task()], "next Friday")
