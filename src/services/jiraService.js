const PROJECT_KEY = typeof __JIRA_PROJECT_KEY__ !== 'undefined' ? __JIRA_PROJECT_KEY__ : 'KAN';
const DOMAIN = typeof __ATLASSIAN_DOMAIN__ !== 'undefined' ? __ATLASSIAN_DOMAIN__ : '';

export const getJiraBaseUrl = () => `https://${DOMAIN}`;

const jiraPost = async (path, body) => {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
};

// ─── PROJECT TYPE DETECTION ────────────────────────────────────────────────────
// Cached per-session so we only call once per pipeline run.
// next-gen (team-managed) projects: use `parent` for epic linking, no customfield_10016
// classic (company-managed) projects: use customfield_10014 + customfield_10016
let _projectTypeCache = null;

export const getJiraProjectStyle = async () => {
  if (_projectTypeCache !== null) return _projectTypeCache;
  try {
    const res = await fetch(`/api/jira/project/${PROJECT_KEY}`);
    const data = await res.json();
    _projectTypeCache = data.style === 'next-gen' ? 'next-gen' : 'classic';
  } catch {
    _projectTypeCache = 'classic';
  }
  return _projectTypeCache;
};

export const resetJiraProjectStyleCache = () => { _projectTypeCache = null; };

// ─── EPIC ──────────────────────────────────────────────────────────────────────

export const createJiraEpic = async (epicName) => {
  // Try with customfield_10011 (classic projects require Epic Name field)
  // Fall back without it for next-gen projects
  const baseFields = {
    project: { key: PROJECT_KEY },
    summary: epicName,
    issuetype: { name: 'Epic' }
  };

  for (const fields of [
    { ...baseFields, customfield_10011: epicName },
    baseFields
  ]) {
    try {
      const { ok, data } = await jiraPost('/api/jira/issue', { fields });
      if (ok) return { success: true, key: data.key, id: data.id, url: `${getJiraBaseUrl()}/browse/${data.key}` };
      // If the error is only about customfield_10011, try next iteration
      if (!data.errors?.customfield_10011 && !data.errors?.['Epic Name']) {
        return { success: false, error: data.errorMessages?.join(', ') || JSON.stringify(data.errors || data) };
      }
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'Failed to create Epic' };
};

// ─── STORY ─────────────────────────────────────────────────────────────────────

const buildStoryADF = (story) => {
  const acPositive = story.acceptanceCriteria || [];
  const acNegative = story.negativeAcceptanceCriteria || [];
  const risks = story.riskFlags || [];
  const qaScenarios = story.qaScenarios || [];

  const makeBulletList = (items) => ({
    type: 'bulletList',
    content: items.map(text => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: String(text) }] }]
    }))
  });

  const makeHeading = (text, level = 3) => ({
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }]
  });

  // ADF codeBlock requires non-empty text; use a placeholder comment when empty
  const gherkinText = qaScenarios.filter(s => typeof s === 'string' && s.trim()).join('\n\n');

  const content = [
    makeHeading('User Story', 2),
    { type: 'paragraph', content: [{ type: 'text', text: story.description || 'No description provided.' }] },

    makeHeading('Positive Acceptance Criteria'),
    makeBulletList(acPositive.length > 0 ? acPositive : ['No positive criteria defined.']),

    makeHeading('Negative Acceptance Criteria'),
    makeBulletList(acNegative.length > 0 ? acNegative : ['No negative criteria defined.']),

    ...(story.technicalNotes ? [
      makeHeading('Technical Notes'),
      { type: 'paragraph', content: [{ type: 'text', text: story.technicalNotes }] }
    ] : []),

    ...(risks.length > 0 ? [
      makeHeading('Risk Flags'),
      makeBulletList(risks.map(r => (typeof r === 'object' ? r.text : r)).filter(Boolean))
    ] : []),

    makeHeading('QA Scenarios'),
    {
      type: 'codeBlock',
      attrs: { language: 'gherkin' },
      content: [{ type: 'text', text: gherkinText || '# No QA scenarios defined' }]
    }
  ];

  return { type: 'doc', version: 1, content };
};

const parseJiraError = (data) =>
  data.errorMessages?.join(', ') || JSON.stringify(data.errors || data).slice(0, 300);

