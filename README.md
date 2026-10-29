# AI Personal Study Planner Agent

A complete, working college-study planner built with **Python, Streamlit, SQLite, and the Google Gemini API**. You write an instruction in normal English; the agent extracts study tasks, proposes a plan, calls validated Python tools, and saves tasks only after you confirm them.

Example instruction:

> Tomorrow I want to study DSA for two hours, revise probability, and finish my AI lab assignment.

The agent turns that into three editable proposals:

| Task | Subject | Duration | Planned date | Deadline |
|---|---|---|---|---|
| Study DSA | DSA | 120 min | tomorrow | not set |
| Revise probability | Probability | not provided | tomorrow | not set |
| Finish AI lab assignment | AI Lab | not provided | tomorrow | not set |

It does **not** invent a deadline or pretend that an unstated duration was provided.

---

## Features

- **AI chat agent** with Gemini native function calling and a clearly labelled offline fallback.
- **Validated tool layer** for adding, listing, completing, planning, and deleting tasks.
- **Confirmation before saving**: the AI proposes tasks; SQLite is written only after you review and confirm.
- **Editable proposals** using Streamlit's data editor.
- **SQLite persistence** that survives refreshes and restarts.
- **Task dashboard** with real counts, completion percentage, today's tasks, and upcoming deadlines.
- **My Tasks page** with manual add, status/subject filters, title search, complete buttons, and confirmed deletion.
- **Study Plan page** with priority/deadline ordering, time blocks, and honest handling of unknown durations.
- **Settings page** with provider status, a real Gemini connection test, `.env` reload, and privacy notes.
- **Automated tests** for validation, persistence, tool dispatch, fallback parsing, and mocked Gemini function calling.

---

## Tech stack

| Layer | Technology |
|---|---|
| UI | Streamlit |
| AI | Google Gemini via the official `google-genai` Python SDK |
| Storage | SQLite (standard library `sqlite3`) |
| Configuration | `python-dotenv` |
| Tests | `pytest` |

This project was built and tested on **Windows with Python 3.14.7**. It uses no Python 3.14-only syntax and is intended to work on Python 3.11+.

---

## Project structure

```text
ai-study-planner-agent/
├── app.py                     # Streamlit UI and all five pages
├── services/
│   ├── __init__.py
│   ├── ai_agent.py            # Gemini function-calling loop + local fallback
│   ├── database.py            # SQLite schema, validation, persistence
│   ├── study_planner.py       # Deterministic time-block planner
│   └── task_tools.py          # Tool schemas, allowlist, strict dispatch
├── tests/
│   ├── __init__.py
│   ├── test_ai_agent.py       # Mocked AI requests, fallback, security tests
│   ├── test_database.py       # CRUD, invalid inputs, persistence
│   ├── test_study_planner.py  # Ordering, time windows, honest estimates
│   └── test_task_tools.py     # Tool validation and allowlist tests
├── .streamlit/
│   └── config.toml            # Light theme
├── data/
│   └── .gitkeep               # SQLite file is created here automatically
├── .env.example               # Placeholder values only
├── .gitignore
├── pytest.ini
├── requirements.txt
└── README.md
```

The public tool functions required by the assignment are implemented in `services/task_tools.py`:

```python
add_task(title, subject, due_date, priority, estimated_minutes)
list_tasks(status)
mark_task_completed(task_id)
get_study_plan(date)
delete_task(task_id)   # requires explicit confirmation
```

An optional `planned_date` is also supported. It distinguishes "I want to study tomorrow" (a study day) from "the assignment is due tomorrow" (a deadline). This prevents false deadlines.

---

## Architecture

```text
Streamlit UI
   |
   v
AIStudyAgent (services/ai_agent.py)
   |-------------------- Gemini API (google-genai)
   |                         |
   |                         v
   |                    function call request
   |                         |
   v                         v
TaskToolbox allowlist (services/task_tools.py)
   |-- propose_tasks      -> validate only, never saves
   |-- list_tasks         -> read SQLite
   |-- mark_task_completed-> update SQLite
   |-- get_study_plan     -> read tasks + build plan
   |
   |  UI confirmation only
   v
add_task / delete_task -> SQLite
```

### AI provider decision

- Provider: **Google Gemini Developer API**.
- Default model: **`gemini-3.8-flash`**.
- SDK: **`google-genai`**.
- Interface: `client.models.generate_content(...)` with native `FunctionDeclaration` tools.

Official documentation was checked on **2026-10-29**:

