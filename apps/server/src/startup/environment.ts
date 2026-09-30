/**
 * 项目配置文件的加载：失败姿态统一为「宁可中止启动，也不静默按默认值运行」——
 * 静默吞掉「配置没读到」，等于让部署参数悄悄失效且没有任何可观察迹象，排查成本远高于一条启动错误
 *（取舍见 docs/adr/0035-startup-config-fail-fast.md）。
 */
import { closeSync, existsSync, openSync, readSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

/** UTF-8 BOM 的字节前缀（EF BB BF）：Node 的 `loadEnvFile` 不会剥离它。 */
const UTF8_BOM_PREFIX = Buffer.from([0xef, 0xbb, 0xbf])

/** 取系统调用错误的 errno 码；非 Errno 形态返回 'unknown'，保证文案始终有码位可印。 */
function errorCodeOf(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return typeof code === 'string' && code !== '' ? code : 'unknown'
}

/**
 * 配置文件带 UTF-8 BOM 时的运维文案：点名成因与修正办法。
 * BOM 会让首个键名变成 `\uFEFFHOST`（键名前多出不可见字符）而不被识别——那一行配置会**静默失效**，
 * 而「记事本另存为 UTF-8」「PowerShell 5.1 写文件」在 Windows 上都会写出 BOM，是常见来源。
 */
function buildEnvFileBomMessage(envPath: string): string {
  return (
    `配置文件存在 UTF-8 BOM，已拒绝加载：${envPath}。` +
    'Windows PowerShell 5.1 与旧版记事本把文件保存为 UTF-8 时会写入 BOM，' +
    '首个配置项（如 HOST）会被连同 BOM 一起静默丢弃。' +
    '请将本文件另存为「UTF-8 无 BOM」后重新启动。'
  )
}

/**
 * 配置文件整体读取失败（权限不足、路径是目录等）的运维文案：带系统错误码便于直接定位成因，
 * 并明确「已中止启动」——旧实现用 `catch {}` 把这类失败整份吞掉，配置根本没读到却按默认值跑起来。
 */
function buildEnvFileUnreadableMessage(envPath: string, code: string): string {
  return (
    `配置文件无法读取，已中止启动：${envPath}（错误码 ${code}）。` +
    '请检查文件权限与路径类型（配置路径不能是目录）；' +
    '若确实不需要自定义配置，请删除该文件，服务将按默认配置启动。'
  )
}

/** 读取配置文件头三个字节（仅供 BOM 判定）；读不到时抛带错误码的运维错误，不静默吞异常。 */
function readHeadBytes(envPath: string): Buffer {
  try {
    const fd = openSync(envPath, 'r')
    try {
      const buffer = Buffer.alloc(UTF8_BOM_PREFIX.length)
      const bytesRead = readSync(fd, buffer, 0, buffer.length, 0)
      return buffer.subarray(0, bytesRead)
    } finally {
      // 只读 fd 的关闭失败不改变「已读到 / 读不到」的结论；在 finally 里抛出会顶替主错误，
      // 故就地吞掉——真实成因（open/read 的错误码）统一由外层 catch 转成运维文案。
      try {
        closeSync(fd)
      } catch {
        // 仅防御 closeSync 的极端失败。
      }
    }
  } catch (error) {
    throw new Error(buildEnvFileUnreadableMessage(envPath, errorCodeOf(error)), { cause: error })
  }
}

/**
 * 加载根 .env；进程已有变量优先。可传入显式路径（分发产物数据目录）。
 * 三种情形分别处理：
 * - 文件不存在：静默跳过——.env 本就是可选配置；
 * - 首三字节是 UTF-8 BOM：fail-fast，不静默剥离。剥离等于纵容继续用会写 BOM 的编辑器保存，
 *   而这类文件里被 BOM 顶掉的那一行本来就已经在静默失效（正是本函数要拦的情形）；
 * - 读取 / 加载任一环节失败：抛带错误码的运维文案，绝不静默按默认配置启动。
 * 抛出的错误由进程入口统一打印并终止启动。
 */
export function loadProjectEnv(envPath: string = join(PROJECT_ROOT, '.env')): void {
  if (!existsSync(envPath)) return
  const head = readHeadBytes(envPath)
  if (head.equals(UTF8_BOM_PREFIX)) {
    throw new Error(buildEnvFileBomMessage(envPath))
  }
  try {
    process.loadEnvFile(envPath)
  } catch (error) {
    // 走到这里头字节已读到，loadEnvFile 再失败只可能是文件在检查后被并发改坏或权限变化；
    // 同样按「配置没生效」对待并带上错误码，不沿用旧的静默吞异常。
    throw new Error(buildEnvFileUnreadableMessage(envPath, errorCodeOf(error)), { cause: error })
  }
}
