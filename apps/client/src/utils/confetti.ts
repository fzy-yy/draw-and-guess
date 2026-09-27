/**
 * 礼花特效工具：基于 canvas-confetti（**按需动态加载**）。
 * 只有玩家猜中时才会用到，因此不进入首屏包；加载失败属非关键装饰性反馈，静默降级。
 *
 * 为什么显式渲染在**主线程**（useWorker:false）：canvas-confetti 的默认导出使用
 * Blob Worker 渲染，而服务端 CSP 为 `script-src 'self'`（未声明 worker-src 时按规范回退
 * script-src），会拦截 blob Worker。默认实现仍会先把画布 `transferControlToOffscreen`，
 * 于是 Worker 从未执行、主线程也无画布可回退——表现为「任何玩家猜中都没有礼花」。
 * 主线程渲染与 CSP 无关，且画布不再被转移，保留可读像素供端到端断言真实绘制。
 */
import type confettiFactory from 'canvas-confetti'

/** 主线程礼花发射器（首次触发时按需创建并缓存）。 */
type ConfettiFire = ReturnType<typeof confettiFactory.create>

/** 两侧喷射共用的基础参数；仅 angle 与 origin 逐侧不同，其余含义见 canvas-confetti Options。 */
const baseFireOptions: NonNullable<Parameters<ConfettiFire>[0]> = {
  particleCount: 200,
  spread: 90,
  startVelocity: 60,
  decay: 0.9,
  gravity: 1,
  drift: 0,
  flat: false,
  ticks: 400,
  scalar: 1,
  zIndex: 9999,
}

let fire: ConfettiFire | undefined

/** 触发猜中庆祝礼花（双侧喷射，覆盖全屏上方与中央）；canvas-confetti 首次调用时才下载。 */
export async function fireGuessCorrectConfetti(): Promise<void> {
  if (!fire) {
    try {
      const confetti = (await import('canvas-confetti')).default
      // resize:true 让画布随窗口尺寸自适应；useWorker:false 的原因见文件头注释。
      fire = confetti.create(undefined, { resize: true, useWorker: false })
    } catch {
      // 装饰性反馈，加载失败不影响对局
      return
    }
  }

  // 左下侧斜上方喷射
  fire({ ...baseFireOptions, angle: 60, origin: { x: 0, y: 0.7 } })

  // 右下侧斜上方喷射
  fire({ ...baseFireOptions, angle: 120, origin: { x: 1, y: 0.7 } })
}
