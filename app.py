"""AI Personal Study Planner Agent - Streamlit application."""

from __future__ import annotations

import html
import json
import uuid
from datetime import date, datetime
from typing import Any, Optional

import pandas as pd
import streamlit as st
from dotenv import load_dotenv

from services.ai_agent import AgentReply, AIStudyAgent
from services.database import (
    DEFAULT_DB_PATH,
    PROJECT_ROOT,
    Database,
    DatabaseError,
    TaskNotFoundError,
    ValidationError,
)
from services.study_planner import build_study_plan, format_plan_text
from services.task_tools import TaskToolbox, normalize_proposal

load_dotenv(PROJECT_ROOT / ".env", override=False)

st.set_page_config(
    page_title="StudyFlow AI",
    page_icon="",
    layout="wide",
    initial_sidebar_state="expanded",
)

PAGES = ("Dashboard", "AI Agent", "My Tasks", "Study Plan", "Settings")
STATUS_MAP = {"All": "all", "Pending": "pending", "Completed": "completed"}
PRIORITIES = ("Low", "Medium", "High")

CSS = """
<style>
:root {
    --ink: #0f172a;
    --muted: #64748b;
    --line: #e2e8f0;
    --indigo: #4f46e5;
    --indigo-soft: #eef2ff;
    --blue-soft: #eff6ff;
    --green: #059669;
    --green-soft: #ecfdf5;
    --amber: #b45309;
    --amber-soft: #fffbeb;
    --red: #dc2626;
    --red-soft: #fef2f2;
}
.stApp {
    background:
        radial-gradient(1200px 500px at 100% -10%, #eef2ff 0%, rgba(238,242,255,0) 65%),
        #f8fafc;
}
.block-container {
    padding-top: 2.1rem;
    padding-bottom: 4rem;
    max-width: 1180px;
}
[data-testid="stSidebar"] {
    background: #ffffff;
    border-right: 1px solid var(--line);
}
[data-testid="stSidebar"] .block-container { padding-top: 1.4rem; }
h1, h2, h3 { color: var(--ink); letter-spacing: -0.02em; }
p, label, span, div { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; }
.brand {
    display: flex; align-items: center; gap: 0.7rem;
    padding: 0.35rem 0.25rem 1.1rem 0.25rem;
}
.brand-mark {
    width: 38px; height: 38px; border-radius: 12px;
    background: linear-gradient(135deg, #4f46e5, #6366f1);
    color: white; display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 1.05rem; letter-spacing: -0.04em;
    box-shadow: 0 8px 18px rgba(79,70,229,.22);
}
.brand-title { font-weight: 700; color: var(--ink); font-size: 1.06rem; line-height: 1.1; }
.brand-sub { color: var(--muted); font-size: 0.74rem; margin-top: 0.15rem; }
.side-status {
    margin: 0.9rem 0.25rem 0.4rem 0.25rem; padding: 0.65rem 0.8rem;
    border: 1px solid var(--line); border-radius: 11px; background: #fbfcff;
    color: #334155; font-size: 0.8rem;
}
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; }
.dot.on { background: #10b981; box-shadow: 0 0 0 3px #d1fae5; }
.dot.off { background: #f59e0b; box-shadow: 0 0 0 3px #fef3c7; }
.hero {
    display: flex; justify-content: space-between; align-items: flex-start;
    gap: 1.2rem; flex-wrap: wrap; margin-bottom: 1.35rem;
}
.hero h1 { font-size: 2.05rem; margin: 0 0 0.35rem 0; line-height: 1.15; }
.hero p { color: var(--muted); margin: 0; max-width: 640px; font-size: 0.98rem; }
.date-chip {
    background: #ffffff; border: 1px solid var(--line); border-radius: 11px;
    padding: 0.55rem 0.9rem; color: #475569; font-size: 0.82rem;
    box-shadow: 0 3px 12px rgba(15,23,42,.04); white-space: nowrap;
}
.stat-grid { display: flex; gap: 0.85rem; flex-wrap: wrap; margin-bottom: 1.25rem; }
.stat-card {
    flex: 1 1 160px; background: #ffffff; border: 1px solid var(--line);
    border-radius: 14px; padding: 0.95rem 1.05rem;
    box-shadow: 0 5px 18px rgba(15,23,42,.035);
}
.stat-label { color: var(--muted); font-size: 0.76rem; font-weight: 600; text-transform: uppercase; letter-spacing: .045em; }
.stat-value { color: var(--ink); font-size: 1.75rem; font-weight: 700; line-height: 1.25; margin-top: .18rem; }
.stat-hint { color: var(--muted); font-size: 0.75rem; margin-top: .15rem; }
.stat-card.indigo { border-top: 3px solid #6366f1; }
.stat-card.green { border-top: 3px solid #10b981; }
.stat-card.amber { border-top: 3px solid #f59e0b; }
.stat-card.red { border-top: 3px solid #ef4444; }
.section-head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; margin: 1.5rem 0 .75rem 0; }
.section-head h3 { font-size: 1.1rem; margin: 0; }
.section-head span { color: var(--muted); font-size: .8rem; }
.task-card {
    background: #ffffff; border: 1px solid var(--line); border-radius: 13px;
    padding: 1rem 1.05rem; margin-bottom: .7rem; box-shadow: 0 3px 12px rgba(15,23,42,.03);
}
.task-title { color: var(--ink); font-weight: 650; font-size: .98rem; margin-bottom: .35rem; }
.task-meta { color: var(--muted); font-size: .78rem; display: flex; flex-wrap: wrap; gap: .45rem .9rem; }
.pill {
    display: inline-flex; align-items: center; border-radius: 999px;
    padding: 0.12rem 0.55rem; font-size: 0.7rem; font-weight: 650;
}
.pill.high { background: var(--red-soft); color: #b91c1c; }
.pill.medium { background: var(--amber-soft); color: var(--amber); }
.pill.low { background: var(--green-soft); color: var(--green); }
.pill.subject { background: var(--blue-soft); color: #1d4ed8; }
.pill.done { background: var(--green-soft); color: var(--green); }
.pill.overdue { background: var(--red-soft); color: var(--red); }
.empty {
    background: #ffffff; border: 1px dashed #cbd5e1; border-radius: 14px;
    padding: 2rem 1.5rem; text-align: center; color: var(--muted);
}
.empty h4 { color: var(--ink); margin: .15rem 0 .35rem 0; font-size: 1.02rem; }
.empty p { margin: 0 auto .9rem auto; max-width: 460px; font-size: .88rem; }
.timeline-item {
    background: #ffffff; border: 1px solid var(--line); border-left: 4px solid var(--indigo);
    border-radius: 12px; padding: .9rem 1rem; margin-bottom: .65rem;
}
.timeline-time { color: var(--indigo); font-weight: 700; font-size: .82rem; letter-spacing: .02em; }
.timeline-title { color: var(--ink); font-weight: 650; margin: .18rem 0; }
.timeline-note { color: var(--muted); font-size: .77rem; }
.mode-badge {
    display: inline-block; padding: .16rem .55rem; border-radius: 999px;
    font-size: .68rem; font-weight: 700; letter-spacing: .03em; margin-bottom: .45rem;
}
.mode-badge.ai { background: var(--indigo-soft); color: var(--indigo); }
.mode-badge.local { background: var(--amber-soft); color: var(--amber); }
.mode-badge.error { background: var(--red-soft); color: var(--red); }
.example {
    background: #f8faff; border: 1px solid #dbe4ff; border-radius: 12px;
    padding: .8rem 1rem; color: #334155; font-size: .86rem; margin-bottom: 1rem;
}
.plan-summary { display: flex; gap: .8rem; flex-wrap: wrap; margin: .4rem 0 1rem 0; }
.plan-chip { background: #fff; border: 1px solid var(--line); border-radius: 10px; padding: .55rem .8rem; font-size: .78rem; color: #475569; }
.plan-chip b { color: var(--ink); }
div.stButton > button {
    border-radius: 9px; border: 1px solid #dbe2ea; font-weight: 600;
    transition: all .15s ease;
}
div.stButton > button[kind="primary"] {
    background: linear-gradient(135deg, #4f46e5, #6366f1); border: none;
    box-shadow: 0 5px 14px rgba(79,70,229,.20);
}
div.stButton > button[kind="primary"]:hover { filter: brightness(1.04); }
div.stButton > button:hover { border-color: #a5b4fc; color: #3730a3; }
[data-testid="stChatMessage"] {
    background: #ffffff; border: 1px solid var(--line); border-radius: 14px;
    padding: .85rem 1rem; margin-bottom: .65rem; box-shadow: 0 3px 12px rgba(15,23,42,.025);
}
[data-testid="stChatMessage"] p { color: #1e293b; }
[data-testid="stForm"] {
    background: #ffffff; border: 1px solid var(--line); border-radius: 14px;
    padding: 1rem 1.05rem;
}
[data-testid="stMetric"] { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: .6rem .8rem; }
.stProgress > div > div > div > div { background: linear-gradient(90deg, #4f46e5, #818cf8); }
@media (max-width: 720px) {
    .hero h1 { font-size: 1.65rem; }
    .stat-card { flex-basis: 44%; }
    .block-container { padding-left: 1rem; padding-right: 1rem; }
}
</style>
"""
st.markdown(CSS, unsafe_allow_html=True)


