"""SQLite persistence and input validation for the study planner."""

from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

VALID_PRIORITIES = ("Low", "Medium", "High")
VALID_STATUSES = ("pending", "completed", "all")
MAX_TITLE_LENGTH = 200
MAX_SUBJECT_LENGTH = 80
MIN_DURATION = 5
MAX_DURATION = 1440

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = PROJECT_ROOT / "data" / "study_planner.db"


class ValidationError(ValueError):
    """Raised when user or AI supplied data fails validation."""


class TaskNotFoundError(LookupError):
    """Raised when a task ID does not exist."""


class DatabaseError(RuntimeError):
    """Raised when SQLite cannot complete an operation."""


def clean_text(value: Any, field: str, *, max_length: int, required: bool = True) -> Optional[str]:
    if value is None:
        if required:
            raise ValidationError(f"{field} is required.")
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{field} must be text.")
    cleaned = " ".join(value.strip().split())
    if not cleaned:
        if required:
            raise ValidationError(f"{field} cannot be empty.")
        return None
    if len(cleaned) > max_length:
        raise ValidationError(f"{field} must be {max_length} characters or fewer.")
    return cleaned


def normalize_priority(value: Any) -> str:
    if value is None:
        return "Medium"
    if not isinstance(value, str):
        raise ValidationError("Priority must be Low, Medium, or High.")
    lookup = {priority.lower(): priority for priority in VALID_PRIORITIES}
    normalized = lookup.get(value.strip().lower())
    if normalized is None:
        raise ValidationError("Priority must be Low, Medium, or High.")
    return normalized


def normalize_date(value: Any, field: str = "Date") -> Optional[str]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if not isinstance(value, str):
        raise ValidationError(f"{field} must use YYYY-MM-DD format.")
    cleaned = value.strip()
    if not cleaned:
        return None
    try:
        parsed = date.fromisoformat(cleaned)
    except ValueError as exc:
        raise ValidationError(f"{field} must be a valid date in YYYY-MM-DD format.") from exc
    if parsed.year < 1900 or parsed.year > 2200:
        raise ValidationError(f"{field} must be between 1900 and 2200.")
    return parsed.isoformat()


