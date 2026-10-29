from __future__ import annotations

import pytest

from services.database import Database
from services.task_tools import AGENT_TOOL_NAMES, TaskToolbox


@pytest.fixture()
def toolbox(tmp_path):
    db = Database(tmp_path / "tools.db")
    return TaskToolbox(db)


def test_agent_cannot_add_or_delete_directly(toolbox):
    add_result = toolbox.execute_agent_tool(
        "add_task", {"title": "Sneaky", "subject": "DSA"}
    )
    assert not add_result.ok
    assert toolbox.db.list_tasks("all") == []

    delete_result = toolbox.execute_agent_tool(
        "delete_task", {"task_id": 1, "confirmed": True}
    )
    assert not delete_result.ok


def test_add_list_and_mark_tools(toolbox):
    add = toolbox.execute(
        "add_task",
        {
            "title": "Study DSA",
            "subject": "DSA",
            "priority": "High",
            "estimated_minutes": 120,
            "planned_date": "2026-10-30",
        },
    )
    assert add.ok
    assert add.data["id"] == 1
    assert "Saved task #1" in add.message

    listed = toolbox.execute("list_tasks", {"status": "pending"})
    assert listed.ok
    assert listed.data["count"] == 1

    marked = toolbox.execute("mark_task_completed", {"task_id": 1})
    assert marked.ok
    assert marked.data["status"] == "completed"
    assert toolbox.db.list_tasks("pending") == []


def test_unknown_tool_and_unexpected_parameters(toolbox):
    unknown = toolbox.execute("run_shell", {"command": "dir"})
    assert not unknown.ok
    assert "Unknown" in unknown.message

    unexpected = toolbox.execute("list_tasks", {"drop": "tasks"})
    assert not unexpected.ok
    assert "Unexpected parameter" in unexpected.message


def test_propose_tasks_validates_without_saving(toolbox):
    result = toolbox.execute_agent_tool(
        "propose_tasks",
        {
            "tasks": [
                {
                    "title": "Study DSA",
                    "subject": "DSA",
                    "planned_date": "2026-10-30",
                    "estimated_minutes": 120,
                },
                {"title": "Revise probability", "subject": "Probability"},
            ]
        },
    )
    assert result.ok
    assert result.data["count"] == 2
    assert result.data["saved"] is False
    assert toolbox.db.list_tasks("all") == []


def test_propose_rejects_invalid_task(toolbox):
    result = toolbox.execute_agent_tool(
        "propose_tasks",
        {"tasks": [{"title": "", "subject": "DSA"}]},
    )
    assert not result.ok
    assert "Title" in result.message
    assert toolbox.db.list_tasks("all") == []


def test_delete_requires_explicit_confirmation(toolbox):
    task = toolbox.execute("add_task", {"title": "Delete me", "subject": "General"}).data

    cancelled = toolbox.execute("delete_task", {"task_id": task["id"]})
    assert not cancelled.ok
    assert cancelled.error == "confirmation_required"
    assert len(toolbox.db.list_tasks("all")) == 1

    deleted = toolbox.execute(
        "delete_task", {"task_id": task["id"], "confirmed": True}
    )
    assert deleted.ok
    assert deleted.data["deleted"] is True
    assert toolbox.db.list_tasks("all") == []


def test_study_plan_tool_uses_saved_tasks(toolbox):
    toolbox.execute(
        "add_task",
        {
            "title": "Study DSA",
            "subject": "DSA",
            "priority": "High",
            "estimated_minutes": 60,
            "planned_date": "2026-10-30",
        },
    )
    toolbox.execute(
        "add_task",
        {
            "title": "Revise probability",
            "subject": "Probability",
            "estimated_minutes": 45,
            "planned_date": "2026-10-30",
        },
    )

    result = toolbox.execute_agent_tool(
        "get_study_plan", {"date": "2026-10-30"}
    )
    assert result.ok
    assert result.data["task_count"] >= 1
    assert "Study DSA" in result.message
    assert result.data["scheduled_minutes"] <= 120


def test_tool_result_serializable(toolbox):
    result = toolbox.execute("list_tasks", {"status": "all"})
    payload = result.to_dict()
    assert payload["tool"] == "list_tasks"
    assert "run_shell" not in AGENT_TOOL_NAMES
    assert "delete_task" not in AGENT_TOOL_NAMES
