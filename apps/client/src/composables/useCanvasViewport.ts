import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { APP_CONFIG } from '@draw-guess/config'
import { getCanvasBackingSize, getDisplayCanvasSize, presentLogicalCanvas } from '@/canvas/viewport'

/** 管理固定逻辑层和 DPR 展示层；逻辑尺寸变化才重放命令，纯 DPR/展示缩放只重新投影。 */
export function useCanvasViewport(
  displayCanvas: Ref<HTMLCanvasElement | undefined>,
  logicalCanvas: HTMLCanvasElement,
  redrawLogical: () => void,
) {
  const resizeTick = ref(0)
  let observer: ResizeObserver | undefined

  function resizeCanvas(): void {
    const element = displayCanvas.value
    if (!element) return
    const rect = element.getBoundingClientRect()
    const logicalSize = getCanvasBackingSize(
      rect.width,
      rect.height,
      APP_CONFIG.drawing.referenceResolution,
    )
    const displaySize = getDisplayCanvasSize(
      rect.width,
      rect.height,
      globalThis.devicePixelRatio ?? 1,
      APP_CONFIG.drawing.devicePixelRatioCap,
    )
    const logicalChanged =
      logicalCanvas.width !== logicalSize.width || logicalCanvas.height !== logicalSize.height
    if (logicalChanged) {
      logicalCanvas.width = logicalSize.width
      logicalCanvas.height = logicalSize.height
    }
    if (element.width !== displaySize.width || element.height !== displaySize.height) {
      element.width = displaySize.width
      element.height = displaySize.height
    }
    resizeTick.value += 1
    if (logicalChanged) redrawLogical()
    else presentLogicalCanvas(logicalCanvas, element)
  }

  onMounted(() => {
    const element = displayCanvas.value
    // 非枚举测试探针仅暴露同组件的逻辑层引用，便于跨客户端验证权威栅格哈希；不进入协议或序列化。
    // 默认生产构建不包含该探针；E2E 构建由 launcher 注入 VITE_EXPOSE_LOGICAL_CANVAS=1（见 test/e2e/launcher.mts）。
    if (element && (import.meta.env.DEV || import.meta.env.VITE_EXPOSE_LOGICAL_CANVAS === '1')) {
      Object.defineProperty(element, '__logicalCanvas', {
        configurable: true,
        value: logicalCanvas,
      })
    }
    observer = new ResizeObserver(resizeCanvas)
    if (displayCanvas.value) observer.observe(displayCanvas.value)
    resizeCanvas()
  })
  onBeforeUnmount(() => observer?.disconnect())

  return { resizeTick, resizeCanvas }
}
