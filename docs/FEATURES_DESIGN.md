# SDLC Autopilot — Governance & Intelligence Feature Pack: Design Contract

This document is the single source of truth for the feature build. Implementation agents MUST
follow the exact names/signatures here so independently-built pieces compose. All new UI uses the
existing "Priority Liquid Glass" design system (tokens/utilities in `src/index.css`: `.glass-panel`,
`.card`, `.neu`, `.neu-inset`, `.btn*`, `.badge*`, `--brand-gradient`, etc.) and must be responsive
(1024/768/480) like the rest of the app. Every feature must degrade gracefully when AI/Jira/Git/DB
are unconfigured — never a white screen, always an explanatory empty state.

## Feature list (what ships)

1. **RBAC + Admin section** — roles, permissions, admin page to assign roles, demo identity switcher.
2. **Sign-off gates** — named role sign-offs (TPM / Eng Lead / QA Lead) required before story
   generation and publish (solo-mode override).
3. **Grounded extraction** — stories carry transcript citations + confidence; evidence chips in Review.
4. **INVEST / Definition-of-Ready linter** — deterministic, blocks approval, override with reason.
5. **AI PRD linter** — ambiguity/conflict/gap annotations with one-click apply.
6. **PRD versioning & diff** — snapshots, line diff, optional AI change summary, stale-story badges.
7. **Field-level audit trail** — every mutation recorded (human vs AI), history views, revert for PRD.
8. **PII/secret redaction** — regex pass + review modal before any transcript reaches the AI.
9. **Publish manifest + rollback + idempotent retries** — every remote artifact recorded; reverse
   rollback with dry-run preview; retries skip already-created artifacts.
10. **Multi-transcript map-reduce synthesis** — per-file extraction + AI merge with contradiction flags.
11. **Estimation by analogy (light)** — comparable resolved Jira issues per story.
12. **Duplicate detection (light)** — Jira search before publish; link-instead-of-create.
13. **Coding-agent work packets** — `tasks/{KEY}.md` spec files committed instead of blind scaffolds (toggle).
14. **Figma design lane (light)** — figma links on stories, publish-gate warning for frontend stories.
15. **Traceability (Trace page)** — REQ-IDs from PRD → story → Jira live status → branch/PR, Confluence export.
16. **Slack intake (stub)** — `/slack-intake` webhook endpoint + Dashboard inbox card.

## Roles & permissions — `src/services/authzService.js` (NEW)

```js
export const ROLES = ['admin', 'tpm', 'eng_lead', 'qa_lead', 'viewer'];
export const ROLE_LABELS = { admin:'Admin', tpm:'TPM', eng_lead:'Engineering Lead', qa_lead:'QA Lead', viewer:'Viewer' };
// Permission constants:
export const PERMS = {
  MANAGE_USERS:'manage_users', GENERATE_PRD:'generate_prd', EDIT_PRD:'edit_prd',
  GENERATE_STORIES:'generate_stories', EDIT_STORY:'edit_story', APPROVE_STORY:'approve_story',
  SIGNOFF_PRD:'signoff_prd', SIGNOFF_ENGINEERING:'signoff_engineering', SIGNOFF_QA:'signoff_qa',
  PUBLISH:'publish', ROLLBACK:'rollback', OVERRIDE_LINT:'override_lint', VIEW_AUDIT:'view_audit',
};
// Matrix (admin has ALL perms):
// tpm: GENERATE_PRD, EDIT_PRD, GENERATE_STORIES, EDIT_STORY, APPROVE_STORY, SIGNOFF_PRD, PUBLISH, ROLLBACK, OVERRIDE_LINT, VIEW_AUDIT
// eng_lead: EDIT_STORY, SIGNOFF_ENGINEERING, VIEW_AUDIT
// qa_lead: SIGNOFF_QA, VIEW_AUDIT
// viewer: (none — read only)
export const can = (user, perm) => bool          // user = {id,name,role}
export const getUsers = () => [...]              // localStorage 'sdlc_users', seeded on first call
export const saveUsers = (users) => void
export const getCurrentUser = () => user         // localStorage 'sdlc_current_user' (id), default seed admin
export const setCurrentUser = (id) => user
export const SEED_USERS = [
  { id:'u-sarah', name:'Sarah', role:'admin' },   // default current user
  { id:'u-tom',   name:'Tom',   role:'tpm' },
  { id:'u-elena', name:'Elena', role:'eng_lead' },
  { id:'u-quinn', name:'Quinn', role:'qa_lead' },
];
```
Rules: cannot delete/demote the **last remaining admin** (guard in service, error string returned).
There is no real authentication — the topbar has a labeled **demo identity switcher**; the design
must make that honest (tooltip: "Demo identity — connect SSO for real auth").

