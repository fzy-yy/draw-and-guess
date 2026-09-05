import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './specs',
  outputDir: '../test-results',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false, // 对局联机测试避免多测试之间竞争
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
    viewport: { width: 1280, height: 800 },
    actionTimeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
  webServer: {
    command: 'pnpm start',
    url: 'http://localhost:5174/api/health',
    reuseExistingServer: true,
    timeout: 60_000,
  },
})
