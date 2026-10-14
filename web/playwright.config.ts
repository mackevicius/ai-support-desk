import { defineConfig } from '@playwright/test';

const deploymentUrl = process.env.PLAYWRIGHT_BASE_URL;
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);

export default defineConfig({
  testDir: './test',
  testMatch: '*.spec.ts',
  workers: 1,
  // Late tests take ~22s locally against next dev + pg-mem; CI runs ~1.7x slower.
  timeout: 90_000,
  use: {
    baseURL: deploymentUrl ?? `http://localhost:${port}`,
    browserName: 'chromium',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'main', testIgnore: 'quality-live-run.spec.ts' },
    {
      name: 'quality-live-run',
      testMatch: 'quality-live-run.spec.ts',
      dependencies: ['main'],
    },
  ],
  webServer: deploymentUrl
    ? undefined
    : [
        {
          command: 'node --import tsx ../api/test/demo-server.ts',
          url: `http://127.0.0.1:${port + 1}/tickets`,
          env: {
            OWNER_PASSWORD: 'test-password',
            OWNER_SESSION_SECRET: 'test-session-secret',
            DEMO_API_PORT: String(port + 1),
            DEMO_PROVIDER_PORT: String(port + 2),
            DEMO_AI_PORT: String(port + 3),
          },
          reuseExistingServer: false,
        },
        {
          command: `npm run dev -- --port ${port}`,
          url: `http://localhost:${port}`,
          env: {
            API_URL: `http://127.0.0.1:${port + 1}`,
            NEXT_DIST_DIR: '.next-test',
          },
          reuseExistingServer: false,
        },
      ],
});
