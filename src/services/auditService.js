// Field-level audit trail. Every mutation (human or AI) is recorded locally in
// localStorage 'sdlc_audit_trail' (cap 1000 entries, newest first) and, when a
// pipeline id is provided, fire-and-forget mirrored to the backend audit log.
import { getCurrentUser } from './authzService';
import { logEvent } from './apiService';

const KEY = 'sdlc_audit_trail';
const CAP = 1000;
const VALUE_CAP = 2000; // keep stored before/after values a sane size

const readEntries = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeEntries = (entries) => {
  try { localStorage.setItem(KEY, JSON.stringify(entries)); } catch { /* storage unavailable */ }
};

const truncateValue = (v) => {
  if (typeof v === 'string' && v.length > VALUE_CAP) return `${v.slice(0, VALUE_CAP)}…`;
  return v === undefined ? null : v;
};

// Records one audit entry. Actor ({id, name, role} from getCurrentUser) and ts are
// attached automatically. Pass optional pipelineId to mirror to the backend.
export const recordAudit = ({
  action,
  entityType,
  entityId,
  field,
  before,
  after,
  viaAI = false,
  reason,
  pipelineId
} = {}) => {
  let actor = { id: 'unknown', name: 'Unknown', role: 'viewer' };
  try {
    const u = getCurrentUser();
    if (u) actor = { id: u.id, name: u.name, role: u.role };
  } catch { /* keep fallback actor */ }

  const entry = {
    id: `audit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    ts: new Date().toISOString(),
    action: action || 'unknown',
    entityType: entityType ?? null,
    entityId: entityId ?? null,
    field: field ?? null,
    before: truncateValue(before),
    after: truncateValue(after),
    viaAI: Boolean(viaAI),
    reason: reason ?? null,
    actor
  };

  const entries = readEntries();
  entries.unshift(entry);
  writeEntries(entries.slice(0, CAP));

  if (pipelineId) {
    try {
      Promise.resolve(logEvent(pipelineId, entry.action, entry)).catch(() => { /* fire-and-forget */ });
    } catch { /* fire-and-forget */ }
  }

  return entry;
};

// filter: { entityType, entityId, actorId, action }
export const getAudit = (filter = {}) => {
  const entries = readEntries();
  const { entityType, entityId, actorId, action } = filter || {};
  return entries.filter(e =>
    (!entityType || e.entityType === entityType) &&
    (!entityId || e.entityId === entityId) &&
    (!actorId || e.actor?.id === actorId) &&
    (!action || e.action === action)
  );
};

// Admin only — permission enforced at the call site.
export const clearAudit = () => {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
};
