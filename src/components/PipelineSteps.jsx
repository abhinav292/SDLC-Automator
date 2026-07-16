import React from 'react';
import { useNavigate } from 'react-router-dom';
import { UploadCloud, FileText, CheckSquare, Network, Check } from 'lucide-react';
import { useApp } from '../context/AppContext';
import './PipelineSteps.css';

const STEPS = [
  { id: 'ingest', label: 'Ingest', icon: UploadCloud, path: '/' },
  { id: 'prd', label: 'Draft PRD', icon: FileText, path: '/prd' },
  { id: 'review', label: 'Review', icon: CheckSquare, path: '/review' },
  { id: 'sync', label: 'Sync', icon: Network, path: '/handoff' }
];

// Shared progress indicator shown across the pipeline phases. Completed steps are
// clickable so the user can jump back; future steps are only reachable once their
// prerequisite data exists (e.g. a PRD must exist before /prd is navigable).
export const PipelineSteps = ({ current }) => {
  const navigate = useNavigate();
  const { prd, stories, approvedStoryIds } = useApp();

  const reachable = {
    ingest: true,
    prd: !!prd,
    review: stories.length > 0,
    sync: (approvedStoryIds?.size || 0) > 0
  };

  const currentIndex = STEPS.findIndex(s => s.id === current);

  return (
    <nav className="pipeline-steps" aria-label="Pipeline progress">
      {STEPS.map((step, i) => {
        const Icon = step.icon;
        const isCurrent = step.id === current;
        const isDone = i < currentIndex;
        const canNavigate = !isCurrent && reachable[step.id];
        const state = isCurrent ? 'current' : isDone ? 'done' : 'upcoming';

        return (
          <React.Fragment key={step.id}>
            <button
              type="button"
              className={`pipeline-step ${state} ${canNavigate ? 'clickable' : ''}`}
              onClick={() => canNavigate && navigate(step.path)}
              disabled={!canNavigate}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span className="pipeline-step-marker">
                {isDone ? <Check size={14} /> : <Icon size={14} />}
              </span>
              <span className="pipeline-step-label">
                <span className="pipeline-step-index">Step {i + 1}</span>
                {step.label}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <span className={`pipeline-connector ${i < currentIndex ? 'done' : ''}`} aria-hidden="true" />
            )}
          </React.Fragment>
        );
      })}
    </nav>
  );
};
