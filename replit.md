# SDLC Autopilot

## Overview
A React + Vite web application for Technical Program Managers (TPMs) and Product Managers (PMs). It converts meeting transcripts and voice recordings into AI-extracted Jira stories, Bitbucket branches, QA test cases, and Confluence documentation.

## Key Features
- **Transcript Upload**: Drag-and-drop .txt, .docx, .pdf files (multi-file batch)
- **Voice Recording**: Real browser microphone capture with live speech-to-text transcript
- **AI Extraction**: Client-side NLP parsing of transcript text → structured stories with AC, QA scenarios, risk flags, technical solution proposals
- **Review Checkpoint**: Story cards with approve/discard/edit, "Approve All", dependency graph (ReactFlow), QA tab with Gherkin scenarios, solution comparison
- **Artifacts & Sync (Handoff)**: Real Jira story creation with full structured content, Bitbucket branch creation, Confluence page publishing
- **Settings**: Live connection status for Jira/Confluence/Bitbucket, configurable workspace/repo/space key

## Tech Stack
- **Frontend**: React 19, Vite 8, CSS custom properties (dark theme)
- **State**: React Context (AppContext) — stories flow from Dashboard → Review → Handoff
- **Router**: React Router DOM v7
- **Visualization**: @xyflow/react (dependency map)
- **File Parsing**: mammoth (docx), FileReader API (txt, pdf)
- **Integrations**: Atlassian REST APIs via Vite dev proxy (Jira, Confluence, Bitbucket)

## Project Structure
```
src/
  App.jsx                  # Root with AppProvider + BrowserRouter
  context/
    AppContext.jsx          # Global state (stories, approvals, results, settings)
  services/
    fileReaderService.js    # Extract text from .txt/.docx/.pdf
    extractionService.js    # Parse transcript → structured story objects
    jiraService.js          # POST /api/jira/issue (proxied)
    confluenceService.js    # POST /api/confluence/content (proxied)
    bitbucketService.js     # POST /api/bitbucket branch creation (proxied)
  pages/
    Dashboard.jsx           # Upload + voice recording + pipeline trigger
    Review.jsx              # Story review with approve/discard/edit
    Handoff.jsx             # Artifact creation & sync
    Settings.jsx            # Atlassian config & connection status
  components/
    Layout.jsx              # Sidebar nav + topbar
  mocks/
    index.js                # Demo data for "Use Demo Data" mode
```

## Vite Proxy Routes
| Path | Target |
|------|--------|
| `/api/jira/*` | `https://{ATLASSIAN_DOMAIN}/rest/api/3` |
| `/api/confluence/*` | `https://{ATLASSIAN_DOMAIN}/wiki/rest/api` |
| `/api/bitbucket/*` | `https://api.bitbucket.org/2.0` |

All proxied calls inject Basic Auth from `ATLASSIAN_EMAIL:ATLASSIAN_API_TOKEN`.

## Environment Variables
- `ATLASSIAN_DOMAIN` — Atlassian cloud domain (e.g., company.atlassian.net)
- `ATLASSIAN_EMAIL` — Atlassian account email
- `ATLASSIAN_API_TOKEN` — Atlassian API token
- `JIRA_PROJECT_KEY` — Jira project key (e.g., KAN)

## Runtime Settings (localStorage)
Configured in the Settings page and persisted to localStorage under `sdlc_settings`:
- `bbWorkspace` — Bitbucket workspace slug
- `bbRepo` — Bitbucket repository slug
- `bbDefaultBranch` — Branch to cut from (default: main)
- `confluenceSpaceKey` — Confluence space key for publishing docs

## Development
```bash
npm install
npm run dev   # Runs on port 5000
```

## Deployment
Configured as static site:
- Build: `npm run build`
- Output: `dist/`

## User Flow
1. **Dashboard**: Upload transcripts OR record voice → "Run AI Extraction Pipeline"
2. **Review**: Approve/edit/discard AI-generated stories → "Push N Stories to Jira"
3. **Handoff**: Stories created in Jira, branches in Bitbucket, doc in Confluence
4. **Settings**: Configure Bitbucket workspace/repo and Confluence space key
