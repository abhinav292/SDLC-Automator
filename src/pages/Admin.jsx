import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Shield, ShieldOff, Users, UserPlus, Trash2, ScrollText, KeyRound, Check, X,
  Download, RefreshCw, AlertTriangle, Bot, SlidersHorizontal, Info, Zap, EyeOff,
  Package, Code2, FileCheck2, Wrench, FlaskConical, Minus
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { ROLES, ROLE_LABELS, PERMS, can, saveUsers } from '../services/authzService';
import { recordAudit, getAudit, clearAudit } from '../services/auditService';
import './Admin.css';

// Human-readable labels for the permission constants (matrix + tooltips).
const PERM_LABELS = {
  [PERMS.MANAGE_USERS]: 'Manage users',
  [PERMS.GENERATE_PRD]: 'Generate PRD',
  [PERMS.EDIT_PRD]: 'Edit PRD',
  [PERMS.GENERATE_STORIES]: 'Generate stories',
  [PERMS.EDIT_STORY]: 'Edit story',
  [PERMS.APPROVE_STORY]: 'Approve story',
  [PERMS.SIGNOFF_PRD]: 'PRD sign-off',
  [PERMS.SIGNOFF_ENGINEERING]: 'Engineering sign-off',
  [PERMS.SIGNOFF_QA]: 'QA sign-off',
  [PERMS.PUBLISH]: 'Publish',
  [PERMS.ROLLBACK]: 'Rollback',
  [PERMS.OVERRIDE_LINT]: 'Override lint',
  [PERMS.VIEW_AUDIT]: 'View audit trail'
};

// Audit logging must never break an admin action.
const safeAudit = (entry) => {
  try { recordAudit(entry); } catch { /* non-fatal */ }
};

// Compact rendering for audit before/after values.
const formatValue = (v, max = 48) => {
  if (v === null || v === undefined || v === '') return null;
  let s;
  if (typeof v === 'string') s = v;
  else { try { s = JSON.stringify(v); } catch { s = String(v); } }
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
};

const TABS = [
  { id: 'users', label: 'Users & Roles', icon: <Users size={15} /> },
  { id: 'governance', label: 'Governance', icon: <SlidersHorizontal size={15} /> },
  { id: 'audit', label: 'Audit Trail', icon: <ScrollText size={15} /> },
  { id: 'permissions', label: 'Permissions', icon: <KeyRound size={15} /> }
];

