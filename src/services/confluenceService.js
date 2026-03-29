const DOMAIN = typeof __ATLASSIAN_DOMAIN__ !== 'undefined' ? __ATLASSIAN_DOMAIN__ : '';

export const getConfluenceBaseUrl = () => `https://${DOMAIN}/wiki`;

export const createConfluencePage = async (spaceKey, title, stories) => {
  if (!spaceKey) return { success: false, error: 'No Confluence space key configured. Please set it in Settings.' };

  const storiesHtml = stories.map(s => `
    <h3>${s.title} (${s.adjustedPoints} pts)</h3>
    <p>${s.description}</p>
    <h4>Acceptance Criteria</h4>
    <ul>${s.acceptanceCriteria.map(ac => `<li>${ac}</li>`).join('')}</ul>
    ${s.riskFlags.length > 0 ? `<h4>Risk Flags</h4><ul>${s.riskFlags.map(r => `<li><ac:emoticon ac:name="warning"/> ${r.text}</li>`).join('')}</ul>` : ''}
    <h4>Technical Solution</h4>
    <p><strong>Recommended Approach:</strong> ${s.solution.options.find(o => o.recommended)?.name || s.solution.options[0]?.name}</p>
    <p>${s.solution.options.find(o => o.recommended)?.description || ''}</p>
    <h4>QA Scenarios</h4>
    <pre><code class="language-gherkin">${s.qaScenarios.join('\n\n')}</code></pre>
    <hr/>
  `).join('');

  const body = {
    type: 'page',
    title: `SDLC Autopilot - ${title} - ${new Date().toLocaleDateString()}`,
    space: { key: spaceKey },
    body: {
      storage: {
        value: `
          <h1>SDLC Autopilot - Solutioning Document</h1>
          <p><strong>Generated:</strong> ${new Date().toLocaleString()}</p>
          <p><strong>Stories:</strong> ${stories.length}</p>
          <p><strong>Total Story Points:</strong> ${stories.reduce((s, st) => s + st.adjustedPoints, 0)}</p>
          <hr/>
          <h2>Extracted Stories &amp; Technical Proposals</h2>
          ${storiesHtml}
        `,
        representation: 'storage'
      }
    }
  };

  try {
    const res = await fetch('/api/confluence/content', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Atlassian-Token': 'no-check' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok) {
      return {
        success: true,
        id: data.id,
        url: `${getConfluenceBaseUrl()}${data._links?.webui || `/spaces/${spaceKey}`}`
      };
    } else {
      return { success: false, error: data.message || JSON.stringify(data) };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
};

export const getConfluenceSpaces = async () => {
  try {
    const res = await fetch('/api/confluence/space?limit=20');
    if (res.ok) {
      const data = await res.json();
      return data.results || [];
    }
    return [];
  } catch {
    return [];
  }
};
