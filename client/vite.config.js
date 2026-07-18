import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    // Bind all interfaces, not just loopback — required to be reachable through
    // Docker's port-forwarding NAT in devcontainers/Codespaces.
    host: true,
    // Dev-time proxy so the client can call /api/... without CORS config
    // (the Zero-Cloud directive forbids CORS middleware — this sidesteps it entirely).
    // API_PORT lets Playwright point a second client instance at an isolated server.
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT ?? 3001}`, changeOrigin: true },
    },
  },
  test: {
    environment: 'jsdom',
  },
});
