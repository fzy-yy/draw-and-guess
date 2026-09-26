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
  fire({
    // 整数（默认值：50）：发射的彩纸数量
    particleCount: 200,
    // 数值（默认值：90）：以度为单位的发射角度，90 表示垂直向上发射
    angle: 60,
    // 数值（默认值：45）：彩纸偏离中心的最大角度，单位为度
    spread: 90,
    // 数字（默认值：45）：礼花开始运动的速度，单位为像素
    startVelocity: 60,
    // 数字（默认值：0.9）：礼花速度衰减的快慢
    decay: 0.9,
    // 数字（默认值：1）：粒子下落的加速度
    gravity: 1,
    // 数字（默认值：0）：礼花向侧方漂移的程度
    drift: 0,
    // 布尔值（默认：false）：可选地关闭三维彩带在真实世界中应有的倾斜和晃动效果
    flat: false,
    // 数字（默认值：200）：彩纸将移动的次数
    ticks: 400,
    // Number（默认值：1）：每个礼花粒子的缩放系数
    scalar: 1,
    // 对象 ：从何处开始发射彩纸
    origin: { x: 0, y: 0.7 },
    zIndex: 9999,
  })

  // 右下侧斜上方喷射
  fire({
    // 整数（默认值：50）：发射的彩纸数量
    particleCount: 200,
    // 数值（默认值：90）：以度为单位的发射角度，90 表示垂直向上发射
    angle: 120,
    // 数值（默认值：45）：彩纸偏离中心的最大角度，单位为度
    spread: 90,
    // 数字（默认值：45）：礼花开始运动的速度，单位为像素
    startVelocity: 60,
    // 数字（默认值：0.9）：礼花速度衰减的快慢
    decay: 0.9,
    // 数字（默认值：1）：粒子下落的加速度
    gravity: 1,
    // 数字（默认值：0）：礼花向侧方漂移的程度
    drift: 0,
    // 布尔值（默认：false）：可选地关闭三维彩带在真实世界中应有的倾斜和晃动效果
    flat: false,
    // 数字（默认值：200）：彩纸将移动的次数
    ticks: 400,
    // Number（默认值：1）：每个礼花粒子的缩放系数
    scalar: 1,
    // 对象 ：从何处开始发射彩纸
    origin: { x: 1, y: 0.7 },
    zIndex: 9999,
  })
}
