import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const domain = env.ATLASSIAN_DOMAIN ? env.ATLASSIAN_DOMAIN.replace(/\/$/, '') : '';
  const atlassianAuthHeader = env.ATLASSIAN_EMAIL && env.ATLASSIAN_API_TOKEN
    ? `Basic ${Buffer.from(`${env.ATLASSIAN_EMAIL}:${env.ATLASSIAN_API_TOKEN}`).toString('base64')}`
    : '';

  // Bitbucket uses its own API token (may differ from the Jira/Confluence token)
  const bitbucketToken = env.BITBUCKET_API_TOKEN || env.ATLASSIAN_API_TOKEN || '';
  const bitbucketAuthHeader = env.ATLASSIAN_EMAIL && bitbucketToken
    ? `Basic ${Buffer.from(`${env.ATLASSIAN_EMAIL}:${bitbucketToken}`).toString('base64')}`
    : '';

  // GitHub & GitLab (each with its own token). Hosts are overridable for
  // GitHub Enterprise / self-hosted GitLab.
  const githubToken = env.GITHUB_TOKEN || '';
  const githubApi = (env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const gitlabToken = env.GITLAB_TOKEN || '';
  const gitlabHost = (env.GITLAB_HOST || 'https://gitlab.com').replace(/\/$/, '');

  const addAtlassianAuth = (proxy) => {
    proxy.on('proxyReq', (proxyReq) => {
      if (atlassianAuthHeader) proxyReq.setHeader('Authorization', atlassianAuthHeader);
      proxyReq.setHeader('Accept', 'application/json');
      proxyReq.setHeader('User-Agent', 'Node.js/proxy');
      proxyReq.removeHeader('Origin');
      proxyReq.removeHeader('Referer');
    });
    proxy.on('error', (err) => console.error('Proxy Error:', err));
  };

  const addBitbucketAuth = (proxy) => {
    proxy.on('proxyReq', (proxyReq) => {
      if (bitbucketAuthHeader) proxyReq.setHeader('Authorization', bitbucketAuthHeader);
      proxyReq.setHeader('Accept', 'application/json');
      proxyReq.setHeader('User-Agent', 'Node.js/proxy');
      proxyReq.removeHeader('Origin');
      proxyReq.removeHeader('Referer');
    });
    proxy.on('error', (err) => console.error('Bitbucket Proxy Error:', err));
  };

  const addGithubAuth = (proxy) => {
    proxy.on('proxyReq', (proxyReq) => {
      if (githubToken) proxyReq.setHeader('Authorization', `Bearer ${githubToken}`);
      proxyReq.setHeader('Accept', 'application/vnd.github+json');
      proxyReq.setHeader('X-GitHub-Api-Version', '2022-11-28');
      proxyReq.setHeader('User-Agent', 'SDLC-Autopilot');
      proxyReq.removeHeader('Origin');
      proxyReq.removeHeader('Referer');
    });
    proxy.on('error', (err) => console.error('GitHub Proxy Error:', err));
  };

  const addGitlabAuth = (proxy) => {
    proxy.on('proxyReq', (proxyReq) => {
      if (gitlabToken) proxyReq.setHeader('Authorization', `Bearer ${gitlabToken}`);
      proxyReq.setHeader('Accept', 'application/json');
      proxyReq.setHeader('User-Agent', 'SDLC-Autopilot');
      proxyReq.removeHeader('Origin');
      proxyReq.removeHeader('Referer');
    });
    proxy.on('error', (err) => console.error('GitLab Proxy Error:', err));
  };

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 8095,
      allowedHosts: true,
      proxy: {
        '/api/backend': {
          target: 'http://localhost:3001',
          changeOrigin: false,
          rewrite: (path) => path.replace(/^\/api\/backend/, '')
        },
        '/api/jira': {
          target: `https://${domain}/rest/api/3`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/jira/, ''),
          configure: addAtlassianAuth
        },
        '/api/confluence': {
          target: `https://${domain}/wiki/rest/api`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/confluence/, ''),
          configure: addAtlassianAuth
        },
        '/api/bitbucket': {
          target: 'https://api.bitbucket.org/2.0',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/bitbucket/, ''),
          configure: addBitbucketAuth
        },
        '/api/github': {
          target: githubApi,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/github/, ''),
          configure: addGithubAuth
        },
        '/api/gitlab': {
          target: `${gitlabHost}/api/v4`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/gitlab/, ''),
          configure: addGitlabAuth
        }
      }
    },
    define: {
      __ATLASSIAN_DOMAIN__: JSON.stringify(domain),
      __JIRA_PROJECT_KEY__: JSON.stringify(env.JIRA_PROJECT_KEY || 'KAN'),
      __ATLASSIAN_EMAIL__: JSON.stringify(env.ATLASSIAN_EMAIL || '')
    }
  }
})
