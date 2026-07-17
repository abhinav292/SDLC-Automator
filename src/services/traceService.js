// Traceability matrix assembly: REQ-IDs from the latest PRD version → stories →
// published Jira issues / branches / PRs. buildTraceRows is pure (no fetching);
// refreshJiraStatuses polls Jira for live status on demand.
import { getIssueStatus } from './jiraService';

const normalise = (s) => String(s || '').trim().toLowerCase();

// args: { stories, approvedStoryIds, jiraIssues, manifests, prdVersions, storiesPrdVersionId? }
// → [{reqId, prdHeading, storyId, storyTitle, approved, jiraKey, jiraUrl, branch, prUrl, stale}]
export const buildTraceRows = ({
  stories = [],
  approvedStoryIds = [],
  jiraIssues = {},
  manifests = [],
  prdVersions = [],
  storiesPrdVersionId = null
} = {}) => {
  const latest = (Array.isArray(prdVersions) && prdVersions[0]) || null;
  const reqIds = Array.isArray(latest?.reqIds) ? latest.reqIds : [];
  const stale = Boolean(latest?.id && storiesPrdVersionId && latest.id !== storiesPrdVersionId);

  const approvedSet = new Set(Array.isArray(approvedStoryIds) ? approvedStoryIds : []);
  const activeStories = (Array.isArray(stories) ? stories : [])
    .filter(s => s && s.status !== 'discarded');

  // Published artifact lookup across manifests (newest first): storyId → links.
  const artifactByStory = {};
  for (const manifest of (Array.isArray(manifests) ? manifests : [])) {
    for (const artifact of (Array.isArray(manifest?.artifacts) ? manifest.artifacts : [])) {
      const storyId = artifact?.meta?.storyId;
      if (!storyId) continue;
      const slot = artifactByStory[storyId] || (artifactByStory[storyId] = {});
      if (artifact.type === 'jira_story' && !slot.jiraKey) {
        slot.jiraKey = artifact.key || null;
        slot.jiraUrl = artifact.url || null;
      } else if (artifact.type === 'git_branch' && !slot.branch) {
        slot.branch = artifact.key || null;
      } else if (artifact.type === 'git_pr' && !slot.prUrl) {
        slot.prUrl = artifact.url || null;
      }
    }
  }

  // Match a story to a REQ via its prdSection heading (or explicit reqId).
  const findReq = (story) => {
    if (story.reqId) {
      const byId = reqIds.find(r => r.reqId === story.reqId);
      if (byId) return byId;
    }
    const section = normalise(story.prdSection);
    if (!section) return null;
    return reqIds.find(r => {
      const heading = normalise(r.heading);
      return heading && (heading === section || heading.includes(section) || section.includes(heading));
    }) || null;
  };

  const rows = [];
  const coveredReqIds = new Set();

  for (const story of activeStories) {
    const req = findReq(story);
    if (req?.reqId) coveredReqIds.add(req.reqId);
    const jira = jiraIssues?.[story.id] || null;
    const published = artifactByStory[story.id] || {};
    rows.push({
      reqId: req?.reqId || null,
      prdHeading: req?.heading || story.prdSection || '',
      storyId: story.id,
      storyTitle: story.title || '',
      approved: approvedSet.has(story.id),
      jiraKey: (jira?.success !== false && jira?.key) || published.jiraKey || story.linkedIssueKey || null,
      jiraUrl: (jira?.success !== false && jira?.url) || published.jiraUrl || null,
      branch: published.branch || null,
      prUrl: published.prUrl || null,
      stale
    });
  }

  // REQs with no non-discarded story → "dropped scope" rows.
  for (const req of reqIds) {
    if (!req?.reqId || coveredReqIds.has(req.reqId)) continue;
    rows.push({
      reqId: req.reqId,
      prdHeading: req.heading || '',
      storyId: null,
      storyTitle: null,
      approved: false,
      jiraKey: null,
      jiraUrl: null,
      branch: null,
      prUrl: null,
      stale
    });
  }

  // Stable order: rows with a REQ-ID first (numeric order), unmapped stories last.
  rows.sort((a, b) => {
    if (a.reqId && b.reqId) return a.reqId.localeCompare(b.reqId, undefined, { numeric: true });
    if (a.reqId) return -1;
    if (b.reqId) return 1;
    return 0;
  });

  return rows;
};

// Polls live Jira status for each row's issue (deduped, Promise.allSettled — a
// failed lookup leaves that row unchanged). → rows with `jiraStatus` (+assignee).
export const refreshJiraStatuses = async (rows = []) => {
  const list = Array.isArray(rows) ? rows : [];
  const keys = [...new Set(list.filter(r => r?.jiraKey).map(r => r.jiraKey))];
  if (keys.length === 0) return list.map(r => ({ ...r }));

  const settled = await Promise.allSettled(keys.map(key => getIssueStatus(key)));
  const infoByKey = {};
  settled.forEach((result, i) => {
    if (result.status === 'fulfilled' && result.value) infoByKey[keys[i]] = result.value;
  });

  return list.map(row => {
    const info = row?.jiraKey ? infoByKey[row.jiraKey] : null;
    return info
      ? { ...row, jiraStatus: info.status || null, jiraAssignee: info.assignee || null }
      : { ...row };
  });
};
