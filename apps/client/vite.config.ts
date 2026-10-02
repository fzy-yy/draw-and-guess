/** Vite 客户端配置：开发时将 API 与 Socket.IO 透明代理到权威服务端。 */
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { strings } from '@draw-guess/strings'

/**
 * 把 workspace 文案包中的页面元信息注入 index.html，保持文案唯一来源。
 * 浏览器配置来自仅含公开字段的 @draw-guess/config，不再依赖构建期虚拟裁剪。
 */
function appMetadataPlugin(): Plugin {
  return {
    name: 'draw-guess-app-metadata',
    // 用统一文案包注入 index.html 的标题与描述，避免 HTML 内硬编码
    transformIndexHtml(html) {
      return html
        .replace(/<title>[^<]*<\/title>/, `<title>${strings.meta.title}</title>`)
        .replace(
          /<meta name="description" content="[^"]*"/,
          `<meta name="description" content="${strings.meta.description}"`,
        )
    },
  }
}

export default defineConfig({
  plugins: [appMetadataPlugin(), vue(), tailwindcss()],
  build: {
    // 测试隔离：E2E 把前端构建到临时目录再让测试服务托管，避免依赖恰好存在的 dist。
    // 默认 'dist'（相对 client 包根）；通过 CLIENT_OUT_DIR 覆盖为绝对临时路径。
    outDir: process.env.CLIENT_OUT_DIR ?? 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 轻量协议常量必须先于 barrel 匹配：Worker 等独立 bundle 只应带上纯常量，
      // 不能被 @draw-guess/shared barrel 拖入 zod 与 schema 运行时。
      '@draw-guess/shared/protocol/constants': fileURLToPath(
        new URL('../../packages/shared/src/protocol/constants.ts', import.meta.url),
      ),
      '@draw-guess/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
      '@draw-guess/config': fileURLToPath(
        new URL('../../packages/config/src/index.ts', import.meta.url),
      ),
      // 统一 UI 文案表：与根 tsconfig paths 保持一致，供组件/仓库静态导入
      '@draw-guess/strings': fileURLToPath(
        new URL('../../packages/strings/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5174',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://127.0.0.1:5174',
        ws: true,
        changeOrigin: true,
      },
    },
  },
})