## Sign-offs — stored per pipeline scope

`src/services/signoffService.js` (NEW). Scope key = `currentPipelineId || 'local'`.
```js
export const SIGNOFF_KINDS = ['prd', 'engineering', 'qa'];  // maps to PERMS.SIGNOFF_*
export const getSignoffs = (scope) => ({ prd:{by,name,at}|null, engineering:…, qa:… })  // localStorage 'sdlc_signoffs'
export const recordSignoff = (scope, kind, user) => signoffs   // also audit-logs
export const revokeSignoff = (scope, kind, user) => signoffs
export const allSignedOff = (scope, settings) => bool          // true immediately if settings.soloMode
```
Gates: PRD page "Generate User Stories" requires `signoffs.prd` (or soloMode). Handoff publish
button requires `allSignedOff`. Review page shows a sign-off panel (three slots, each enabled only
for users holding that perm; shows who signed + when; revoke allowed by signer or admin).

## Audit trail — `src/services/auditService.js` (NEW)

```js
export const recordAudit = ({ action, entityType, entityId, field, before, after, viaAI=false, reason }) => entry
// auto-attaches actor: getCurrentUser() {id,name,role} + ts. Persists to localStorage 'sdlc_audit_trail'
// (array, cap 1000, newest first). Also fire-and-forget mirrors to backend api.logEvent when a
// currentPipelineId exists (pass it via optional pipelineId param).
export const getAudit = (filter={}) => entries   // filter: {entityType, entityId, actorId, action}
export const clearAudit = () => void             // admin only (enforced at call site)
```
Action strings: `story.update`, `story.approve`, `story.discard`, `story.revert`, `prd.save`,
`prd.generate`, `prd.lint_apply`, `signoff.record`, `signoff.revoke`, `lint.override`,
`publish.start`, `publish.artifact`, `publish.complete`, `rollback.execute`, `user.role_change`,
`user.create`, `user.delete`, `redaction.confirm`.
Call sites: AppContext mutators wrap these (see AppContext section).

## INVEST linter — `src/services/lintService.js` (NEW, deterministic, no AI)

```js
export const lintStory = (story, allStories) => ({ errors:[{rule,message}], warnings:[…], score:0-100 })
export const lintAll = (stories) => Map<storyId, result>
```
Rules (errors unless noted): title 8–120 chars; description matches /as an?\b[\s\S]*i want[\s\S]*so that/i
(warning if not); `acceptanceCriteria` length >= 3; no vague words in ACs
(/(fast|easy|user-friendly|appropriately|etc\.?|and so on|intuitive|seamless|robust)/i → error listing the words);
at least one negative/edge AC (/(not|error|invalid|empty|fail|reject|unauthorized|edge)/i → warning);
`points` ∈ {1,2,3,5,8,13} (error) and <= 13; duplicate title among non-discarded stories (error).
Story fields may be missing — treat missing arrays as [].
Review integration: approve button blocked while errors exist; users with OVERRIDE_LINT can
"Override with reason…" (prompt modal → `recordAudit({action:'lint.override', reason})` → approve).

## PRD versions — `src/services/versionService.js` (NEW)

