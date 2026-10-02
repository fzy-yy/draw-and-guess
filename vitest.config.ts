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
  },
  resolve: {
    alias: {
      // 轻量协议常量先于 barrel 匹配，避免测试环境打包/解析时把 zod 与全量 schema 拖入。
      '@draw-guess/shared/protocol/constants': fileURLToPath(
        new URL('./packages/shared/src/protocol/constants.ts', import.meta.url),
      ),
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
