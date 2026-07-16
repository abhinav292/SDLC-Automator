import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon, CheckCircle, AlertTriangle, Loader2,
  ExternalLink, RefreshCw, GitBranch, FileText, CheckSquare, Bell, TrendingUp,
  FlaskConical, Workflow, Code2, Key, Cpu, Layers, Info, ShieldCheck, Mail, Search
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getJiraProjects, getJiraBaseUrl, getJiraVelocity } from '../services/jiraService';
import { getConfluenceSpaces } from '../services/confluenceService';
import { getBitbucketWorkspaces, getBitbucketRepos, getBitbucketBranches } from '../services/bitbucketService';
import { getGithubRepos, getGithubBranches } from '../services/githubService';
import { getGitlabProjects, getGitlabBranches } from '../services/gitlabService';
import { diagnoseJiraWrite } from '../services/apiService';
import './Settings.css';

// ── AI provider registry — drives the AI tab so adding a provider is a one-liner ──
const AI_PROVIDER_CONFIG = {
  openrouter: {
    label: 'OpenRouter', keyField: 'aiToken', hasKeyFlag: 'hasOpenRouterKey',
    placeholder: 'sk-or-...', searchable: true,
    hint: 'One key, 300+ models across providers.',
    models: [
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash (Recommended)' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' }
    ]
  },
  anthropic: {
    label: 'Anthropic', keyField: 'anthropicKey', hasKeyFlag: 'hasAnthropicKey',
    placeholder: 'sk-ant-...', hint: 'Direct Anthropic API (Claude models).',
    models: [
      { id: 'claude-3-5-sonnet-latest', name: 'Claude 3.5 Sonnet' },
      { id: 'claude-3-5-haiku-latest', name: 'Claude 3.5 Haiku' },
      { id: 'claude-3-opus-latest', name: 'Claude 3 Opus' }
    ]
  },
  openai: {
    label: 'OpenAI', keyField: 'openaiKey', hasKeyFlag: 'hasOpenAIKey',
    placeholder: 'sk-...', hint: 'Direct OpenAI API (GPT models).',
    models: [
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
      { id: 'o1-mini', name: 'o1-mini' }
    ]
  },
  gemini: {
    label: 'Google Gemini', keyField: 'geminiKey', hasKeyFlag: 'hasGeminiKey',
    placeholder: 'AIza...', hint: 'Direct Google AI Studio API (Gemini models).',
    models: [
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' }
    ]
  },
  bedrock: {
    label: 'Amazon Bedrock', keyField: 'bedrockApiKey', hasKeyFlag: 'hasBedrockKey',
    placeholder: 'Bedrock API key...', needsRegion: true,
    hint: 'AWS-hosted models via Bedrock.',
    models: [
      { id: 'anthropic.claude-3-5-sonnet-20240620-v1:0', name: 'Claude 3.5 Sonnet' },
      { id: 'anthropic.claude-3-sonnet-20240229-v1:0', name: 'Claude 3 Sonnet' },
      { id: 'anthropic.claude-3-haiku-20240307-v1:0', name: 'Claude 3 Haiku' },
      { id: 'amazon.titan-text-express-v1', name: 'Amazon Titan' }
    ]
  }
};

const GIT_PROVIDER_META = {
  bitbucket: { label: 'Bitbucket', tokenHint: "Requires 'Pull requests' & 'Repositories' write scopes." },
  github: { label: 'GitHub', tokenHint: "Fine-grained or classic PAT with 'repo' (Contents + Pull requests) scope." },
  gitlab: { label: 'GitLab', tokenHint: "Personal access token with 'api' scope." }
};

const DOMAIN = typeof __ATLASSIAN_DOMAIN__ !== 'undefined' ? __ATLASSIAN_DOMAIN__ : '';
const EMAIL = typeof __ATLASSIAN_EMAIL__ !== 'undefined' ? __ATLASSIAN_EMAIL__ : '';
const JIRA_KEY = typeof __JIRA_PROJECT_KEY__ !== 'undefined' ? __JIRA_PROJECT_KEY__ : 'KAN';

const StatusBadge = ({ status, label }) => {
  const iconMap = {
    checking: <Loader2 size={12} className="animate-spin" />,
    ok: <CheckCircle size={12} />,
    error: <AlertTriangle size={12} />,
    idle: <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'currentColor' }} />
  };

  return (
    <div className={`status-badge ${status}`}>
      {iconMap[status]}
      <span>{label || (status === 'ok' ? 'Connected' : status === 'error' ? 'Connection Failed' : status)}</span>
    </div>
  );
};

