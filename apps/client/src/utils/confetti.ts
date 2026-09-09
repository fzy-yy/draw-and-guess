/**
 * 礼花特效工具：基于 canvas-confetti（**按需动态加载**）。
 * 只有玩家猜中时才会用到，因此不进入首屏包；加载失败属非关键装饰性反馈，静默降级。
 */
import type confettiFactory from 'canvas-confetti'

/** 触发猜中庆祝礼花（双侧喷射，覆盖全屏上方与中央）；canvas-confetti 首次调用时才下载。 */
export async function fireGuessCorrectConfetti(): Promise<void> {
  let confetti: typeof confettiFactory
  try {
    confetti = (await import('canvas-confetti')).default
  } catch {
    // 装饰性反馈，加载失败不影响对局
    return
  }

  // 左下侧斜上方喷射
  confetti({
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
  confetti({
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
