import { computed, ref, type Ref } from 'vue'
import { APP_CONFIG } from '@draw-guess/config'
import type { ToolKind } from '@draw-guess/shared'

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
    return options.width.value * Math.max(APP_CONFIG.drawing.minLineScale, scale)
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

  return {
    cursorVisible,
    cursorPos,
    cursorDiameter,
    cursorColor,
    showCursorDot,
    cursorEnter: () => (cursorVisible.value = true),
    cursorLeave: () => (cursorVisible.value = false),
    cursorTrack,
  }
}
