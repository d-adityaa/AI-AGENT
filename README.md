# AI Personal Study Planner Agent

An AI-assisted study planner with validated tools, editable proposals, and honest fallback behavior.

This repository contains two implementations:

- **`web/` — deployable Next.js 16 web app (primary).** Browser-local task storage, Gemini function calling, approval-gated changes, and a deterministic offline fallback.
- **Root — original Python/Streamlit app (preserved).** SQLite persistence and the same study-planning workflow for local desktop use.

Example instruction:

> Tomorrow I want to study DSA for two hours, revise probability, and finish my AI lab assignment.

The agent can turn that into editable proposals without inventing a deadline or an unstated duration.

---

## Web app

### Features

- Dashboard with real task counts, completion rate, today's schedule, and upcoming deadlines.
- AI agent using Gemini native function calling through a server-side API route.
- Strict tool allowlist and Zod validation for every tool name and argument.
- Editable task proposals before saving.
- Approval-gated completion and deletion.
- Task CRUD, filters, title search, completion/reopen, and confirmed deletion.
- Deterministic time-blocked study plans with suggested/partial estimates clearly labelled.
- Activity history stored in the browser.
- Browser-local persistence that survives refreshes.
- Clearly labelled local fallback when no key is configured or Gemini is unavailable.
- Settings page with provider status, a real connection test, and setup instructions.
- No external database, authentication, or server-side task storage.

### Requirements

- Node.js **20.9 or newer** (verified with Node 24.21.0)
- npm (verified with npm 11.19.0)
- Optional: a Google Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

### Windows setup (PowerShell)

```powershell
cd "D:\AI AGENT\ai-study-planner-agent\web"
npm install
Copy-Item .env.example .env.local
notepad .env.local
```

Set the key in `web/.env.local`:

```dotenv
GEMINI_API_KEY=your_real_key_here
GEMINI_MODEL=gemini-3.8-flash
```

`GEMINI_MODEL` is optional. The key must stay server-side: do **not** add a `NEXT_PUBLIC_` prefix and do not commit `.env.local`.

Start the development server:

```powershell
npm run dev
```

Open <http://localhost:3000>.

The app remains usable without a key: manual tasks, filters, planning, and the clearly labelled local agent fallback all work. The connection test will report that no key is configured.

### Production build

```powershell
cd "D:\AI AGENT\ai-study-planner-agent\web"
npm run typecheck
npm run lint
npm run test
npm run build
npm run start
```

Verified in this workspace:

```text
TypeScript: passed
ESLint:     passed
Vitest:     6 files, 69 tests passed
Next build: passed
```

Automated tests mock Gemini requests. They require no API key and no internet access.

### Deploy to Vercel

1. Import the GitHub repository in Vercel.
2. Set **Root Directory** to `web`.
3. Framework preset: **Next.js**.
4. Build command: `npm run build`.
5. Add environment variables under Project Settings:
   - `GEMINI_API_KEY` (required for live Gemini responses)
   - `GEMINI_MODEL` (optional)
6. Deploy or redeploy.

No database or storage integration is required. Tasks are browser-local, so they do not sync between users or devices.

### Web architecture

```text
Browser (React)
  |-- localStorage: tasks, history, model preference
  |-- POST /api/agent
          |
          v
Next.js server route
  |-- reads GEMINI_API_KEY (never sent to the browser)
  |-- calls Gemini generateContent with native function declarations
  |-- validates tool name and arguments against a strict allowlist
  |-- executes read-only tools against the supplied task snapshot
  |-- returns proposals and confirmation-required actions
          |
          v
Browser applies approved mutations to localStorage
```

The server does not add, complete, or delete tasks directly. The browser applies those changes only after the user approves them.

### Agent tools

| Tool | Behavior |
|---|---|
| `add_task` | Validates and returns a task proposal; does not save. |
| `list_tasks` | Read-only lookup in the supplied browser task snapshot. |
| `mark_task_completed` | Returns an approval action; does not mutate server data. |
| `get_study_plan` | Read-only deterministic plan from the supplied tasks. |
| `delete_task` | Returns a confirmation-required action; deletion happens only after UI confirmation. |

Unknown tools, unexpected parameters, invalid dates, invalid durations, and missing task IDs are rejected.

### Gemini configuration

- Default model: `gemini-3.8-flash`
- Supported-model allowlist: `gemini-3.8-flash`, `gemini-3.5-flash-lite`, `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.5-pro`
- API: Gemini `generateContent` with native function calling
- Model documentation: <https://ai.google.dev/gemini-api/docs/models>
- Function calling documentation: <https://ai.google.dev/gemini-api/docs/function-calling>

Model availability and free-tier quotas can change. Use a model that your own Google AI Studio project can access. If the default returns HTTP 404, choose another allowed model in Settings or set `GEMINI_MODEL` and redeploy/restart.

