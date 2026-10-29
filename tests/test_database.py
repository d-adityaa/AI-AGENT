from __future__ import annotations

import sqlite3
from datetime import date

import pytest

from services.database import (
    Database,
    DatabaseError,
    TaskNotFoundError,
    ValidationError,
)


@pytest.fixture()
def db(tmp_path):
    return Database(tmp_path / "test.db")


def test_add_and_list_task(db):
    task = db.add_task(
        title="Study DSA",
        subject="DSA",
        due_date="2026-11-05",
        priority="High",
        estimated_minutes=120,
        planned_date="2026-10-30",
    )

    assert task["id"] == 1
    assert task["title"] == "Study DSA"
    assert task["status"] == "pending"
    assert task["priority"] == "High"
    assert task["estimated_minutes"] == 120
    assert task["planned_date"] == "2026-10-30"
    assert task["created_at"]

    pending = db.list_tasks("pending")
    assert len(pending) == 1
    assert pending[0]["id"] == 1


def test_persistence_across_database_instances(tmp_path):
    path = tmp_path / "persistent.db"
    first = Database(path)
    first.add_task("Revise probability", "Probability", estimated_minutes=45)

    second = Database(path)
    tasks = second.list_tasks("all")
    assert len(tasks) == 1
    assert tasks[0]["title"] == "Revise probability"


def test_mark_completed_and_filter(db):
    task = db.add_task("Finish AI lab", "AI Lab")
    completed = db.mark_task_completed(task["id"])

    assert completed["status"] == "completed"
    assert completed["completed_at"]
    assert db.list_tasks("pending") == []
    assert len(db.list_tasks("completed")) == 1
    assert db.list_tasks("all")[0]["status"] == "completed"
    assert db.get_stats()["completion_rate"] == 100


@pytest.mark.parametrize(
    "kwargs",
    [
        {"title": "", "subject": "DSA"},
        {"title": "Task", "subject": ""},
        {"title": "Task", "subject": "DSA", "due_date": "2026-02-30"},
        {"title": "Task", "subject": "DSA", "due_date": "tomorrow"},
        {"title": "Task", "subject": "DSA", "priority": "Urgent"},
        {"title": "Task", "subject": "DSA", "estimated_minutes": 0},
        {"title": "Task", "subject": "DSA", "estimated_minutes": 2000},
        {"title": "Task", "subject": "DSA", "estimated_minutes": 12.5},
        {"title": "Task", "subject": "DSA", "estimated_minutes": True},
    ],
)
def test_invalid_task_inputs(db, kwargs):
    with pytest.raises(ValidationError):
        db.add_task(**kwargs)


def test_invalid_task_id_and_missing_task(db):
    with pytest.raises(ValidationError):
        db.mark_task_completed("abc")
    with pytest.raises(ValidationError):
        db.delete_task(0)
    with pytest.raises(TaskNotFoundError):
        db.mark_task_completed(999)
    with pytest.raises(TaskNotFoundError):
        db.delete_task(999)


def test_delete_task(db):
    task = db.add_task("Delete me", "General")
    deleted = db.delete_task(task["id"])
    assert deleted["id"] == task["id"]
    assert db.list_tasks("all") == []


def test_subject_filter_is_case_insensitive(db):
    db.add_task("Study DSA", "DSA")
    db.add_task("Read physics", "Physics")

    filtered = db.list_tasks("all", subject="dsa")
    assert len(filtered) == 1
    assert filtered[0]["subject"] == "DSA"


def test_tasks_for_date_and_upcoming(db):
    db.add_task("Planned", "DSA", planned_date="2026-10-30")
    db.add_task("Due", "Math", due_date="2026-10-30")
    db.add_task("Future", "Physics", due_date="2026-11-10")

    todays = db.tasks_for_date("2026-10-30")
    assert {task["title"] for task in todays} == {"Planned", "Due"}

    upcoming = db.upcoming_deadlines(7, today=date(2026, 10, 29))
    assert [task["title"] for task in upcoming] == ["Due"]


def test_database_error_for_bad_path():
    bad = Database.__new__(Database)
    bad.path = "C:\\<invalid>\\db.sqlite"
    with pytest.raises(DatabaseError):
        bad.initialize()


def test_sql_injection_subject_is_stored_as_text(db):
    task = db.add_task("Review", "DSA'; DROP TABLE tasks; --")
    assert task["id"] == 1
    assert len(db.list_tasks("all")) == 1


def test_existing_database_is_migrated_with_planned_date(tmp_path):
    path = tmp_path / "old.db"
    with sqlite3.connect(path) as connection:
        connection.execute(
            """
            CREATE TABLE tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                subject TEXT NOT NULL,
                due_date TEXT,
                priority TEXT NOT NULL DEFAULT 'Medium',
                estimated_minutes INTEGER,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                completed_at TEXT
            )
            """
        )
        connection.execute(
            "INSERT INTO tasks (title, subject, created_at) VALUES ('Old task', 'DSA', '2026-01-01')"
        )

    migrated = Database(path)
    tasks = migrated.list_tasks("all")
    assert tasks[0]["planned_date"] is None
    updated = migrated.add_task("New task", "Math", planned_date="2026-11-01")
    assert updated["planned_date"] == "2026-11-01"
