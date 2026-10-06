/** 局域网生产入口：组合环境、日志、应用、监听与关闭生命周期。 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { APP_CONFIG, getDeploymentConfig } from './core/config.ts'
import { createApplication } from './server.ts'
import { makeLogger } from './infra/logging/file-logger.ts'
import { loadVocabulary } from './vocabulary/index.ts'
import { loadProjectEnv } from './startup/environment.ts'
import { findLanAddresses, warnIfWindowsConsoleNotUtf8 } from './startup/lan-addresses.ts'
import { openBrowser } from './startup/open-browser.ts'
import { pickAvailablePort } from './startup/port.ts'
import { registerShutdown } from './startup/shutdown.ts'
import { validateBusinessConfig } from './startup/validate-config.ts'
import { resolveRuntimeLayout, type RuntimeLayout, type RuntimeMode } from './runtime-layout.ts'
import { runtimeErrorType, SILENT_LOGGER } from './core/errors.ts'

/**
 * 运行模式：构建产物由 esbuild 注入 `DRAW_GUESS_RUNTIME_MODE=dist`，
 * 源码运行时读不到该变量，按 source 处理（保持既有仓库相对路径不变）。
 */
const RUNTIME_MODE: RuntimeMode = process.env.DRAW_GUESS_RUNTIME_MODE === 'dist' ? 'dist' : 'source'

let activeLogger = SILENT_LOGGER

/** 异常退出不等待异步回调；destination 尚未 ready/已损坏时允许丢失最后一个缓冲批次。 */
function flushBeforeExit(logger: typeof SILENT_LOGGER): void {
  try {
    logger.flushSync()
  } catch {
    // 控制台已给出安全错误摘要，日志介质不可用时继续按原退出码终止。
  }
}

/** 预先创建数据库、日志与词库目录，保证用户可直接放入自定义词库文件。 */
function ensureLayoutDirectories(layout: RuntimeLayout): void {
  mkdirSync(dirname(layout.databaseFile), { recursive: true })
  mkdirSync(layout.logDir, { recursive: true })
  for (const dir of layout.vocabularyDirs) mkdirSync(dir, { recursive: true })
}

function printStartupBanner(port: number, addresses: readonly string[]): void {
  const line = '═'.repeat(64)
  console.log(`\n${line}`)
  console.log(`  ${APP_CONFIG.app.name} · 游戏服务已启动`)
  console.log(`  主机访问地址： http://localhost:${port}`)
  if (addresses.length) {
    addresses.forEach((address, index) =>
      console.log(`  局域网地址 ${index + 1}： http://${address}:${port}`),
    )
  } else {
    console.log('  未识别到局域网 IPv4。请检查网络连接，并可用 ipconfig/ifconfig 手动确认地址。')
  }
  console.log(`  监听端口：     ${port}`)
  console.log('  加入说明：其他玩家需连接同一局域网，并在浏览器输入上述局域网地址。')
  console.log('  若无法连接：请允许 Node.js 通过防火墙，并确认设备处于同一网段。')
  console.log('  停止服务：按 Ctrl+C')
  console.log(`${line}\n`)
}

async function main(): Promise<void> {
  const layout = resolveRuntimeLayout({
    mode: RUNTIME_MODE,
    entryDir: dirname(fileURLToPath(import.meta.url)),
  })
  ensureLayoutDirectories(layout)
  loadProjectEnv(layout.envFile)
  warnIfWindowsConsoleNotUtf8()
  validateBusinessConfig()
  const deployment = getDeploymentConfig()
  // 产物模式默认端口被占用时自动顺延；源码模式固定端口以配合 Vite 代理。
  const port = layout.portFallback
    ? await pickAvailablePort(deployment.port, deployment.host)
    : deployment.port
  const logger = makeLogger(deployment, { logDir: layout.logDir })
  activeLogger = logger
  const vocabulary = await loadVocabulary(layout.vocabularyDirs)
  const addresses = findLanAddresses()
  const preferredAddress = addresses[0] ?? 'localhost'
  const application = await createApplication({
    vocabulary,
    publicBaseUrl: () => `http://${preferredAddress}:${port}`,
    logger,
    dbFile: layout.databaseFile,
    clientDist: layout.clientDist,
    healthMetricsEnabled: deployment.healthMetricsEnabled,
  })
  application.service.recoverOnStartup()

  application.httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`端口 ${port} 已被占用。请通过 PORT 环境变量更换端口。`)
      logger.error({ port }, '端口已被占用')
    } else {
      console.error('服务器启动失败:', runtimeErrorType(error))
      logger.error({ errorType: runtimeErrorType(error) }, '服务器启动失败')
    }
    flushBeforeExit(logger)
    process.exit(1)
  })

  application.httpServer.listen(port, deployment.host, () => {
    printStartupBanner(port, addresses)
    logger.info(
      { host: deployment.host, port, lanAddressCount: addresses.length },
      '局域网服务监听成功',
    )
    // 分发产物自动打开浏览器，省去用户手动输入地址；开关经部署配置收口
    // （源码模式布局本身不要求开浏览器，`DRAW_GUESS_OPEN_BROWSER=0/false` 可关闭）。
    if (layout.openBrowser && deployment.openBrowserEnabled) openBrowser(`http://localhost:${port}`)
  })
  registerShutdown(application, logger)
}

main().catch((error: unknown) => {
  console.error('服务启动校验失败：', error instanceof Error ? error.message : error)
  activeLogger.error({ errorType: runtimeErrorType(error) }, '服务启动校验失败')
  flushBeforeExit(activeLogger)
  process.exit(1)
})
