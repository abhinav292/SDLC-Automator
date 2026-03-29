import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon, CheckCircle, AlertTriangle, Loader2,
  ExternalLink, RefreshCw, GitBranch, FileText, CheckSquare, Bell, TrendingUp,
  FlaskConical
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getJiraProjects, getJiraBaseUrl, getJiraVelocity } from '../services/jiraService';
import { getConfluenceSpaces, getConfluenceBaseUrl } from '../services/confluenceService';
import { getBitbucketWorkspaces, getBitbucketRepos } from '../services/bitbucketService';
import { diagnoseJiraWrite } from '../services/apiService';
import './Settings.css';

const DOMAIN = typeof __ATLASSIAN_DOMAIN__ !== 'undefined' ? __ATLASSIAN_DOMAIN__ : '';
const EMAIL = typeof __ATLASSIAN_EMAIL__ !== 'undefined' ? __ATLASSIAN_EMAIL__ : '';
const JIRA_KEY = typeof __JIRA_PROJECT_KEY__ !== 'undefined' ? __JIRA_PROJECT_KEY__ : 'KAN';

const StatusIndicator = ({ status }) => {
  if (status === 'checking') return <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-primary)' }} />;
  if (status === 'ok') return <CheckCircle size={14} style={{ color: 'var(--color-success)' }} />;
  if (status === 'error') return <AlertTriangle size={14} style={{ color: 'var(--color-error)' }} />;
  return <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--border-subtle)' }} />;
};

