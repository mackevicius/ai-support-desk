import { defineConfig } from '@playwright/test';

const deploymentUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './test',
  testMatch: '*.spec.ts',
  use: { baseURL: deploymentUrl ?? 'http://localhost:3100', browserName: 'chromium' },
  webServer: deploymentUrl ? undefined : [
    {
      command: 'node --import tsx ../api/test/demo-server.ts',
      url: 'http://127.0.0.1:3101/tickets',
      env: { OWNER_PASSWORD: 'test-password', OWNER_SESSION_SECRET: 'test-session-secret' },
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev -- --port 3100',
      url: 'http://localhost:3100',
      env: { API_URL: 'http://127.0.0.1:3101' },
      reuseExistingServer: false,
    },
  ],
});
