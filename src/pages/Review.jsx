import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CheckCircle, AlertTriangle, Edit3, Save, Trash2, GitMerge,
  FileText, X, TestTube, ThumbsUp, ThumbsDown, CheckSquare, Download,
  Quote, History, ShieldCheck, ShieldAlert, Link2, Search, Loader2,
  ArrowUpDown, ExternalLink, Plus, Info, PenLine, Undo2, ChevronDown, ChevronUp
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { PipelineSteps } from '../components/PipelineSteps';
import { mockStories } from '../mocks';
import { ReactFlow, Background, Controls, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { can, PERMS, ROLE_LABELS } from '../services/authzService';
import { lintAll } from '../services/lintService';
import { recordAudit, getAudit } from '../services/auditService';
import { getLatestVersionId } from '../services/versionService';
import { findSimilarIssues } from '../services/jiraService';
import './Review.css';

/* global __ATLASSIAN_DOMAIN__ */
const JIRA_DOMAIN = typeof __ATLASSIAN_DOMAIN__ !== 'undefined' ? __ATLASSIAN_DOMAIN__ : '';
const JIRA_CONFIGURED = Boolean(JIRA_DOMAIN);

const FIGMA_RX = /figma\.com\/(file|design|proto)\//;

const SIGNOFF_SLOTS = [
  { kind: 'prd', label: 'PRD', roleHint: 'TPM', perm: PERMS.SIGNOFF_PRD },
  { kind: 'engineering', label: 'Engineering', roleHint: 'Eng Lead', perm: PERMS.SIGNOFF_ENGINEERING },
  { kind: 'qa', label: 'QA', roleHint: 'QA Lead', perm: PERMS.SIGNOFF_QA }
];

// Confidence bands: ≥0.8 high (teal) · 0.5–0.8 medium (amber) · <0.5 low (rose).
// Missing or low confidence → "verify manually" note.
const confidenceMeta = (c) => {
  if (typeof c !== 'number' || Number.isNaN(c)) {
    return { cls: 'conf-unknown', label: 'No confidence', verify: true };
  }
  const pct = Math.round(Math.max(0, Math.min(1, c)) * 100);
  if (c >= 0.8) return { cls: 'conf-high', label: `${pct}% confidence`, verify: false };
  if (c >= 0.5) return { cls: 'conf-medium', label: `${pct}% confidence`, verify: false };
  return { cls: 'conf-low', label: `${pct}% confidence`, verify: true };
};

const confidenceSortValue = (story) =>
  typeof story?.confidence === 'number' && !Number.isNaN(story.confidence) ? story.confidence : -1;

const formatAuditValue = (v) => {
  if (v === null || v === undefined) return '—';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 70 ? `${s.slice(0, 70)}…` : s;
};

const formatTime = (iso) => {
  try { return new Date(iso).toLocaleString(); } catch { return String(iso || ''); }
};

const CustomNode = ({ data }) => (
  <div className={`custom-node ${data.approved ? 'approved' : ''} ${data.discarded ? 'discarded' : ''}`}>
    <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-primary" />
    <div className="node-header">
      <span>{data.storyId}</span>
      <span className="node-badge">{data.points} pts</span>
    </div>
    <div className="node-title">{data.label}</div>
    {data.riskCount > 0 && (
      <div className="text-xs text-error mt-2 flex items-center gap-1">
        <AlertTriangle size={10} /> {data.riskCount} Risk{data.riskCount > 1 ? 's' : ''}
      </div>
    )}
    <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-primary" />
  </div>
);

const nodeTypes = { custom: CustomNode };

export const Review = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    stories, setStoriesFromExtraction, approvedStoryIds, discardedStoryIds,
    approveStory, discardStory, approveAll, updateStory,
    currentUser, signoffs, doSignoff, undoSignoff, signoffsComplete,
    featureFlags, storiesPrdVersionId, contradictions, currentPipelineId
  } = useApp();

  const [selectedStoryId, setSelectedStoryId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [viewMode, setViewMode] = useState('solutioning');
  const [selectedSolutionId, setSelectedSolutionId] = useState({});

  // Governance & intelligence state
  const [sortLowConfidence, setSortLowConfidence] = useState(false);
  const [evidenceOpenId, setEvidenceOpenId] = useState(null);
  const [lintOpenId, setLintOpenId] = useState(null);
  const [overriddenIds, setOverriddenIds] = useState(new Set());
  const [overrideTarget, setOverrideTarget] = useState(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [historyStory, setHistoryStory] = useState(null);
  const [historyEntries, setHistoryEntries] = useState([]);
  const [comparables, setComparables] = useState({});
  const [duplicates, setDuplicates] = useState({});
  const [showContradictions, setShowContradictions] = useState(false);

  useEffect(() => {
    if (searchParams.get('mock') === 'true' && stories.length === 0) {
      setStoriesFromExtraction(mockStories);
    }
  }, []);

  useEffect(() => {
    if (stories.length > 0 && !selectedStoryId) {
      setSelectedStoryId(stories[0].id);
    }
  }, [stories]);

  // Esc closes the topmost overlay (modal > drawer > popovers).
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (overrideTarget) { setOverrideTarget(null); setOverrideReason(''); }
      else if (historyStory) setHistoryStory(null);
      else { setEvidenceOpenId(null); setLintOpenId(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [overrideTarget, historyStory]);

  const lintResults = useMemo(() => {
    try { return lintAll(stories); } catch { return new Map(); }
  }, [stories]);

  // ── Permission gates (viewer etc. see disabled controls with honest tooltips) ─
  const canApprove = can(currentUser, PERMS.APPROVE_STORY);
  const canEdit = can(currentUser, PERMS.EDIT_STORY);
  const canOverride = can(currentUser, PERMS.OVERRIDE_LINT);
  const canViewAudit = can(currentUser, PERMS.VIEW_AUDIT);
  const isAdmin = currentUser?.role === 'admin';
  const roleLabel = ROLE_LABELS[currentUser?.role] || 'your role';

  // ── Stale-PRD detection ────────────────────────────────────────────────────
  let latestVersionId = null;
  try { latestVersionId = getLatestVersionId(); } catch { latestVersionId = null; }
  const prdStale = stories.length > 0 && latestVersionId !== storiesPrdVersionId;

  if (stories.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ minHeight: '60vh', gap: '1rem' }}>
        <FileText size={48} style={{ color: 'var(--text-tertiary)' }} />
        <h2 className="text-2xl font-bold">No Stories to Review</h2>
        <p className="text-secondary text-center">Upload transcripts on the Dashboard and run the pipeline to extract stories.</p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>Go to Dashboard</button>
      </div>
    );
  }

  const selectedStory = stories.find(s => s.id === selectedStoryId);
  const activeStories = stories.filter(s => !discardedStoryIds.has(s.id));
  const approvedCount = stories.filter(s => approvedStoryIds.has(s.id)).length;
  const pendingCount = activeStories.filter(s => !approvedStoryIds.has(s.id)).length;

  const displayStories = sortLowConfidence
    ? [...stories].sort((a, b) => confidenceSortValue(a) - confidenceSortValue(b))
    : stories;

  const lintFor = (id) => lintResults.get(id) || { errors: [], warnings: [], score: 100 };
  const isLintBlocked = (story) =>
    lintFor(story.id).errors.length > 0 && !overriddenIds.has(story.id);

  const blockedPendingCount = activeStories
    .filter(s => !approvedStoryIds.has(s.id) && isLintBlocked(s)).length;

  const signedCount = SIGNOFF_SLOTS.filter(s => signoffs?.[s.kind]).length;

  // ── Edit flow (adds Design links) ─────────────────────────────────────────
  const startEdit = (story) => {
    if (!canEdit) return;
    setEditingId(story.id);
    setEditForm({
      ...story,
      acText: (story.acceptanceCriteria || []).join('\n'),
      figmaLinks: Array.isArray(story.figmaLinks) ? [...story.figmaLinks] : []
    });
  };

  const editFigmaInvalid = (editForm?.figmaLinks || [])
    .some(l => l.trim() && !FIGMA_RX.test(l.trim()));

  const saveEdit = () => {
    if (editFigmaInvalid) return;
    const { acText, ...rest } = editForm;
    updateStory(editingId, {
      ...rest,
      acceptanceCriteria: acText.split('\n').filter(l => l.trim()),
      figmaLinks: (editForm.figmaLinks || []).map(l => l.trim()).filter(Boolean)
    });
    setEditingId(null);
    setEditForm(null);
  };

  const cancelEdit = () => { setEditingId(null); setEditForm(null); };

  const setFigmaLink = (index, value) => {
    setEditForm(prev => ({
      ...prev,
      figmaLinks: prev.figmaLinks.map((l, i) => (i === index ? value : l))
    }));
  };

  const addFigmaLink = () => setEditForm(prev => ({ ...prev, figmaLinks: [...(prev.figmaLinks || []), ''] }));
  const removeFigmaLink = (index) => setEditForm(prev => ({
    ...prev, figmaLinks: prev.figmaLinks.filter((_, i) => i !== index)
  }));

  // ── Approve / override flow ────────────────────────────────────────────────
  const handleApprove = (story) => {
    if (!canApprove || isLintBlocked(story)) return;
    approveStory(story.id);
  };

  const handleDiscard = (story) => {
    if (!canApprove) return;
    discardStory(story.id);
  };

  const openOverride = (story) => {
    if (!canOverride) return;
    setOverrideReason('');
    setOverrideTarget(story);
  };

  const confirmOverride = () => {
    if (!overrideTarget || !overrideReason.trim()) return;
    try {
      recordAudit({
        action: 'lint.override',
        entityType: 'story',
        entityId: overrideTarget.id,
        reason: overrideReason.trim(),
        pipelineId: currentPipelineId || undefined
      });
    } catch { /* audit must not block the override */ }
    setOverriddenIds(prev => new Set([...prev, overrideTarget.id]));
    approveStory(overrideTarget.id);
    setOverrideTarget(null);
    setOverrideReason('');
  };

  const handleApproveAll = () => {
    if (!canApprove || blockedPendingCount > 0) return;
    approveAll();
  };

  // ── Story history drawer ───────────────────────────────────────────────────
  const openHistory = (story) => {
    if (!canViewAudit) return;
    let entries = [];
    try { entries = getAudit({ entityType: 'story', entityId: story.id }); } catch { entries = []; }
    setHistoryStory(story);
    setHistoryEntries(entries);
  };

  // ── Jira comparables & duplicate check ─────────────────────────────────────
  const runFindComparables = async (story) => {
    setComparables(prev => ({ ...prev, [story.id]: { loading: true } }));
    try {
      const items = await findSimilarIssues(
        `${story.title || ''} ${story.description || ''}`,
        { maxResults: 5, resolvedOnly: true }
      );
      setComparables(prev => ({ ...prev, [story.id]: { loading: false, items } }));
    } catch (err) {
      setComparables(prev => ({ ...prev, [story.id]: { loading: false, error: err?.message || 'Search failed.' } }));
    }
  };

  const runCheckDuplicates = async (story) => {
    setDuplicates(prev => ({ ...prev, [story.id]: { loading: true } }));
    try {
      const items = await findSimilarIssues(
        `${story.title || ''} ${story.description || ''}`,
        { maxResults: 5, resolvedOnly: false }
      );
      setDuplicates(prev => ({ ...prev, [story.id]: { loading: false, items } }));
    } catch (err) {
      setDuplicates(prev => ({ ...prev, [story.id]: { loading: false, error: err?.message || 'Search failed.' } }));
    }
  };

  const toggleLinkInstead = (story, issueKey) => {
    if (!canEdit) return;
    updateStory(story.id, { linkedIssueKey: story.linkedIssueKey === issueKey ? null : issueKey });
  };

  const downloadFeatureFile = (story) => {
    const slug = story.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
    const featureContent = `Feature: ${story.title}\n  ${story.description}\n\n${(story.qaScenarios || []).join('\n\n')}`;
    const blob = new Blob([featureContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.feature`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePushToJira = () => {
    // The button is disabled at 0 approved; this guard is a defensive backstop.
    if (approvedCount === 0) return;
    navigate('/handoff');
  };

  const nodes = activeStories.map((s, idx) => ({
    id: s.id,
    type: 'custom',
    position: { x: 80 + (idx % 3) * 280, y: 80 + Math.floor(idx / 3) * 180 },
    data: {
      label: s.title,
      storyId: s.id.toUpperCase(),
      points: s.adjustedPoints,
      riskCount: (s.riskFlags || []).length,
      approved: approvedStoryIds.has(s.id),
      discarded: discardedStoryIds.has(s.id)
    }
  }));

  const edges = activeStories.flatMap(s =>
    (s.dependencies || []).filter(dep => stories.find(st => st.id === dep)).map(dep => ({
      id: `e-${s.id}-${dep}`,
      source: dep,
      target: s.id,
      animated: true,
      style: { stroke: 'var(--color-primary)' },
      label: 'blocks',
      labelStyle: { fill: 'var(--text-tertiary)', fontSize: 11 }
    }))
  );

  const getStoryStatus = (story) => {
    if (discardedStoryIds.has(story.id)) return 'discarded';
    if (approvedStoryIds.has(story.id)) return 'approved';
    return 'pending';
  };

  const selectedComparables = selectedStory ? comparables[selectedStory.id] : null;
  const selectedDuplicates = selectedStory ? duplicates[selectedStory.id] : null;

  return (
    <div className="review-dashboard h-full flex flex-col">
      <PipelineSteps current="review" />
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Review Checkpoint</h1>
          <p className="text-secondary">
            {approvedCount} approved · {pendingCount} pending ·{' '}
            {discardedStoryIds.size} discarded
          </p>
        </div>
        <div className="flex gap-3">
          <button
            className="btn btn-secondary"
            onClick={handleApproveAll}
            disabled={!canApprove || blockedPendingCount > 0}
            title={
              !canApprove
                ? `Approving requires the approve_story permission — ${roleLabel} cannot approve.`
                : blockedPendingCount > 0
                  ? `${blockedPendingCount} pending stor${blockedPendingCount === 1 ? 'y has' : 'ies have'} INVEST errors — fix or override first.`
                  : 'Approve all stories'
            }
          >
            <CheckSquare size={16} /> Approve All
          </button>
          <button className="btn btn-primary" onClick={handlePushToJira} disabled={approvedCount === 0}>
            <CheckCircle size={18} />
            Push {approvedCount} Stories to Jira
          </button>
        </div>
      </header>

      {/* ── Sign-off gates panel ─────────────────────────────────────────── */}
      <section className="signoff-panel glass-panel">
        <div className="signoff-head">
          <div className="flex items-center gap-2">
            {signoffsComplete
              ? <ShieldCheck size={18} style={{ color: 'var(--color-success)' }} />
              : <ShieldAlert size={18} style={{ color: 'var(--color-warning)' }} />}
            <div>
              <h3 className="font-semibold text-sm">Sign-off gates</h3>
              <p className="text-xs text-secondary">
                {featureFlags.soloMode
                  ? 'Solo mode is on — publishing is unlocked without sign-offs (change in Admin › Governance).'
                  : 'Publishing on the Handoff page unlocks when PRD, Engineering and QA have all signed off.'}
              </p>
            </div>
          </div>
          <span className={`badge ${signoffsComplete ? 'badge-success' : 'badge-warning'}`}>
            {featureFlags.soloMode && signedCount < 3 ? 'Solo mode' : `${signedCount} of 3 signed`}
          </span>
        </div>
        <div className="signoff-slots">
          {SIGNOFF_SLOTS.map(slot => {
            const rec = signoffs?.[slot.kind] || null;
            const maySign = can(currentUser, slot.perm);
            const mayRevoke = rec && (isAdmin || rec.by === currentUser?.id);
            return (
              <div key={slot.kind} className={`signoff-slot ${rec ? 'signed' : ''}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="signoff-slot-label">{slot.label}</span>
                  <span className="text-xs text-tertiary">{slot.roleHint}</span>
                </div>
                {rec ? (
                  <>
                    <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-success)' }}>
                      <CheckCircle size={12} /> {rec.name}
                    </div>
                    <div className="text-xs text-tertiary mb-2">{formatTime(rec.at)}</div>
                    <button
                      className="btn btn-secondary text-xs py-1 px-2"
                      onClick={() => undoSignoff(slot.kind)}
                      disabled={!mayRevoke}
                      title={mayRevoke ? 'Revoke this sign-off' : 'Only the signer or an admin can revoke.'}
                    >
                      <Undo2 size={12} /> Revoke
                    </button>
                  </>
                ) : (
                  <>
                    <div className="text-xs text-tertiary mb-2">Not signed yet</div>
                    <button
                      className="btn btn-primary text-xs py-1 px-2"
                      onClick={() => doSignoff(slot.kind)}
                      disabled={!maySign}
                      title={maySign
                        ? `Record the ${slot.label} sign-off as ${currentUser?.name || 'you'}`
                        : `Requires the ${slot.perm} permission — switch to ${slot.roleHint} or Admin.`}
                    >
                      <PenLine size={12} /> Sign off
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Stale PRD banner ─────────────────────────────────────────────── */}
      {prdStale && (
        <div className="review-banner stale-banner-row">
          <Info size={15} />
          <span>
            The PRD has changed since these stories were generated. Review the differences, then
            re-generate stories if the changes affect scope.
          </span>
          <button className="btn btn-secondary text-xs py-1 px-2" onClick={() => navigate('/prd')}>
            View PRD
          </button>
        </div>
      )}

      {/* ── Contradictions banner (multi-transcript synthesis) ──────────── */}
      {Array.isArray(contradictions) && contradictions.length > 0 && (
        <div className="review-banner contradiction-banner">
          <div className="flex items-center gap-2 flex-1">
            <AlertTriangle size={15} />
            <span>
              {contradictions.length} contradiction{contradictions.length > 1 ? 's' : ''} detected
              across transcripts — sources disagree on the topics below.
            </span>
          </div>
          <button
            className="btn btn-secondary text-xs py-1 px-2"
            onClick={() => setShowContradictions(v => !v)}
          >
            {showContradictions ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Details
          </button>
          {showContradictions && (
            <ul className="contradiction-list">
              {contradictions.map((c, i) => (
                <li key={i}>
                  <span className="font-semibold">{c.topic || 'Unspecified topic'}:</span>{' '}
                  <span className="text-secondary">"{c.a}"</span> vs{' '}
                  <span className="text-secondary">"{c.b}"</span>
                  {Array.isArray(c.files) && c.files.length > 0 && (
                    <span className="text-tertiary"> ({c.files.join(', ')})</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="review-layout">
        {/* Left: Story List */}
        <div className="story-list-pane flex-col gap-4 scrollable-y pr-2">
          <div className="list-toolbar">
            <span className="text-xs text-tertiary">{stories.length} stories</span>
            <button
              className={`btn btn-secondary text-xs py-1 px-2 ${sortLowConfidence ? 'sort-active' : ''}`}
              onClick={() => setSortLowConfidence(v => !v)}
              title="Sort the lowest-confidence stories to the top for manual verification"
              aria-pressed={sortLowConfidence}
            >
              <ArrowUpDown size={12} /> Low confidence first
            </button>
          </div>

          {displayStories.map(story => {
            const status = getStoryStatus(story);
            const lint = lintFor(story.id);
            const conf = confidenceMeta(story.confidence);
            const quotes = Array.isArray(story.sourceQuotes) ? story.sourceQuotes : [];
            const lintBlocked = isLintBlocked(story);
            const overridden = overriddenIds.has(story.id);
            return (
              <div
                key={story.id}
                className={`story-card card ${selectedStoryId === story.id ? 'selected' : ''} status-${status}`}
                style={status === 'discarded' ? { opacity: 0.45 } : {}}
              >
                {editingId === story.id ? (
                  <div className="edit-form flex-col gap-3">
                    <input
                      className="input-field font-bold text-base"
                      value={editForm.title}
                      onChange={e => setEditForm({ ...editForm, title: e.target.value })}
                      placeholder="Story title"
                    />
                    <textarea
                      className="input-field text-sm"
                      value={editForm.description}
                      onChange={e => setEditForm({ ...editForm, description: e.target.value })}
                      rows={3}
                    />
                    <div>
                      <span className="text-xs text-secondary uppercase block mb-1">Acceptance Criteria (1 per line)</span>
                      <textarea
                        className="input-field text-sm font-mono bg-root"
                        style={{ minHeight: '100px' }}
                        value={editForm.acText}
                        onChange={e => setEditForm({ ...editForm, acText: e.target.value })}
                      />
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-sm">Story Points:</span>
                      <input
                        type="number"
                        className="input-field w-20 text-center"
                        value={editForm.adjustedPoints}
                        onChange={e => setEditForm({ ...editForm, adjustedPoints: parseInt(e.target.value) || 0 })}
                        min={1} max={21}
                      />
                    </div>
                    <div className="figma-links-editor">
                      <span className="text-xs text-secondary uppercase block mb-1">Design links (Figma)</span>
                      {(editForm.figmaLinks || []).map((link, i) => {
                        const bad = Boolean(link.trim()) && !FIGMA_RX.test(link.trim());
                        return (
                          <div key={i} className="flex items-center gap-2 mb-2">
                            <input
                              className={`input-field text-sm flex-1 ${bad ? 'input-invalid' : ''}`}
                              value={link}
                              placeholder="https://www.figma.com/design/…"
                              onChange={e => setFigmaLink(i, e.target.value)}
                            />
                            <button
                              className="btn btn-secondary p-1.5"
                              onClick={() => removeFigmaLink(i)}
                              title="Remove link"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        );
                      })}
                      {editFigmaInvalid && (
                        <p className="text-xs mb-2" style={{ color: 'var(--color-error)' }}>
                          Design links must be Figma file, design or proto URLs (figma.com/file|design|proto/…).
                        </p>
                      )}
                      <button className="btn btn-secondary text-xs py-1 px-2" onClick={addFigmaLink}>
                        <Plus size={12} /> Add design link
                      </button>
                    </div>
                    <div className="flex justify-end gap-2 mt-2">
                      <button className="btn btn-secondary" onClick={cancelEdit}><X size={14} /> Cancel</button>
                      <button
                        className="btn btn-primary"
                        onClick={saveEdit}
                        disabled={editFigmaInvalid}
                        title={editFigmaInvalid ? 'Fix invalid design links before saving.' : 'Save changes'}
                      >
                        <Save size={14} /> Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="cursor-pointer" onClick={() => setSelectedStoryId(story.id)}>
                      <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2 flex-1 pr-2">
                          {status === 'approved' && <CheckCircle size={14} style={{ color: 'var(--color-success)', flexShrink: 0 }} />}
                          {status === 'discarded' && <X size={14} style={{ color: 'var(--color-error)', flexShrink: 0 }} />}
                          <h3 className="font-semibold text-sm pr-2 line-clamp-2">{story.title}</h3>
                        </div>
                        <span className="badge badge-info whitespace-nowrap" style={{ fontSize: '0.7rem' }}>{story.adjustedPoints} pts</span>
                      </div>

                      {(story.riskFlags || []).length > 0 && (
                        <div className="risk-chip flex items-center gap-1 text-xs mb-2">
                          <AlertTriangle size={11} />
                          <span>{story.riskFlags.length} Risk{story.riskFlags.length > 1 ? 's' : ''}</span>
                        </div>
                      )}
                    </div>

                    {/* Grounding + governance meta */}
                    <div className="story-meta-row">
                      <span className={`conf-badge ${conf.cls}`} title="Extraction confidence reported by the AI">
                        {conf.label}
                      </span>
                      {conf.verify && (
                        <span className="verify-note" title="Low or missing confidence — check this story against the source transcript.">
                          <AlertTriangle size={10} /> verify manually
                        </span>
                      )}
                      {quotes.length > 0 && (
                        <button
                          className="evidence-chip"
                          onClick={() => setEvidenceOpenId(evidenceOpenId === story.id ? null : story.id)}
                          title="Show the transcript lines this story is grounded in"
                          aria-expanded={evidenceOpenId === story.id}
                        >
                          <Quote size={10} /> {quotes.length} source{quotes.length > 1 ? 's' : ''}
                        </button>
                      )}
                      {prdStale && (
                        <span className="badge badge-warning stale-badge" title="The PRD has a newer version than the one these stories came from.">
                          Stale — PRD changed
                        </span>
                      )}
                      {story.linkedIssueKey && (
                        <span className="badge badge-info" title="Handoff will link this existing Jira issue instead of creating a new one.">
                          <Link2 size={10} /> {story.linkedIssueKey}
                        </span>
                      )}
                      {overridden && (
                        <span className="badge badge-warning" title="INVEST lint errors were overridden with a recorded reason.">
                          Lint overridden
                        </span>
                      )}
                    </div>

                    {evidenceOpenId === story.id && quotes.length > 0 && (
                      <div className="evidence-panel">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-semibold">Source evidence</span>
                          <button className="evidence-close" onClick={() => setEvidenceOpenId(null)} aria-label="Close evidence">
                            <X size={12} />
                          </button>
                        </div>
                        <ul>
                          {quotes.map((q, i) => (
                            <li key={i}>
                              <span className="evidence-quote">"{q.quote}"</span>
                              {q.file && <span className="evidence-file">— {q.file}</span>}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* INVEST lint pill */}
                    <button
                      className={`lint-pill ${lint.errors.length > 0 ? 'has-errors' : lint.warnings.length > 0 ? 'has-warnings' : 'clean'}`}
                      onClick={() => setLintOpenId(lintOpenId === story.id ? null : story.id)}
                      aria-expanded={lintOpenId === story.id}
                      title="INVEST / Definition-of-Ready lint results"
                    >
                      {lint.errors.length > 0 ? <ShieldAlert size={11} /> : <ShieldCheck size={11} />}
                      {lint.errors.length} error{lint.errors.length !== 1 ? 's' : ''} · {lint.warnings.length} warning{lint.warnings.length !== 1 ? 's' : ''} · score {lint.score}
                      {lintOpenId === story.id ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                    </button>

                    {lintOpenId === story.id && (
                      <ul className="lint-list">
                        {lint.errors.length === 0 && lint.warnings.length === 0 && (
                          <li className="lint-item-ok">Passes all INVEST checks.</li>
                        )}
                        {lint.errors.map((e, i) => (
                          <li key={`e-${i}`} className="lint-item-error">
                            <AlertTriangle size={11} /> <span><strong>{e.rule}</strong> — {e.message}</span>
                          </li>
                        ))}
                        {lint.warnings.map((w, i) => (
                          <li key={`w-${i}`} className="lint-item-warning">
                            <Info size={11} /> <span><strong>{w.rule}</strong> — {w.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div className="flex justify-between items-center mt-3 pt-3 border-t border-subtle">
                      <div className="flex gap-1 items-center">
                        <button
                          className={`btn p-1.5 text-xs ${status === 'approved' ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => handleApprove(story)}
                          disabled={!canApprove || lintBlocked}
                          title={
                            !canApprove
                              ? `Approving requires the approve_story permission — ${roleLabel} cannot approve.`
                              : lintBlocked
                                ? `Blocked by ${lint.errors.length} INVEST error${lint.errors.length > 1 ? 's' : ''} — fix the story or override with a reason.`
                                : 'Approve'
                          }
                        >
                          <ThumbsUp size={13} />
                        </button>
                        <button
                          className="btn btn-danger p-1.5"
                          onClick={() => handleDiscard(story)}
                          disabled={!canApprove}
                          title={canApprove ? 'Discard' : `Discarding requires the approve_story permission — ${roleLabel} cannot discard.`}
                        >
                          <ThumbsDown size={13} />
                        </button>
                        {lintBlocked && canOverride && status !== 'approved' && (
                          <button
                            className="btn btn-secondary text-xs py-1 px-2 override-btn"
                            onClick={() => openOverride(story)}
                            title="Override the lint block with a recorded reason (audit-logged), then approve."
                          >
                            Override…
                          </button>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <button
                          className="btn btn-secondary p-1.5"
                          onClick={() => openHistory(story)}
                          disabled={!canViewAudit}
                          title={canViewAudit ? 'View change history' : `History requires the view_audit permission — ${roleLabel} cannot view it.`}
                        >
                          <History size={13} />
                        </button>
                        <button
                          className="btn btn-secondary p-1.5"
                          onClick={() => startEdit(story)}
                          disabled={!canEdit}
                          title={canEdit ? 'Edit' : `Editing requires the edit_story permission — ${roleLabel} cannot edit.`}
                        >
                          <Edit3 size={13} />
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* Right: Details */}
        <div className="details-pane card flex flex-col h-full">
          <div className="flex gap-1 border-b border-subtle pb-3 mb-4">
            {[
              { id: 'solutioning', icon: FileText, label: 'Technical Solutioning' },
              { id: 'qa', icon: TestTube, label: 'QA Tests' },
              { id: 'dependencies', icon: GitMerge, label: 'Dependency Map' }
            ].map(tab => (
              <button
                key={tab.id}
                className={`tab-btn flex gap-2 items-center text-sm ${viewMode === tab.id ? 'active' : ''}`}
                onClick={() => setViewMode(tab.id)}
              >
                <tab.icon size={15} />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-hidden relative">
            {viewMode === 'solutioning' && selectedStory && (
              <div className="solution-content scrollable-y absolute inset-0 pr-2 animate-fade-in">
                <div className="flex justify-between items-start mb-4">
                  <h2 className="text-xl font-bold">{selectedStory.title}</h2>
                  <div className="flex items-center gap-2">
                    {(() => {
                      const conf = confidenceMeta(selectedStory.confidence);
                      return <span className={`conf-badge ${conf.cls}`}>{conf.label}</span>;
                    })()}
                    <span className="badge badge-info">{selectedStory.adjustedPoints} pts</span>
                  </div>
                </div>

                {selectedStory.linkedIssueKey && (
                  <div className="linked-issue-note">
                    <Link2 size={14} />
                    <span>
                      Linked to existing issue <strong>{selectedStory.linkedIssueKey}</strong> — Handoff will
                      relate this story to it instead of creating a new Jira issue.
                    </span>
                  </div>
                )}

                {(selectedStory.riskFlags || []).length > 0 && (
                  <div className="risk-banner">
                    <h4 className="flex items-center gap-2 text-error font-semibold mb-2 text-sm">
                      <AlertTriangle size={16} /> Risk Flags
                    </h4>
                    <ul className="risk-list text-xs space-y-1">
                      {selectedStory.riskFlags.map(r => <li key={r.id}>{r.text}</li>)}
                    </ul>
                  </div>
                )}

                <div className="mb-6">
                  <p className="text-secondary text-sm">{selectedStory.description}</p>
                </div>

                <div className="mb-6">
                  <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                    <CheckCircle size={16} style={{ color: 'var(--color-success)' }} /> Acceptance Criteria
                  </h3>
                  <ul className="list-disc pl-5 space-y-1 text-secondary text-sm">
                    {(selectedStory.acceptanceCriteria || []).map((ac, i) => <li key={i}>{ac}</li>)}
                  </ul>
                </div>

                {Array.isArray(selectedStory.figmaLinks) && selectedStory.figmaLinks.length > 0 && (
                  <div className="mb-6">
                    <h3 className="text-base font-semibold mb-3">Design links</h3>
                    <ul className="figma-link-list">
                      {selectedStory.figmaLinks.map((link, i) => (
                        <li key={i}>
                          <a href={link} target="_blank" rel="noopener noreferrer" className="figma-link">
                            <ExternalLink size={12} /> {link}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Jira intelligence: comparables + duplicate check (hidden when Jira unconfigured) */}
                {JIRA_CONFIGURED && (
                  <div className="mb-6 jira-insights">
                    <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                      <Search size={15} style={{ color: 'var(--color-info)' }} /> Jira intelligence
                    </h3>
                    <div className="flex gap-2 flex-wrap mb-3">
                      <button
                        className="btn btn-secondary text-xs py-1.5 px-3"
                        onClick={() => runFindComparables(selectedStory)}
                        disabled={Boolean(selectedComparables?.loading)}
                      >
                        {selectedComparables?.loading
                          ? <Loader2 size={13} className="animate-spin" />
                          : <Search size={13} />} Find comparables
                      </button>
                      <button
                        className="btn btn-secondary text-xs py-1.5 px-3"
                        onClick={() => runCheckDuplicates(selectedStory)}
                        disabled={Boolean(selectedDuplicates?.loading)}
                      >
                        {selectedDuplicates?.loading
                          ? <Loader2 size={13} className="animate-spin" />
                          : <Link2 size={13} />} Check duplicates
                      </button>
                    </div>

                    {/* Comparables — resolved issues for estimation by analogy */}
                    {selectedComparables && (
                      <div className="insight-block">
                        <span className="insight-title">Comparable resolved issues</span>
                        {selectedComparables.loading && (
                          <p className="text-xs text-tertiary flex items-center gap-2">
                            <Loader2 size={12} className="animate-spin" /> Searching resolved issues…
                          </p>
                        )}
                        {selectedComparables.error && (
                          <p className="text-xs" style={{ color: 'var(--color-error)' }}>{selectedComparables.error}</p>
                        )}
                        {!selectedComparables.loading && !selectedComparables.error && (
                          (selectedComparables.items || []).length === 0 ? (
                            <p className="text-xs text-tertiary">No comparable resolved issues found.</p>
                          ) : (
                            <ul className="issue-list">
                              {selectedComparables.items.map(it => (
                                <li key={it.key} className="issue-row">
                                  <a href={it.url} target="_blank" rel="noopener noreferrer" className="issue-key">
                                    {it.key} <ExternalLink size={10} />
                                  </a>
                                  <span className="issue-summary">{it.summary}</span>
                                  <span className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>{it.status}</span>
                                  <span className="badge badge-info" style={{ fontSize: '0.65rem' }}>
                                    {it.points != null ? `${it.points} pts` : 'no pts'}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )
                        )}
                      </div>
                    )}

                    {/* Duplicate check — link instead of create */}
                    {selectedDuplicates && (
                      <div className="insight-block">
                        <span className="insight-title">Possible duplicates</span>
                        {selectedDuplicates.loading && (
                          <p className="text-xs text-tertiary flex items-center gap-2">
                            <Loader2 size={12} className="animate-spin" /> Searching existing issues…
                          </p>
                        )}
                        {selectedDuplicates.error && (
                          <p className="text-xs" style={{ color: 'var(--color-error)' }}>{selectedDuplicates.error}</p>
                        )}
                        {!selectedDuplicates.loading && !selectedDuplicates.error && (
                          (selectedDuplicates.items || []).length === 0 ? (
                            <p className="text-xs text-tertiary">No similar existing issues found — safe to create.</p>
                          ) : (
                            <ul className="issue-list">
                              {selectedDuplicates.items.map(it => {
                                const linked = selectedStory.linkedIssueKey === it.key;
                                return (
                                  <li key={it.key} className="issue-row">
                                    <span className="badge badge-warning" style={{ fontSize: '0.65rem' }}>Possible duplicate</span>
                                    <a href={it.url} target="_blank" rel="noopener noreferrer" className="issue-key">
                                      {it.key} <ExternalLink size={10} />
                                    </a>
                                    <span className="issue-summary">{it.summary}</span>
                                    <span className="badge badge-neutral" style={{ fontSize: '0.65rem' }}>{it.status}</span>
                                    <button
                                      className={`btn text-xs py-1 px-2 ${linked ? 'btn-primary' : 'btn-secondary'}`}
                                      onClick={() => toggleLinkInstead(selectedStory, it.key)}
                                      disabled={!canEdit}
                                      title={
                                        !canEdit
                                          ? `Linking requires the edit_story permission — ${roleLabel} cannot change it.`
                                          : linked
                                            ? 'Linked — Handoff will not create a new issue. Click to unlink.'
                                            : 'Link this existing issue instead of creating a new one at Handoff.'
                                      }
                                    >
                                      <Link2 size={11} /> {linked ? 'Linked — will not create' : 'Link instead of create'}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-base font-semibold mb-3" style={{ color: 'var(--color-primary)' }}>
                    Technical Solution Proposals
                  </h3>
                  <div className="flex flex-col gap-3">
                    {(selectedStory.solution?.options || []).map(opt => {
                      const isSelected = (selectedSolutionId[selectedStory.id] || selectedStory.solution.options.find(o => o.recommended)?.id) === opt.id;
                      return (
                        <div
                          key={opt.id}
                          className={`solution-option ${isSelected ? 'selected glow-border' : ''}`}
                          onClick={() => setSelectedSolutionId(prev => ({ ...prev, [selectedStory.id]: opt.id }))}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <h4 className="font-semibold text-sm">{opt.name}</h4>
                            <div className="flex gap-2">
                              {opt.recommended && <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>AI Pick</span>}
                              {isSelected && <span className="badge badge-info" style={{ fontSize: '0.65rem' }}>Selected</span>}
                            </div>
                          </div>
                          <p className="text-xs text-secondary mb-3">{opt.description}</p>
                          <div className="grid grid-cols-2 gap-3 text-xs">
                            <div>
                              <span style={{ color: 'var(--color-success)' }} className="font-semibold">Pros</span>
                              <ul className="list-disc pl-3 text-secondary mt-1 space-y-0.5">
                                {(opt.pros || []).map((p, i) => <li key={i}>{p}</li>)}
                              </ul>
                            </div>
                            <div>
                              <span style={{ color: 'var(--color-warning)' }} className="font-semibold">Cons</span>
                              <ul className="list-disc pl-3 text-secondary mt-1 space-y-0.5">
                                {(opt.cons || []).map((c, i) => <li key={i}>{c}</li>)}
                              </ul>
                            </div>
                          </div>
                          <div className="flex justify-between items-center mt-3 pt-3 border-t border-subtle">
                            <span className="text-xs text-tertiary">Complexity: <span className="text-primary font-medium">{opt.complexity}</span></span>
                          </div>
                        </div>
                      );
                    })}
                    {(selectedStory.solution?.options || []).length === 0 && (
                      <p className="text-xs text-tertiary">No solution proposals were generated for this story.</p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {viewMode === 'qa' && selectedStory && (
              <div className="solution-content scrollable-y absolute inset-0 pr-2 animate-fade-in">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <TestTube style={{ color: 'var(--color-secondary)' }} size={20} />
                    QA Scenarios – {selectedStory.title}
                  </h2>
                  <button
                    className="btn btn-secondary text-xs py-1.5 px-3 gap-1 flex-shrink-0"
                    onClick={() => downloadFeatureFile(selectedStory)}
                    title="Download Gherkin .feature file"
                  >
                    <Download size={13} /> .feature file
                  </button>
                </div>
                <div className="qa-code-block text-sm text-secondary">
                  {(selectedStory.qaScenarios || []).join('\n\n') || 'No QA scenarios were generated for this story.'}
                </div>
              </div>
            )}

            {viewMode === 'dependencies' && (
              <div className="dependency-map-view animate-fade-in">
                {activeStories.length > 0 ? (
                  <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView>
                    <Background color="var(--border-subtle)" />
                    <Controls />
                  </ReactFlow>
                ) : (
                  <div className="flex items-center justify-center h-full text-secondary">
                    No active stories to display.
                  </div>
                )}
              </div>
            )}

            {!selectedStory && viewMode !== 'dependencies' && (
              <div className="flex items-center justify-center h-full text-secondary">
                Select a story to view details.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Lint override reason modal ───────────────────────────────────── */}
      {overrideTarget && (
        <div className="review-modal-overlay" onClick={() => { setOverrideTarget(null); setOverrideReason(''); }}>
          <div className="review-modal glass-strong" role="dialog" aria-modal="true" aria-label="Override INVEST lint" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-semibold flex items-center gap-2">
                <ShieldAlert size={16} style={{ color: 'var(--color-warning)' }} /> Override INVEST lint
              </h3>
              <button className="btn btn-secondary p-1.5" onClick={() => { setOverrideTarget(null); setOverrideReason(''); }} aria-label="Close">
                <X size={14} />
              </button>
            </div>
            <p className="text-sm text-secondary mb-2">
              "{overrideTarget.title}" has {lintFor(overrideTarget.id).errors.length} lint
              error{lintFor(overrideTarget.id).errors.length > 1 ? 's' : ''}:
            </p>
            <ul className="lint-list mb-3">
              {lintFor(overrideTarget.id).errors.map((e, i) => (
                <li key={i} className="lint-item-error">
                  <AlertTriangle size={11} /> <span><strong>{e.rule}</strong> — {e.message}</span>
                </li>
              ))}
            </ul>
            <label className="text-xs text-secondary uppercase block mb-1" htmlFor="override-reason">
              Reason for override (required — recorded in the audit trail)
            </label>
            <textarea
              id="override-reason"
              className="input-field text-sm"
              rows={3}
              value={overrideReason}
              onChange={e => setOverrideReason(e.target.value)}
              placeholder="Why is it acceptable to approve this story despite the lint errors?"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn btn-secondary" onClick={() => { setOverrideTarget(null); setOverrideReason(''); }}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={confirmOverride}
                disabled={!overrideReason.trim()}
                title={overrideReason.trim() ? 'Record the override and approve' : 'A reason is required.'}
              >
                <CheckCircle size={14} /> Override & approve
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Per-story history drawer ─────────────────────────────────────── */}
      {historyStory && (
        <div className="review-modal-overlay drawer-overlay" onClick={() => setHistoryStory(null)}>
          <aside className="history-drawer glass-strong" role="dialog" aria-modal="true" aria-label="Story history" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-1">
              <h3 className="font-semibold flex items-center gap-2">
                <History size={16} /> Story history
              </h3>
              <button className="btn btn-secondary p-1.5" onClick={() => setHistoryStory(null)} aria-label="Close history">
                <X size={14} />
              </button>
            </div>
            <p className="text-xs text-secondary mb-3 line-clamp-2">{historyStory.title}</p>
            {historyEntries.length === 0 ? (
              <div className="text-sm text-tertiary py-6 text-center">
                No recorded changes for this story yet. Edits, approvals and overrides will appear here.
              </div>
            ) : (
              <ul className="history-list scrollable-y">
                {historyEntries.map(entry => (
                  <li key={entry.id} className="history-entry">
                    <div className="flex justify-between items-center gap-2">
                      <span className="history-action">{entry.action}</span>
                      <span className="text-xs text-tertiary whitespace-nowrap">{formatTime(entry.ts)}</span>
                    </div>
                    <div className="text-xs text-secondary flex items-center gap-2 mt-0.5">
                      {entry.actor?.name || 'Unknown'} ({ROLE_LABELS[entry.actor?.role] || entry.actor?.role || '?'})
                      {entry.viaAI && <span className="badge badge-info" style={{ fontSize: '0.6rem' }}>AI</span>}
                    </div>
                    {entry.field && (
                      <div className="history-diff text-xs">
                        <span className="text-tertiary">{entry.field}:</span>{' '}
                        <span className="history-before">{formatAuditValue(entry.before)}</span>
                        {' → '}
                        <span className="history-after">{formatAuditValue(entry.after)}</span>
                      </div>
                    )}
                    {entry.reason && (
                      <div className="text-xs text-secondary mt-0.5">Reason: {entry.reason}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      )}
    </div>
  );
};