```js
export const snapshotPrd = (prdText, {trigger}) => version  // {id, ts, trigger:'generate'|'save'|'lint_apply', text, reqIds}
export const getVersions = () => versions                    // localStorage 'sdlc_prd_versions', cap 30, newest first
export const diffLines = (oldText, newText) => [{type:'same'|'add'|'del', line}]  // simple LCS or Myers — implement inline, no new deps
export const assignReqIds = (prdText) => [{reqId:'REQ-001', heading, snippet}]    // one per markdown H2/H3 section (or per numbered requirement bullet if no headings)
export const getLatestVersionId = () => id|null
```
Stale detection: when stories are generated, AppContext records `storiesPrdVersionId`. Review shows a
banner + per-story badge "Stale — PRD changed since generation" when `getLatestVersionId() !== storiesPrdVersionId`.
Optional AI diff summary via `api.summarizeDiff(oldText, newText)` — if it fails, show raw diff only.

## Redaction — `src/services/redactionService.js` (NEW)

```js
export const redactText = (text) => ({ redacted, items:[{token:'⟦EMAIL_1⟧', kind:'email', original, count}] })
export const applyUnredact = (redacted, items, keepTokens:Set) => text  // restore items NOT in keepTokens
```
Regexes: emails; phone numbers (international-ish); credit-card numbers (13–19 digits w/ separators,
Luhn-checked); SSN (\d{3}-\d{2}-\d{4}); AWS access keys (AKIA[0-9A-Z]{16}); generic secrets
(/(api[_-]?key|secret|token|password)["'\s:=]+\S{8,}/i); IPv4 addresses.
Flow (Dashboard): if `settings.redactionEnabled !== false`, after reading files and BEFORE any AI
call, run redactText per file; if any items found, open a review modal (list of findings grouped by
kind, each with a keep-redacted toggle, default ON; show masked original like `a***@**.com`).
Confirm → `recordAudit({action:'redaction.confirm'})` → pipeline proceeds with redacted text.
"Cancel" aborts the run. No findings → proceed silently.

## Publish manifest — `src/services/manifestService.js` (NEW)

```js
export const startManifest = (pipelineScope) => manifest  // {id, scope, startedAt, artifacts:[], status:'in_progress'}
export const recordArtifact = (manifestId, { type, key, url, phase, meta }) => void
// type: 'jira_epic'|'jira_story'|'jira_subtask'|'jira_qa_subtask'|'confluence_page'|'git_branch'|'git_pr'|'git_commit'
export const completeManifest = (manifestId, status='completed') => void
export const getManifests = () => manifests               // localStorage 'sdlc_publish_manifests', cap 20
export const findExisting = (manifest, type, matchKey) => artifact|null   // idempotency lookup by meta.storyId+type
export const planRollback = (manifest) => [{step, type, key, url, action:'delete'|'close', supported:bool}]  // reverse order
export const executeRollback = async (manifest, {dryRun}) => [{step, ok, error}]
```
`executeRollback` uses (added in this build): `jiraService.deleteJiraIssue(key)`,
`confluenceService.deleteConfluencePage(pageId)`, `gitService.deleteGitBranch(settings, branch)`,
`gitService.closeGitPR(settings, prId)`. Sub-tasks are deleted before stories before the epic.
Unsupported/failed steps are reported, not fatal. Rollback requires PERMS.ROLLBACK + typed
confirmation ("ROLLBACK"). Handoff idempotency: before each create call, `findExisting` → if hit,
reuse the recorded key/url and mark the phase "skipped (already created)".

## Existing service extensions (same files, NEW exported functions only — do not change existing exports)

- `src/services/jiraService.js`:
  `deleteJiraIssue(key)` (DELETE `/api/jira/issue/{key}?deleteSubtasks=true`),
  `getIssueStatus(key)` (GET `/api/jira/issue/{key}?fields=status,assignee` → {key,status,assignee}|null),
  `findSimilarIssues(text, {maxResults=5, resolvedOnly=true})` — POST `/api/jira/search/jql` (fallback GET `/api/jira/search?jql=`)
  with JQL `text ~ "<first 8 sanitized words>"` (+ `AND statusCategory = Done` when resolvedOnly),
  fields `summary,status,customfield_10016` → [{key,summary,status,points,url}]. Never throws — returns [] on error.
- `src/services/confluenceService.js`: `deleteConfluencePage(pageId)` (DELETE `/api/confluence/content/{pageId}`).
- `src/services/bitbucketService.js`: `deleteBitbucketBranch(workspace, repo, branch)`, `declineBitbucketPR(workspace, repo, prId)`.
- `src/services/githubService.js`: `deleteGithubBranch(owner, repo, branch)` (DELETE git/refs/heads/{branch}), `closeGithubPR(owner, repo, number)` (PATCH state:closed).
- `src/services/gitlabService.js`: `deleteGitlabBranch(project, branch)`, `closeGitlabMR(project, iid)`.
- `src/services/gitService.js`: dispatchers `deleteGitBranch(settings, branch)`, `closeGitPR(settings, prRef)` following the existing provider-dispatch pattern.
- `src/services/apiService.js`: `lintPrd(prdText)` → POST `/lint-prd`; `mergeStories(storySets, fileNames)` → POST `/merge-stories`;
  `summarizeDiff(oldText,newText)` → POST `/summarize-diff`; `fetchIntake()` → GET `/intake`; `dismissIntake(id)` → DELETE `/intake/:id`.
- `src/services/extractionService.js`: multi-file mode — when >1 file, extract per file in parallel
  (existing single-file path per file), then `api.mergeStories(...)`; on merge failure fall back to
  current concat behavior. Returned payload gains optional `contradictions: [{topic, a, b, files}]`.
- `src/services/packetService.js` (NEW): `buildWorkPacket(story, {jiraKey, prdExcerpt, repoLabel, figmaLinks})` → `{ path:'tasks/{jiraKey}.md', content }`
  — markdown with: story, ACs, negative ACs, points, labels, tech notes, Gherkin scenarios (from story.qaScenarios if present), source citations, links (Jira/Figma), and an "Agent instructions" footer for Copilot/Claude Code.
- `src/services/traceService.js` (NEW): `buildTraceRows({stories, approvedStoryIds, jiraIssues, manifests, prdVersions})` →
  [{reqId, prdHeading, storyId, storyTitle, approved, jiraKey, jiraUrl, branch, prUrl, stale}] — pure assembly, no fetching;
  `refreshJiraStatuses(rows)` → polls `getIssueStatus` (Promise.allSettled) → rows with `jiraStatus`.

## Backend — `server.js` (NEW endpoints; follow the existing aiComplete/provider helper patterns in the file)

- `POST /lint-prd` {prdText} → {issues:[{severity:'error'|'warning'|'info', section, quote, issue, suggestion}]}
  — AI critique prompt; strict JSON parsing with the file's existing safe-parse approach; 503 {error} when AI unconfigured.
- `POST /merge-stories` {storySets:[[story…]…], fileNames:[…]} → {stories:[…], contradictions:[{topic,a,b,files}]}
  — AI merge/dedupe/reconcile prompt; keeps citation fields; on AI failure respond 503.
- `POST /summarize-diff` {oldText, newText} → {summary} (3–6 bullets).
- `POST /slack-intake` — Slack Events API shape: respond to `{type:'url_verification'}` with {challenge};
  for `event.type === 'message'` push {id, ts, channel, user, text} into in-memory array (cap 50) +
  `intake_items` table when DB (use safeQuery, CREATE TABLE IF NOT EXISTS on boot next to existing table bootstrap).
- `GET /intake` → {items}; `DELETE /intake/:id` → {ok}.
- **/extract prompt upgrade**: each story additionally returns `confidence` (0–1),
  `sourceQuotes: [{quote, file}]` (verbatim transcript lines it derives from, max 3), and
  `prdSection` (the requirement heading it maps to, when a PRD is the source). Keep the response
  backward compatible — all new fields optional. Update the JSON-schema/instructions block in the prompt.

## AppContext additions (`src/context/AppContext.jsx`)

New state/APIs exposed on the context value (keep every existing key working):
```js
currentUser, users, switchUser(id), refreshUsers(),           // wraps authzService
signoffs, doSignoff(kind), undoSignoff(kind), signoffsComplete, // wraps signoffService, scope = currentPipelineId||'local'
storiesPrdVersionId,                                           // set inside setStoriesFromExtraction
featureFlags: { redactionEnabled, handoffMode, soloMode },     // derived from settings w/ defaults: true, 'packets', false
contradictions, setContradictions,                             // from multi-file merge
```
Mutator wrapping (audit): `updateStory` records per-changed-field `story.update` audits;
`approveStory`/`discardStory` record audits; `setPrdFromGeneration` snapshots a PRD version
(trigger 'generate') + audit `prd.generate`; add `savePrdEdit(text)` helper (snapshot trigger 'save'
+ audit `prd.save`) used by the PRD page. `setStoriesFromExtraction` stores
`storiesPrdVersionId = versionService.getLatestVersionId()` and resets signoffs for the new scope
(engineering/qa only — PRD signoff belongs to the PRD stage).

## Pages

### NEW `src/pages/Admin.jsx` + `Admin.css` — route `/admin`, admin-only
Tabs (glass segmented control like Settings): **Users & Roles** (user cards/table: name, role
select, delete w/ confirm; "Add user" inline form; last-admin guard errors surfaced; role changes
audit-logged), **Governance** (solo-mode toggle writing settings.soloMode + explanation of the three
sign-off gates; handoffMode + redactionEnabled toggles duplicated here for governance visibility),
**Audit Trail** (filterable table: time, actor, role, action, entity, field, before→after (truncated),
AI badge when viaAI; filter selects for action/actor; "Export JSON" download; admin-only Clear),
**Permissions** (static matrix table ROLES × PERMS with check marks).
Non-admins hitting /admin see a friendly "Admins only" empty state (no crash).

### `src/pages/PRD.jsx`
- "AI Review" button → `api.lintPrd` → issues panel (right rail on desktop, stacked mobile):
  severity badge, quote, issue, suggestion + "Apply" (replace first occurrence of quote in the PRD
  text; audit `prd.lint_apply`; unavailable-AI → toast/inline error). 
- Version history drawer: list versions (ts, trigger), select two → line diff view (add/del rows
  tinted with --color-success/--color-error tints) + "AI summary" button (summarizeDiff, optional),
  "Restore this version" (admin/tpm; snapshots current first; audit `story.revert`-style `prd.save`).
- Sign-off strip: "TPM sign-off" chip + button (perm-gated) — generation blocked until signed
  (or soloMode): disable "Generate User Stories" with tooltip.
- Save action routes through `savePrdEdit`.

### `src/pages/Review.jsx`
- Evidence chips per story: `story.sourceQuotes` → chip "n sources" opening a popover listing
  verbatim quotes + file names; confidence badge (≥.8 high/teal, .5–.8 medium/amber, <.5 low/rose +
  "verify manually" note when missing/low). Sort toggle "low confidence first".
- INVEST panel per story card: error/warning count pill; expanding list; approve blocked on errors
  (button disabled + tooltip) unless override (perm OVERRIDE_LINT → reason modal → audit).
- Role gating: approve/discard/edit disabled for viewers etc. per PERMS with tooltips.
- Sign-off panel (top): three slots (PRD / Engineering / QA) with signer+time, sign/revoke buttons
  perm-gated; banner explaining publish unlocks when all three (or soloMode).
- Stale badges: per the versionService section.
- Story History: per-story drawer listing audit entries for that entity.
- Comparables: "Find comparables" button per story (only when Jira configured) → `findSimilarIssues`
  → list of linked issues w/ points; loading/empty/error states inline.
- Duplicate check: "Check duplicates" (same search, resolvedOnly=false) → flag rows with
  "Possible duplicate" + "Link instead of create" toggle setting `story.linkedIssueKey` (Handoff
  then links `Relates`/skips creation for that story).
- Contradictions banner when `contradictions.length` (from multi-file merge) with details popover.
- Figma links: in story edit mode, a "Design links" repeatable URL field (`story.figmaLinks: []`),
  validated against /figma\.com\/(file|design|proto)\//.

### `src/pages/Dashboard.jsx`
- Redaction review modal in the run flow (see redaction section).
- Multi-file uploads use the new per-file extract + merge (extractionService handles it; Dashboard
  shows per-file progress lines + a "Synthesizing across N transcripts…" step; surfaces
  `contradictions` into context).
- "Intake Inbox" card (only when backend reachable): `fetchIntake()` → list of Slack-style items,
  each with "Use as source" (loads text into the run flow) and dismiss; empty state explains the
  `/slack-intake` webhook with a copyable URL.

### `src/pages/Handoff.jsx`
- Publish gate: requires `signoffsComplete` (else the existing gate area shows which sign-offs are
  missing with links back to Review); requires PERMS.PUBLISH.
- Manifest: `startManifest` on publish start; `recordArtifact` after each successful create;
  `completeManifest` at end (status 'failed' on abort). Idempotent retry via `findExisting` — phases
  render "skipped (already created)" state.
- Stories with `linkedIssueKey`: skip creation, link existing issue instead, note in phase log.
- `handoffMode==='packets'` (default): instead of AI scaffold generation+commit, commit one
  `tasks/{JIRA-KEY}.md` work packet per story (packetService) to the branch; scaffold mode remains
  selectable in Settings and keeps current behavior.
- Figma gate warning: pre-publish checklist lists frontend-labeled stories (label match
  /front|ui|ux|design/i) lacking `figmaLinks` — warning only, not blocking.
- REQ-IDs: story's `prdSection`/reqId (from versionService.assignReqIds mapping) added as a Jira
  label (`REQ-###`) on creation.
- Publish history panel: manifests list w/ artifacts count, status, "Rollback…" (perm ROLLBACK) →
  modal: dry-run plan table (step, type, key, action, supported) → typed "ROLLBACK" confirm →
  execute with per-step results; audits `rollback.execute`.

### NEW `src/pages/Trace.jsx` + `Trace.css` — route `/trace`, nav label "Traceability"
Table from `traceService.buildTraceRows` (+ "Refresh Jira status" button → `refreshJiraStatuses`):
columns REQ-ID / PRD section / Story / Approved / Jira (key+status chip) / Branch / PR / Flags
(stale badge, "dropped scope" when a REQ has no non-discarded story). Coverage stat tiles (REQs
covered %, stories published %, stale count). "Export to Confluence" button reusing
`createConfluencePage` with a simple HTML table (only when Confluence configured). Mobile: the
table scrolls horizontally inside its own container. Friendly empty state when no PRD/stories yet.

### `src/pages/Settings.jsx`
New "Governance & Delivery" card in an appropriate tab: handoffMode select (packets|scaffold),
redactionEnabled toggle, soloMode toggle (mirrors Admin), figmaToken password field (stored in
settings; optional — used only for future API enrichment), note pointing to /admin for roles.

### `src/components/Layout.jsx` + `App.jsx` (INTEGRATION agent only)
- Routes: `/admin` → Admin, `/trace` → Trace (inside Layout route).
- Nav: "Traceability" item (Network-style icon) in Main; "Admin" item (Shield icon) in the footer
  next to Settings, hidden unless `can(currentUser, MANAGE_USERS)`.
- Topbar: replace the static "Sarah (TPM)" user chip with the demo identity switcher — glass
  dropdown listing users (name + role label), check on current, switching calls `switchUser` and
  audit-logs nothing (identity change isn't a mutation); footer link "Manage users" → /admin (admin only).
  Keyboard accessible (Esc closes, arrows optional), closes on outside click.

## Storage keys (all JSON, all guarded by try/catch)
`sdlc_users`, `sdlc_current_user`, `sdlc_signoffs` (object keyed by scope), `sdlc_audit_trail`,
`sdlc_prd_versions`, `sdlc_publish_manifests`, plus existing `sdlc_settings`.

## Non-negotiables
- Never rename/remove existing exports, context keys, CSS classes, or routes.
- All fetches: loading + error + empty states; failures degrade with inline messages, no crashes.
- `npx vite build` must pass; no new eslint errors in files you touch.
- New UI text is plain, honest (e.g. demo identity, light integrations labeled as such).
