// Role-based access control for SDLC Autopilot. There is NO real authentication —
// identities are demo users stored in localStorage and switched from the topbar.
// UI must label this honestly ("Demo identity — connect SSO for real auth").

export const ROLES = ['admin', 'tpm', 'eng_lead', 'qa_lead', 'viewer'];

export const ROLE_LABELS = {
  admin: 'Admin',
  tpm: 'TPM',
  eng_lead: 'Engineering Lead',
  qa_lead: 'QA Lead',
  viewer: 'Viewer'
};

// Permission constants
export const PERMS = {
  MANAGE_USERS: 'manage_users',
  GENERATE_PRD: 'generate_prd',
  EDIT_PRD: 'edit_prd',
  GENERATE_STORIES: 'generate_stories',
  EDIT_STORY: 'edit_story',
  APPROVE_STORY: 'approve_story',
  SIGNOFF_PRD: 'signoff_prd',
  SIGNOFF_ENGINEERING: 'signoff_engineering',
  SIGNOFF_QA: 'signoff_qa',
  PUBLISH: 'publish',
  ROLLBACK: 'rollback',
  OVERRIDE_LINT: 'override_lint',
  VIEW_AUDIT: 'view_audit'
};

// Permission matrix per role. Admin holds every permission.
const ROLE_PERMS = {
  admin: Object.values(PERMS),
  tpm: [
    PERMS.GENERATE_PRD, PERMS.EDIT_PRD, PERMS.GENERATE_STORIES, PERMS.EDIT_STORY,
    PERMS.APPROVE_STORY, PERMS.SIGNOFF_PRD, PERMS.PUBLISH, PERMS.ROLLBACK,
    PERMS.OVERRIDE_LINT, PERMS.VIEW_AUDIT
  ],
  eng_lead: [PERMS.EDIT_STORY, PERMS.SIGNOFF_ENGINEERING, PERMS.VIEW_AUDIT],
  qa_lead: [PERMS.SIGNOFF_QA, PERMS.VIEW_AUDIT],
  viewer: [] // read only
};

export const SEED_USERS = [
  { id: 'u-sarah', name: 'Sarah', role: 'admin' },   // default current user
  { id: 'u-tom',   name: 'Tom',   role: 'tpm' },
  { id: 'u-elena', name: 'Elena', role: 'eng_lead' },
  { id: 'u-quinn', name: 'Quinn', role: 'qa_lead' }
];

const USERS_KEY = 'sdlc_users';
const CURRENT_USER_KEY = 'sdlc_current_user';

const readJSON = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const writeJSON = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
};

// user = {id, name, role}
export const can = (user, perm) => {
  if (!user || !perm) return false;
  const perms = ROLE_PERMS[user.role];
  return Array.isArray(perms) && perms.includes(perm);
};

// Reads 'sdlc_users'; seeds on first call.
export const getUsers = () => {
  const stored = readJSON(USERS_KEY, null);
  if (Array.isArray(stored) && stored.length > 0) return stored;
  const seeded = SEED_USERS.map(u => ({ ...u }));
  writeJSON(USERS_KEY, seeded);
  return seeded;
};

// Persists the user list. Guard: the last remaining admin can never be deleted or
// demoted — in that case nothing is saved and an error string is returned
// (returns null on success).
export const saveUsers = (users) => {
  if (!Array.isArray(users)) return 'Invalid user list.';
  const hadAdmin = getUsers().some(u => u && u.role === 'admin');
  const hasAdmin = users.some(u => u && u.role === 'admin');
  if (hadAdmin && !hasAdmin) return 'Cannot delete or demote the last remaining admin.';
  writeJSON(USERS_KEY, users);
  return null;
};

// Current demo identity — 'sdlc_current_user' stores the user id.
export const getCurrentUser = () => {
  const users = getUsers();
  let id = null;
  try {
    const raw = localStorage.getItem(CURRENT_USER_KEY);
    if (raw != null) {
      try { id = JSON.parse(raw); } catch { id = raw; }
    }
  } catch { /* storage unavailable */ }
  const found = users.find(u => u && u.id === id);
  if (found) return found;
  return users.find(u => u && u.role === 'admin') || users[0] || { ...SEED_USERS[0] };
};

export const setCurrentUser = (id) => {
  writeJSON(CURRENT_USER_KEY, id);
  return getCurrentUser();
};
