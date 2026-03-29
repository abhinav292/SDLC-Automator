import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const domain = env.ATLASSIAN_DOMAIN ? env.ATLASSIAN_DOMAIN.replace(/\/$/, '') : '';
  const authHeader = env.ATLASSIAN_EMAIL && env.ATLASSIAN_API_TOKEN
    ? `Basic ${Buffer.from(`${env.ATLASSIAN_EMAIL}:${env.ATLASSIAN_API_TOKEN}`).toString('base64')}`
    : '';

  const addAtlassianAuth = (proxy) => {
    proxy.on('proxyReq', (proxyReq) => {
      if (authHeader) proxyReq.setHeader('Authorization', authHeader);
      proxyReq.setHeader('Accept', 'application/json');
      proxyReq.setHeader('User-Agent', 'Node.js/proxy');
      proxyReq.removeHeader('Origin');
      proxyReq.removeHeader('Referer');
    });
    proxy.on('error', (err) => console.error('Proxy Error:', err));
  };

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5000,
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
          configure: addAtlassianAuth
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