@st.cache_resource
def get_database() -> Database:
    return Database()


def get_toolbox() -> TaskToolbox:
    return TaskToolbox(get_database())


def get_agent() -> AIStudyAgent:
    return AIStudyAgent(get_database(), get_toolbox())


def flash(kind: str, message: str) -> None:
    st.session_state["_flash"] = (kind, message)


def show_flash() -> None:
    payload = st.session_state.pop("_flash", None)
    if not payload:
        return
    kind, message = payload
    if kind == "success":
        st.success(message)
    elif kind == "warning":
        st.warning(message)
    elif kind == "error":
        st.error(message)
    else:
        st.info(message)


def navigate(page: str) -> None:
    st.session_state["nav_target"] = page
    st.rerun()


def esc(value: Any) -> str:
    return html.escape(str(value)) if value is not None else ""


def friendly_date(iso_date: Optional[str]) -> str:
    if not iso_date:
        return ""
    try:
        return datetime.strptime(iso_date, "%Y-%m-%d").strftime("%a, %b %d")
    except ValueError:
        return iso_date


def due_label(task: dict[str, Any]) -> str:
    due = task.get("due_date")
    if not due:
        return ""
    today = date.today()
    try:
        due_day = date.fromisoformat(due)
    except ValueError:
        return f"Due {due}"
    difference = (due_day - today).days
    if difference < 0:
        return f"Overdue by {abs(difference)} day(s)"
    if difference == 0:
        return "Due today"
    if difference == 1:
        return "Due tomorrow"
    return f"Due in {difference} days"


