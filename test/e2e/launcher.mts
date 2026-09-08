/**
 * 隔离 E2E 服务启动器（playwright webServer 入口）。
 *
 * 每次运行都在系统临时目录创建一个**唯一**运行目录，内含：
 * - data/game.db  —— 由 createApplication 用 dbFile 指向此处，fresh 建库（复现迁移）；
 * - vocab/*.db —— 自动生成的两份最小词库（均可开完整局），绝不写仓库真实 vocabulary/*.db；
 * - dist/ —— 前端构建产物，由「构建当前前端」写入，服务显式托管，不依赖恰好存在的 dist。
 *
 * 随后以独立端口监听（默认 5199），与真实 5174 服务完全隔离；reuseExistingServer=false,
 * 端口冲突时主动报错退出，不杀任何已有进程。
 *
 * 资源回收：正常路径收到 SIGINT/SIGTERM 时清理本次运行目录；Windows 下 Playwright 往往用
 * taskkill /T /F 强杀进程树（无法拦截），因此启动时另行清扫**已过期**的旧运行目录兜底回收。
 *
 * 本文件只承载「基础设施参数」（端口 / 目录 / 是否写日志），不承载任何业务规则。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { createApplication } from '../../apps/server/src/app.ts'
import { loadVocabulary } from '../../apps/server/src/vocabulary/index.ts'
import { SILENT_LOGGER } from '../../apps/server/src/errors.ts'
import { createMinimalVocabularyDb } from '../../apps/server/src/vocabulary/test-fixture.ts'

/** 仓库根目录：test/e2e/launcher.mts 上溯两级。 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
/** 独立测试端口（默认 5199，与真实 5174 错开）。 */
const PORT = Number(process.env.TEST_PORT ?? 5199)
/** 运行目录名前缀（便于清扫旧目录）。 */
const RUN_DIR_PREFIX = 'draw-guess-e2e-'
/**
 * 判定旧运行目录的阈值：超过该时长的旧目录视为已被强杀的前次运行残留，启动时清除。
 * 取 5 分钟：单次 E2E（含前端构建）通常远小于该时长，既能避免误删在进行中的新运行目录，
 * 又能让被强杀的下一次运行在约 5 分钟后回收上一轮的残留。
 */
const STALE_RUN_MS = 5 * 60 * 1_000

/** 本次运行唯一临时目录：系统临时目录/draw-guess-e2e-<时间戳>-<随机>。 */
function createRunDir(): string {
  const runDir = path.join(
    os.tmpdir(),
    `${RUN_DIR_PREFIX}${Date.now()}-${randomBytes(4).toString('hex')}`,
  )
  mkdirSync(runDir, { recursive: true })
  return runDir
}

/** 递归删除前校验绝对路径确实位于系统临时目录下（防止误删）。 */
function safeRemoveDir(targetDir: string): void {
  if (!path.isAbsolute(targetDir)) return
  const tmpRoot = path.resolve(os.tmpdir()) + path.sep
  const target = path.resolve(targetDir)
  if (!target.startsWith(tmpRoot)) {
    throw new Error(`拒绝删除非临时目录：${target}`)
  }
  rmSync(target, { recursive: true, force: true })
}

/** 启动时清扫过期的旧运行目录（兜底回收被强杀的前次运行资源；不会碰正在进行中的新目录）。 */
function sweepStaleRunDirs(): void {
  const tmpRoot = os.tmpdir()
  const now = Date.now()
  for (const entry of readdirSync(tmpRoot)) {
    if (!entry.startsWith(RUN_DIR_PREFIX)) continue
    const full = path.join(tmpRoot, entry)
    // 名字内嵌时间戳：过旧才清理，避免误删并发运行的目录
    const ts = Number(entry.slice(RUN_DIR_PREFIX.length, entry.indexOf('-', RUN_DIR_PREFIX.length)))
    const isStale = Number.isFinite(ts) && now - ts > STALE_RUN_MS
    if (isStale) {
      try {
        safeRemoveDir(full)
        console.log(`[e2e-test-server] 已清扫过期运行目录：${full}`)
      } catch (error) {
        console.error(
          '[e2e-test-server] 清扫失败：',
          error instanceof Error ? error.message : error,
        )
      }
    } else if (!Number.isFinite(ts)) {
      // 无法解析时间戳的旧目录也按过期处理（防御性）
      try {
        safeRemoveDir(full)
      } catch {
        /* 忽略 */
      }
    }
  }
}

