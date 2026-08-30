/** Vite 客户端配置：开发时将 API 与 Socket.IO 透明代理到权威服务端。 */
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { PUBLIC_CONFIG } from '../../config.ts'

/**
 * 将根级配置在构建时裁剪为虚拟公开模块。源码仍只有 config.ts 一个配置入口，
 * 但浏览器产物不会包含词库路径、服务端限流和重连清理等内部字段。
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
  }
}

export default defineConfig({
  plugins: [publicConfigPlugin(), vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@draw-guess/shared': fileURLToPath(
        new URL('../../packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:5174',
      '/socket.io': { target: 'http://localhost:5174', ws: true },
    },
  },
})
