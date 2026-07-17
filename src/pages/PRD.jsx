import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, Sparkles, Loader2, Download, ArrowRight, Edit3, Eye,
  Columns, RefreshCw, AlertCircle, AlertTriangle, Info, ListChecks,
  ScanSearch, History, X, Check, Save, ShieldCheck, RotateCcw, CheckCircle2
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { generatePRDDoc } from '../services/prdService';
import { extractStoriesFromFiles } from '../services/extractionService';
import { lintPrd, summarizeDiff } from '../services/apiService';
import { getVersions, diffLines, snapshotPrd } from '../services/versionService';
import { can, PERMS, ROLE_LABELS } from '../services/authzService';
import { recordAudit } from '../services/auditService';
import { PipelineSteps } from '../components/PipelineSteps';
import './PRD.css';

// ── Minimal, safe Markdown → HTML renderer ─────────────────────────────────────
// Source is HTML-escaped first, then a limited set of inline/block rules are applied,
// so PRD content can never inject markup into the preview.
const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const inline = (s) =>
  escapeHtml(s)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

const renderMarkdown = (md) => {
  const lines = (md || '').split('\n');
  const out = [];
  let listType = null; // 'ul' | 'ol'
  const closeList = () => { if (listType) { out.push(`</${listType}>`); listType = null; } };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { closeList(); continue; }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      closeList();
      const lvl = heading[1].length;
      out.push(`<h${lvl}>${inline(heading[2])}</h${lvl}>`);
      continue;
    }

    const ordered = line.match(/^\s*\d+\.\s+(.*)$/);
    if (ordered) {
      if (listType !== 'ol') { closeList(); out.push('<ol>'); listType = 'ol'; }
      out.push(`<li>${inline(ordered[1])}</li>`);
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
    if (unordered) {
      if (listType !== 'ul') { closeList(); out.push('<ul>'); listType = 'ul'; }
      out.push(`<li>${inline(unordered[1])}</li>`);
      continue;
    }

    closeList();
    out.push(`<p>${inline(line.trim())}</p>`);
  }
  closeList();
  return out.join('\n');
};

// ── Small helpers ──────────────────────────────────────────────────────────────
const fmtTime = (ts) => {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return String(ts || '');
  }
};

const TRIGGER_LABELS = { generate: 'AI generated', save: 'Manual save', lint_apply: 'Lint fix' };

const SEVERITY_META = {
  error: { badge: 'badge-error', Icon: AlertCircle },
  warning: { badge: 'badge-warning', Icon: AlertTriangle },
  info: { badge: 'badge-info', Icon: Info }
};

const MAX_DIFF_ROWS = 800;

