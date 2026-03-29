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

// Health
export const checkBackendHealth = () => request('GET', '/health');
