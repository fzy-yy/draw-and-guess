/** Vite 客户端配置：开发时将 API 与 Socket.IO 透明代理到权威服务端。 */
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { PUBLIC_CONFIG } from '../../config/index.ts'
import { strings } from '../../string/index.ts'

/**
 * 将根级配置在构建时裁剪为虚拟公开模块。源码仍只有 config 一个配置入口，
 * 但浏览器产物不会包含词库路径、服务端限流和重连清理等内部字段。
 * 同时把页面标题 / 描述等元信息从 string/index.ts 注入 index.html，保持文案唯一来源。
 */
function publicConfigPlugin(): Plugin {
  const virtualId = '\0draw-guess-public-config'
  return {
    name: 'draw-guess-public-config',
    enforce: 'pre',
    resolveId(id) {
      return id === '@draw-guess/config' ? virtualId : undefined
    },
    load(id) {
      if (id !== virtualId) return undefined
      const serialized = JSON.stringify(PUBLIC_CONFIG)
      return `export const PUBLIC_CONFIG = ${serialized}; export const APP_CONFIG = PUBLIC_CONFIG;`
    },
    // 用统一文案表（string/index.ts）注入 index.html 的标题与描述，避免 HTML 内硬编码
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
  plugins: [publicConfigPlugin(), vue(), tailwindcss()],
  build: {
    // 测试隔离：E2E 把前端构建到临时目录再让测试服务托管，避免依赖恰好存在的 dist。
    // 默认 'dist'（相对 client 包根）；通过 CLIENT_OUT_DIR 覆盖为绝对临时路径。
    outDir: process.env.CLIENT_OUT_DIR ?? 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@draw-guess/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
      // 统一 UI 文案表：与根 tsconfig paths 保持一致，供组件/仓库静态导入
      '@draw-guess/strings': fileURLToPath(new URL('../../string/index.ts', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:5174',
      '/socket.io': { target: 'http://localhost:5174', ws: true },
    },
  },
})
