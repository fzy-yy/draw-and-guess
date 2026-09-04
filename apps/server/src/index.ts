/**
 * 局域网生产服务入口。
 * 启动前验证唯一业务配置与词库，并列出所有可信局域网 IPv4 候选地址。
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import pino from 'pino'
import { z } from 'zod'
import { APP_CONFIG, getDeploymentConfig, type DeploymentConfig } from '../../../config.ts'
import { serverStrings } from '../../../config/strings.ts'
import { EVENTS } from '@draw-guess/shared'
import { createApplication } from './app.ts'
import { closeDb } from './db/index.ts'
import { SILENT_LOGGER, type RuntimeLogger } from './errors.ts'

/** 使用 schema 在启动时验证跨字段配置，错误会阻止服务带病运行。 */
function validateBusinessConfig(): void {
  // 仅校验最关键的业务数值约束：人数上下限、轮数/时长、画板与词库限制
  const schema = z.object({
    player: z.object({ minPlayers: z.number().int().min(2), maxPlayers: z.number().int().max(6) }),
    game: z.object({
      roundsPerPlayer: z.object({
        min: z.number().int().positive(),
        max: z.number().int().positive(),
        default: z.number().int().positive(),
      }),
      drawSeconds: z.object({
        min: z.number().int().positive(),
        max: z.number().int().positive(),
        default: z.number().int().positive(),
      }),
      chooseSeconds: z.object({
        min: z.number().int().positive(),
        max: z.number().int().positive(),
        default: z.number().int().positive(),
      }),
    }),
    drawing: z.object({
      colors: z.array(z.string().regex(new RegExp(APP_CONFIG.drawing.colorPattern))).min(2),
      width: z.object({
        min: z.number().positive(),
        max: z.number().positive(),
        default: z.number().positive(),
        step: z.number().positive(),
        wheelStep: z.number().positive(),
      }),
      fillTolerance: z.number().int().min(0).max(255),
    }),
    vocabulary: z.object({
      minWords: z.number().int().min(1),
      maxWordLength: z.number().int().min(1),
      maxAliasesPerWord: z.number().int().min(1),
      difficultyRange: z.object({ min: z.number().int().min(1), max: z.number().int().min(1) }),
    }),
  })
  schema.parse(APP_CONFIG)
  // 额外交叉校验：最小人数必须≤最大人数、难度下限≤上限、最小词条数≤最大词条数
  if (APP_CONFIG.player.minPlayers > APP_CONFIG.player.maxPlayers)
    throw new Error('玩家最小人数不能大于最大人数')
  if (APP_CONFIG.vocabulary.difficultyRange.min > APP_CONFIG.vocabulary.difficultyRange.max)
    throw new Error('词库难度下限不能大于上限')
  if (APP_CONFIG.vocabulary.minWords > APP_CONFIG.vocabulary.maxWords)
    throw new Error('词库最小词条数不能大于最大词条数')
}

/** 排除回环、链路本地与常见虚拟网卡，保留实际可供同网段玩家访问的 IPv4。 */
export function findLanAddresses(): string[] {
  const results = new Set<string>()
  // 遍历所有网络接口，跳过虚拟/回环设备（如 VMware、Hyper-V、WSL、Docker 等）
  for (const [name, entries] of Object.entries(networkInterfaces())) {
    if (/loopback|virtual|vmware|vbox|hyper-v|docker|wsl|tun|tap/i.test(name)) continue
    for (const entry of entries ?? []) {
      // 只保留非内部、非常链路本地的 IPv4 地址
      if (entry.family !== 'IPv4' || entry.internal || entry.address.startsWith('169.254.'))
        continue
      results.add(entry.address)
    }
  }
  return [...results]
}

/**
 * Windows 控制台中文乱码预防提示。
 *
 * Node/pino 向 stdout 输出的是 UTF-8 字节，而 cmd 与旧版 PowerShell 控制台默认按本地
 * 代码页（GBK/cp936）解码，导致中文日志显示为乱码（如“局域网服务监听成功”变成
 * “灞€鍩熺綉鏈嶅姟鐩戝惉鎴愬姛”）。英文/数字不受影响，因为 ASCII 在两种编码中逐字节兼容。
 *
 * 检测条件：Windows 平台 + stdout 为控制台（TTY）+ 当前代码页非 UTF-8(65001)
 * 时打印 ASCII 提示（提示本身用英文，避免在乱码环境里再次无法阅读）。
 */
