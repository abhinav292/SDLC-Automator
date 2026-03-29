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
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
    }))
  });

  const makeHeading = (text, level = 3) => ({
    type: 'heading',
    attrs: { level },
    content: [{ type: 'text', text }]
  });

  const content = [
    makeHeading('User Story', 2),
    { type: 'paragraph', content: [{ type: 'text', text: story.description }] },

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
      makeBulletList(risks.map(r => r.text))
    ] : []),

    makeHeading('QA Scenarios'),
    {
      type: 'codeBlock',
      attrs: { language: 'gherkin' },
      content: [{ type: 'text', text: qaScenarios.join('\n\n') || '# No scenarios defined' }]
    }
  ];

  return { type: 'doc', version: 1, content };
};

export const createJiraStory = async (story, epicKey = null) => {
  const fields = {
    project: { key: PROJECT_KEY },
    summary: story.title,
    description: buildStoryADF(story),
    issuetype: { name: 'Story' },
    priority: { name: story.priority || 'Medium' },
    customfield_10016: story.adjustedPoints || story.storyPoints || 3,
    ...(story.labels?.length > 0 ? { labels: story.labels } : {}),
    // Epic Link — customfield_10014 works in Jira Cloud next-gen and most classic projects
    ...(epicKey ? { customfield_10014: epicKey } : {})
  };

  try {
    const { ok, data } = await jiraPost('/api/jira/issue', { fields });
    if (ok) return { success: true, key: data.key, id: data.id, url: `${getJiraBaseUrl()}/browse/${data.key}` };

    // If only the epic link field failed, retry without it
    if (epicKey && (data.errors?.customfield_10014 || data.errors?.['Epic Link'])) {
      const { customfield_10014, ...fieldsNoEpic } = fields;
      const { ok: ok2, data: data2 } = await jiraPost('/api/jira/issue', { fields: fieldsNoEpic });
      if (ok2) return { success: true, key: data2.key, id: data2.id, url: `${getJiraBaseUrl()}/browse/${data2.key}` };
      return { success: false, error: data2.errorMessages?.join(', ') || JSON.stringify(data2.errors || data2) };
    }

    console.error('Jira story error:', data);
    return { success: false, error: data.errorMessages?.join(', ') || JSON.stringify(data.errors || data) };
  } catch (err) {
    return { success: false, error: err.message };
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
    if (res.ok) return await res.json();
    return [];
  } catch {
    return [];
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
