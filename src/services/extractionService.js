let storyCounter = 1;

const generateId = () => `story-${storyCounter++}`;

const RISK_KEYWORDS = [
  'risk', 'concern', 'issue', 'problem', 'might fail', 'could fail', 'dependency',
  'blocker', 'limitation', 'constraint', 'security', 'performance', 'scalab',
  'timeout', 'latency', 'quota', 'rate limit', 'cost', 'expensive', 'downtime',
  'migration', 'breaking change', 'deprecated', 'legacy'
];

const STORY_INDICATORS = [
  /as\s+a\s+\w/i,
  /user\s+(should|must|wants?|needs?|can)/i,
  /we\s+(need|should|must|want|have to)/i,
  /(?:should|must|need to|have to)\s+(?:be able to|support|allow|enable|create|build|implement|add|update|fix|integrate)/i,
  /(?:feature|functionality|capability|requirement|story):/i,
  /(?:implement|build|create|add|develop|design)\s+(?:a|an|the)/i,
];

const STORY_TITLES_PATTERNS = [
  /(?:feature|story|task|ticket):\s*(.+)/i,
  /(?:implement|build|create|add)\s+(.+?)(?:\.|$)/i,
  /(?:as a .+?,? I want to)\s+(.+?)(?:so that|\.|\n|$)/i,
];

const extractRisks = (text) => {
  const risks = [];
  const lines = text.split(/\n|\./).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    for (const kw of RISK_KEYWORDS) {
      if (line.toLowerCase().includes(kw) && line.length > 20 && line.length < 300) {
        risks.push({ id: `r-${Math.random().toString(36).slice(2,6)}`, type: 'warning', text: line.slice(0, 200) });
        break;
      }
    }
    if (risks.length >= 3) break;
  }
  return risks;
};

const extractAcceptanceCriteria = (paragraphs) => {
  const ac = [];
  for (const p of paragraphs) {
    if (/(?:must|should|shall|when|given|then|acceptance|criteria|require)/i.test(p) && p.length > 30) {
      ac.push(p.slice(0, 200));
    }
    if (ac.length >= 4) break;
  }
  if (ac.length === 0) {
    ac.push('Feature must function as described in the requirements.');
    ac.push('All edge cases must be handled gracefully with appropriate error messaging.');
    ac.push('Implementation must pass code review and QA sign-off.');
  }
  return ac;
};

const generateQaScenarios = (title, description) => {
  const safeName = title.replace(/[^a-zA-Z0-9 ]/g, '').trim();
  return [
    `Feature: ${safeName}\n\n  Scenario: Happy path\n    Given the user is authenticated\n    When they use the ${safeName} feature\n    Then it should work as expected and return success`,
    `  Scenario: Error handling\n    Given the system encounters an error\n    When processing ${safeName}\n    Then a user-friendly error message should be displayed`
  ];
};

const generateSolutionOptions = (title, description) => {
  return {
    options: [
      {
        id: 'opt-1',
        name: 'Iterative Implementation (Recommended)',
        description: `Break the ${title} feature into incremental milestones. Deliver a working MVP first, then iterate based on feedback.`,
        pros: ['Lower risk', 'Faster time to value', 'Easier to course-correct'],
        cons: ['Multiple release cycles needed', 'Feature parity takes longer'],
        complexity: 'Medium',
        recommended: true
      },
      {
        id: 'opt-2',
        name: 'Full Feature Release',
        description: `Implement all aspects of ${title} in a single comprehensive release.`,
        pros: ['Complete solution delivered at once', 'No migration complexity'],
        cons: ['Higher upfront effort', 'Longer time to first delivery', 'Higher risk'],
        complexity: 'High',
        recommended: false
      }
    ]
  };
};

const segmentIntoStories = (text) => {
  const paragraphs = text.split(/\n{2,}|\r\n{2,}/).map(p => p.trim()).filter(p => p.length > 30);
  const segments = [];
  let currentSegment = [];

  for (const para of paragraphs) {
    const isStoryStart = STORY_INDICATORS.some(rx => rx.test(para));
    if (isStoryStart && currentSegment.length > 0) {
      segments.push(currentSegment.join('\n'));
      currentSegment = [para];
    } else {
      currentSegment.push(para);
    }
  }
  if (currentSegment.length > 0) segments.push(currentSegment.join('\n'));

  if (segments.length <= 1 && paragraphs.length > 3) {
    const chunkSize = Math.ceil(paragraphs.length / Math.min(5, Math.max(2, Math.floor(paragraphs.length / 3))));
    segments.length = 0;
    for (let i = 0; i < paragraphs.length; i += chunkSize) {
      segments.push(paragraphs.slice(i, i + chunkSize).join('\n'));
    }
  }

  return segments.slice(0, 8);
};

const deriveTitle = (segment, index) => {
  for (const rx of STORY_TITLES_PATTERNS) {
    const m = segment.match(rx);
    if (m) {
      const title = m[1].replace(/\n.*/s, '').trim().slice(0, 80);
      if (title.length > 10) return title;
    }
  }
  const firstLine = segment.split('\n')[0].trim().slice(0, 80);
  if (firstLine.length > 10) return firstLine;
  return `Requirement ${index + 1}`;
};

export const extractStoriesFromText = (combinedText) => {
  storyCounter = 1;
  const segments = segmentIntoStories(combinedText);

  const allLines = combinedText.split(/\n|\./).map(l => l.trim()).filter(Boolean);

  return segments.map((segment, idx) => {
    const paragraphs = segment.split('\n').map(l => l.trim()).filter(l => l.length > 20);
    const title = deriveTitle(segment, idx);
    const description = paragraphs.slice(0, 3).join(' ').slice(0, 500) || `Implement ${title}.`;
    const risks = extractRisks(segment);
    const ac = extractAcceptanceCriteria(paragraphs);
    const qa = generateQaScenarios(title, description);
    const solution = generateSolutionOptions(title, description);

    const depsCount = idx > 0 ? (Math.random() > 0.5 ? 1 : 0) : 0;
    const dependencies = depsCount > 0 ? [`story-${idx}`] : [];

    return {
      id: generateId(),
      title,
      description: description.slice(0, 500),
      acceptanceCriteria: ac,
      storyPoints: [3, 5, 8, 13][Math.floor(Math.random() * 4)],
      adjustedPoints: [3, 5, 8, 13][Math.floor(Math.random() * 4)],
      qaScenarios: qa,
      riskFlags: risks,
      solution,
      dependencies,
      status: 'pending'
    };
  });
};

export const extractStoriesFromFiles = async (texts) => {
  const combined = texts.join('\n\n---\n\n');
  return extractStoriesFromText(combined);
};