export const Settings = () => {
  const { settings, saveSettings } = useApp();
  const [activeTab, setActiveTab] = useState('integrations');
  const [jiraStatus, setJiraStatus] = useState('idle');
  const [jiraError, setJiraError] = useState(null);
  const [confluenceStatus, setConfluenceStatus] = useState('idle');
  const [confluenceError, setConfluenceError] = useState(null);
  const [bitbucketStatus, setBitbucketStatus] = useState('idle');
  const [bitbucketError, setBitbucketError] = useState(null);
  const [jiraProjects, setJiraProjects] = useState([]);
  const [confluenceSpaces, setConfluenceSpaces] = useState([]);
  const [bbWorkspaces, setBbWorkspaces] = useState([]);
  const [bbRepos, setBbRepos] = useState([]);
  const [bbBranches, setBbBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [availableModels, setAvailableModels] = useState([]);
  const [isSyncingModels, setIsSyncingModels] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [syncStatus, setSyncStatus] = useState(null); // 'ok', 'error', or null
  const [isManualModel, setIsManualModel] = useState(false);
  const [velocityData, setVelocityData] = useState(null);
  const [velocityLoading, setVelocityLoading] = useState(false);
  const [jiraDiagnosing, setJiraDiagnosing] = useState(false);
  const [jiraDiagResult, setJiraDiagResult] = useState(null);
  const [form, setForm] = useState({
    // Git — provider + per-provider repo identity
    gitProvider: settings.gitProvider || 'bitbucket',
    bbWorkspace: settings.bbWorkspace || '',
    bbRepo: settings.bbRepo || '',
    bbDefaultBranch: settings.bbDefaultBranch || 'master',
    ghOwner: settings.ghOwner || '',
    ghRepo: settings.ghRepo || '',
    ghDefaultBranch: settings.ghDefaultBranch || 'main',
    glProject: settings.glProject || '',
    glDefaultBranch: settings.glDefaultBranch || 'main',
    confluenceSpaceKey: settings.confluenceSpaceKey || '',
    slackWebhookUrl: settings.slackWebhookUrl || '',
    projectName: settings.projectName || '',
    aiModel: settings.aiModel || 'anthropic.claude-3-sonnet-20240229-v1:0',
    aiProvider: settings.aiProvider || 'bedrock',
    awsRegion: settings.awsRegion || 'ap-south-1'
  });
  const [saved, setSaved] = useState(false);
  const [atlassianToken, setAtlassianToken] = useState('');
  const [bitbucketToken, setBitbucketToken] = useState('');
  const [aiToken, setAiToken] = useState('');
  const [bedrockApiKey, setBedrockApiKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [openaiKey, setOpenaiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [gitlabToken, setGitlabToken] = useState('');
  const [aiConfig, setAiConfig] = useState(null);
  // GitHub / GitLab repo discovery
  const [ghRepos, setGhRepos] = useState([]);
  const [glProjects, setGlProjects] = useState([]);
  const [ghBranches, setGhBranches] = useState([]);
  const [glBranches, setGlBranches] = useState([]);
  const [gitLoading, setGitLoading] = useState(false);
  const [gitError, setGitError] = useState(null);

  // Map an AI key field name → its state value/setter so the config map can drive the form
  const aiKeyState = {
    aiToken: [aiToken, setAiToken],
    anthropicKey: [anthropicKey, setAnthropicKey],
    openaiKey: [openaiKey, setOpenaiKey],
    geminiKey: [geminiKey, setGeminiKey],
    bedrockApiKey: [bedrockApiKey, setBedrockApiKey]
  };

  useEffect(() => {
    testConnections();
    // Load AI + Git config from the backend (key presence + current provider/model)
    fetch('/api/backend/ai-config')
      .then(r => r.ok ? r.json() : null)
      .then(cfg => {
        if (!cfg) return;
        setAiConfig(cfg);
        setForm(f => ({
          ...f,
          aiProvider: settings.aiProvider || cfg.provider || f.aiProvider,
          aiModel: settings.aiModel || cfg.model || f.aiModel,
          gitProvider: settings.gitProvider || cfg.gitProvider || f.gitProvider
        }));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (form.bbWorkspace) loadBbRepos(form.bbWorkspace);
  }, [form.bbWorkspace]);

  useEffect(() => {
    if (form.bbWorkspace && form.bbRepo) loadBbBranches(form.bbWorkspace, form.bbRepo);
  }, [form.bbWorkspace, form.bbRepo]);

  useEffect(() => {
    if (activeTab === 'ai' && form.aiProvider === 'openrouter' && availableModels.length === 0 && !isSyncingModels) {
      fetchOpenRouterModels();
    }
  }, [activeTab, form.aiProvider]);

  const onAiProviderChange = (provider) => {
    const cfg = AI_PROVIDER_CONFIG[provider];
    setForm(f => ({ ...f, aiProvider: provider, aiModel: cfg?.models?.[0]?.id || f.aiModel }));
  };

  const loadGithubRepos = async () => {
    setGitLoading(true); setGitError(null);
    const { repos, error } = await getGithubRepos();
    setGhRepos(repos || []);
    if (error) setGitError(error);
    setGitLoading(false);
  };
  const loadGithubBranchList = async () => {
    if (!form.ghOwner || !form.ghRepo) return;
    setGhBranches(await getGithubBranches(form.ghOwner, form.ghRepo));
  };
  const loadGitlabProjectList = async () => {
    setGitLoading(true); setGitError(null);
    const { projects, error } = await getGitlabProjects();
    setGlProjects(projects || []);
    if (error) setGitError(error);
    setGitLoading(false);
  };
  const loadGitlabBranchList = async () => {
    if (!form.glProject) return;
    setGlBranches(await getGitlabBranches(form.glProject));
  };

  const testConnections = () => {
    testJira();
    testConfluence();
    testBitbucket();
  };

  const testJira = async () => {
    setJiraStatus('checking');
    setJiraError(null);
    const { projects, error } = await getJiraProjects();
    setJiraProjects((projects || []).slice(0, 8));
    if (error) { setJiraStatus('error'); setJiraError(error); }
    else if (!projects || projects.length === 0) { setJiraStatus('error'); setJiraError('No projects returned — check your API token.'); }
    else setJiraStatus('ok');
  };

  const testConfluence = async () => {
    setConfluenceStatus('checking');
    setConfluenceError(null);
    const { spaces, error } = await getConfluenceSpaces();
    setConfluenceSpaces((spaces || []).slice(0, 8));
    if (error) { setConfluenceStatus('error'); setConfluenceError(error); }
    else if (!spaces || spaces.length === 0) { setConfluenceStatus('error'); setConfluenceError('No spaces returned.'); }
    else setConfluenceStatus('ok');
  };

  const testBitbucket = async () => {
    setBitbucketStatus('checking');
    setBitbucketError(null);
    const { workspaces, error } = await getBitbucketWorkspaces();
    setBbWorkspaces(workspaces || []);
    if (error) { setBitbucketStatus('error'); setBitbucketError(error); }
    else if (!workspaces || workspaces.length === 0) { setBitbucketStatus('error'); setBitbucketError('No workspaces found.'); }
    else setBitbucketStatus('ok');
  };

  const runJiraDiagnose = async () => {
    setJiraDiagnosing(true);
    setJiraDiagResult(null);
    try {
      const result = await diagnoseJiraWrite();
      setJiraDiagResult(result);
    } catch (err) {
      setJiraDiagResult({ success: false, error: err.message });
    }
    setJiraDiagnosing(false);
  };

  const loadBbRepos = async (workspace) => {
    const repos = await getBitbucketRepos(workspace);
    setBbRepos(repos);
  };

  const loadBbBranches = async (workspace, repo) => {
    setLoadingBranches(true);
    const branches = await getBitbucketBranches(workspace, repo);
    setBbBranches(branches);
    
    // Auto-populate default branch from repo object if it exists in the repo list
    const selectedRepo = bbRepos.find(r => r.slug === repo);
    if (selectedRepo && selectedRepo.mainbranch?.name) {
      setForm(f => ({ ...f, bbDefaultBranch: selectedRepo.mainbranch.name }));
    }
    setLoadingBranches(false);
  };

  const loadVelocity = async () => {
    setVelocityLoading(true);
    const data = await getJiraVelocity(JIRA_KEY, 30);
    setVelocityData(data);
    setVelocityLoading(false);
  };

  const fetchOpenRouterModels = async () => {
    setIsSyncingModels(true);
    setSyncStatus(null);
    try {
      // Endpoint is proxied via vite to BACKEND at 3001
      const res = await fetch('/api/backend/openrouter-models');
      if (res.ok) {
        const data = await res.json();
        setAvailableModels(data || []);
        setSyncStatus('ok');
      } else {
        const errData = await res.json();
        setSyncStatus(errData.error || 'Failed to sync');
      }
    } catch (err) {
      console.error('Failed to sync models:', err);
      setSyncStatus('Connection error. Check backend.');
    }
    setIsSyncingModels(false);
  };

  const handleSave = async () => {
    saveSettings(form);

    const payload = {
      atlassianToken: atlassianToken || undefined,
      bitbucketToken: bitbucketToken || undefined,
      aiToken: aiToken || undefined,
      bedrockApiKey: bedrockApiKey || undefined,
      anthropicKey: anthropicKey || undefined,
      openaiKey: openaiKey || undefined,
      geminiKey: geminiKey || undefined,
      githubToken: githubToken || undefined,
      gitlabToken: gitlabToken || undefined,
      aiModel: form.aiModel,
      aiProvider: form.aiProvider,
      awsRegion: form.awsRegion,
      gitProvider: form.gitProvider
    };

    try {
      await fetch('/api/backend/update-env', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      // Clear entered secrets from memory once persisted
      setAtlassianToken(''); setBitbucketToken(''); setAiToken(''); setBedrockApiKey('');
      setAnthropicKey(''); setOpenaiKey(''); setGeminiKey(''); setGithubToken(''); setGitlabToken('');
      // Refresh the key-presence badges
      fetch('/api/backend/ai-config').then(r => r.ok ? r.json() : null).then(cfg => cfg && setAiConfig(cfg)).catch(() => {});
    } catch (err) {
      console.error('Failed to update environment:', err);
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const menuItems = [
    { id: 'integrations', label: 'Integrations', icon: <Workflow size={18} />, description: 'Jira & Confluence' },
    { id: 'git', label: 'Git & Sync', icon: <Code2 size={18} />, description: 'Bitbucket repository' },
    { id: 'ai', label: 'AI Platform', icon: <Cpu size={18} />, description: 'Model configuration' },
    { id: 'advanced', label: 'Advanced', icon: <Layers size={18} />, description: 'Calibration & Alerts' },
  ];

  const renderIntegrations = () => (
    <div className="settings-tab-content">
      <div className="settings-section-header">
        <h2>Atlassian Services</h2>
        <p>Manage connection status for Jira and Confluence Cloud.</p>
      </div>

      {/* Jira Card */}
      <div className="settings-card">
        <div className="status-header">
          <div className="flex items-center gap-3">
            <CheckSquare size={20} className="text-blue-400" />
            <h3 className="font-bold text-lg">Jira Cloud</h3>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={jiraStatus} />
            <button className="btn btn-secondary text-xs px-2 py-1" onClick={testJira}>
              <RefreshCw size={12} className={jiraStatus === 'checking' ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          <div className="input-group">
            <label className="input-label">Domain <Info size={12} className="info-icon" title="Set via ATLASSIAN_DOMAIN" /></label>
            <input className="input-field opacity-60 pointer-events-none" value={DOMAIN} readOnly />
          </div>
          <div className="input-group">
            <label className="input-label">Email <Info size={12} className="info-icon" title="Set via ATLASSIAN_EMAIL" /></label>
            <input className="input-field opacity-60 pointer-events-none" value={EMAIL} readOnly />
          </div>
        </div>

        <div className="input-group">
          <label className="input-label">API Token <ShieldCheck size={12} /></label>
          <input 
            type="password" 
            className="input-field font-mono" 
            placeholder={atlassianToken ? "••••••••••••" : "Type to replace current token..."}
            value={atlassianToken}
            onChange={e => setAtlassianToken(e.target.value)}
          />
          <p className="input-hint">Used for Jira and Confluence authentication.</p>
        </div>

        {jiraStatus === 'ok' && (
          <div className="mt-4 p-4 rounded-xl bg-blue-500/5 border border-blue-500/10">
            <p className="text-sm font-medium mb-3 flex items-center justify-between">
              Connected Project: <span className="text-blue-400 font-mono">{JIRA_KEY}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {jiraProjects.map(p => (
                <span key={p.id} className={`badge text-[10px] px-2 py-0.5 ${p.key === JIRA_KEY ? 'badge-info' : 'badge-neutral opacity-50'}`}>
                  {p.key}
                </span>
              ))}
            </div>
            <a href={`${getJiraBaseUrl()}/browse/${JIRA_KEY}`} target="_blank" rel="noopener noreferrer" className="mt-4 text-xs text-blue-400 flex items-center gap-1 hover:underline">
              View in Jira <ExternalLink size={12} />
            </a>
          </div>
        )}
      </div>

      {/* Confluence Card */}
      <div className="settings-card">
        <div className="status-header">
          <div className="flex items-center gap-3">
            <FileText size={20} className="text-purple-400" />
            <h3 className="font-bold text-lg">Confluence</h3>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={confluenceStatus} />
            <button className="btn btn-secondary text-xs px-2 py-1" onClick={testConfluence}>
              <RefreshCw size={12} className={confluenceStatus === 'checking' ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="input-group">
          <label className="input-label">Target Space Key</label>
          <input 
            className="input-field" 
            placeholder="e.g. ENG or PRODUCT"
            value={form.confluenceSpaceKey}
            onChange={e => setForm(f => ({ ...f, confluenceSpaceKey: e.target.value }))}
          />
          <p className="input-hint">The space where Technical Solutioning docs will be published.</p>
        </div>

        {confluenceStatus === 'ok' && confluenceSpaces.length > 0 && (
          <div className="mt-2">
            <p className="text-[10px] uppercase font-bold text-tertiary mb-2">Available Spaces</p>
            <div className="flex flex-wrap gap-2">
              {confluenceSpaces.map(s => (
                <button
                  key={s.key}
                  className={`badge text-[10px] cursor-pointer hover:border-purple-500/50 transition-colors ${form.confluenceSpaceKey === s.key ? 'badge-info' : 'badge-neutral'}`}
                  onClick={() => setForm(f => ({ ...f, confluenceSpaceKey: s.key }))}
                >
                  {s.key}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderGit = () => {
    const provider = form.gitProvider;
    const meta = GIT_PROVIDER_META[provider] || GIT_PROVIDER_META.bitbucket;
    const crWord = provider === 'gitlab' ? 'merge requests' : 'pull requests';

    return (
      <div className="settings-tab-content">
        <div className="settings-section-header">
          <h2>Source Control</h2>
          <p>Where branches, commits, and {crWord} are created.</p>
        </div>

        <div className="settings-card">
          <div className="status-header">
            <div className="flex items-center gap-3">
              <GitBranch size={20} className="text-indigo-400" />
              <h3 className="font-bold text-lg">Git Provider</h3>
            </div>
            {provider === 'bitbucket' && <StatusBadge status={bitbucketStatus} />}
          </div>

          {/* Provider selector */}
          <div className="input-group">
            <label className="input-label">Provider</label>
            <div className="provider-grid">
              {Object.entries(GIT_PROVIDER_META).map(([id, m]) => {
                const connected = { bitbucket: aiConfig?.hasBitbucketToken, github: aiConfig?.hasGithubToken, gitlab: aiConfig?.hasGitlabToken }[id];
                return (
                  <button key={id} type="button" className={`provider-chip ${provider === id ? 'active' : ''}`} onClick={() => setForm(f => ({ ...f, gitProvider: id }))}>
                    {connected && <span className="provider-chip-dot" />}
                    {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Token */}
          <div className="input-group">
            <label className="input-label">{meta.label} Token <Key size={12} /></label>
            {provider === 'bitbucket' && (
              <input type="password" className="input-field font-mono" placeholder={aiConfig?.hasBitbucketToken ? '•••••••••• (set — type to replace)' : 'Bitbucket app password / token...'} value={bitbucketToken} onChange={e => setBitbucketToken(e.target.value)} />
            )}
            {provider === 'github' && (
              <input type="password" className="input-field font-mono" placeholder={aiConfig?.hasGithubToken ? '•••••••••• (set — type to replace)' : 'ghp_... / github_pat_...'} value={githubToken} onChange={e => setGithubToken(e.target.value)} />
            )}
            {provider === 'gitlab' && (
              <input type="password" className="input-field font-mono" placeholder={aiConfig?.hasGitlabToken ? '•••••••••• (set — type to replace)' : 'glpat-...'} value={gitlabToken} onChange={e => setGitlabToken(e.target.value)} />
            )}
            <p className="input-hint">{meta.tokenHint}</p>
          </div>

          {gitError && <p className="input-hint" style={{ color: 'var(--color-error)' }}>{gitError}</p>}

          {/* ── Bitbucket repo identity ── */}
          {provider === 'bitbucket' && (
            <>
              <div className="grid grid-cols-2 gap-6 mb-4">
                <div className="input-group mb-0">
                  <label className="input-label">Workspace</label>
                  {bbWorkspaces.length > 0 ? (
                    <select className="input-field" value={form.bbWorkspace} onChange={e => setForm(f => ({ ...f, bbWorkspace: e.target.value, bbRepo: '' }))}>
                      <option value="">Select Workspace</option>
                      {bbWorkspaces.map(w => <option key={w.slug} value={w.slug}>{w.name || w.slug}</option>)}
                    </select>
                  ) : (
                    <input className="input-field" value={form.bbWorkspace} onChange={e => setForm(f => ({ ...f, bbWorkspace: e.target.value }))} />
                  )}
                </div>
                <div className="input-group mb-0">
                  <label className="input-label">Repository</label>
                  {bbRepos.length > 0 ? (
                    <select className="input-field" value={form.bbRepo} onChange={e => {
                      const repoSlug = e.target.value;
                      setForm(f => ({ ...f, bbRepo: repoSlug }));
                      const selected = bbRepos.find(r => r.slug === repoSlug);
                      if (selected?.mainbranch?.name) setForm(f => ({ ...f, bbDefaultBranch: selected.mainbranch.name }));
                    }}>
                      <option value="">Select Repository</option>
                      {bbRepos.map(r => <option key={r.slug} value={r.slug}>{r.name || r.slug}</option>)}
                    </select>
                  ) : (
                    <input className="input-field" value={form.bbRepo} onChange={e => setForm(f => ({ ...f, bbRepo: e.target.value }))} />
                  )}
                </div>
              </div>
              <div className="input-group">
                <label className="input-label">Default Branch {loadingBranches && <Loader2 size={10} className="animate-spin ml-2 inline" />}</label>
                <div className="flex gap-2">
                  {bbBranches.length > 0 ? (
                    <select className="input-field max-w-[220px]" value={form.bbDefaultBranch} onChange={e => setForm(f => ({ ...f, bbDefaultBranch: e.target.value }))}>
                      <option value="">Select branch...</option>
                      {bbBranches.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  ) : (
                    <input className="input-field max-w-[220px]" placeholder="master" value={form.bbDefaultBranch} onChange={e => setForm(f => ({ ...f, bbDefaultBranch: e.target.value }))} />
                  )}
                  <button className="btn btn-secondary text-xs px-2 py-1" title="Refresh branches" onClick={() => loadBbBranches(form.bbWorkspace, form.bbRepo)} disabled={!form.bbWorkspace || !form.bbRepo || loadingBranches}>
                    <RefreshCw size={12} className={loadingBranches ? 'animate-spin' : ''} />
                  </button>
                </div>
                <p className="input-hint">Feature branches will be cut from this branch.</p>
              </div>
            </>
          )}

          {/* ── GitHub repo identity ── */}
          {provider === 'github' && (
            <>
              <div className="grid grid-cols-2 gap-6 mb-3">
                <div className="input-group mb-0">
                  <label className="input-label">Owner / Org</label>
                  <input className="input-field" placeholder="e.g. acme-inc" value={form.ghOwner} onChange={e => setForm(f => ({ ...f, ghOwner: e.target.value }))} />
                </div>
                <div className="input-group mb-0">
                  <label className="input-label">Repository</label>
                  <input className="input-field" placeholder="e.g. web-app" value={form.ghRepo} onChange={e => setForm(f => ({ ...f, ghRepo: e.target.value }))} />
                </div>
              </div>
              <div className="flex items-center gap-2 mb-4">
                <button className="btn btn-secondary text-xs px-3 py-1.5" onClick={loadGithubRepos} disabled={gitLoading}>
                  {gitLoading ? <Loader2 size={13} className="animate-spin mr-1" /> : <RefreshCw size={13} className="mr-1" />} Load repositories
                </button>
                {ghRepos.length > 0 && (
                  <select className="input-field flex-1" value={form.ghOwner && form.ghRepo ? `${form.ghOwner}/${form.ghRepo}` : ''} onChange={e => {
                    const r = ghRepos.find(x => `${x.owner}/${x.name}` === e.target.value);
                    if (r) setForm(f => ({ ...f, ghOwner: r.owner, ghRepo: r.name, ghDefaultBranch: r.defaultBranch || f.ghDefaultBranch }));
                  }}>
                    <option value="">Select a repository…</option>
                    {ghRepos.map(r => <option key={r.fullName} value={`${r.owner}/${r.name}`}>{r.fullName}</option>)}
                  </select>
                )}
              </div>
              <div className="input-group">
                <label className="input-label">Default Branch</label>
                <div className="flex gap-2">
                  {ghBranches.length > 0 ? (
                    <select className="input-field max-w-[220px]" value={form.ghDefaultBranch} onChange={e => setForm(f => ({ ...f, ghDefaultBranch: e.target.value }))}>
                      {ghBranches.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  ) : (
                    <input className="input-field max-w-[220px]" placeholder="main" value={form.ghDefaultBranch} onChange={e => setForm(f => ({ ...f, ghDefaultBranch: e.target.value }))} />
                  )}
                  <button className="btn btn-secondary text-xs px-2 py-1" title="Load branches" onClick={loadGithubBranchList} disabled={!form.ghOwner || !form.ghRepo}><RefreshCw size={12} /></button>
                </div>
                <p className="input-hint">Feature branches will be cut from this branch.</p>
              </div>
            </>
          )}

          {/* ── GitLab repo identity ── */}
          {provider === 'gitlab' && (
            <>
              <div className="input-group">
                <label className="input-label">Project (ID or path)</label>
                <input className="input-field" placeholder="e.g. 12345678 or group/subgroup/project" value={form.glProject} onChange={e => setForm(f => ({ ...f, glProject: e.target.value }))} />
                <p className="input-hint">Numeric project ID or the full namespace path.</p>
              </div>
              <div className="flex items-center gap-2 mb-4">
                <button className="btn btn-secondary text-xs px-3 py-1.5" onClick={loadGitlabProjectList} disabled={gitLoading}>
                  {gitLoading ? <Loader2 size={13} className="animate-spin mr-1" /> : <RefreshCw size={13} className="mr-1" />} Load projects
                </button>
                {glProjects.length > 0 && (
                  <select className="input-field flex-1" value={String(form.glProject)} onChange={e => {
                    const p = glProjects.find(x => String(x.id) === e.target.value);
                    if (p) setForm(f => ({ ...f, glProject: String(p.id), glDefaultBranch: p.defaultBranch || f.glDefaultBranch }));
                  }}>
                    <option value="">Select a project…</option>
                    {glProjects.map(p => <option key={p.id} value={String(p.id)}>{p.name}</option>)}
                  </select>
                )}
              </div>
              <div className="input-group">
                <label className="input-label">Default Branch</label>
                <div className="flex gap-2">
                  {glBranches.length > 0 ? (
                    <select className="input-field max-w-[220px]" value={form.glDefaultBranch} onChange={e => setForm(f => ({ ...f, glDefaultBranch: e.target.value }))}>
                      {glBranches.map(b => <option key={b} value={b}>{b}</option>)}
                    </select>
                  ) : (
                    <input className="input-field max-w-[220px]" placeholder="main" value={form.glDefaultBranch} onChange={e => setForm(f => ({ ...f, glDefaultBranch: e.target.value }))} />
                  )}
                  <button className="btn btn-secondary text-xs px-2 py-1" title="Load branches" onClick={loadGitlabBranchList} disabled={!form.glProject}><RefreshCw size={12} /></button>
                </div>
                <p className="input-hint">Feature branches will be cut from this branch.</p>
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderAI = () => {
    const cfg = AI_PROVIDER_CONFIG[form.aiProvider] || AI_PROVIDER_CONFIG.bedrock;
    const [keyVal, setKeyVal] = aiKeyState[cfg.keyField] || [];
    const hasKey = aiConfig?.[cfg.hasKeyFlag];

    return (
      <div className="settings-tab-content">
        <div className="settings-section-header">
          <h2>AI Engine</h2>
          <p>Choose a provider and model for story extraction, PRD drafting, QA, and code generation.</p>
        </div>

        <div className="settings-card border-indigo-500/20 bg-indigo-500/[0.02]">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Cpu size={24} className="text-indigo-400" />
              <h3 className="font-bold text-lg">Model Configuration</h3>
            </div>
            {hasKey !== undefined && <StatusBadge status={hasKey ? 'ok' : 'idle'} label={hasKey ? 'Key set' : 'No key'} />}
          </div>

          {/* Provider selector */}
          <div className="input-group">
            <label className="input-label">AI Provider</label>
            <div className="provider-grid">
              {Object.entries(AI_PROVIDER_CONFIG).map(([id, p]) => (
                <button key={id} type="button" className={`provider-chip ${form.aiProvider === id ? 'active' : ''}`} onClick={() => onAiProviderChange(id)}>
                  {aiConfig?.[p.hasKeyFlag] && <span className="provider-chip-dot" />}
                  {p.label}
                </button>
              ))}
            </div>
            <p className="input-hint">{cfg.hint}</p>
          </div>

          {/* API key */}
          <div className="input-group">
            <label className="input-label">{cfg.label} API Key <Key size={12} className="ml-1 opacity-50" /></label>
            <input
              type="password"
              className="input-field font-mono"
              placeholder={hasKey ? '•••••••••• (set — type to replace)' : cfg.placeholder}
              value={keyVal || ''}
              onChange={e => setKeyVal?.(e.target.value)}
            />
            <p className="input-hint">Stored server-side in .env — used for all AI processing.</p>
          </div>

          {/* Region (Bedrock only) */}
          {cfg.needsRegion && (
            <div className="input-group">
              <label className="input-label">AWS Region</label>
              <input className="input-field" placeholder="e.g. ap-south-1" value={form.awsRegion} onChange={e => setForm(f => ({ ...f, awsRegion: e.target.value }))} />
            </div>
          )}

          {/* Model selection */}
          <div className="input-group">
            <div className="flex items-center justify-between mb-1">
              <label className="input-label mb-0">Model</label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" className="w-4 h-4" checked={isManualModel} onChange={e => setIsManualModel(e.target.checked)} />
                <span className="text-[10px] uppercase font-bold text-tertiary">Custom model ID</span>
              </label>
            </div>

            {isManualModel ? (
              <input className="input-field font-mono mt-2" placeholder="exact model id" value={form.aiModel} onChange={e => setForm(f => ({ ...f, aiModel: e.target.value }))} />
            ) : cfg.searchable ? (
              <>
                <div className="flex items-center gap-2 mt-2 mb-3">
                  <div className="relative flex-1">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-tertiary pointer-events-none" />
                    <input className="input-field pl-10" placeholder="Search models (claude, gpt, llama)..." value={modelSearch} onChange={e => setModelSearch(e.target.value)} />
                  </div>
                  <button className="btn btn-secondary text-xs px-3" onClick={fetchOpenRouterModels} disabled={isSyncingModels} title="Sync models from OpenRouter">
                    <RefreshCw size={16} className={isSyncingModels ? 'animate-spin' : ''} />
                  </button>
                </div>
                <select className="input-field" value={form.aiModel} onChange={e => setForm(f => ({ ...f, aiModel: e.target.value }))}>
                  <optgroup label="Common">
                    {cfg.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                  </optgroup>
                  {availableModels.length > 0 && (
                    <optgroup label={`Synced (${availableModels.length})`}>
                      {availableModels
                        .filter(m => { const q = modelSearch.toLowerCase(); return m.id.toLowerCase().includes(q) || (m.name && m.name.toLowerCase().includes(q)); })
                        .map(m => <option key={m.id} value={m.id}>{m.name || m.id}</option>)}
                    </optgroup>
                  )}
                </select>
                {syncStatus && syncStatus !== 'ok' && <p className="input-hint" style={{ color: 'var(--color-error)' }}>{syncStatus}</p>}
              </>
            ) : (
              <select className="input-field mt-2" value={form.aiModel} onChange={e => setForm(f => ({ ...f, aiModel: e.target.value }))}>
                <optgroup label={`${cfg.label} Models`}>
                  {cfg.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </optgroup>
                {!cfg.models.some(m => m.id === form.aiModel) && form.aiModel && (
                  <optgroup label="Current"><option value={form.aiModel}>{form.aiModel}</option></optgroup>
                )}
              </select>
            )}
          </div>

          <div className="p-4 rounded-xl border border-indigo-500/10 bg-indigo-500/5">
            <div className="flex items-start gap-3">
              <ShieldCheck size={18} className="text-indigo-400 flex-shrink-0 mt-0.5" />
              <div style={{ minWidth: 0 }}>
                <p className="text-sm font-semibold text-indigo-200 truncate">{cfg.label} · {form.aiModel}</p>
                <p className="text-xs text-tertiary mt-1">Handles extraction, PRD drafting, QA test cases, and code scaffolding.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderAdvanced = () => (
    <div className="settings-tab-content">
      <div className="settings-section-header">
        <h2>Advanced & Tools</h2>
        <p>Diagnostics, alerts, and historical data calibration.</p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        {/* Notifications */}
        <div className="settings-card">
          <div className="flex items-center gap-3 mb-6">
            <Bell size={20} className="text-orange-400" />
            <h3 className="font-bold text-lg">Alerts & Notifications</h3>
          </div>

          <div className="input-group">
            <label className="input-label">Project Identifier</label>
            <input 
              className="input-field" 
              placeholder="e.g. Payments MVP"
              value={form.projectName} 
              onChange={e => setForm(f => ({ ...f, projectName: e.target.value }))}
            />
          </div>

          <div className="input-group">
            <label className="input-label">Webhook URL <Mail size={12} className="ml-1 opacity-50" /></label>
            <input 
              className="input-field" 
              placeholder="Slack, Teams, or Discord URL"
              value={form.slackWebhookUrl} 
              onChange={e => setForm(f => ({ ...f, slackWebhookUrl: e.target.value }))}
            />
            <p className="input-hint">Receives a deep-link summary when a pipeline sync completes.</p>
          </div>
        </div>

        {/* Calibration */}
        <div className="settings-card">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <TrendingUp size={20} className="text-emerald-400" />
              <h3 className="font-bold text-lg">Team Velocity</h3>
            </div>
            <button className="btn btn-secondary text-xs px-3 py-1.5" onClick={loadVelocity} disabled={velocityLoading}>
              {velocityLoading ? <RefreshCw size={13} className="animate-spin mr-2" /> : <TrendingUp size={13} className="mr-2" />}
              Fetch History
            </button>
          </div>

          <p className="text-sm text-secondary mb-6">Calibrates AI story points based on last 30 days of Jira history.</p>

          {velocityData && (
            <div className="grid grid-cols-3 gap-4">
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-center">
                <p className="text-2xl font-bold text-emerald-400">{velocityData.average || '—'}</p>
                <p className="text-[10px] uppercase font-bold text-tertiary mt-1">Avg Points</p>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-center">
                <p className="text-2xl font-bold text-emerald-400">{velocityData.count}</p>
                <p className="text-[10px] uppercase font-bold text-tertiary mt-1">Sample Size</p>
              </div>
              <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-center">
                <p className="text-2xl font-bold text-indigo-400">{velocityData.total}</p>
                <p className="text-[10px] uppercase font-bold text-tertiary mt-1">Total Issues</p>
              </div>
            </div>
          )}
        </div>

        {/* Diagnostics */}
        <div className="settings-card border-red-500/10">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-3">
              <FlaskConical size={20} className="text-red-400" />
              <h3 className="font-bold text-lg">Jira Diagnostics</h3>
            </div>
            <button className="btn btn-secondary text-xs px-3 py-1.5" onClick={runJiraDiagnose} disabled={jiraDiagnosing}>
              {jiraDiagnosing ? <Loader2 size={13} className="animate-spin mr-2" /> : <CheckCircle size={13} className="mr-2" />}
              Test Write
            </button>
          </div>
          <p className="text-xs text-tertiary">Creates and deletes a test issue to verify Write permissions and Custom Field structure.</p>
          {jiraDiagResult && (
            <div className={`mt-4 p-3 rounded-lg text-xs ${jiraDiagResult.success ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
              {jiraDiagResult.success ? '✓ Jira write permissions confirmed.' : `✗ ${jiraDiagResult.error}`}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const getTabContent = () => {
    switch (activeTab) {
      case 'integrations': return renderIntegrations();
      case 'git': return renderGit();
      case 'ai': return renderAI();
      case 'advanced': return renderAdvanced();
      default: return renderIntegrations();
    }
  };

  return (
    <div className="settings-page">
      <aside className="settings-sidebar">
        <div className="px-3 mb-6">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <SettingsIcon size={20} className="text-indigo-400" />
            Control Panel
          </h1>
          <p className="text-[10px] uppercase font-bold text-tertiary mt-1">SDLC Autopilot v1.2</p>
        </div>

        {menuItems.map(item => (
          <button
            key={item.id}
            className={`settings-nav-item ${activeTab === item.id ? 'active' : ''}`}
            onClick={() => setActiveTab(item.id)}
          >
            {item.icon}
            <div className="text-left">
              <div className="block">{item.label}</div>
              <div className="text-[10px] opacity-60 font-normal">{item.description}</div>
            </div>
          </button>
        ))}

        <div className="mt-auto pt-6 px-3">
          <button className="btn btn-primary w-full py-4 rounded-2xl" onClick={handleSave}>
            {saved ? <><CheckCircle size={18} /> Saved!</> : 'Apply Changes'}
          </button>
        </div>
      </aside>

      <main className="settings-content">
        {getTabContent()}
      </main>
    </div>
  );
};
