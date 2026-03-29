# SDLC Autopilot

> **AI-powered sprint automation** — converts meeting transcripts into a complete suite of Atlassian artifacts in a single pipeline run.

SDLC Autopilot listens to (or reads) your sprint planning meetings and automatically creates Jira Epics, Stories, Dev & QA Sub-tasks, Bitbucket feature branches, Pull Requests with AI-generated review checklists, Confluence technical solutioning documents, and sends stakeholder email drafts + Slack/Teams notifications — all without leaving the app.

---

## Table of Contents

1. [How It Works](#how-it-works)
2. [Features](#features)
3. [Tech Stack](#tech-stack)
4. [Architecture](#architecture)
5. [Project Structure](#project-structure)
6. [Pages & User Flow](#pages--user-flow)
7. [Backend API Reference](#backend-api-reference)
8. [Atlassian Integration Details](#atlassian-integration-details)
9. [AI Models Used](#ai-models-used)
10. [Database Schema](#database-schema)
11. [Environment Variables](#environment-variables)
12. [Setup & Running Locally](#setup--running-locally)
13. [Jira Ticket Hierarchy](#jira-ticket-hierarchy)
14. [Code Generation & Solutioning Doc](#code-generation--solutioning-doc)
15. [Migrating to Amazon Q & AWS Bedrock](#migrating-to-amazon-q--aws-bedrock)
16. [Infrastructure Recommendations](#infrastructure-recommendations)

---

## How It Works

The pipeline runs in three sequential phases:

```
Phase 1 — Extract
  Upload transcript files (.txt, .docx, .pdf) or record via mic
  → AI (GPT-4o-mini) extracts structured user stories with:
    title, description, positive & negative acceptance criteria,
    story points, priority, labels, technical notes,
    Gherkin QA scenarios, risk flags, solution options, dependencies

Phase 2 — Review
  Team reviews extracted stories in a two-pane editor:
    → Edit titles, descriptions, AC, story points
    → View dependency graph (ReactFlow)
    → Download .feature files (Gherkin)
    → Approve or discard stories

Phase 3 — Handoff (7 automated sub-phases)
  1. Jira        → Create Epic → Stories → Dev Sub-tasks → QA Sub-tasks → link dependencies
  2. Bitbucket   → Scaffold feature branches per story
  3. PR          → AI-generate PR review checklist → open Pull Request per branch
  4. Code Gen    → Analyse Bitbucket repo → generate code scaffolding per story
                 → generate full technical solutioning document (HTML)
  5. Confluence  → Publish solutioning document as new Confluence page
  6. Email       → AI-generate stakeholder summary email (copy-to-clipboard)
  7. Notify      → Send Slack / Teams / Discord webhook notification
```

---

## Features

### Ingestion
| Feature | Status |
|---|---|
| Drag-and-drop file upload (.txt, .docx, .pdf) | ✅ |
| Voice recording via browser microphone (SpeechRecognition API) | ✅ |
| AI transcript cleanup — removes fillers, fixes punctuation, identifies speakers | ✅ |
| Demo mode ("Use Demo Data") for testing without a real transcript | ✅ |
| Backend + DB health check on dashboard | ✅ |

### Story Extraction
| Feature | Status |
|---|---|
| AI-extracted user stories in "As a / I want / so that" format | ✅ |
| Positive acceptance criteria (happy-path, 3–5 per story) | ✅ |
| Negative acceptance criteria (error cases, edge cases, access control) | ✅ |
| Story point estimation (Fibonacci: 1, 2, 3, 5, 8, 13) | ✅ |
| Priority assignment (High / Medium / Low) | ✅ |
| Technical labels (api, auth, frontend, database…) | ✅ |
| Technical notes per story (implementation hints for developers) | ✅ |
| Gherkin QA scenarios (Feature / Scenario / Given / When / Then) | ✅ |
| Risk flags with severity (warning / error) | ✅ |
| Solution options with pros, cons, complexity, recommended flag | ✅ |
| Story dependency detection (blocks relationship) | ✅ |
| Local fallback parser if AI is unavailable | ✅ |

### Review
| Feature | Status |
|---|---|
| Two-pane story editor (list + detail) | ✅ |
| Inline editing (title, description, AC, story points) | ✅ |
| Dependency graph visualisation (ReactFlow) | ✅ |
| Gherkin `.feature` file download per story | ✅ |
| Per-story approve / discard | ✅ |
| Bulk "Approve All" action | ✅ |
| Story Point Calibration from Jira velocity data | ✅ |

### Jira Integration
| Feature | Status |
|---|---|
| Epic creation per pipeline run | ✅ |
| Story creation with full rich-text ADF (Atlassian Document Format) | ✅ |
| Positive & Negative AC in story description | ✅ |
| Technical notes, risk flags, Gherkin code block in story | ✅ |
| Story points (customfield_10016), priority, labels | ✅ |
| Dev sub-task per story with implementation context | ✅ |
| QA sub-task per story with AI-generated test cases + Gherkin | ✅ |
| Issue link "Blocks" relationship between dependent stories | ✅ |
| Epic link (customfield_10014) with classic-project fallback | ✅ |
| Jira project listing & velocity calibration from Settings | ✅ |

### Bitbucket Integration
| Feature | Status |
|---|---|
| Feature branch creation (`feature/[JIRA-KEY]-[story-slug]`) | ✅ |
| AI-generated PR review checklist (Code Quality, Tests, AC, Security…) | ✅ |
| Pull Request creation with checklist in description | ✅ |
| Workspace & repository discovery from API | ✅ |
| Configurable default/base branch | ✅ |
| Repository file tree analysis for code generation | ✅ |
| Smart file selection based on story labels and title keywords | ✅ |

### Confluence Integration
| Feature | Status |
|---|---|
| Publish AI-generated technical solutioning document as a Confluence page | ✅ |
| Document includes: Executive Summary, Architecture, Per-Story Technical Design, Risk Register, Testing Strategy | ✅ |
| Fallback sprint overview page if solutioning doc unavailable | ✅ |
| Confluence space listing & selection from Settings | ✅ |

### Code Generation
| Feature | Status |
|---|---|
| Per-story code scaffolding matching repo conventions (2–5 files) | ✅ |
| Language-aware generation (JS, TS, Python, Java…) | ✅ |
| Expandable file viewer with copy-to-clipboard | ✅ |
| TODO comments marking where business logic is needed | ✅ |

### Notifications & Email
| Feature | Status |
|---|---|
| Stakeholder email generation (subject + body, plain English) | ✅ |
| Email preview modal with copy-to-clipboard | ✅ |
| Slack webhook notification (Block Kit format with Jira links) | ✅ |
| Microsoft Teams webhook support | ✅ |
| Discord webhook support | ✅ |

### Operations
| Feature | Status |
|---|---|
| Pipeline run history (PostgreSQL) | ✅ |
| Audit log per pipeline (event type + metadata) | ✅ |
| Dashboard stats (runs, stories pushed, time saved, accuracy) | ✅ |
| Settings page with connection status for all integrations | ✅ |

---

## Tech Stack

| Layer | Technology | Version | Purpose |
|---|---|---|---|
| **Frontend** | React | 19 | UI framework |
| **Frontend** | Vite | 8 | Dev server, build tool, reverse proxy |
| **Frontend** | ReactFlow (`@xyflow/react`) | 12 | Dependency graph visualisation |
| **Frontend** | Lucide React | 1.7 | Icon library |
| **Frontend** | React Router DOM | 7 | Client-side routing |
| **Frontend** | clsx | 2 | Conditional CSS class merging |
| **Backend** | Express | 5 | REST API server |
| **Backend** | Node.js | 18+ | Runtime |
| **Database** | PostgreSQL | 14+ | Pipeline & story persistence |
| **Database** | pg (node-postgres) | 8 | PostgreSQL client |
| **File Parsing** | mammoth | 1.12 | Word (.docx) document parsing |
| **AI** | OpenRouter (GPT-4o-mini) | — | Story extraction, code gen, docs, checklists, QA, email |
| **AI** | OpenRouter (Gemini Flash 1.5) | — | Transcript cleanup |
| **Styling** | Custom CSS Variables | — | Dark-theme design system |
| **Fonts** | Google Fonts (Inter, Outfit) | — | Typography |
| **Dev** | concurrently | 9 | Run Express + Vite together |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Browser (React 19 + Vite)                        │
│                                                                         │
│  Dashboard → Review → Handoff → Settings                                │
│  AppContext (React Context) — global story & pipeline state             │
│  localStorage — user settings (Atlassian keys, Slack webhook, etc.)    │
└───────────┬────────────────────────────────────────┬────────────────────┘
            │                                        │
            │ /api/backend/*                         │ /api/jira/*
            │ (JSON REST)                            │ /api/confluence/*
            ▼                                        │ /api/bitbucket/*
┌───────────────────────┐                           │ (Vite proxy injects
│  Express Server       │                           │  Authorization: Basic
│  server.js :3001      │                           │  header from env vars)
│                       │                           ▼
│  /extract             │          ┌────────────────────────────────────┐
│  /clean-transcript    │          │      Atlassian Cloud APIs          │
│  /generate-pr-...     │          │                                    │
│  /generate-qa-tasks   │          │  Jira Cloud REST v3                │
│  /generate-code       │          │  → /rest/api/3/issue               │
│  /generate-sol...doc  │          │  → /rest/api/3/issueLink           │
│  /generate-stak...    │          │  → /rest/api/3/project             │
│  /notify-slack        │          │  → /rest/api/3/search              │
│  /pipelines (CRUD)    │          │                                    │
│  /health              │          │  Confluence REST v2                │
└──────────┬────────────┘          │  → /wiki/rest/api/content          │
           │                       │  → /wiki/rest/api/space            │
           │                       │                                    │
           ▼                       │  Bitbucket Cloud 2.0               │
┌──────────────────────┐           │  → /2.0/repositories/{ws}/{repo}/  │
│  PostgreSQL          │           │     refs/branches                  │
│                      │           │     pullrequests                   │
│  pipeline_runs       │           │     src/{branch}/ (file tree)      │
│  stories             │           │     src/{branch}/{path} (content)  │
│  audit_log           │           └────────────────────────────────────┘
└──────────────────────┘
           │
           ▼
┌──────────────────────┐
│  OpenRouter API      │
│  openrouter.ai/api   │
│                      │
│  GPT-4o-mini         │
│  Gemini Flash 1.5    │
└──────────────────────┘
```

**Key design decision — Vite proxy for Atlassian auth:**
All Atlassian API credentials (`email:api_token`) are stored in server-side environment variables and injected as `Authorization: Basic <base64>` headers by the Vite dev server proxy. The browser never sees the credentials. This avoids CORS issues and credential exposure in the client.

---

## Project Structure

```
SDLC-Automator/
├── server.js                    # Express backend (port 3001)
├── vite.config.js               # Vite dev server + 4 proxy routes
├── package.json                 # All deps (frontend + backend)
├── .env                         # Environment variables (not committed)
│
├── src/
│   ├── main.jsx                 # React entrypoint
│   ├── App.jsx                  # Router + AppProvider wrapper
│   ├── index.css                # Global CSS variables, typography, animations
│   │
│   ├── context/
│   │   └── AppContext.jsx       # Global state (stories, pipeline, settings)
│   │
│   ├── pages/
│   │   ├── Dashboard.jsx        # Phase 1 — ingest transcript
│   │   ├── Dashboard.css
│   │   ├── Review.jsx           # Phase 2 — review & approve stories
│   │   ├── Review.css
│   │   ├── Handoff.jsx          # Phase 3 — push all artifacts
│   │   ├── Handoff.css
│   │   ├── Settings.jsx         # Integration config
│   │   └── Settings.css
│   │
│   ├── services/
│   │   ├── apiService.js        # Backend API client (19 functions)
│   │   ├── extractionService.js # AI extraction + local fallback parser
│   │   ├── fileReaderService.js # .txt / .docx / .pdf text extraction
│   │   ├── jiraService.js       # Jira: Epic, Story, Sub-tasks, links, velocity
│   │   ├── bitbucketService.js  # Bitbucket: branches, PRs, repo analysis
│   │   └── confluenceService.js # Confluence: page creation, space listing
│   │
│   ├── components/
│   │   └── Layout.jsx           # Sidebar nav + topbar (Layout.css)
│   │
│   └── mocks/
│       └── index.js             # Demo stories + mock project stats
│
└── README.md
```

---

## Pages & User Flow

### Dashboard (`/`)

The entry point for every pipeline run.

**What it does:**
- **File Upload** — Drag-and-drop or click to upload `.txt`, `.docx`, or `.pdf` meeting transcripts. Multiple files are concatenated before extraction.
- **Voice Recording** — Uses the browser's native `SpeechRecognition` API to capture live speech. After recording, calls `POST /clean-transcript` (Gemini Flash 1.5) to remove filler words, fix punctuation, and identify speakers.
- **AI Extraction** — Clicking "Run AI Extraction Pipeline" sends the combined text to `POST /extract` (GPT-4o-mini). A pipeline record is created in PostgreSQL, stories are extracted and saved, and the user is redirected to `/review`.
- **Demo Mode** — "Use Demo Data" loads mock stories directly into context for testing without a real transcript or API keys.
- **Health Check** — On mount, calls `GET /health` to verify backend + DB connectivity; shows a status badge.
- **Pipeline History** — Displays stats (total pipeline runs, stories pushed, estimated time saved, accuracy %) loaded from `pipeline_runs` table.

**State managed:** `files`, `isRecording`, `rawTranscript`, `cleanedTranscript`, `isProcessing`, `processingStep`, `backendOk`

---

### Review (`/review`)

A two-pane editor where the team reviews, edits, and approves extracted stories before they are pushed to Jira.

**Left pane — Story list:**
- Each story card shows: title, story points, priority badge, risk count, approval status
- Click to open in the detail pane
- Approve ✓ or Discard ✗ buttons
- "Approve All" bulk action
- "Push N Stories →" button (navigates to `/handoff`)

**Right pane — Story detail (3 tabs):**

1. **Solutioning tab**
   - Full story: title, user-story description, positive acceptance criteria, negative acceptance criteria, technical notes, risk flags (with warning/error severity)
   - Solution options: each option has name, description, pros/cons list, complexity badge (Low/Medium/High), and a "Recommended" indicator; team can select their preferred option
   - Inline edit form for title, description, AC, and story points

2. **QA tab**
   - Gherkin scenarios displayed in a code block
   - "Download .feature" button generates a browser-side `.feature` file with the story's Gherkin content

3. **Dependencies tab**
   - ReactFlow directed graph where nodes are stories and edges are "Blocks" relationships (arrows point from blocker to blocked)
   - Panning and zooming enabled

---

### Handoff (`/handoff`)

The automation engine. Runs 7 sequential phases, showing live status indicators (waiting → active → done/error).

| Phase | What Happens |
|---|---|
| **1. Jira** | Creates one Epic named `"{Project} – {date}"`. For each approved story: creates a Story issue with full ADF (positive AC, negative AC, tech notes, risk flags, Gherkin code block), story points, priority, labels, and Epic Link. Then creates a **Dev sub-task** and a **QA sub-task** (with AI-generated test cases). Finally links story dependencies with "Blocks" issue links. |
| **2. Bitbucket** | Creates a `feature/{JIRA-KEY}-{story-slug}` branch for each story, cut from the configured default branch. |
| **3. PR + Checklist** | For each story: calls `POST /generate-pr-checklist` (AI) to get a markdown checklist with sections for Code Quality, Test Coverage, AC Verification, Security & Performance, Documentation. Opens a Bitbucket PR from the feature branch to the default branch. PR title: `[JIRA-KEY] Story Title`. PR description contains the checklist + a SDLC Autopilot footer. |
| **4. Code Gen** | Calls `fetchRepoContext()` once to read the Bitbucket repo structure and 6 relevant files (2 config + 4 keyword-matched). For each story: calls `POST /generate-code` for 2–5 scaffolding files matching repo conventions. Then calls `POST /generate-solutioning-doc` for a full HTML technical document. |
| **5. Confluence** | Publishes the solutioning document as a new Confluence page in the configured space. Falls back to a basic sprint overview table if document generation failed. |
| **6. Email** | Calls `POST /generate-stakeholder-email` to generate a plain-English email with subject line, feature summary, risks, and next steps. Shown in a modal with copy-to-clipboard. |
| **7. Notifications** | If a webhook URL is configured in Settings, POSTs a Slack Block Kit message via `POST /notify-slack` (backend-proxied to avoid CORS) with story count, points, Jira ticket links, and Confluence page link. |

**Results page shows:**
- Jira Stories card — Jira key + link per story
- Branches & PRs card — branch name, PR number + link per story
- Confluence card — link to published doc
- Notifications card — email ready badge + Slack status
- Generated Code Scaffolding card — expandable file list per story with language badge, file path, purpose description, and copy-to-clipboard

---

### Settings (`/settings`)

Configure all integrations. Settings are persisted to `localStorage` under the key `sdlc_settings`.

| Section | Fields |
|---|---|
| **Atlassian Core** | Domain, Email, API Token, Jira Project Key (read from env; shown for reference) |
| **Jira** | Connection status, available projects list, open-in-browser link |
| **Confluence** | Space key input, available spaces dropdown, open-in-browser link |
| **Bitbucket** | Workspace dropdown, repository dropdown, default branch input |
| **Notifications** | Project name (used in emails + Confluence page titles), Slack/Teams/Discord webhook URL |
| **Story Point Calibration** | "Fetch Velocity" button queries Jira completed stories → shows average points, stories-with-points count, total done stories |

---

## Backend API Reference

All endpoints are on `http://localhost:3001`. The Vite proxy forwards `/api/backend/*` → `http://localhost:3001/*`.

### AI Endpoints

| Method | Path | Input | AI Model | Output |
|---|---|---|---|---|
| POST | `/extract` | `{text}` | GPT-4o-mini | `{stories[], model, usage}` |
| POST | `/clean-transcript` | `{rawTranscript}` | Gemini Flash 1.5 | `{cleaned, model, fallback}` |
| POST | `/generate-pr-checklist` | `{story}` | GPT-4o-mini | `{checklist}` (markdown) |
| POST | `/generate-stakeholder-email` | `{stories[], projectName}` | GPT-4o-mini | `{subject, body}` |
| POST | `/generate-qa-tasks` | `{story}` | GPT-4o-mini | `{testCases[]}` |
| POST | `/generate-code` | `{story, repoContext}` | GPT-4o-mini | `{summary, files[]}` |
| POST | `/generate-solutioning-doc` | `{stories[], repoContext, projectName}` | GPT-4o-mini | `{html}` |

**`/extract` — Story Object Shape**
```json
{
  "id": "story-1",
  "title": "User login with JWT",
  "description": "As a registered user, I want to log in with email and password so that I can access my account securely.",
  "acceptanceCriteria": ["User can log in with valid credentials", "..."],
  "negativeAcceptanceCriteria": ["System returns 401 for invalid password", "Account is locked after 5 failed attempts", "..."],
  "storyPoints": 5,
  "adjustedPoints": 5,
  "priority": "High",
  "labels": ["auth", "api"],
  "technicalNotes": "Use bcrypt for password hashing. JWT expiry should be configurable via env var.",
  "qaScenarios": ["Feature: Login\n  Scenario: Valid login\n    Given a registered user..."],
  "riskFlags": [{ "id": "r1", "type": "warning", "text": "JWT secret rotation not yet handled" }],
  "solution": { "options": [{ "id": "s1", "name": "JWT + Redis session", "description": "...", "pros": ["..."], "cons": ["..."], "complexity": "Medium", "recommended": true }] },
  "dependencies": [],
  "status": "pending"
}
```

**`/generate-qa-tasks` — Test Case Shape**
```json
{
  "id": "TC-001",
  "title": "Verify successful login with valid credentials",
  "type": "Positive",
  "priority": "Critical",
  "preconditions": "User has a registered account with verified email",
  "steps": ["Navigate to /login", "Enter valid email", "Enter correct password", "Click 'Sign In'"],
  "expectedResult": "User is redirected to the dashboard; JWT token is stored in httpOnly cookie",
  "relatedAC": 1
}
```

**`/generate-code` — Generated File Shape**
```json
{
  "summary": "Generated auth service, JWT middleware, and test stub",
  "files": [
    {
      "path": "src/services/authService.js",
      "language": "javascript",
      "purpose": "Handles user authentication, JWT generation and verification",
      "content": "import bcrypt from 'bcrypt';\n// TODO: implement signIn\nexport const signIn = async (email, password) => { ... }"
    }
  ]
}
```

### Pipeline Endpoints

| Method | Path | Input | Output |
|---|---|---|---|
| GET | `/pipelines` | — | `pipeline_run[]` (last 20) |
| POST | `/pipelines` | `{fileNames, transcriptSummary}` | Created `pipeline_run` |
| GET | `/pipelines/:id` | — | `{...pipeline, stories[], audit[]}` |
| PATCH | `/pipelines/:id` | `{status, storyCount, approvedCount, jiraKeys, confluenceUrl, notes}` | Updated `pipeline_run` |
| POST | `/pipelines/:id/stories` | `{stories[]}` | `{saved: count}` |
| PATCH | `/pipelines/:id/stories/:storyId` | `{status, jiraKey, bbBranch, approvedAt}` | `{ok: true}` |
| POST | `/pipelines/:id/audit` | `{eventType, eventData}` | Created `audit_log` row |
| GET | `/health` | — | `{status, db}` |

### Notification Endpoint

| Method | Path | Input | Allowed Webhook Domains |
|---|---|---|---|
| POST | `/notify-slack` | `{webhookUrl, message}` | `hooks.slack.com`, `outlook.office.com/webhook/`, `discord.com/api/webhooks/` |

---

## Atlassian Integration Details

### How Auth Works

```
Environment variables → Vite vite.config.js proxy
  ATLASSIAN_EMAIL + ATLASSIAN_API_TOKEN
    → base64(email:token)
    → "Authorization: Basic <base64>" header
    → injected on every /api/jira/*, /api/confluence/*, /api/bitbucket/* request
    → browser never sees the credentials
```

### Jira API Calls

| Action | Endpoint | Method |
|---|---|---|
| Create Epic | `/rest/api/3/issue` | POST |
| Create Story | `/rest/api/3/issue` | POST |
| Create Sub-task | `/rest/api/3/issue` | POST |
| Link Issues | `/rest/api/3/issueLink` | POST |
| List Projects | `/rest/api/3/project` | GET |
| Search (velocity) | `/rest/api/3/search?jql=...` | GET |

**Jira custom fields used:**
- `customfield_10011` — Epic Name (classic Jira projects)
- `customfield_10014` — Epic Link (links story to its parent Epic)
- `customfield_10016` — Story Points (most Jira Cloud instances)
- `customfield_10028` — Story Points fallback field

**Sub-task issue type compatibility:**
The app tries `Subtask`, then `Sub-task`, then `Sub-Task` in order, because different Jira project configurations use different casing.

**Jira ADF (Atlassian Document Format):**
Story descriptions are structured ADF documents (not plain text), rendering with headings, bullet lists, and Gherkin code blocks inside Jira.

### Bitbucket API Calls

| Action | Endpoint | Method |
|---|---|---|
| Create branch | `/2.0/repositories/{ws}/{repo}/refs/branches` | POST |
| Create PR | `/2.0/repositories/{ws}/{repo}/pullrequests` | POST |
| List workspaces | `/2.0/workspaces` | GET |
| List repos | `/2.0/repositories/{ws}?pagelen=25` | GET |
| Repo root listing | `/2.0/repositories/{ws}/{repo}/src/{branch}/` | GET |
| Sub-directory listing | `/2.0/repositories/{ws}/{repo}/src/{branch}/{dir}/` | GET |
| File content | `/2.0/repositories/{ws}/{repo}/src/{branch}/{path}` | GET |

**Branch naming:**  `feature/{JIRA-KEY}-{story-title-slug}` (slug: lowercase alphanumeric + hyphens, max 40 chars)

### Confluence API Calls

| Action | Endpoint | Method |
|---|---|---|
| Create page | `/wiki/rest/api/content` | POST |
| List spaces | `/wiki/rest/api/space?limit=20` | GET |

**Page body representation:** `storage` (Confluence's HTML-like storage format). The solutioning document is pure HTML using standard tags (h1–h4, p, ul, table, pre, code); no Confluence macros required.

---

## AI Models Used

| Model | Via | Endpoint | Temp | Tokens | Purpose |
|---|---|---|---|---|---|
| `openai/gpt-4o-mini` | OpenRouter | `/extract` | 0.3 | 4000 | Story extraction from transcript |
| `google/gemini-flash-1.5` | OpenRouter | `/clean-transcript` | 0.2 | 3000 | Transcript filler removal & formatting |
| `openai/gpt-4o-mini` | OpenRouter | `/generate-pr-checklist` | 0.2 | 800 | PR review checklist |
| `openai/gpt-4o-mini` | OpenRouter | `/generate-stakeholder-email` | 0.3 | 1000 | Stakeholder email draft |
| `openai/gpt-4o-mini` | OpenRouter | `/generate-qa-tasks` | 0.2 | 2500 | Structured QA test cases |
| `openai/gpt-4o-mini` | OpenRouter | `/generate-code` | 0.2 | 3500 | Code scaffolding files |
| `openai/gpt-4o-mini` | OpenRouter | `/generate-solutioning-doc` | 0.3 | 4000 | HTML solutioning document |

**Authentication:** OpenRouter uses the same `Authorization: Bearer <key>` format as OpenAI. The app passes `OPENAI_API_KEY` which should be an OpenRouter API key (`sk-or-...`).

**HTTP-Referer & X-Title headers** are sent to OpenRouter for usage attribution and rate limit tracking.

---

## Database Schema

```sql
-- Pipeline runs (one per session / transcript upload)
CREATE TABLE pipeline_runs (
  id                SERIAL PRIMARY KEY,
  file_names        JSONB,           -- ["meeting.txt", "notes.docx"]
  transcript_summary TEXT,
  status            VARCHAR(50),     -- 'extracting' | 'review' | 'completed'
  story_count       INTEGER,
  approved_count    INTEGER,
  jira_keys         JSONB,           -- ["KAN-10", "KAN-11"]
  confluence_url    TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Individual user stories linked to a pipeline run
CREATE TABLE stories (
  id                VARCHAR(100) PRIMARY KEY,  -- 'story-1', 'story-2'…
  pipeline_id       INTEGER REFERENCES pipeline_runs(id),
  title             TEXT,
  description       TEXT,
  acceptance_criteria  JSONB,   -- string[]
  story_points      INTEGER,
  adjusted_points   INTEGER,
  qa_scenarios      JSONB,      -- string[] (Gherkin)
  risk_flags        JSONB,      -- {id, type, text}[]
  solution          JSONB,      -- {options: [{id, name, description, pros, cons, complexity, recommended}]}
  dependencies      JSONB,      -- string[] (story ids)
  status            VARCHAR(50),  -- 'pending' | 'approved' | 'completed'
  jira_key          VARCHAR(50),  -- 'KAN-10'
  bb_branch         TEXT,         -- 'feature/KAN-10-user-login'
  approved_at       TIMESTAMPTZ
);

-- Audit trail for every significant event in a pipeline
CREATE TABLE audit_log (
  id            SERIAL PRIMARY KEY,
  pipeline_id   INTEGER REFERENCES pipeline_runs(id),
  event_type    VARCHAR(100),   -- 'extraction_completed', 'jira_created'…
  event_data    JSONB,          -- Arbitrary event metadata
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Environment Variables

Create a `.env` file in the project root:

```env
# ── PostgreSQL ─────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://user:password@localhost:5432/sdlc_autopilot

# ── AI (OpenRouter) ────────────────────────────────────────────────────────
# Get your key at https://openrouter.ai/keys
OPENAI_API_KEY=sk-or-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# ── Atlassian (used by Vite proxy to inject Basic Auth header) ─────────────
# Generate your Atlassian API token at:
# https://id.atlassian.com/manage-profile/security/api-tokens
ATLASSIAN_DOMAIN=yourcompany.atlassian.net
ATLASSIAN_EMAIL=your@email.com
ATLASSIAN_API_TOKEN=ATATTxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
JIRA_PROJECT_KEY=KAN
```

> **Note:** `ATLASSIAN_EMAIL` and `ATLASSIAN_API_TOKEN` are combined into a Basic Auth header (`base64(email:token)`) by the Vite dev server proxy and are **never sent to the browser**. The same token works for Jira, Confluence, and Bitbucket Cloud if all are under the same Atlassian account.

---

## Setup & Running Locally

### Prerequisites

- **Node.js** 18 or later
- **PostgreSQL** 14 or later
- **Atlassian account** with API token ([generate here](https://id.atlassian.com/manage-profile/security/api-tokens))
- **OpenRouter account** with API key ([openrouter.ai](https://openrouter.ai/keys))

### 1. Clone and install

```bash
git clone <your-repo-url>
cd SDLC-Automator
npm install
```

### 2. Create your .env file

```bash
cp .env.example .env   # or create manually
# Fill in all values as described in Environment Variables above
```

### 3. Create the database

```bash
psql -U your_user -d postgres -c "CREATE DATABASE sdlc_autopilot;"
psql -U your_user -d sdlc_autopilot < schema.sql
```

Or run the SQL from the [Database Schema](#database-schema) section above manually.

### 4. Start the development server

```bash
npm run dev
```

This uses `concurrently` to run:
- **Vite dev server** on port 5000 (frontend + proxy)
- **Express backend** on port 3001

Open `http://localhost:5000` in your browser.

### Individual commands

```bash
npm run backend    # Express server only
npm run vite       # Vite dev server only
npm run build      # Production build → dist/
npm run preview    # Preview production build
npm run lint       # ESLint check
```

### First run checklist

1. Open `http://localhost:5000` — check that the backend health badge shows "Connected"
2. Go to **Settings** → click "Test Connections" — verify Jira, Confluence, and Bitbucket all show ✓
3. On **Dashboard** → click "Use Demo Data" → click "Push to Review" to test the full pipeline without an OpenRouter key
4. On **Review** → approve all stories → click "Push to Jira"
5. Watch the **Handoff** screen as all 7 phases complete

---

## Jira Ticket Hierarchy

Each pipeline run creates this Jira structure:

```
Epic: "{Project Name} – {Date}"
│   Fields: summary, issuetype=Epic
│
├── Story: "{Story Title}"
│   │   Fields:
│   │     summary (title)
│   │     description (ADF with 6 sections):
│   │       ├── User Story (description text)
│   │       ├── Positive Acceptance Criteria (bullet list)
│   │       ├── Negative Acceptance Criteria (bullet list)
│   │       ├── Technical Notes (paragraph)
│   │       ├── Risk Flags (bullet list, if any)
│   │       └── QA Scenarios (gherkin code block)
│   │     issuetype: Story
│   │     priority: High | Medium | Low
│   │     customfield_10016: story_points
│   │     customfield_10014: epic_key (Epic Link)
│   │     labels: ["api", "auth", ...]
│   │
│   ├── Sub-task: "Dev: {Story Title}"
│   │     Description: implementation notes + technical context
│   │     issuetype: Subtask
│   │
│   └── Sub-task: "QA: {Story Title}"
│         Description (ADF with 4 sections):
│           ├── Testing Scope
│           ├── Acceptance Criteria to Verify (positive + negative)
│           ├── Test Cases (AI-generated, with type/priority/steps)
│           └── Automation Scenarios (Gherkin code block)
│         issuetype: Subtask
│
└── Story: "..." (next story)
        Dependencies linked via Issue Links (type: "Blocks")
```

**Compatibility notes:**
- Epic Name field (`customfield_10011`) is tried first for classic Jira projects; omitted for next-gen projects
- Sub-task issue type casing is tried in order: `Subtask` → `Sub-task` → `Sub-Task`
- Epic Link (`customfield_10014`) creation falls back gracefully if the field doesn't exist in the project

---

## Code Generation & Solutioning Doc

### How repo analysis works

1. **Fetch file tree** — The app calls the Bitbucket `/src/{branch}/` endpoint to get the root directory listing, then drills into up to 4 source subdirectories (`src/`, `app/`, `lib/`, `api/`, `services/`, `components/`, `routes/`, `controllers/`)

2. **Select relevant files** — Files are chosen using two rules:
   - **Always include:** `package.json`, `requirements.txt`, `go.mod`, `index.js/ts`, `app.js/py`, `main.py/ts` (tech stack detection, max 2)
   - **Keyword match:** File paths containing any of the story's labels or significant words from the story title (max 4)

3. **Fetch content** — Selected file contents are fetched (capped at 3000 characters each to manage AI token budget)

4. **Pass to AI** — The repo structure string + file contents are sent to GPT-4o-mini as context

### Generated code output

For each story, the AI returns 2–5 files that:
- Match your repo's naming conventions, folder structure, and import style exactly
- Include proper error handling patterns matching existing code
- Have `// TODO:` comments where business logic needs to be filled in
- Include unit test stubs if test files are detected in the repo

### Solutioning document sections

The generated Confluence document covers:

1. **Executive Summary** — sprint goals, scope, total effort in story points
2. **Current Architecture** — analysis of the existing codebase from fetched files
3. **Per-Story Technical Design** (one section per story):
   - Proposed new files / modifications to existing files
   - API contracts (method, path, request/response shape)
   - Data model changes
   - Component/module interactions
   - Security considerations
   - Performance notes
4. **Cross-Story Integration Points** — shared services, shared data, execution dependencies
5. **Implementation Roadmap** — suggested story implementation order with rationale
6. **Risk Register** — HTML table with Risk | Likelihood | Impact | Mitigation
7. **Testing Strategy** — unit, integration, E2E approach per story

---

## Migrating to Amazon Q & AWS Bedrock

**Current state:** All AI calls use OpenRouter (GPT-4o-mini / Gemini Flash 1.5).

**Target state:** AWS-native AI — Bedrock for code generation + Q Business for solutioning documents.

> **Important:** Amazon Q Developer is an **IDE plugin** (VS Code, JetBrains). It does not expose a public REST API for server-side code generation. For that use case, **Amazon Bedrock** (Claude 3.5 Sonnet) is the correct AWS-native replacement. Amazon Q Business *does* have a REST API and is suitable for knowledge-base-aware document generation.

---

### Step 1 — Replace `POST /generate-code` with Amazon Bedrock

**Service:** Amazon Bedrock Runtime
**Model:** `anthropic.claude-3-5-sonnet-20241022-v2:0`

**1a. Enable model access**
- Open [AWS Bedrock console](https://console.aws.amazon.com/bedrock/home#/model-access)
- Request access to "Claude 3.5 Sonnet" under Anthropic models

**1b. IAM permissions**
```json
{
  "Effect": "Allow",
  "Action": ["bedrock:InvokeModel"],
  "Resource": "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-3-5-sonnet-20241022-v2:0"
}
```

**1c. Install SDK**
```bash
npm install @aws-sdk/client-bedrock-runtime
```

**1d. Replace the OpenRouter fetch in `server.js` `/generate-code` handler**
```javascript
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

const bedrock = new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Replace the fetch() call with:
const command = new InvokeModelCommand({
  modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
  contentType: 'application/json',
  accept: 'application/json',
  body: JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 3500,
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }]
  })
});
const response = await bedrock.send(command);
const body = JSON.parse(Buffer.from(response.body).toString('utf-8'));
const content = body.content?.[0]?.text || '';
```

**Apply the same pattern** to `/extract`, `/generate-pr-checklist`, `/generate-qa-tasks`, `/generate-stakeholder-email`, and `/generate-solutioning-doc` to migrate all GPT-4o-mini calls.

---

### Step 2 — Replace `POST /generate-solutioning-doc` with Amazon Q Business

**Service:** Amazon Q Business
**Use case:** Knowledge-base-aware document generation (can connect Bitbucket/Confluence natively as data sources)

**2a. Create Amazon Q Business application**
- Open [AWS Q Business console](https://console.aws.amazon.com/amazonq/business)
- Create a new application
- Optionally connect a **Bitbucket Data Source** (native connector available) so Q can query your actual codebase

**2b. Install SDK**
```bash
npm install @aws-sdk/client-qbusiness
```

**2c. Replace in `server.js` `/generate-solutioning-doc` handler**
```javascript
import { QBusinessClient, ChatSyncCommand } from '@aws-sdk/client-qbusiness';
import { marked } from 'marked';   // npm install marked

const qbusiness = new QBusinessClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Replace the fetch() call with:
const command = new ChatSyncCommand({
  applicationId: process.env.Q_BUSINESS_APP_ID,
  userMessage: prompt,
  userId: 'sdlc-autopilot-system'
});
const response = await qbusiness.send(command);
// Q Business returns markdown — convert to HTML for Confluence
const html = marked.parse(response.systemMessage || '');
res.json({ html });
```

> **Note:** Amazon Q Business responses are plain text / markdown. Use `marked` (or `remark`) to convert to HTML before passing to `createConfluencePage`.

---

### Step 3 — Replace Gemini Flash with Amazon Transcribe (transcript cleanup)

For voice recording quality, replace browser `SpeechRecognition` + Gemini cleanup with AWS Transcribe:

```bash
npm install @aws-sdk/client-transcribe-streaming
```

Stream audio chunks from the browser microphone → WebSocket to your Express server → `TranscribeStreamingClient` → partial transcripts streamed back to the UI.

---

### Environment variable changes for AWS migration

| Variable | Purpose | When needed |
|---|---|---|
| `AWS_ACCESS_KEY_ID` | AWS credentials | All AWS SDK calls |
| `AWS_SECRET_ACCESS_KEY` | AWS credentials | All AWS SDK calls |
| `AWS_REGION` | AWS region (e.g. `us-east-1`) | All AWS SDK calls |
| `Q_BUSINESS_APP_ID` | Amazon Q Business application ID | Step 2 above |

Once fully migrated to AWS, `OPENAI_API_KEY` (OpenRouter) can be removed.

---

## Infrastructure Recommendations

The following improvements require AWS infrastructure setup beyond code changes alone.

### 1. Replace Browser SpeechRecognition with AWS Transcribe

**Current:** Browser `SpeechRecognition` API — Chrome-only, limited accuracy, no speaker identification
**Target:** AWS Transcribe Streaming or batch job via S3

**Steps:**
1. Install `@aws-sdk/client-transcribe-streaming`
2. Add a WebSocket endpoint in `server.js` that streams audio chunks → AWS Transcribe → partial results back to the client
3. For file uploads, use `StartTranscriptionJobCommand` pointed at an S3 bucket
4. Replace `VoiceInput` component's `SpeechRecognition` with a WebSocket connection to the new endpoint

**Why:** Works across all browsers, handles multiple speakers, supports custom medical/technical vocabularies.

---

### 2. Amazon S3 for Transcript Storage

**Current:** Transcripts live in browser memory only — lost on page refresh
**Target:** Upload transcript text/audio to S3 on pipeline creation

**Steps:**
1. Install `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`
2. In the `POST /pipelines` endpoint, upload the transcript to S3 and store the object key in `pipeline_runs.transcript_s3_key`
3. Add `transcript_s3_key TEXT` column to `pipeline_runs`
4. Generate a pre-signed URL when the user wants to replay or re-extract a past pipeline

**Why:** Full audit trail; enables re-extraction from historical transcripts without re-recording.

---

### 3. Stakeholder Email "Send" via Amazon SES

**Current:** Email draft generated and shown in a copy-to-clipboard modal
**Target:** "Send" button delivers the email via Amazon SES

**Steps:**
1. Verify your sender domain/email in [AWS SES console](https://console.aws.amazon.com/ses) (move out of sandbox for production)
2. Install `@aws-sdk/client-ses`
3. Add `POST /send-email` endpoint in `server.js` using `SendEmailCommand`
4. Validate recipient address server-side
5. In `Handoff.jsx` `EmailModal`, add a recipient input field + "Send via SES" button

**Why:** Closes the stakeholder communication loop without leaving the app.

---

### 4. DynamoDB Migration (Optional)

**Current:** PostgreSQL with 3 relational tables
**Target:** DynamoDB single-table design (original PRD requirement)

**Table design:**
| PK | SK | Data |
|---|---|---|
| `PIPELINE#123` | `META` | status, created_at, file_names… |
| `PIPELINE#123` | `STORY#story-1` | title, description, AC, points… |
| `PIPELINE#123` | `AUDIT#<timestamp>` | event_type, event_data |

**Steps:**
1. Install `@aws-sdk/client-dynamodb` and `@aws-sdk/lib-dynamodb`
2. Replace all `pool.query(...)` calls in `server.js` with `PutCommand`, `GetCommand`, `QueryCommand`
3. Create DynamoDB table with `PK` (string) + `SK` (string) as composite key; enable TTL on `AUDIT#` items

**Why:** Serverless-friendly, no connection pool, auto-scaling, aligns with AWS-native deployment.

---

### 5. AWS Step Functions for Pipeline Orchestration (Optional)

**Current:** All 7 Handoff phases run sequentially in a single browser `async` function
**Target:** Serverless Step Functions state machine

**State machine states:**
```
ExtractStories
  → CreateJiraEpic
  → CreateStories (Map — parallel per story)
      → CreateDevSubTask
      → CreateQASubTask (GenerateQATasks → CreateSubTask)
  → CreateBitbucketBranches (Map — parallel)
  → CreatePRs (Map — GeneratePRChecklist → CreatePR)
  → AnalyseRepo
  → GenerateCode (Map — parallel)
  → GenerateSolutioningDoc
  → PublishConfluence
  → GenerateEmail
  → SendNotifications
```

**Why:** Each state is retried independently on failure; observable in AWS Console; frontend just polls execution status instead of running 7+ API calls itself.
