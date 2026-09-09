/** Vite 客户端配置：开发时将 API 与 Socket.IO 透明代理到权威服务端。 */
import { fileURLToPath, URL } from 'node:url'
import { gzipSync } from 'node:zlib'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, type Plugin } from 'vite'
import { strings } from '@draw-guess/strings'

/**
 * 构建产物体积报告（等价 bundle visualizer，且不引入任何新依赖）。
 *
 * 通过 rollup 的 generateBundle 钩子读取每个 chunk 的 `modules[].renderedLength`
 * 与每个产物的实际字节数，输出「按模块聚合的占比表 + 每个产物的 raw/gzip 体积」。
 * 用于定位首屏体积构成、验证懒加载切分效果；仅在 BUNDLE_REPORT=1 时启用，
 * 日常构建与 CI 不产生额外输出（CI 的体积门禁见 test/e2e/specs/08-performance-budget.spec.ts）。
 */
function bundleReportPlugin(): Plugin {
  const kib = (bytes: number) => `${(bytes / 1024).toFixed(1)} KiB`

  /** 把绝对模块 id 压缩成可读路径：第三方显示为 node_modules/<pkg>/…，源码显示为 apps/client/src/…。 */
  const shorten = (id: string): string => {
    const normalized = id.replace(/\\/gu, '/')
    const inNodeModules = normalized.lastIndexOf('/node_modules/')
    if (inNodeModules >= 0) return `node_modules/${normalized.slice(inNodeModules + 14)}`
    const inClientSrc = normalized.indexOf('/apps/client/src/')
    if (inClientSrc >= 0) return normalized.slice(inClientSrc + 1)
    return normalized
  }

  return {
    name: 'draw-guess-bundle-report',
    apply: 'build',
    generateBundle(_outputOptions, bundle) {
      const outputs: Array<{
        file: string
        raw: number
        gzip: number
        modules: Array<{ id: string; size: number }>
      }> = []

      for (const [fileName, output] of Object.entries(bundle)) {
        const source = output.type === 'chunk' ? output.code : output.source
        const raw = typeof source === 'string' ? Buffer.byteLength(source) : source.byteLength
        const modules: Array<{ id: string; size: number }> = []
        if (output.type === 'chunk') {
          for (const [id, info] of Object.entries(output.modules)) {
            modules.push({ id: shorten(id), size: info.renderedLength })
          }
        }
        outputs.push({
          file: fileName,
          raw,
          gzip: gzipSync(source).length,
          modules: modules.sort((a, b) => b.size - a.size),
        })
      }

      const sorted = outputs.sort((a, b) => b.raw - a.raw)
      const lines = [
        '',
        '════════ 构建产物体积报告（BUNDLE_REPORT=1）════════',
        '产物'.padEnd(46) + 'raw'.padStart(12) + 'gzip'.padStart(12),
        ...sorted.map(
          (item) => item.file.padEnd(46) + kib(item.raw).padStart(12) + kib(item.gzip).padStart(12),
        ),
        '',
        '各 chunk 模块占比（渲染体积，未压缩；每 chunk 列前 10 项）',
      ]
      for (const item of sorted) {
        if (!item.modules.length) continue
        const chunkTotal = item.modules.reduce((sum, entry) => sum + entry.size, 0)
        lines.push(
          '',
          `▌ ${item.file}  raw ${kib(item.raw)} / gzip ${kib(item.gzip)}`,
          ...item.modules
            .slice(0, 10)
            .map(
              (entry) =>
                `${kib(entry.size).padStart(10)}  ${`${((entry.size / chunkTotal) * 100).toFixed(1)}%`.padStart(6)}  ${entry.id}`,
            ),
        )
      }
      lines.push('')
      console.log(lines.join('\n'))
    },
  }
}

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
  plugins: [
    appMetadataPlugin(),
    vue(),
    tailwindcss(),
    // 体积报告按需启用：BUNDLE_REPORT=1 pnpm --filter @draw-guess/client build
    ...(process.env.BUNDLE_REPORT === '1' ? [bundleReportPlugin()] : []),
  ],
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