const Switch = ({ on, onToggle, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={on}
    aria-label={label}
    className={`admin-switch ${on ? 'on' : ''}`}
    onClick={onToggle}
  >
    <span className="admin-switch-knob" />
  </button>
);

export const Admin = () => {
  const { currentUser, users, refreshUsers, saveSettings, featureFlags } = useApp();
  const [activeTab, setActiveTab] = useState('users');

  // ── Users & Roles state ────────────────────────────────────────────────────
  const [rowErrors, setRowErrors] = useState({});      // userId -> guard error
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('viewer');
  const [addError, setAddError] = useState(null);

  // ── Audit trail state (read lazily; refreshed on tab open / actions) ──────
  const [entries, setEntries] = useState(() => {
    try { return getAudit(); } catch { return []; }
  });
  const [actionFilter, setActionFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [auditError, setAuditError] = useState(null);

  const isAdmin = can(currentUser, PERMS.MANAGE_USERS);

  const loadAudit = useCallback(() => {
    try { setEntries(getAudit()); } catch { setEntries([]); }
  }, []);

  // Pick up any user-list changes made outside this session (e.g. another tab).
  useEffect(() => {
    refreshUsers();
  }, [refreshUsers]);

  const openTab = (id) => {
    setActiveTab(id);
    // Re-read the trail whenever the tab is opened so this session's entries appear.
    if (id === 'audit') loadAudit();
  };

  const actionOptions = useMemo(
    () => [...new Set(entries.map(e => e.action).filter(Boolean))].sort(),
    [entries]
  );
  const actorOptions = useMemo(() => {
    const seen = new Map();
    entries.forEach(e => {
      if (e.actor?.id && !seen.has(e.actor.id)) seen.set(e.actor.id, e.actor);
    });
    return [...seen.values()];
  }, [entries]);

  const filteredEntries = useMemo(() => entries.filter(e =>
    (!actionFilter || e.action === actionFilter) &&
    (!actorFilter || e.actor?.id === actorFilter)
  ), [entries, actionFilter, actorFilter]);

  // ── Users & Roles handlers ─────────────────────────────────────────────────
  const clearRowError = (id) => setRowErrors(prev => {
    if (!(id in prev)) return prev;
    const next = { ...prev };
    delete next[id];
    return next;
  });

  const handleRoleChange = (user, nextRole) => {
    if (!user || user.role === nextRole) return;
    const next = users.map(u => (u.id === user.id ? { ...u, role: nextRole } : u));
    const err = saveUsers(next);
    if (err) {
      setRowErrors(prev => ({ ...prev, [user.id]: err }));
      return;
    }
    clearRowError(user.id);
    safeAudit({
      action: 'user.role_change',
      entityType: 'user',
      entityId: user.id,
      field: 'role',
      before: user.role,
      after: nextRole
    });
    refreshUsers();
  };

  const handleDelete = (user) => {
    if (!user) return;
    const next = users.filter(u => u.id !== user.id);
    const err = saveUsers(next);
    setConfirmDeleteId(null);
    if (err) {
      setRowErrors(prev => ({ ...prev, [user.id]: err }));
      return;
    }
    clearRowError(user.id);
    safeAudit({
      action: 'user.delete',
      entityType: 'user',
      entityId: user.id,
      before: `${user.name} (${ROLE_LABELS[user.role] || user.role})`
    });
    refreshUsers();
  };

  const handleAddUser = (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) { setAddError('Enter a name for the new user.'); return; }
    if (users.some(u => u.name?.toLowerCase() === name.toLowerCase())) {
      setAddError('A user with that name already exists.');
      return;
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'user';
    const id = `u-${slug}-${Date.now().toString(36)}`;
    const err = saveUsers([...users, { id, name, role: newRole }]);
    if (err) { setAddError(err); return; }
    setAddError(null);
    setNewName('');
    setNewRole('viewer');
    safeAudit({
      action: 'user.create',
      entityType: 'user',
      entityId: id,
      after: `${name} (${ROLE_LABELS[newRole] || newRole})`
    });
    refreshUsers();
  };

  // ── Audit handlers ─────────────────────────────────────────────────────────
  const exportAudit = () => {
    setAuditError(null);
    try {
      const blob = new Blob([JSON.stringify(filteredEntries, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sdlc-audit-trail-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setAuditError('Could not export the audit trail.');
    }
  };

  const handleClearAudit = () => {
    if (!isAdmin) return; // admin-only, enforced at call site per auditService contract
    setAuditError(null);
    try { clearAudit(); } catch { setAuditError('Could not clear the audit trail.'); }
    setConfirmClear(false);
    setActionFilter('');
    setActorFilter('');
    loadAudit();
  };

  // ── Admins-only gate ───────────────────────────────────────────────────────
  if (!isAdmin) {
    return (
      <div className="admin-page">
        <div className="empty-state admin-locked">
          <ShieldOff size={40} />
          <h3>Admins only</h3>
          <p>
            This area manages users, governance controls, and the audit trail.
            You&apos;re currently {currentUser?.name || 'an unknown user'}
            {currentUser?.role ? ` (${ROLE_LABELS[currentUser.role] || currentUser.role})` : ''} —
            switch to an admin identity from the topbar to continue.
          </p>
          <p className="admin-locked-note">
            <Info size={13} /> Identities are demo-only. Connect SSO for real authentication.
          </p>
        </div>
      </div>
    );
  }

  // ── Tab renderers ──────────────────────────────────────────────────────────
  const renderUsers = () => (
    <section className="card admin-card">
      <div className="admin-card-header">
        <div className="admin-card-title">
          <Users size={18} />
          <h3>Users &amp; Roles</h3>
        </div>
        <span className="badge badge-neutral">{users.length} user{users.length === 1 ? '' : 's'}</span>
      </div>
      <p className="admin-card-hint">
        Demo identities — there is no real authentication. Role changes apply immediately and are audit-logged.
        The last remaining admin can&apos;t be deleted or demoted.
      </p>

      {users.length === 0 ? (
        <div className="admin-inline-empty">
          <AlertTriangle size={16} />
          <span>No users found — local storage may be unavailable.</span>
          <button className="btn btn-secondary admin-btn-xs" onClick={refreshUsers}>
            <RefreshCw size={13} /> Retry
          </button>
        </div>
      ) : (
        <ul className="user-list">
          {users.map(user => (
            <li key={user.id} className="user-row-wrap">
              <div className="user-row">
                <span className="user-avatar" aria-hidden="true">{(user.name || '?').charAt(0).toUpperCase()}</span>
                <div className="user-meta">
                  <p className="user-name">
                    {user.name}
                    {user.id === currentUser?.id && <span className="badge badge-info user-you">You</span>}
                  </p>
                  <p className="user-id">{user.id}</p>
                </div>
                <div className="user-actions">
                  <label className="sr-only" htmlFor={`role-${user.id}`}>Role for {user.name}</label>
                  <select
                    id={`role-${user.id}`}
                    className="input-field user-role-select"
                    value={user.role}
                    onChange={e => handleRoleChange(user, e.target.value)}
                  >
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
                  </select>
                  {confirmDeleteId === user.id ? (
                    <>
                      <button className="btn btn-danger admin-btn-sm" onClick={() => handleDelete(user)}>
                        <Trash2 size={13} /> Confirm
                      </button>
                      <button className="btn btn-secondary admin-btn-sm" onClick={() => setConfirmDeleteId(null)}>
                        <X size={13} /> Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      className="btn btn-danger admin-btn-sm"
                      title={`Delete ${user.name}`}
                      onClick={() => { setConfirmDeleteId(user.id); clearRowError(user.id); }}
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  )}
                </div>
              </div>
              {rowErrors[user.id] && (
                <p className="inline-error" role="alert">
                  <AlertTriangle size={13} /> {rowErrors[user.id]}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <form className="add-user-form" onSubmit={handleAddUser}>
        <div className="add-user-fields">
          <input
            className="input-field add-user-name"
            placeholder="New user name"
            value={newName}
            onChange={e => { setNewName(e.target.value); if (addError) setAddError(null); }}
            aria-label="New user name"
          />
          <select
            className="input-field add-user-role"
            value={newRole}
            onChange={e => setNewRole(e.target.value)}
            aria-label="New user role"
          >
            {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r] || r}</option>)}
          </select>
          <button type="submit" className="btn btn-primary admin-btn-sm">
            <UserPlus size={14} /> Add user
          </button>
        </div>
        {addError && (
          <p className="inline-error" role="alert">
            <AlertTriangle size={13} /> {addError}
          </p>
        )}
      </form>
    </section>
  );

  const renderGovernance = () => (
    <>
      <section className="card admin-card">
        <div className="admin-card-header">
          <div className="admin-card-title">
            <SlidersHorizontal size={18} />
            <h3>Governance controls</h3>
          </div>
          {featureFlags.soloMode && <span className="badge badge-warning">Gates bypassed</span>}
        </div>
        <p className="admin-card-hint">
          These switches write to shared settings and mirror the Governance &amp; Delivery card in Settings.
        </p>

        <div className="gov-row">
          <span className="icon-chip gov-row-icon"><Zap size={17} /></span>
          <div className="gov-row-text">
            <p className="gov-row-title">Solo mode</p>
            <p className="gov-row-desc">
              Skips all three sign-off gates so a single person can run the full pipeline.
              Use for demos or solo work — every gate is bypassed while this is on.
            </p>
          </div>
          <Switch
            on={featureFlags.soloMode}
            label="Solo mode"
            onToggle={() => saveSettings({ soloMode: !featureFlags.soloMode })}
          />
        </div>

        <div className="gov-row">
          <span className="icon-chip gov-row-icon"><EyeOff size={17} /></span>
          <div className="gov-row-text">
            <p className="gov-row-title">PII &amp; secret redaction</p>
            <p className="gov-row-desc">
              Scans transcripts for emails, phone numbers, card numbers, keys, and secrets before
              anything reaches the AI, with a review step to confirm what stays masked.
            </p>
          </div>
          <Switch
            on={featureFlags.redactionEnabled}
            label="PII and secret redaction"
            onToggle={() => saveSettings({ redactionEnabled: !featureFlags.redactionEnabled })}
          />
        </div>

        <div className="gov-row">
          <span className="icon-chip gov-row-icon"><Package size={17} /></span>
          <div className="gov-row-text">
            <p className="gov-row-title">Handoff mode</p>
            <p className="gov-row-desc">
              Work packets commit a reviewable <code>tasks/&#123;KEY&#125;.md</code> spec per story for coding
              agents; AI scaffold generates and commits starter code directly.
            </p>
          </div>
          <div className="gov-segment" role="radiogroup" aria-label="Handoff mode">
            <button
              type="button"
              className={`gov-segment-btn ${featureFlags.handoffMode === 'packets' ? 'active' : ''}`}
              aria-pressed={featureFlags.handoffMode === 'packets'}
              onClick={() => saveSettings({ handoffMode: 'packets' })}
            >
              <Package size={13} /> Work packets
            </button>
            <button
              type="button"
              className={`gov-segment-btn ${featureFlags.handoffMode === 'scaffold' ? 'active' : ''}`}
              aria-pressed={featureFlags.handoffMode === 'scaffold'}
              onClick={() => saveSettings({ handoffMode: 'scaffold' })}
            >
              <Code2 size={13} /> AI scaffold
            </button>
          </div>
        </div>
      </section>

      <section className="card admin-card">
        <div className="admin-card-header">
          <div className="admin-card-title">
            <Shield size={18} />
            <h3>The three sign-off gates</h3>
          </div>
        </div>
        <p className="admin-card-hint">
          Unless solo mode is on, these named sign-offs gate the pipeline. Each can only be given by a
          user holding the matching permission, and every sign-off or revoke is audit-logged.
        </p>
        <div className="gate-grid">
          <div className="gate-tile neu-inset">
            <FileCheck2 size={18} />
            <p className="gate-title">PRD sign-off</p>
            <p className="gate-desc">TPM (or admin) approves the PRD. Required before user stories can be generated.</p>
          </div>
          <div className="gate-tile neu-inset">
            <Wrench size={18} />
            <p className="gate-title">Engineering sign-off</p>
            <p className="gate-desc">Engineering Lead reviews the stories. Required, with QA, before publish.</p>
          </div>
          <div className="gate-tile neu-inset">
            <FlaskConical size={18} />
            <p className="gate-title">QA sign-off</p>
            <p className="gate-desc">QA Lead confirms testability and coverage. Required, with Engineering, before publish.</p>
          </div>
        </div>
      </section>
    </>
  );

  const renderAudit = () => (
    <section className="card admin-card">
      <div className="admin-card-header">
        <div className="admin-card-title">
          <ScrollText size={18} />
          <h3>Audit Trail</h3>
        </div>
        <span className="badge badge-neutral">
          {filteredEntries.length === entries.length
            ? `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`
            : `${filteredEntries.length} of ${entries.length}`}
        </span>
      </div>
      <p className="admin-card-hint">
        Every mutation — human or AI — is recorded locally (newest first, capped at 1,000 entries).
      </p>

      <div className="audit-toolbar">
        <select
          className="input-field audit-filter"
          value={actionFilter}
          onChange={e => setActionFilter(e.target.value)}
          aria-label="Filter by action"
        >
          <option value="">All actions</option>
          {actionOptions.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select
          className="input-field audit-filter"
          value={actorFilter}
          onChange={e => setActorFilter(e.target.value)}
          aria-label="Filter by actor"
        >
          <option value="">All actors</option>
          {actorOptions.map(a => (
            <option key={a.id} value={a.id}>{a.name} ({ROLE_LABELS[a.role] || a.role})</option>
          ))}
        </select>
        <div className="audit-toolbar-actions">
          <button className="btn btn-secondary admin-btn-sm" onClick={loadAudit} title="Reload entries">
            <RefreshCw size={13} /> Refresh
          </button>
          <button
            className="btn btn-secondary admin-btn-sm"
            onClick={exportAudit}
            disabled={filteredEntries.length === 0}
            title="Download the current view as JSON"
          >
            <Download size={13} /> Export JSON
          </button>
          {confirmClear ? (
            <>
              <button className="btn btn-danger admin-btn-sm" onClick={handleClearAudit}>
                <Trash2 size={13} /> Confirm clear
              </button>
              <button className="btn btn-secondary admin-btn-sm" onClick={() => setConfirmClear(false)}>
                <X size={13} /> Cancel
              </button>
            </>
          ) : (
            <button
              className="btn btn-danger admin-btn-sm"
              onClick={() => setConfirmClear(true)}
              disabled={entries.length === 0}
            >
              <Trash2 size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      {auditError && (
        <p className="inline-error" role="alert">
          <AlertTriangle size={13} /> {auditError}
        </p>
      )}

      {entries.length === 0 ? (
        <div className="admin-inline-empty">
          <ScrollText size={16} />
          <span>No audit entries yet. Story edits, sign-offs, role changes, and publishes will appear here.</span>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className="admin-inline-empty">
          <Info size={16} />
          <span>No entries match the current filters.</span>
          <button
            className="btn btn-secondary admin-btn-xs"
            onClick={() => { setActionFilter(''); setActorFilter(''); }}
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table audit-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Field</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map(e => {
                const before = formatValue(e.before);
                const after = formatValue(e.after);
                return (
                  <tr key={e.id}>
                    <td className="audit-time">{e.ts ? new Date(e.ts).toLocaleString() : '—'}</td>
                    <td>
                      <span className="audit-actor">{e.actor?.name || 'Unknown'}</span>
                      <span className="audit-actor-role">{ROLE_LABELS[e.actor?.role] || e.actor?.role || '—'}</span>
                    </td>
                    <td>
                      <span className="audit-action">{e.action}</span>
                      {e.viaAI && <span className="badge badge-info audit-ai"><Bot size={10} /> AI</span>}
                      {e.reason && <span className="audit-reason" title={e.reason}>Reason: {formatValue(e.reason, 60)}</span>}
                    </td>
                    <td>
                      <span className="audit-entity">{e.entityType || '—'}</span>
                      {e.entityId && <span className="audit-entity-id">{formatValue(e.entityId, 24)}</span>}
                    </td>
                    <td className="audit-field">{e.field || '—'}</td>
                    <td className="audit-change">
                      {before === null && after === null ? (
                        <span className="audit-nochange">—</span>
                      ) : (
                        <>
                          {before !== null && <span className="audit-before">{before}</span>}
                          {before !== null && after !== null && <span className="audit-arrow">→</span>}
                          {after !== null && <span className="audit-after">{after}</span>}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );

  const renderPermissions = () => (
    <section className="card admin-card">
      <div className="admin-card-header">
        <div className="admin-card-title">
          <KeyRound size={18} />
          <h3>Permission matrix</h3>
        </div>
      </div>
      <p className="admin-card-hint">
        Fixed in this build — assign roles in Users &amp; Roles. Admin holds every permission;
        Viewer is read-only.
      </p>
      <div className="admin-table-wrap">
        <table className="admin-table perms-table">
          <thead>
            <tr>
              <th>Permission</th>
              {ROLES.map(r => <th key={r} className="perm-role-col">{ROLE_LABELS[r] || r}</th>)}
            </tr>
          </thead>
          <tbody>
            {Object.values(PERMS).map(perm => (
              <tr key={perm}>
                <td className="perm-name">
                  <span>{PERM_LABELS[perm] || perm}</span>
                  <code className="perm-code">{perm}</code>
                </td>
                {ROLES.map(role => (
                  <td key={role} className="perm-cell">
                    {can({ id: 'matrix', name: 'matrix', role }, perm)
                      ? <Check size={15} className="perm-yes" aria-label={`${ROLE_LABELS[role] || role} allowed`} />
                      : <Minus size={14} className="perm-no" aria-label={`${ROLE_LABELS[role] || role} not allowed`} />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="admin-page">
      <header className="page-header">
        <div>
          <h1 className="page-title">Admin <span className="accent-italic">Console</span></h1>
          <p className="page-subtitle">
            Manage users and roles, governance controls, and the full audit trail.
          </p>
        </div>
        <div className="page-actions">
          <span className="badge badge-neutral" title="Demo identity — connect SSO for real auth">
            <Shield size={11} /> Admin-only area
          </span>
        </div>
      </header>

      <div className="admin-tabs" role="tablist" aria-label="Admin sections">
        {TABS.map(tab => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            className={`admin-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => openTab(tab.id)}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div className="admin-tab-content">
        {activeTab === 'users' && renderUsers()}
        {activeTab === 'governance' && renderGovernance()}
        {activeTab === 'audit' && renderAudit()}
        {activeTab === 'permissions' && renderPermissions()}
      </div>
    </div>
  );
};
