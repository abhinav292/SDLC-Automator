import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, Mic, Activity, CheckCircle, FileText, Loader2 } from 'lucide-react';
import { mockProjectStats } from '../mocks';
import './Dashboard.css';

export const Dashboard = () => {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  // File Upload Handlers
  const handleFileDrop = (e) => {
    e.preventDefault();
    const droppedFiles = Array.from(e.dataTransfer.files).filter(f => 
      f.name.endsWith('.txt') || f.name.endsWith('.docx') || f.name.endsWith('.pdf')
    );
    setFiles(prev => [...prev, ...droppedFiles]);
  };

  const handleDragOver = (e) => e.preventDefault();

  const handleFileSelect = (e) => {
    const selectedFiles = Array.from(e.target.files);
    setFiles(prev => [...prev, ...selectedFiles]);
  };

  const removeFile = (index) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  // Processing Simulation
  const handleProcess = () => {
    setIsProcessing(true);
    // Simulate API call to Bedrock for extraction
    setTimeout(() => {
      setIsProcessing(false);
      navigate('/review');
    }, 2500);
  };

  const toggleRecording = () => {
    setIsRecording(!isRecording);
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header mb-8">
        <h1 className="text-3xl font-bold mb-2">Workspace Dashboard</h1>
        <p className="text-secondary">Upload product requirements or record a live meeting to generate SDLC artifacts.</p>
      </header>

      {/* Stats Cards */}
      <div className="stats-grid mb-8 glass-panel p-6">
        <div className="stat-item">
          <div className="stat-label">Pipeline Runs (30d)</div>
          <div className="stat-value">{mockProjectStats.pipelineRuns}</div>
        </div>
        <div className="stat-item border-l border-subtle pl-6">
          <div className="stat-label">Stories Pushed</div>
          <div className="stat-value gradient-text">{mockProjectStats.storiesPushed}</div>
        </div>
        <div className="stat-item border-l border-subtle pl-6">
          <div className="stat-label">Time Saved</div>
          <div className="stat-value text-success">{mockProjectStats.timeSaved}</div>
        </div>
        <div className="stat-item border-l border-subtle pl-6">
          <div className="stat-label">AI Accuracy</div>
          <div className="stat-value">{mockProjectStats.accuracy}</div>
        </div>
      </div>

      <div className="ingestion-grid">
        {/* Upload Zone */}
        <div className="card ingestion-card flex-col">
          <div className="flex items-center gap-3 mb-4">
            <UploadCloud size={24} className="text-primary" />
            <h2 className="text-xl font-semibold">Upload Transcripts</h2>
          </div>
          <p className="text-secondary text-sm mb-6">Support for .txt, .docx, and .pdf formats.</p>

          <div 
            className="upload-dropzone"
            onDrop={handleFileDrop}
            onDragOver={handleDragOver}
          >
            <div className="upload-content flex flex-col items-center justify-center p-8 text-center text-secondary">
              <UploadCloud size={48} className="mb-4 text-tertiary" />
              <p className="mb-2">Drag and drop files here or click to select</p>
              <p className="text-sm text-tertiary mb-4">Max file size: 50MB</p>
              
              <input
                type="file"
                id="file-upload"
                multiple
                accept=".txt,.docx,.pdf"
                className="hidden"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <label htmlFor="file-upload" className="btn btn-secondary cursor-pointer">
                Select Files
              </label>
            </div>
          </div>

          {files.length > 0 && (
            <div className="file-list mt-6 flex-col gap-2">
              {files.map((f, i) => (
                <div key={i} className="file-item glass-panel flex items-center justify-between p-3 rounded">
                  <div className="flex items-center gap-3">
                    <FileText size={18} className="text-info" />
                    <span className="text-sm font-medium">{f.name}</span>
                    <span className="text-xs text-secondary">{(f.size / 1024).toFixed(1)} KB</span>
                  </div>
                  <button onClick={() => removeFile(i)} className="text-error hover:text-red-400">&times;</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Voice Input Zone */}
        <div className="card ingestion-card flex-col justify-between">
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Mic size={24} className="text-secondary" style={{ color: 'var(--color-secondary)' }} />
              <h2 className="text-xl font-semibold">Voice Ingestion</h2>
            </div>
            <p className="text-secondary text-sm mb-6">Capture live meeting conversations and automatically synthesize them with uploaded transcripts.</p>

            <div className="voice-recorder-container p-8 flex-col items-center justify-center border border-subtle rounded-xl text-center">
              <button 
                className={`record-btn ${isRecording ? 'recording animate-pulse' : ''}`}
                onClick={toggleRecording}
              >
                <Mic size={32} color={isRecording ? 'white' : 'var(--color-primary)'} />
              </button>
              <div className="mt-6 text-sm">
                {isRecording ? (
                  <span className="text-error font-medium">Recording live session... (01:23)</span>
                ) : (
                  <span className="text-secondary">Click to start live recording</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-8 flex justify-end">
            <button 
              className="btn btn-primary w-full py-4 text-base font-semibold gap-2"
              onClick={handleProcess}
              disabled={isProcessing || (files.length === 0 && !isRecording)}
              style={isProcessing ? { opacity: 0.7, cursor: 'not-allowed' } : {}}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="animate-spin" size={20} />
                  Processing via Bedrock...
                </>
              ) : (
                <>
                  <Activity size={20} />
                  Run AI Extraction Pipeline
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
