/** 局域网生产入口：组合环境、日志、应用、监听与关闭生命周期。 */
import { APP_CONFIG, getDeploymentConfig } from '../../../config/index.ts'
import { createApplication } from './app.ts'
import { makeLogger } from './logging/file-logger.ts'
import { loadProjectEnv } from './startup/environment.ts'
import { findLanAddresses, warnIfWindowsConsoleNotUtf8 } from './startup/lan-addresses.ts'
import { registerShutdown } from './startup/shutdown.ts'
import { validateBusinessConfig } from './startup/validate-config.ts'

function printStartupBanner(port: number, addresses: readonly string[]): void {
  const line = '═'.repeat(64)
  console.log(`\n${line}`)
  console.log(`  ${APP_CONFIG.app.name} · 局域网游戏服务已启动`)
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
  loadProjectEnv()
  warnIfWindowsConsoleNotUtf8()
  validateBusinessConfig()
  const deployment = getDeploymentConfig()
  const logger = makeLogger(deployment)
  const addresses = findLanAddresses()
  const preferredAddress = addresses[0] ?? 'localhost'
  const application = await createApplication({
    publicBaseUrl: () => `http://${preferredAddress}:${deployment.port}`,
    logger,
  })
  application.service.recoverOnStartup()

  application.httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`端口 ${deployment.port} 已被占用。请通过 PORT 环境变量更换端口。`)
      logger.error(
        { port: deployment.port },
        `端口 ${deployment.port} 已被占用。请通过 PORT 环境变量或 config/app.ts 更换端口。`,
      )
    } else {
      console.error('服务器启动失败:', error)
      logger.error({ err: error }, '服务器启动失败')
    }
    process.exit(1)
  })

  application.httpServer.listen(deployment.port, deployment.host, () => {
    printStartupBanner(deployment.port, addresses)
    logger.info(
      { host: deployment.host, port: deployment.port, lanAddressCount: addresses.length },
      '局域网服务监听成功',
    )
  })
  registerShutdown(application, logger)
}

main().catch((error: unknown) => {
  console.error('服务启动校验失败：', error instanceof Error ? error.message : error)
  process.exit(1)
})
