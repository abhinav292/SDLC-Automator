// Provider-agnostic Git facade. The Handoff pipeline and Settings talk to this
// module; it dispatches to the Bitbucket / GitHub / GitLab adapters based on the
// selected provider in settings. Branch/PR/commit results share a common shape:
//   { success, error?, name?, url?, id? }
import * as bb from './bitbucketService';
import * as gh from './githubService';
import * as gl from './gitlabService';

export const GIT_PROVIDERS = [
  { id: 'bitbucket', label: 'Bitbucket' },
  { id: 'github', label: 'GitHub' },
  { id: 'gitlab', label: 'GitLab' }
];

export const getGitProvider = (settings) => settings?.gitProvider || 'bitbucket';
export const getGitProviderLabel = (provider) =>
  GIT_PROVIDERS.find(p => p.id === provider)?.label || 'Git';

export const getGitDefaultBranch = (settings) => {
  switch (getGitProvider(settings)) {
    case 'github': return settings.ghDefaultBranch || 'main';
    case 'gitlab': return settings.glDefaultBranch || 'main';
    default: return settings.bbDefaultBranch || 'master';
  }
};

// True when enough repo identity is configured for the selected provider.
export const isGitConfigured = (settings) => {
  switch (getGitProvider(settings)) {
    case 'github': return !!(settings.ghOwner && settings.ghRepo);
    case 'gitlab': return !!settings.glProject;
    default: return !!(settings.bbWorkspace && settings.bbRepo);
  }
};

// Human-readable "where code goes" label for the confirmation screen.
export const getGitRepoLabel = (settings) => {
  switch (getGitProvider(settings)) {
    case 'github': return isGitConfigured(settings) ? `${settings.ghOwner}/${settings.ghRepo}` : '';
    case 'gitlab': return isGitConfigured(settings) ? String(settings.glProject) : '';
    default: return isGitConfigured(settings) ? `${settings.bbWorkspace}/${settings.bbRepo}` : '';
  }
};

// Branch naming is provider-independent.
export const getGitBranchName = (issueKey, title) => bb.getBitbucketBranchName(issueKey, title);

export const createGitBranch = (settings, branchName, fromBranch) => {
  switch (getGitProvider(settings)) {
    case 'github': return gh.createGithubBranch(settings.ghOwner, settings.ghRepo, branchName, fromBranch);
    case 'gitlab': return gl.createGitlabBranch(settings.glProject, branchName, fromBranch);
    default: return bb.createBitbucketBranch(settings.bbWorkspace, settings.bbRepo, branchName, fromBranch);
  }
};

export const commitGitFiles = (settings, branchName, files, message) => {
  switch (getGitProvider(settings)) {
    case 'github': return gh.commitFilesToGithub(settings.ghOwner, settings.ghRepo, branchName, files, message);
    case 'gitlab': return gl.commitFilesToGitlab(settings.glProject, branchName, files, message);
    default: return bb.commitFilesToBitbucket(settings.bbWorkspace, settings.bbRepo, branchName, files, message);
  }
};

export const createGitPR = (settings, branchName, title, checklist, issueKey) => {
  const target = getGitDefaultBranch(settings);
  switch (getGitProvider(settings)) {
    case 'github': return gh.createGithubPR(settings.ghOwner, settings.ghRepo, branchName, title, checklist, issueKey, target);
    case 'gitlab': return gl.createGitlabMR(settings.glProject, branchName, title, checklist, issueKey, target);
    default: return bb.createBitbucketPR(settings.bbWorkspace, settings.bbRepo, branchName, title, checklist, issueKey, target);
  }
};

export const fetchGitRepoContext = (settings, labels, title) => {
  const branch = getGitDefaultBranch(settings);
  switch (getGitProvider(settings)) {
    case 'github': return gh.fetchGithubRepoContext(settings.ghOwner, settings.ghRepo, branch, labels, title);
    case 'gitlab': return gl.fetchGitlabRepoContext(settings.glProject, branch, labels, title);
    default: return bb.fetchRepoContext(settings.bbWorkspace, settings.bbRepo, branch, labels, title);
  }
};

// Rollback support: delete a previously created branch on the selected provider.
export const deleteGitBranch = (settings, branch) => {
  switch (getGitProvider(settings)) {
    case 'github': return gh.deleteGithubBranch(settings.ghOwner, settings.ghRepo, branch);
    case 'gitlab': return gl.deleteGitlabBranch(settings.glProject, branch);
    default: return bb.deleteBitbucketBranch(settings.bbWorkspace, settings.bbRepo, branch);
  }
};

// Rollback support: close/decline a previously created PR/MR on the selected provider.
// `prRef` is the provider-native identifier (PR id for Bitbucket, number for GitHub, iid for GitLab).
export const closeGitPR = (settings, prRef) => {
  switch (getGitProvider(settings)) {
    case 'github': return gh.closeGithubPR(settings.ghOwner, settings.ghRepo, prRef);
    case 'gitlab': return gl.closeGitlabMR(settings.glProject, prRef);
    default: return bb.declineBitbucketPR(settings.bbWorkspace, settings.bbRepo, prRef);
  }
};

// The unit of work a merge request represents ("PR" for Bitbucket/GitHub, "MR" for GitLab).
export const getChangeRequestLabel = (settings) =>
  getGitProvider(settings) === 'gitlab' ? 'Merge Request' : 'Pull Request';
