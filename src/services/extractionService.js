import { extractStoriesFromAI } from './apiService';

let storyCounter = 1;
const generateId = () => `story-${storyCounter++}`;

// Fallback local extraction if AI is unavailable
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
      id: generateId(), title, description,
      acceptanceCriteria: ['Feature must function as described.', 'All edge cases handled with appropriate errors.', 'Implementation must pass code review and QA.'],
      storyPoints: [3, 5, 8, 13][Math.floor(Math.random() * 4)],
      adjustedPoints: [3, 5, 8, 13][Math.floor(Math.random() * 4)],
      qaScenarios: [`Feature: ${title}\n\n  Scenario: Happy path\n    Given the user is authenticated\n    When they use the feature\n    Then it should work as expected`],
      riskFlags: extractRisksLocal(seg),
      solution: { options: [{ id: 'opt-1', name: 'Standard Implementation', description: `Implement ${title} using best practices.`, pros: ['Well understood', 'Maintainable'], cons: ['May need iteration'], complexity: 'Medium', recommended: true }] },
      dependencies: idx > 0 && Math.random() > 0.5 ? [`story-${idx}`] : [],
      status: 'pending'
    };
  });
};

export const extractStoriesFromFiles = async (texts) => {
  const combined = texts.join('\n\n---\n\n');
  const fileNames = [];

  try {
    const result = await extractStoriesFromAI(combined, fileNames);
    const stories = result.stories || [];
    // Ensure all required fields exist
    return stories.map((s, i) => ({
      id: s.id || `story-${i + 1}`,
      title: s.title || `Story ${i + 1}`,
      description: s.description || '',
      acceptanceCriteria: Array.isArray(s.acceptanceCriteria) ? s.acceptanceCriteria : [],
      storyPoints: s.storyPoints || 5,
      adjustedPoints: s.adjustedPoints || s.storyPoints || 5,
      qaScenarios: Array.isArray(s.qaScenarios) ? s.qaScenarios : [],
      riskFlags: Array.isArray(s.riskFlags) ? s.riskFlags : [],
      solution: s.solution || { options: [] },
      dependencies: Array.isArray(s.dependencies) ? s.dependencies : [],
      status: 'pending'
    }));
  } catch (err) {
    console.warn('AI extraction failed, falling back to local parser:', err.message);
    return localExtract(combined);
  }
};