- Gemini 3.8 Flash model page: <https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash>
- Function calling: <https://ai.google.dev/gemini-api/docs/function-calling>
- Pricing / free tier: <https://ai.google.dev/gemini-api/docs/pricing>
- Rate limits: <https://ai.google.dev/gemini-api/docs/rate-limits>

At that time, Google's documentation listed `gemini-3.8-flash` as a stable model that supports function calling, and the standard interactive tier was listed as free of charge. **The free tier is limited and can change.** Google does not guarantee fixed free quotas; limits are applied per project and can be viewed in Google AI Studio. Free-tier content may be used to improve Google products. This project does not promise unlimited free usage.

If your key cannot access the default model, set another model available in your project:

```dotenv
GEMINI_MODEL=gemini-3.5-flash-lite
```

Only use a model that your own AI Studio project lists as available.

### Why the AI cannot add or delete directly

The model only sees these four tools:

1. `propose_tasks`
2. `list_tasks`
3. `mark_task_completed`
4. `get_study_plan`

`add_task` runs in trusted Python **after** the user clicks **Save confirmed tasks**. `delete_task` runs only after a confirmation checkbox in **My Tasks**. This satisfies the assignment's security and confirmation requirements. The UI shows the actual tool name, arguments, and returned result; the app never claims a tool ran unless it really did.

### Local fallback

If no API key is configured, or Gemini is unavailable/rate-limited, the app uses a deterministic local rule parser. It is clearly labelled **LOCAL FALLBACK**. It can:

- add/propose tasks from common instruction patterns,
- list pending/completed tasks,
- mark a task completed,
- build a simple study plan from saved tasks.

It is intentionally simple and does not understand every sentence. It is not presented as an AI response.

---

## Windows setup (PowerShell)

Open PowerShell and go to the project folder:

```powershell
cd "D:\AI AGENT\ai-study-planner-agent"
```

### 1. Create and activate a virtual environment

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks activation, allow it for the current process:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

### 2. Install dependencies

```powershell
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

### 3. Configure the Gemini key

```powershell
Copy-Item .env.example .env
notepad .env
```

Replace the placeholder:

```dotenv
GEMINI_API_KEY=your_real_key_here
GEMINI_MODEL=gemini-3.8-flash
```

Get a key from Google AI Studio: <https://aistudio.google.com/app/apikey>

Never commit `.env`. It is already listed in `.gitignore`.

### 4. Run the app

```powershell
streamlit run app.py
```

Open the URL Streamlit prints, usually <http://localhost:8501>.

### If activation is blocked or unnecessary

You can run everything without activating the environment:

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m streamlit run app.py
```

This is the recommended fallback if `Activate.ps1` is restricted by your college machine.

---

## Run the tests

```powershell
python -m pytest -q
```

Without activation:

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Latest verified result in this workspace:

```text
..................................................                       [100%]
50 passed
```

Tests mock all Gemini requests. They require **no API key and no internet access**.

Useful checks:

```powershell
python -m compileall app.py services tests
python -c "import app; print('app imports successfully')"
```

---

## How to use the app

### Dashboard

- Shows real task counts from SQLite.
- Displays today's planned/due tasks and the next 7 days of deadlines.
- Completion progress is `completed / total` saved records.
- Quick links navigate to the agent, manual add, and study plan pages.

### AI Agent

1. Type an instruction such as the example above.
2. The progress panel shows when the agent is working.
3. Read the response and expand **Tool activity** to see the actual tool call and result.
4. Edit the proposed rows if needed.
5. Click **Save confirmed tasks**.
6. The saved tasks appear on the dashboard and My Tasks page.

Commands that operate on existing data run immediately:

- "Show my pending tasks"
- "Mark task 3 complete"
- "Make a study plan for tomorrow"

Deletion from chat is intentionally refused. Use **My Tasks -> Delete -> confirm checkbox**.

### My Tasks

- Add a task with optional due date and planned study date.
- Filter by status and subject, or search the title.
- Mark a task complete.
- Delete only after checking the confirmation box.

### Study Plan

- Choose a date, available minutes, and start hour.
- Click **Generate plan**.
- The planner orders tasks by overdue status, due date, priority, and planned date.
- If a task has no duration, a 30-minute block is explicitly labelled **suggested**.
- If a task is longer than the remaining window, the block is labelled **partial**.
- Unscheduled tasks are listed separately.

### Settings

- See whether Gemini is configured and which model is used.
- Test the live Gemini connection.
- Reload `.env` after editing it.
- Review storage, privacy, and security details.
- Clear session chat history.

---

## Data model

`data/study_planner.db` is created automatically.

