import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import pino from 'pino'
import type { DeploymentConfig } from '../../../../config/index.ts'
import { SILENT_LOGGER, type RuntimeLogger } from '../errors.ts'

const LOG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../log')

export function logFileName(date: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(
    date.getHours(),
  )}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  return `app-${stamp}.log`
}

export function prepareLogDir(maxFiles: number): string {
  mkdirSync(LOG_DIR, { recursive: true })
  const existing = new Set(readdirSync(LOG_DIR))
  const base = logFileName()
  let newPath = join(LOG_DIR, base)
  for (let suffix = 2; existing.has(basename(newPath)); suffix += 1)
    newPath = join(LOG_DIR, base.replace(/\.log$/u, `-${suffix}.log`))
  // 按文件创建时间升序删最旧：绝对不能按文件名排序，因为同秒文件名 `-10.log < -2.log`，
  // 会让字典序把后创建的文件当作更旧删除（见缺陷报告 #11）。
  const fileAge = (name: string): number => {
    const stat = statSync(join(LOG_DIR, name))
    // birthtime 为创建时间；极少数不支持的文件系统回退 mtime。
    return stat.birthtimeMs || stat.mtimeMs || 0
  }
  const logs = readdirSync(LOG_DIR)
    .filter((name) => name.endsWith('.log'))
    .sort((left, right) => fileAge(left) - fileAge(right))
  const excess = logs.length + 1 - maxFiles
  for (let index = 0; index < excess; index += 1) unlinkSync(join(LOG_DIR, logs[index]!))
  return newPath
}

export function makeLogger(deployment: DeploymentConfig): RuntimeLogger {
  if (!deployment.logEnabled) return SILENT_LOGGER
  const logPath = prepareLogDir(deployment.logMaxFiles)
  const logger = pino(
    { level: deployment.logLevel },
    pino.destination({ dest: logPath, sync: true }),
  )
  logger.info({ logPath }, '日志文件已创建')
  return {
    info: (context, message) => void logger.info(context, message),
    error: (context, message) => void logger.error(context, message),
  }
}
