import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle, Loader2, Link, FileText, CheckSquare, GitBranch, Send,
  AlertTriangle, ExternalLink, ArrowRight
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { createJiraStory, linkJiraIssues, getJiraBaseUrl } from '../services/jiraService';
import { createBitbucketBranch, getBitbucketBranchName } from '../services/bitbucketService';
import { createConfluencePage, getConfluenceBaseUrl } from '../services/confluenceService';
import './Handoff.css';

const SyncPhase = ({ label, status }) => (
  <div className={`sync-phase flex items-center gap-3 p-3 rounded-lg border transition-all ${
    status === 'done' ? 'border-green-500/30 bg-green-900/10' :
    status === 'active' ? 'border-primary/50 bg-indigo-900/10 glow-border' :
    status === 'error' ? 'border-red-500/30 bg-red-900/10' :
    'border-subtle opacity-40'
  }`}>
    {status === 'done' && <CheckCircle size={18} style={{ color: 'var(--color-success)', flexShrink: 0 }} />}
    {status === 'active' && <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-primary)', flexShrink: 0 }} />}
    {status === 'error' && <AlertTriangle size={18} style={{ color: 'var(--color-error)', flexShrink: 0 }} />}
    {status === 'waiting' && <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--border-subtle)', flexShrink: 0 }} />}
    <span className="text-sm font-medium">{label}</span>
  </div>
);

