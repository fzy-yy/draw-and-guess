import { defineConfig, devices } from '@playwright/test'

/**
 * 隔离 E2E 配置。
 *
 * 测试服务由 test/e2e/launcher.mts 扮演：每次运行在系统临时目录创建唯一的
 * data/game.db + 词汇 fixture + 前端构建产物，并以独立端口（默认 5199，可用 TEST_PORT 覆盖）
 * 监听。reuseExistingServer=false 禁止复用任何已有服务；端口冲突时 launcher 明确报错退出，
 * 不会停止其它进程，也不会碰真实 5174 服务、真实 game.db 或真实 vocabulary/*.db。
 */
const TEST_PORT = Number(process.env.TEST_PORT ?? 5199)

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
    baseURL: `http://127.0.0.1:${TEST_PORT}`,
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
    {
      name: 'chromium-dpr-1.5',
      testMatch: /06-browser-compatibility\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1024, height: 720 },
        deviceScaleFactor: 1.5,
      },
    },
    {
      name: 'chromium-dpr-2-touch',
      testMatch: /06-browser-compatibility\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        hasTouch: true,
      },
    },
    {
      name: 'firefox-dpr-2',
      testMatch: /06-browser-compatibility\.spec\.ts/,
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
      },
    },
  ],
  webServer: {
    command: `pnpm --filter @draw-guess/server exec tsx ../../test/e2e/launcher.mts`,
    url: `http://127.0.0.1:${TEST_PORT}/api/health`,
    reuseExistingServer: false, // 隔离要求：绝不复用已有服务
    timeout: 120_000, // 需要等待「前端构建 + 建库 + 监听」完成
    env: { TEST_PORT: String(TEST_PORT) },
  },
})
