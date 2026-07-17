import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UploadCloud, Mic, FileText, Loader2, Plus, MicOff,
  CheckCircle, Clock, GitBranch, AlertCircle, Zap, Sparkles, WifiOff,
  ShieldAlert, X, Inbox, MessageSquare, Copy, Check, RefreshCw, Circle
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { extractTextFromFile } from '../services/fileReaderService';
import { createPipeline, checkBackendHealth, logEvent, cleanTranscript, fetchIntake, dismissIntake } from '../services/apiService';
import { generatePRDDoc } from '../services/prdService';
import { extractStoriesFromFiles } from '../services/extractionService';
import { redactText, applyUnredact, maskValue } from '../services/redactionService';
import { recordAudit } from '../services/auditService';
import './Dashboard.css';

const StatusBadge = ({ status }) => {
  const map = {
    completed: { cls: 'badge-success', label: 'Completed' },
    review: { cls: 'badge-info', label: 'In Review' },
    extracting: { cls: 'badge-warning', label: 'Extracting' },
    pending: { cls: 'badge-neutral', label: 'Pending' }
  };
  const s = map[status] || map.pending;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
};

const REDACTION_KIND_LABELS = {
  email: 'Email addresses',
  phone: 'Phone numbers',
  card: 'Credit card numbers',
  ssn: 'Social Security numbers',
  aws_key: 'AWS access keys',
  secret: 'Secrets & tokens',
  ip: 'IP addresses'
};