def normalize_minutes(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValidationError("Estimated minutes must be a whole number.")
    if isinstance(value, float):
        if not value.is_integer():
            raise ValidationError("Estimated minutes must be a whole number.")
        value = int(value)
    if isinstance(value, str):
        cleaned = value.strip()
        if not cleaned:
            return None
        try:
            value = int(cleaned)
        except ValueError as exc:
            raise ValidationError("Estimated minutes must be a whole number.") from exc
    if not isinstance(value, int):
        raise ValidationError("Estimated minutes must be a whole number.")
    if value < MIN_DURATION or value > MAX_DURATION:
        raise ValidationError(
            f"Estimated minutes must be between {MIN_DURATION} and {MAX_DURATION}."
        )
    return value


def normalize_task_id(value: Any) -> int:
    if isinstance(value, bool):
        raise ValidationError("Task ID must be a positive whole number.")
    if isinstance(value, float):
        if not value.is_integer():
            raise ValidationError("Task ID must be a positive whole number.")
        value = int(value)
    if isinstance(value, str):
        cleaned = value.strip().lstrip("#")
        if not cleaned:
            raise ValidationError("Task ID is required.")
        try:
            value = int(cleaned)
        except ValueError as exc:
            raise ValidationError("Task ID must be a positive whole number.") from exc
    if not isinstance(value, int) or value <= 0:
        raise ValidationError("Task ID must be a positive whole number.")
    return value


def normalize_status(value: Any) -> str:
    if value is None:
        return "pending"
    if not isinstance(value, str):
        raise ValidationError("Status must be pending, completed, or all.")
    normalized = value.strip().lower()
    if normalized not in VALID_STATUSES:
        raise ValidationError("Status must be pending, completed, or all.")
    return normalized


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Database:
    """Small SQLite repository. A fresh connection is used for each operation."""

    def __init__(self, path: Optional[str | Path] = None, *, initialize: bool = True) -> None:
        configured = path or os.getenv("STUDY_PLANNER_DB") or DEFAULT_DB_PATH
        self.path = str(configured)
        if initialize:
            self.initialize()

    @property
    def is_memory(self) -> bool:
        return self.path == ":memory:"

    def _ensure_parent(self) -> None:
        if not self.is_memory:
            Path(self.path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def connection(self) -> Iterator[sqlite3.Connection]:
        try:
            self._ensure_parent()
        except OSError as exc:
            raise DatabaseError(f"Could not create the database folder: {exc}") from exc
        connection: Optional[sqlite3.Connection] = None
        try:
            connection = sqlite3.connect(self.path, timeout=15)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("PRAGMA busy_timeout = 5000")
            yield connection
            connection.commit()
        except sqlite3.Error as exc:
            if connection is not None:
                connection.rollback()
            raise DatabaseError(f"Database error: {exc}") from exc
        except Exception:
            if connection is not None:
                connection.rollback()
            raise
        finally:
            if connection is not None:
                connection.close()

    def initialize(self) -> None:
        table_schema = """
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            subject TEXT NOT NULL,
            due_date TEXT,
            planned_date TEXT,
            priority TEXT NOT NULL DEFAULT 'Medium'
                CHECK (priority IN ('Low', 'Medium', 'High')),
            estimated_minutes INTEGER
                CHECK (estimated_minutes IS NULL
                       OR (estimated_minutes >= 5 AND estimated_minutes <= 1440)),
            status TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'completed')),
            created_at TEXT NOT NULL,
            completed_at TEXT
        );
        """
        index_schema = """
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date);
        CREATE INDEX IF NOT EXISTS idx_tasks_planned_date ON tasks(planned_date);
        CREATE INDEX IF NOT EXISTS idx_tasks_subject ON tasks(subject);
        """
        try:
            with self.connection() as connection:
                connection.executescript(table_schema)
                columns = {
                    row["name"]
                    for row in connection.execute("PRAGMA table_info(tasks)").fetchall()
                }
                if "planned_date" not in columns:
                    connection.execute("ALTER TABLE tasks ADD COLUMN planned_date TEXT")
                connection.executescript(index_schema)
        except DatabaseError:
            raise
        except sqlite3.Error as exc:
            raise DatabaseError(f"Could not initialize the database: {exc}") from exc

    def add_task(
        self,
        title: Any,
        subject: Any,
        due_date: Any = None,
        priority: Any = "Medium",
        estimated_minutes: Any = None,
        planned_date: Any = None,
    ) -> dict[str, Any]:
        clean_title = clean_text(title, "Title", max_length=MAX_TITLE_LENGTH)
        clean_subject = clean_text(subject, "Subject", max_length=MAX_SUBJECT_LENGTH)
        normalized_due = normalize_date(due_date, "Due date")
        normalized_planned = normalize_date(planned_date, "Planned date")
        normalized_priority = normalize_priority(priority)
        normalized_minutes = normalize_minutes(estimated_minutes)
        created_at = _utc_now()

        try:
            with self.connection() as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO tasks
                        (title, subject, due_date, planned_date, priority,
                         estimated_minutes, status, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
                    """,
                    (
                        clean_title,
                        clean_subject,
                        normalized_due,
                        normalized_planned,
                        normalized_priority,
                        normalized_minutes,
                        created_at,
                    ),
                )
                task_id = int(cursor.lastrowid)
        except sqlite3.IntegrityError as exc:
            raise ValidationError(f"Could not save task: {exc}") from exc

        task = self.get_task(task_id)
        if task is None:
            raise DatabaseError("Task was saved but could not be read back.")
        return task

    def get_task(self, task_id: Any) -> Optional[dict[str, Any]]:
        normalized_id = normalize_task_id(task_id)
        try:
            with self.connection() as connection:
                row = connection.execute(
                    "SELECT * FROM tasks WHERE id = ?", (normalized_id,)
                ).fetchone()
        except sqlite3.Error as exc:
            raise DatabaseError(f"Could not load task: {exc}") from exc
        return dict(row) if row else None

    def list_tasks(
        self,
        status: Any = "all",
        subject: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        normalized_status = normalize_status(status)
        params: list[Any] = []
        clauses: list[str] = []

        if normalized_status != "all":
            clauses.append("status = ?")
            params.append(normalized_status)
        if subject is not None and str(subject).strip():
            clauses.append("subject = ? COLLATE NOCASE")
            params.append(str(subject).strip())

        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        query = f"""
            SELECT * FROM tasks
            {where}
            ORDER BY
                CASE status WHEN 'pending' THEN 0 ELSE 1 END,
                CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,
                CASE WHEN COALESCE(planned_date, due_date) IS NULL THEN 1 ELSE 0 END,
                COALESCE(planned_date, due_date) ASC,
                created_at DESC
        """
        try:
            with self.connection() as connection:
                rows = connection.execute(query, params).fetchall()
        except sqlite3.Error as exc:
            raise DatabaseError(f"Could not load tasks: {exc}") from exc
        return [dict(row) for row in rows]

    def subjects(self) -> list[str]:
        try:
            with self.connection() as connection:
                rows = connection.execute(
                    "SELECT DISTINCT subject FROM tasks ORDER BY subject COLLATE NOCASE"
                ).fetchall()
        except sqlite3.Error as exc:
            raise DatabaseError(f"Could not load subjects: {exc}") from exc
        return [row["subject"] for row in rows]

    def mark_task_completed(self, task_id: Any) -> dict[str, Any]:
        normalized_id = normalize_task_id(task_id)
        existing = self.get_task(normalized_id)
        if existing is None:
            raise TaskNotFoundError(f"Task {normalized_id} was not found.")
        if existing["status"] == "completed":
            return existing
        try:
            with self.connection() as connection:
                connection.execute(
                    "UPDATE tasks SET status = 'completed', completed_at = ? WHERE id = ?",
                    (_utc_now(), normalized_id),
                )
        except sqlite3.Error as exc:
            raise DatabaseError(f"Could not update task: {exc}") from exc
        updated = self.get_task(normalized_id)
        if updated is None:
            raise DatabaseError("Task was updated but could not be read back.")
        return updated

    def delete_task(self, task_id: Any) -> dict[str, Any]:
        normalized_id = normalize_task_id(task_id)
        existing = self.get_task(normalized_id)
        if existing is None:
            raise TaskNotFoundError(f"Task {normalized_id} was not found.")
        try:
            with self.connection() as connection:
                connection.execute("DELETE FROM tasks WHERE id = ?", (normalized_id,))
        except sqlite3.Error as exc:
            raise DatabaseError(f"Could not delete task: {exc}") from exc
        return existing

    def tasks_for_date(self, plan_date: Any) -> list[dict[str, Any]]:
        normalized_date = normalize_date(plan_date, "Plan date")
        try:
            with self.connection() as connection:
                rows = connection.execute(
                    """
                    SELECT * FROM tasks
                    WHERE status = 'pending'
                      AND (planned_date = ? OR due_date = ?)
                    ORDER BY
                        CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,
                        CASE WHEN due_date IS NULL THEN 1 ELSE 0 END,
                        due_date ASC,
                        created_at ASC
                    """,
                    (normalized_date, normalized_date),
                ).fetchall()
        except sqlite3.Error as exc:
            raise DatabaseError(f"Could not load the study plan: {exc}") from exc
        return [dict(row) for row in rows]

    def upcoming_deadlines(self, days: int = 7, *, today: Optional[date] = None) -> list[dict[str, Any]]:
        if isinstance(days, bool) or not isinstance(days, int) or days < 0 or days > 365:
            raise ValidationError("Upcoming deadline range must be between 0 and 365 days.")
        start = (today or date.today()).isoformat()
        end = ((today or date.today()) + timedelta(days=days)).isoformat()
        try:
            with self.connection() as connection:
                rows = connection.execute(
                    """
                    SELECT * FROM tasks
                    WHERE status = 'pending'
                      AND due_date IS NOT NULL
                      AND due_date >= ? AND due_date <= ?
                    ORDER BY due_date ASC,
                        CASE priority
                            WHEN 'High' THEN 0
                            WHEN 'Medium' THEN 1
                            ELSE 2
                        END
                    """,
                    (start, end),
                ).fetchall()
        except sqlite3.Error as exc:
            raise DatabaseError(f"Could not load upcoming deadlines: {exc}") from exc
        return [dict(row) for row in rows]

    def get_stats(self, *, today: Optional[date] = None) -> dict[str, int]:
        current = (today or date.today()).isoformat()
        try:
            with self.connection() as connection:
                row = connection.execute(
                    """
                    SELECT
                        COUNT(*) AS total,
                        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
                        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
                        SUM(CASE WHEN status = 'pending'
                                  AND due_date IS NOT NULL AND due_date < ?
                                 THEN 1 ELSE 0 END) AS overdue
                    FROM tasks
                    """,
                    (current,),
                ).fetchone()
        except sqlite3.Error as exc:
            raise DatabaseError(f"Could not load statistics: {exc}") from exc
        total = int(row["total"] or 0)
        completed = int(row["completed"] or 0)
        return {
            "total": total,
            "pending": int(row["pending"] or 0),
            "completed": completed,
            "overdue": int(row["overdue"] or 0),
            "completion_rate": round((completed / total) * 100) if total else 0,
        }

    def today_tasks(self, *, today: Optional[date] = None) -> list[dict[str, Any]]:
        current = (today or date.today()).isoformat()
        try:
            with self.connection() as connection:
                rows = connection.execute(
                    """
                    SELECT * FROM tasks
                    WHERE status = 'pending'
                      AND (planned_date = ? OR due_date = ?)
                    ORDER BY
                        CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,
                        created_at ASC
                    """,
                    (current, current),
                ).fetchall()
        except sqlite3.Error as exc:
            raise DatabaseError(f"Could not load today's tasks: {exc}") from exc
        return [dict(row) for row in rows]
