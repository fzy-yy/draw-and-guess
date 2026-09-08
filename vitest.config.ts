import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vitest/config'

const clientRoot = fileURLToPath(new URL('./apps/client', import.meta.url))

/**
 * 分层测试配置：Node 单元测试 + happy-dom 组件测试 + happy-dom 客户端集成测试。
 *
 * Node 项目继续覆盖服务端权威领域与纯函数；浏览器侧项目由 Vue 插件编译 SFC，
 * 并共享与生产代码一致的路径别名。集成测试额外启用 MSW 网络边界，任何未声明请求直接失败。
 * 所有测试均使用隔离状态，不打开默认数据库、不连接真实 Socket.IO 服务。
 */
export default defineConfig({
  plugins: [vue()],
  test: {
    globals: false,
    testTimeout: 15_000,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/unit/**/*.spec.ts'],
          environment: 'node',
        },
      },
      {
        extends: true,
        root: clientRoot,
        test: {
          name: 'component',
          include: ['../../test/component/**/*.spec.ts'],
          environment: 'happy-dom',
          setupFiles: ['../../test/client/setup.ts'],
        },
      },
      {
        extends: true,
        root: clientRoot,
        test: {
          name: 'integration',
          include: ['../../test/integration/**/*.spec.ts'],
          environment: 'happy-dom',
          setupFiles: ['../../test/integration/setup.ts'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text', 'json-summary', 'html', 'lcov'],
      reportOnFailure: true,
      include: [
        'apps/client/src/**/*.{ts,vue}',
        'apps/server/src/**/*.ts',
        'packages/shared/src/**/*.ts',
      ],
      exclude: [
        'apps/client/src/main.ts',
        'apps/server/src/index.ts',
        '**/*.d.ts',
        '**/assets/**',
        '**/test-fixture.ts',
      ],
      thresholds: {
        // 全局底线保持历史门禁不下降；它只负责防止全仓覆盖率整体坍塌。
        statements: 32,
        branches: 27,
        functions: 26,
        lines: 33,
        // 第一阶段直接覆盖完整客户端状态层；目录内新增文件不能再由其它高覆盖目录平均掉。
        'apps/client/src/composables/**': {
          statements: 60,
          branches: 50,
        },
        'apps/client/src/stores/**': {
          statements: 60,
          branches: 50,
        },
        // 关键链路保留更贴近当前实际覆盖率的独立门禁，后续优先逐步上调这些值。
        'apps/client/src/composables/{useGameHud,useRoomSync}.ts': {
          statements: 75,
          branches: 60,
        },
        'apps/client/src/composables/useStrokeSession.ts': {
          statements: 65,
          branches: 50,
        },
        // 角色裁剪与阶段/计分是服务端权威核心，按文件设置不低于当前有效基线的门禁。
        'apps/server/src/game-service.ts': {
          statements: 59,
          branches: 49,
          functions: 70,
          lines: 60,
        },
        'apps/server/src/round-machine.ts': {
          statements: 83,
          branches: 67,
          functions: 83,
          lines: 89,
        },
        'apps/server/src/snapshot.ts': {
          statements: 84,
          branches: 76,
          functions: 100,
          lines: 93,
        },
        'packages/shared/src/pure.ts': {
          statements: 86,
          branches: 70,
          functions: 100,
          lines: 86,
        },
        'apps/client/src/components/game/{GameHud,PhaseOverlay}.vue': {
          statements: 60,
          branches: 55,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@draw-guess/shared': fileURLToPath(
        new URL('./packages/shared/src/index.ts', import.meta.url),
      ),
      '@draw-guess/config': fileURLToPath(
        new URL('./packages/config/src/index.ts', import.meta.url),
      ),
      '@draw-guess/strings': fileURLToPath(
        new URL('./packages/strings/src/index.ts', import.meta.url),
      ),
      '@': fileURLToPath(new URL('./apps/client/src', import.meta.url)),
    },
  },
})