export const createJiraStory = async (story, epicKey = null) => {
  const projectStyle = await getJiraProjectStyle();
  const isNextGen = projectStyle === 'next-gen';

  const baseFields = {
    project: { key: PROJECT_KEY },
    summary: story.title,
    description: buildStoryADF(story),
    issuetype: { name: 'Story' },
    // For next-gen projects, epic is linked via `parent` (not Epic Link custom field)
    ...(isNextGen && epicKey ? { parent: { key: epicKey } } : {})
  };

  // Build optional fields — omit next-gen-incompatible fields on the first attempt
  const optionalFields = {
    priority: { name: story.priority || 'Medium' },
    ...(story.labels?.length > 0 ? { labels: story.labels } : {}),
    // Story Points: skip for next-gen (customfield_10016 doesn't exist in team-managed projects)
    ...(isNextGen ? {} : { customfield_10016: story.adjustedPoints || story.storyPoints || 3 }),
    // Epic Link: skip for next-gen (uses `parent` on baseFields instead)
    ...((!isNextGen && epicKey) ? { customfield_10014: epicKey } : {})
  };

  const warnings = [];

  // Attempt 1: full field set (correct for the detected project type)
  try {
    const { ok, data } = await jiraPost('/api/jira/issue', { fields: { ...baseFields, ...optionalFields } });
    if (ok) return { success: true, key: data.key, id: data.id, url: `${getJiraBaseUrl()}/browse/${data.key}`, warnings };

    // Identify which optional fields caused errors and strip them
    const errFields = Object.keys(data.errors || {});
    const isOptionalError = errFields.some(f =>
      ['customfield_10016', 'customfield_10014', 'customfield_10011', 'labels', 'priority', 'Epic Link', 'Story Points'].some(k => f.includes(k) || f === k)
    );

    if (!isOptionalError) {
      console.error('Jira story error (non-field):', data);
      return { success: false, error: parseJiraError(data) };
    }

    // Build a reduced field set, dropping the offending optional fields
    const strippedOptional = { ...optionalFields };
    for (const f of errFields) {
      if (f in strippedOptional) { warnings.push(`Field "${f}" not available in this project — skipped.`); delete strippedOptional[f]; }
      if (f.includes('10016') || f.toLowerCase().includes('story points')) { warnings.push('Story Points field not available — skipped.'); delete strippedOptional.customfield_10016; }
      if (f.includes('10014') || f.toLowerCase().includes('epic')) { warnings.push('Epic Link field not available — story created without epic link.'); delete strippedOptional.customfield_10014; }
      if (f === 'labels') { warnings.push('Labels field rejected — skipped.'); delete strippedOptional.labels; }
      if (f === 'priority') { warnings.push('Priority field rejected — skipped.'); delete strippedOptional.priority; }
    }

    // Attempt 2: stripped optional fields
    const { ok: ok2, data: data2 } = await jiraPost('/api/jira/issue', { fields: { ...baseFields, ...strippedOptional } });
    if (ok2) return { success: true, key: data2.key, id: data2.id, url: `${getJiraBaseUrl()}/browse/${data2.key}`, warnings };

    // Attempt 3: bare minimum — no optional fields at all
    const { ok: ok3, data: data3 } = await jiraPost('/api/jira/issue', { fields: baseFields });
    if (ok3) {
      warnings.push('Created with minimal fields only — all optional fields (story points, priority, labels, epic) were rejected by Jira.');
      return { success: true, key: data3.key, id: data3.id, url: `${getJiraBaseUrl()}/browse/${data3.key}`, warnings };
    }

    console.error('Jira story error (all attempts):', data3);
    return { success: false, error: parseJiraError(data3), warnings };
  } catch (err) {
    return { success: false, error: err.message, warnings };
  }
};

// ─── SUB-TASKS ─────────────────────────────────────────────────────────────────

