import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, Mic, Activity, FileText, Loader2, X, Plus, MicOff, CheckCircle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { extractTextFromFile } from '../services/fileReaderService';
import { extractStoriesFromFiles } from '../services/extractionService';
import './Dashboard.css';

export const Dashboard = () => {
  const navigate = useNavigate();
  const { pipelineStats, setStoriesFromExtraction } = useApp();
  const [files, setFiles] = useState([]);
  const [dragActive, setDragActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [recordingTranscript, setRecordingTranscript] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState('');
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerRef = useRef(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    return () => {
      clearInterval(timerRef.current);
      if (recognitionRef.current) recognitionRef.current.stop();
    };
  }, []);

  const handleFileDrop = (e) => {
    e.preventDefault();
    setDragActive(false);
    const dropped = Array.from(e.dataTransfer.files).filter(f =>
      /\.(txt|docx|pdf)$/i.test(f.name)
    );
    setFiles(prev => [...prev, ...dropped]);
  };

  const handleDragOver = (e) => { e.preventDefault(); setDragActive(true); };
  const handleDragLeave = () => setDragActive(false);

  const handleFileSelect = (e) => {
    const selected = Array.from(e.target.files);
    setFiles(prev => [...prev, ...selected]);
    e.target.value = '';
  };

  const removeFile = (index) => setFiles(files.filter((_, i) => i !== index));

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorder.ondataavailable = (e) => audioChunksRef.current.push(e.data);
      recorder.start(100);
      mediaRecorderRef.current = recorder;
      setIsRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime(t => t + 1), 1000);

      if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SR();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = (e) => {
          const transcript = Array.from(e.results).map(r => r[0].transcript).join(' ');
          setRecordingTranscript(transcript);
        };
        recognition.start();
        recognitionRef.current = recognition;
      }
    } catch (err) {
      alert('Microphone access denied. Please allow microphone access to use voice recording.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
    }
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
    clearInterval(timerRef.current);
    setIsRecording(false);
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording();
    else startRecording();
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const hasInput = files.length > 0 || recordingTranscript.length > 50;

  const handleProcess = async () => {
    if (!hasInput) return;
    setIsProcessing(true);

    try {
      const texts = [];

      if (recordingTranscript) {
        texts.push(`Voice Recording Transcript:\n${recordingTranscript}`);
      }

      setProcessingStep('Reading files...');
      for (const file of files) {
        setProcessingStep(`Reading ${file.name}...`);
        const text = await extractTextFromFile(file);
        if (text) texts.push(`File: ${file.name}\n\n${text}`);
      }

      setProcessingStep('AI Extracting requirements...');
      await new Promise(r => setTimeout(r, 600));

      setProcessingStep('Generating stories & solutions...');
      const stories = await extractStoriesFromFiles(texts);
      await new Promise(r => setTimeout(r, 400));

      setStoriesFromExtraction(stories);
      navigate('/review');
    } catch (err) {
      console.error('Extraction error:', err);
      alert('An error occurred during extraction. Please try again.');
    } finally {
      setIsProcessing(false);
      setProcessingStep('');
    }
  };

  const handleUseMockData = () => {
    navigate('/review?mock=true');
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header mb-8">
        <h1 className="text-3xl font-bold mb-2">Workspace Dashboard</h1>
        <p className="text-secondary">Upload product requirements or record a live meeting to generate SDLC artifacts.</p>
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

      <div className="ingestion-grid">
        {/* Upload Zone */}
        <div className="card ingestion-card flex-col">
          <div className="flex items-center gap-3 mb-4">
            <UploadCloud size={24} className="text-primary" />
            <h2 className="text-xl font-semibold">Upload Transcripts</h2>
          </div>
          <p className="text-secondary text-sm mb-4">Support for .txt, .docx, and .pdf formats. Add multiple files for multi-transcript synthesis.</p>

          <div
            className={`upload-dropzone ${dragActive ? 'drag-active' : ''}`}
            onDrop={handleFileDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            style={{ flex: 1, minHeight: 180 }}
          >
            <div className="upload-content flex flex-col items-center justify-center p-8 text-center text-secondary h-full">
              <UploadCloud size={40} className="mb-4 text-tertiary" />
              <p className="mb-2 text-sm">Drag and drop files here or click to select</p>
              <p className="text-xs text-tertiary mb-4">Max file size: 50MB per file</p>
              <input
                type="file"
                id="file-upload"
                multiple
                accept=".txt,.docx,.pdf"
                style={{ display: 'none' }}
                onChange={handleFileSelect}
              />
              <label htmlFor="file-upload" className="btn btn-secondary cursor-pointer">
                <Plus size={16} /> Select Files
              </label>
            </div>
          </div>

          {files.length > 0 && (
            <div className="file-list mt-4 flex-col gap-2">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-tertiary uppercase font-semibold tracking-wide">{files.length} file{files.length > 1 ? 's' : ''} selected</span>
              </div>
              {files.map((f, i) => (
                <div key={i} className="file-item glass-panel flex items-center justify-between p-3 rounded">
                  <div className="flex items-center gap-3">
                    <FileText size={16} className="text-info" />
                    <span className="text-sm font-medium">{f.name}</span>
                    <span className="text-xs text-tertiary">{(f.size / 1024).toFixed(1)} KB</span>
                  </div>
                  <button onClick={() => removeFile(i)} className="text-error hover:text-red-400 text-lg leading-none">×</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Voice Input Zone */}
        <div className="card ingestion-card flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Mic size={24} style={{ color: 'var(--color-secondary)' }} />
              <h2 className="text-xl font-semibold">Voice Ingestion</h2>
            </div>
            <p className="text-secondary text-sm mb-4">Capture live meeting conversations and automatically synthesize them with uploaded transcripts.</p>

            <div className="voice-recorder-container p-6 flex-col items-center justify-center border border-subtle rounded-xl text-center">
              <button
                className={`record-btn ${isRecording ? 'recording' : ''}`}
                onClick={toggleRecording}
              >
                {isRecording ? <MicOff size={32} color="white" /> : <Mic size={32} color="var(--color-primary)" />}
              </button>
              <div className="mt-4 text-sm">
                {isRecording ? (
                  <span className="text-error font-medium">Recording... {formatTime(recordingTime)}</span>
                ) : (
                  <span className="text-secondary">Click to start live recording</span>
                )}
              </div>
              {recordingTranscript && (
                <div className="mt-4 text-left w-full">
                  <p className="text-xs text-tertiary uppercase font-semibold mb-1">Live Transcript</p>
                  <div className="bg-root border border-subtle rounded p-3 text-xs text-secondary max-h-24 overflow-y-auto leading-relaxed">
                    {recordingTranscript}
                  </div>
                  <div className="flex items-center gap-1 mt-2 text-success text-xs">
                    <CheckCircle size={12} />
                    <span>Transcript captured – will be included in extraction</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3">
            <button
              className="btn btn-primary w-full py-4 text-base font-semibold gap-2"
              onClick={handleProcess}
              disabled={isProcessing || !hasInput}
              style={(!hasInput || isProcessing) ? { opacity: 0.6, cursor: 'not-allowed' } : {}}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  {processingStep || 'Processing...'}
                </>
              ) : (
                <>
                  <Activity size={20} />
                  Run AI Extraction Pipeline
                </>
              )}
            </button>
            <button
              className="btn btn-secondary w-full py-2 text-sm gap-2"
              onClick={handleUseMockData}
              disabled={isProcessing}
            >
              <FileText size={16} /> Use Demo Data (no upload needed)
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
