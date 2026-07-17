import React, { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle, Loader2, FileText, CheckSquare, GitBranch, Send,
  AlertTriangle, ExternalLink, ArrowRight, Copy, Mail, GitPullRequest, X, Code2, Rocket,
  ShieldAlert, History, RotateCcw, Package, PenTool
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { PipelineSteps } from '../components/PipelineSteps';
import {
  createJiraEpic, createJiraStory, createJiraSubTask, createJiraQASubTask,
  linkJiraIssues, resetJiraProjectStyleCache, getJiraBaseUrl
} from '../services/jiraService';
import {
  createGitBranch, createGitPR, getGitBranchName, commitGitFiles, fetchGitRepoContext,
  isGitConfigured, getGitProvider, getGitProviderLabel, getGitRepoLabel, getGitDefaultBranch, getChangeRequestLabel
} from '../services/gitService';
import { createConfluencePage } from '../services/confluenceService';
import { generatePRChecklist, generateStakeholderEmail, notifySlack, generateQATasks, generateCode, generateSolutioningDoc } from '../services/apiService';
import { can, PERMS, ROLE_LABELS } from '../services/authzService';
import { SIGNOFF_KINDS } from '../services/signoffService';
import {
  startManifest, recordArtifact, completeManifest, getManifests,
  findExisting, planRollback, executeRollback
} from '../services/manifestService';
import { recordAudit } from '../services/auditService';
import { assignReqIds } from '../services/versionService';
import { buildWorkPacket } from '../services/packetService';
import './Handoff.css';

// Audit logging must never break the publish flow.
const safeAudit = (entry) => {
  try { recordAudit(entry); } catch (err) { console.warn('Audit log failed:', err?.message); }
};

const jiraBrowseUrl = (key) => {
  if (!key) return null;
  try {
    const base = getJiraBaseUrl();
    if (!base || /^https?:\/\/$/.test(base)) return null;
    return `${base}/browse/${key}`;
  } catch {
    return null;
  }
};

const FRONTEND_LABEL_RE = /front|ui|ux|design/i;

const SIGNOFF_LABELS = { prd: 'PRD (TPM)', engineering: 'Engineering Lead', qa: 'QA Lead' };

const ARTIFACT_TYPE_LABELS = {
  jira_epic: 'Jira Epic',
  jira_story: 'Jira Story',
  jira_subtask: 'Jira Sub-task',
  jira_qa_subtask: 'Jira QA Sub-task',
  confluence_page: 'Confluence Page',
  git_branch: 'Git Branch',
  git_pr: 'Pull Request',
  git_commit: 'Git Commit'
};

const MANIFEST_STATUS_BADGE = {
  in_progress: { className: 'badge badge-warning', label: 'In progress' },
  completed: { className: 'badge badge-success', label: 'Completed' },
  failed: { className: 'badge badge-error', label: 'Failed' },
  rolled_back: { className: 'badge badge-neutral', label: 'Rolled back' }
};

const SyncPhase = ({ label, status }) => (
  <div className={`sync-phase flex items-center gap-3 ${
    status === 'done' ? 'sync-phase--done' :
    status === 'skipped' ? 'sync-phase--skipped' :
    status === 'active' ? 'sync-phase--active glow-border' :
    status === 'error' ? 'sync-phase--error' :
    'sync-phase--waiting'
  }`}>
    {status === 'done' && <CheckCircle size={18} style={{ color: 'var(--color-success)', flexShrink: 0 }} />}
    {status === 'skipped' && <CheckCircle size={18} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />}
    {status === 'active' && <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-primary)', flexShrink: 0 }} />}
    {status === 'error' && <AlertTriangle size={18} style={{ color: 'var(--color-error)', flexShrink: 0 }} />}
    {status === 'waiting' && <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--border-subtle)', flexShrink: 0 }} />}
    <span className="text-sm font-medium">
      {label}{status === 'skipped' ? ' — skipped (already created)' : ''}
    </span>
  </div>
);

const PublishTarget = ({ ready, label, detail, readyText }) => (
  <div className="publish-target flex items-center justify-between">
    <div className="flex items-center gap-2 min-w-0">
      {ready
        ? <CheckCircle size={15} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
        : <AlertTriangle size={15} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />}
      <span className="text-sm font-medium">{label}</span>
    </div>
    <span className="text-xs text-secondary truncate ml-3">{ready ? (readyText || detail) : detail}</span>
  </div>
);

const EmailModal = ({ emailContent, onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = `Subject: ${emailContent.subject}\n\n${emailContent.body}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="modal-overlay flex items-center justify-center">
      <div className="card" style={{ maxWidth: 620, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Mail size={18} style={{ color: 'var(--color-primary)' }} />
            Stakeholder Summary Email
          </h3>
          <button className="btn btn-secondary p-1.5" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="email-well mb-3">
          <span className="text-xs text-tertiary uppercase font-semibold">Subject</span>
          <p className="text-sm font-medium mt-1">{emailContent.subject}</p>
        </div>

        <div className="email-well email-well--body flex-1 overflow-y-auto mb-4 text-sm text-secondary" style={{ minHeight: 120 }}>
          {emailContent.body}
        </div>

        <div className="flex gap-3 justify-end">
          <button className="btn btn-secondary gap-2" onClick={handleCopy}>
            <Copy size={14} /> {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
};

// ── Rollback modal: dry-run plan table → typed ROLLBACK confirm → per-step results ──
const RollbackModal = ({ manifest, settings, currentPipelineId, onClose, onDone }) => {
  const plan = useMemo(() => {
    try { return planRollback(manifest); } catch { return []; }
  }, [manifest]);
  const [confirmText, setConfirmText] = useState('');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState(null);

  const confirmed = confirmText.trim() === 'ROLLBACK';
  const resultFor = (step) => (results || []).find(r => r.step === step);

  const handleExecute = async () => {
    if (!confirmed || running) return;
    setRunning(true);
    let res = [];
    try {
      res = await executeRollback(manifest, { dryRun: false, settings });
    } catch (err) {
      res = [{ step: 0, ok: false, error: err?.message || 'Rollback failed unexpectedly.' }];
    }
    setResults(res);
    setRunning(false);
    safeAudit({
      action: 'rollback.execute',
      entityType: 'manifest',
      entityId: manifest?.id,
      before: manifest?.status,
      after: `${res.filter(r => r.ok).length}/${res.length} steps succeeded`,
      pipelineId: currentPipelineId || undefined
    });
    try { onDone && onDone(); } catch { /* refresh is best-effort */ }
  };

  return (
    <div className="modal-overlay flex items-center justify-center">
      <div className="card" style={{ maxWidth: 720, width: '100%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <RotateCcw size={18} style={{ color: 'var(--color-error)' }} />
            Rollback Publish
          </h3>
          <button className="btn btn-secondary p-1.5" onClick={onClose} disabled={running}><X size={16} /></button>
        </div>

        <p className="text-xs text-secondary mb-3">
          Dry-run preview — artifacts are removed in reverse order (sub-tasks before stories before the epic).
          Nothing is deleted until you type <strong>ROLLBACK</strong> and execute.
        </p>

        {plan.length === 0 ? (
          <p className="text-sm text-tertiary mb-4">This manifest recorded no artifacts — there is nothing to roll back.</p>
        ) : (
          <div className="rollback-table-wrap overflow-x-auto mb-4">
            <table className="rollback-table">
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Type</th>
                  <th>Key</th>
                  <th>Action</th>
                  <th>{results ? 'Result' : 'Supported'}</th>
                </tr>
              </thead>
              <tbody>
                {plan.map(step => {
                  const res = resultFor(step.step);
                  return (
                    <tr key={step.step}>
                      <td className="font-mono">{step.step}</td>
                      <td>{ARTIFACT_TYPE_LABELS[step.type] || step.type}</td>
                      <td className="font-mono">
                        {step.url
                          ? <a href={step.url} target="_blank" rel="noopener noreferrer" className="text-primary">{step.key || '—'}</a>
                          : (step.key || '—')}
                      </td>
                      <td className="uppercase text-xs">{step.action}</td>
                      <td>
                        {results ? (
                          res?.ok
                            ? <span className="badge badge-success">Removed</span>
                            : <span className="badge badge-error" title={res?.error}>{res?.error ? res.error : 'Failed'}</span>
                        ) : (
                          step.supported
                            ? <span className="badge badge-success">Yes</span>
                            : <span className="badge badge-neutral" title="Remove manually">Manual only</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {results ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-secondary">
              {results.filter(r => r.ok).length} of {results.length} steps succeeded.
              {results.some(r => !r.ok) ? ' Failed or unsupported steps must be cleaned up manually.' : ''}
            </p>
            <button className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        ) : (
          <>
            {plan.length > 0 && (
              <div className="mb-4">
                <label className="text-xs text-tertiary uppercase font-semibold" htmlFor="rollback-confirm">
                  Type ROLLBACK to confirm
                </label>
                <input
                  id="rollback-confirm"
                  className="input-field mt-1"
                  value={confirmText}
                  onChange={e => setConfirmText(e.target.value)}
                  placeholder="ROLLBACK"
                  autoComplete="off"
                  disabled={running}
                />
              </div>
            )}
            <div className="flex gap-3 justify-end">
              <button className="btn btn-secondary" onClick={onClose} disabled={running}>Cancel</button>
              {plan.length > 0 && (
                <button
                  className="btn btn-primary btn-danger-solid gap-2"
                  onClick={handleExecute}
                  disabled={!confirmed || running}
                  title={confirmed ? 'Execute rollback' : 'Type ROLLBACK to enable'}
                >
                  {running ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  {running ? 'Rolling back…' : 'Execute Rollback'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

// ── Publish history panel: past manifests + perm-gated rollback ──
const PublishHistory = ({ manifests, canRollback, onRollback }) => {
  if (!manifests || manifests.length === 0) {
    return (
      <div className="card publish-history" style={{ maxWidth: 640, margin: '1.25rem auto 0' }}>
        <div className="flex items-center gap-2 mb-2">
          <History size={16} style={{ color: 'var(--text-tertiary)' }} />
          <h3 className="text-base font-semibold">Publish History</h3>
        </div>
        <p className="text-xs text-tertiary">No publish runs recorded yet. Every publish records its artifacts in a manifest so it can be retried or rolled back.</p>
      </div>
    );
  }

  return (
    <div className="card publish-history" style={{ maxWidth: 640, margin: '1.25rem auto 0' }}>
      <div className="flex items-center gap-2 mb-3">
        <History size={16} style={{ color: 'var(--text-tertiary)' }} />
        <h3 className="text-base font-semibold">Publish History</h3>
      </div>
      <div className="flex-col gap-2 publish-history-list">
        {manifests.map(m => {
          const badge = MANIFEST_STATUS_BADGE[m.status] || { className: 'badge badge-neutral', label: m.status || 'unknown' };
          const count = Array.isArray(m.artifacts) ? m.artifacts.length : 0;
          let when = m.startedAt;
          try { when = new Date(m.startedAt).toLocaleString(); } catch { /* keep raw */ }
          const rollbackable = count > 0 && m.status !== 'rolled_back';
          return (
            <div key={m.id} className="artifact-item flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={badge.className}>{badge.label}</span>
                  <span className="text-xs text-secondary truncate">{when}</span>
                </div>
                <p className="text-xs text-tertiary mt-1 truncate">
                  {count} artifact{count === 1 ? '' : 's'} · scope {m.scope || 'local'}
                </p>
              </div>
              <button
                className="btn btn-secondary text-xs py-1 px-2 gap-1 flex-shrink-0"
                disabled={!canRollback || !rollbackable}
                title={!canRollback
                  ? 'Requires rollback permission (TPM or Admin)'
                  : (!rollbackable ? (count === 0 ? 'No artifacts recorded' : 'Already rolled back') : 'Preview and roll back this publish')}
                onClick={() => onRollback(m)}
              >
                <RotateCcw size={12} /> Rollback…
              </button>
            </div>
          );
        })}
      </div>
      {!canRollback && (
        <p className="text-xs text-tertiary mt-3">Rollback requires the rollback permission (TPM or Admin role).</p>
      )}
    </div>
  );
};

export const Handoff = () => {
  const navigate = useNavigate();
  const {
    stories, approvedStoryIds, settings, setJiraIssues, setBitbucketBranches,
    setConfluencePages, setPipelineStats, completePipeline,
    currentPipelineId, currentUser, signoffs, signoffsComplete, featureFlags, prd
  } = useApp();
  // 'confirm' → user must explicitly start; 'running' → in progress; 'done' → finished.
  // Publishing creates real Jira/Bitbucket/Confluence artifacts, so we never auto-run.
  const [phase, setPhase] = useState('confirm');
  const [jiraResults, setJiraResults] = useState({});
  const [branchResults, setBranchResults] = useState({});
  const [prResults, setPrResults] = useState({});
  const [confluenceResult, setConfluenceResult] = useState(null);
  const [emailContent, setEmailContent] = useState(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [slackStatus, setSlackStatus] = useState(null);
  const [codeResults, setCodeResults] = useState({});
  const [packetResults, setPacketResults] = useState({});
  const [expandedCodeFile, setExpandedCodeFile] = useState(null);
  const [copiedFile, setCopiedFile] = useState(null);
  const [phaseNotes, setPhaseNotes] = useState([]);
  const [manifests, setManifests] = useState(() => {
    try { return getManifests(); } catch { return []; }
  });
  const [rollbackTarget, setRollbackTarget] = useState(null);
  const [phaseStatuses, setPhaseStatuses] = useState({
    jira: 'waiting',
    bitbucket: 'waiting',
    codeGen: 'waiting',
    commit: 'waiting',
    prchecklist: 'waiting',
    confluence: 'waiting',
    email: 'waiting',
    notifications: 'waiting'
  });
  const [errors, setErrors] = useState([]);

  const approvedStories = stories.filter(s => approvedStoryIds.has(s.id));
  const gitProviderLabel = getGitProviderLabel(getGitProvider(settings));
  const changeRequestLabel = getChangeRequestLabel(settings);
  const crShort = changeRequestLabel === 'Merge Request' ? 'MR' : 'PR';
  const gitConfigured = isGitConfigured(settings);

  const canPublish = can(currentUser, PERMS.PUBLISH);
  const canRollback = can(currentUser, PERMS.ROLLBACK);
  const packetsMode = (featureFlags?.handoffMode || 'packets') === 'packets';
  const publishScope = currentPipelineId || 'local';

  const missingSignoffs = signoffsComplete
    ? []
    : SIGNOFF_KINDS.filter(kind => !signoffs?.[kind]);

  // REQ-ID mapping: PRD sections → REQ-### labels applied to Jira stories.
  const reqIndex = useMemo(() => {
    try {
      const list = assignReqIds(prd || '');
      const map = new Map();
      list.forEach(r => map.set(String(r.heading || '').trim().toLowerCase(), r));
      return { list, map };
    } catch {
      return { list: [], map: new Map() };
    }
  }, [prd]);

  const reqForStory = useCallback((story) => {
    const section = String(story?.prdSection || '').trim().toLowerCase();
    if (!section || reqIndex.list.length === 0) return null;
    const direct = reqIndex.map.get(section);
    if (direct) return direct;
    return reqIndex.list.find(r => {
      const heading = String(r.heading || '').toLowerCase();
      return heading && (heading.includes(section) || section.includes(heading));
    }) || null;
  }, [reqIndex]);

  // Figma pre-publish check: frontend-labelled stories without design links (warning only).
  const figmaMissing = approvedStories.filter(s =>
    (Array.isArray(s.labels) ? s.labels : []).some(l => FRONTEND_LABEL_RE.test(String(l))) &&
    !(Array.isArray(s.figmaLinks) && s.figmaLinks.filter(Boolean).length > 0)
  );

  // An unfinished/failed manifest for this scope means a retry can skip already-created artifacts.
  const resumableManifest = manifests.find(m =>
    m && m.scope === publishScope &&
    (m.status === 'in_progress' || m.status === 'failed') &&
    Array.isArray(m.artifacts) && m.artifacts.length > 0
  ) || null;

  const refreshManifests = useCallback(() => {
    try { setManifests(getManifests()); } catch { /* storage unavailable */ }
  }, []);

  const setPhaseStatus = (phaseName, status) =>
    setPhaseStatuses(prev => ({ ...prev, [phaseName]: status }));

  const runSync = async () => {
    if (!canPublish || !signoffsComplete) return;
    setPhase('running');
    const errs = [];
    const notes = [];
    const pushNote = (note) => { notes.push(note); setPhaseNotes([...notes]); };

    // Reset per-run caches so fresh settings are always picked up
    resetJiraProjectStyleCache();

    const gitLabel = getGitProviderLabel(getGitProvider(settings));
    const changeReqLabel = getChangeRequestLabel(settings);
    const gitReady = isGitConfigured(settings);

    // ── Manifest: resume the newest incomplete run for this scope, else start fresh ──
    let manifest = null;
    try {
      manifest = getManifests().find(m =>
        m && m.scope === publishScope && (m.status === 'in_progress' || m.status === 'failed')
      ) || null;
    } catch { manifest = null; }
    if (manifest && Array.isArray(manifest.artifacts) && manifest.artifacts.length > 0) {
      pushNote(`Resuming previous publish — ${manifest.artifacts.length} already-created artifact${manifest.artifacts.length === 1 ? '' : 's'} will be skipped.`);
    }
    if (!manifest) {
      try { manifest = startManifest(publishScope); }
      catch { manifest = { id: null, scope: publishScope, artifacts: [], status: 'in_progress' }; }
    }
    if (!Array.isArray(manifest.artifacts)) manifest.artifacts = [];

    safeAudit({
      action: 'publish.start',
      entityType: 'manifest',
      entityId: manifest.id,
      after: `${approvedStories.length} stories`,
      pipelineId: currentPipelineId || undefined
    });

    // Record an artifact in the manifest AND keep the in-memory copy in sync so
    // findExisting sees artifacts created earlier in this same run.
    const record = (type, storyId, { key, url, phaseName, meta = {} } = {}) => {
      const artifactMeta = { ...meta, storyId: storyId ?? null };
      try { recordArtifact(manifest.id, { type, key, url, phase: phaseName, meta: artifactMeta }); }
      catch { /* storage unavailable */ }
      manifest.artifacts.push({ type, key: key ?? null, url: url ?? null, phase: phaseName ?? null, meta: artifactMeta });
      safeAudit({
        action: 'publish.artifact',
        entityType: 'artifact',
        entityId: key || type,
        field: type,
        after: url || key || null,
        pipelineId: currentPipelineId || undefined
      });
    };

    const alreadyCreated = (type, storyId) => {
      try { return findExisting(manifest, type, storyId ?? null); } catch { return null; }
    };

    // ── Pre-flight: warn about missing settings before any API calls ──────────
    if (!gitReady) {
      errs.push(`${gitLabel} – repository not configured in Settings. Branch, commit and ${changeReqLabel.toLowerCase()} creation will be skipped.`);
    }
    if (!settings.confluenceSpaceKey) {
      errs.push('Confluence – no space key configured in Settings. The Confluence page will not be published.');
    }
    setErrors([...errs]);
    const preflightCount = errs.length;

    const jiraMap = {};
    const branchMap = {};
    let confResult = null;

    try {
      await new Promise(r => setTimeout(r, 400));

      // ── Step 1: Jira ──────────────────────────────────────────────────────────
      setPhaseStatus('jira', 'active');

      // 1a. Group stories by their `epic` field, falling back to a default epic
      const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const defaultEpicName = `${settings.projectName || 'Sprint'} – ${today}`;

      // Build a map: epicLabel → [stories]
      const epicGroups = {};
      for (const story of approvedStories) {
        const epicLabel = (typeof story.epic === 'string' && story.epic.trim()) ? story.epic.trim() : defaultEpicName;
        if (!epicGroups[epicLabel]) epicGroups[epicLabel] = [];
        epicGroups[epicLabel].push(story);
      }

      // 1b. Create one Jira Epic per group, then create its stories under it
      const epicKeyMap = {}; // epicLabel → Jira epic key

      for (const [epicLabel, storiesInGroup] of Object.entries(epicGroups)) {
        let epicKey = null;
        const epicMatchKey = `epic:${epicLabel}`;
        const priorEpic = alreadyCreated('jira_epic', epicMatchKey);
        if (priorEpic) {
          epicKey = priorEpic.key;
          epicKeyMap[epicLabel] = epicKey;
          pushNote(`Epic "${epicLabel}" skipped (already created as ${priorEpic.key}).`);
        } else {
          const epicResult = await createJiraEpic(epicLabel);
          if (!epicResult.success) {
            errs.push(`Jira Epic "${epicLabel}" – ${epicResult.error}`);
            setErrors([...errs]);
          } else {
            epicKey = epicResult.key;
            epicKeyMap[epicLabel] = epicKey;
            record('jira_epic', epicMatchKey, { key: epicResult.key, url: epicResult.url, phaseName: 'jira' });
          }
        }

        for (const story of storiesInGroup) {
          // Duplicate detection outcome from Review: link the existing issue instead of creating one.
          if (story.linkedIssueKey) {
            const linkedResult = { success: true, key: story.linkedIssueKey, url: jiraBrowseUrl(story.linkedIssueKey), linked: true };
            jiraMap[story.id] = linkedResult;
            setJiraResults(prev => ({ ...prev, [story.id]: linkedResult }));
            if (epicKey) {
              try { await linkJiraIssues(epicKey, story.linkedIssueKey, 'Relates'); } catch { /* linking is best-effort */ }
            }
            pushNote(`"${story.title}" → linked existing issue ${story.linkedIssueKey} (Relates) instead of creating a new one.`);
            continue;
          }

          // Idempotent retry: skip stories already created by a previous run of this manifest.
          const priorStory = alreadyCreated('jira_story', story.id);
          if (priorStory) {
            const skippedResult = { success: true, key: priorStory.key, url: priorStory.url, skipped: true };
            jiraMap[story.id] = skippedResult;
            setJiraResults(prev => ({ ...prev, [story.id]: skippedResult }));
            continue;
          }

          // REQ-ID traceability: add the mapped REQ-### as a Jira label.
          const req = reqForStory(story);
          const storyForJira = req
            ? { ...story, labels: [...new Set([...(Array.isArray(story.labels) ? story.labels : []), req.reqId])] }
            : story;

          const result = await createJiraStory(storyForJira, epicKey);
          jiraMap[story.id] = result;
          setJiraResults(prev => ({ ...prev, [story.id]: result }));
          if (result.success) {
            record('jira_story', story.id, { key: result.key, url: result.url, phaseName: 'jira', meta: req ? { reqId: req.reqId } : {} });
          } else {
            errs.push(`Jira Story "${story.title}" – ${result.error}`);
          }
        }
      }
      setErrors([...errs]);

      // 1c. Create Dev + QA Sub-tasks for each story (skipped for linked / already-created)
      for (const story of approvedStories) {
        const storyResult = jiraMap[story.id];
        if (!storyResult?.success || storyResult.linked) continue;

        if (!alreadyCreated('jira_subtask', story.id)) {
          const devSubResult = await createJiraSubTask(
            storyResult.key,
            `Dev: ${story.title}`,
            `Implement the feature as described in the parent story.\n\n${story.technicalNotes || 'Refer to story description and acceptance criteria.'}`
          );
          if (devSubResult?.success) {
            record('jira_subtask', story.id, { key: devSubResult.key, url: devSubResult.url, phaseName: 'jira' });
          } else if (devSubResult) {
            errs.push(`Jira Dev Sub-task (${storyResult.key}) – ${devSubResult.error}`);
          }
        }

        if (!alreadyCreated('jira_qa_subtask', story.id)) {
          let testCases = [];
          try {
            const qaRes = await generateQATasks(story);
            testCases = qaRes.testCases || [];
          } catch {
            // non-fatal — QA sub-task will be created with Gherkin only
          }
          const qaSubResult = await createJiraQASubTask(storyResult.key, story, testCases);
          if (qaSubResult?.success) {
            record('jira_qa_subtask', story.id, { key: qaSubResult.key, url: qaSubResult.url, phaseName: 'jira' });
          } else if (qaSubResult) {
            errs.push(`Jira QA Sub-task (${storyResult.key}) – ${qaSubResult.error}`);
          }
        }
      }

      // 1d. Link story dependencies (Blocks relationship)
      for (const story of approvedStories) {
        for (const depId of (story.dependencies || [])) {
          const fromResult = jiraMap[depId];
          const toResult = jiraMap[story.id];
          if (fromResult?.success && toResult?.success) {
            await linkJiraIssues(fromResult.key, toResult.key);
          }
        }
      }

      setJiraIssues(jiraMap);
      setErrors([...errs]);
      const jiraHadErrors = errs.some(e => e.startsWith('Jira'));
      const jiraAllSkipped = approvedStories.length > 0 &&
        approvedStories.every(s => jiraMap[s.id]?.skipped || jiraMap[s.id]?.linked);
      setPhaseStatus('jira', jiraHadErrors ? 'error' : (jiraAllSkipped ? 'skipped' : 'done'));

      await new Promise(r => setTimeout(r, 400));

      // ── Step 2: Git branches ──────────────────────────────────────────────────
      setPhaseStatus('bitbucket', 'active');

      if (gitReady) {
        for (const story of approvedStories) {
          const jiraKey = jiraMap[story.id]?.key || story.id.toUpperCase();
          const priorBranch = alreadyCreated('git_branch', story.id);
          if (priorBranch) {
            const skipped = { success: true, name: priorBranch.key, url: priorBranch.url, jiraKey, skipped: true };
            branchMap[story.id] = skipped;
            setBranchResults(prev => ({ ...prev, [story.id]: skipped }));
            continue;
          }
          const branchName = getGitBranchName(jiraKey, story.title);
          const result = await createGitBranch(settings, branchName, getGitDefaultBranch(settings));
          branchMap[story.id] = { ...result, name: branchName, jiraKey };
          setBranchResults(prev => ({ ...prev, [story.id]: { ...result, name: branchName } }));
          if (result.success) {
            record('git_branch', story.id, { key: branchName, url: result.url, phaseName: 'git' });
          } else {
            errs.push(`${gitLabel} Branch "${branchName}" – ${result.error}`);
          }
        }
      }
      setBitbucketBranches(branchMap);
      setErrors([...errs]);
      const branchesAllSkipped = gitReady && approvedStories.length > 0 &&
        approvedStories.every(s => branchMap[s.id]?.skipped);
      setPhaseStatus('bitbucket', !gitReady
        ? 'done'
        : (Object.values(branchMap).some(b => !b.success) ? 'error' : (branchesAllSkipped ? 'skipped' : 'done')));

      await new Promise(r => setTimeout(r, 400));

      // ── Step 3: Work packets (default) or AI code scaffolds ──────────────────
      setPhaseStatus('codeGen', 'active');
      const codeMap = {};
      const packetMap = {};
      let repoCtx = { structure: '', files: [] };

      if (packetsMode) {
        // Packets mode: deterministic tasks/{KEY}.md spec files for coding agents —
        // no AI scaffold generation.
        try {
          const repoLabel = gitReady ? getGitRepoLabel(settings) : '';
          for (const story of approvedStories) {
            const jiraKey = jiraMap[story.id]?.key || story.id.toUpperCase();
            const req = reqForStory(story);
            const prdExcerpt = req
              ? [`${req.reqId} — ${req.heading}`, req.snippet].filter(Boolean).join('\n')
              : '';
            const packet = buildWorkPacket(story, {
              jiraKey,
              prdExcerpt,
              repoLabel,
              figmaLinks: story.figmaLinks
            });
            packetMap[story.id] = packet;
            setPacketResults(prev => ({ ...prev, [story.id]: packet }));
          }
          setPhaseStatus('codeGen', 'done');
        } catch (err) {
          errs.push(`Work Packets – ${err.message}`);
          setPhaseStatus('codeGen', 'error');
        }
      } else {
        try {
          const allLabels = [...new Set(approvedStories.flatMap(s => s.labels || []))];
          const allTitles = approvedStories.map(s => s.title).join(' ');
          repoCtx = gitReady
            ? await fetchGitRepoContext(settings, allLabels, allTitles)
            : { structure: '', files: [] };

          for (const story of approvedStories) {
            try {
              const result = await generateCode(story, repoCtx);
              codeMap[story.id] = result;
              setCodeResults(prev => ({ ...prev, [story.id]: result }));
            } catch (e) {
              errs.push(`Code Generation for "${story.title}" – ${e.message}`);
            }
          }
          setPhaseStatus('codeGen', 'done');
        } catch (err) {
          errs.push(`Repo Analysis – ${err.message}`);
          setPhaseStatus('codeGen', 'error');
        }
      }
      setErrors([...errs]);

      await new Promise(r => setTimeout(r, 400));

      // ── Step 4: Commit to branches (work packets or generated code) ───────────
      setPhaseStatus('commit', 'active');
      const commitMap = {};
      if (gitReady) {
        for (const story of approvedStories) {
          const branch = branchMap[story.id];
          const priorCommit = alreadyCreated('git_commit', story.id);
          if (priorCommit) {
            commitMap[story.id] = { success: true, skipped: true };
            continue;
          }

          if (packetsMode) {
            const packet = packetMap[story.id];
            if (branch?.success && packet) {
              const commitResult = await commitGitFiles(
                settings, branch.name,
                [{ path: packet.path, content: packet.content }],
                `docs: add coding-agent work packet ${packet.path}`
              );
              commitMap[story.id] = commitResult;
              if (commitResult.success) {
                record('git_commit', story.id, {
                  key: `${branch.name} · ${packet.path}`,
                  phaseName: 'git',
                  meta: { branch: branch.name, path: packet.path }
                });
              } else {
                errs.push(`${gitLabel} Commit (work packet) on "${branch.name}" – ${commitResult.error}`);
              }
            } else {
              commitMap[story.id] = { success: false, error: branch?.success ? 'No work packet built to commit' : 'Branch missing — work packet not committed' };
            }
          } else if (branch?.success && codeMap[story.id]?.files?.length > 0) {
            const commitResult = await commitGitFiles(settings, branch.name, codeMap[story.id].files);
            commitMap[story.id] = commitResult;
            if (commitResult.success) {
              record('git_commit', story.id, { key: branch.name, phaseName: 'git', meta: { branch: branch.name } });
            } else {
              errs.push(`${gitLabel} Commit on "${branch.name}" – ${commitResult.error}`);
            }
          } else {
            commitMap[story.id] = { success: false, error: 'No code generated to commit' };
          }
        }
      }
      setErrors([...errs]);
      const commitsAllSkipped = gitReady && approvedStories.length > 0 &&
        approvedStories.every(s => commitMap[s.id]?.skipped);
      setPhaseStatus('commit', !gitReady
        ? 'done'
        : (Object.values(commitMap).some(c => !c.success) ? 'error' : (commitsAllSkipped ? 'skipped' : 'done')));

      await new Promise(r => setTimeout(r, 400));

      // ── Step 5: PR Checklists + Pull Requests ─────────────────────────────────
      setPhaseStatus('prchecklist', 'active');
      const prMap = {};

      if (gitReady) {
        for (const story of approvedStories) {
          const branch = branchMap[story.id];
          const jiraKey = branch?.jiraKey;

          if (!branch?.success) {
            prMap[story.id] = { success: false, error: `Branch was not created — skipping ${crShort}` };
            continue;
          }

          const priorPr = alreadyCreated('git_pr', story.id);
          if (priorPr) {
            const skipped = { success: true, id: priorPr.meta?.prId, url: priorPr.url, skipped: true };
            prMap[story.id] = skipped;
            setPrResults(prev => ({ ...prev, [story.id]: skipped }));
            continue;
          }

          // Even if commit failed, we might try the PR, but it'll likely show 'no changes'
          // We'll proceed so the user sees the error in the Git provider or our UI
          let checklist = '';
          try {
            const clRes = await generatePRChecklist(story);
            checklist = clRes.checklist || '';
          } catch { /* checklist is optional */ }

          const prResult = await createGitPR(settings, branch.name, story.title, checklist, jiraKey);
          prMap[story.id] = prResult;
          setPrResults(prev => ({ ...prev, [story.id]: prResult }));
          if (prResult.success) {
            record('git_pr', story.id, {
              key: prResult.id != null ? `#${prResult.id}` : branch.name,
              url: prResult.url,
              phaseName: 'git',
              meta: { prId: prResult.id }
            });
          } else {
            errs.push(`${gitLabel} ${changeReqLabel} "${story.title}" – ${prResult.error}`);
          }
        }
      }

      setErrors([...errs]);
      const prsAllSkipped = gitReady && approvedStories.length > 0 &&
        approvedStories.every(s => prMap[s.id]?.skipped);
      setPhaseStatus('prchecklist', !gitReady
        ? 'done'
        : (Object.values(prMap).some(p => !p.success) ? 'error' : (prsAllSkipped ? 'skipped' : 'done')));

      await new Promise(r => setTimeout(r, 400));

      // ── Step 6: Solutioning Doc & Confluence ───────────────────────────────────
      setPhaseStatus('confluence', 'active');
      const priorConf = alreadyCreated('confluence_page', null);
      if (priorConf) {
        confResult = { success: true, url: priorConf.url, id: priorConf.meta?.pageId, skipped: true };
        setConfluenceResult(confResult);
        setConfluencePages([confResult]);
        setPhaseStatus('confluence', 'skipped');
      } else if (!settings.confluenceSpaceKey) {
        // Already flagged in pre-flight — skip the doomed API call gracefully.
        confResult = { success: false, error: 'No Confluence space key configured. Please set it in Settings.' };
        setConfluenceResult(confResult);
        setConfluencePages([confResult]);
        setPhaseStatus('confluence', 'done');
      } else {
        let solutioningHtml = null;
        try {
          const docRes = await generateSolutioningDoc(approvedStories, repoCtx, settings.projectName || 'Sprint');
          solutioningHtml = docRes.html || null;
        } catch (e) {
          errs.push(`Solutioning Doc Generation – ${e.message}`);
        }

        confResult = await createConfluencePage(settings.confluenceSpaceKey, 'Sprint Planning', approvedStories, solutioningHtml);
        setConfluenceResult(confResult);
        setConfluencePages([confResult]);
        setPhaseStatus('confluence', confResult.success ? 'done' : 'error');
        if (confResult.success) {
          record('confluence_page', null, {
            key: confResult.id != null ? String(confResult.id) : 'confluence-page',
            url: confResult.url,
            phaseName: 'confluence',
            meta: { pageId: confResult.id }
          });
        } else {
          errs.push(`Confluence – ${confResult.error}`);
        }
        setErrors([...errs]);
      }

      await new Promise(r => setTimeout(r, 300));

      // ── Step 7: Stakeholder Email ─────────────────────────────────────────────
      setPhaseStatus('email', 'active');
      try {
        const emailRes = await generateStakeholderEmail(approvedStories, settings.projectName || 'Sprint Planning');
        setEmailContent(emailRes);
        setPhaseStatus('email', 'done');
      } catch (err) {
        errs.push(`Stakeholder Email – ${err.message || 'AI service error'}`);
        setErrors([...errs]);
        setPhaseStatus('email', 'error');
      }

      await new Promise(r => setTimeout(r, 300));

      // ── Step 8: Slack / Teams notification ───────────────────────────────────
      setPhaseStatus('notifications', 'active');
      const slackWebhook = settings.slackWebhookUrl;
      if (slackWebhook) {
        const successCount = Object.values(jiraMap).filter(r => r?.success).length;
        const totalPts = approvedStories.reduce((a, s) => a + (s.adjustedPoints || 0), 0);
        const jiraLinks = Object.values(jiraMap)
          .filter(r => r?.success && r.url)
          .map(r => `<${r.url}|${r.key}>`)
          .join(', ');

        const slackMsg = {
          text: `*SDLC Autopilot* – Pipeline complete`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `*Sprint pipeline complete!* :rocket:\n${successCount} stories pushed · ${totalPts} story points`
              }
            },
            ...(jiraLinks ? [{
              type: 'section',
              text: { type: 'mrkdwn', text: `*Jira tickets:* ${jiraLinks}` }
            }] : []),
            ...(confResult?.success ? [{
              type: 'section',
              text: { type: 'mrkdwn', text: `*Confluence doc:* <${confResult.url}|View Architecture Doc>` }
            }] : [])
          ]
        };

        try {
          const slkRes = await notifySlack(slackWebhook, slackMsg);
          setSlackStatus(slkRes.success ? 'sent' : 'failed');
          if (!slkRes.success) errs.push(`Slack notification – ${slkRes.error || 'send failed'}`);
        } catch (err) {
          setSlackStatus('failed');
          errs.push(`Slack notification – ${err.message}`);
        }
      } else {
        setSlackStatus('skipped');
      }
      setPhaseStatus('notifications', 'done');

      setErrors([...errs]);
      setPipelineStats(prev => ({
        ...prev,
        pipelineRuns: (prev.pipelineRuns || 0) + 1,
        storiesPushed: (prev.storiesPushed || 0) + Object.values(jiraMap).filter(r => r?.success).length
      }));

      await completePipeline(jiraMap, confResult?.url || null).catch(() => {});

      // ── Manifest close-out: 'failed' when any real step failed so a retry can resume ──
      const hadFailures = errs.length > preflightCount;
      try { completeManifest(manifest.id, hadFailures ? 'failed' : 'completed'); }
      catch { /* storage unavailable */ }
      safeAudit({
        action: 'publish.complete',
        entityType: 'manifest',
        entityId: manifest.id,
        after: hadFailures ? 'failed' : 'completed',
        pipelineId: currentPipelineId || undefined
      });
      if (hadFailures) {
        pushNote('Some steps failed — this run is recorded so a retry will skip everything that was already created.');
      }
    } catch (err) {
      // Unexpected abort: record the manifest as failed so the retry is idempotent.
      errs.push(`Publish aborted – ${err?.message || 'Unexpected error'}`);
      setErrors([...errs]);
      try { completeManifest(manifest.id, 'failed'); } catch { /* storage unavailable */ }
      safeAudit({
        action: 'publish.complete',
        entityType: 'manifest',
        entityId: manifest.id,
        after: 'failed',
        reason: err?.message,
        pipelineId: currentPipelineId || undefined
      });
    }

    refreshManifests();
    setPhase('done');
  };

  const handleRetry = () => {
    setErrors([]);
    setPhaseNotes([]);
    setPhaseStatuses({
      jira: 'waiting', bitbucket: 'waiting', codeGen: 'waiting', commit: 'waiting',
      prchecklist: 'waiting', confluence: 'waiting', email: 'waiting', notifications: 'waiting'
    });
    runSync();
  };

  const jiraSuccessCount = Object.values(jiraResults).filter(r => r?.success).length;
  const branchSuccessCount = Object.values(branchResults).filter(r => r?.success).length;
  const prSuccessCount = Object.values(prResults).filter(r => r?.success).length;
  const allJiraSuccess = Object.values(jiraResults).every(r => r?.success);

  const rollbackModal = rollbackTarget && (
    <RollbackModal
      manifest={rollbackTarget}
      settings={settings}
      currentPipelineId={currentPipelineId}
      onClose={() => setRollbackTarget(null)}
      onDone={refreshManifests}
    />
  );

  if (approvedStories.length === 0) {
    return (
      <div className="handoff-dashboard">
        {rollbackModal}
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <AlertTriangle size={48} style={{ color: 'var(--color-warning)' }} />
          <h1 className="text-2xl font-bold">No Approved Stories</h1>
          <p className="text-secondary">Go back to the Review Pipeline and approve at least one story before pushing artifacts.</p>
          <button className="btn btn-primary" onClick={() => navigate('/review')}>
            <ArrowRight size={16} /> Back to Review
          </button>
        </div>
        <PublishHistory manifests={manifests} canRollback={canRollback} onRollback={setRollbackTarget} />
      </div>
    );
  }

  // ── Confirmation gate ─────────────────────────────────────────────────────
  // Publishing creates real, hard-to-undo artifacts in Jira, Bitbucket, and
  // Confluence, so the user must explicitly start it (and cannot trigger it by a
  // stray refresh/navigation). It is also gated on sign-offs + publish permission.
  if (phase === 'confirm') {
    const totalPoints = approvedStories.reduce((sum, s) => sum + (s.adjustedPoints || 0), 0);
    const epicCount = new Set(
      approvedStories.map(s => (typeof s.epic === 'string' && s.epic.trim()) ? s.epic.trim() : '__default__')
    ).size;
    const gitLabel = getGitProviderLabel(getGitProvider(settings));
    const gitReady = isGitConfigured(settings);
    const confluenceReady = !!settings.confluenceSpaceKey;
    const slackReady = !!settings.slackWebhookUrl;
    const linkedCount = approvedStories.filter(s => s.linkedIssueKey).length;
    const publishBlocked = !signoffsComplete || !canPublish;

    return (
      <div className="handoff-dashboard">
        {rollbackModal}
        <PipelineSteps current="sync" />
        <div className="card" style={{ maxWidth: 640, margin: '0 auto' }}>
          <div className="flex items-center gap-3 mb-2">
            <div className="icon-chip"><Rocket size={22} style={{ color: 'var(--color-primary)' }} /></div>
            <h1 className="text-2xl font-bold">Ready to Publish</h1>
          </div>
          <p className="text-secondary text-sm mb-5">
            Review what will be created before you publish. These actions write real artifacts to your
            connected tools and are not automatically reversible.
          </p>

          {!signoffsComplete && (
            <div className="gate-panel gate-panel--blocking mb-4">
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert size={16} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
                <h3 className="text-sm font-semibold">Sign-offs required before publishing</h3>
              </div>
              <ul className="gate-list text-xs">
                {missingSignoffs.map(kind => (
                  <li key={kind}>Missing: <strong>{SIGNOFF_LABELS[kind] || kind}</strong> sign-off</li>
                ))}
              </ul>
              <p className="text-xs text-tertiary mt-2">
                Collect the missing sign-offs on the{' '}
                <button className="inline-link" onClick={() => navigate('/review')}>Review page</button>
                {' '}— or enable solo mode in Settings if you are working alone.
              </p>
            </div>
          )}

          {!canPublish && (
            <div className="gate-panel gate-panel--blocking mb-4">
              <div className="flex items-center gap-2">
                <ShieldAlert size={16} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
                <p className="text-xs text-secondary">
                  Your role ({ROLE_LABELS[currentUser?.role] || currentUser?.role || 'Unknown'}) does not have
                  publish permission. Switch to a TPM or Admin identity to publish.
                </p>
              </div>
            </div>
          )}

          {figmaMissing.length > 0 && (
            <div className="gate-panel gate-panel--warning mb-4">
              <div className="flex items-center gap-2 mb-2">
                <PenTool size={15} style={{ color: 'var(--color-warning)', flexShrink: 0 }} />
                <h3 className="text-sm font-semibold">Design links missing (warning only)</h3>
              </div>
              <ul className="gate-list text-xs">
                {figmaMissing.map(s => (
                  <li key={s.id}>"{s.title}" is frontend-labelled but has no Figma link</li>
                ))}
              </ul>
              <p className="text-xs text-tertiary mt-2">
                Add design links in the story editor on the{' '}
                <button className="inline-link" onClick={() => navigate('/review')}>Review page</button>. Publishing is not blocked.
              </p>
            </div>
          )}

          {resumableManifest && (
            <div className="gate-panel gate-panel--info mb-4">
              <div className="flex items-center gap-2">
                <History size={15} style={{ color: 'var(--color-info)', flexShrink: 0 }} />
                <p className="text-xs text-secondary">
                  A previous publish for this pipeline did not complete.{' '}
                  {resumableManifest.artifacts.length} already-created artifact{resumableManifest.artifacts.length === 1 ? '' : 's'} will
                  be skipped automatically when you publish again.
                </p>
              </div>
            </div>
          )}

          <div className="handoff-stat-grid mb-5">
            <div className="handoff-stat">
              <div className="text-2xl font-bold gradient-text">{approvedStories.length}</div>
              <div className="text-xs text-tertiary uppercase tracking-wide mt-1">Stories</div>
            </div>
            <div className="handoff-stat">
              <div className="text-2xl font-bold">{epicCount}</div>
              <div className="text-xs text-tertiary uppercase tracking-wide mt-1">Epic{epicCount > 1 ? 's' : ''}</div>
            </div>
            <div className="handoff-stat">
              <div className="text-2xl font-bold">{totalPoints}</div>
              <div className="text-xs text-tertiary uppercase tracking-wide mt-1">Points</div>
            </div>
          </div>

          <div className="flex-col gap-2 mb-5">
            <PublishTarget
              ready
              label="Jira"
              detail="Epic, stories, Dev & QA sub-tasks"
              readyText={linkedCount > 0
                ? `Epic, stories, sub-tasks · ${linkedCount} linked to existing issue${linkedCount === 1 ? '' : 's'}`
                : 'Epic, stories, Dev & QA sub-tasks'}
            />
            <PublishTarget
              ready={gitReady}
              label={gitLabel}
              detail="Repository not set — will be skipped"
              readyText={`${getGitRepoLabel(settings)} · branches, ${packetsMode ? 'work packets' : 'code'}, ${getChangeRequestLabel(settings).toLowerCase()}s`}
            />
            <PublishTarget ready={confluenceReady} label="Confluence" detail="No space key — doc will be skipped" readyText={`Space ${settings.confluenceSpaceKey} · solutioning doc`} />
            <PublishTarget ready={slackReady} label="Notifications" detail="No webhook — notification will be skipped" readyText="Webhook configured · summary will be sent" />
          </div>

          <p className="text-xs text-tertiary mb-4 flex items-center gap-1">
            <Package size={12} style={{ flexShrink: 0 }} />
            {packetsMode
              ? 'Handoff mode: work packets — a tasks/{KEY}.md spec file is committed per story for coding agents (change in Settings).'
              : 'Handoff mode: AI scaffolds — generated code is committed per story (change in Settings).'}
          </p>

          <div className="flex gap-3 justify-end">
            <button className="btn btn-secondary" onClick={() => navigate('/review')}>
              <ArrowRight size={16} style={{ transform: 'rotate(180deg)' }} /> Back to Review
            </button>
            <button
              className="btn btn-primary px-6"
              onClick={runSync}
              disabled={publishBlocked}
              title={!canPublish
                ? 'Requires publish permission (TPM or Admin)'
                : (!signoffsComplete ? 'All sign-offs are required before publishing' : 'Publish artifacts')}
            >
              <Rocket size={16} /> Start Publishing
            </button>
          </div>

          {(!gitReady || !confluenceReady) && (
            <p className="text-xs text-tertiary mt-4 text-center">
              Steps for unconfigured tools are skipped automatically — you can still publish Jira tickets.{' '}
              <button className="inline-link" onClick={() => navigate('/settings')}>Open Settings</button>
            </p>
          )}
        </div>

        <PublishHistory manifests={manifests} canRollback={canRollback} onRollback={setRollbackTarget} />
      </div>
    );
  }

  return (
    <div className="handoff-dashboard">
      {rollbackModal}
      {showEmailModal && emailContent && (
        <EmailModal emailContent={emailContent} onClose={() => setShowEmailModal(false)} />
      )}

      <PipelineSteps current="sync" />

      <header className="mb-8 text-center">
        {phase !== 'done' ? (
          <>
            <div className="flex justify-center mb-5">
              <Loader2 size={56} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
            </div>
            <h1 className="text-3xl font-bold mb-2">Publishing Artifacts...</h1>
            <p className="text-secondary">
              Creating Jira stories, {gitProviderLabel} branches, {crShort}s, and Confluence documentation.
            </p>
          </>
        ) : (
          <>
            <div className="flex justify-center mb-5">
              <div className="success-orb flex items-center justify-center animate-fade-in">
                <CheckCircle size={44} style={{ color: 'var(--color-success)' }} />
              </div>
            </div>
            <h1 className="text-3xl font-bold mb-2 animate-fade-in">Sync Complete!</h1>
            <p className="text-secondary animate-fade-in">
              1 Epic · {jiraSuccessCount} stories · {jiraSuccessCount * 2} sub-tasks · {branchSuccessCount} branches · {prSuccessCount} {crShort}s · {confluenceResult?.success ? '1 Confluence page' : 'Confluence skipped'}
            </p>
          </>
        )}
      </header>

      <div className="sync-progress-grid mb-8" style={{ maxWidth: 520, margin: '0 auto 2rem' }}>
        <SyncPhase label="Connecting to Atlassian toolchain" status={phaseStatuses.jira === 'waiting' ? 'waiting' : 'done'} />
        <SyncPhase label={`Creating Epic, ${approvedStories.length} stories, Dev & QA sub-tasks`} status={phaseStatuses.jira} />
        <SyncPhase label={`Scaffolding ${gitProviderLabel} branches`} status={phaseStatuses.bitbucket} />
        <SyncPhase
          label={packetsMode
            ? `Preparing ${approvedStories.length} coding-agent work packet${approvedStories.length === 1 ? '' : 's'}`
            : 'Analysing repo & generating code scaffolding'}
          status={phaseStatuses.codeGen}
        />
        <SyncPhase
          label={packetsMode ? 'Committing work packets to feature branches' : 'Pushing generated code to feature branches'}
          status={phaseStatuses.commit}
        />
        <SyncPhase label={`Opening ${changeRequestLabel.toLowerCase()}s with checklists`} status={phaseStatuses.prchecklist} />
        <SyncPhase label="Publishing detailed architecture docs to Confluence" status={phaseStatuses.confluence} />
        <SyncPhase label="Generating summary email & notifying stakeholders" status={phaseStatuses.email} />
      </div>

      {phaseNotes.length > 0 && (
        <div className="publish-notes mb-6" style={{ maxWidth: 520, margin: '0 auto 1.5rem' }}>
          {phaseNotes.map((note, i) => (
            <p key={i} className="text-xs">{note}</p>
          ))}
        </div>
      )}

      {errors.length > 0 && (
        <div className="card card--error mb-6" style={{ maxWidth: 800, margin: '0 auto 1.5rem' }}>
          <h4 className="flex items-center gap-2 text-error font-semibold mb-2 text-sm">
            <AlertTriangle size={16} /> Some integrations failed
          </h4>
          <ul className="error-list text-xs">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          <p className="text-xs text-tertiary mt-2">Check Settings to verify your credentials and configuration.</p>
        </div>
      )}

      {phase === 'done' && (
        <div className="artifacts-grid">
          {/* Jira */}
          <div className="card artifact-card animate-fade-in stagger-1">
            <div className="flex items-center gap-3 mb-5">
              <div className="icon-chip"><CheckSquare size={22} style={{ color: 'var(--color-info)' }} /></div>
              <h2 className="text-lg font-semibold">Jira Stories</h2>
            </div>
            <div className="flex-col gap-2">
              {approvedStories.map(story => {
                const result = jiraResults[story.id];
                return (
                  <div key={story.id} className="artifact-item">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        {result?.success ? (
                          <span className="text-info font-mono text-xs font-bold whitespace-nowrap">{result.key}</span>
                        ) : (
                          <AlertTriangle size={12} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
                        )}
                        <span className="text-xs font-medium truncate">{story.title}</span>
                      </div>
                      {result?.success && result.url && (
                        <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-secondary hover:text-primary transition-colors flex-shrink-0 ml-2">
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                    {(result?.skipped || result?.linked) && (
                      <div className="mt-1.5 pl-1 flex gap-2">
                        {result.skipped && <span className="badge badge-neutral">skipped (already created)</span>}
                        {result.linked && <span className="badge badge-info">linked existing issue (Relates)</span>}
                      </div>
                    )}
                    {result && !result.success && result.error && (
                      <p className="text-xs mt-1.5 pl-1" style={{ color: 'var(--color-error)' }}>
                        {result.error}
                      </p>
                    )}
                    {result?.success && result.warnings?.length > 0 && (
                      <div className="mt-1.5 pl-1">
                        {result.warnings.map((w, i) => (
                          <p key={i} className="text-xs" style={{ color: 'var(--color-warning)' }}>⚠ {w}</p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {!allJiraSuccess && (
              <p className="text-xs text-tertiary mt-3">Some stories failed. Check your Jira project key and credentials in Settings.</p>
            )}
          </div>

          {/* Git branches + PRs */}
          <div className="card artifact-card animate-fade-in stagger-2">
            <div className="flex items-center gap-3 mb-5">
              <div className="icon-chip"><GitBranch size={22} style={{ color: 'var(--color-primary)' }} /></div>
              <h2 className="text-lg font-semibold">Branches & {changeRequestLabel}s</h2>
            </div>
            {gitConfigured ? (
              <div className="flex-col gap-2">
                {approvedStories.map(story => {
                  const branch = branchResults[story.id];
                  const pr = prResults[story.id];
                  return (
                    <div key={story.id} className="artifact-item">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          {branch?.success
                            ? <CheckCircle size={12} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                            : <AlertTriangle size={12} style={{ color: 'var(--color-error)', flexShrink: 0 }} />}
                          <span className="text-xs text-secondary font-mono truncate">{branch?.name || story.title}</span>
                          {branch?.skipped && <span className="badge badge-neutral flex-shrink-0">skipped (already created)</span>}
                        </div>
                        {branch?.success && branch.url && (
                          <a href={branch.url} target="_blank" rel="noopener noreferrer" className="text-secondary hover:text-primary transition-colors flex-shrink-0 ml-2">
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                      {branch && !branch.success && branch.error && (
                        <p className="text-xs mt-0.5 pl-1" style={{ color: 'var(--color-error)' }}>
                          Branch: {branch.error}
                        </p>
                      )}
                      {pr?.success ? (
                        <div className="flex items-center gap-1 mt-1">
                          <GitPullRequest size={11} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                          {pr.url ? (
                            <a href={pr.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate">
                              {crShort} {pr.id != null ? `#${pr.id}` : ''}{pr.skipped ? ' (already opened)' : ' (with checklist)'}
                            </a>
                          ) : (
                            <span className="text-xs text-secondary truncate">
                              {crShort} {pr.id != null ? `#${pr.id}` : ''}{pr.skipped ? ' (already opened)' : ''}
                            </span>
                          )}
                        </div>
                      ) : pr && !pr.success && pr.error ? (
                        <p className="text-xs mt-1 pl-1" style={{ color: 'var(--color-warning)' }}>
                          {crShort}: {pr.error}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center gap-2" style={{ flex: 1, minHeight: 80 }}>
                <p className="text-sm text-secondary">Configure your {gitProviderLabel} repository in Settings to enable branch and {changeRequestLabel.toLowerCase()} creation.</p>
                <button className="btn btn-secondary text-xs py-1 px-3" onClick={() => navigate('/settings')}>
                  Open Settings
                </button>
              </div>
            )}
          </div>

          {/* Confluence + Notifications */}
          <div className="flex-col gap-4">
            <div className="card artifact-card flex flex-col justify-between" style={{ flex: 1 }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="icon-chip"><FileText size={20} style={{ color: 'var(--color-secondary)' }} /></div>
                <h2 className="text-base font-semibold">Confluence</h2>
              </div>
              {confluenceResult?.success ? (
                <>
                  <p className="text-xs text-secondary mb-3">
                    {confluenceResult.skipped ? 'Page already published in a previous run — skipped.' : 'Solutioning document published successfully.'}
                  </p>
                  {confluenceResult.url && (
                    <a href={confluenceResult.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary w-full justify-between text-xs py-1.5">
                      View Architecture Doc <ExternalLink size={12} />
                    </a>
                  )}
                </>
              ) : (
                <>
                  <p className="text-xs text-secondary mb-3">{confluenceResult?.error || 'Configure a Confluence space key in Settings.'}</p>
                  <button className="btn btn-secondary w-full text-xs py-1.5" onClick={() => navigate('/settings')}>Open Settings</button>
                </>
              )}
            </div>

            <div className="card artifact-card flex flex-col justify-between" style={{ flex: 1 }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="icon-chip"><Send size={18} style={{ color: 'var(--color-accent)' }} /></div>
                <h2 className="text-base font-semibold">Notifications</h2>
              </div>
              <div className="flex-col gap-2">
                {emailContent ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-success)' }}>
                      <CheckCircle size={11} /> Email draft ready
                    </div>
                    <button className="btn btn-secondary text-xs py-1 px-2 gap-1" onClick={() => setShowEmailModal(true)}>
                      <Mail size={12} /> Preview
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-tertiary">Email generation unavailable.</p>
                )}
                {slackStatus === 'sent' && (
                  <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-success)' }}>
                    <CheckCircle size={11} /> Slack notification sent
                  </div>
                )}
                {slackStatus === 'failed' && (
                  <div className="flex items-center gap-1 text-xs text-error">
                    <AlertTriangle size={11} /> Slack notification failed
                  </div>
                )}
                {slackStatus === 'skipped' && (
                  <p className="text-xs text-tertiary">Add a Slack webhook in Settings to enable team notifications.</p>
                )}
              </div>
            </div>
          </div>

          {/* Coding-agent work packets (packets mode) */}
          {packetsMode && Object.keys(packetResults).length > 0 && (
            <div className="card artifact-card animate-fade-in stagger-3" style={{ gridColumn: '1 / -1' }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="icon-chip"><Package size={22} style={{ color: 'var(--color-success)' }} /></div>
                <h2 className="text-lg font-semibold">Coding-Agent Work Packets</h2>
                <span className="text-xs text-tertiary ml-auto">One tasks/{'{KEY}'}.md spec per story · committed to its feature branch</span>
              </div>
              <div className="flex flex-col gap-2">
                {approvedStories.map(story => {
                  const packet = packetResults[story.id];
                  if (!packet) return null;
                  const fileKey = `packet-${story.id}`;
                  const isExpanded = expandedCodeFile === fileKey;
                  const isCopied = copiedFile === fileKey;
                  return (
                    <div key={story.id} className="code-file">
                      <div
                        className="code-file-header flex items-center justify-between"
                        onClick={() => setExpandedCodeFile(isExpanded ? null : fileKey)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--brand-gradient)', color: 'var(--text-on-brand)', fontWeight: 600, fontSize: 10 }}>
                            md
                          </span>
                          <span className="text-xs font-mono text-secondary truncate">{packet.path}</span>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          <span className="text-xs text-tertiary hidden sm:block truncate" style={{ maxWidth: 220 }}>{story.title}</span>
                          <button
                            className="btn btn-secondary py-0.5 px-2 text-xs gap-1"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(packet.content).then(() => {
                                setCopiedFile(fileKey);
                                setTimeout(() => setCopiedFile(null), 2000);
                              });
                            }}
                          >
                            <Copy size={11} /> {isCopied ? 'Copied!' : 'Copy'}
                          </button>
                        </div>
                      </div>
                      {isExpanded && (
                        <pre className="code-block text-xs overflow-x-auto" style={{ maxHeight: 360 }}>
                          <code>{packet.content}</code>
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Generated Code (scaffold mode) */}
          {!packetsMode && Object.keys(codeResults).length > 0 && (
            <div className="card artifact-card animate-fade-in stagger-3" style={{ gridColumn: '1 / -1' }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="icon-chip"><Code2 size={22} style={{ color: 'var(--color-success)' }} /></div>
                <h2 className="text-lg font-semibold">Generated Code Scaffolding</h2>
                <span className="text-xs text-tertiary ml-auto">Matches your repo's conventions · fill in TODOs to complete</span>
              </div>
              <div className="flex flex-col gap-5">
                {approvedStories.map(story => {
                  const result = codeResults[story.id];
                  if (!result?.files?.length) return null;
                  return (
                    <div key={story.id}>
                      <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">
                        {story.title}
                        <span className="ml-2 normal-case text-tertiary font-normal">— {result.summary}</span>
                      </p>
                      <div className="flex flex-col gap-2">
                        {result.files.map((file, fi) => {
                          const fileKey = `${story.id}-${fi}`;
                          const isExpanded = expandedCodeFile === fileKey;
                          const isCopied = copiedFile === fileKey;
                          return (
                            <div key={fi} className="code-file">
                              <div
                                className="code-file-header flex items-center justify-between"
                                onClick={() => setExpandedCodeFile(isExpanded ? null : fileKey)}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--brand-gradient)', color: 'var(--text-on-brand)', fontWeight: 600, fontSize: 10 }}>
                                    {file.language}
                                  </span>
                                  <span className="text-xs font-mono text-secondary truncate">{file.path}</span>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  <span className="text-xs text-tertiary hidden sm:block">{file.purpose}</span>
                                  <button
                                    className="btn btn-secondary py-0.5 px-2 text-xs gap-1"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigator.clipboard.writeText(file.content).then(() => {
                                        setCopiedFile(fileKey);
                                        setTimeout(() => setCopiedFile(null), 2000);
                                      });
                                    }}
                                  >
                                    <Copy size={11} /> {isCopied ? 'Copied!' : 'Copy'}
                                  </button>
                                </div>
                              </div>
                              {isExpanded && (
                                <pre className="code-block text-xs overflow-x-auto" style={{ maxHeight: 360 }}>
                                  <code>{file.content}</code>
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'done' && (
        <>
          <div className="text-center animate-fade-in stagger-2 mt-6 flex items-center justify-center gap-3" style={{ flexWrap: 'wrap' }}>
            {errors.length > 0 && canPublish && signoffsComplete && (
              <button className="btn btn-secondary px-6 py-3 gap-2" onClick={handleRetry}>
                <RotateCcw size={15} /> Retry Failed Steps
              </button>
            )}
            <button className="btn btn-primary px-8 py-3" onClick={() => navigate('/')}>
              Return to Dashboard
            </button>
          </div>
          {errors.length > 0 && canPublish && signoffsComplete && (
            <p className="text-xs text-tertiary mt-2 text-center">
              Retries are idempotent — artifacts that were already created will be skipped.
            </p>
          )}
          <PublishHistory manifests={manifests} canRollback={canRollback} onRollback={setRollbackTarget} />
        </>
      )}
    </div>
  );
};
