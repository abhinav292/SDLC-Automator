import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CheckCircle, AlertTriangle, Edit3, Save, Trash2, GitMerge,
  FileText, X, TestTube, ThumbsUp, ThumbsDown, CheckSquare, Download
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { mockStories } from '../mocks';
import { ReactFlow, Background, Controls, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './Review.css';

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
  const { stories, setStoriesFromExtraction, approvedStoryIds, discardedStoryIds, approveStory, discardStory, approveAll, updateStory } = useApp();

  const [selectedStoryId, setSelectedStoryId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [viewMode, setViewMode] = useState('solutioning');
  const [selectedSolutionId, setSelectedSolutionId] = useState({});

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

  const startEdit = (story) => {
    setEditingId(story.id);
    setEditForm({ ...story, acText: story.acceptanceCriteria.join('\n') });
  };

  const saveEdit = () => {
    updateStory(editingId, {
      ...editForm,
      acceptanceCriteria: editForm.acText.split('\n').filter(l => l.trim())
    });
    setEditingId(null);
    setEditForm(null);
  };

  const cancelEdit = () => { setEditingId(null); setEditForm(null); };

  const downloadFeatureFile = (story) => {
    const slug = story.title.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40);
    const featureContent = `Feature: ${story.title}\n  ${story.description}\n\n${story.qaScenarios.join('\n\n')}`;
    const blob = new Blob([featureContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.feature`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handlePushToJira = () => {
    if (approvedCount === 0) {
      alert('Please approve at least one story before pushing to Jira.');
      return;
    }
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
      riskCount: s.riskFlags.length,
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

  return (
    <div className="review-dashboard h-full flex flex-col">
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Review Checkpoint</h1>
          <p className="text-secondary">
            {approvedCount} approved · {pendingCount} pending ·{' '}
            {discardedStoryIds.size} discarded
          </p>
        </div>
        <div className="flex gap-3">
          <button className="btn btn-secondary" onClick={approveAll}>
            <CheckSquare size={16} /> Approve All
          </button>
          <button className="btn btn-primary" onClick={handlePushToJira} disabled={approvedCount === 0}>
            <CheckCircle size={18} />
            Push {approvedCount} Stories to Jira
          </button>
        </div>
      </header>

      <div className="review-layout">
        {/* Left: Story List */}
        <div className="story-list-pane flex-col gap-4 scrollable-y pr-2">
          {stories.map(story => {
            const status = getStoryStatus(story);
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
                    <div className="flex justify-end gap-2 mt-2">
                      <button className="btn btn-secondary" onClick={cancelEdit}><X size={14} /> Cancel</button>
                      <button className="btn btn-primary" onClick={saveEdit}><Save size={14} /> Save</button>
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

                      {story.riskFlags.length > 0 && (
                        <div className="flex items-center gap-1 text-xs text-error mb-2 bg-red-900/20 w-fit px-2 py-0.5 rounded">
                          <AlertTriangle size={11} />
                          <span>{story.riskFlags.length} Risk{story.riskFlags.length > 1 ? 's' : ''}</span>
                        </div>
                      )}
                    </div>

                    <div className="flex justify-between items-center mt-3 pt-3 border-t border-subtle">
                      <div className="flex gap-1">
                        <button
                          className={`btn p-1.5 text-xs ${status === 'approved' ? 'btn-primary' : 'btn-secondary'}`}
                          onClick={() => approveStory(story.id)}
                          title="Approve"
                        >
                          <ThumbsUp size={13} />
                        </button>
                        <button
                          className="btn btn-danger p-1.5"
                          onClick={() => discardStory(story.id)}
                          title="Discard"
                        >
                          <ThumbsDown size={13} />
                        </button>
                      </div>
                      <button className="btn btn-secondary p-1.5" onClick={() => startEdit(story)} title="Edit">
                        <Edit3 size={13} />
                      </button>
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
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-hidden relative">
            {viewMode === 'solutioning' && selectedStory && (
              <div className="solution-content scrollable-y absolute inset-0 pr-2 animate-fade-in">
                <div className="flex justify-between items-start mb-4">
                  <h2 className="text-xl font-bold">{selectedStory.title}</h2>
                  <span className="badge badge-info">{selectedStory.adjustedPoints} pts</span>
                </div>

                {selectedStory.riskFlags.length > 0 && (
                  <div className="risk-banner bg-red-900/20 border border-red-500/30 rounded-lg p-4 mb-5">
                    <h4 className="flex items-center gap-2 text-error font-semibold mb-2 text-sm">
                      <AlertTriangle size={16} /> Risk Flags
                    </h4>
                    <ul className="list-disc pl-5 text-xs text-red-200 space-y-1">
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
                    {selectedStory.acceptanceCriteria.map((ac, i) => <li key={i}>{ac}</li>)}
                  </ul>
                </div>

                <div className="mb-6">
                  <h3 className="text-base font-semibold mb-3" style={{ color: 'var(--color-primary)' }}>
                    Technical Solution Proposals
                  </h3>
                  <div className="flex flex-col gap-3">
                    {selectedStory.solution.options.map(opt => {
                      const isSelected = (selectedSolutionId[selectedStory.id] || selectedStory.solution.options.find(o => o.recommended)?.id) === opt.id;
                      return (
                        <div
                          key={opt.id}
                          className={`solution-option p-4 rounded-xl border transition-all cursor-pointer ${isSelected ? 'border-primary bg-indigo-900/10 glow-border' : 'border-subtle bg-root'}`}
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
                                {opt.pros.map((p, i) => <li key={i}>{p}</li>)}
                              </ul>
                            </div>
                            <div>
                              <span style={{ color: 'var(--color-warning)' }} className="font-semibold">Cons</span>
                              <ul className="list-disc pl-3 text-secondary mt-1 space-y-0.5">
                                {opt.cons.map((c, i) => <li key={i}>{c}</li>)}
                              </ul>
                            </div>
                          </div>
                          <div className="flex justify-between items-center mt-3 pt-3 border-t border-subtle">
                            <span className="text-xs text-tertiary">Complexity: <span className="text-primary font-medium">{opt.complexity}</span></span>
                          </div>
                        </div>
                      );
                    })}
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
                <div className="bg-root border border-subtle rounded-lg p-5 font-mono text-sm text-secondary whitespace-pre-wrap leading-relaxed">
                  {selectedStory.qaScenarios.join('\n\n')}
                </div>
              </div>
            )}

            {viewMode === 'dependencies' && (
              <div className="absolute inset-0 bg-root rounded-lg border border-subtle animate-fade-in">
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
    </div>
  );
};
