/**
 * 局域网生产服务入口。
 * 启动前验证唯一业务配置与词库，并列出所有可信局域网 IPv4 候选地址。
 */
import { networkInterfaces } from 'node:os'
import pino from 'pino'
import { z } from 'zod'
import { APP_CONFIG, getDeploymentConfig } from '../../../config.ts'
import { serverStrings } from '../../../config/strings.ts'
import { createApplication } from './app.ts'

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
    }),
  })
  schema.parse(APP_CONFIG)
  // 额外交叉校验：最小人数必须≤最大人数（zod 无法直接表达跨字段关系）
  if (APP_CONFIG.player.minPlayers > APP_CONFIG.player.maxPlayers)
    throw new Error('玩家最小人数不能大于最大人数')
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

async function main(): Promise<void> {
  // 启动前先校验业务配置，避免带病运行
  validateBusinessConfig()
  const deployment = getDeploymentConfig()
  const logger = pino({ level: deployment.logLevel })
  const addresses = findLanAddresses()
  const preferredAddress = addresses[0] ?? 'localhost'
  const application = await createApplication({
    // 公开信息接口中返回的服务器地址优先取第一个局域网 IP
    publicBaseUrl: () => `http://${preferredAddress}:${deployment.port}`,
    logger,
  })

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
    application.io.emit('system:error', {
      code: 'SERVER_SHUTDOWN',
      message: serverStrings.notices.serverShutdown,
    })
    application.io.close(() => application.httpServer.close(() => process.exit(0)))
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
