// Coding-agent work packets. Instead of committing blind AI scaffolds, Handoff
// (in "packets" mode) commits one tasks/{JIRA-KEY}.md spec file per story that a
// coding agent (Copilot, Claude Code, …) can pick up and implement.
import { getJiraBaseUrl } from './jiraService';

const getPoints = (story) => {
  const candidates = [story?.points, story?.adjustedPoints, story?.storyPoints];
  for (const c of candidates) {
    if (Number.isFinite(c)) return c;
  }
  return null;
};

const jiraBrowseUrl = (jiraKey) => {
  if (!jiraKey) return null;
  try {
    const base = getJiraBaseUrl();
    // Unconfigured Jira yields a bare "https://" — no usable link then.
    if (!base || /^https?:\/\/$/.test(base)) return null;
    return `${base}/browse/${jiraKey}`;
  } catch {
    return null;
  }
};

// → { path: 'tasks/{jiraKey}.md', content }
export const buildWorkPacket = (story = {}, { jiraKey, prdExcerpt, repoLabel, figmaLinks } = {}) => {
  const key = jiraKey || story.id || 'STORY';
  const title = story.title || 'Untitled story';
  const points = getPoints(story);
  const labels = Array.isArray(story.labels) ? story.labels.filter(Boolean) : [];
  const acs = Array.isArray(story.acceptanceCriteria) ? story.acceptanceCriteria.filter(Boolean) : [];
  const negAcs = Array.isArray(story.negativeAcceptanceCriteria) ? story.negativeAcceptanceCriteria.filter(Boolean) : [];
  const scenarios = Array.isArray(story.qaScenarios) ? story.qaScenarios.filter(Boolean) : [];
  const quotes = Array.isArray(story.sourceQuotes) ? story.sourceQuotes.filter(q => q && q.quote) : [];
  const design = (Array.isArray(figmaLinks) && figmaLinks.length > 0)
    ? figmaLinks
    : (Array.isArray(story.figmaLinks) ? story.figmaLinks : []);
  const jiraUrl = jiraBrowseUrl(jiraKey);

  const lines = [];
  lines.push(`# ${key} — ${title}`);
  lines.push('');

  const metaBits = [];
  if (points != null) metaBits.push(`**Points:** ${points}`);
  if (story.priority) metaBits.push(`**Priority:** ${story.priority}`);
  if (labels.length) metaBits.push(`**Labels:** ${labels.join(', ')}`);
  if (story.prdSection) metaBits.push(`**PRD section:** ${story.prdSection}`);
  if (repoLabel) metaBits.push(`**Repository:** ${repoLabel}`);
  if (metaBits.length) {
    lines.push(metaBits.join(' · '));
    lines.push('');
  }

  lines.push('## Story');
  lines.push('');
  lines.push(story.description || '_No description provided._');
  lines.push('');

  lines.push('## Acceptance criteria');
  lines.push('');
  if (acs.length) {
    acs.forEach(ac => lines.push(`- [ ] ${ac}`));
  } else {
    lines.push('_None captured — confirm scope with the TPM before starting._');
  }
  lines.push('');

  if (negAcs.length) {
    lines.push('## Negative / edge cases');
    lines.push('');
    negAcs.forEach(ac => lines.push(`- [ ] ${ac}`));
    lines.push('');
  }

  if (story.technicalNotes) {
    lines.push('## Technical notes');
    lines.push('');
    lines.push(story.technicalNotes);
    lines.push('');
  }

  if (scenarios.length) {
    lines.push('## QA scenarios (Gherkin)');
    lines.push('');
    scenarios.forEach(scenario => {
      lines.push('```gherkin');
      lines.push(scenario);
      lines.push('```');
      lines.push('');
    });
  }

  if (prdExcerpt) {
    lines.push('## PRD context');
    lines.push('');
    String(prdExcerpt).split('\n').forEach(l => lines.push(`> ${l}`));
    lines.push('');
  }

  if (quotes.length) {
    lines.push('## Source citations');
    lines.push('');
    lines.push('Verbatim transcript lines this story derives from:');
    lines.push('');
    quotes.forEach(q => {
      lines.push(`> ${q.quote}${q.file ? `  \n> — _${q.file}_` : ''}`);
      lines.push('');
    });
  }

  const linkLines = [];
  if (jiraUrl) linkLines.push(`- Jira: [${jiraKey}](${jiraUrl})`);
  else if (jiraKey) linkLines.push(`- Jira: ${jiraKey}`);
  design.filter(Boolean).forEach(url => linkLines.push(`- Figma: ${url}`));
  if (linkLines.length) {
    lines.push('## Links');
    lines.push('');
    linkLines.forEach(l => lines.push(l));
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('## Agent instructions');
  lines.push('');
  lines.push('This file is a work packet for a coding agent (GitHub Copilot, Claude Code, or similar).');
  lines.push('');
  lines.push('1. Read this entire spec before writing code; the acceptance criteria are the definition of done.');
  lines.push('2. Implement the change on this branch following the existing patterns and conventions of the repository.');
  lines.push('3. Cover every acceptance criterion, including the negative / edge cases, with automated tests where the repo has a test setup.');
  lines.push('4. Do not expand scope beyond this story; note follow-ups as comments in the PR instead.');
  lines.push(`5. Reference ${jiraKey || 'the Jira issue'} in your commit messages and open questions.`);
  lines.push('');

  return { path: `tasks/${key}.md`, content: lines.join('\n') };
};
