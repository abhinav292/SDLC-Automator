import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Network, RefreshCw, FileText, ExternalLink, CheckCircle,
  GitBranch, GitPullRequest, AlertTriangle, Loader2
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { buildTraceRows, refreshJiraStatuses } from '../services/traceService';
import { createConfluencePage } from '../services/confluenceService';
import { getManifests } from '../services/manifestService';
import { getVersions } from '../services/versionService';
import './Trace.css';

/* global __ATLASSIAN_DOMAIN__ */
const ATLASSIAN_DOMAIN = typeof __ATLASSIAN_DOMAIN__ !== 'undefined' ? __ATLASSIAN_DOMAIN__ : '';

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

// Map a live Jira status name onto the app's badge palette.
const statusChipClass = (status) => {
  const s = String(status || '').toLowerCase();
  if (/done|closed|resolved|complete|released/.test(s)) return 'badge-success';
  if (/progress|review|testing|qa|develop/.test(s)) return 'badge-info';
  if (/block|imped|hold|reject/.test(s)) return 'badge-error';
  return 'badge-neutral';
};

const Dim = () => <span className="trace-dim">—</span>;

export const Trace = () => {
  const navigate = useNavigate();
  const {
    stories, prd, approvedStoryIds, discardedStoryIds,
    jiraIssues, storiesPrdVersionId, settings
  } = useApp();

  const jiraConfigured = Boolean(ATLASSIAN_DOMAIN);
  const confluenceConfigured = Boolean(ATLASSIAN_DOMAIN && settings.confluenceSpaceKey);

  const manifests = useMemo(() => {
    try { return getManifests(); } catch { return []; }
  }, []);
  const prdVersions = useMemo(() => {
    try { return getVersions(); } catch { return []; }
  }, []);

  const baseRows = useMemo(() => {
    try {
      // Discards live in a Set on context — project them onto the story shape
      // the trace service expects (status === 'discarded').
      const storiesWithStatus = (stories || []).map(s =>
        discardedStoryIds.has(s.id) ? { ...s, status: 'discarded' } : s
      );
      return buildTraceRows({
        stories: storiesWithStatus,
        approvedStoryIds: [...approvedStoryIds],
        jiraIssues,
        manifests,
        prdVersions,
        storiesPrdVersionId
      });
    } catch (err) {
      console.warn('Could not build trace rows:', err?.message);
      return [];
    }
  }, [stories, approvedStoryIds, discardedStoryIds, jiraIssues, manifests, prdVersions, storiesPrdVersionId]);

  const [statusMap, setStatusMap] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);

  // Overlay any live statuses fetched via "Refresh Jira status".
  const rows = useMemo(() => baseRows.map(row =>
    (row.jiraKey && statusMap[row.jiraKey])
      ? { ...row, jiraStatus: statusMap[row.jiraKey].status, jiraAssignee: statusMap[row.jiraKey].assignee }
      : row
  ), [baseRows, statusMap]);

  const stats = useMemo(() => {
    const reqTotal = new Set(rows.filter(r => r.reqId).map(r => r.reqId)).size;
    const reqCovered = new Set(rows.filter(r => r.reqId && r.storyId).map(r => r.reqId)).size;
    const storyRows = rows.filter(r => r.storyId);
    const published = storyRows.filter(r => r.jiraKey).length;
    const staleCount = storyRows.filter(r => r.stale).length;
    const droppedCount = rows.filter(r => r.reqId && !r.storyId).length;
    return {
      reqTotal,
      reqCovered,
      reqPct: reqTotal > 0 ? Math.round((reqCovered / reqTotal) * 100) : null,
      storyTotal: storyRows.length,
      published,
      pubPct: storyRows.length > 0 ? Math.round((published / storyRows.length) * 100) : null,
      staleCount,
      droppedCount
    };
  }, [rows]);

  const hasJiraRows = rows.some(r => r.jiraKey);

  const handleRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError('');
    try {
      const updated = await refreshJiraStatuses(baseRows);
      const map = {};
      updated.forEach(r => {
        if (r.jiraKey && r.jiraStatus) map[r.jiraKey] = { status: r.jiraStatus, assignee: r.jiraAssignee || null };
      });
      if (Object.keys(map).length === 0 && hasJiraRows) {
        setRefreshError('Could not fetch live status from Jira — statuses left unchanged. Check your Jira connection.');
      } else {
        setStatusMap(map);
        setLastRefreshed(new Date());
      }
    } catch (err) {
      setRefreshError(err?.message || 'Jira status refresh failed.');
    } finally {
      setRefreshing(false);
    }
  };

  // Simple HTML table for the Confluence export (storage format accepts plain table markup).
  const buildExportHtml = () => {
    const bodyRows = rows.map(r => {
      const jira = r.jiraKey
        ? (r.jiraUrl
            ? `<a href="${escapeHtml(r.jiraUrl)}">${escapeHtml(r.jiraKey)}</a>`
            : escapeHtml(r.jiraKey)) + (r.jiraStatus ? ` (${escapeHtml(r.jiraStatus)})` : '')
        : '—';
      const pr = r.prUrl ? `<a href="${escapeHtml(r.prUrl)}">View PR</a>` : '—';
      const flags = [
        (!r.storyId && r.reqId) ? 'Dropped scope' : null,
        (r.storyId && r.stale) ? 'Stale' : null
      ].filter(Boolean).join(', ') || '—';
      return `<tr>
        <td>${escapeHtml(r.reqId || '—')}</td>
        <td>${escapeHtml(r.prdHeading || '—')}</td>
        <td>${escapeHtml(r.storyTitle || '—')}</td>
        <td>${r.storyId ? (r.approved ? 'Yes' : 'No') : '—'}</td>
        <td>${jira}</td>
        <td>${escapeHtml(r.branch || '—')}</td>
        <td>${pr}</td>
        <td>${flags}</td>
      </tr>`;
    }).join('');
    return `
      <h2>Traceability Matrix</h2>
      <p>
        ${stats.reqCovered} of ${stats.reqTotal} requirements covered ·
        ${stats.published} of ${stats.storyTotal} stories published to Jira ·
        ${stats.staleCount} stale · ${stats.droppedCount} dropped from scope
      </p>
      <table>
        <thead>
          <tr>
            <th>REQ-ID</th><th>PRD Section</th><th>Story</th><th>Approved</th>
            <th>Jira</th><th>Branch</th><th>PR</th><th>Flags</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>`;
  };

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportResult(null);
    try {
      const activeStories = (stories || []).filter(s => !discardedStoryIds.has(s.id));
      const result = await createConfluencePage(
        settings.confluenceSpaceKey,
        'Traceability Matrix',
        activeStories,
        buildExportHtml()
      );
      setExportResult(result);
    } catch (err) {
      setExportResult({ success: false, error: err?.message || 'Export failed.' });
    } finally {
      setExporting(false);
    }
  };

  // ── Empty state: no PRD and no stories yet ─────────────────────────────────
  if (rows.length === 0) {
    return (
      <div className="trace-page">
        <header className="page-header">
          <div>
            <h1 className="page-title">Traceability</h1>
            <p className="page-subtitle">
              Every PRD requirement mapped to its story, Jira ticket, branch and PR.
            </p>
          </div>
        </header>
        <div className="empty-state">
          <Network size={40} />
          <h3>Nothing to trace yet</h3>
          <p className="trace-empty-text">
            {(!prd || !prd.trim()) && stories.length === 0
              ? 'Run a pipeline to generate a PRD and user stories — the matrix builds itself from REQ-IDs assigned to each PRD section.'
              : 'No traceable rows were found for the current PRD and stories.'}
          </p>
          <div className="flex gap-3 trace-empty-actions">
            <button className="btn btn-primary" onClick={() => navigate('/')}>Start a pipeline</button>
            <button className="btn btn-secondary" onClick={() => navigate('/prd')}>Open PRD</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="trace-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Traceability</h1>
          <p className="page-subtitle">
            Every PRD requirement mapped to its story, Jira ticket, branch and PR.
          </p>
        </div>
        <div className="page-actions">
          {jiraConfigured && (
            <button
              className="btn btn-secondary"
              onClick={handleRefresh}
              disabled={refreshing || !hasJiraRows}
              title={!hasJiraRows ? 'No Jira issues linked yet — publish stories first.' : 'Fetch live status for every linked Jira issue'}
            >
              {refreshing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
              Refresh Jira status
            </button>
          )}
          {confluenceConfigured && (
            <button className="btn btn-primary" onClick={handleExport} disabled={exporting}>
              {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
              Export to Confluence
            </button>
          )}
        </div>
      </header>

      {refreshError && (
        <div className="trace-alert trace-alert--warning">
          <AlertTriangle size={14} /> {refreshError}
        </div>
      )}
      {exportResult && (
        exportResult.success ? (
          <div className="trace-alert trace-alert--success">
            <CheckCircle size={14} />
            Traceability matrix exported to Confluence.
            {exportResult.url && (
              <a href={exportResult.url} target="_blank" rel="noopener noreferrer" className="trace-link">
                View page <ExternalLink size={12} />
              </a>
            )}
          </div>
        ) : (
          <div className="trace-alert trace-alert--error">
            <AlertTriangle size={14} /> Confluence export failed: {exportResult.error}
          </div>
        )
      )}

      {/* ── Coverage tiles ────────────────────────────────────────────────── */}
      <div className="stat-grid trace-stats">
        <div className="stat-tile">
          <div className="stat-value">{stats.reqPct != null ? `${stats.reqPct}%` : '—'}</div>
          <div className="stat-label">REQs Covered</div>
          <div className="trace-stat-sub">
            {stats.reqTotal > 0
              ? `${stats.reqCovered} of ${stats.reqTotal} requirements have a story${stats.droppedCount > 0 ? ` · ${stats.droppedCount} dropped` : ''}`
              : 'No REQ-IDs yet — generate or save a PRD'}
          </div>
        </div>
        <div className="stat-tile">
          <div className="stat-value">{stats.pubPct != null ? `${stats.pubPct}%` : '—'}</div>
          <div className="stat-label">Stories Published</div>
          <div className="trace-stat-sub">
            {stats.storyTotal > 0
              ? `${stats.published} of ${stats.storyTotal} stories have a Jira issue`
              : 'No stories yet'}
          </div>
        </div>
        <div className="stat-tile">
          <div className={`stat-value ${stats.staleCount > 0 ? 'stat-value--warn' : ''}`}>{stats.staleCount}</div>
          <div className="stat-label">Stale Stories</div>
          <div className="trace-stat-sub">
            {stats.staleCount > 0
              ? 'PRD changed since these stories were generated'
              : 'Stories match the latest PRD version'}
          </div>
        </div>
      </div>

      {/* ── Matrix ────────────────────────────────────────────────────────── */}
      <div className="card trace-table-card">
        <div className="trace-table-wrap">
          <table className="trace-table">
            <thead>
              <tr>
                <th>REQ-ID</th>
                <th>PRD Section</th>
                <th>Story</th>
                <th>Approved</th>
                <th>Jira</th>
                <th>Branch</th>
                <th>PR</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={row.storyId || `${row.reqId || 'row'}-${i}`} className={(!row.storyId && row.reqId) ? 'trace-row--dropped' : ''}>
                  <td>{row.reqId ? <span className="trace-reqid">{row.reqId}</span> : <Dim />}</td>
                  <td className="trace-section">{row.prdHeading || <Dim />}</td>
                  <td className="trace-story">
                    {row.storyTitle || <span className="trace-dim">No story covers this requirement</span>}
                  </td>
                  <td className="trace-center">
                    {row.storyId
                      ? (row.approved
                          ? <CheckCircle size={15} className="trace-approved" aria-label="Approved" />
                          : <Dim />)
                      : <Dim />}
                  </td>
                  <td>
                    {row.jiraKey ? (
                      <div className="trace-jira">
                        {row.jiraUrl ? (
                          <a href={row.jiraUrl} target="_blank" rel="noopener noreferrer" className="trace-jira-key">
                            {row.jiraKey} <ExternalLink size={11} />
                          </a>
                        ) : (
                          <span className="trace-jira-key">{row.jiraKey}</span>
                        )}
                        {row.jiraStatus && (
                          <span
                            className={`badge ${statusChipClass(row.jiraStatus)}`}
                            title={row.jiraAssignee ? `Assignee: ${row.jiraAssignee}` : undefined}
                          >
                            {row.jiraStatus}
                          </span>
                        )}
                      </div>
                    ) : <Dim />}
                  </td>
                  <td>
                    {row.branch
                      ? <span className="trace-branch"><GitBranch size={12} /> {row.branch}</span>
                      : <Dim />}
                  </td>
                  <td>
                    {row.prUrl ? (
                      <a href={row.prUrl} target="_blank" rel="noopener noreferrer" className="trace-link">
                        <GitPullRequest size={12} /> PR <ExternalLink size={11} />
                      </a>
                    ) : <Dim />}
                  </td>
                  <td>
                    <div className="trace-flags">
                      {(!row.storyId && row.reqId) && <span className="badge badge-error">Dropped scope</span>}
                      {(row.storyId && row.stale) && <span className="badge badge-warning">Stale</span>}
                      {!((!row.storyId && row.reqId) || (row.storyId && row.stale)) && <Dim />}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="trace-footnotes">
        {lastRefreshed && (
          <span>Jira statuses updated {lastRefreshed.toLocaleTimeString()}.</span>
        )}
        {!jiraConfigured && (
          <span>Jira is not configured — live status refresh is unavailable. Set your Atlassian domain to enable it.</span>
        )}
        {!confluenceConfigured && (
          <span>
            Confluence export is unavailable — {ATLASSIAN_DOMAIN ? 'add a Confluence space key in ' : 'configure Atlassian access and a space key in '}
            <button className="trace-inline-link" onClick={() => navigate('/settings')}>Settings</button>.
          </span>
        )}
      </div>
    </div>
  );
};
