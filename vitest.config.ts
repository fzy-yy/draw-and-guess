import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * 单元测试（规则测试基础）配置。
 *
 * 测试对象是 apps/server 的权威领域与纯函数，因此运行环境为 node；
 * 通过 resolve.alias 复刻根 tsconfig 与 vite 的路径约束，让服务端源码里的
 * `@draw-guess/shared` 等别名在 Vitest 下同样可解析，避免「只在 Vite 产物里能跑」。
 * 测试只使用内存仓储 / 假时钟，不打开默认 getDb 数据文件，也不触碰真实词库。
 */
export default defineConfig({
  test: {
    include: ['test/unit/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    testTimeout: 15_000,
  },
  resolve: {
    alias: {
      '@draw-guess/shared': fileURLToPath(
        new URL('./packages/shared/src/index.ts', import.meta.url),
      ),
      '@draw-guess/config': fileURLToPath(new URL('./config/index.ts', import.meta.url)),
      '@draw-guess/strings': fileURLToPath(new URL('./string/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./apps/client/src', import.meta.url)),
    },
  },
})
