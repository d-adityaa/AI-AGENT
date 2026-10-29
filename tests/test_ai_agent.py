from __future__ import annotations

from datetime import date, timedelta

import pytest

from services.ai_agent import AIStudyAgent, extract_natural_language_tasks
from services.database import Database

SAMPLE = (
    "Tomorrow I want to study DSA for two hours, revise probability, "
    "and finish my AI lab assignment."
)


class FakeCall:
    def __init__(self, name, args=None, call_id=None):
        self.name = name
        self.args = args or {}
        self.id = call_id


class FakePart:
    def __init__(self, function_call=None, text=None):
        self.function_call = function_call
        self.text = text


class FakeContent:
    def __init__(self, parts):
        self.parts = parts


class FakeCandidate:
    def __init__(self, content):
        self.content = content


class FakeResponse:
    def __init__(self, parts):
        self.candidates = [FakeCandidate(FakeContent(parts))]

    @property
    def function_calls(self):
        calls = [part.function_call for part in self.candidates[0].content.parts if part.function_call]
        return calls or None

    @property
    def text(self):
        return "\n".join(
            part.text for part in self.candidates[0].content.parts if part.text
        )


class FakeModels:
    def __init__(self, responses=None, error=None):
        self.responses = list(responses or [])
        self.error = error
        self.calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        if self.error is not None:
            raise self.error
        if not self.responses:
            raise RuntimeError("No fake response configured")
        return self.responses.pop(0)


class FakeClient:
    def __init__(self, responses=None, error=None):
        self.models = FakeModels(responses, error)


class RateLimitError(RuntimeError):
    code = 429


class GenericProviderError(RuntimeError):
    code = 500


@pytest.fixture()
def db(tmp_path):
    return Database(tmp_path / "agent.db")


