import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileText, Sparkles, Loader2, Download, ArrowRight, Edit3, Eye,
  Columns, RefreshCw, AlertCircle, ListChecks
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { generatePRDDoc } from '../services/prdService';
import { extractStoriesFromFiles } from '../services/extractionService';
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

export const PRD = () => {
  const navigate = useNavigate();
  const {
    prd, setPrd, prdSource, currentPipelineId,
    setStoriesFromExtraction, logPipelineEvent, settings
  } = useApp();

  const [draft, setDraft] = useState(prd || '');
  const [view, setView] = useState('split'); // 'edit' | 'split' | 'preview'
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);

  // Keep the local draft in sync when a brand-new PRD arrives (e.g. after regenerate)
  useEffect(() => { setDraft(prd || ''); setDirty(false); }, [prd]);

  const previewHtml = useMemo(() => renderMarkdown(draft), [draft]);

  const wordCount = useMemo(
    () => draft.trim() ? draft.trim().split(/\s+/).length : 0,
    [draft]
  );

  const onDraftChange = (value) => { setDraft(value); setDirty(true); };

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
    if (!draft.trim()) {
      setError('The PRD is empty — add content before generating Jira tickets.');
      return;
    }
    setError('');
    setIsGenerating(true);
    try {
      // Persist any manual edits so the approved PRD is the source of truth
      setPrd(draft);
      await logPipelineEvent?.('prd_approved', { length: draft.length, edited: dirty });

      const { stories } = await extractStoriesFromFiles([
        `Product Requirements Document:\n\n${draft}`
      ]);
      await setStoriesFromExtraction(stories, currentPipelineId);
      navigate('/review');
    } catch (err) {
      setError(`Ticket generation failed: ${err.message}`);
    } finally {
      setIsGenerating(false);
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
            Review and edit the AI-drafted PRD, then generate Jira tickets from the approved document.
            <span className="prd-meta">{wordCount} words{dirty ? ' · unsaved edits' : ''}</span>
          </p>
        </div>

        <div className="prd-header-actions">
          <button className="btn btn-secondary" onClick={handleRegenerate} disabled={isRegenerating || isGenerating || !prdSource} title={prdSource ? 'Regenerate the PRD from the original source' : 'Original source unavailable'}>
            {isRegenerating ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Regenerate
          </button>
          <button className="btn btn-secondary" onClick={handleDownload} disabled={isGenerating}>
            <Download size={15} /> .md
          </button>
          <button className="btn btn-primary" onClick={handleGenerateTickets} disabled={isGenerating || isRegenerating}>
            {isGenerating
              ? <><Loader2 size={16} className="animate-spin" /> Generating tickets...</>
              : <><ListChecks size={16} /> Generate Jira Tickets <ArrowRight size={15} /></>}
          </button>
        </div>
      </header>

      {error && (
        <div className="prd-error">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      <div className="prd-toolbar">
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
    </div>
  );
};