/** 构建前端到指定产物目录（vite build，经 CLIENT_OUT_DIR 写入临时目录）。 */
function buildClient(distDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 用单字符串命令避免 shell:true + args 数组触发 DEP0190；CLIENT_OUT_DIR 经 env 传递，无引号问题
    const command = 'pnpm --filter @draw-guess/client build'
    const child = spawn(command, {
      cwd: ROOT,
      env: { ...process.env, CLIENT_OUT_DIR: distDir },
      stdio: 'inherit',
      // Windows 下 pnpm 是 pnpm.cmd 垫片，spawn 需经 shell 解析才能找到
      shell: true,
    })
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`前端构建失败，退出码 ${code}`)),
    )
  })
}

async function main(): Promise<void> {
  // 0. 回收上一轮被强杀产生的旧运行目录（本机多次运行不累积残留）
  sweepStaleRunDirs()

  const runDir = createRunDir()
  console.log(`[e2e-test-server] 运行目录：${runDir}`)
  console.log(`[e2e-test-server] 校验端口 ${PORT}（复用现有服务由 playwright 设为 false）`)
  const dataDir = path.join(runDir, 'data')
  const vocabDir = path.join(runDir, 'vocab')
  const distDir = path.join(runDir, 'dist')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(vocabDir, { recursive: true })

  // 1. 构建当前前端到临时产物目录（空 dist 环境也能跑，不依赖已有 dist）
  await buildClient(distDir)

  // 2. 生成两份均可开完整局的词库 fixture，覆盖默认包与单选切换流程；数据始终位于临时目录
  createMinimalVocabularyDb(path.join(vocabDir, 'draw_guess_words.db'), {
    wordCount: 5_000,
    description: 'E2E 默认词库',
  })
  createMinimalVocabularyDb(path.join(vocabDir, 'test_words.db'), {
    wordCount: 60,
    description: 'E2E 备用词库',
  })
  const vocabulary = await loadVocabulary(vocabDir)

  // 3. 建库（dbFile 指向临时 data/game.db）并组装应用，监听独立端口
  const dbFile = path.join(dataDir, 'game.db')
  const application = await createApplication({
    dbFile,
    clientDist: distDir,
    vocabulary,
    logger: SILENT_LOGGER,
    publicBaseUrl: () => `http://127.0.0.1:${PORT}`,
  })
  application.service.recoverOnStartup()

  let cleanedUp = false
  const cleanup = async () => {
    if (cleanedUp) return
    cleanedUp = true
    try {
      await application.close()
      safeRemoveDir(runDir)
      console.log('[e2e-test-server] 已清理本次运行的临时目录与资源')
    } catch (error) {
      console.error('[e2e-test-server] 清理失败：', error instanceof Error ? error.message : error)
    }
  }

  application.httpServer.on('error', (error: NodeJS.ErrnoException) => {
    // 端口冲突：明确报错退出，绝不结束其它进程
    if (error.code === 'EADDRINUSE') {
      console.error(`[e2e-test-server] 测试端口 ${PORT} 已被占用，无法启动隔离服务。`)
    } else {
      console.error('[e2e-test-server] 启动失败：', error.message)
    }
    process.exit(1)
  })

  application.httpServer.listen(PORT, '127.0.0.1', () => {
    console.log(`[e2e-test-server] 隔离服务已就绪：http://127.0.0.1:${PORT}`)
  })

  // 4. 优雅退出：Playwright 结束 webServer 时若能收到 SIGINT/SIGTERM 则即时清理
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void cleanup().finally(() => process.exit(0))
    })
  }
  // 另外注册同步的 exit 兜底：node 正常退出时尽量回收本次运行目录（io.close 为异步，此处仅删目录）
  process.once('exit', () => {
    if (!cleanedUp) {
      try {
        safeRemoveDir(runDir)
      } catch {
        /* 忽略 */
      }
    }
  })
}

main().catch((error: unknown) => {
  console.error('[e2e-test-server] 启动失败：', error instanceof Error ? error.message : error)
  process.exit(1)
})
