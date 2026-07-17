// PII / secret redaction. Pure regex pass (plus a Luhn check for card numbers)
// that runs over transcripts BEFORE any text reaches an AI provider. Each unique
// original value gets one stable token like ⟦EMAIL_1⟧ so redaction is reversible
// per finding via applyUnredact.

// Luhn checksum for candidate credit-card numbers (digits-only string).
const luhnValid = (digits) => {
  if (!digits || digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
};

const digitCount = (s) => (s.match(/\d/g) || []).length;

// Order matters: more specific patterns first, and dotted/dashed number formats
// (SSN, card, IP) before the loose phone matcher so it cannot swallow them.
const PATTERNS = [
  {
    kind: 'email',
    label: 'EMAIL',
    rx: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
  },
  {
    kind: 'aws_key',
    label: 'AWS_KEY',
    rx: /\bAKIA[0-9A-Z]{16}\b/g
  },
  {
    kind: 'secret',
    label: 'SECRET',
    rx: /(api[_-]?key|secret|token|password)["'\s:=]+\S{8,}/gi
  },
  {
    kind: 'ssn',
    label: 'SSN',
    rx: /\b\d{3}-\d{2}-\d{4}\b/g
  },
  {
    kind: 'card',
    label: 'CARD',
    rx: /\b(?:\d[ -]?){12,18}\d\b/g,
    validate: (m) => luhnValid(m.replace(/[ -]/g, ''))
  },
  {
    kind: 'ip',
    label: 'IP',
    rx: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g
  },
  {
    kind: 'phone',
    label: 'PHONE',
    // International-ish: optional +country code, then 2-6 digit groups with
    // optional separators/parens; validated to 9-15 total digits.
    rx: /\+?\b\d{1,4}(?:[ .-]?\(?\d{1,4}\)?){2,6}\b/g,
    validate: (m) => {
      const n = digitCount(m);
      return n >= 9 && n <= 15;
    }
  }
];

// → { redacted, items: [{token: '⟦EMAIL_1⟧', kind: 'email', original, count}] }
export const redactText = (text) => {
  let redacted = typeof text === 'string' ? text : '';
  const items = [];
  const byOriginal = new Map(); // `${kind}:${original}` → item (stable token per value)
  const counters = {};

  for (const pattern of PATTERNS) {
    const rx = new RegExp(pattern.rx.source, pattern.rx.flags); // fresh lastIndex
    redacted = redacted.replace(rx, (match) => {
      if (pattern.validate && !pattern.validate(match)) return match;
      const mapKey = `${pattern.kind}:${match}`;
      let item = byOriginal.get(mapKey);
      if (!item) {
        counters[pattern.kind] = (counters[pattern.kind] || 0) + 1;
        item = {
          token: `⟦${pattern.label}_${counters[pattern.kind]}⟧`,
          kind: pattern.kind,
          original: match,
          count: 0
        };
        byOriginal.set(mapKey, item);
        items.push(item);
      }
      item.count += 1;
      return item.token;
    });
  }

  return { redacted, items };
};

// Restores every item whose token is NOT in keepTokens (those stay redacted).
export const applyUnredact = (redacted, items = [], keepTokens = new Set()) => {
  const keep = keepTokens instanceof Set ? keepTokens : new Set(keepTokens || []);
  let text = typeof redacted === 'string' ? redacted : '';
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || !item.token || keep.has(item.token)) continue;
    text = text.split(item.token).join(item.original ?? '');
  }
  return text;
};

// UI helper: masked preview of a finding, e.g. "a***@**.com" or "41***11".
export const maskValue = (original = '', kind = '') => {
  const value = String(original);
  if (kind === 'email' && value.includes('@')) {
    const [local, domain = ''] = value.split('@');
    const dot = domain.lastIndexOf('.');
    const tld = dot >= 0 ? domain.slice(dot) : '';
    return `${local.slice(0, 1)}***@**${tld}`;
  }
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}***${value.slice(-2)}`;
};