Provider failures are reported honestly:

- 401/403: invalid key or project access
- 404: model unavailable
- 429: rate limit
- 5xx/network/timeout: temporary provider failure

When Gemini fails, the app labels the response as local fallback rather than pretending it came from the LLM.

### Browser-local data

Storage keys:

```text
study-planner.tasks.v1
study-planner.history.v1
study-planner.settings.v1
```

Tasks, activity history, and the model preference stay in this browser. They survive refreshes but do not sync across browsers or devices. Clearing browser site data removes them.

### Web security notes

- The API key is read only from the server environment.
- The key is never returned to the browser, written to localStorage, or included in provider errors (it is redacted if it appears).
- The agent cannot run shell commands, `eval`, or arbitrary code.
- Tool arguments are validated with strict schemas.
- Deletion requires explicit UI confirmation.
- The app never claims a tool ran unless the corresponding change actually happened.
- Chat messages are not persisted; only task changes and activity history are stored locally.

### Web project structure

```text
web/
  app/
    api/agent/route.ts        Gemini agent endpoint
    api/agent/test/route.ts   Real connection test
    api/status/route.ts       Provider status (no key returned)
    agent/page.tsx            Chat and approval UI
    tasks/page.tsx            Task CRUD and filters
    plan/page.tsx             Time-blocked study planner
    history/page.tsx          Local activity history
    settings/page.tsx         Provider, model, setup, privacy
  components/                 Shared UI and forms
  lib/
    agent-tools.ts            Tool declarations and strict dispatch
    agent-fallback.ts         Deterministic rule-based fallback
    server/agent.ts           Gemini function-calling loop
    server/gemini.ts          REST client and honest error mapping
    tasks.ts                  Pure task CRUD and statistics
    study-plan.ts             Deterministic planner
    storage.ts                Validated localStorage access
    use-task-store.tsx        React store and history recording
  tests/                      Vitest unit tests
  .env.example                Placeholders only
```

### Web troubleshooting

**`npm run dev` opens but the agent says no key is configured**

Create `web/.env.local` from `.env.example`, add `GEMINI_API_KEY`, and restart `npm run dev`. Check provider status in Settings.

**HTTP 429 or rate limit**

Free-tier limits are not guaranteed. Wait and retry, reduce usage, or check quota in Google AI Studio. The local fallback remains available.

**HTTP 404 or model unavailable**

Set `GEMINI_MODEL` to a model available in your project and restart/redeploy. The Settings page lists the current server allowlist.

**Tasks disappeared**

Tasks are tied to this browser profile and origin. Clearing site data, changing browsers, or changing the deployed domain can make existing local data unavailable.

**`unrs-resolver` install-script warning**

npm may warn that `unrs-resolver` has an unapproved postinstall script. The install still completes; this workspace built and tested successfully with the warning present.

---

## Original Python/Streamlit app

The original local app remains at the repository root and is unchanged.

### Features

- Streamlit UI with a dashboard, AI agent, tasks, study plan, and settings.
- Gemini native function calling through the `google-genai` SDK.
- Strict Python tool allowlist and validation.
- Editable proposals saved only after confirmation.
- SQLite persistence in `data/study_planner.db`.
- Deterministic planner and clearly labelled local fallback.
- Pytest coverage for validation, persistence, tools, planner, and mocked AI requests.

### Quick start

```powershell
cd "D:\AI AGENT\ai-study-planner-agent"
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
Copy-Item .env.example .env
notepad .env
streamlit run app.py
```

If activation is blocked:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Or run without activation:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m streamlit run app.py
```

### Python tests

```powershell
python -m pytest -q
```

The Python app is intended for local single-user use. It has no login or multi-user separation.

---

## Limitations

- The web app stores data only in the current browser; there is no account, cloud sync, or shared database.
- The fallback parser handles common study instructions, not unrestricted natural language.
- The planner is deterministic, not an optimization solver.
- Gemini model availability, quotas, and data-use terms can change. Re-check Google's official documentation before relying on them for a graded deployment.
- No calendar sync, notifications, or multi-user access is included.
- The web app is a demonstration, not an enterprise-secure multi-tenant service.

## Assignment checklist

- [x] Chat interface with progress and errors
- [x] Natural-language task extraction
- [x] Editable proposals before saving
- [x] Real `add_task`, `list_tasks`, `mark_task_completed`, `get_study_plan`, `delete_task`
- [x] Gemini native function calling with strict allowlist and validation
- [x] Local fallback without an API key
- [x] Browser-local persistence across refreshes
- [x] Dashboard with real statistics and empty states
- [x] Manual add, filters, complete/reopen, and confirmed delete
- [x] No fabricated AI calls or fake statistics
- [x] Unit tests with mocked Gemini requests
- [x] Windows setup, Vercel deployment, and troubleshooting documentation
