# SDLC Autopilot

## Overview
A React + Vite web application for Technical Program Managers (TPMs) and Product Managers (PMs). It automates conversion of meeting transcripts into actionable SDLC artifacts using AI (Amazon Bedrock with Claude 3.5 Sonnet).

## Key Features
- Upload meeting transcripts (.txt, .docx, .pdf)
- Live voice ingestion / recording
- AI extraction of Jira stories, technical solutions, and QA test cases
- Review pipeline with dependency map visualization (XYFlow/React Flow)
- Artifacts & Sync to push to Jira, Bitbucket, Confluence

## Tech Stack
- **Frontend**: React 19, Vite 8, Tailwind CSS, Lucide React, XYFlow/React Flow
- **Router**: React Router DOM v7
- **Build/Dev**: Vite (port 5000)
- **Integrations**: Atlassian REST APIs (Jira, Bitbucket, Confluence) via Vite proxy

## Project Structure
```
src/
  App.jsx          # Main routing
  pages/
    Dashboard.jsx  # Transcript upload & voice ingestion
    Review.jsx     # Review checkpoint with dependency map
    Handoff.jsx    # Publish artifacts to Jira/Bitbucket/Confluence
  components/
    Layout.jsx     # Shared navigation layout
  mocks/
    index.js       # Mock data for stories, stats, technical options
  index.css        # Global styles/CSS variables
```

## Environment Variables
- `ATLASSIAN_DOMAIN` - Atlassian cloud domain (e.g., company.atlassian.net)
- `ATLASSIAN_EMAIL` - Atlassian account email
- `ATLASSIAN_API_TOKEN` - Atlassian API token
- `JIRA_PROJECT_KEY` - Jira project key (e.g., KAN)

## Development
```bash
npm install
npm run dev   # Runs on port 5000
```

## Deployment
Configured as static site deployment:
- Build: `npm run build`
- Output: `dist/`