function warnIfWindowsConsoleNotUtf8(): void {
  if (process.platform !== 'win32' || !process.stdout.isTTY) return
  try {
    const output = execSync('chcp', { encoding: 'utf8' })
    const codePage = output.match(/\d+/)?.[0]
    if (codePage && Number(codePage) !== 65001) {
      console.log(
        `\n[info] Windows console code page is ${codePage} (not UTF-8): Chinese logs may be garbled.\n` +
          `  Please run "chcp 65001" (cmd) or set [Console]::OutputEncoding=UTF8 (PowerShell)\n` +
          `  before starting, or use Windows Terminal for UTF-8 by default.\n`,
      )
    }
  } catch {
    // chcp 不可用（非标准 shell / 无 cmd）时静默跳过，不阻塞启动。
  }
}

/** 日志目录：apps/server/log/（服务端包目录下，与 data/ 同级）。 */
const LOG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../log')
/** 项目根目录（含 .env）：index.ts 位于 apps/server/src/，上溯三级。 */
const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * 加载项目根目录的 .env（若存在）。
 * 用 Node 内置 loadEnvFile：只把 .env 中「尚未存在」的变量写入 process.env，
 * 即进程已有环境变量的优先级高于 .env（符合部署惯例）。文件不存在或无权限时静默跳过。
 */
function loadProjectEnv(): void {
  const envPath = join(PROJECT_ROOT, '.env')
  if (!existsSync(envPath)) return
  try {
    process.loadEnvFile(envPath)
  } catch {
    // .env 解析失败不阻塞启动：缺失的关键项会由 getDeploymentConfig 后续校验报错。
  }
}

/**
 * 依据部署配置构造日志记录器：
 * - logEnabled=false：返回静默日志器，**完全不创建 pino、不建立日志目录**（零内存开销）；
 * - logEnabled=true：创建 pino 文件日志器（本次启动新建一个文件），并裁剪日志文件数至上限。
 */
function makeLogger(deployment: DeploymentConfig): RuntimeLogger {
  if (!deployment.logEnabled) {
    return SILENT_LOGGER
  }
  const logPath = prepareLogDir(deployment.logMaxFiles)
  const pinoLogger = pino(
    { level: deployment.logLevel },
    pino.destination({ dest: logPath, sync: true }),
  )
  pinoLogger.info({ logPath }, '日志文件已创建')
  // 收窄 pino 的多参数重载到 RuntimeLogger 的 (context, message) 双参签名。
  return {
    info: (context, message) => void pinoLogger.info(context, message),
    error: (context, message) => void pinoLogger.error(context, message),
  }
}

/** 生成带日期的日志文件名（精确到秒）：app-YYYY-MM-DD-HH-mm-ss.log。 */
function logFileName(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}-${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return `app-${stamp}.log`
}

/**
 * 准备日志目录：确保目录存在，并裁剪日志文件总数（含本次即将新建的文件）不超过 maxFiles。
 * 文件名是固定宽度的秒级时间戳，字典序即时间序，因此按文件名排序即可定位最老文件并删除。
 * 同秒内连续启动会撞名：若目标文件名已存在，追加 -2/-3 序号避免覆盖上一份日志。
 * @returns 本次启动新建的日志文件完整路径。
 */
