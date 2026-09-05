/**
 * 礼花特效工具：基于 canvas-confetti。
 * 在玩家猜对词语时触发礼花喷放，增添派对游戏正向反馈。
 */
import confetti from 'canvas-confetti'

/** 触发猜中庆祝礼花（双侧喷射，覆盖全屏上方与中央） */
export function fireGuessCorrectConfetti(): void {
  // 左下侧斜上方喷射
  confetti({
    particleCount: 50,
    angle: 60,
    spread: 55,
    origin: { x: 0.1, y: 0.7 },
    zIndex: 9999,
  })
  // 右下侧斜上方喷射
  confetti({
    particleCount: 50,
    angle: 120,
    spread: 55,
    origin: { x: 0.9, y: 0.7 },
    zIndex: 9999,
  })
}
