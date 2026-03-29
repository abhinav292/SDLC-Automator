import { extractStoriesFromAI } from './apiService';

let storyCounter = 1;
const generateId = () => `story-${storyCounter++}`;

const RISK_KEYWORDS = ['risk', 'concern', 'issue', 'problem', 'dependency', 'blocker', 'limitation', 'constraint', 'security', 'performance', 'timeout', 'cost', 'migration'];
const STORY_INDICATORS = [/as\s+a\s+\w/i, /user\s+(should|must|wants?)/i, /we\s+(need|should|must)/i, /(?:should|must|need to)\s+(?:support|allow|enable|create|build|implement)/i];

const extractRisksLocal = (text) => {
  const risks = [];
  const lines = text.split(/\n|\./).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (RISK_KEYWORDS.some(kw => line.toLowerCase().includes(kw)) && line.length > 20 && line.length < 300) {
      risks.push({ id: `r-${Math.random().toString(36).slice(2, 6)}`, type: 'warning', text: line.slice(0, 200) });
      if (risks.length >= 3) break;
    }
  }
  return risks;
};

const segmentIntoStories = (text) => {
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 30);
  const segments = [];
  let current = [];
  for (const para of paragraphs) {
    const isStart = STORY_INDICATORS.some(rx => rx.test(para));
    if (isStart && current.length > 0) { segments.push(current.join('\n')); current = [para]; }
    else current.push(para);
  }
  if (current.length > 0) segments.push(current.join('\n'));
  if (segments.length <= 1 && paragraphs.length > 3) {
    const size = Math.ceil(paragraphs.length / Math.min(5, Math.max(2, Math.floor(paragraphs.length / 3))));
    return Array.from({ length: Math.ceil(paragraphs.length / size) }, (_, i) => paragraphs.slice(i * size, (i + 1) * size).join('\n'));
  }
  return segments.slice(0, 8);
};

const localExtract = (text) => {
  storyCounter = 1;
  const segments = segmentIntoStories(text);
  return segments.map((seg, idx) => {
    const lines = seg.split('\n').map(l => l.trim()).filter(l => l.length > 20);
    const title = lines[0]?.slice(0, 80) || `Requirement ${idx + 1}`;
    const description = lines.slice(0, 3).join(' ').slice(0, 500) || `Implement ${title}.`;
    return {
      id: generateId(),
      title,
      description,
      acceptanceCriteria: ['Feature must function as described.', 'All edge cases handled with appropriate errors.', 'Implementation must pass code review and QA.'],
      negativeAcceptanceCriteria: ['System returns an appropriate error for invalid input.', 'Unauthorised users cannot access the feature.'],
      storyPoints: [3, 5, 8, 13][Math.floor(Math.random() * 4)],
      adjustedPoints: [3, 5, 8, 13][Math.floor(Math.random() * 4)],
      priority: 'Medium',
      labels: [],
      technicalNotes: '',
      qaScenarios: [`Feature: ${title}\n\n  Scenario: Happy path\n    Given the user is authenticated\n    When they use the feature\n    Then it should work as expected`],
      riskFlags: extractRisksLocal(seg),
      solution: { options: [{ id: 'opt-1', name: 'Standard Implementation', description: `Implement ${title} using best practices.`, pros: ['Well understood', 'Maintainable'], cons: ['May need iteration'], complexity: 'Medium', recommended: true }] },
      dependencies: idx > 0 && Math.random() > 0.5 ? [`story-${idx}`] : [],
      status: 'pending'
    };
  });
};

const coerceRiskFlags = (raw) => {
  if (!Array.isArray(raw)) return [];
  return raw.map((r, i) => {
    if (r && typeof r === 'object' && typeof r.text === 'string') {
      return {
        id: r.id || `r-${i}`,
        type: r.type === 'error' ? 'error' : 'warning',
        text: r.text
      };
    }
    if (typeof r === 'string') {
      return { id: `r-${i}`, type: 'warning', text: r };
    }
    return null;
  }).filter(Boolean);
};

const coerceSolutionOptions = (raw) => {
  if (!raw || typeof raw !== 'object') return { options: [] };
  const opts = Array.isArray(raw.options) ? raw.options : [];
  return {
    options: opts.map((o, i) => ({
      id: o.id || `opt-${i + 1}`,
      name: typeof o.name === 'string' ? o.name : `Option ${i + 1}`,
      description: typeof o.description === 'string' ? o.description : '',
      pros: Array.isArray(o.pros) ? o.pros.filter(p => typeof p === 'string') : [],
      cons: Array.isArray(o.cons) ? o.cons.filter(c => typeof c === 'string') : [],
      complexity: ['Low', 'Medium', 'High'].includes(o.complexity) ? o.complexity : 'Medium',
      recommended: Boolean(o.recommended)
    }))
  };
};

const normaliseStory = (s, i) => ({
  id: typeof s.id === 'string' && s.id ? s.id : `story-${i + 1}`,
  title: typeof s.title === 'string' && s.title ? s.title.slice(0, 120) : `Story ${i + 1}`,
  description: typeof s.description === 'string' ? s.description : '',
  acceptanceCriteria: Array.isArray(s.acceptanceCriteria) ? s.acceptanceCriteria.filter(a => typeof a === 'string') : [],
  negativeAcceptanceCriteria: Array.isArray(s.negativeAcceptanceCriteria) ? s.negativeAcceptanceCriteria.filter(a => typeof a === 'string') : [],
  storyPoints: Number.isFinite(s.storyPoints) && s.storyPoints > 0 ? s.storyPoints : 5,
  adjustedPoints: Number.isFinite(s.adjustedPoints) && s.adjustedPoints > 0 ? s.adjustedPoints : (Number.isFinite(s.storyPoints) && s.storyPoints > 0 ? s.storyPoints : 5),
  priority: ['High', 'Medium', 'Low'].includes(s.priority) ? s.priority : 'Medium',
  labels: Array.isArray(s.labels) ? s.labels.filter(l => typeof l === 'string').map(l => l.toLowerCase().replace(/[^a-z0-9-]/g, '')) : [],
  technicalNotes: typeof s.technicalNotes === 'string' ? s.technicalNotes : '',
  qaScenarios: Array.isArray(s.qaScenarios) ? s.qaScenarios.filter(q => typeof q === 'string') : [],
  riskFlags: coerceRiskFlags(s.riskFlags),
  solution: coerceSolutionOptions(s.solution),
  epic: typeof s.epic === 'string' ? s.epic.trim() : '',
  dependencies: Array.isArray(s.dependencies) ? s.dependencies.filter(d => typeof d === 'string') : [],
  status: 'pending'
});

export const extractStoriesFromFiles = async (texts) => {
  const combined = texts.join('\n\n---\n\n');

  try {
    const result = await extractStoriesFromAI(combined, []);
    const raw = result.stories || [];
    if (!Array.isArray(raw) || raw.length === 0) {
      console.warn('AI returned empty or non-array stories, falling back to local parser');
      return { stories: localExtract(combined), truncated: false };
    }
    return { stories: raw.map(normaliseStory), truncated: Boolean(result.truncated), model: result.model, usage: result.usage };
  } catch (err) {
    console.warn('AI extraction failed, falling back to local parser:', err.message);
    return { stories: localExtract(combined), truncated: false };
  }
};
