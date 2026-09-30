/**
 * 端口选择。
 *
 * 分发产物（`node server.mjs`）需要一个「尽量不失败」的启动体验：默认端口被占用时向后顺延，
 * 而不是直接报错退出。源码模式的端口保持固定（配合 Vite 的 5174 代理），不经过本模块。
 */
import { createServer } from 'node:net'

/**
 * 从起始端口向后寻找第一个可绑定端口；尝试区间封顶 65535，区间内全部被占用才抛错。
 *
 * 已知取舍：探测与调用方正式 listen 之间存在微秒级 TOCTOU 竞态（探测空闲的端口
 * 可能在两步之间被其他进程抢占）。竞态窗口极小且真发生时表现为下次启动自动再顺延，
 * 评审结论为接受该风险、不做重试封装（见 docs/adr/0034）。
 */
export async function pickAvailablePort(start: number, host: string, limit = 50): Promise<number> {
  const upper = Math.min(start + limit, 65_535)
  for (let port = start; port <= upper; port += 1) {
    if (await isPortFree(port, host)) return port
  }
  // 接近 65535 时区间被封顶，实际尝试数可能少于 limit（start=65535 时只有 1 个）；
  // 错误文案必须按实际尝试数生成，否则「连续 50 个端口均被占用」与事实不符、误导排查。
  const attempts = Math.min(limit, 65_535 - start + 1)
  throw new Error(`端口 ${start} 起连续 ${attempts} 个端口均被占用，请关闭占用程序后重试`)
}

function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = createServer()
    const finish = (free: boolean): void => {
      tester.removeAllListeners()
      resolve(free)
    }
    tester.once('error', () => finish(false))
    tester.once('listening', () => tester.close(() => finish(true)))
    tester.listen(port, host)
  })
}
