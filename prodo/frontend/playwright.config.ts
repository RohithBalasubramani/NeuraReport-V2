import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  // Playwright's glob matching is conservative; keep this explicit to avoid
  // "No tests found" on some shells/platforms.
  testMatch: ['**/*.spec.ts', '**/*.spec.js'],
  fullyParallel: true,
  timeout: 180_000, // 3 minutes for pages with many elements
  expect: {
    timeout: 10_000,
  },
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],
  use: {
    baseURL: 'http://127.0.0.1:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  outputDir: 'playwright-results',
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // webServer disabled - services already running manually
  // webServer: {
  //   command: 'npm run dev -- --port 4173 --host 127.0.0.1',
  //   url: 'http://localhost:4173',
  //   reuseExistingServer: !process.env.CI,
  //   stdout: 'pipe',
  //   stderr: 'pipe',
  //   env: {
  //     // Ensure e2e runs against the real backend via Vite proxy (no cross-origin/CORS).
  //     VITE_API_BASE_URL: 'proxy',
  //     VITE_USE_MOCK: 'false',
  //     // Backend runs on 8001 in our manual validation environment.
  //     NEURA_BACKEND_URL: process.env.NEURA_BACKEND_URL || 'http://127.0.0.1:8002',
  //   },
  // },
})
