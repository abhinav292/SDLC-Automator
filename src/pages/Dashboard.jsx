import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  UploadCloud, Mic, Activity, FileText, Loader2, X, Plus, MicOff,
  CheckCircle, Clock, GitBranch, ChevronRight, AlertCircle, Zap
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { extractTextFromFile } from '../services/fileReaderService';
import { extractStoriesFromFiles } from '../services/extractionService';
import { createPipeline, checkBackendHealth, logEvent } from '../services/apiService';
import './Dashboard.css';

const StatusBadge = ({ status }) => {
  const map = {
    completed: { cls: 'badge-success', label: 'Completed' },
    review: { cls: 'badge-info', label: 'In Review' },
    extracting: { cls: 'badge-warning', label: 'Extracting' },
    pending: { cls: 'badge-neutral', label: 'Pending' }
  };
  const s = map[status] || map.pending;
  return <span className={`badge ${s.cls}`} style={{ fontSize: '0.65rem' }}>{s.label}</span>;
};

export const Dashboard = () => {
  const navigate = useNavigate();
  const { pipelineStats, pipelineHistory, loadPipelineHistory, setStoriesFromExtraction, loadMockStories } = useApp();
  const [files, setFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingTranscript, setRecordingTranscript] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const [backendOk, setBackendOk] = useState(null);
  const mediaRecorderRef = useRef(null);
  const timerRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    loadPipelineHistory();
    checkBackendHealth().then(() => setBackendOk(true)).catch(() => setBackendOk(false));
    return () => { clearInterval(timerRef.current); if (recognitionRef.current) recognitionRef.current.stop(); };
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
      setIsRecording(true); setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);
      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const r = new SR(); r.continuous = true; r.interimResults = true;
        r.onresult = (e) => setRecordingTranscript(Array.from(e.results).map(r => r[0].transcript).join(' '));
        r.start(); recognitionRef.current = r;
      }
    } catch { alert('Microphone access denied.'); }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach(t => t.stop());
    recognitionRef.current?.stop();
    clearInterval(timerRef.current);
    setIsRecording(false);
  };

  const formatTime = (s) => `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
  const hasInput = files.length > 0 || recordingTranscript.length > 50;

  const handleProcess = async () => {
    if (!hasInput) return;
    setIsProcessing(true);
    let pipelineId = null;
    try {
      const fileNames = files.map(f => f.name);
      const texts = [];

      if (recordingTranscript) texts.push(`Voice Recording Transcript:\n${recordingTranscript}`);

      setProcessingStep('Creating pipeline...');
      const pipeline = await createPipeline({ fileNames, transcriptSummary: fileNames.join(', ') || 'Voice recording' }).catch(() => null);
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

      if (pipelineId) await logEvent(pipelineId, 'transcript_uploaded', { fileCount: files.length, hasVoice: !!recordingTranscript }).catch(() => {});

      navigate('/review');
    } catch (err) {
      console.error('Extraction error:', err);
      alert(`Extraction failed: ${err.message}`);
    } finally {
      setIsProcessing(false); setProcessingStep('');
    }
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header mb-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold mb-2">Workspace Dashboard</h1>
            <p className="text-secondary">Upload product requirements or record a live meeting to generate SDLC artifacts.</p>
          </div>
          {backendOk !== null && (
            <div className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border ${backendOk ? 'border-green-500/30 bg-green-900/10 text-green-400' : 'border-red-500/30 bg-red-900/10 text-red-400'}`}>
              {backendOk ? <><CheckCircle size={12} /> AI + DB Connected</> : <><AlertCircle size={12} /> Backend Offline</>}
            </div>
          )}
        </div>
      </header>

      <div className="stats-grid mb-8 glass-panel p-6">
        <div className="stat-item">
          <div className="stat-label">Pipeline Runs (30d)</div>
          <div className="stat-value">{pipelineStats.pipelineRuns}</div>
        </div>
        <div className="stat-item border-l border-subtle pl-6">
          <div className="stat-label">Stories Pushed</div>
          <div className="stat-value gradient-text">{pipelineStats.storiesPushed}</div>
        </div>
        <div className="stat-item border-l border-subtle pl-6">
          <div className="stat-label">Time Saved</div>
          <div className="stat-value text-success">{pipelineStats.timeSaved}</div>
        </div>
        <div className="stat-item border-l border-subtle pl-6">
          <div className="stat-label">AI Accuracy</div>
          <div className="stat-value">{pipelineStats.accuracy}</div>
        </div>
      </div>

      <div className="ingestion-grid mb-8">
        {/* Upload */}
        <div className="card ingestion-card flex-col">
          <div className="flex items-center gap-3 mb-4">
            <UploadCloud size={22} style={{ color: 'var(--color-primary)' }} />
            <h2 className="text-xl font-semibold">Upload Transcripts</h2>
          </div>
          <p className="text-secondary text-sm mb-4">Supports .txt, .docx, and .pdf — upload multiple files for multi-transcript synthesis.</p>
          <div
            className={`upload-dropzone ${dragActive ? 'drag-active' : ''}`}
            onDrop={handleFileDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
            style={{ flex: 1, minHeight: 160 }}
          >
            <div className="flex flex-col items-center justify-center p-6 text-center text-secondary h-full">
              <UploadCloud size={36} className="mb-3 text-tertiary" />
              <p className="text-sm mb-1">Drag and drop files here or click to select</p>
              <p className="text-xs text-tertiary mb-3">Max file size: 50MB per file</p>
              <input type="file" id="file-upload" multiple accept=".txt,.docx,.pdf" style={{ display: 'none' }} onChange={handleFileSelect} />
              <label htmlFor="file-upload" className="btn btn-secondary cursor-pointer text-sm">
                <Plus size={14} /> Select Files
              </label>
            </div>
          </div>
          {files.length > 0 && (
            <div className="mt-4 flex-col gap-2">
              <span className="text-xs text-tertiary uppercase font-semibold">{files.length} file{files.length > 1 ? 's' : ''}</span>
              {files.map((f, i) => (
                <div key={i} className="file-item glass-panel flex items-center justify-between p-2.5 rounded mt-1">
                  <div className="flex items-center gap-2">
                    <FileText size={14} style={{ color: 'var(--color-info)' }} />
                    <span className="text-xs font-medium">{f.name}</span>
                    <span className="text-xs text-tertiary">{(f.size / 1024).toFixed(1)} KB</span>
                  </div>
                  <button onClick={() => removeFile(i)} className="text-error hover:text-red-400 leading-none text-lg">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Voice */}
        <div className="card ingestion-card flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Mic size={22} style={{ color: 'var(--color-secondary)' }} />
              <h2 className="text-xl font-semibold">Voice Ingestion</h2>
            </div>
            <p className="text-secondary text-sm mb-4">Capture live meeting conversations — synthesized with uploaded transcripts.</p>
            <div className="voice-recorder-container p-6 flex-col items-center justify-center border border-subtle rounded-xl text-center">
              <button className={`record-btn ${isRecording ? 'recording' : ''}`} onClick={isRecording ? stopRecording : startRecording}>
                {isRecording ? <MicOff size={30} color="white" /> : <Mic size={30} color="var(--color-primary)" />}
              </button>
              <div className="mt-3 text-sm">
                {isRecording ? <span className="text-error font-medium">Recording... {formatTime(recordingTime)}</span> : <span className="text-secondary">Click to start live recording</span>}
              </div>
              {recordingTranscript && (
                <div className="mt-3 text-left w-full">
                  <p className="text-xs text-tertiary uppercase font-semibold mb-1">Live Transcript</p>
                  <div className="bg-root border border-subtle rounded p-2 text-xs text-secondary max-h-20 overflow-y-auto">{recordingTranscript}</div>
                  <p className="text-xs text-success mt-1 flex items-center gap-1"><CheckCircle size={10} /> Will be included in extraction</p>
                </div>
              )}
            </div>
          </div>
          <div className="mt-5 flex flex-col gap-2">
            <button
              className="btn btn-primary w-full py-3.5 text-base font-semibold gap-2"
              onClick={handleProcess}
              disabled={isProcessing || !hasInput}
              style={(!hasInput || isProcessing) ? { opacity: 0.55, cursor: 'not-allowed' } : {}}
            >
              {isProcessing ? <><Loader2 className="animate-spin" size={18} />{processingStep || 'Processing...'}</> : <><Zap size={18} />Run AI Extraction Pipeline</>}
            </button>
            <button className="btn btn-secondary w-full py-2 text-sm gap-2" onClick={() => { loadMockStories?.(); navigate('/review?mock=true'); }} disabled={isProcessing}>
              <FileText size={14} /> Use Demo Data
            </button>
          </div>
        </div>
      </div>

      {/* Pipeline History */}
      {pipelineHistory.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Clock size={18} style={{ color: 'var(--color-primary)' }} /> Pipeline History
            </h2>
            <span className="text-xs text-tertiary">{pipelineHistory.length} runs</span>
          </div>
          <div className="flex-col gap-2">
            {pipelineHistory.slice(0, 8).map(run => (
              <div key={run.id} className="flex items-center justify-between p-3 border border-subtle rounded-lg bg-root hover:border-primary/30 transition-colors">
                <div className="flex items-center gap-3 min-w-0">
                  <StatusBadge status={run.status} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{run.transcript_summary || 'Untitled run'}</p>
                    <p className="text-xs text-tertiary">{new Date(run.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 text-xs text-secondary flex-shrink-0">
                  <span className="flex items-center gap-1"><FileText size={12} /> {run.story_count} stories</span>
                  {run.approved_count > 0 && <span className="flex items-center gap-1"><CheckCircle size={12} style={{ color: 'var(--color-success)' }} /> {run.approved_count} pushed</span>}
                  {run.jira_keys && JSON.parse(run.jira_keys || '[]').length > 0 && (
                    <span className="flex items-center gap-1 font-mono text-blue-400">
                      <GitBranch size={12} /> {JSON.parse(run.jira_keys).join(', ')}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
