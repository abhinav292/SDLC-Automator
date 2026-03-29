const BASE = '/api/backend';

const request = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
};

// AI Extraction
export const extractStoriesFromAI = (text, fileNames) =>
  request('POST', '/extract', { text, fileNames });

// Pipelines
export const fetchPipelines = () => request('GET', '/pipelines');
export const createPipeline = (data) => request('POST', '/pipelines', data);
export const fetchPipeline = (id) => request('GET', `/pipelines/${id}`);
export const updatePipeline = (id, data) => request('PATCH', `/pipelines/${id}`, data);

// Stories
export const saveStories = (pipelineId, stories) =>
  request('POST', `/pipelines/${pipelineId}/stories`, { stories });
export const updateStory = (pipelineId, storyId, data) =>
  request('PATCH', `/pipelines/${pipelineId}/stories/${storyId}`, data);

// Audit
export const logEvent = (pipelineId, eventType, eventData) =>
  request('POST', `/pipelines/${pipelineId}/audit`, { eventType, eventData });

// Voice Transcript Cleanup
export const cleanTranscript = (rawTranscript) =>
  request('POST', '/clean-transcript', { rawTranscript });

// Health
export const checkBackendHealth = () => request('GET', '/health');

// Jira write-access diagnostic
export const diagnoseJiraWrite = () => request('POST', '/diagnose-jira', {});

// PR Checklist
export const generatePRChecklist = (story) =>
  request('POST', '/generate-pr-checklist', { story });

// Stakeholder Email
export const generateStakeholderEmail = (stories, projectName) =>
  request('POST', '/generate-stakeholder-email', { stories, projectName });

// Slack / Teams notification
export const notifySlack = (webhookUrl, message) =>
  request('POST', '/notify-slack', { webhookUrl, message });

// QA Test Case Generation
export const generateQATasks = (story) =>
  request('POST', '/generate-qa-tasks', { story });

// Code Generation from Jira story + repo context
export const generateCode = (story, repoContext) =>
  request('POST', '/generate-code', { story, repoContext });

// Solutioning document generation from all stories + repo context
export const generateSolutioningDoc = (stories, repoContext, projectName) =>
  request('POST', '/generate-solutioning-doc', { stories, repoContext, projectName });
