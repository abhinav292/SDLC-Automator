const PROJECT_KEY = typeof __JIRA_PROJECT_KEY__ !== 'undefined' ? __JIRA_PROJECT_KEY__ : 'KAN';
const DOMAIN = typeof __ATLASSIAN_DOMAIN__ !== 'undefined' ? __ATLASSIAN_DOMAIN__ : '';

export const getJiraBaseUrl = () => `https://${DOMAIN}`;

export const createJiraStory = async (story) => {
  const body = {
    fields: {
      project: { key: PROJECT_KEY },
      summary: story.title,
      description: {
        type: 'doc',
        version: 1,
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: story.description }]
          },
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Acceptance Criteria' }]
          },
          {
            type: 'bulletList',
            content: story.acceptanceCriteria.map(ac => ({
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: ac }] }]
            }))
          },
          ...(story.riskFlags.length > 0 ? [
            {
              type: 'heading',
              attrs: { level: 3 },
              content: [{ type: 'text', text: 'Risk Flags' }]
            },
            {
              type: 'bulletList',
              content: story.riskFlags.map(r => ({
                type: 'listItem',
                content: [{ type: 'paragraph', content: [{ type: 'text', text: r.text }] }]
              }))
            }
          ] : []),
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'QA Scenarios' }]
          },
          {
            type: 'codeBlock',
            attrs: { language: 'gherkin' },
            content: [{ type: 'text', text: story.qaScenarios.join('\n\n') }]
          }
        ]
      },
      issuetype: { name: 'Story' },
      story_points: story.adjustedPoints
    }
  };

  try {
    const res = await fetch('/api/jira/issue', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Atlassian-Token': 'no-check'
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok) {
      return { success: true, key: data.key, id: data.id, url: `${getJiraBaseUrl()}/browse/${data.key}` };
    } else {
      console.error('Jira error:', data);
      return { success: false, error: data.errorMessages?.join(', ') || JSON.stringify(data.errors || data) };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
};

export const linkJiraIssues = async (fromKey, toKey, linkType = 'Blocks') => {
  try {
    const body = {
      type: { name: linkType },
      inwardIssue: { key: toKey },
      outwardIssue: { key: fromKey }
    };
    await fetch('/api/jira/issueLink', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    console.error('Link error:', err);
  }
};

export const getJiraProjects = async () => {
  try {
    const res = await fetch('/api/jira/project');
    if (res.ok) return await res.json();
    return [];
  } catch {
    return [];
  }
};