export const PRD = () => {
  const navigate = useNavigate();
  const {
    prd, setPrd, prdSource, currentPipelineId,
    setStoriesFromExtraction, logPipelineEvent, settings,
    savePrdEdit, currentUser, signoffs, doSignoff, undoSignoff, featureFlags
  } = useApp();

  const [draft, setDraft] = useState(prd || '');
  const [view, setView] = useState('split'); // 'edit' | 'split' | 'preview'
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

  // AI Review (PRD linter) state
  const [lintOpen, setLintOpen] = useState(false);
  const [lintLoading, setLintLoading] = useState(false);
  const [lintError, setLintError] = useState('');
  const [lintIssues, setLintIssues] = useState(null); // null = not run yet
  const [appliedIssues, setAppliedIssues] = useState(new Set());

  // Version history drawer state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState('');
  const [restoreConfirmId, setRestoreConfirmId] = useState(null);
  const [restoreFlash, setRestoreFlash] = useState('');
  const flashTimer = useRef(null);

  // Keep the local draft in sync when a brand-new PRD arrives (e.g. after regenerate)
  useEffect(() => { setDraft(prd || ''); setDirty(false); }, [prd]);

  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // Close the history drawer on Escape
  useEffect(() => {
    if (!historyOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setHistoryOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [historyOpen]);

  const previewHtml = useMemo(() => renderMarkdown(draft), [draft]);

  const wordCount = useMemo(
    () => draft.trim() ? draft.trim().split(/\s+/).length : 0,
    [draft]
  );

  // ── Permissions & sign-off gate ───────────────────────────────────────────
  const canEditPrd = can(currentUser, PERMS.EDIT_PRD);
  const canSignPrd = can(currentUser, PERMS.SIGNOFF_PRD);
  const prdSignoff = signoffs?.prd || null;
  const soloMode = Boolean(featureFlags?.soloMode);
  const canGenerate = Boolean(prdSignoff) || soloMode;
  const canRevokeSignoff = Boolean(prdSignoff) &&
    (prdSignoff.by === currentUser?.id || currentUser?.role === 'admin');
  const roleLabel = ROLE_LABELS[currentUser?.role] || 'Unknown role';

  const onDraftChange = (value) => { setDraft(value); setDirty(true); };

  // ── Save (routes through savePrdEdit: snapshot + audit) ──────────────────
  const handleSave = () => {
    if (!dirty || !canEditPrd) return;
    try {
      savePrdEdit(draft);
      setSavedFlash(true);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setSavedFlash(false), 2000);
    } catch (err) {
      setError(`Save failed: ${err.message}`);
    }
  };

  const handleRegenerate = async () => {
    if (!prdSource) {
      setError('The original source text is no longer available. Start a new run from the Dashboard to regenerate.');
      return;
    }
    setError('');
    setIsRegenerating(true);
    try {
      const { prd: fresh, fallback } = await generatePRDDoc(prdSource, settings?.projectName || '');
      setPrd(fresh);        // triggers the effect above → resets draft
      await logPipelineEvent?.('prd_regenerated', { length: fresh.length, fallback });
    } catch (err) {
      setError(`Regeneration failed: ${err.message}`);
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([draft], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(settings?.projectName || 'PRD').replace(/[^a-z0-9]+/gi, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGenerateTickets = async () => {
    if (!canGenerate) {
      setError('Story generation is blocked until the TPM signs off on this PRD (or solo mode is enabled in Settings).');
      return;
    }
    if (!draft.trim()) {
      setError('The PRD is empty — add content before generating user stories.');
      return;
    }
    setError('');
    setIsGenerating(true);
    try {
      // Persist any manual edits so the approved PRD is the source of truth
      if (dirty) {
        try { savePrdEdit(draft); } catch { setPrd(draft); }
      }
      await logPipelineEvent?.('prd_approved', { length: draft.length, edited: dirty });

      const { stories } = await extractStoriesFromFiles([
        `Product Requirements Document:\n\n${draft}`
      ]);
      await setStoriesFromExtraction(stories, currentPipelineId);
      navigate('/review');
    } catch (err) {
      setError(`Story generation failed: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // ── AI Review (lint) ──────────────────────────────────────────────────────
  const handleAiReview = async () => {
    setLintOpen(true);
    setLintLoading(true);
    setLintError('');
    try {
      const res = await lintPrd(draft);
      setLintIssues(Array.isArray(res?.issues) ? res.issues : []);
      setAppliedIssues(new Set());
    } catch (err) {
      setLintIssues(null);
      setLintError(err?.message || 'AI review is unavailable.');
    } finally {
      setLintLoading(false);
    }
  };

  const handleApplyIssue = (issue, idx) => {
    if (!canEditPrd) return;
    const quote = issue?.quote || '';
    const suggestion = issue?.suggestion || '';
    if (!quote || !suggestion || !draft.includes(quote)) return;
    const next = draft.replace(quote, suggestion); // first occurrence only
    setDraft(next);
    setPrd(next); // persist the applied fix as the working PRD
    try { snapshotPrd(next, { trigger: 'lint_apply' }); }
    catch (err) { console.warn('PRD snapshot failed:', err?.message); }
    try {
      recordAudit({
        action: 'prd.lint_apply',
        entityType: 'prd',
        entityId: 'prd',
        field: 'text',
        before: quote,
        after: suggestion,
        viaAI: true,
        pipelineId: currentPipelineId || undefined
      });
    } catch (err) { console.warn('Audit log failed:', err?.message); }
    setAppliedIssues(prev => new Set([...prev, idx]));
  };

  // ── Version history drawer ────────────────────────────────────────────────
  const openHistory = () => {
    try { setVersions(getVersions()); } catch { setVersions([]); }
    setSelectedIds([]);
    setSummary('');
    setSummaryError('');
    setRestoreConfirmId(null);
    setHistoryOpen(true);
  };

  const toggleVersionSelect = (id) => {
    setSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(v => v !== id);
      const next = [...prev, id];
      return next.length > 2 ? next.slice(next.length - 2) : next;
    });
    setSummary('');
    setSummaryError('');
  };

  // Versions are stored newest-first; the larger index is the older snapshot.
  const diffPair = useMemo(() => {
    if (selectedIds.length !== 2 || versions.length === 0) return null;
    const picked = selectedIds
      .map(id => ({ idx: versions.findIndex(v => v.id === id) }))
      .filter(p => p.idx >= 0);
    if (picked.length !== 2) return null;
    const [a, b] = picked.sort((x, y) => y.idx - x.idx);
    return { older: versions[a.idx], newer: versions[b.idx] };
  }, [selectedIds, versions]);

  const diffRows = useMemo(
    () => (diffPair ? diffLines(diffPair.older.text, diffPair.newer.text) : []),
    [diffPair]
  );

  const handleSummarizeDiff = async () => {
    if (!diffPair) return;
    setSummaryLoading(true);
    setSummaryError('');
    setSummary('');
    try {
      const res = await summarizeDiff(diffPair.older.text, diffPair.newer.text);
      setSummary(res?.summary || '');
      if (!res?.summary) setSummaryError('The AI returned an empty summary — the raw diff below is authoritative.');
    } catch (err) {
      setSummaryError(`AI summary unavailable (${err?.message || 'error'}) — showing the raw diff only.`);
    } finally {
      setSummaryLoading(false);
    }
  };

  const handleRestore = (version) => {
    if (!canEditPrd) return;
    if (restoreConfirmId !== version.id) {
      setRestoreConfirmId(version.id);
      return;
    }
    try {
      // Snapshot the current text first so nothing is lost, then restore.
      try { snapshotPrd(draft, { trigger: 'save' }); }
      catch (err) { console.warn('PRD snapshot failed:', err?.message); }
      savePrdEdit(version.text);
      try { setVersions(getVersions()); } catch { /* list refresh is cosmetic */ }
      setSelectedIds([]);
      setSummary('');
      setSummaryError('');
      setRestoreConfirmId(null);
      setRestoreFlash(`Restored the version from ${fmtTime(version.ts)}.`);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setRestoreFlash(''), 3500);
    } catch (err) {
      setRestoreConfirmId(null);
      setError(`Restore failed: ${err.message}`);
    }
  };

  if (!prd && !draft) {
    return (
      <div className="flex flex-col items-center justify-center" style={{ minHeight: '60vh', gap: '1rem' }}>
        <FileText size={48} style={{ color: 'var(--text-tertiary)' }} />
        <h2 className="text-2xl font-bold">No PRD Yet</h2>
        <p className="text-secondary text-center">
          Upload transcripts or record a meeting on the Dashboard and run the pipeline to draft a PRD.
        </p>
        <button className="btn btn-primary" onClick={() => navigate('/')}>Go to Dashboard</button>
      </div>
    );
  }

  const renderLintPanel = () => (
    <aside className="prd-lint-panel card" aria-label="AI review issues">
      <div className="prd-lint-head">
        <span className="prd-pane-label prd-lint-label"><ScanSearch size={12} /> AI Review</span>
        <button className="prd-icon-btn" onClick={() => setLintOpen(false)} aria-label="Close AI review panel">
          <X size={14} />
        </button>
      </div>
      <div className="prd-lint-body scrollable-y">
        {lintLoading && (
          <div className="prd-lint-state">
            <Loader2 size={20} className="animate-spin" />
            <p>Reviewing the PRD for ambiguity, conflicts, and gaps…</p>
          </div>
        )}
        {!lintLoading && lintError && (
          <div className="prd-error prd-lint-error">
            <AlertCircle size={15} />
            <div>
              <p>AI review unavailable: {lintError}</p>
              <p className="prd-lint-error-hint">Configure an AI provider in Settings to enable PRD review.</p>
            </div>
          </div>
        )}
        {!lintLoading && !lintError && Array.isArray(lintIssues) && lintIssues.length === 0 && (
          <div className="prd-lint-state">
            <CheckCircle2 size={20} style={{ color: 'var(--color-success)' }} />
            <p>No issues found — the PRD looks clean.</p>
          </div>
        )}
        {!lintLoading && !lintError && Array.isArray(lintIssues) && lintIssues.map((issue, idx) => {
          const meta = SEVERITY_META[issue?.severity] || SEVERITY_META.info;
          const applied = appliedIssues.has(idx);
          const quoteFound = Boolean(issue?.quote) && draft.includes(issue.quote);
          const canApply = canEditPrd && quoteFound && Boolean(issue?.suggestion);
          return (
            <div className="prd-issue" key={idx}>
              <div className="prd-issue-top">
                <span className={`badge ${meta.badge}`}>
                  <meta.Icon size={11} /> {issue?.severity || 'info'}
                </span>
                {issue?.section && <span className="prd-issue-section">{issue.section}</span>}
              </div>
              {issue?.quote && <blockquote className="prd-issue-quote">{issue.quote}</blockquote>}
              {issue?.issue && <p className="prd-issue-text">{issue.issue}</p>}
              {issue?.suggestion && (
                <p className="prd-issue-suggestion"><strong>Suggestion:</strong> {issue.suggestion}</p>
              )}
              <div className="prd-issue-actions">
                {applied ? (
                  <span className="prd-issue-applied"><Check size={13} /> Applied</span>
                ) : !issue?.suggestion ? (
                  <span className="prd-issue-nofix">No auto-fix available</span>
                ) : !quoteFound ? (
                  <span className="prd-issue-nofix">Quote not found in the current text</span>
                ) : (
                  <button
                    className="btn btn-secondary prd-btn-xs"
                    onClick={() => handleApplyIssue(issue, idx)}
                    disabled={!canApply}
                    title={canEditPrd ? 'Replace the quoted text with the suggestion' : `Requires the Edit PRD permission (current role: ${roleLabel})`}
                  >
                    <Check size={12} /> Apply
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );

  const renderHistoryDrawer = () => (
    <>
      <div className="prd-drawer-backdrop" onClick={() => setHistoryOpen(false)} />
      <aside className="prd-drawer glass-panel" role="dialog" aria-modal="true" aria-label="PRD version history">
        <div className="prd-drawer-head">
          <h2><History size={17} /> Version History</h2>
          <button className="prd-icon-btn" onClick={() => setHistoryOpen(false)} aria-label="Close version history">
            <X size={16} />
          </button>
        </div>
        <div className="prd-drawer-body scrollable-y">
          {restoreFlash && (
            <div className="prd-drawer-flash"><CheckCircle2 size={14} /> {restoreFlash}</div>
          )}
          {versions.length === 0 ? (
            <div className="prd-lint-state">
              <History size={20} />
              <p>No versions yet. Snapshots are captured when a PRD is generated, saved, or a lint fix is applied.</p>
            </div>
          ) : (
            <>
              <p className="prd-drawer-hint">Select two versions to compare them line by line.</p>
              <ul className="prd-version-list">
                {versions.map((v, idx) => (
                  <li
                    key={v.id}
                    className={`prd-version-row ${selectedIds.includes(v.id) ? 'selected' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="prd-version-check"
                      checked={selectedIds.includes(v.id)}
                      onChange={() => toggleVersionSelect(v.id)}
                      aria-label={`Select version from ${fmtTime(v.ts)}`}
                    />
                    <div className="prd-version-main">
                      <div className="prd-version-title">
                        <span className="badge badge-neutral">{TRIGGER_LABELS[v.trigger] || v.trigger}</span>
                        <span className="prd-version-time">{fmtTime(v.ts)}</span>
                        {idx === 0 && <span className="badge badge-info">latest</span>}
                      </div>
                      <span className="prd-version-meta">
                        {(v.text || '').length.toLocaleString()} chars · {(v.reqIds || []).length} REQ sections
                      </span>
                    </div>
                    <button
                      className={`btn prd-btn-xs ${restoreConfirmId === v.id ? 'btn-danger' : 'btn-outline'}`}
                      onClick={() => handleRestore(v)}
                      onBlur={() => { if (restoreConfirmId === v.id) setRestoreConfirmId(null); }}
                      disabled={!canEditPrd}
                      title={canEditPrd
                        ? 'Restore this version (the current text is snapshotted first)'
                        : `Restoring requires Admin or TPM (current role: ${roleLabel})`}
                    >
                      <RotateCcw size={12} /> {restoreConfirmId === v.id ? 'Confirm restore?' : 'Restore'}
                    </button>
                  </li>
                ))}
              </ul>

              {diffPair && (
                <div className="prd-diff-section">
                  <div className="prd-diff-head">
                    <h3>
                      Comparing {fmtTime(diffPair.older.ts)} <ArrowRight size={12} /> {fmtTime(diffPair.newer.ts)}
                    </h3>
                    <button
                      className="btn btn-secondary prd-btn-xs"
                      onClick={handleSummarizeDiff}
                      disabled={summaryLoading}
                      title="Ask the AI to summarize what changed between these versions"
                    >
                      {summaryLoading
                        ? <><Loader2 size={12} className="animate-spin" /> Summarizing…</>
                        : <><Sparkles size={12} /> AI summary</>}
                    </button>
                  </div>
                  {summaryError && (
                    <div className="prd-error prd-lint-error"><AlertCircle size={14} /> {summaryError}</div>
                  )}
                  {summary && <div className="prd-diff-summary">{summary}</div>}
                  <div className="prd-diff">
                    {diffRows.slice(0, MAX_DIFF_ROWS).map((row, i) => (
                      <div key={i} className={`prd-diff-line ${row.type}`}>
                        <span className="prd-diff-sign">
                          {row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '}
                        </span>
                        <span className="prd-diff-text">{row.line || ' '}</span>
                      </div>
                    ))}
                    {diffRows.length > MAX_DIFF_ROWS && (
                      <div className="prd-diff-line same">
                        <span className="prd-diff-sign"> </span>
                        <span className="prd-diff-text">… {diffRows.length - MAX_DIFF_ROWS} more lines not shown</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );

  return (
    <div className="prd-page">
      <PipelineSteps current="prd" />
      <header className="prd-header">
        <div>
          <h1 className="flex items-center gap-2">
            <Sparkles size={22} style={{ color: 'var(--color-primary)' }} />
            Product Requirements Document
          </h1>
          <p className="text-secondary">
            Review and edit the AI-drafted PRD, then generate user stories from the approved document.
            <span className="prd-meta">{wordCount} words{dirty ? ' · unsaved edits' : ''}</span>
          </p>
        </div>

        <div className="prd-header-actions">
          <button className="btn btn-primary" onClick={handleRegenerate} disabled={isRegenerating || isGenerating || !prdSource} title={prdSource ? 'Regenerate the PRD from the original source' : 'Original source unavailable'}>
            {isRegenerating ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Regenerate
          </button>
          <button
            className="btn btn-secondary"
            onClick={handleSave}
            disabled={!dirty || !canEditPrd || isGenerating}
            title={canEditPrd
              ? (dirty ? 'Save your edits as a new PRD version' : 'No unsaved edits')
              : `Saving requires the Edit PRD permission (current role: ${roleLabel})`}
          >
            {savedFlash ? <Check size={15} /> : <Save size={15} />}
            {savedFlash ? 'Saved' : 'Save'}
          </button>
          <button className="btn btn-secondary" onClick={handleDownload} disabled={isGenerating}>
            <Download size={15} /> .md
          </button>
          <span
            className="prd-gate-wrap"
            title={canGenerate
              ? 'Generate user stories from the approved PRD'
              : 'Blocked — requires the TPM sign-off below (or solo mode in Settings)'}
          >
            <button
              className="btn btn-primary"
              onClick={handleGenerateTickets}
              disabled={isGenerating || isRegenerating || !canGenerate}
            >
              {isGenerating
                ? <><Loader2 size={16} className="animate-spin" /> Generating stories...</>
                : <><ListChecks size={16} /> Generate User Stories <ArrowRight size={15} /></>}
            </button>
          </span>
        </div>
      </header>

      <div className="prd-signoff-strip glass-panel">
        <div className="prd-signoff-info">
          <ShieldCheck
            size={17}
            style={{ color: prdSignoff || soloMode ? 'var(--color-success)' : 'var(--text-tertiary)', flexShrink: 0 }}
          />
          {prdSignoff ? (
            <>
              <span className="badge badge-success">TPM signed off</span>
              <span className="prd-signoff-meta">{prdSignoff.name} · {fmtTime(prdSignoff.at)}</span>
            </>
          ) : soloMode ? (
            <>
              <span className="badge badge-info">Solo mode</span>
              <span className="prd-signoff-meta">Sign-off gates are bypassed — story generation is unlocked.</span>
            </>
          ) : (
            <>
              <span className="badge badge-warning">TPM sign-off pending</span>
              <span className="prd-signoff-meta">Story generation unlocks once the TPM signs off on this PRD.</span>
            </>
          )}
        </div>
        <div className="prd-signoff-actions">
          {prdSignoff ? (
            <button
              className="btn btn-outline prd-btn-xs"
              onClick={() => undoSignoff('prd')}
              disabled={!canRevokeSignoff}
              title={canRevokeSignoff ? 'Revoke the TPM sign-off' : 'Only the signer or an admin can revoke this sign-off'}
            >
              Revoke sign-off
            </button>
          ) : (
            <button
              className="btn btn-secondary prd-btn-xs"
              onClick={() => doSignoff('prd')}
              disabled={!canSignPrd}
              title={canSignPrd
                ? 'Record your TPM sign-off on this PRD'
                : `Requires the TPM sign-off permission (current role: ${roleLabel})`}
            >
              <ShieldCheck size={13} /> Sign off as TPM
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="prd-error">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      <div className="prd-toolbar">
        <div className="prd-toolbar-tools">
          <button
            className="btn btn-secondary"
            onClick={handleAiReview}
            disabled={lintLoading || !draft.trim()}
            title="Ask the AI to review the PRD for ambiguity, conflicts, and gaps"
          >
            {lintLoading ? <Loader2 size={14} className="animate-spin" /> : <ScanSearch size={14} />}
            AI Review
          </button>
          <button
            className="btn btn-secondary"
            onClick={openHistory}
            title="Browse, compare, and restore PRD versions"
          >
            <History size={14} /> Version History
          </button>
        </div>
        <div className="prd-view-toggle">
          <button className={`prd-toggle-btn ${view === 'edit' ? 'active' : ''}`} onClick={() => setView('edit')}>
            <Edit3 size={13} /> Edit
          </button>
          <button className={`prd-toggle-btn ${view === 'split' ? 'active' : ''}`} onClick={() => setView('split')}>
            <Columns size={13} /> Split
          </button>
          <button className={`prd-toggle-btn ${view === 'preview' ? 'active' : ''}`} onClick={() => setView('preview')}>
            <Eye size={13} /> Preview
          </button>
        </div>
      </div>

      <div className={`prd-main ${lintOpen ? 'with-panel' : ''}`}>
        <div className={`prd-workspace view-${view}`}>
          {view !== 'preview' && (
            <div className="prd-editor-pane card">
              <div className="prd-pane-label"><Edit3 size={12} /> Markdown</div>
              <textarea
                className="prd-editor"
                value={draft}
                onChange={(e) => onDraftChange(e.target.value)}
                spellCheck={false}
                placeholder="# Product Name&#10;&#10;## 1. Overview&#10;..."
              />
            </div>
          )}
          {view !== 'edit' && (
            <div className="prd-preview-pane card">
              <div className="prd-pane-label"><Eye size={12} /> Preview</div>
              <div
                className="prd-preview scrollable-y"
                dangerouslySetInnerHTML={{ __html: previewHtml }}
              />
            </div>
          )}
        </div>
        {lintOpen && renderLintPanel()}
      </div>

      {historyOpen && renderHistoryDrawer()}
    </div>
  );
};
