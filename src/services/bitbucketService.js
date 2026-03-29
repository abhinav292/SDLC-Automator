export const createBitbucketBranch = async (workspace, repo, branchName, fromBranch = 'main') => {
  if (!workspace || !repo) {
    return { success: false, error: 'Bitbucket workspace and repository not configured. Please set them in Settings.' };
  }

  const body = {
    name: branchName,
    target: { hash: fromBranch }
  };

  try {
    const res = await fetch(`/api/bitbucket/repositories/${workspace}/${repo}/refs/branches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (res.ok) {
      return {
        success: true,
        name: data.name,
        url: `https://bitbucket.org/${workspace}/${repo}/branch/${data.name}`
      };
    } else {
      return { success: false, error: data.error?.message || JSON.stringify(data) };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
};

export const getBitbucketBranchName = (jiraKey, storyTitle) => {
  const slug = storyTitle
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return `feature/${jiraKey}-${slug}`;
};

export const getBitbucketWorkspaces = async () => {
  try {
    const res = await fetch('/api/bitbucket/workspaces');
    if (res.ok) {
      const data = await res.json();
      return data.values || [];
    }
    return [];
  } catch {
    return [];
  }
};

export const getBitbucketRepos = async (workspace) => {
  try {
    const res = await fetch(`/api/bitbucket/repositories/${workspace}?pagelen=25`);
    if (res.ok) {
      const data = await res.json();
      return data.values || [];
    }
    return [];
  } catch {
    return [];
  }
};