def priority_pill(priority: str) -> str:
    klass = priority.lower() if priority.lower() in PRIORITIES else "medium"
    return f'<span class="pill {klass}">{esc(priority)}</span>'


def task_html(task: dict[str, Any], *, include_subject: bool = True) -> str:
    meta = []
    if include_subject:
        meta.append(f'<span class="pill subject">{esc(task.get("subject", "General"))}</span>')
    meta.append(priority_pill(task.get("priority", "Medium")))
    if task.get("due_date"):
        overdue = task["due_date"] < date.today().isoformat() and task.get("status") == "pending"
        klass = "overdue" if overdue else ""
        meta.append(f'<span class="pill {klass}">{esc(due_label(task))}</span>')
    if task.get("planned_date"):
        meta.append(f'<span class="pill">Plan: {esc(friendly_date(task["planned_date"]))}</span>')
    if task.get("estimated_minutes"):
        meta.append(f'<span class="task-meta">{int(task["estimated_minutes"])} min</span>')
    if task.get("status") == "completed":
        meta.append('<span class="pill done">Completed</span>')
    return (
        f'<div class="task-title">{esc(task.get("title", "Untitled"))}</div>'
        f'<div class="task-meta">{"".join(meta)}</div>'
    )


def stat_cards(stats: dict[str, int], today_count: int, upcoming_count: int) -> None:
    st.markdown(
        f"""
        <div class="stat-grid">
            <div class="stat-card indigo">
                <div class="stat-label">Pending</div>
                <div class="stat-value">{stats["pending"]}</div>
                <div class="stat-hint">tasks not completed</div>
            </div>
            <div class="stat-card amber">
                <div class="stat-label">Today</div>
                <div class="stat-value">{today_count}</div>
                <div class="stat-hint">planned or due today</div>
            </div>
            <div class="stat-card green">
                <div class="stat-label">Completed</div>
                <div class="stat-value">{stats["completed"]}</div>
                <div class="stat-hint">{stats["completion_rate"]}% overall completion</div>
            </div>
            <div class="stat-card red">
                <div class="stat-label">Upcoming / Overdue</div>
                <div class="stat-value">{upcoming_count} / {stats["overdue"]}</div>
                <div class="stat-hint">next 7 days / past due</div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def mark_complete(task_id: int) -> None:
    result = get_toolbox().execute("mark_task_completed", {"task_id": task_id})
    if result.ok:
        flash("success", result.message)
    else:
        flash("error", result.message)
    st.rerun()


def delete_with_confirmation(task: dict[str, Any], key_prefix: str) -> None:
    with st.popover("Delete", key=f"{key_prefix}_pop_{task['id']}", width="stretch"):
        st.caption(f"Delete task #{task['id']} \"{task['title']}\"? This cannot be undone.")
        confirmed = st.checkbox(
            "I understand this cannot be undone.",
            key=f"{key_prefix}_del_confirm_{task['id']}",
        )
        if st.button(
            "Confirm delete",
            key=f"{key_prefix}_del_{task['id']}",
            type="primary",
            disabled=not confirmed,
            width="stretch",
        ):
            result = get_toolbox().execute(
                "delete_task", {"task_id": task["id"], "confirmed": True}
            )
            if result.ok:
                flash("success", result.message)
            else:
                flash("error", result.message)
            st.rerun()


def render_task_row(task: dict[str, Any], *, key_prefix: str) -> None:
    with st.container(border=True):
        info_col, action_col = st.columns([5.2, 1.8], vertical_alignment="center")
        with info_col:
            st.markdown(task_html(task), unsafe_allow_html=True)
        with action_col:
            if task["status"] == "pending" and st.button(
                "Mark complete",
                key=f"{key_prefix}_complete_{task['id']}",
                width="stretch",
            ):
                mark_complete(task["id"])
            delete_with_confirmation(task, key_prefix)


def empty_state(title: str, message: str, button_label: Optional[str] = None, page: Optional[str] = None) -> None:
    st.markdown(
        f'<div class="empty"><h4>{esc(title)}</h4><p>{esc(message)}</p></div>',
        unsafe_allow_html=True,
    )
    if button_label and page:
        _, center, _ = st.columns([1, 1.5, 1])
        with center:
            if st.button(button_label, type="primary", width="stretch"):
                navigate(page)


def page_header(title: str, subtitle: str, show_date: bool = True) -> None:
    chip = ""
    if show_date:
        chip = f'<div class="date-chip">{date.today().strftime("%A, %B %d, %Y")}</div>'
    st.markdown(
        f'<div class="hero"><div><h1>{esc(title)}</h1><p>{esc(subtitle)}</p></div>{chip}</div>',
        unsafe_allow_html=True,
    )


def render_dashboard() -> None:
    db = get_database()
    page_header(
        "Your study command center",
        "Plan focused sessions, keep deadlines visible, and let the AI agent turn natural language into an actionable plan.",
    )
    show_flash()

    stats = db.get_stats()
    today_tasks = db.today_tasks()
    upcoming = db.upcoming_deadlines(7)
    stat_cards(stats, len(today_tasks), len(upcoming))

    st.progress(
        stats["completion_rate"] / 100 if stats["total"] else 0.0,
        text=f"Overall completion: {stats['completed']} of {stats['total']} saved tasks ({stats['completion_rate']}%)",
    )

    left, right = st.columns([1.55, 1], gap="large")
    with left:
        st.markdown(
            '<div class="section-head"><h3>Today\'s focus</h3><span>planned or due today</span></div>',
            unsafe_allow_html=True,
        )
        if today_tasks:
            for task in today_tasks:
                render_task_row(task, key_prefix="dash_today")
        else:
            empty_state(
                "Nothing scheduled for today",
                "Add a task or ask the AI agent to build tomorrow's study plan.",
                "Add a task",
                "My Tasks",
            )

        st.markdown(
            '<div class="section-head"><h3>Upcoming deadlines</h3><span>next 7 days</span></div>',
            unsafe_allow_html=True,
        )
        if upcoming:
            for task in upcoming:
                st.markdown(
                    f'<div class="task-card">{task_html(task)}</div>',
                    unsafe_allow_html=True,
                )
        else:
            st.markdown(
                '<div class="empty"><h4>No deadlines in the next week</h4>'
                "<p>That is good news. Add due dates when you have real deadlines.</p></div>",
                unsafe_allow_html=True,
            )

    with right:
        st.markdown(
            '<div class="section-head"><h3>Next actions</h3><span>quick links</span></div>',
            unsafe_allow_html=True,
        )
        if st.button("Ask the AI agent", type="primary", width="stretch"):
            navigate("AI Agent")
        if st.button("Add a task manually", width="stretch"):
            navigate("My Tasks")
        if st.button("Build a study plan", width="stretch"):
            navigate("Study Plan")

        st.markdown(
            '<div class="section-head"><h3>Agent status</h3><span>configuration</span></div>',
            unsafe_allow_html=True,
        )
        agent = get_agent()
        if agent.configured:
            st.markdown(
                f'<div class="side-status"><span class="dot on"></span>'
                f"Gemini ready - <b>{esc(agent.model)}</b></div>",
                unsafe_allow_html=True,
            )
        else:
            st.markdown(
                '<div class="side-status"><span class="dot off"></span>'
                "Local fallback active - add a Gemini key in Settings</div>",
                unsafe_allow_html=True,
            )

        st.markdown(
            '<div class="section-head"><h3>Pending queue</h3><span>by priority</span></div>',
            unsafe_allow_html=True,
        )
        pending = db.list_tasks("pending")
        if pending:
            for task in pending[:5]:
                st.markdown(
                    f'<div class="task-card">{task_html(task, include_subject=True)}</div>',
                    unsafe_allow_html=True,
                )
            if len(pending) > 5:
                st.caption(f"Plus {len(pending) - 5} more pending task(s) in My Tasks.")
        else:
            st.caption("Your pending queue is clear.")


def render_ai_agent() -> None:
    page_header(
        "AI study agent",
        "Describe what you need to study. The agent extracts tasks, uses validated tools, and waits for your confirmation before saving anything.",
    )
    show_flash()
    agent = get_agent()

    top_left, top_right = st.columns([3, 1])
    with top_left:
        if agent.configured:
            st.markdown(
                f'<span class="mode-badge ai">GEMINI READY - {esc(agent.model)}</span>',
                unsafe_allow_html=True,
            )
        else:
            st.markdown(
                '<span class="mode-badge local">LOCAL FALLBACK - NO API KEY</span>',
                unsafe_allow_html=True,
            )
    with top_right:
        if st.button("Clear chat", width="stretch"):
            st.session_state["messages"] = []
            st.rerun()

    messages = st.session_state.setdefault("messages", [])
    if not messages:
        st.markdown(
            '<div class="example"><b>Try an instruction:</b><br>'
            "Tomorrow I want to study DSA for two hours, revise probability, "
            "and finish my AI lab assignment.</div>",
            unsafe_allow_html=True,
        )
        st.caption(
            "Read-only and complete-task tools run immediately. New tasks are only "
            "saved after you review the proposal and click Save confirmed tasks."
        )

    for message in messages:
        role = message.get("role", "assistant")
        with st.chat_message(role):
            if role == "user":
                st.markdown(message.get("content", ""))
                continue

            mode = message.get("mode", "fallback")
            badge_class = "ai" if mode == "gemini" else "local"
            badge_text = "GEMINI RESPONSE" if mode == "gemini" else "LOCAL FALLBACK"
            if mode == "error":
                badge_class, badge_text = "error", "REQUEST ERROR"
            st.markdown(
                f'<span class="mode-badge {badge_class}">{badge_text}</span>',
                unsafe_allow_html=True,
            )
            if message.get("warning"):
                st.warning(message["warning"])
            st.markdown(message.get("content", ""))

            events = message.get("tool_events") or []
            if events:
                with st.expander(f"Tool activity ({len(events)})", expanded=False):
                    for event in events:
                        state = "success" if event.get("ok") else "failed"
                        st.markdown(f"**Tool:** `{event.get('tool')}` - {state}")
                        st.caption(event.get("message", ""))
                        st.code(json.dumps(event.get("args", {}), indent=2), language="json")
                        if event.get("result") is not None:
                            st.json(event["result"])

            if message.get("plan"):
                plan = message["plan"]
                st.markdown(
                    f'<div class="plan-summary">'
                    f'<div class="plan-chip"><b>{plan.get("scheduled_minutes", 0)}</b> min scheduled</div>'
                    f'<div class="plan-chip"><b>{plan.get("task_count", 0)}</b> task blocks</div>'
                    f'<div class="plan-chip"><b>{plan.get("remaining_minutes", 0)}</b> min left</div>'
                    f"</div>",
                    unsafe_allow_html=True,
                )

            if message.get("proposed_tasks") and not message.get("saved"):
                render_proposal_editor(message)
            elif message.get("saved"):
                st.success(message.get("save_summary", "Tasks saved."))

    prompt = st.chat_input("Tell the agent what you want to study...")
    if prompt:
        history = [
            {"role": item["role"], "content": item.get("content", "")}
            for item in messages
            if item.get("role") in ("user", "assistant") and item.get("content")
        ]
        messages.append(
            {"id": uuid.uuid4().hex, "role": "user", "content": prompt}
        )
        with st.chat_message("user"):
            st.markdown(prompt)

        with st.status("Working on your request...", expanded=False) as status:
            st.write("Reading your instruction")
            status.update(label="Calling validated agent tools...", state="running")
            try:
                reply = agent.analyze(prompt, history=history)
                st.write("Preparing the response and tool results")
                status.update(label="Request complete", state="complete", expanded=False)
            except Exception as exc:
                status.update(label="Request failed", state="error")
                reply = AgentReply(
                    message=f"I could not process that request: {exc}",
                    mode="error",
                    warning="The request failed. No tasks were saved.",
                )

        messages.append(
            {
                "id": uuid.uuid4().hex,
                "role": "assistant",
                "content": reply.message,
                "mode": reply.mode,
                "warning": reply.warning,
                "tool_events": reply.tool_events,
                "proposed_tasks": reply.proposed_tasks,
                "plan": reply.plan,
                "saved": False,
            }
        )
        st.rerun()


def _clean_cell(value: Any) -> Any:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def render_proposal_editor(message: dict[str, Any]) -> None:
    tasks = message["proposed_tasks"]
    rows = [
        {
            "Title": task.get("title", ""),
            "Subject": task.get("subject", ""),
            "Priority": task.get("priority", "Medium"),
            "Estimated (min)": task.get("estimated_minutes"),
            "Due date (YYYY-MM-DD)": task.get("due_date") or "",
            "Planned date (YYYY-MM-DD)": task.get("planned_date") or "",
        }
        for task in tasks
    ]
    frame = pd.DataFrame(rows)
    st.caption(
        "Review and edit the proposal. Blank durations mean no estimate was given. "
        "Nothing is saved until you confirm."
    )
    edited = st.data_editor(
        frame,
        key=f"proposal_editor_{message['id']}",
        hide_index=True,
        num_rows="dynamic",
        width="stretch",
        column_config={
            "Title": st.column_config.TextColumn("Title", required=True, max_chars=200),
            "Subject": st.column_config.TextColumn("Subject", required=True, max_chars=80),
            "Priority": st.column_config.SelectboxColumn(
                "Priority", options=list(PRIORITIES), required=True
            ),
            "Estimated (min)": st.column_config.NumberColumn(
                "Estimated (min)", min_value=0, max_value=1440, step=5
            ),
            "Due date (YYYY-MM-DD)": st.column_config.TextColumn(
                "Due date (YYYY-MM-DD)", help="Leave blank if no deadline was stated."
            ),
            "Planned date (YYYY-MM-DD)": st.column_config.TextColumn(
                "Planned date (YYYY-MM-DD)", help="Leave blank if no study day was stated."
            ),
        },
    )

    if st.button(
        "Save confirmed tasks",
        key=f"save_proposal_{message['id']}",
        type="primary",
        width="stretch",
    ):
        normalized: list[dict[str, Any]] = []
        errors: list[str] = []
        records = edited.to_dict(orient="records") if isinstance(edited, pd.DataFrame) else []
        for index, row in enumerate(records, start=1):
            title = _clean_cell(row.get("Title"))
            subject = _clean_cell(row.get("Subject"))
            if not title and not subject:
                continue
            try:
                normalized.append(
                    normalize_proposal(
                        {
                            "title": title,
                            "subject": subject,
                            "priority": _clean_cell(row.get("Priority")) or "Medium",
                            "estimated_minutes": _clean_cell(row.get("Estimated (min)")),
                            "due_date": _clean_cell(row.get("Due date (YYYY-MM-DD)")),
                            "planned_date": _clean_cell(row.get("Planned date (YYYY-MM-DD)")),
                        }
                    )
                )
            except ValidationError as exc:
                errors.append(f"Row {index}: {exc}")

        if not normalized and not errors:
            st.error("Add at least one task before saving.")
            return
        if errors:
            st.error("Fix these rows before saving:\n\n" + "\n".join(f"- {item}" for item in errors))
            return

        saved_ids: list[int] = []
        save_errors: list[str] = []
        for task in normalized:
            result = get_toolbox().execute("add_task", task)
            if result.ok and isinstance(result.data, dict):
                saved_ids.append(result.data["id"])
            else:
                save_errors.append(result.message)

        if save_errors:
            st.error(
                f"Saved {len(saved_ids)} task(s), but {len(save_errors)} failed:\n\n"
                + "\n".join(f"- {item}" for item in save_errors)
            )
            if saved_ids:
                message["saved"] = True
                message["save_summary"] = f"Saved {len(saved_ids)} task(s)."
            st.rerun()
        else:
            message["saved"] = True
            message["save_summary"] = (
                f"Saved {len(saved_ids)} task(s): "
                + ", ".join(f"#{task_id}" for task_id in saved_ids)
                + "."
            )
            st.rerun()


def render_my_tasks() -> None:
    db = get_database()
    page_header(
        "My tasks",
        "Add, filter, complete, and delete study tasks. Every change is saved to SQLite immediately.",
    )
    show_flash()

    with st.expander("Add a task manually", expanded=False):
        with st.form("manual_task_form", clear_on_submit=True):
            col1, col2 = st.columns(2)
            with col1:
                title = st.text_input("Task title", max_chars=200, placeholder="Study DSA trees")
                subject = st.text_input("Subject", max_chars=80, placeholder="DSA")
                priority = st.selectbox("Priority", PRIORITIES, index=1)
            with col2:
                estimated = st.number_input(
                    "Estimated minutes (optional)",
                    min_value=0,
                    max_value=1440,
                    value=0,
                    step=5,
                )
                due_date = st.date_input("Due date (optional)", value=None)
                planned_date = st.date_input("Planned study date (optional)", value=None)
            submitted = st.form_submit_button("Add task", type="primary")

        if submitted:
            result = get_toolbox().execute(
                "add_task",
                {
                    "title": title,
                    "subject": subject,
                    "due_date": due_date.isoformat() if due_date else None,
                    "planned_date": planned_date.isoformat() if planned_date else None,
                    "priority": priority,
                    "estimated_minutes": int(estimated) if estimated else None,
                },
            )
            if result.ok:
                flash("success", result.message)
                st.rerun()
            else:
                st.error(result.message)

    filter_col1, filter_col2, filter_col3 = st.columns([1.1, 1.5, 2])
    with filter_col1:
        status_label = st.selectbox("Status", tuple(STATUS_MAP.keys()))
    subjects = db.subjects()
    with filter_col2:
        subject_choice = st.selectbox("Subject", ["All subjects"] + subjects)
    with filter_col3:
        search = st.text_input("Search title", placeholder="Type to filter...")

    tasks = db.list_tasks(
        STATUS_MAP[status_label],
        None if subject_choice == "All subjects" else subject_choice,
    )
    if search.strip():
        needle = search.strip().lower()
        tasks = [task for task in tasks if needle in task["title"].lower()]

    st.markdown(
        f'<div class="section-head"><h3>{len(tasks)} task(s)</h3>'
        f"<span>{esc(status_label.lower())} view</span></div>",
        unsafe_allow_html=True,
    )
    if not tasks:
        empty_state(
            "No tasks match this view",
            "Try another status or subject, or add a new task above.",
        )
        return

    for task in tasks:
        render_task_row(task, key_prefix="tasks")


def render_study_plan() -> None:
    db = get_database()
    page_header(
        "Study plan",
        "Build a time-blocked plan from your saved pending tasks. Missing durations are shown as suggested blocks, not as your estimates.",
    )
    show_flash()

    control1, control2, control3 = st.columns([1.4, 1.6, 1])
    with control1:
        plan_date = st.date_input("Plan date", value=date.today())
    with control2:
        available = st.slider(
            "Available study minutes",
            min_value=30,
            max_value=480,
            value=120,
            step=15,
        )
    with control3:
        start_hour = st.selectbox(
            "Start time",
            options=list(range(6, 23)),
            index=3,
            format_func=lambda hour: f"{hour:02d}:00",
        )

    if st.button("Generate plan", type="primary", width="stretch"):
        tasks = db.tasks_for_date(plan_date.isoformat())
        note = None
        if not tasks:
            tasks = db.list_tasks("pending")
            note = (
                "No tasks were planned or due on this date, so all pending tasks "
                "are shown as a general study queue."
            )
        plan = build_study_plan(
            tasks,
            plan_date,
            available_minutes=available,
            start_hour=start_hour,
            fallback_note=note,
        )
        st.session_state["study_plan"] = plan

    plan = st.session_state.get("study_plan")
    if not plan:
        empty_state(
            "Generate your first plan",
            "Choose a date and a study window, then click Generate plan. The plan is built from tasks already saved in SQLite.",
            "Add a task first",
            "My Tasks",
        )
        return

    if plan["date"] != plan_date.isoformat():
        st.info(
            "The plan below was generated for another date. Click Generate plan to refresh it."
        )

    st.markdown(
        f'<div class="plan-summary">'
        f'<div class="plan-chip">Date: <b>{esc(friendly_date(plan["date"]))}</b></div>'
        f'<div class="plan-chip">Scheduled: <b>{plan["scheduled_minutes"]} min</b></div>'
        f'<div class="plan-chip">Window: <b>{plan["available_minutes"]} min</b></div>'
        f'<div class="plan-chip">Remaining: <b>{plan["remaining_minutes"]} min</b></div>'
        f"</div>",
        unsafe_allow_html=True,
    )

    left, right = st.columns([1.7, 1], gap="large")
    with left:
        st.markdown(
            '<div class="section-head"><h3>Time blocks</h3><span>priority and deadline ordered</span></div>',
            unsafe_allow_html=True,
        )
        if plan["items"]:
            for item in plan["items"]:
                estimate = (
                    f"{item['estimated_minutes']} min estimate"
                    if item["estimate_source"] == "provided"
                    else "no user estimate - 30 min suggested"
                )
                partial = " - partial block" if item["partial"] else ""
                st.markdown(
                    f'<div class="timeline-item">'
                    f'<div class="timeline-time">{esc(item["start_time"])} - {esc(item["end_time"])} '
                    f'({item["allocated_minutes"]} min){esc(partial)}</div>'
                    f'<div class="timeline-title">{esc(item["title"])}</div>'
                    f'<div class="timeline-note">{esc(item["subject"])} | {esc(item["priority"])} | '
                    f"{esc(estimate)}<br>{esc(item['reason'])}</div>"
                    f"</div>",
                    unsafe_allow_html=True,
                )
        else:
            empty_state(
                "No pending tasks to schedule",
                "Add pending tasks with optional durations, then generate the plan again.",
                "Go to My Tasks",
                "My Tasks",
            )

    with right:
        st.markdown(
            '<div class="section-head"><h3>Plan notes</h3><span>how this was built</span></div>',
            unsafe_allow_html=True,
        )
        for note in plan["notes"]:
            st.caption(f"- {note}")
        if plan["unscheduled"]:
            st.markdown(
                '<div class="section-head"><h3>Not scheduled</h3><span>outside the time window</span></div>',
                unsafe_allow_html=True,
            )
            for task in plan["unscheduled"]:
                st.markdown(
                    f'<div class="task-card"><div class="task-title">{esc(task["title"])}</div>'
                    f'<div class="task-meta">{esc(task["reason"])}</div></div>',
                    unsafe_allow_html=True,
                )
        st.markdown(
            '<div class="section-head"><h3>Plain-text plan</h3><span>copy into notes</span></div>',
            unsafe_allow_html=True,
        )
        st.code(format_plan_text(plan), language="text")


def render_settings() -> None:
    page_header(
        "Settings",
        "Configure the Gemini connection, review the fallback behavior, and check where your data is stored.",
    )
    show_flash()
    agent = get_agent()

    if st.button("Reload .env", width="content"):
        load_dotenv(PROJECT_ROOT / ".env", override=True)
        flash("success", ".env reloaded. Provider status below is refreshed.")
        st.rerun()

    st.markdown("### AI provider")
    if agent.configured:
        st.success(f"Gemini is configured for model `{agent.model}`.")
    else:
        st.warning(
            "No Gemini API key found. The app works with a labelled local fallback "
            "for adding, listing, completing, and planning tasks."
        )

    col_a, col_b, col_c = st.columns(3)
    col_a.metric("Provider", "Google Gemini")
    col_b.metric("Model", agent.model)
    col_c.metric("Mode", "Gemini" if agent.configured else "Local fallback")

    if st.button("Test Gemini connection", type="primary"):
        with st.spinner("Sending a minimal test request to Gemini..."):
            ok, message = agent.test_connection()
        if ok:
            st.success(message)
        else:
            st.error(message)

    st.markdown(
        """
        **API key setup**

        1. Create a key in [Google AI Studio](https://aistudio.google.com/app/apikey).
        2. Copy `.env.example` to `.env`.
        3. Set `GEMINI_API_KEY=your_key_here` in `.env`.
        4. Click **Reload .env**, then **Test Gemini connection**.

        The key is read on the server only. It is never displayed in the UI, written to
        SQLite, or logged by this app. Do not commit `.env` to Git.
        """
    )
    st.info(
        "Gemini's free tier is limited and its quotas can change. This project does not "
        "promise unlimited free usage. If you hit HTTP 429, wait and retry or review "
        "your quota in Google AI Studio."
    )

    st.markdown("### Storage and privacy")
    st.write(f"Database file: `{DEFAULT_DB_PATH}`")
    st.caption(
        "Only tasks and their timestamps are stored. Chat messages live in this "
        "Streamlit session and are not written to the database."
    )
    stats = get_database().get_stats()
    st.write(
        f"Saved records: **{stats['total']}** total, **{stats['pending']}** pending, "
        f"**{stats['completed']}** completed."
    )

    st.markdown("### Security model")
    st.markdown(
        "- The AI can call only `propose_tasks`, `list_tasks`, `mark_task_completed`, and `get_study_plan`.\n"
        "- The AI cannot add tasks directly. You confirm proposals before `add_task` runs.\n"
        "- The AI cannot delete tasks. Deletion requires a confirmation checkbox in My Tasks.\n"
        "- No `eval`, `exec`, shell commands, arbitrary file access, or AI-generated Python are used.\n"
        "- Tool parameters are validated against fixed schemas before dispatch."
    )

    st.markdown("### Session")
    if st.button("Clear chat history"):
        st.session_state["messages"] = []
        flash("success", "Chat history cleared from this session.")
        st.rerun()


def main() -> None:
    if "messages" not in st.session_state:
        st.session_state["messages"] = []
    if "nav_page" not in st.session_state:
        st.session_state["nav_page"] = "Dashboard"

    target = st.session_state.pop("nav_target", None)
    if target in PAGES:
        st.session_state["nav_page"] = target

    get_database()
    agent = get_agent()

    with st.sidebar:
        st.markdown(
            """
            <div class="brand">
                <div class="brand-mark">SF</div>
                <div>
                    <div class="brand-title">StudyFlow AI</div>
                    <div class="brand-sub">Personal study planner agent</div>
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )
        page = st.radio(
            "Navigation",
            PAGES,
            key="nav_page",
            label_visibility="collapsed",
        )
        if agent.configured:
            st.markdown(
                f'<div class="side-status"><span class="dot on"></span>'
                f"Gemini connected<br><span style='color:#64748b;font-size:.72rem'>"
                f"{esc(agent.model)}</span></div>",
                unsafe_allow_html=True,
            )
        else:
            st.markdown(
                '<div class="side-status"><span class="dot off"></span>'
                "Local fallback mode<br><span style='color:#64748b;font-size:.72rem'>"
                "Add a Gemini key in Settings</span></div>",
                unsafe_allow_html=True,
            )
        st.caption("SQLite storage | Python + Streamlit")
        if st.button("Clear chat", width="stretch"):
            st.session_state["messages"] = []
            flash("success", "Chat history cleared.")
            st.rerun()

    try:
        if page == "Dashboard":
            render_dashboard()
        elif page == "AI Agent":
            render_ai_agent()
        elif page == "My Tasks":
            render_my_tasks()
        elif page == "Study Plan":
            render_study_plan()
        elif page == "Settings":
            render_settings()
    except (DatabaseError, ValidationError, TaskNotFoundError) as exc:
        st.error(f"Something went wrong while loading this page: {exc}")
        st.caption("Your saved tasks were not changed. Try refreshing the page.")


if __name__ == "__main__":
    main()
