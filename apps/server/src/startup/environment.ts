import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..')

/** 加载根 .env；进程已有变量优先，解析失败交由部署配置校验处理。可传入显式路径（分发产物数据目录）。 */
export function loadProjectEnv(envPath: string = join(PROJECT_ROOT, '.env')): void {
  if (!existsSync(envPath)) return
  try {
    process.loadEnvFile(envPath)
  } catch {
    // 部署配置读取阶段会对缺失或非法字段给出稳定错误。
  }
}
