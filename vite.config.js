import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5000,
      allowedHosts: true,
      proxy: {
        '/api/jira': {
          target: `https://${env.ATLASSIAN_DOMAIN}/rest/api/3`,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/jira/, ''),
          configure: (proxy, options) => {
            proxy.on('proxyReq', (proxyReq, req, res) => {
              if (env.ATLASSIAN_EMAIL && env.ATLASSIAN_API_TOKEN) {
                const authHeader = `Basic ${Buffer.from(`${env.ATLASSIAN_EMAIL}:${env.ATLASSIAN_API_TOKEN}`).toString('base64')}`;
                proxyReq.setHeader('Authorization', authHeader);
              }
              proxyReq.setHeader('Accept', 'application/json');
              proxyReq.setHeader('User-Agent', 'Node.js/proxy');
              proxyReq.removeHeader('Origin');
              proxyReq.removeHeader('Referer');
            });
            proxy.on('error', (err, req, res) => {
              console.error('Proxy Error:', err);
            });
          }
        }
      }
    }
  }
})
