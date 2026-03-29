import React, { useState, useEffect } from 'react';
import {
  Settings as SettingsIcon, CheckCircle, AlertTriangle, Loader2,
  ExternalLink, RefreshCw, GitBranch, FileText, CheckSquare
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getJiraProjects, getJiraBaseUrl } from '../services/jiraService';
import { getConfluenceSpaces, getConfluenceBaseUrl } from '../services/confluenceService';
import { getBitbucketWorkspaces, getBitbucketRepos } from '../services/bitbucketService';
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
  const [confluenceStatus, setConfluenceStatus] = useState('idle');
  const [bitbucketStatus, setBitbucketStatus] = useState('idle');
  const [jiraProjects, setJiraProjects] = useState([]);
  const [confluenceSpaces, setConfluenceSpaces] = useState([]);
  const [bbWorkspaces, setBbWorkspaces] = useState([]);
  const [bbRepos, setBbRepos] = useState([]);
  const [form, setForm] = useState({
    bbWorkspace: settings.bbWorkspace || '',
    bbRepo: settings.bbRepo || '',
    confluenceSpaceKey: settings.confluenceSpaceKey || '',
    bbDefaultBranch: settings.bbDefaultBranch || 'main'
  });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    testConnections();
  }, []);

  useEffect(() => {
    if (form.bbWorkspace) loadBbRepos(form.bbWorkspace);
  }, [form.bbWorkspace]);

  const testConnections = async () => {
    testJira();
    testConfluence();
    testBitbucket();
  };

  const testJira = async () => {
    setJiraStatus('checking');
    const projects = await getJiraProjects();
    setJiraProjects(projects.slice ? projects.slice(0, 10) : []);
    setJiraStatus(projects.length > 0 || Array.isArray(projects) ? 'ok' : 'error');
    if (projects.length === 0) setJiraStatus('error');
    else setJiraStatus('ok');
  };

  const testConfluence = async () => {
    setConfluenceStatus('checking');
    const spaces = await getConfluenceSpaces();
    setConfluenceSpaces(spaces.slice ? spaces.slice(0, 10) : []);
    setConfluenceStatus(spaces.length > 0 ? 'ok' : 'error');
  };

  const testBitbucket = async () => {
    setBitbucketStatus('checking');
    const ws = await getBitbucketWorkspaces();
    setBbWorkspaces(ws);
    setBitbucketStatus(ws.length > 0 ? 'ok' : 'error');
  };

  const loadBbRepos = async (workspace) => {
    const repos = await getBitbucketRepos(workspace);
    setBbRepos(repos);
  };

  const handleSave = () => {
    saveSettings(form);
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
            <RefreshCw size={13} /> Test Connections
          </button>
        </div>

        <SettingRow label="Domain" value={DOMAIN} hint="Set via ATLASSIAN_DOMAIN environment variable" />
        <SettingRow label="Email" value={EMAIL} hint="Set via ATLASSIAN_EMAIL environment variable" />
        <SettingRow label="API Token" value={DOMAIN ? '••••••••••••' : 'Not configured'} hint="Set via ATLASSIAN_API_TOKEN environment variable" />
        <SettingRow label="Jira Project Key" value={JIRA_KEY} hint="Set via JIRA_PROJECT_KEY environment variable" />
      </div>

      {/* Jira Status */}
      <div className="card mb-6">
        <div className="flex items-center gap-3 mb-4">
          <CheckSquare size={20} style={{ color: '#60a5fa' }} />
          <h2 className="text-lg font-semibold">Jira</h2>
          <StatusIndicator status={jiraStatus} />
          {jiraStatus === 'ok' && <span className="text-success text-xs font-semibold">Connected</span>}
          {jiraStatus === 'error' && <span className="text-error text-xs font-semibold">Connection failed</span>}
        </div>

        {jiraStatus === 'ok' && (
          <>
            <p className="text-sm text-secondary mb-3">
              Creating stories in project <span className="text-primary font-mono font-bold">{JIRA_KEY}</span>.
              {' '}<a href={`${getJiraBaseUrl()}/browse/${JIRA_KEY}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary">
                Open Jira <ExternalLink size={12} />
              </a>
            </p>
            {jiraProjects.length > 0 && (
              <div>
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
        {jiraStatus === 'error' && (
          <p className="text-sm text-error">Could not connect to Jira. Check your domain, email, and API token in the environment variables.</p>
        )}
      </div>

      {/* Confluence */}
      <div className="card mb-6">
        <div className="flex items-center gap-3 mb-4">
          <FileText size={20} style={{ color: '#a78bfa' }} />
          <h2 className="text-lg font-semibold">Confluence</h2>
          <StatusIndicator status={confluenceStatus} />
          {confluenceStatus === 'ok' && <span className="text-success text-xs font-semibold">Connected</span>}
          {confluenceStatus === 'error' && <span className="text-error text-xs font-semibold">Connection failed</span>}
        </div>

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
            <p className="text-xs text-tertiary uppercase font-semibold mb-2">Available Spaces</p>
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

      {/* Bitbucket */}
      <div className="card mb-6">
        <div className="flex items-center gap-3 mb-4">
          <GitBranch size={20} style={{ color: '#818cf8' }} />
          <h2 className="text-lg font-semibold">Bitbucket</h2>
          <StatusIndicator status={bitbucketStatus} />
          {bitbucketStatus === 'ok' && <span className="text-success text-xs font-semibold">Connected</span>}
          {bitbucketStatus === 'error' && <span className="text-error text-xs font-semibold">Connection failed</span>}
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
            placeholder="main"
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

      <div className="flex justify-end">
        <button className="btn btn-primary px-8 py-3" onClick={handleSave}>
          {saved ? <><CheckCircle size={16} /> Saved!</> : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};
