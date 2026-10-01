/**
 * 画布光标组合式逻辑（画布四件套之一）：按工具 / 权限 / 画布显示缩放派生
 * 跟随光标的圆点预览（位置、直径、颜色与可见性）。直径与落笔线宽共用
 * canvas/geometry 同一口径（ADR-0022），保证「看到的圈 = 画出的线」；
 * 只做 DOM 坐标换算与展示派生，不参与任何笔画提交与游戏裁决。
 */
import { computed, ref, type Ref } from 'vue'
import { APP_CONFIG } from '@draw-guess/config'
import type { ToolKind } from '@draw-guess/shared'
import { strokeWidthAt } from '@/canvas/geometry'

export function useCanvasCursor(options: {
  canvas: Ref<HTMLCanvasElement | undefined>
  width: Ref<number>
  tool: () => ToolKind
  color: () => string
  canDraw: () => boolean
  resizeTick: Ref<number>
}) {
  const cursorVisible = ref(false)
  const cursorPos = ref({ x: 0, y: 0 })
  const cursorDiameter = computed(() => {
    void options.resizeTick.value
    const element = options.canvas.value
    if (!element) return options.width.value
    const rect = element.getBoundingClientRect()
    const scale = Math.min(rect.width, rect.height) / APP_CONFIG.drawing.referenceResolution
    // 直径 ≡ 落笔线宽：与 rendering.renderStroke 共用 geometry 同一公式（ADR-0022）。
    return strokeWidthAt(options.width.value, scale, APP_CONFIG.drawing.minLineScale)
  })
  const cursorColor = computed(() =>
    options.tool() === 'eraser' ? 'var(--color-line)' : options.color(),
  )
  const showCursorDot = computed(
    () => options.canDraw() && cursorVisible.value && options.tool() !== 'fill',
  )

  function cursorTrack(event: PointerEvent): void {
    const rect = options.canvas.value?.getBoundingClientRect()
    if (!rect) return
    cursorPos.value = { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }

  /**
   * 指针进入画布：置可见的同一次调用里必须用进入事件的坐标落点。
   * 模态弹窗（如清空确认）关闭后，浏览器只补发 pointerenter、不会补发 pointermove；如果这里只置
   * 可见，圆点会停在指针离开画布前的旧位置——而此刻原生光标已被 cursor-none 隐藏，玩家看到的就是
   * 「鼠标瞬移到了刚才那个按钮旁边」。
   */
  function cursorEnter(event: PointerEvent): void {
    cursorTrack(event)
    cursorVisible.value = true
  }

  return {
    // cursorVisible 对外为测试观测出口：内部已折算进 showCursorDot 供模板消费，
    // 生产组件不再单独读取该原始状态（GameCanvas 只用 showCursorDot 等派生值）；
    // ClientComposables.spec 借它验证 cursorEnter/cursorLeave 的落点。保留并显式导出。
    cursorVisible,
    cursorPos,
    cursorDiameter,
    cursorColor,
    showCursorDot,
    cursorEnter,
    cursorLeave: () => (cursorVisible.value = false),
    cursorTrack,
  }
}
