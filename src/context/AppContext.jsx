import React, { createContext, useContext, useState, useCallback } from 'react';
import { mockStories, mockProjectStats } from '../mocks';
import * as api from '../services/apiService';

const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  const [stories, setStories] = useState([]);
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
        const total = pipelines.filter(p => p.status === 'completed').length;
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

  const setStoriesFromExtraction = async (extractedStories, pipelineId) => {
    setStories(extractedStories);
    setApprovedStoryIds(new Set());
    setDiscardedStoryIds(new Set());
    setJiraIssues({});
    setBitbucketBranches({});
    setConfluencePages([]);
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
  };

  const approveStory = (id) => {
    setApprovedStoryIds(prev => new Set([...prev, id]));
    setDiscardedStoryIds(prev => { const s = new Set(prev); s.delete(id); return s; });
  };

  const discardStory = (id) => {
    setDiscardedStoryIds(prev => new Set([...prev, id]));
    setApprovedStoryIds(prev => { const s = new Set(prev); s.delete(id); return s; });
  };

  const approveAll = () => {
    setApprovedStoryIds(new Set(stories.map(s => s.id)));
    setDiscardedStoryIds(new Set());
  };

  const updateStory = (id, updates) => {
    setStories(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
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
      logPipelineEvent, completePipeline
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
