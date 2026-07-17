// Publish manifests: every remote artifact a publish run creates is recorded so
// retries can skip already-created artifacts (idempotency) and a manifest can be
// rolled back in reverse order (sub-tasks → stories → epic; PRs closed, branches
// deleted). Stored in localStorage 'sdlc_publish_manifests' (cap 20, newest first).
import { deleteJiraIssue } from './jiraService';
import { deleteConfluencePage } from './confluenceService';
import { deleteGitBranch, closeGitPR } from './gitService';

const KEY = 'sdlc_publish_manifests';
const CAP = 20;

// artifact types
const JIRA_TYPES = ['jira_epic', 'jira_story', 'jira_subtask', 'jira_qa_subtask'];

// Rollback ordering: children before parents. Lower rank = rolled back first.
const ROLLBACK_RANK = {
  jira_subtask: 0,
  jira_qa_subtask: 0,
  git_pr: 1,
  git_commit: 2,
  git_branch: 3,
  confluence_page: 4,
  jira_story: 5,
  jira_epic: 6
};

const ROLLBACK_ACTION = {
  jira_epic: 'delete',
  jira_story: 'delete',
  jira_subtask: 'delete',
  jira_qa_subtask: 'delete',
  confluence_page: 'delete',
  git_branch: 'delete',
  git_pr: 'close',
  git_commit: 'delete'
};

// Commits cannot be individually removed via API — they disappear with the branch.
const isSupported = (type) => type !== 'git_commit' && ROLLBACK_ACTION[type] != null;

const readManifests = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeManifests = (manifests) => {
  try { localStorage.setItem(KEY, JSON.stringify(manifests)); } catch { /* storage unavailable */ }
};

const readSettings = () => {
  try { return JSON.parse(localStorage.getItem('sdlc_settings') || '{}'); } catch { return {}; }
};

// → {id, scope, startedAt, artifacts: [], status: 'in_progress'}
export const startManifest = (pipelineScope) => {
  const manifest = {
    id: `mf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    scope: pipelineScope || 'local',
    startedAt: new Date().toISOString(),
    artifacts: [],
    status: 'in_progress'
  };
  const manifests = readManifests();
  manifests.unshift(manifest);
  writeManifests(manifests.slice(0, CAP));
  return manifest;
};

// type: 'jira_epic'|'jira_story'|'jira_subtask'|'jira_qa_subtask'|'confluence_page'|'git_branch'|'git_pr'|'git_commit'
export const recordArtifact = (manifestId, { type, key, url, phase, meta } = {}) => {
  const manifests = readManifests();
  const manifest = manifests.find(m => m && m.id === manifestId);
  if (!manifest) return;
  if (!Array.isArray(manifest.artifacts)) manifest.artifacts = [];
  manifest.artifacts.push({
    type: type || 'unknown',
    key: key ?? null,
    url: url ?? null,
    phase: phase ?? null,
    meta: meta ?? {},
    at: new Date().toISOString()
  });
  writeManifests(manifests);
};

export const completeManifest = (manifestId, status = 'completed') => {
  const manifests = readManifests();
  const manifest = manifests.find(m => m && m.id === manifestId);
  if (!manifest) return;
  manifest.status = status;
  manifest.completedAt = new Date().toISOString();
  writeManifests(manifests);
};

export const getManifests = () => readManifests();

// Idempotency lookup: has this manifest already recorded an artifact of `type`
// for the story `matchKey` (meta.storyId)? Pass matchKey = null for singleton
// artifacts such as the epic or the Confluence page.
export const findExisting = (manifest, type, matchKey) => {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  return artifacts.find(a =>
    a && a.type === type && ((a.meta?.storyId ?? null) === (matchKey ?? null))
  ) || null;
};

// Reverse-order rollback plan → [{step, type, key, url, action: 'delete'|'close', supported, meta}]
export const planRollback = (manifest) => {
  const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
  const reversed = artifacts.slice().reverse();
  // Stable sort so sub-tasks are removed before stories before the epic,
  // preserving reverse creation order within each rank.
  const ordered = reversed
    .map((artifact, index) => ({ artifact, index }))
    .sort((x, y) => {
      const rx = ROLLBACK_RANK[x.artifact.type] ?? 99;
      const ry = ROLLBACK_RANK[y.artifact.type] ?? 99;
      return rx - ry || x.index - y.index;
    });
  return ordered.map(({ artifact }, i) => ({
    step: i + 1,
    type: artifact.type,
    key: artifact.key ?? null,
    url: artifact.url ?? null,
    action: ROLLBACK_ACTION[artifact.type] || 'delete',
    supported: isSupported(artifact.type),
    meta: artifact.meta ?? {}
  }));
};

// Executes the rollback plan. dryRun returns the would-be outcome per step
// without calling any remote API. Unsupported / failed steps are reported, not
// fatal — the loop always continues. → [{step, ok, error}]
export const executeRollback = async (manifest, { dryRun = false, settings = null } = {}) => {
  const plan = planRollback(manifest);

  if (dryRun) {
    return plan.map(step => ({
      step: step.step,
      ok: step.supported,
      error: step.supported ? undefined : 'Rollback not supported for this artifact type — remove manually.'
    }));
  }

  const cfg = settings || readSettings();
  const results = [];

  for (const step of plan) {
    if (!step.supported) {
      results.push({ step: step.step, ok: false, error: 'Rollback not supported for this artifact type — remove manually.' });
      continue;
    }
    try {
      let res;
      if (JIRA_TYPES.includes(step.type)) {
        res = await deleteJiraIssue(step.key);
      } else if (step.type === 'confluence_page') {
        res = await deleteConfluencePage(step.meta?.pageId ?? step.key);
      } else if (step.type === 'git_branch') {
        res = await deleteGitBranch(cfg, step.key);
      } else if (step.type === 'git_pr') {
        res = await closeGitPR(cfg, step.meta?.prId ?? step.key);
      } else {
        res = { success: false, error: `Unknown artifact type "${step.type}".` };
      }
      const ok = !res || res.success !== false;
      results.push({ step: step.step, ok, error: ok ? undefined : (res?.error || 'Rollback step failed') });
    } catch (err) {
      results.push({ step: step.step, ok: false, error: err?.message || 'Rollback step failed' });
    }
  }

  if (manifest?.id && results.some(r => r.ok)) {
    completeManifest(manifest.id, 'rolled_back');
  }
  return results;
};
