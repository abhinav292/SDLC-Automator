import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle, Loader2, Link, FileText, CheckSquare, GitBranch, Send,
  AlertTriangle, ExternalLink, ArrowRight, Copy, Mail, GitPullRequest, X, Code2
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { createJiraEpic, createJiraStory, createJiraSubTask, createJiraQASubTask, linkJiraIssues, getJiraBaseUrl } from '../services/jiraService';
import { createBitbucketBranch, createBitbucketPR, getBitbucketBranchName } from '../services/bitbucketService';
import { createConfluencePage, getConfluenceBaseUrl } from '../services/confluenceService';
import { generatePRChecklist, generateStakeholderEmail, notifySlack, generateQATasks, generateCode, generateSolutioningDoc } from '../services/apiService';
import { fetchRepoContext } from '../services/bitbucketService';
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

const EmailModal = ({ emailContent, onClose }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const text = `Subject: ${emailContent.subject}\n\n${emailContent.body}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="card" style={{ maxWidth: 620, width: '100%', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold flex items-center gap-2">
            <Mail size={18} style={{ color: 'var(--color-primary)' }} />
            Stakeholder Summary Email
          </h3>
          <button className="btn btn-secondary p-1.5" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="p-3 bg-root border border-subtle rounded-lg mb-3">
          <span className="text-xs text-tertiary uppercase font-semibold">Subject</span>
          <p className="text-sm font-medium mt-1">{emailContent.subject}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 bg-root border border-subtle rounded-lg mb-4 text-sm text-secondary whitespace-pre-wrap leading-relaxed" style={{ minHeight: 120 }}>
          {emailContent.body}
        </div>

        <div className="flex gap-3 justify-end">
          <button className="btn btn-secondary gap-2" onClick={handleCopy}>
            <Copy size={14} /> {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
          <button className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
};

export const Handoff = () => {
  const navigate = useNavigate();
  const { stories, approvedStoryIds, settings, setJiraIssues, setBitbucketBranches, setConfluencePages, setPipelineStats, completePipeline } = useApp();
  const [phase, setPhase] = useState('idle');
  const [jiraResults, setJiraResults] = useState({});
  const [branchResults, setBranchResults] = useState({});
  const [prResults, setPrResults] = useState({});
  const [confluenceResult, setConfluenceResult] = useState(null);
  const [emailContent, setEmailContent] = useState(null);
  const [showEmailModal, setShowEmailModal] = useState(false);
  const [slackStatus, setSlackStatus] = useState(null);
  const [codeResults, setCodeResults] = useState({});
  const [expandedCodeFile, setExpandedCodeFile] = useState(null);
  const [copiedFile, setCopiedFile] = useState(null);
  const [phaseStatuses, setPhaseStatuses] = useState({
    jira: 'waiting',
    bitbucket: 'waiting',
    prchecklist: 'waiting',
    codeGen: 'waiting',
    confluence: 'waiting',
    email: 'waiting',
    notifications: 'waiting'
  });
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

    await new Promise(r => setTimeout(r, 400));

    // ── Step 1: Jira ──────────────────────────────────────────────────────────
    setPhaseStatus('jira', 'active');
    const jiraMap = {};

    // 1a. Create Epic for this pipeline run
    const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const epicName = `${settings.projectName || 'Sprint'} – ${today}`;
    const epicResult = await createJiraEpic(epicName);
    const epicKey = epicResult.success ? epicResult.key : null;

    // 1b. Create Stories linked to the Epic
    for (const story of approvedStories) {
      const result = await createJiraStory(story, epicKey);
      jiraMap[story.id] = result;
      setJiraResults(prev => ({ ...prev, [story.id]: result }));
      if (!result.success) errs.push(`Jira – ${story.title}: ${result.error}`);
    }

    // 1c. Create Dev + QA Sub-tasks for each story
    for (const story of approvedStories) {
      const storyResult = jiraMap[story.id];
      if (!storyResult?.success) continue;

      await createJiraSubTask(
        storyResult.key,
        `Dev: ${story.title}`,
        `Implement the feature as described in the parent story.\n\n${story.technicalNotes || 'Refer to story description and acceptance criteria.'}`
      );

      let testCases = [];
      try {
        const qaRes = await generateQATasks(story);
        testCases = qaRes.testCases || [];
      } catch {
        // non-fatal — QA sub-task will be created with Gherkin only
      }
      await createJiraQASubTask(storyResult.key, story, testCases);
    }

    // 1d. Link story dependencies (Blocks relationship)
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

    await new Promise(r => setTimeout(r, 400));

    // ── Step 2: Bitbucket branches ────────────────────────────────────────────
    setPhaseStatus('bitbucket', 'active');
    const branchMap = {};
    const { bbWorkspace, bbRepo, bbDefaultBranch = 'main' } = settings;

    for (const story of approvedStories) {
      const jiraKey = jiraMap[story.id]?.key || story.id.toUpperCase();
      const branchName = getBitbucketBranchName(jiraKey, story.title);
      const result = await createBitbucketBranch(bbWorkspace, bbRepo, branchName, bbDefaultBranch);
      branchMap[story.id] = { ...result, name: branchName };
      setBranchResults(prev => ({ ...prev, [story.id]: { ...result, name: branchName } }));
    }
    setBitbucketBranches(branchMap);
    setPhaseStatus('bitbucket', Object.values(branchMap).some(b => !b.success) ? 'error' : 'done');

    await new Promise(r => setTimeout(r, 300));

    // ── Step 3: PR Checklists + Pull Requests ─────────────────────────────────
    setPhaseStatus('prchecklist', 'active');
    const prMap = {};

    for (const story of approvedStories) {
      const branch = branchMap[story.id];
      const jiraKey = jiraMap[story.id]?.key;
      if (!branch?.success || !bbWorkspace || !bbRepo) {
        prMap[story.id] = { success: false, error: 'Branch not created' };
        continue;
      }

      let checklist = '';
      try {
        const clRes = await generatePRChecklist(story);
        checklist = clRes.checklist || '';
      } catch {
        // non-fatal – PR will be created without checklist
      }

      const prResult = await createBitbucketPR(
        bbWorkspace, bbRepo, branch.name, story.title, checklist, jiraKey, bbDefaultBranch
      );
      prMap[story.id] = prResult;
      setPrResults(prev => ({ ...prev, [story.id]: prResult }));
    }

    const anyPrFailed = Object.values(prMap).some(p => !p.success);
    setPhaseStatus('prchecklist', anyPrFailed ? 'error' : 'done');

    await new Promise(r => setTimeout(r, 300));

    // ── Step 4: Repo Analysis + Code Generation + Solutioning Doc ────────────
    setPhaseStatus('codeGen', 'active');
    let solutioningHtml = null;
    const codeMap = {};

    try {
      const { bbWorkspace: ws, bbRepo: repo, bbDefaultBranch: branch = 'main' } = settings;

      // Collect all story labels + titles for smart file selection
      const allLabels = [...new Set(approvedStories.flatMap(s => s.labels || []))];
      const allTitles = approvedStories.map(s => s.title).join(' ');
      const repoCtx = await fetchRepoContext(ws, repo, branch, allLabels, allTitles);

      // Generate code scaffolding per story (sequential to avoid rate limits)
      for (const story of approvedStories) {
        try {
          const result = await generateCode(story, repoCtx);
          codeMap[story.id] = result;
          setCodeResults(prev => ({ ...prev, [story.id]: result }));
        } catch {
          // non-fatal — continue without code for this story
        }
      }

      // Generate single solutioning doc covering all stories
      const docRes = await generateSolutioningDoc(approvedStories, repoCtx, settings.projectName || 'Sprint');
      solutioningHtml = docRes.html || null;
    } catch {
      // non-fatal — Confluence will fall back to basic sprint overview
    }

    setPhaseStatus('codeGen', 'done');
    await new Promise(r => setTimeout(r, 300));

    // ── Step 5: Confluence ────────────────────────────────────────────────────
    setPhaseStatus('confluence', 'active');
    const confResult = await createConfluencePage(settings.confluenceSpaceKey, 'Sprint Planning', approvedStories, solutioningHtml);
    setConfluenceResult(confResult);
    setConfluencePages([confResult]);
    setPhaseStatus('confluence', confResult.success ? 'done' : 'error');
    if (!confResult.success) errs.push(`Confluence: ${confResult.error}`);

    await new Promise(r => setTimeout(r, 300));

    // ── Step 6: Stakeholder Email ─────────────────────────────────────────────
    setPhaseStatus('email', 'active');
    try {
      const emailRes = await generateStakeholderEmail(approvedStories, settings.projectName || 'Sprint Planning');
      setEmailContent(emailRes);
      setPhaseStatus('email', 'done');
    } catch {
      setPhaseStatus('email', 'error');
    }

    await new Promise(r => setTimeout(r, 300));

    // ── Step 7: Slack / Teams notification ───────────────────────────────────
    setPhaseStatus('notifications', 'active');
    const slackWebhook = settings.slackWebhookUrl;
    if (slackWebhook) {
      const successCount = Object.values(jiraMap).filter(r => r?.success).length;
      const totalPts = approvedStories.reduce((a, s) => a + (s.adjustedPoints || 0), 0);
      const jiraLinks = Object.values(jiraMap)
        .filter(r => r?.success)
        .map(r => `<${r.url}|${r.key}>`)
        .join(', ');

      const slackMsg = {
        text: `*SDLC Autopilot* – Pipeline complete`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*Sprint pipeline complete!* :rocket:\n${successCount} stories pushed · ${totalPts} story points`
            }
          },
          ...(jiraLinks ? [{
            type: 'section',
            text: { type: 'mrkdwn', text: `*Jira tickets:* ${jiraLinks}` }
          }] : []),
          ...(confResult?.success ? [{
            type: 'section',
            text: { type: 'mrkdwn', text: `*Confluence doc:* <${confResult.url}|View Architecture Doc>` }
          }] : [])
        ]
      };

      try {
        const slkRes = await notifySlack(slackWebhook, slackMsg);
        setSlackStatus(slkRes.success ? 'sent' : 'failed');
      } catch {
        setSlackStatus('failed');
      }
    } else {
      setSlackStatus('skipped');
    }
    setPhaseStatus('notifications', 'done');

    setErrors(errs);
    setPipelineStats(prev => ({
      ...prev,
      pipelineRuns: (prev.pipelineRuns || 0) + 1,
      storiesPushed: (prev.storiesPushed || 0) + Object.values(jiraMap).filter(r => r?.success).length
    }));

    await completePipeline(jiraMap, confResult?.url || null).catch(() => {});
    setPhase('done');
  };

  const jiraSuccessCount = Object.values(jiraResults).filter(r => r?.success).length;
  const branchSuccessCount = Object.values(branchResults).filter(r => r?.success).length;
  const prSuccessCount = Object.values(prResults).filter(r => r?.success).length;
  const allJiraSuccess = Object.values(jiraResults).every(r => r?.success);

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
      {showEmailModal && emailContent && (
        <EmailModal emailContent={emailContent} onClose={() => setShowEmailModal(false)} />
      )}

      <header className="mb-8 text-center">
        {phase !== 'done' ? (
          <>
            <div className="flex justify-center mb-5">
              <Loader2 size={56} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
            </div>
            <h1 className="text-3xl font-bold mb-2">Publishing Artifacts...</h1>
            <p className="text-secondary">Creating Jira stories, Bitbucket branches, PRs, and Confluence documentation.</p>
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
              1 Epic · {jiraSuccessCount} stories · {jiraSuccessCount * 2} sub-tasks · {branchSuccessCount} branches · {prSuccessCount} PRs · {confluenceResult?.success ? '1 Confluence page' : 'Confluence skipped'}
            </p>
          </>
        )}
      </header>

      <div className="sync-progress-grid mb-8" style={{ maxWidth: 520, margin: '0 auto 2rem' }}>
        <SyncPhase label="Connecting to Atlassian toolchain" status={phaseStatuses.jira === 'waiting' ? 'waiting' : 'done'} />
        <SyncPhase label={`Creating Epic, ${approvedStories.length} stories, Dev & QA sub-tasks`} status={phaseStatuses.jira} />
        <SyncPhase label="Scaffolding Bitbucket branches" status={phaseStatuses.bitbucket} />
        <SyncPhase label="Generating PR checklists & opening pull requests" status={phaseStatuses.prchecklist} />
        <SyncPhase label="Analysing repo & generating code scaffolding + solutioning doc" status={phaseStatuses.codeGen} />
        <SyncPhase label="Publishing detailed solutioning doc to Confluence" status={phaseStatuses.confluence} />
        <SyncPhase label="Generating stakeholder summary email" status={phaseStatuses.email} />
        <SyncPhase label="Sending notifications" status={phaseStatuses.notifications} />
      </div>

      {errors.length > 0 && (
        <div className="card border-red-500/30 bg-red-900/10 mb-6" style={{ maxWidth: 800, margin: '0 auto 1.5rem' }}>
          <h4 className="flex items-center gap-2 text-error font-semibold mb-2 text-sm">
            <AlertTriangle size={16} /> Some integrations failed
          </h4>
          <ul className="list-disc pl-5 text-xs text-red-300 space-y-1">
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          <p className="text-xs text-tertiary mt-2">Check Settings to verify your credentials and configuration.</p>
        </div>
      )}

      {phase === 'done' && (
        <div className="artifacts-grid">
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

          {/* Bitbucket branches + PRs */}
          <div className="card artifact-card animate-fade-in stagger-2">
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 bg-blue-600/10 rounded-lg"><GitBranch size={22} style={{ color: '#818cf8' }} /></div>
              <h2 className="text-lg font-semibold">Branches & Pull Requests</h2>
            </div>
            {settings.bbWorkspace && settings.bbRepo ? (
              <div className="flex-col gap-2">
                {approvedStories.map(story => {
                  const branch = branchResults[story.id];
                  const pr = prResults[story.id];
                  return (
                    <div key={story.id} className="p-3 border border-subtle bg-surface-elevated rounded">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          {branch?.success
                            ? <CheckCircle size={12} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                            : <AlertTriangle size={12} style={{ color: 'var(--color-error)', flexShrink: 0 }} />}
                          <span className="text-xs text-secondary font-mono truncate">{branch?.name || 'branch-name'}</span>
                        </div>
                        {branch?.success && branch.url && (
                          <a href={branch.url} target="_blank" rel="noopener noreferrer" className="text-secondary hover:text-primary transition-colors flex-shrink-0 ml-2">
                            <ExternalLink size={12} />
                          </a>
                        )}
                      </div>
                      {pr?.success && pr.url && (
                        <div className="flex items-center gap-1 mt-1">
                          <GitPullRequest size={11} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                          <a href={pr.url} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline truncate">
                            PR #{pr.id} (with checklist)
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-center gap-2" style={{ flex: 1, minHeight: 80 }}>
                <p className="text-sm text-secondary">Configure Bitbucket workspace & repository in Settings to enable branch and PR creation.</p>
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
                  <a href={confluenceResult.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary w-full justify-between text-xs py-1.5">
                    View Architecture Doc <ExternalLink size={12} />
                  </a>
                </>
              ) : (
                <>
                  <p className="text-xs text-secondary mb-3">{confluenceResult?.error || 'Configure a Confluence space key in Settings.'}</p>
                  <button className="btn btn-secondary w-full text-xs py-1.5" onClick={() => navigate('/settings')}>Open Settings</button>
                </>
              )}
            </div>

            <div className="card artifact-card flex flex-col justify-between" style={{ flex: 1 }}>
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-purple-500/10 rounded-lg"><Send size={18} style={{ color: '#c084fc' }} /></div>
                <h2 className="text-base font-semibold">Notifications</h2>
              </div>
              <div className="flex-col gap-2">
                {emailContent ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-success)' }}>
                      <CheckCircle size={11} /> Email draft ready
                    </div>
                    <button className="btn btn-secondary text-xs py-1 px-2 gap-1" onClick={() => setShowEmailModal(true)}>
                      <Mail size={12} /> Preview
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-tertiary">Email generation unavailable.</p>
                )}
                {slackStatus === 'sent' && (
                  <div className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-success)' }}>
                    <CheckCircle size={11} /> Slack notification sent
                  </div>
                )}
                {slackStatus === 'failed' && (
                  <div className="flex items-center gap-1 text-xs text-error">
                    <AlertTriangle size={11} /> Slack notification failed
                  </div>
                )}
                {slackStatus === 'skipped' && (
                  <p className="text-xs text-tertiary">Add a Slack webhook in Settings to enable team notifications.</p>
                )}
              </div>
            </div>
          </div>

          {/* Generated Code */}
          {Object.keys(codeResults).length > 0 && (
            <div className="card artifact-card animate-fade-in stagger-3" style={{ gridColumn: '1 / -1' }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="p-2 bg-emerald-500/10 rounded-lg"><Code2 size={22} style={{ color: '#34d399' }} /></div>
                <h2 className="text-lg font-semibold">Generated Code Scaffolding</h2>
                <span className="text-xs text-tertiary ml-auto">Matches your repo's conventions · fill in TODOs to complete</span>
              </div>
              <div className="flex flex-col gap-5">
                {approvedStories.map(story => {
                  const result = codeResults[story.id];
                  if (!result?.files?.length) return null;
                  return (
                    <div key={story.id}>
                      <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-2">
                        {story.title}
                        <span className="ml-2 normal-case text-tertiary font-normal">— {result.summary}</span>
                      </p>
                      <div className="flex flex-col gap-2">
                        {result.files.map((file, fi) => {
                          const fileKey = `${story.id}-${fi}`;
                          const isExpanded = expandedCodeFile === fileKey;
                          const isCopied = copiedFile === fileKey;
                          return (
                            <div key={fi} className="border border-subtle rounded-lg overflow-hidden">
                              <div
                                className="flex items-center justify-between px-3 py-2 bg-surface-elevated cursor-pointer hover:bg-white/5 transition-colors"
                                onClick={() => setExpandedCodeFile(isExpanded ? null : fileKey)}
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="text-xs font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--color-primary)', color: '#fff', fontSize: 10 }}>
                                    {file.language}
                                  </span>
                                  <span className="text-xs font-mono text-secondary truncate">{file.path}</span>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                                  <span className="text-xs text-tertiary hidden sm:block">{file.purpose}</span>
                                  <button
                                    className="btn btn-secondary py-0.5 px-2 text-xs gap-1"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      navigator.clipboard.writeText(file.content).then(() => {
                                        setCopiedFile(fileKey);
                                        setTimeout(() => setCopiedFile(null), 2000);
                                      });
                                    }}
                                  >
                                    <Copy size={11} /> {isCopied ? 'Copied!' : 'Copy'}
                                  </button>
                                </div>
                              </div>
                              {isExpanded && (
                                <pre className="text-xs overflow-x-auto p-3 bg-root text-secondary leading-relaxed" style={{ maxHeight: 360 }}>
                                  <code>{file.content}</code>
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {phase === 'done' && (
        <div className="text-center animate-fade-in stagger-2 mt-6">
          <button className="btn btn-primary px-8 py-3" onClick={() => navigate('/')}>
            Return to Dashboard
          </button>
        </div>
      )}
    </div>
  );
};
