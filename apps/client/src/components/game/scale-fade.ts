/**
 * 浮层出入场的统一过渡实现：淡入淡出 + 轻微缩放（进入 180ms / 退出 140ms）。
 *
 * 抽成共享函数供 FloatingPanel 与 CanvasToolbar 复用，避免两处各写一份 WAAPI 造成手感漂移。
 * Vue `<Transition :css="false">` 会以 (element, done) 调用这些钩子，动画 finished 回调负责收尾，
 * 因此不用维护 CSS 类的进入/退出时序，也不会与元素自身的 left/top 定位互相干扰。
 */
const ENTER_DURATION_MS = 180
const LEAVE_DURATION_MS = 140
/** 面板与工具条统一使用同一条进入缓动曲线。 */
const ENTER_EASING = 'cubic-bezier(0.2, 0.75, 0.25, 1)'

/** 进入：从略小且透明缩放到位。 */
export function scaleFadeEnter(element: Element, done: () => void): void {
  const animation = element.animate(
    [
      { opacity: 0, transform: 'scale(0.94)' },
      { opacity: 1, transform: 'scale(1)' },
    ],
    { duration: ENTER_DURATION_MS, easing: ENTER_EASING },
  )
  void animation.finished.then(done, done)
}

/** 退出：从原尺寸淡出并轻微缩小。 */
export function scaleFadeLeave(element: Element, done: () => void): void {
  const animation = element.animate(
    [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(0.94)' },
    ],
    { duration: LEAVE_DURATION_MS, easing: 'ease-in' },
  )
  void animation.finished.then(done, done)
}