export const Handoff = () => {
  const navigate = useNavigate();
  const { stories, approvedStoryIds, settings, setJiraIssues, setBitbucketBranches, setConfluencePages, setPipelineStats, completePipeline } = useApp();
  const [phase, setPhase] = useState('idle');
  const [jiraResults, setJiraResults] = useState({});
  const [branchResults, setBranchResults] = useState({});
  const [confluenceResult, setConfluenceResult] = useState(null);
  const [phaseStatuses, setPhaseStatuses] = useState({ jira: 'waiting', bitbucket: 'waiting', confluence: 'waiting', notifications: 'waiting' });
  const [errors, setErrors] = useState([]);

  const approvedStories = stories.filter(s => approvedStoryIds.has(s.id));

  useEffect(() => {
    if (approvedStories.length > 0) {
      runSync();
    }
  }, []);

  const setPhaseStatus = (phaseName, status) =>
    setPhaseStatuses(prev => ({ ...prev, [phaseName]: status }));

  const runSync = async () => {
    setPhase('running');
    const errs = [];

    await new Promise(r => setTimeout(r, 600));

    // Step 1: Jira
    setPhaseStatus('jira', 'active');
    const jiraMap = {};
    for (const story of approvedStories) {
      const result = await createJiraStory(story);
      jiraMap[story.id] = result;
      setJiraResults(prev => ({ ...prev, [story.id]: result }));
      if (!result.success) errs.push(`Jira – ${story.title}: ${result.error}`);
    }

    // Link dependencies in Jira
    for (const story of approvedStories) {
      for (const depId of (story.dependencies || [])) {
        const fromResult = jiraMap[depId];
        const toResult = jiraMap[story.id];
        if (fromResult?.success && toResult?.success) {
          await linkJiraIssues(fromResult.key, toResult.key);
        }
      }
    }
    setJiraIssues(jiraMap);
    setPhaseStatus('jira', errs.some(e => e.startsWith('Jira')) ? 'error' : 'done');

    await new Promise(r => setTimeout(r, 500));

    // Step 2: Bitbucket branches
    setPhaseStatus('bitbucket', 'active');
    const branchMap = {};
    const { bbWorkspace, bbRepo } = settings;

    for (const story of approvedStories) {
      const jiraKey = jiraMap[story.id]?.key || story.id.toUpperCase();
      const branchName = getBitbucketBranchName(jiraKey, story.title);
      const result = await createBitbucketBranch(bbWorkspace, bbRepo, branchName);
      branchMap[story.id] = { ...result, name: branchName };
      setBranchResults(prev => ({ ...prev, [story.id]: { ...result, name: branchName } }));
    }
    setBitbucketBranches(branchMap);

    const anyBranchFailed = Object.values(branchMap).some(b => !b.success);
    setPhaseStatus('bitbucket', anyBranchFailed ? 'error' : 'done');
    await new Promise(r => setTimeout(r, 400));

    // Step 3: Confluence
    setPhaseStatus('confluence', 'active');
    const confResult = await createConfluencePage(settings.confluenceSpaceKey, 'Sprint Planning', approvedStories);
    setConfluenceResult(confResult);
    setConfluencePages([confResult]);
    setPhaseStatus('confluence', confResult.success ? 'done' : 'error');
    if (!confResult.success) errs.push(`Confluence: ${confResult.error}`);
    await new Promise(r => setTimeout(r, 300));

    // Step 4: Notifications (simulated - no SES in browser)
    setPhaseStatus('notifications', 'active');
    await new Promise(r => setTimeout(r, 600));
    setPhaseStatus('notifications', 'done');

    setErrors(errs);

    // Update stats
    setPipelineStats(prev => ({
      ...prev,
      pipelineRuns: (prev.pipelineRuns || 0) + 1,
      storiesPushed: (prev.storiesPushed || 0) + approvedStories.filter(s => jiraMap[s.id]?.success).length
    }));

    // Persist pipeline completion to database
    await completePipeline(jiraMap, confResult?.url || null).catch(() => {});

    setPhase('done');
  };

  const allJiraSuccess = Object.values(jiraResults).every(r => r?.success);
  const jiraSuccessCount = Object.values(jiraResults).filter(r => r?.success).length;
  const branchSuccessCount = Object.values(branchResults).filter(r => r?.success).length;

  if (approvedStories.length === 0) {
    return (
      <div className="handoff-dashboard">
        <div className="flex flex-col items-center gap-4 max-w-md text-center">
          <AlertTriangle size={48} style={{ color: 'var(--color-warning)' }} />
          <h1 className="text-2xl font-bold">No Approved Stories</h1>
          <p className="text-secondary">Go back to the Review Pipeline and approve at least one story before pushing artifacts.</p>
          <button className="btn btn-primary" onClick={() => navigate('/review')}>
            <ArrowRight size={16} /> Back to Review
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="handoff-dashboard">
      <header className="mb-8 text-center">
        {phase !== 'done' ? (
          <>
            <div className="flex justify-center mb-5">
              <Loader2 size={56} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
            </div>
            <h1 className="text-3xl font-bold mb-2">Publishing Artifacts...</h1>
            <p className="text-secondary">Creating Jira stories, Bitbucket branches, and Confluence documentation.</p>
          </>
        ) : (
          <>
            <div className="flex justify-center mb-5">
              <div className="w-16 h-16 bg-green-500/20 rounded-full flex items-center justify-center animate-fade-in">
                <CheckCircle size={44} style={{ color: 'var(--color-success)' }} />
              </div>
            </div>
            <h1 className="text-3xl font-bold mb-2 animate-fade-in">Sync Complete!</h1>
            <p className="text-secondary animate-fade-in">
              {jiraSuccessCount} Jira stories · {branchSuccessCount} branches · {confluenceResult?.success ? '1 Confluence page' : 'Confluence skipped'}
            </p>
          </>
        )}
      </header>

      <div className="sync-progress-grid mb-8" style={{ maxWidth: 500, margin: '0 auto 2rem' }}>
        <SyncPhase label="Connecting to Atlassian toolchain" status={phaseStatuses.jira === 'waiting' ? 'waiting' : 'done'} />
        <SyncPhase label={`Creating ${approvedStories.length} Jira stories & linking dependencies`} status={phaseStatuses.jira} />
        <SyncPhase label="Scaffolding Bitbucket branches" status={phaseStatuses.bitbucket} />
        <SyncPhase label="Publishing Confluence solutioning doc" status={phaseStatuses.confluence} />
        <SyncPhase label="Sending stakeholder notifications" status={phaseStatuses.notifications} />
      </div>

      {errors.length > 0 && (
        <div className="card border-red-500/30 bg-red-900/10 mb-6" style={{ maxWidth: 800, margin: '0 auto 1.5rem' }}>
          <h4 className="flex items-center gap-2 text-error font-semibold mb-2 text-sm">
            <AlertTriangle size={16} /> Some integrations failed
          </h4>
          <ul className="list-disc pl-5 text-xs text-red-300 space-y-1">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          <p className="text-xs text-tertiary mt-2">Check Settings to verify your Atlassian credentials and Bitbucket/Confluence configuration.</p>
        </div>
      )}

      {phase === 'done' && (
        <div className="grid grid-cols-3 gap-5 mx-auto mb-8" style={{ maxWidth: 900 }}>
          {/* Jira */}
          <div className="card artifact-card animate-fade-in stagger-1">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-blue-500/10 rounded-lg"><CheckSquare size={22} style={{ color: '#60a5fa' }} /></div>
              <h2 className="text-lg font-semibold">Jira Stories</h2>
            </div>
            <div className="flex-col gap-2">
              {approvedStories.map(story => {
                const result = jiraResults[story.id];
                return (
                  <div key={story.id} className="p-3 border border-subtle bg-surface-elevated rounded flex justify-between items-center">
                    <div className="flex items-center gap-2 min-w-0">
                      {result?.success ? (
                        <span className="text-blue-400 font-mono text-xs font-bold whitespace-nowrap">{result.key}</span>
                      ) : (
                        <span className="text-error text-xs font-bold">FAILED</span>
                      )}
                      <span className="text-xs font-medium truncate">{story.title}</span>
                    </div>
                    {result?.success && result.url && (
                      <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-secondary hover:text-primary transition-colors flex-shrink-0 ml-2">
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
            {!allJiraSuccess && (
              <p className="text-xs text-tertiary mt-3">Some issues failed. Check your Jira project key in Settings.</p>
            )}
          </div>

          {/* Bitbucket */}
          <div className="card artifact-card animate-fade-in stagger-2">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-blue-600/10 rounded-lg"><GitBranch size={22} style={{ color: '#818cf8' }} /></div>
              <h2 className="text-lg font-semibold">Bitbucket Branches</h2>
            </div>
            {settings.bbWorkspace && settings.bbRepo ? (
              <div className="flex-col gap-2">
                {approvedStories.map(story => {
                  const result = branchResults[story.id];
                  return (
                    <div key={story.id} className="p-3 border border-subtle bg-surface-elevated rounded">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          {result?.success ? (
                            <CheckCircle size={12} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                          ) : (
                            <AlertTriangle size={12} style={{ color: 'var(--color-error)', flexShrink: 0 }} />
                          )}
                          <span className="text-xs text-secondary font-mono truncate">{result?.name || 'branch-name'}</span>
                        </div>
                        {result?.success && result.url && (
                          <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-secondary hover:text-primary transition-colors flex-shrink-0 ml-2">
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                      {!result?.success && result?.error && (
                        <p className="text-xs text-red-400 mt-1">{result.error}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center gap-2" style={{ flex: 1, minHeight: 80 }}>
                <p className="text-sm text-secondary">Configure Bitbucket workspace & repository in Settings to enable branch creation.</p>
                <button className="btn btn-secondary text-xs py-1 px-3" onClick={() => navigate('/settings')}>
                  Open Settings
                </button>
              </div>
            )}
          </div>

          {/* Confluence + Notifications */}
          <div className="flex-col gap-4">
            <div className="card artifact-card flex flex-col justify-between" style={{ flex: 1 }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-indigo-500/10 rounded-lg"><FileText size={20} style={{ color: '#a78bfa' }} /></div>
                <h2 className="text-base font-semibold">Confluence</h2>
              </div>
              {confluenceResult?.success ? (
                <>
                  <p className="text-xs text-secondary mb-3">Solutioning document published successfully.</p>
                  <a
                    href={confluenceResult.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn btn-secondary w-full justify-between text-xs py-1.5"
                  >
                    View Architecture Doc <ExternalLink size={12} />
                  </a>
                </>
              ) : (
                <>
                  <p className="text-xs text-secondary mb-3">
                    {confluenceResult?.error || 'Configure a Confluence space key in Settings.'}
                  </p>
                  <button className="btn btn-secondary w-full text-xs py-1.5" onClick={() => navigate('/settings')}>
                    Open Settings
                  </button>
                </>
              )}
            </div>

            <div className="card artifact-card flex flex-col justify-between" style={{ flex: 1 }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-purple-500/10 rounded-lg"><Send size={18} style={{ color: '#c084fc' }} /></div>
                <h2 className="text-base font-semibold">Notifications</h2>
              </div>
              <p className="text-xs text-secondary mb-3">Stakeholder summary generated for {approvedStories.length} stories ({approvedStories.reduce((a, s) => a + s.adjustedPoints, 0)} pts total).</p>
              <div className="text-xs flex items-center gap-1" style={{ color: 'var(--color-success)' }}>
                <CheckCircle size={11} /> Summary ready (SES integration requires backend)
              </div>
            </div>
          </div>
        </div>
      )}

      {phase === 'done' && (
        <div className="text-center animate-fade-in stagger-2">
          <button className="btn btn-primary px-8 py-3" onClick={() => navigate('/')}>
            Return to Dashboard
          </button>
        </div>
      )}
    </div>
  );
};