```sql
CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    subject TEXT NOT NULL,
    due_date TEXT,              -- YYYY-MM-DD or NULL
    planned_date TEXT,          -- YYYY-MM-DD or NULL
    priority TEXT NOT NULL,     -- Low, Medium, High
    estimated_minutes INTEGER,  -- 5..1440 or NULL
    status TEXT NOT NULL,       -- pending, completed
    created_at TEXT NOT NULL,
    completed_at TEXT
);
```

Validation covers:

- non-empty titles and subjects with length limits,
- real ISO dates (rejects `2026-02-30`),
- priorities limited to Low/Medium/High,
- durations limited to whole minutes from 5 to 1440,
- positive numeric task IDs,
- statuses limited to pending/completed/all,
- unexpected tool parameters rejected.

SQL is parameterized, so task text cannot inject SQL.

---

## Security notes

- Strict tool allowlist; unknown tools are rejected.
- No `eval`, `exec`, shell commands, arbitrary file access, or AI-generated Python execution.
- The AI cannot add or delete records directly.
- Delete requires a separate explicit confirmation.
- API key is read from the server environment only.
- The key is never rendered in the UI, written to SQLite, or included in provider error messages (it is redacted if it appears).
- Only task records are stored. Chat messages remain in the Streamlit session.
- Secrets are excluded by `.gitignore`.

The local fallback also runs through the same validation and dispatch layer. It cannot bypass the allowlist.

---

## Troubleshooting

### `streamlit` is not recognized

The virtual environment is not active. Use:

```powershell
.\.venv\Scripts\python.exe -m streamlit run app.py
```

### `Activate.ps1 cannot be loaded`

Use the process-only execution policy command shown above, or skip activation and call `.venv\Scripts\python.exe` directly.

### `ModuleNotFoundError: No module named 'services'`

Run Streamlit from the project folder:

```powershell
cd "D:\AI AGENT\ai-study-planner-agent"
streamlit run app.py
```

### Gemini says the API key is invalid (401/403)

- Check that `.env` contains the real key with no quotes or extra spaces.
- Click **Reload .env** in Settings.
- Confirm the key is from the correct Google AI Studio project.
- Restart Streamlit after changing `.env` if needed.

### HTTP 429 / rate limit

Free-tier quotas are limited and not guaranteed. Wait and retry, reduce request frequency, or check your quota in Google AI Studio. The app automatically switches to the labelled local fallback rather than inventing an AI answer.

### The model is unavailable (404)

Your key/project may not have access to the default model. Set `GEMINI_MODEL` in `.env` to a model listed for your project, click **Reload .env**, then test again.

### The app shows LOCAL FALLBACK

No key is configured, or Gemini failed. This is deliberate and honest. Add a key in `.env`, reload, and use **Test Gemini connection**. The app remains usable offline.

### Database is locked

Close other copies of the app or SQLite browser tools. The app uses a 15-second connection timeout and short-lived connections. If needed, delete `data/study_planner.db` to reset (this deletes saved tasks).

### PowerShell shows a non-terminating error from `pip`

Check `$LASTEXITCODE`; warnings from pip can appear on stderr without meaning installation failed. Re-run `python -m pip install -r requirements.txt` and verify imports with `python -c "import streamlit, google.genai; print('ok')"`.

---

## Limitations

- The local fallback uses regular expressions and handles common study instructions, not unrestricted natural language.
- The planner is deterministic and does not solve a full scheduling optimization problem; it orders by urgency/priority and fills the chosen time window.
- Study sessions are not stored as a separate schedule. Plans are recomputed from saved tasks, planned dates, and due dates.
- There is no login or multi-user separation. It is a single-student local app.
- Deleting the SQLite file deletes all saved tasks.
- Gemini availability, model names, free-tier quotas, and data-use terms can change. Re-check Google's official documentation before relying on them for a graded deployment.
- The app does not include calendar sync, notifications, or cloud deployment configuration.

---

## Assignment checklist

- [x] Chat interface with progress and errors
- [x] Natural-language task extraction
- [x] Editable proposed plan before saving
- [x] Real `add_task`, `list_tasks`, `mark_task_completed`, `get_study_plan`, `delete_task`
- [x] Gemini native function calling with strict allowlist and validation
- [x] Local fallback without an API key
- [x] SQLite persistence and automatic schema creation
- [x] Dashboard with real statistics and empty states
- [x] Manual add, filters, complete buttons, confirmed delete
- [x] No fabricated AI calls or fake statistics
- [x] Tests with mocked AI requests
- [x] Windows setup and troubleshooting documentation