// Review modal shown between file-read and any AI call when redaction found PII.
// Each finding keeps a "stay redacted" toggle (default ON). Confirm proceeds with
// the redacted text (audited); Cancel aborts the whole run.
const RedactionModal = ({ scans, sourceNames, keep, onToggle, onConfirm, onCancel }) => {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const groups = useMemo(() => {
    const g = {};
    (scans || []).forEach((scan, si) => {
      (scan.items || []).forEach(item => {
        if (!g[item.kind]) g[item.kind] = [];
        g[item.kind].push({ ...item, si, key: `${si}:${item.token}` });
      });
    });
    return g;
  }, [scans]);

  const allItems = useMemo(() => Object.values(groups).flat(), [groups]);
  const keptCount = allItems.filter(it => keep[it.key] !== false).length;
  const multiSource = (sourceNames || []).length > 1;

  return (
    <div className="redaction-overlay flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Review redacted content">
      <div className="card redaction-modal">
        <div className="flex items-center justify-between gap-2">
          <h3 className="redaction-title">
            <ShieldAlert size={18} style={{ color: 'var(--color-warning)' }} />
            Review Redactions
          </h3>
          <button className="btn btn-secondary redaction-close" onClick={onCancel} aria-label="Cancel run">
            <X size={15} />
          </button>
        </div>
        <p className="text-secondary text-sm" style={{ marginTop: '0.35rem' }}>
          {allItems.length} sensitive value{allItems.length === 1 ? '' : 's'} found in your sources.
          Values left redacted are replaced with placeholder tokens before anything reaches the AI.
        </p>

        <div className="redaction-groups scrollable-y">
          {Object.entries(groups).map(([kind, items]) => (
            <div key={kind} className="redact-group">
              <div className="redact-group-header">
                {REDACTION_KIND_LABELS[kind] || kind}
                <span className="badge badge-warning">{items.length}</span>
              </div>
              {items.map(item => {
                const on = keep[item.key] !== false;
                return (
                  <div key={item.key} className="redact-item">
                    <div className="redact-item-info">
                      <span className="redact-mask">{maskValue(item.original, item.kind)}</span>
                      <span className="redact-token">{item.token}</span>
                      {item.count > 1 && <span className="redact-count">×{item.count}</span>}
                      {multiSource && <span className="redact-source">{sourceNames[item.si]}</span>}
                    </div>
                    <div className="redact-item-toggle">
                      <span className="redact-toggle-label">{on ? 'Redacted' : 'Send original'}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`Keep ${maskValue(item.original, item.kind)} redacted`}
                        className={`redact-switch ${on ? 'on' : ''}`}
                        onClick={() => onToggle(item.key)}
                      >
                        <span className="redact-knob" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="redaction-footer">
          <p className="redaction-footer-note">
            Redacted values are sent as tokens (e.g. ⟦EMAIL_1⟧). Toggle one off to send its original value. Cancelling aborts the run.
          </p>
          <div className="redaction-footer-actions">
            <button className="btn btn-secondary" onClick={onCancel}>Cancel run</button>
            <button className="btn btn-primary" onClick={onConfirm}>
              <ShieldAlert size={14} /> Confirm — redact {keptCount} of {allItems.length}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const Dashboard = () => {
  const navigate = useNavigate();
  const {
    pipelineStats, pipelineHistory, loadPipelineHistory, setPrdFromGeneration,
    loadMockStories, settings, featureFlags, setContradictions
  } = useApp();

  const [files, setFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [rawTranscript, setRawTranscript] = useState('');
  const [cleanedTranscript, setCleanedTranscript] = useState('');
  const [transcriptCleaned, setTranscriptCleaned] = useState(false);
  const [isCleaningTranscript, setIsCleaningTranscript] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const [progressLines, setProgressLines] = useState([]);
  const [backendOk, setBackendOk] = useState(null);
  const [error, setError] = useState('');

  // Redaction review modal state — a resolver bridges the modal back into handleProcess.
  const [redaction, setRedaction] = useState(null); // { scans, sourceNames }
  const [redactKeep, setRedactKeep] = useState({});
  const redactionResolveRef = useRef(null);

  // Intake Inbox (Slack webhook stub)
  const [intakeAvailable, setIntakeAvailable] = useState(false);
  const [intakeLoading, setIntakeLoading] = useState(false);
  const [intakeItems, setIntakeItems] = useState([]);
  const [intakeError, setIntakeError] = useState('');
  const [intakeSources, setIntakeSources] = useState([]); // [{id, name, text}] pulled into the run flow
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [dismissingId, setDismissingId] = useState(null);

  const mediaRecorderRef = useRef(null);
  const timerRef = useRef(null);
  const recognitionRef = useRef(null);

  const webhookUrl = `${window.location.origin}/api/backend/slack-intake`;

  const loadIntake = async () => {
    setIntakeLoading(true);
    setIntakeError('');
    try {
      const data = await fetchIntake();
      setIntakeItems(Array.isArray(data?.items) ? data.items : []);
      setIntakeAvailable(true);
    } catch {
      // Backend (or the intake endpoint) unreachable — hide the card entirely.
      setIntakeAvailable(false);
    } finally {
      setIntakeLoading(false);
    }
  };

  useEffect(() => {
    loadPipelineHistory();
    checkBackendHealth().then(() => setBackendOk(true)).catch(() => setBackendOk(false));
    loadIntake(); // fetched once on mount (plus manual refresh) — no interval polling
    return () => {
      clearInterval(timerRef.current);
      if (recognitionRef.current) recognitionRef.current.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFileDrop = (e) => { e.preventDefault(); setDragActive(false); addFiles(Array.from(e.dataTransfer.files)); };
  const handleDragOver = (e) => { e.preventDefault(); setDragActive(true); };
  const handleDragLeave = () => setDragActive(false);
  const handleFileSelect = (e) => { addFiles(Array.from(e.target.files)); e.target.value = ''; };
  const addFiles = (incoming) => setFiles(prev => [...prev, ...incoming.filter(f => /\.(txt|docx|pdf)$/i.test(f.name))]);
  const removeFile = (i) => setFiles(prev => prev.filter((_, idx) => idx !== i));

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingTime(0);
      setRawTranscript('');
      setCleanedTranscript('');
      setTranscriptCleaned(false);
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);

      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const r = new SR();
        r.continuous = true;
        r.interimResults = true;
        r.onresult = (e) => {
          const text = Array.from(e.results).map(r => r[0].transcript).join(' ');
          setRawTranscript(text);
        };
        r.start();
        recognitionRef.current = r;
      }
    } catch {
      setError('Microphone access denied. Please allow microphone access in your browser settings.');
    }
  };

  const stopRecording = async () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop());
    recognitionRef.current?.stop();
    clearInterval(timerRef.current);
    setIsRecording(false);

    const capturedRaw = rawTranscript;
    if (capturedRaw && capturedRaw.length > 20) {
      setIsCleaningTranscript(true);
      try {
        const result = await cleanTranscript(capturedRaw);
        setCleanedTranscript(result.cleaned);
        setTranscriptCleaned(!result.fallback);
      } catch {
        setCleanedTranscript(capturedRaw);
        setTranscriptCleaned(false);
      } finally {
        setIsCleaningTranscript(false);
      }
    }
  };

  const activeTranscript = cleanedTranscript || rawTranscript;
  const formatTime = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  const hasInput = files.length > 0 || intakeSources.length > 0 || activeTranscript.length > 50;

  // ── Run progress lines (per-file read / extract / synthesize steps) ────────
  const upsertLine = (id, label, status) => setProgressLines(prev => {
    const idx = prev.findIndex(l => l.id === id);
    if (idx === -1) return [...prev, { id, label, status }];
    const next = [...prev];
    next[idx] = { ...next[idx], ...(label != null ? { label } : {}), status };
    return next;
  });

  // ── Intake inbox actions ──────────────────────────────────────────────────
  const addIntakeAsSource = (item) => {
    if (!item?.text) return;
    setIntakeSources(prev => prev.some(s => s.id === item.id)
      ? prev
      : [...prev, {
          id: item.id,
          name: `Slack${item.channel ? ` #${String(item.channel).replace(/^#/, '')}` : ''}${item.user ? ` — ${item.user}` : ''}`,
          text: item.text
        }]);
  };

  const removeIntakeSource = (id) => setIntakeSources(prev => prev.filter(s => s.id !== id));

  const dismissIntakeItem = async (id) => {
    setDismissingId(id);
    setIntakeError('');
    try {
      await dismissIntake(id);
      setIntakeItems(prev => prev.filter(i => i.id !== id));
    } catch (err) {
      setIntakeError(`Could not dismiss the message: ${err.message}`);
    } finally {
      setDismissingId(null);
    }
  };

  const copyWebhook = async () => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      copied = true;
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = webhookUrl;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        copied = document.execCommand('copy');
        document.body.removeChild(ta);
      } catch { copied = false; }
    }
    if (copied) {
      setCopiedWebhook(true);
      setTimeout(() => setCopiedWebhook(false), 2000);
    } else {
      setIntakeError('Could not copy automatically — select the URL and copy it manually.');
    }
  };

  const formatIntakeTime = (ts) => {
    const n = parseFloat(ts);
    if (!Number.isFinite(n)) return '';
    const d = new Date(n > 1e12 ? n : n * 1000);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  };

  // ── The pipeline run ──────────────────────────────────────────────────────
  const handleProcess = async () => {
    if (!hasInput) return;
    setError('');
    setIsProcessing(true);
    setProgressLines([]);
    setContradictions?.([]); // clear stale flags from a previous run
    let pipelineId = null;
    try {
      // 1. Gather sources: voice transcript, intake messages, then uploaded files.
      const sources = [];
      if (activeTranscript) sources.push({ name: 'Voice recording', text: `Voice Recording Transcript:\n${activeTranscript}` });
      intakeSources.forEach(s => sources.push({ name: s.name, text: `Slack intake (${s.name}):\n\n${s.text}` }));

      setProcessingStep('Creating pipeline...');
      const summaryNames = [...files.map(f => f.name), ...intakeSources.map(s => s.name)];
      const pipeline = await createPipeline({
        fileNames: summaryNames,
        transcriptSummary: summaryNames.join(', ') || 'Voice recording'
      }).catch(() => null);
      pipelineId = pipeline?.id || null;

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProcessingStep(`Reading ${file.name}...`);
        upsertLine(`read-${i}`, `Reading ${file.name}`, 'active');
        try {
          const text = await extractTextFromFile(file);
          if (text) {
            sources.push({ name: file.name, text: `File: ${file.name}\n\n${text}` });
            upsertLine(`read-${i}`, `Read ${file.name}`, 'done');
          } else {
            upsertLine(`read-${i}`, `No text found in ${file.name} — skipped`, 'error');
          }
        } catch {
          upsertLine(`read-${i}`, `Could not read ${file.name} — skipped`, 'error');
        }
      }

      if (sources.length === 0) {
        throw new Error('No readable text found in the selected sources.');
      }

      // 2. Redaction gate — runs after file reads and BEFORE any AI call.
      if (featureFlags?.redactionEnabled !== false) {
        setProcessingStep('Scanning for PII & secrets...');
        const scans = sources.map(s => redactText(s.text));
        const totalFindings = scans.reduce((n, r) => n + (r.items?.length || 0), 0);
        if (totalFindings > 0) {
          upsertLine('redact', `Reviewing ${totalFindings} redaction finding${totalFindings === 1 ? '' : 's'}`, 'active');
          const decision = await new Promise((resolve) => {
            redactionResolveRef.current = resolve;
            const defaults = {};
            scans.forEach((r, si) => (r.items || []).forEach(it => { defaults[`${si}:${it.token}`] = true; }));
            setRedactKeep(defaults);
            setRedaction({ scans, sourceNames: sources.map(s => s.name) });
          });
          setRedaction(null);
          redactionResolveRef.current = null;
          if (!decision?.confirmed) return; // Cancel aborts the run (cleanup in finally)

          let kept = 0;
          scans.forEach((r, si) => {
            const keepTokens = new Set(
              (r.items || [])
                .filter(it => decision.keep?.[`${si}:${it.token}`] !== false)
                .map(it => it.token)
            );
            kept += keepTokens.size;
            sources[si].text = applyUnredact(r.redacted, r.items, keepTokens);
          });
          try {
            recordAudit({
              action: 'redaction.confirm',
              entityType: 'transcript',
              entityId: pipelineId || 'local',
              after: `${totalFindings} finding${totalFindings === 1 ? '' : 's'}: ${kept} kept redacted, ${totalFindings - kept} restored`,
              pipelineId: pipelineId || undefined
            });
          } catch { /* audit must never block the run */ }
          upsertLine('redact', `Redaction confirmed — ${kept} of ${totalFindings} value${totalFindings === 1 ? '' : 's'} masked`, 'done');
        }
        // No findings → proceed silently.
      }

      const texts = sources.map(s => s.text);
      const sourceNames = sources.map(s => s.name);
      const combinedSource = texts.join('\n\n---\n\n');

      if (pipelineId) {
        await logEvent(pipelineId, 'transcript_uploaded', {
          fileCount: files.length,
          intakeCount: intakeSources.length,
          hasVoice: !!activeTranscript,
          transcriptCleaned
        }).catch(() => {});
      }

      // 3. Multi-transcript map-reduce synthesis: per-file extraction + AI merge.
      //    extractionService handles the mechanics; we surface contradictions.
      if (texts.length > 1) {
        sources.forEach((s, i) => upsertLine(`extract-${i}`, `Extracting from ${s.name}`, 'active'));
        upsertLine('synth', `Synthesizing across ${texts.length} transcripts`, 'pending');
        setProcessingStep(`Synthesizing across ${texts.length} transcripts...`);
        try {
          const result = await extractStoriesFromFiles(texts, sourceNames);
          sources.forEach((s, i) => upsertLine(`extract-${i}`, `Extracted from ${s.name}`, 'done'));
          const found = Array.isArray(result?.contradictions) ? result.contradictions : [];
          setContradictions?.(found);
          upsertLine('synth', found.length > 0
            ? `Synthesized ${texts.length} transcripts — ${found.length} contradiction${found.length === 1 ? '' : 's'} flagged`
            : `Synthesized across ${texts.length} transcripts`, 'done');
          if (pipelineId && found.length > 0) {
            logEvent(pipelineId, 'contradictions_flagged', { count: found.length }).catch(() => {});
          }
        } catch {
          // Synthesis is additive — a failure never blocks the PRD draft.
          sources.forEach((s, i) => upsertLine(`extract-${i}`, `Extracted from ${s.name}`, 'done'));
          upsertLine('synth', 'Cross-transcript synthesis unavailable — continuing with combined text', 'error');
        }
      }

      // 4. Draft the PRD from the (redacted) combined source.
      setProcessingStep('Drafting PRD with AI...');
      upsertLine('prd', 'Drafting PRD with AI', 'active');
      const { prd } = await generatePRDDoc(combinedSource, settings?.projectName || '');
      upsertLine('prd', 'PRD drafted', 'done');

      setProcessingStep('Opening PRD editor...');
      await setPrdFromGeneration(prd, combinedSource, pipelineId);

      navigate('/prd');
    } catch (err) {
      console.error('PRD generation error:', err);
      setError(`Could not draft the PRD: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProcessingStep('');
      setProgressLines([]);
      setRedaction(null);
      redactionResolveRef.current = null;
    }
  };

  const sourceCount = files.length + intakeSources.length;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Workspace Dashboard</h1>
          <p className="text-secondary">Upload product requirements or record a live meeting to generate SDLC artifacts.</p>
        </div>
        {backendOk !== null && (
          <div className={`status-pill ${backendOk ? 'status-pill--ok' : 'status-pill--error'}`}>
            {backendOk
              ? <><CheckCircle size={12} /> AI + DB Connected</>
              : <><WifiOff size={12} /> Backend Offline</>}
          </div>
        )}
      </header>

      {error && (
        <div className="flex items-center gap-2 mb-4" style={{ padding: '0.7rem 1rem', fontSize: '0.85rem', color: '#F5A297', background: 'rgba(240, 122, 106, 0.1)', border: '1px solid rgba(240, 122, 106, 0.3)', borderRadius: 'var(--radius-lg)' }}>
          <AlertCircle size={15} style={{ flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError('')} className="file-remove-btn" aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="stats-grid glass-panel">
        <div className="stat-item">
          <div className="stat-label">Pipeline Runs (30d)</div>
          <div className="stat-value">{pipelineStats.pipelineRuns}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">Stories Pushed</div>
          <div className="stat-value gradient-text">{pipelineStats.storiesPushed}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">Time Saved</div>
          <div className="stat-value">{pipelineStats.timeSaved}</div>
        </div>
        <div className="stat-item">
          <div className="stat-label">AI Accuracy</div>
          <div className="stat-value">{pipelineStats.accuracy}</div>
        </div>
      </div>

      <div className="ingestion-grid">
        {/* Upload Card */}
        <div className="card ingestion-card">
          <div className="ingestion-card-header">
            <UploadCloud size={20} style={{ color: 'var(--color-primary)' }} />
            <h2>Upload Transcripts</h2>
          </div>
          <p className="text-secondary text-sm mb-4">Supports .txt, .docx, and .pdf — upload multiple files for multi-transcript synthesis.</p>

          <div
            className={`upload-dropzone ${dragActive ? 'drag-active' : ''}`}
            onDrop={handleFileDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            <UploadCloud size={32} className="upload-dropzone-icon" />
            <p className="text-sm mb-1">Drag and drop files here or click to select</p>
            <p className="text-xs" style={{ color: 'var(--text-tertiary)', marginBottom: '1rem' }}>Supports .txt, .docx, .pdf · Max 50MB</p>
            <input type="file" id="file-upload" multiple accept=".txt,.docx,.pdf" style={{ display: 'none' }} onChange={handleFileSelect} />
            <label htmlFor="file-upload" className="btn btn-secondary cursor-pointer">
              <Plus size={14} /> Select Files
            </label>
          </div>

          {sourceCount > 0 && (
            <div className="file-list">
              <span className="file-list-label">{sourceCount} source{sourceCount > 1 ? 's' : ''} selected</span>
              {files.map((f, i) => (
                <div key={`f-${i}`} className="file-item">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                    <FileText size={13} style={{ color: 'var(--color-info)', flexShrink: 0 }} />
                    <span className="file-item-name">{f.name}</span>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: '0.7rem', flexShrink: 0 }}>{(f.size / 1024).toFixed(0)} KB</span>
                  </div>
                  <button onClick={() => removeFile(i)} className="file-remove-btn" aria-label={`Remove ${f.name}`}>×</button>
                </div>
              ))}
              {intakeSources.map(s => (
                <div key={`in-${s.id}`} className="file-item">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                    <MessageSquare size={13} style={{ color: 'var(--color-secondary)', flexShrink: 0 }} />
                    <span className="file-item-name">{s.name}</span>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: '0.7rem', flexShrink: 0 }}>Intake</span>
                  </div>
                  <button onClick={() => removeIntakeSource(s.id)} className="file-remove-btn" aria-label={`Remove ${s.name}`}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Voice Card */}
        <div className="card ingestion-card ingestion-card--voice">
          <div className="ingestion-card-header">
            <Mic size={20} style={{ color: 'var(--color-secondary)' }} />
            <h2>Voice Ingestion</h2>
          </div>
          <p className="text-secondary text-sm mb-4">Capture live meeting conversations — AI-cleaned and synthesized with your files.</p>

          <div className="voice-recorder-area">
            <div className="voice-recorder-center">
              <button
                className={`record-btn ${isRecording ? 'recording' : ''}`}
                onClick={isRecording ? stopRecording : startRecording}
                aria-label={isRecording ? 'Stop recording' : 'Start recording'}
              >
                {isRecording
                  ? <MicOff size={28} color="white" />
                  : <Mic size={28} color="var(--color-primary)" />}
              </button>

              {isRecording && (
                <div className="recording-bars" aria-hidden="true">
                  {[1,2,3,4,5].map(i => <div key={i} className={`recording-bar bar-${i}`} />)}
                </div>
              )}
            </div>

            <div className="voice-status">
              {isRecording ? (
                <span className="voice-status--recording">
                  <span className="rec-dot" /> Recording {formatTime(recordingTime)}
                </span>
              ) : isCleaningTranscript ? (
                <span className="voice-status--cleaning">
                  <Loader2 size={13} className="animate-spin" /> Cleaning transcript with AI...
                </span>
              ) : activeTranscript ? (
                <span className="voice-status--done">
                  {transcriptCleaned
                    ? <><Sparkles size={13} /> AI Cleaned</>
                    : <><CheckCircle size={13} /> Transcript captured</>}
                </span>
              ) : (
                <span className="voice-status--idle">Click to start live recording</span>
              )}
            </div>

            {activeTranscript && !isRecording && (
              <div className="transcript-preview">
                <div className="transcript-preview-header">
                  <span>Transcript Preview</span>
                  {transcriptCleaned && <span className="badge badge-success" style={{ fontSize: '0.6rem' }}>
                    <Sparkles size={9} /> AI Cleaned
                  </span>}
                </div>
                <div className="transcript-preview-text">{activeTranscript}</div>
              </div>
            )}
          </div>

          {isProcessing && progressLines.length > 0 && (
            <div className="run-progress" aria-live="polite">
              {progressLines.map(line => (
                <div key={line.id} className={`run-progress-line run-progress-line--${line.status}`}>
                  {line.status === 'done' ? <CheckCircle size={13} />
                    : line.status === 'active' ? <Loader2 size={13} className="animate-spin" />
                    : line.status === 'error' ? <AlertCircle size={13} />
                    : <Circle size={13} />}
                  <span>{line.label}{line.status === 'active' ? '…' : ''}</span>
                </div>
              ))}
            </div>
          )}

          <div className="ingestion-actions">
            <button
              className="btn btn-primary btn-run"
              onClick={handleProcess}
              disabled={isProcessing || !hasInput || isCleaningTranscript}
            >
              {isProcessing
                ? <><Loader2 className="animate-spin" size={16} />{processingStep || 'Processing...'}</>
                : isCleaningTranscript
                  ? <><Loader2 className="animate-spin" size={16} />Cleaning transcript...</>
                  : <><Zap size={16} />Generate PRD</>}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => { loadMockStories?.(); navigate('/review?mock=true'); }}
              disabled={isProcessing}
            >
              <FileText size={14} /> Use Demo Data
            </button>
          </div>
        </div>
      </div>

      {/* Intake Inbox — only rendered when the backend intake endpoint is reachable */}
      {intakeAvailable && (
        <div className="card intake-card">
          <div className="intake-header">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Inbox size={17} style={{ color: 'var(--color-primary)' }} /> Intake Inbox
              {intakeItems.length > 0 && <span className="badge badge-info">{intakeItems.length}</span>}
            </h2>
            <button
              className="btn btn-secondary intake-refresh"
              onClick={loadIntake}
              disabled={intakeLoading}
              aria-label="Refresh intake inbox"
              title="Refresh"
            >
              {intakeLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
          </div>
          <p className="text-secondary text-sm mb-4">
            Messages captured from Slack via the <code>/slack-intake</code> webhook — pull one in as a pipeline source.
          </p>

          {intakeError && (
            <div className="flex items-center gap-2 mb-4" style={{ padding: '0.6rem 0.9rem', fontSize: '0.8rem', color: '#F5A297', background: 'rgba(240, 122, 106, 0.1)', border: '1px solid rgba(240, 122, 106, 0.3)', borderRadius: 'var(--radius-md)' }}>
              <AlertCircle size={14} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{intakeError}</span>
              <button onClick={() => setIntakeError('')} className="file-remove-btn" aria-label="Dismiss">×</button>
            </div>
          )}

          {intakeItems.length === 0 ? (
            <div className="intake-empty">
              <MessageSquare size={26} />
              <p style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>No intake messages yet.</p>
              <p className="text-sm">
                Point a Slack Events API subscription (message events) at this webhook and incoming messages will land here:
              </p>
              <div className="webhook-row">
                <code className="webhook-url">{webhookUrl}</code>
                <button className="btn btn-secondary" onClick={copyWebhook}>
                  {copiedWebhook ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
                </button>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-tertiary)' }}>
                Slack must be able to reach this URL — expose it publicly (e.g. via a tunnel) during local development.
              </p>
            </div>
          ) : (
            <div className="intake-list">
              {intakeItems.map(item => {
                const used = intakeSources.some(s => s.id === item.id);
                const time = formatIntakeTime(item.ts);
                return (
                  <div key={item.id} className="intake-item">
                    <div className="intake-item-main">
                      <div className="intake-meta">
                        <MessageSquare size={12} />
                        <span className="intake-user">{item.user || 'unknown user'}</span>
                        {item.channel && <span className="intake-channel">#{String(item.channel).replace(/^#/, '')}</span>}
                        {time && <span className="intake-time">{time}</span>}
                      </div>
                      <p className="intake-text">{item.text}</p>
                    </div>
                    <div className="intake-actions">
                      <button
                        className="btn btn-outline"
                        onClick={() => addIntakeAsSource(item)}
                        disabled={used || isProcessing}
                        title={used ? 'Already added to the run sources' : 'Add this message as a pipeline source'}
                      >
                        {used ? <><Check size={13} /> Added</> : <><Plus size={13} /> Use as source</>}
                      </button>
                      <button
                        className="btn btn-secondary intake-dismiss"
                        onClick={() => dismissIntakeItem(item.id)}
                        disabled={dismissingId === item.id}
                        aria-label="Dismiss message"
                        title="Dismiss"
                      >
                        {dismissingId === item.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Pipeline History */}
      {pipelineHistory.length > 0 && (
        <div className="card pipeline-history-card">
          <div className="pipeline-history-header">
            <h2 style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Clock size={17} style={{ color: 'var(--color-primary)' }} /> Pipeline History
            </h2>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>{pipelineHistory.length} runs</span>
          </div>
          <div className="pipeline-history-list">
            {pipelineHistory.slice(0, 8).map(run => (
              <div key={run.id} className="pipeline-history-item">
                <div className="pipeline-history-left">
                  <StatusBadge status={run.status} />
                  <div style={{ minWidth: 0 }}>
                    <p className="pipeline-history-name">{run.transcript_summary || 'Untitled run'}</p>
                    <p className="pipeline-history-date">{new Date(run.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="pipeline-history-meta">
                  <span><FileText size={11} /> {run.story_count} stories</span>
                  {run.approved_count > 0 && (
                    <span style={{ color: 'var(--color-success)' }}>
                      <CheckCircle size={11} /> {run.approved_count} pushed
                    </span>
                  )}
                  {(() => {
                    let keys = [];
                    try { keys = JSON.parse(run.jira_keys || '[]') || []; } catch { /* malformed keys */ }
                    return keys.length > 0 ? (
                      <span style={{ color: 'var(--color-info)', fontFamily: 'monospace' }}>
                        <GitBranch size={11} /> {keys.join(', ')}
                      </span>
                    ) : null;
                  })()}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Redaction review modal — wired between file-read and the first AI call */}
      {redaction && (
        <RedactionModal
          scans={redaction.scans}
          sourceNames={redaction.sourceNames}
          keep={redactKeep}
          onToggle={(key) => setRedactKeep(prev => ({ ...prev, [key]: prev[key] === false }))}
          onConfirm={() => redactionResolveRef.current?.({ confirmed: true, keep: redactKeep })}
          onCancel={() => redactionResolveRef.current?.({ confirmed: false })}
        />
      )}
    </div>
  );
};