export const Settings = () => {
  const { settings, saveSettings } = useApp();
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
  const [velocityData, setVelocityData] = useState(null);
  const [velocityLoading, setVelocityLoading] = useState(false);
  const [jiraDiagnosing, setJiraDiagnosing] = useState(false);
  const [jiraDiagResult, setJiraDiagResult] = useState(null);
  const [form, setForm] = useState({
    bbWorkspace: settings.bbWorkspace || '',
    bbRepo: settings.bbRepo || '',
    confluenceSpaceKey: settings.confluenceSpaceKey || '',
    bbDefaultBranch: settings.bbDefaultBranch || 'master',
    slackWebhookUrl: settings.slackWebhookUrl || '',
    projectName: settings.projectName || ''
  });
  const [saved, setSaved] = useState(false);
  const [atlassianToken, setAtlassianToken] = useState('');
  const [bitbucketToken, setBitbucketToken] = useState('');
  const [aiToken, setAiToken] = useState('');

  useEffect(() => {
    testConnections();
  }, []);

  useEffect(() => {
    if (form.bbWorkspace) loadBbRepos(form.bbWorkspace);
  }, [form.bbWorkspace]);

  const testConnections = () => {
    testJira();
    testConfluence();
    testBitbucket();
  };

  const testJira = async () => {
    setJiraStatus('checking');
    setJiraError(null);
    const { projects, error } = await getJiraProjects();
    setJiraProjects((projects || []).slice(0, 10));
    if (error) { setJiraStatus('error'); setJiraError(error); }
    else if (!projects || projects.length === 0) { setJiraStatus('error'); setJiraError('No projects returned — check your API token and domain.'); }
    else setJiraStatus('ok');
  };

  const testConfluence = async () => {
    setConfluenceStatus('checking');
    setConfluenceError(null);
    const { spaces, error } = await getConfluenceSpaces();
    setConfluenceSpaces((spaces || []).slice(0, 10));
    if (error) { setConfluenceStatus('error'); setConfluenceError(error); }
    else if (!spaces || spaces.length === 0) { setConfluenceStatus('error'); setConfluenceError('No spaces returned — check your Confluence access.'); }
    else setConfluenceStatus('ok');
  };

  const testBitbucket = async () => {
    setBitbucketStatus('checking');
    setBitbucketError(null);
    const { workspaces, error } = await getBitbucketWorkspaces();
    setBbWorkspaces(workspaces || []);
    if (error) { setBitbucketStatus('error'); setBitbucketError(error); }
    else if (!workspaces || workspaces.length === 0) { setBitbucketStatus('error'); setBitbucketError('No workspaces returned — check your BITBUCKET_API_TOKEN.'); }
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

  const loadVelocity = async () => {
    setVelocityLoading(true);
    const data = await getJiraVelocity(JIRA_KEY, 30);
    setVelocityData(data);
    setVelocityLoading(false);
  };

  const handleSave = async () => {
    saveSettings(form);
    
    if (atlassianToken || bitbucketToken || aiToken) {
      try {
        await fetch('/api/backend/update-env', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            atlassianToken: atlassianToken || undefined, 
            bitbucketToken: bitbucketToken || undefined,
            aiToken: aiToken || undefined
          })
        });
        setAtlassianToken('');
        setBitbucketToken('');
        setAiToken('');
      } catch (err) {
        console.error('Failed to update tokens:', err);
      }
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const SettingRow = ({ label, value, hint }) => (
    <div className="flex justify-between items-center py-3 border-b border-subtle">
      <div>
        <span className="text-sm font-medium">{label}</span>
        {hint && <p className="text-xs text-tertiary mt-0.5">{hint}</p>}
      </div>
      <span className="text-sm text-secondary font-mono">{value || '—'}</span>
    </div>
  );

  return (
    <div className="settings-page" style={{ maxWidth: 820 }}>
      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
          <SettingsIcon size={28} style={{ color: 'var(--color-primary)' }} />
          Settings
        </h1>
        <p className="text-secondary">Manage your Atlassian integrations and pipeline configuration.</p>
      </header>

      {/* Atlassian Core */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold">Atlassian Connection</h2>
          <button className="btn btn-secondary text-xs py-1.5 gap-1" onClick={testConnections}>
            <RefreshCw size={13} /> Test All
          </button>
        </div>

        <SettingRow label="Domain" value={DOMAIN} hint="Set via ATLASSIAN_DOMAIN environment variable" />
        <SettingRow label="Email" value={EMAIL} hint="Set via ATLASSIAN_EMAIL environment variable" />
        <div className="flex justify-between items-center py-3 border-b border-subtle">
          <div className="flex-1 pr-6">
            <span className="text-sm font-medium">API Token</span>
            <p className="text-xs text-tertiary mt-0.5">Used for both Jira and Confluence by default.</p>
          </div>
          <input
            type="password"
            className="input-field max-w-xs flex-1 font-mono text-sm"
            placeholder={DOMAIN ? "•••••••••••• (Type to overwrite)" : "Paste your Atlassian token here"}
            value={atlassianToken}
            onChange={(e) => setAtlassianToken(e.target.value)}
          />
        </div>
        <SettingRow label="Jira Project Key" value={JIRA_KEY} hint="Set via JIRA_PROJECT_KEY environment variable" />
      </div>

      {/* Jira Status */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <CheckSquare size={20} style={{ color: '#60a5fa' }} />
            <h2 className="text-lg font-semibold">Jira</h2>
            <StatusIndicator status={jiraStatus} />
            {jiraStatus === 'ok' && <span className="text-success text-xs font-semibold">Connected</span>}
            {jiraStatus === 'error' && <span className="text-error text-xs font-semibold">Connection failed</span>}
          </div>
          <button className="btn btn-secondary text-xs py-1 px-2 gap-1" onClick={testJira} disabled={jiraStatus === 'checking'}>
            <RefreshCw size={12} /> Re-test
          </button>
        </div>

        {jiraStatus === 'error' && jiraError && (
          <div className="p-3 rounded-lg mb-3 border" style={{ background: 'var(--color-error-bg, rgba(239,68,68,0.08))', borderColor: 'rgba(239,68,68,0.25)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--color-error)' }}>Error: {jiraError}</p>
            <p className="text-xs text-tertiary mt-1">Check ATLASSIAN_DOMAIN, ATLASSIAN_EMAIL, and ATLASSIAN_API_TOKEN in your environment.</p>
          </div>
        )}

        {jiraStatus === 'ok' && (
          <>
            <p className="text-sm text-secondary mb-3">
              Creating stories in project <span className="text-primary font-mono font-bold">{JIRA_KEY}</span>.
              {' '}<a href={`${getJiraBaseUrl()}/browse/${JIRA_KEY}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary">
                Open Jira <ExternalLink size={12} />
              </a>
            </p>
            {jiraProjects.length > 0 && (
              <div className="mb-4">
                <p className="text-xs text-tertiary uppercase font-semibold mb-2">Available Projects</p>
                <div className="flex flex-wrap gap-2">
                  {jiraProjects.map(p => (
                    <span key={p.id} className={`badge ${p.key === JIRA_KEY ? 'badge-info' : 'badge-neutral'}`}>
                      {p.key} – {p.name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Jira Write-access diagnostic */}
        <div className="flex items-center justify-between mt-3 pt-3 border-t border-subtle">
          <div>
            <p className="text-xs font-medium">Test Write Access</p>
            <p className="text-xs text-tertiary">Creates and immediately deletes a test issue to verify push permissions.</p>
          </div>
          <button
            className="btn btn-secondary text-xs py-1 px-2 gap-1 flex-shrink-0 ml-3"
            onClick={runJiraDiagnose}
            disabled={jiraDiagnosing}
          >
            {jiraDiagnosing ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
            {jiraDiagnosing ? 'Testing…' : 'Test Jira Write'}
          </button>
        </div>
        {jiraDiagResult && (
          <div className={`mt-2 p-2 rounded text-xs ${jiraDiagResult.success ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
            {jiraDiagResult.success ? (
              <>
                <CheckCircle size={11} className="inline mr-1" />
                Write access confirmed — test issue created and deleted successfully.
                {jiraDiagResult.warnings?.map((w, i) => <span key={i} className="block text-yellow-400 mt-1">⚠ {w}</span>)}
              </>
            ) : (
              <>
                <AlertTriangle size={11} className="inline mr-1" />
                {jiraDiagResult.error}
                {jiraDiagResult.detail && <span className="block text-tertiary mt-0.5">{jiraDiagResult.detail}</span>}
              </>
            )}
          </div>
        )}
      </div>

      {/* Confluence */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <FileText size={20} style={{ color: '#a78bfa' }} />
            <h2 className="text-lg font-semibold">Confluence</h2>
            <StatusIndicator status={confluenceStatus} />
            {confluenceStatus === 'ok' && <span className="text-success text-xs font-semibold">Connected</span>}
            {confluenceStatus === 'error' && <span className="text-error text-xs font-semibold">Connection failed</span>}
          </div>
          <button className="btn btn-secondary text-xs py-1 px-2 gap-1" onClick={testConfluence} disabled={confluenceStatus === 'checking'}>
            <RefreshCw size={12} /> Re-test
          </button>
        </div>

        {confluenceStatus === 'error' && confluenceError && (
          <div className="p-3 rounded-lg mb-3 border" style={{ background: 'var(--color-error-bg, rgba(239,68,68,0.08))', borderColor: 'rgba(239,68,68,0.25)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--color-error)' }}>Error: {confluenceError}</p>
            <p className="text-xs text-tertiary mt-1">Confluence uses the same ATLASSIAN_API_TOKEN as Jira. Confirm your account has Confluence access.</p>
          </div>
        )}

        <div className="mb-4">
          <label className="text-sm font-medium block mb-1">Space Key</label>
          <div className="flex gap-3">
            <input
              className="input-field flex-1"
              placeholder="e.g. ENG or ~username"
              value={form.confluenceSpaceKey}
              onChange={e => setForm(f => ({ ...f, confluenceSpaceKey: e.target.value }))}
            />
          </div>
          <p className="text-xs text-tertiary mt-1">The key of the Confluence space where solutioning docs will be published.</p>
        </div>

        {confluenceStatus === 'ok' && confluenceSpaces.length > 0 && (
          <div>
            <p className="text-xs text-tertiary uppercase font-semibold mb-2">Available Spaces — click to select</p>
            <div className="flex flex-wrap gap-2">
              {confluenceSpaces.map(s => (
                <button
                  key={s.key}
                  className={`badge cursor-pointer ${form.confluenceSpaceKey === s.key ? 'badge-info' : 'badge-neutral'}`}
                  onClick={() => setForm(f => ({ ...f, confluenceSpaceKey: s.key }))}
                >
                  {s.key} – {s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        {confluenceStatus === 'ok' && (
          <a href={getConfluenceBaseUrl()} target="_blank" rel="noopener noreferrer" className="text-xs text-primary flex items-center gap-1 mt-3">
            Open Confluence <ExternalLink size={11} />
          </a>
        )}
      </div>

      {/* AI Configuration */}
      <div className="card mb-6 border-indigo-500/20 bg-indigo-900/5">
        <div className="flex items-center gap-3 mb-4">
          <Loader2 size={20} style={{ color: 'var(--color-primary)' }} />
          <h2 className="text-lg font-semibold">AI Configuration</h2>
        </div>
        <p className="text-sm text-secondary mb-4">
          Configure the API keys used for story extraction and code scaffolding.
        </p>
        <div className="mb-4">
          <label className="text-sm font-medium block mb-1">OpenRouter / OpenAI API Key</label>
          <input
            type="password"
            className="input-field font-mono text-sm"
            placeholder="•••••••••••• (Type to overwrite)"
            value={aiToken}
            onChange={(e) => setAiToken(e.target.value)}
          />
          <p className="text-xs text-tertiary mt-2">Required for the AI to analyze your repo and generate code. Supports OpenRouter (preferred) or OpenAI.</p>
        </div>
      </div>

      {/* Bitbucket */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <GitBranch size={20} style={{ color: '#818cf8' }} />
            <h2 className="text-lg font-semibold">Bitbucket</h2>
            <StatusIndicator status={bitbucketStatus} />
            {bitbucketStatus === 'ok' && <span className="text-success text-xs font-semibold">Connected</span>}
            {bitbucketStatus === 'error' && <span className="text-error text-xs font-semibold">Connection failed</span>}
          </div>
          <button className="btn btn-secondary text-xs py-1 px-2 gap-1" onClick={testBitbucket} disabled={bitbucketStatus === 'checking'}>
            <RefreshCw size={12} /> Re-test
          </button>
        </div>

        {bitbucketStatus === 'error' && bitbucketError && (
          <div className="p-3 rounded-lg mb-3 border" style={{ background: 'var(--color-error-bg, rgba(239,68,68,0.08))', borderColor: 'rgba(239,68,68,0.25)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--color-error)' }}>Error: {bitbucketError}</p>
            <p className="text-xs text-tertiary mt-1">Ensure BITBUCKET_API_TOKEN is set in Replit Secrets with your Bitbucket App Password or token.</p>
          </div>
        )}

        <div className="mb-4">
          <label className="text-sm font-medium block mb-1">Bitbucket API Token</label>
          <input
            type="password"
            className="input-field font-mono text-sm"
            placeholder="•••••••••••• (Type to overwrite)"
            value={bitbucketToken}
            onChange={(e) => setBitbucketToken(e.target.value)}
          />
          <p className="text-xs text-tertiary mt-1">Leave blank to keep current token. Replaces BITBUCKET_API_TOKEN.</p>
        </div>

        <div className="bitbucket-fields-grid">
          <div>
            <label className="text-sm font-medium block mb-1">Workspace</label>
            {bbWorkspaces.length > 0 ? (
              <select
                className="input-field"
                value={form.bbWorkspace}
                onChange={e => setForm(f => ({ ...f, bbWorkspace: e.target.value, bbRepo: '' }))}
              >
                <option value="">Select workspace...</option>
                {bbWorkspaces.map(w => (
                  <option key={w.slug} value={w.slug}>{w.name || w.slug}</option>
                ))}
              </select>
            ) : (
              <input
                className="input-field"
                placeholder="e.g. my-workspace"
                value={form.bbWorkspace}
                onChange={e => setForm(f => ({ ...f, bbWorkspace: e.target.value }))}
              />
            )}
          </div>
          <div>
            <label className="text-sm font-medium block mb-1">Repository</label>
            {bbRepos.length > 0 ? (
              <select
                className="input-field"
                value={form.bbRepo}
                onChange={e => setForm(f => ({ ...f, bbRepo: e.target.value }))}
              >
                <option value="">Select repository...</option>
                {bbRepos.map(r => (
                  <option key={r.slug} value={r.slug}>{r.name || r.slug}</option>
                ))}
              </select>
            ) : (
              <input
                className="input-field"
                placeholder="e.g. my-repo"
                value={form.bbRepo}
                onChange={e => setForm(f => ({ ...f, bbRepo: e.target.value }))}
              />
            )}
          </div>
        </div>

        <div className="mt-4">
          <label className="text-sm font-medium block mb-1">Default Branch</label>
          <input
            className="input-field"
            placeholder="master"
            value={form.bbDefaultBranch}
            onChange={e => setForm(f => ({ ...f, bbDefaultBranch: e.target.value }))}
            style={{ maxWidth: 160 }}
          />
          <p className="text-xs text-tertiary mt-1">Feature branches will be cut from this branch.</p>
        </div>

        <p className="text-xs text-tertiary mt-3">
          Branches will be created as <span className="font-mono text-primary">feature/[JIRAKEY]-[story-title]</span>
        </p>
      </div>

      {/* Notifications */}
      <div className="card mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Bell size={20} style={{ color: '#fb923c' }} />
          <h2 className="text-lg font-semibold">Notifications</h2>
        </div>

        <div className="mb-4">
          <label className="text-sm font-medium block mb-1">Project Name</label>
          <input
            className="input-field"
            placeholder="e.g. Payments Platform Q2"
            value={form.projectName}
            onChange={e => setForm(f => ({ ...f, projectName: e.target.value }))}
          />
          <p className="text-xs text-tertiary mt-1">Used in the stakeholder email subject line and Confluence page title.</p>
        </div>

        <div>
          <label className="text-sm font-medium block mb-1">Slack / Teams Webhook URL</label>
          <input
            className="input-field"
            placeholder="https://hooks.slack.com/services/..."
            value={form.slackWebhookUrl}
            onChange={e => setForm(f => ({ ...f, slackWebhookUrl: e.target.value }))}
          />
          <p className="text-xs text-tertiary mt-1">
            Paste an incoming webhook URL to receive a Slack or Teams notification when a pipeline completes.
            Supports Slack (<code>hooks.slack.com</code>), Teams (<code>outlook.office.com</code>), and Discord webhooks.
          </p>
          {form.slackWebhookUrl && (
            <div className="flex items-center gap-1 mt-2 text-xs" style={{ color: 'var(--color-success)' }}>
              <CheckCircle size={11} /> Webhook configured – notifications will be sent on pipeline completion
            </div>
          )}
        </div>
      </div>

      {/* Story Point Calibration */}
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <TrendingUp size={20} style={{ color: '#34d399' }} />
            <h2 className="text-lg font-semibold">Story Point Calibration</h2>
          </div>
          <button
            className="btn btn-secondary text-xs py-1.5 gap-1"
            onClick={loadVelocity}
            disabled={velocityLoading || jiraStatus !== 'ok'}
          >
            {velocityLoading
              ? <><Loader2 size={13} className="animate-spin" /> Fetching...</>
              : <><RefreshCw size={13} /> Fetch Velocity</>}
          </button>
        </div>

        <p className="text-sm text-secondary mb-4">
          Fetch your team's historical Jira velocity to calibrate AI story point estimates.
          The system queries recently completed stories in project <span className="font-mono text-primary">{JIRA_KEY}</span>.
        </p>

        {jiraStatus !== 'ok' && (
          <p className="text-xs text-warning">Connect Jira first to fetch velocity data.</p>
        )}

        {velocityData && (
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
            <div className="p-3 bg-root border border-subtle rounded-lg text-center">
              <div className="text-2xl font-bold" style={{ color: 'var(--color-primary)' }}>
                {velocityData.average ?? '—'}
              </div>
              <div className="text-xs text-tertiary mt-1">Avg Story Points</div>
            </div>
            <div className="p-3 bg-root border border-subtle rounded-lg text-center">
              <div className="text-2xl font-bold" style={{ color: 'var(--color-success)' }}>
                {velocityData.count}
              </div>
              <div className="text-xs text-tertiary mt-1">Stories with Points</div>
            </div>
            <div className="p-3 bg-root border border-subtle rounded-lg text-center">
              <div className="text-2xl font-bold" style={{ color: 'var(--color-warning)' }}>
                {velocityData.total}
              </div>
              <div className="text-xs text-tertiary mt-1">Done Stories (total)</div>
            </div>
          </div>
        )}

        {velocityData && velocityData.average === null && (
          <p className="text-xs text-tertiary mt-2">
            No story point data found on completed issues. Ensure your Jira project uses the Story Points field (customfield_10016).
          </p>
        )}

        {velocityData && velocityData.average !== null && (
          <p className="text-xs text-tertiary mt-3">
            AI estimates will use <strong>{velocityData.average} pts</strong> as the team baseline when calibrating new stories.
            Extraction prompts are automatically informed by this value.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <button className="btn btn-primary px-8 py-3" onClick={handleSave}>
          {saved ? <><CheckCircle size={16} /> Saved!</> : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};
