// Deterministic INVEST / Definition-of-Ready linter for user stories. No AI.
// Approve is blocked while errors exist; OVERRIDE_LINT holders may override with reason.

const VALID_POINTS = [1, 2, 3, 5, 8, 13];
const STORY_FORMAT_RX = /as an?\b[\s\S]*i want[\s\S]*so that/i;
const NEGATIVE_RX = /(not|error|invalid|empty|fail|reject|unauthorized|edge)/i;

// Fresh regex per call — global regexes carry lastIndex state.
const vagueRx = () => /\b(fast|easy|user-friendly|appropriately|etc\.?|and so on|intuitive|seamless|robust)/gi;

const getPoints = (story) => {
  const candidates = [story?.points, story?.adjustedPoints, story?.storyPoints];
  for (const c of candidates) {
    if (Number.isFinite(c)) return c;
  }
  return null;
};

// → { errors: [{rule, message}], warnings: [{rule, message}], score: 0-100 }
export const lintStory = (story, allStories = []) => {
  const errors = [];
  const warnings = [];
  const s = story || {};

  // Title 8–120 chars (error)
  const title = typeof s.title === 'string' ? s.title.trim() : '';
  if (title.length < 8 || title.length > 120) {
    errors.push({
      rule: 'title-length',
      message: `Title must be 8–120 characters (currently ${title.length}).`
    });
  }

  // "As a … I want … so that …" format (warning)
  const description = typeof s.description === 'string' ? s.description : '';
  if (!STORY_FORMAT_RX.test(description)) {
    warnings.push({
      rule: 'story-format',
      message: 'Description does not follow the "As a … I want … so that …" format.'
    });
  }

  // At least 3 acceptance criteria (error)
  const acs = Array.isArray(s.acceptanceCriteria) ? s.acceptanceCriteria : [];
  const negAcs = Array.isArray(s.negativeAcceptanceCriteria) ? s.negativeAcceptanceCriteria : [];
  if (acs.length < 3) {
    errors.push({
      rule: 'ac-count',
      message: `At least 3 acceptance criteria are required (currently ${acs.length}).`
    });
  }

  // No vague wording in ACs (error, lists the offending words)
  const vagueWords = new Set();
  for (const ac of acs) {
    if (typeof ac !== 'string') continue;
    const matches = ac.match(vagueRx());
    if (matches) matches.forEach(w => vagueWords.add(w.toLowerCase()));
  }
  if (vagueWords.size > 0) {
    errors.push({
      rule: 'vague-language',
      message: `Acceptance criteria contain vague, untestable wording: ${[...vagueWords].join(', ')}.`
    });
  }

  // At least one negative / edge-case AC (warning)
  const allAcs = [...acs, ...negAcs].filter(a => typeof a === 'string');
  if (!allAcs.some(a => NEGATIVE_RX.test(a))) {
    warnings.push({
      rule: 'negative-ac',
      message: 'Add at least one negative or edge-case acceptance criterion (errors, invalid input, unauthorized access…).'
    });
  }

  // Points must be Fibonacci ∈ {1,2,3,5,8,13} and <= 13 (error)
  const points = getPoints(s);
  if (!VALID_POINTS.includes(points)) {
    errors.push({
      rule: 'points',
      message: `Story points must be one of 1, 2, 3, 5, 8, 13 and no larger than 13 (currently ${points ?? 'unset'}).`
    });
  }

  // Duplicate title among non-discarded stories (error)
  const norm = title.toLowerCase();
  if (norm) {
    const duplicate = (Array.isArray(allStories) ? allStories : []).some(other =>
      other &&
      other.id !== s.id &&
      other.status !== 'discarded' &&
      typeof other.title === 'string' &&
      other.title.trim().toLowerCase() === norm
    );
    if (duplicate) {
      errors.push({
        rule: 'duplicate-title',
        message: 'Another (non-discarded) story has the same title.'
      });
    }
  }

  const score = Math.max(0, Math.min(100, 100 - errors.length * 20 - warnings.length * 8));
  return { errors, warnings, score };
};

// → Map<storyId, lint result>
export const lintAll = (stories = []) => {
  const list = Array.isArray(stories) ? stories : [];
  const results = new Map();
  for (const story of list) {
    if (!story || story.id == null) continue;
    results.set(story.id, lintStory(story, list));
  }
  return results;
};