export const createJiraSubTask = async (parentKey, title, descriptionText) => {
  const baseFields = {
    project: { key: PROJECT_KEY },
    summary: title,
    description: {
      type: 'doc', version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: descriptionText }] }]
    },
    parent: { key: parentKey }
  };

  // Different Jira instances use different casing for this issue type
  const issuetypeNames = ['Subtask', 'Sub-task', 'Sub-Task'];

  for (const name of issuetypeNames) {
    try {
      const { ok, data } = await jiraPost('/api/jira/issue', {
        fields: { ...baseFields, issuetype: { name } }
      });
      if (ok) return { success: true, key: data.key, id: data.id, url: `${getJiraBaseUrl()}/browse/${data.key}` };
      // If failure is about issue type name, try the next one
      if (data.errors?.issuetype) continue;
      // Any other error — stop retrying
      return { success: false, error: data.errorMessages?.join(', ') || JSON.stringify(data.errors || data) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'Sub-task issue type not available in this project' };
};

export const createJiraQASubTask = async (parentKey, story, testCases = []) => {
  const makeHeading = (text, level = 3) => ({
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }]
  });

  const makeBulletList = (items) => ({
    type: 'bulletList',
    content: items.map(text => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
    }))
  });

  const priorityBadge = (p) => {
    const map = { Critical: '🔴', High: '🟠', Medium: '🟡', Low: '🟢' };
    return map[p] || '⚪';
  };

  const typeBadge = (t) => {
    const map = { Positive: '✅', Negative: '❌', 'Edge Case': '⚠️', Performance: '⚡', Security: '🔒' };
    return map[t] || '🧪';
  };

  // Build test case blocks
  const testCaseBlocks = testCases.flatMap((tc, idx) => [
    makeHeading(`${typeBadge(tc.type)} ${tc.id}: ${tc.title}`, 4),
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Type: ${tc.type}  |  Priority: ${priorityBadge(tc.priority)} ${tc.priority}` }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: `Preconditions: ${tc.preconditions || 'None'}` }] }] }
      ]
    },
    makeHeading('Steps', 5),
    {
      type: 'orderedList',
      content: (tc.steps || []).map(step => ({
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: step }] }]
      }))
    },
    makeHeading('Expected Result', 5),
    { type: 'paragraph', content: [{ type: 'text', text: tc.expectedResult || 'See acceptance criteria.' }] },
    ...(idx < testCases.length - 1 ? [{ type: 'rule' }] : [])
  ]);

  const acPositive = story.acceptanceCriteria || [];
  const acNegative = story.negativeAcceptanceCriteria || [];
  const qaScenarios = story.qaScenarios || [];

  const content = [
    makeHeading('Testing Scope', 2),
    { type: 'paragraph', content: [{ type: 'text', text: `Validate all acceptance criteria for: ${story.description}` }] },

    makeHeading('Acceptance Criteria to Verify'),
    ...(acPositive.length > 0 ? [
      makeHeading('Positive', 4),
      makeBulletList(acPositive)
    ] : []),
    ...(acNegative.length > 0 ? [
      makeHeading('Negative / Edge Cases', 4),
      makeBulletList(acNegative)
    ] : []),

    { type: 'rule' },

    makeHeading(`Test Cases (${testCases.length})`),
    ...(testCases.length > 0 ? testCaseBlocks : [
      { type: 'paragraph', content: [{ type: 'text', text: 'No AI-generated test cases available. Refer to acceptance criteria above.' }] }
    ]),

    { type: 'rule' },

    makeHeading('Automation Scenarios (Gherkin)'),
    {
      type: 'codeBlock',
      attrs: { language: 'gherkin' },
      content: [{ type: 'text', text: qaScenarios.join('\n\n') || '# No Gherkin scenarios defined' }]
    }
  ];

  const baseFields = {
    project: { key: PROJECT_KEY },
    summary: `QA: ${story.title}`,
    description: { type: 'doc', version: 1, content },
    parent: { key: parentKey }
  };

  const issuetypeNames = ['Subtask', 'Sub-task', 'Sub-Task'];
  for (const name of issuetypeNames) {
    try {
      const { ok, data } = await jiraPost('/api/jira/issue', {
        fields: { ...baseFields, issuetype: { name } }
      });
      if (ok) return { success: true, key: data.key, id: data.id, url: `${getJiraBaseUrl()}/browse/${data.key}` };
      if (data.errors?.issuetype) continue;
      return { success: false, error: data.errorMessages?.join(', ') || JSON.stringify(data.errors || data) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'Sub-task issue type not available in this project' };
};

// ─── ISSUE LINKING ─────────────────────────────────────────────────────────────

export const linkJiraIssues = async (fromKey, toKey, linkType = 'Blocks') => {
  try {
    await jiraPost('/api/jira/issueLink', {
      type: { name: linkType },
      inwardIssue: { key: toKey },
      outwardIssue: { key: fromKey }
    });
  } catch (err) {
    console.error('Link error:', err);
  }
};

// ─── PROJECTS & VELOCITY ───────────────────────────────────────────────────────

export const getJiraProjects = async () => {
  try {
    const res = await fetch('/api/jira/project');
    if (res.ok) {
      const data = await res.json();
      return { projects: Array.isArray(data) ? data : [], error: null };
    }
    let errMsg = `HTTP ${res.status}`;
    try { const d = await res.json(); const detail = d.message || d.errorMessages?.join(', '); if (detail) errMsg = `HTTP ${res.status} — ${detail}`; } catch {}
    return { projects: [], error: errMsg };
  } catch (err) {
    return { projects: [], error: err.message };
  }
};

export const getJiraVelocity = async (projectKey, maxResults = 50) => {
  try {
    const jql = encodeURIComponent(
      `project = ${projectKey} AND status = Done AND issuetype = Story ORDER BY updated DESC`
    );
    const res = await fetch(
      `/api/jira/search?jql=${jql}&maxResults=${maxResults}&fields=summary,customfield_10016,customfield_10028,resolutiondate`
    );
    if (!res.ok) return { average: null, count: 0, total: 0 };

    const data = await res.json();
    const issues = data.issues || [];
    // customfield_10016 = Story Points in most Jira Cloud instances
    const points = issues
      .map(i => i.fields?.customfield_10016 ?? i.fields?.customfield_10028)
      .filter(p => typeof p === 'number' && p > 0);

    if (points.length === 0) return { average: null, count: 0, total: issues.length };
    const average = points.reduce((a, b) => a + b, 0) / points.length;
    return {
      average: Math.round(average * 10) / 10,
      count: points.length,
      total: issues.length,
      distribution: points
    };
  } catch {
    return { average: null, count: 0, total: 0 };
  }
};
