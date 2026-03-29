import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  CheckCircle, AlertTriangle, Edit3, Save, 
  Trash2, GitMerge, FileText, ChevronRight, X, TestTube 
} from 'lucide-react';
import { mockStories } from '../mocks';
import { ReactFlow, Background, Controls, Handle, Position } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './Review.css';

const CustomNode = ({ data, selected }) => {
  return (
    <div className={`custom-node ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} className="w-2 h-2 !bg-primary" />
      <div className="node-header">
        <span>{data.storyId}</span>
        <span className="node-badge">{data.points} pts</span>
      </div>
      <div className="node-title">{data.label}</div>
      {data.riskCount > 0 && (
        <div className="text-xs text-error mt-2 flex items-center gap-1">
          <AlertTriangle size={10} /> {data.riskCount} Risks
        </div>
      )}
      <Handle type="source" position={Position.Bottom} className="w-2 h-2 !bg-primary" />
    </div>
  );
};

const nodeTypes = { custom: CustomNode };

export const Review = () => {
  const navigate = useNavigate();
  const [stories, setStories] = useState(mockStories);
  const [selectedStoryId, setSelectedStoryId] = useState(mockStories[0].id);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [viewMode, setViewMode] = useState('solutioning'); // 'solutioning' or 'dependencies'

  const selectedStory = stories.find(s => s.id === selectedStoryId);

  // Editing Logic
  const startEdit = (story) => {
    setEditingId(story.id);
    setEditForm({ ...story, acText: story.acceptanceCriteria.join('\n') });
  };

  const saveEdit = () => {
    setStories(stories.map(s => 
      s.id === editingId 
        ? { ...editForm, acceptanceCriteria: editForm.acText.split('\n').filter(l => l.trim()) } 
        : s
    ));
    setEditingId(null);
    setEditForm(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm(null);
  };

  const handlePush = () => {
    navigate('/handoff');
  };

  // React Flow configuration for Dependencies
  const nodes = stories.map((s, idx) => ({
    id: s.id,
    type: 'custom',
    position: { x: 50 + (idx * 250), y: 100 + (idx % 2 === 0 ? 0 : 120) },
    data: { 
      label: s.title,
      storyId: s.id.toUpperCase(),
      points: s.adjustedPoints,
      riskCount: s.riskFlags.length
    }
  }));

  const edges = stories.flatMap(s => 
    s.dependencies.map(dep => ({
      id: `e-${s.id}-${dep}`,
      source: dep,
      target: s.id,
      animated: true,
      style: { stroke: 'var(--color-primary)' }
    }))
  );

  return (
    <div className="review-dashboard h-full flex flex-col">
      <header className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Review Checkpoint</h1>
          <p className="text-secondary">Approve, edit, or discard AI-extracted artifacts before committing to engineering tools.</p>
        </div>
        <button className="btn btn-primary" onClick={handlePush}>
          <CheckCircle size={18} />
          Approve {stories.length} Stories & Push
        </button>
      </header>

      <div className="review-layout">
        {/* Left Pane: Story List */}
        <div className="story-list-pane flex-col gap-4 scrollable-y pr-2">
          {stories.map(story => (
            <div 
              key={story.id} 
              className={`story-card card ${selectedStoryId === story.id ? 'selected' : ''}`}
            >
              {editingId === story.id ? (
                <div className="edit-form flex-col gap-3">
                  <input 
                    className="input-field font-bold text-lg" 
                    value={editForm.title}
                    onChange={e => setEditForm({...editForm, title: e.target.value})}
                  />
                  <textarea 
                    className="input-field text-sm" 
                    value={editForm.description}
                    onChange={e => setEditForm({...editForm, description: e.target.value})}
                  />
                  <div>
                    <span className="text-xs text-secondary uppercase block mb-1">Acceptance Criteria (1 per line)</span>
                    <textarea 
                      className="input-field text-sm font-mono bg-root" 
                      style={{ minHeight: '120px' }}
                      value={editForm.acText}
                      onChange={e => setEditForm({...editForm, acText: e.target.value})}
                    />
                  </div>
                  <div className="flex items-center gap-4 mt-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm">Points:</span>
                      <input 
                        type="number" 
                        className="input-field w-20 text-center" 
                        value={editForm.adjustedPoints}
                        onChange={e => setEditForm({...editForm, adjustedPoints: parseInt(e.target.value)})}
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-4">
                    <button className="btn btn-secondary" onClick={cancelEdit}><X size={16}/> Cancel</button>
                    <button className="btn btn-primary" onClick={saveEdit}><Save size={16}/> Save Changes</button>
                  </div>
                </div>
              ) : (
                <>
                  <div 
                    className="cursor-pointer" 
                    onClick={() => setSelectedStoryId(story.id)}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="font-semibold text-lg pr-4">{story.title}</h3>
                      <span className="badge badge-info whitespace-nowrap">{story.adjustedPoints} pts</span>
                    </div>
                    <p className="text-secondary text-sm line-clamp-2 mb-4">{story.description}</p>
                    
                    {story.riskFlags.length > 0 && (
                      <div className="flex items-center gap-1 text-xs text-error mb-3 bg-red-900/20 w-fit px-2 py-1 rounded">
                        <AlertTriangle size={12} />
                        <span>{story.riskFlags.length} Risks Detected</span>
                      </div>
                    )}
                  </div>
                  
                  <div className="flex justify-between items-center mt-4 pt-4 border-t border-subtle">
                    <button className="text-secondary hover:text-white transition-colors" onClick={() => setSelectedStoryId(story.id)}>
                      View Details
                    </button>
                    <div className="flex gap-2">
                      <button className="btn btn-secondary p-1.5" onClick={() => startEdit(story)} title="Edit Story">
                        <Edit3 size={16} />
                      </button>
                      <button className="btn btn-danger p-1.5" title="Discard">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Right Pane: Details & Solutioning */}
        <div className="details-pane card flex flex-col h-full">
          {/* Tabs */}
          <div className="flex gap-4 border-b border-subtle pb-4 mb-4">
            <button 
              className={`tab-btn flex gap-2 items-center ${viewMode === 'solutioning' ? 'active' : ''}`}
              onClick={() => setViewMode('solutioning')}
            >
              <FileText size={18} />
              Technical Solutioning
            </button>
            <button 
              className={`tab-btn flex gap-2 items-center ${viewMode === 'qa' ? 'active' : ''}`}
              onClick={() => setViewMode('qa')}
            >
              <TestTube size={18} />
              QA Tests
            </button>
            <button 
              className={`tab-btn flex gap-2 items-center ${viewMode === 'dependencies' ? 'active' : ''}`}
              onClick={() => setViewMode('dependencies')}
            >
              <GitMerge size={18} />
              Dependency Map
            </button>
          </div>

          <div className="flex-1 overflow-hidden relative">
            {viewMode === 'solutioning' && selectedStory && (
              <div className="solution-content scrollable-y absolute inset-0 pr-2 animate-fade-in">
                <h2 className="text-xl font-bold mb-4">{selectedStory.title}</h2>
                
                {/* Risks */}
                {selectedStory.riskFlags.length > 0 && (
                  <div className="risk-banner bg-red-900/20 border border-red-500/30 rounded-lg p-4 mb-6">
                    <h4 className="flex items-center gap-2 text-error font-semibold mb-2">
                      <AlertTriangle size={18} /> High-Priority Risk Flags
                    </h4>
                    <ul className="list-disc pl-5 text-sm text-red-200">
                      {selectedStory.riskFlags.map(r => <li key={r.id}>{r.text}</li>)}
                    </ul>
                  </div>
                )}

                {/* Acceptance Criteria */}
                <div className="mb-8">
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <CheckCircle size={18} className="text-success" /> Acceptance Criteria
                  </h3>
                  <ul className="list-disc pl-5 space-y-2 text-secondary text-sm">
                    {selectedStory.acceptanceCriteria.map((ac, i) => <li key={i}>{ac}</li>)}
                  </ul>
                </div>

                {/* Technical Implementation Options */}
                <div className="mb-8">
                  <h3 className="text-lg font-semibold mb-4 text-primary">Generated Solution Proposals</h3>
                  <div className="flex flex-col gap-4">
                    {selectedStory.solution.options.map(opt => (
                      <div key={opt.id} className={`solution-option p-5 rounded-xl border transition-all ${opt.recommended ? 'border-primary bg-indigo-900/10 glow-border' : 'border-subtle bg-root'}`}>
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-semibold text-md">{opt.name}</h4>
                          {opt.recommended && <span className="badge badge-success bg-green-900/30 text-green-400">AI Recommended</span>}
                        </div>
                        <p className="text-sm text-secondary mb-4">{opt.description}</p>
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className="text-success font-semibold">Pros:</span>
                            <ul className="list-disc pl-4 text-secondary mt-1">
                              {opt.pros.map((p, i) => <li key={i}>{p}</li>)}
                            </ul>
                          </div>
                          <div>
                            <span className="text-warning font-semibold">Cons:</span>
                            <ul className="list-disc pl-4 text-secondary mt-1">
                              {opt.cons.map((c, i) => <li key={i}>{c}</li>)}
                            </ul>
                          </div>
                        </div>
                        <div className="flex justify-between items-center mt-4 pt-4 border-t border-subtle">
                          <span className="text-xs text-tertiary">Complexity: <span className="text-white">{opt.complexity}</span></span>
                          <button className={`btn ${opt.recommended ? 'btn-primary' : 'btn-secondary'} py-1 px-3 text-xs`}>
                            {opt.recommended ? 'Selected Approach' : 'Select This Option'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {viewMode === 'qa' && selectedStory && (
              <div className="solution-content scrollable-y absolute inset-0 pr-2 animate-fade-in">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <TestTube className="text-secondary" /> 
                  QA Scenarios
                </h2>
                <div className="bg-root border border-subtle rounded-lg p-6 font-mono text-sm text-secondary whitespace-pre-line leading-relaxed shadow-inner">
                  {selectedStory.qaScenarios.join('\n\n')}
                </div>
              </div>
            )}

            {viewMode === 'dependencies' && (
              <div className="absolute inset-0 bg-root rounded-lg border border-subtle animate-fade-in">
                <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView>
                  <Background color="var(--border-subtle)" />
                  <Controls />
                </ReactFlow>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
