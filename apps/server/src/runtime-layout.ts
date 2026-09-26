/**
 * 运行时资源布局解析。
 *
 * - 源码模式（`pnpm dev` / `pnpm start`）：沿用仓库相对路径，端口固定（配合 Vite 代理），不自动开浏览器；
 * - 分发产物模式（`node server.mjs`）：以入口文件所在目录为根，解析 `client/`、`vocabulary/`、`data/`，
 *   端口占用自动顺延，启动后自动打开浏览器。
 *
 * 模式由构建期 define 注入（`process.env.DRAW_GUESS_RUNTIME_MODE`），源码运行时读不到该变量即为 source。
 * 本模块为纯路径计算，不触碰文件系统，便于单测。
 */
import { join, resolve } from 'node:path'

export type RuntimeMode = 'source' | 'dist'

export interface RuntimeLayout {
  mode: RuntimeMode
  /** 资源根目录：源码模式为 `apps/server`，产物模式为 `server.mjs` 所在目录 */
  baseDir: string
  /** SQLite 数据库文件路径（权威身份与战报） */
  databaseFile: string
  /** 日志目录 */
  logDir: string
  /** 词库目录列表：内置目录在前，用户自定义目录在后，按序合并加载 */
  vocabularyDirs: string[]
  /** 前端构建产物目录 */
  clientDist: string
  /** 高级配置 .env 路径 */
  envFile: string
  /** 端口被占用时是否自动向后顺延（仅产物模式；源码模式固定端口以配合 Vite 代理） */
  portFallback: boolean
  /** 启动后是否自动打开默认浏览器（仅产物模式） */
  openBrowser: boolean
}

/**
 * 解析运行时资源布局。
 * @param input.mode 运行模式（source / dist）
 * @param input.entryDir 入口文件所在目录（源码为 `apps/server/src`，产物为 `server.mjs` 所在目录）
 */
export function resolveRuntimeLayout(input: {
  mode: RuntimeMode
  entryDir: string
}): RuntimeLayout {
  if (input.mode === 'dist') {
    const baseDir = input.entryDir
    return {
      mode: 'dist',
      baseDir,
      databaseFile: join(baseDir, 'data', 'game.db'),
      logDir: join(baseDir, 'data', 'logs'),
      vocabularyDirs: [join(baseDir, 'vocabulary'), join(baseDir, 'data', 'vocabulary', 'custom')],
      clientDist: join(baseDir, 'client'),
      envFile: join(baseDir, 'data', '.env'),
      portFallback: true,
      openBrowser: true,
    }
  }

  const serverRoot = resolve(input.entryDir, '..')
  const repoRoot = resolve(serverRoot, '..', '..')
  return {
    mode: 'source',
    baseDir: serverRoot,
    databaseFile: join(serverRoot, 'data', 'game.db'),
    logDir: join(serverRoot, 'log'),
    vocabularyDirs: [join(repoRoot, 'vocabulary')],
    clientDist: join(repoRoot, 'apps', 'client', 'dist'),
    envFile: join(repoRoot, '.env'),
    portFallback: false,
    openBrowser: false,
  }
}