function prepareLogDir(maxFiles: number): string {
  mkdirSync(LOG_DIR, { recursive: true })
  const existing = new Set(readdirSync(LOG_DIR))
  const base = logFileName()
  let newPath = join(LOG_DIR, base)
  for (let suffix = 2; existing.has(basename(newPath)); suffix += 1)
    newPath = join(LOG_DIR, base.replace(/\.log$/u, `-${suffix}.log`))
  const logs = readdirSync(LOG_DIR)
    .filter((name) => name.endsWith('.log'))
    .sort() // 字典序 = 时间序（定宽时间戳）
  // 本次新建的文件也会占用一个名额，因此按“已有文件数 + 1”裁剪到上限；不足则一个都不删。
  const excess = logs.length + 1 - maxFiles
  for (let index = 0; index < excess; index += 1) {
    unlinkSync(join(LOG_DIR, logs[index]!)) // 删除最老的日志文件
  }
  return newPath
}

async function main(): Promise<void> {
  // 先加载根目录 .env，让后续 getDeploymentConfig（PORT/HOST/LOG_LEVEL/LOG_ENABLED/LOG_MAX_FILES）读取生效。
  loadProjectEnv()
  // 启动前先校验业务配置，避免带病运行；同时检查 Windows 控制台编码，避免横幅中文乱码。
  warnIfWindowsConsoleNotUtf8()
  validateBusinessConfig()
  const deployment = getDeploymentConfig()
  // 日志开关与条数由 .env（LOG_ENABLED / LOG_MAX_FILES）控制：
  // 关闭时完全不启动日志记录（零 pino 实例、零日志文件），开启时按现有策略写文件。
  const logger = makeLogger(deployment)
  const addresses = findLanAddresses()
  const preferredAddress = addresses[0] ?? 'localhost'
  const application = await createApplication({
    // 公开信息接口中返回的服务器地址优先取第一个局域网 IP
    publicBaseUrl: () => `http://${preferredAddress}:${deployment.port}`,
    logger,
  })
  // 启动恢复：把持久化玩家标记为断线（身份可宽限恢复）、作废全部进行中房间。
  application.service.recoverOnStartup()

  // 端口被占用等监听错误给出可操作的中文提示
  application.httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.error(
        { port: deployment.port },
        `端口 ${deployment.port} 已被占用。请通过 PORT 环境变量或根级 config.ts 更换端口。`,
      )
    } else logger.error({ err: error }, '服务器启动失败')
    process.exitCode = 1
  })

  // 监听成功后打印局域网访问地址清单，方便同网段玩家加入
  application.httpServer.listen(deployment.port, deployment.host, () => {
    const line = '═'.repeat(64)
    console.log(`\n${line}`)
    console.log(`  ${APP_CONFIG.app.name} · 局域网游戏服务已启动`)
    console.log(`  主机访问地址： http://localhost:${deployment.port}`)
    if (addresses.length) {
      addresses.forEach((address, index) =>
        console.log(`  局域网地址 ${index + 1}： http://${address}:${deployment.port}`),
      )
    } else {
      console.log('  未识别到局域网 IPv4。请检查网络连接，并可用 ipconfig/ifconfig 手动确认地址。')
    }
    console.log(`  监听端口：     ${deployment.port}`)
    console.log('  加入说明：其他玩家需连接同一局域网，并在浏览器输入上述局域网地址。')
    console.log('  若无法连接：请允许 Node.js 通过防火墙，并确认设备处于同一网段。')
    console.log('  停止服务：按 Ctrl+C')
    console.log(`${line}\n`)
    logger.info(
      { host: deployment.host, port: deployment.port, lanAddressCount: addresses.length },
      '局域网服务监听成功',
    )
  })

  // 优雅关闭：先通知所有客户端，再关闭 Socket.IO 与 HTTP 服务器
  const shutdown = (signal: string) => {
    logger.info({ signal }, '正在优雅关闭服务')
    application.io.emit(EVENTS.systemError, {
      code: 'SERVER_SHUTDOWN',
      message: serverStrings.notices.serverShutdown,
    })
    application.io.close(() => {
      // 关闭时先落库数据（WAL checkpoint 由 SQLite 自动处理），再关 HTTP 并退出。
      closeDb()
      application.httpServer.close(() => process.exit(0))
    })
    // 3 秒兜底强退，防止连接未关闭导致进程挂起
    setTimeout(() => process.exit(1), 3_000).unref()
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  console.error('服务启动校验失败：', error instanceof Error ? error.message : error)
  process.exit(1)
})
