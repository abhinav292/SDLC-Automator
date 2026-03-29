import React, { createContext, useContext, useState } from 'react';
import { mockStories, mockProjectStats } from '../mocks';

const AppContext = createContext(null);

export const AppProvider = ({ children }) => {
  const [stories, setStories] = useState([]);
  const [approvedStoryIds, setApprovedStoryIds] = useState(new Set());
  const [discardedStoryIds, setDiscardedStoryIds] = useState(new Set());
  const [pipelineStats, setPipelineStats] = useState(mockProjectStats);
  const [jiraIssues, setJiraIssues] = useState({});
  const [bitbucketBranches, setBitbucketBranches] = useState({});
  const [confluencePages, setConfluencePages] = useState([]);
  const [settings, setSettings] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('sdlc_settings') || '{}');
    } catch {
      return {};
    }
  });

  const saveSettings = (newSettings) => {
    const merged = { ...settings, ...newSettings };
    setSettings(merged);
    localStorage.setItem('sdlc_settings', JSON.stringify(merged));
  };

  const setStoriesFromExtraction = (extractedStories) => {
    setStories(extractedStories);
    setApprovedStoryIds(new Set());
    setDiscardedStoryIds(new Set());
    setJiraIssues({});
    setBitbucketBranches({});
    setConfluencePages([]);
  };

  const loadMockStories = () => {
    setStories(mockStories);
    setApprovedStoryIds(new Set());
    setDiscardedStoryIds(new Set());
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

  return (
    <AppContext.Provider value={{
      stories, setStories,
      approvedStoryIds, discardedStoryIds,
      pipelineStats, setPipelineStats,
      jiraIssues, setJiraIssues,
      bitbucketBranches, setBitbucketBranches,
      confluencePages, setConfluencePages,
      settings, saveSettings,
      setStoriesFromExtraction, loadMockStories,
      approveStory, discardStory, approveAll, updateStory,
      getActiveStories, getApprovedStories
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
