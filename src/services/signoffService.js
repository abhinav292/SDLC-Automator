// Sign-off gates stored per pipeline scope (currentPipelineId || 'local').
// Each scope tracks three named sign-offs: prd (TPM), engineering (Eng Lead), qa (QA Lead).
import { recordAudit } from './auditService';

export const SIGNOFF_KINDS = ['prd', 'engineering', 'qa']; // maps to PERMS.SIGNOFF_*

const KEY = 'sdlc_signoffs';

const emptySignoffs = () => ({ prd: null, engineering: null, qa: null });

const readAll = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const writeAll = (all) => {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
};

// → { prd: {by, name, at}|null, engineering: …, qa: … }
export const getSignoffs = (scope = 'local') => {
  const stored = readAll()[scope] || {};
  return {
    prd: stored.prd || null,
    engineering: stored.engineering || null,
    qa: stored.qa || null
  };
};

export const recordSignoff = (scope = 'local', kind, user) => {
  if (!SIGNOFF_KINDS.includes(kind)) return getSignoffs(scope);
  const all = readAll();
  const signoffs = { ...emptySignoffs(), ...(all[scope] || {}) };
  signoffs[kind] = {
    by: user?.id || 'unknown',
    name: user?.name || 'Unknown',
    at: new Date().toISOString()
  };
  all[scope] = signoffs;
  writeAll(all);
  recordAudit({
    action: 'signoff.record',
    entityType: 'signoff',
    entityId: `${scope}:${kind}`,
    field: kind,
    before: null,
    after: signoffs[kind]
  });
  return { ...signoffs };
};

export const revokeSignoff = (scope = 'local', kind, user) => {
  if (!SIGNOFF_KINDS.includes(kind)) return getSignoffs(scope);
  const all = readAll();
  const signoffs = { ...emptySignoffs(), ...(all[scope] || {}) };
  const before = signoffs[kind] || null;
  signoffs[kind] = null;
  all[scope] = signoffs;
  writeAll(all);
  recordAudit({
    action: 'signoff.revoke',
    entityType: 'signoff',
    entityId: `${scope}:${kind}`,
    field: kind,
    before,
    after: null,
    reason: user?.name ? `Revoked by ${user.name}` : undefined
  });
  return { ...signoffs };
};

// True immediately when settings.soloMode is on; otherwise all three sign-offs required.
export const allSignedOff = (scope = 'local', settings = {}) => {
  if (settings?.soloMode) return true;
  const signoffs = getSignoffs(scope);
  return SIGNOFF_KINDS.every(kind => Boolean(signoffs[kind]));
};

// Convenience: clear the given sign-off kinds for a scope without audit noise
// (used when a new story set resets the engineering/qa gates).
export const resetSignoffs = (scope = 'local', kinds = SIGNOFF_KINDS) => {
  const all = readAll();
  const signoffs = { ...emptySignoffs(), ...(all[scope] || {}) };
  for (const kind of kinds) {
    if (SIGNOFF_KINDS.includes(kind)) signoffs[kind] = null;
  }
  all[scope] = signoffs;
  writeAll(all);
  return { ...signoffs };
};