def test_local_fallback_extracts_sample_without_api_key(db, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    agent = AIStudyAgent(db, api_key="")

    reply = agent.analyze(SAMPLE)

    assert reply.mode == "fallback"
    assert reply.warning and "not from an AI model" in reply.warning
    assert len(reply.proposed_tasks) == 3
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    assert all(task["planned_date"] == tomorrow for task in reply.proposed_tasks)
    assert all(task["due_date"] is None for task in reply.proposed_tasks)
    assert reply.proposed_tasks[0]["estimated_minutes"] == 120
    assert reply.proposed_tasks[1]["estimated_minutes"] is None
    assert reply.proposed_tasks[2]["estimated_minutes"] is None
    assert db.list_tasks("all") == []
    assert reply.tool_events[0]["tool"] == "propose_tasks"
    assert reply.tool_events[0]["ok"] is True


def test_local_due_date_is_not_turned_into_planned_date():
    tasks = extract_natural_language_tasks(
        "Finish my AI lab assignment due 2026-11-05", date(2026, 10, 29)
    )
    assert len(tasks) == 1
    assert tasks[0]["due_date"] == "2026-11-05"
    assert tasks[0]["planned_date"] is None


def test_local_fallback_lists_real_tasks(db):
    task = db.add_task("Study DSA", "DSA")
    agent = AIStudyAgent(db, api_key="")

    reply = agent.analyze("Show my pending tasks")

    assert reply.mode == "fallback"
    assert "Study DSA" in reply.message
    assert reply.tool_events[0]["tool"] == "list_tasks"
    assert reply.tool_events[0]["result"]["count"] == 1
    assert str(task["id"]) in reply.message


def test_local_fallback_marks_task_completed(db):
    task = db.add_task("Study DSA", "DSA")
    agent = AIStudyAgent(db, api_key="")

    reply = agent.analyze(f"Mark task {task['id']} complete")

    assert reply.mode == "fallback"
    assert db.get_task(task["id"])["status"] == "completed"
    assert reply.tool_events[0]["tool"] == "mark_task_completed"
    assert reply.tool_events[0]["ok"] is True


def test_local_fallback_delete_never_deletes(db):
    task = db.add_task("Keep me", "DSA")
    agent = AIStudyAgent(db, api_key="")

    reply = agent.analyze(f"delete task {task['id']}")

    assert db.get_task(task["id"]) is not None
    assert "My Tasks" in reply.message
    assert reply.tool_events == []


def test_gemini_function_call_dispatches_real_tool_and_waits_for_confirmation(db):
    fake_client = FakeClient(
        responses=[
            FakeResponse(
                [
                    FakePart(
                        function_call=FakeCall(
                            "propose_tasks",
                            {
                                "tasks": [
                                    {
                                        "title": "Study DSA",
                                        "subject": "DSA",
                                        "planned_date": "2026-10-30",
                                        "estimated_minutes": 120,
                                    }
                                ]
                            },
                            call_id="call-1",
                        )
                    )
                ]
            ),
            FakeResponse([FakePart(text="I prepared one proposal for your review.")]),
        ]
    )
    agent = AIStudyAgent(db, api_key="", client=fake_client)

    reply = agent.analyze("Plan DSA for tomorrow")

    assert reply.mode == "gemini"
    assert reply.proposed_tasks[0]["title"] == "Study DSA"
    assert reply.tool_events[0]["tool"] == "propose_tasks"
    assert reply.tool_events[0]["ok"] is True
    assert len(fake_client.models.calls) == 2
    assert db.list_tasks("all") == []
    second_contents = fake_client.models.calls[1]["contents"]
    assert any(
        getattr(part, "function_response", None)
        for content in second_contents
        for part in getattr(content, "parts", [])
    )


def test_gemini_can_mark_a_real_saved_task(db):
    task = db.add_task("Study DSA", "DSA")
    fake_client = FakeClient(
        responses=[
            FakeResponse(
                [
                    FakePart(
                        function_call=FakeCall(
                            "mark_task_completed",
                            {"task_id": task["id"]},
                            call_id="call-2",
                        )
                    )
                ]
            ),
            FakeResponse([FakePart(text="Task completed.")]),
        ]
    )
    agent = AIStudyAgent(db, api_key="", client=fake_client)

    reply = agent.analyze(f"Mark task {task['id']} complete")

    assert reply.mode == "gemini"
    assert db.get_task(task["id"])["status"] == "completed"
    assert reply.tool_events[0]["result"]["status"] == "completed"


def test_provider_failure_uses_labelled_fallback(db):
    fake_client = FakeClient(error=RateLimitError("429 RESOURCE_EXHAUSTED"))
    agent = AIStudyAgent(db, api_key="test-key-not-real", client=fake_client)

    reply = agent.analyze(SAMPLE)

    assert reply.mode == "fallback"
    assert reply.warning and "local fallback" in reply.warning
    assert "rate limit" in reply.warning.lower()
    assert len(reply.proposed_tasks) == 3
    assert "nothing has been saved" in reply.message.lower()
    assert db.list_tasks("all") == []


def test_api_key_is_redacted_from_diagnostics(db):
    secret = "super-secret-key"
    fake_client = FakeClient(error=RuntimeError(f"bad key {secret}"))
    agent = AIStudyAgent(db, api_key=secret, client=fake_client)

    reply = agent.analyze(SAMPLE)

    assert secret not in (reply.warning or "")
    assert secret not in (agent.last_error or "")


def test_generic_provider_error_is_not_mislabeled_as_rate_limit(db):
    fake_client = FakeClient(
        error=GenericProviderError("generate_content failed with server error")
    )
    agent = AIStudyAgent(db, api_key="test-key", client=fake_client)

    reply = agent.analyze(SAMPLE)

    assert reply.mode == "fallback"
    assert "rate limit" not in (reply.warning or "").lower()
    assert "Gemini request failed" in (reply.warning or "")


def test_delete_tool_unavailable_to_agent_even_if_model_requests_it(db):
    task = db.add_task("Keep me", "DSA")
    fake_client = FakeClient(
        responses=[
            FakeResponse(
                [
                    FakePart(
                        function_call=FakeCall(
                            "delete_task",
                            {"task_id": task["id"], "confirmed": True},
                            call_id="call-3",
                        )
                    )
                ]
            ),
            FakeResponse([FakePart(text="I cannot delete tasks from chat.")]),
        ]
    )
    agent = AIStudyAgent(db, api_key="", client=fake_client)

    reply = agent.analyze(f"Delete task {task['id']}")

    assert db.get_task(task["id"]) is not None
    assert reply.tool_events[0]["ok"] is False
    assert "not available to the AI agent" in reply.tool_events[0]["message"]


def test_provider_status_never_contains_key(db):
    agent = AIStudyAgent(db, api_key="secret-value", model="gemini-3.8-flash")
    status = agent.provider_status()
    assert status["configured"] is True
    assert "secret-value" not in str(status)
    assert status["model"] == "gemini-3.8-flash"
