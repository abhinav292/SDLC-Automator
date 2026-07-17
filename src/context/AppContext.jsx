import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import { mockStories, mockProjectStats } from '../mocks';
import * as api from '../services/apiService';
import { getUsers, getCurrentUser, setCurrentUser as authzSetCurrentUser } from '../services/authzService';
import { getSignoffs, recordSignoff, revokeSignoff, allSignedOff } from '../services/signoffService';
import { recordAudit } from '../services/auditService';
import { snapshotPrd, getLatestVersionId } from '../services/versionService';

const AppContext = createContext(null);

// Audit logging must never break a core mutation — wrap defensively.
const safeAudit = (entry) => {
  try { recordAudit(entry); } catch (err) { console.warn('Audit log failed:', err?.message); }
};

export const AppProvider = ({ children }) => {
  const [stories, setStories] = useState([]);
  const [prd, setPrd] = useState('');
  const [prdSource, setPrdSource] = useState('');
  const [currentPipelineId, setCurrentPipelineId] = useState(null);
  const [approvedStoryIds, setApprovedStoryIds] = useState(new Set());
  const [discardedStoryIds, setDiscardedStoryIds] = useState(new Set());
  const [pipelineStats, setPipelineStats] = useState(mockProjectStats);
  const [pipelineHistory, setPipelineHistory] = useState([]);
  const [jiraIssues, setJiraIssues] = useState({});
  const [bitbucketBranches, setBitbucketBranches] = useState({});
  const [confluencePages, setConfluencePages] = useState([]);
  const [settings, setSettings] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sdlc_settings') || '{}'); }
    catch { return {}; }
  });

  // ── Identity (demo — no real auth) ────────────────────────────────────────
  const [users, setUsers] = useState(() => {
    try { return getUsers(); } catch { return []; }
  });
  const [currentUser, setCurrentUserState] = useState(() => {
    try { return getCurrentUser(); } catch { return null; }
  });

  const refreshUsers = useCallback(() => {
    try {
      setUsers(getUsers());
      setCurrentUserState(getCurrentUser());
    } catch (err) {
      console.warn('Could not refresh users:', err?.message);
    }
  }, []);

  const switchUser = useCallback((id) => {
    try {
      const user = authzSetCurrentUser(id);
      setCurrentUserState(user);
    } catch (err) {
      console.warn('Could not switch user:', err?.message);
    }
  }, []);

  // ── Sign-offs (scoped per pipeline; 'local' before any pipeline exists) ───
  const signoffScope = currentPipelineId || 'local';

  const [signoffs, setSignoffs] = useState(() => {
    try { return getSignoffs('local'); } catch { return { prd: null, engineering: null, qa: null }; }
  });

  // Recompute sign-offs whenever the pipeline scope changes (render-time
  // state adjustment — avoids a cascading setState-in-effect).
  const [prevSignoffScope, setPrevSignoffScope] = useState(signoffScope);
  if (prevSignoffScope !== signoffScope) {
    setPrevSignoffScope(signoffScope);
    try { setSignoffs(getSignoffs(signoffScope)); }
    catch { setSignoffs({ prd: null, engineering: null, qa: null }); }
  }

  const doSignoff = useCallback((kind) => {
    try {
      const next = recordSignoff(signoffScope, kind, getCurrentUser());
      setSignoffs(next);
      return next;
    } catch (err) {
      console.warn('Could not record sign-off:', err?.message);
      return signoffs;
    }
  }, [signoffScope, signoffs]);

  const undoSignoff = useCallback((kind) => {
    try {
      const next = revokeSignoff(signoffScope, kind, getCurrentUser());
      setSignoffs(next);
      return next;
    } catch (err) {
      console.warn('Could not revoke sign-off:', err?.message);
      return signoffs;
    }
  }, [signoffScope, signoffs]);

  // Recomputes on every render of signoffs/settings state changes; cheap read.
  let signoffsComplete = false;
  try { signoffsComplete = allSignedOff(signoffScope, settings); } catch { signoffsComplete = false; }

  // ── Feature flags (derived from settings, with defaults) ──────────────────
  const featureFlags = useMemo(() => ({
    redactionEnabled: settings.redactionEnabled !== false,
    handoffMode: settings.handoffMode || 'packets',
    soloMode: settings.soloMode === true
  }), [settings]);

  // ── Multi-transcript synthesis contradictions ─────────────────────────────
  const [contradictions, setContradictions] = useState([]);

  // ── PRD version tracking for stale-story detection ────────────────────────
  const [storiesPrdVersionId, setStoriesPrdVersionId] = useState(null);

  const saveSettings = (newSettings) => {
    const merged = { ...settings, ...newSettings };
    setSettings(merged);
    localStorage.setItem('sdlc_settings', JSON.stringify(merged));
  };

  const loadPipelineHistory = useCallback(async () => {
    try {
      const pipelines = await api.fetchPipelines();
      setPipelineHistory(pipelines);
      if (pipelines.length > 0) {
        const pushed = pipelines.reduce((sum, p) => sum + (parseInt(p.approved_count) || 0), 0);
        setPipelineStats(prev => ({
          ...prev,
          pipelineRuns: pipelines.length,
          storiesPushed: pushed || prev.storiesPushed
        }));
      }
    } catch (err) {
      console.warn('Could not load pipeline history:', err.message);
    }
  }, []);

  // Store a freshly generated PRD (and the source text it was derived from) at the
  // start of a run. This is the editable checkpoint before Jira stories are generated.
  const setPrdFromGeneration = async (prdText, sourceText, pipelineId) => {
    setPrd(prdText);
    setPrdSource(sourceText || '');
    // Reset any downstream artifacts from a previous run
    setStories([]);
    setApprovedStoryIds(new Set());
    setDiscardedStoryIds(new Set());
    setJiraIssues({});
    setBitbucketBranches({});
    setConfluencePages([]);
    try { snapshotPrd(prdText, { trigger: 'generate' }); }
    catch (err) { console.warn('PRD snapshot failed:', err?.message); }
    safeAudit({
      action: 'prd.generate',
      entityType: 'prd',
      entityId: 'prd',
      viaAI: true,
      pipelineId: pipelineId || currentPipelineId || undefined
    });
    if (pipelineId) {
      setCurrentPipelineId(pipelineId);
      try { await api.logEvent(pipelineId, 'prd_generated', { length: prdText.length }); } catch { /* non-fatal */ }
    }
  };

  // Save a manual PRD edit: snapshot a version + audit. Used by the PRD page.
  const savePrdEdit = (text) => {
    const before = prd;
    setPrd(text);
    try { snapshotPrd(text, { trigger: 'save' }); }
    catch (err) { console.warn('PRD snapshot failed:', err?.message); }
    safeAudit({
      action: 'prd.save',
      entityType: 'prd',
      entityId: 'prd',
      before,
      after: text,
      pipelineId: currentPipelineId || undefined
    });
  };

  const setStoriesFromExtraction = async (extractedStories, pipelineId) => {
    setStories(extractedStories);
    setApprovedStoryIds(new Set());
    setDiscardedStoryIds(new Set());
    setJiraIssues({});
    setBitbucketBranches({});
    setConfluencePages([]);
    // Remember which PRD version these stories were generated from (stale detection).
    try { setStoriesPrdVersionId(getLatestVersionId()); }
    catch { setStoriesPrdVersionId(null); }
    // New stories invalidate the engineering/QA reviews for this scope.
    // (PRD sign-off belongs to the PRD stage and is left intact.)
    const newScope = pipelineId || currentPipelineId || 'local';
    try {
      const existing = getSignoffs(newScope);
      const user = getCurrentUser();
      let next = existing;
      if (existing?.engineering) next = revokeSignoff(newScope, 'engineering', user);
      if (existing?.qa) next = revokeSignoff(newScope, 'qa', user);
      setSignoffs(next || getSignoffs(newScope));
    } catch (err) {
      console.warn('Could not reset sign-offs:', err?.message);
    }
    if (pipelineId) {
      setCurrentPipelineId(pipelineId);
      try {
        await api.saveStories(pipelineId, extractedStories);
        await api.logEvent(pipelineId, 'extraction_completed', { storyCount: extractedStories.length });
      } catch (err) {
        console.warn('Could not persist stories:', err.message);
      }
    }
  };

  const loadMockStories = () => {
    setStories(mockStories);
    setApprovedStoryIds(new Set());
    setDiscardedStoryIds(new Set());
    setCurrentPipelineId(null);
    setContradictions([]);
    // Align with the latest PRD version so demo stories never show a spurious
    // "Stale — PRD changed" badge left over from an earlier real run.
    try { setStoriesPrdVersionId(getLatestVersionId()); }
    catch { setStoriesPrdVersionId(null); }
  };

  const approveStory = (id) => {
    setApprovedStoryIds(prev => new Set([...prev, id]));
    setDiscardedStoryIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    safeAudit({
      action: 'story.approve',
      entityType: 'story',
      entityId: id,
      pipelineId: currentPipelineId || undefined
    });
  };

  const discardStory = (id) => {
    setDiscardedStoryIds(prev => new Set([...prev, id]));
    setApprovedStoryIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    safeAudit({
      action: 'story.discard',
      entityType: 'story',
      entityId: id,
      pipelineId: currentPipelineId || undefined
    });
  };

  const approveAll = () => {
    setApprovedStoryIds(new Set(stories.map(s => s.id)));
    setDiscardedStoryIds(new Set());
  };

  const updateStory = (id, updates) => {
    const before = stories.find(s => s.id === id);
    setStories(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    if (before && updates && typeof updates === 'object') {
      Object.keys(updates).forEach(field => {
        const prevVal = before[field];
        const nextVal = updates[field];
        let changed;
        try { changed = JSON.stringify(prevVal) !== JSON.stringify(nextVal); }
        catch { changed = prevVal !== nextVal; }
        if (changed) {
          safeAudit({
            action: 'story.update',
            entityType: 'story',
            entityId: id,
            field,
            before: prevVal,
            after: nextVal,
            pipelineId: currentPipelineId || undefined
          });
        }
      });
    }
  };

  const getActiveStories = () => stories.filter(s => !discardedStoryIds.has(s.id));
  const getApprovedStories = () => stories.filter(s => approvedStoryIds.has(s.id));

  const logPipelineEvent = async (eventType, eventData) => {
    if (!currentPipelineId) return;
    try { await api.logEvent(currentPipelineId, eventType, eventData); } catch {}
  };

  const completePipeline = async (jiraMap, confluenceUrl) => {
    if (!currentPipelineId) return;
    try {
      const keys = Object.values(jiraMap).filter(r => r?.success).map(r => r.key);
      await api.updatePipeline(currentPipelineId, {
        status: 'completed',
        approvedCount: getApprovedStories().length,
        jiraKeys: keys,
        confluenceUrl: confluenceUrl || null
      });
      await loadPipelineHistory();
    } catch (err) {
      console.warn('Could not complete pipeline:', err.message);
    }
  };

  return (
    <AppContext.Provider value={{
      stories, setStories,
      prd, setPrd, prdSource,
      setPrdFromGeneration,
      savePrdEdit,
      currentPipelineId, setCurrentPipelineId,
      approvedStoryIds, discardedStoryIds,
      pipelineStats, setPipelineStats,
      pipelineHistory, loadPipelineHistory,
      jiraIssues, setJiraIssues,
      bitbucketBranches, setBitbucketBranches,
      confluencePages, setConfluencePages,
      settings, saveSettings,
      setStoriesFromExtraction, loadMockStories,
      approveStory, discardStory, approveAll, updateStory,
      getActiveStories, getApprovedStories,
      logPipelineEvent, completePipeline,
      currentUser, users, switchUser, refreshUsers,
      signoffs, doSignoff, undoSignoff, signoffsComplete,
      storiesPrdVersionId,
      featureFlags,
      contradictions, setContradictions
    }}>
      {children}
    </AppContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components -- context hook lives with its provider by design
export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
