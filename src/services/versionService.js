// PRD versioning: snapshots (localStorage 'sdlc_prd_versions', cap 30, newest
// first), REQ-ID assignment per PRD section, and an inline LCS line diff — no
// new dependencies.

const KEY = 'sdlc_prd_versions';
const CAP = 30;

const readVersions = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeVersions = (versions) => {
  try { localStorage.setItem(KEY, JSON.stringify(versions)); } catch { /* storage unavailable */ }
};

// One REQ-ID per markdown H2/H3 section; when the PRD has no headings, one per
// numbered requirement bullet. → [{reqId: 'REQ-001', heading, snippet}]
export const assignReqIds = (prdText) => {
  if (typeof prdText !== 'string' || !prdText.trim()) return [];
  const lines = prdText.split('\n');

  const sections = [];
  lines.forEach((line, index) => {
    const m = line.match(/^(##|###)\s+(.+?)\s*$/);
    if (m) sections.push({ heading: m[2].replace(/#+\s*$/, '').trim(), index });
  });

  if (sections.length > 0) {
    return sections.map((section, i) => {
      let snippet = '';
      for (let j = section.index + 1; j < lines.length; j++) {
        const l = lines[j].trim();
        if (!l) continue;
        if (/^#{1,6}\s/.test(l)) break; // next heading, section has no body
        snippet = l.slice(0, 140);
        break;
      }
      return {
        reqId: `REQ-${String(i + 1).padStart(3, '0')}`,
        heading: section.heading,
        snippet
      };
    });
  }

  // No headings — fall back to numbered requirement bullets ("1. …", "2) …").
  const bullets = lines
    .map(l => l.match(/^\s*\d+[.)]\s+(.+)/))
    .filter(Boolean)
    .map(m => m[1].trim());
  return bullets.map((text, i) => ({
    reqId: `REQ-${String(i + 1).padStart(3, '0')}`,
    heading: text.slice(0, 80),
    snippet: text.slice(0, 140)
  }));
};

// → {id, ts, trigger: 'generate'|'save'|'lint_apply', text, reqIds}
export const snapshotPrd = (prdText, { trigger } = {}) => {
  const version = {
    id: `prdv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    trigger: trigger || 'save',
    text: typeof prdText === 'string' ? prdText : '',
    reqIds: assignReqIds(prdText)
  };
  const versions = readVersions();
  versions.unshift(version);
  writeVersions(versions.slice(0, CAP));
  return version;
};

export const getVersions = () => readVersions();

export const getLatestVersionId = () => {
  const versions = readVersions();
  return versions[0]?.id ?? null;
};

// Simple LCS line diff → [{type: 'same'|'add'|'del', line}]
export const diffLines = (oldText, newText) => {
  const a = String(oldText ?? '').split('\n');
  const b = String(newText ?? '').split('\n');

  // Trim common prefix/suffix to keep the DP table small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const result = a.slice(0, start).map(line => ({ type: 'same', line }));

  if (midA.length * midB.length > 1_000_000) {
    // Degenerate guard for enormous diffs: plain replace of the middle block.
    midA.forEach(line => result.push({ type: 'del', line }));
    midB.forEach(line => result.push({ type: 'add', line }));
  } else {
    const n = midA.length;
    const m = midB.length;
    // dp[i][j] = LCS length of midA[i:] and midB[j:]
    const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = midA[i] === midB[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        result.push({ type: 'same', line: midA[i] });
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        result.push({ type: 'del', line: midA[i] });
        i++;
      } else {
        result.push({ type: 'add', line: midB[j] });
        j++;
      }
    }
    while (i < n) { result.push({ type: 'del', line: midA[i] }); i++; }
    while (j < m) { result.push({ type: 'add', line: midB[j] }); j++; }
  }

  a.slice(endA).forEach(line => result.push({ type: 'same', line }));
  return result;
};
