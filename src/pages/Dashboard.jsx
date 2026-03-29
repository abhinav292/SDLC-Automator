import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UploadCloud, Mic, FileText, Loader2, Plus, MicOff,
  CheckCircle, Clock, GitBranch, AlertCircle, Zap, Sparkles, WifiOff
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { extractTextFromFile } from '../services/fileReaderService';
import { extractStoriesFromFiles } from '../services/extractionService';
import { createPipeline, checkBackendHealth, logEvent, cleanTranscript } from '../services/apiService';
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

export const Dashboard = () => {
  const navigate = useNavigate();
  const { pipelineStats, pipelineHistory, loadPipelineHistory, setStoriesFromExtraction, loadMockStories } = useApp();

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
  const [backendOk, setBackendOk] = useState(null);

  const mediaRecorderRef = useRef(null);
  const timerRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    loadPipelineHistory();
    checkBackendHealth().then(() => setBackendOk(true)).catch(() => setBackendOk(false));
    return () => {
      clearInterval(timerRef.current);
      if (recognitionRef.current) recognitionRef.current.stop();
    };
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
      alert('Microphone access denied. Please allow microphone access in your browser settings.');
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
  const hasInput = files.length > 0 || activeTranscript.length > 50;

  const handleProcess = async () => {
    if (!hasInput) return;
    setIsProcessing(true);
    let pipelineId = null;
    try {
      const fileNames = files.map(f => f.name);
      const texts = [];

      if (activeTranscript) texts.push(`Voice Recording Transcript:\n${activeTranscript}`);

      setProcessingStep('Creating pipeline...');
      const pipeline = await createPipeline({
        fileNames,
        transcriptSummary: fileNames.join(', ') || 'Voice recording'
      }).catch(() => null);
      pipelineId = pipeline?.id || null;

      for (const file of files) {
        setProcessingStep(`Reading ${file.name}...`);
        const text = await extractTextFromFile(file);
        if (text) texts.push(`File: ${file.name}\n\n${text}`);
      }

      setProcessingStep('Running AI extraction via OpenRouter...');
      const stories = await extractStoriesFromFiles(texts);

      setProcessingStep('Saving to database...');
      await setStoriesFromExtraction(stories, pipelineId);

      if (pipelineId) {
        await logEvent(pipelineId, 'transcript_uploaded', {
          fileCount: files.length,
          hasVoice: !!activeTranscript,
          transcriptCleaned
        }).catch(() => {});
      }

      navigate('/review');
    } catch (err) {
      console.error('Extraction error:', err);
      alert(`Extraction failed: ${err.message}`);
    } finally {
      setIsProcessing(false);
      setProcessingStep('');
    }
  };

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
          <div className="stat-value" style={{ color: 'var(--color-success)' }}>{pipelineStats.timeSaved}</div>
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

          {files.length > 0 && (
            <div className="file-list">
              <span className="file-list-label">{files.length} file{files.length > 1 ? 's' : ''} selected</span>
              {files.map((f, i) => (
                <div key={i} className="file-item">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}>
                    <FileText size={13} style={{ color: 'var(--color-info)', flexShrink: 0 }} />
                    <span className="file-item-name">{f.name}</span>
                    <span style={{ color: 'var(--text-tertiary)', fontSize: '0.7rem', flexShrink: 0 }}>{(f.size / 1024).toFixed(0)} KB</span>
                  </div>
                  <button onClick={() => removeFile(i)} className="file-remove-btn">×</button>
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
                  : <><Zap size={16} />Run AI Extraction Pipeline</>}
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
                    try { keys = JSON.parse(run.jira_keys || '[]') || []; } catch {}
                    return keys.length > 0 ? (
                      <span style={{ color: '#60a5fa', fontFamily: 'monospace' }}>
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
    </div>
  );
};
