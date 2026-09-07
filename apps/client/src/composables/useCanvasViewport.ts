import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { APP_CONFIG } from '@draw-guess/config'
import { getCanvasBackingSize } from '@/canvas/viewport'

/** 管理 Canvas backing size 与 ResizeObserver；重绘策略由调用方注入。 */
export function useCanvasViewport(canvas: Ref<HTMLCanvasElement | undefined>, redraw: () => void) {
  const resizeTick = ref(0)
  let observer: ResizeObserver | undefined

  function resizeCanvas(): void {
    const element = canvas.value
    if (!element) return
    const rect = element.getBoundingClientRect()
    const size = getCanvasBackingSize(
      rect.width,
      rect.height,
      APP_CONFIG.drawing.referenceResolution,
    )
    if (element.width !== size.width || element.height !== size.height) {
      element.width = size.width
      element.height = size.height
    }
    resizeTick.value += 1
    redraw()
  }

  onMounted(() => {
    observer = new ResizeObserver(resizeCanvas)
    if (canvas.value) observer.observe(canvas.value)
    resizeCanvas()
  })
  onBeforeUnmount(() => observer?.disconnect())

  return { resizeTick, resizeCanvas }
}
