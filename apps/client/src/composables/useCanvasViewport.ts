import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { APP_CONFIG } from '@draw-guess/config'
import { getCanvasBackingSize, getDisplayCanvasSize, presentLogicalCanvas } from '@/canvas/viewport'

/**
 * 管理固定逻辑层和 DPR 展示层；逻辑尺寸变化时把新尺寸交给重放机器（机器自行设置尺寸并整帧重放），
 * 纯 DPR/展示缩放只重新投影。逻辑画布归 DrawingReplayMachine 所有，本 composable 只测量与投影。
 */
export function useCanvasViewport(
  displayCanvas: Ref<HTMLCanvasElement | undefined>,
  logicalCanvas: HTMLCanvasElement,
  onLogicalResize: (width: number, height: number) => void,
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
    if (element.width !== displaySize.width || element.height !== displaySize.height) {
      element.width = displaySize.width
      element.height = displaySize.height
    }
    resizeTick.value += 1
    // 逻辑尺寸的写入由机器在 resize 内完成（清空与换入同段发生，展示层无白闪窗口）。
    if (logicalChanged) onLogicalResize(logicalSize.width, logicalSize.height)
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

  // resizeCanvas 对外为测试观测出口：生产只由 ResizeObserver 与 onMounted 驱动
  // （GameCanvas 仅消费 resizeTick）；ClientComposables.spec 直接调用它验证
  // 「显式缩放 → 逻辑尺寸交机器 / 同尺寸只重投影」两条分支。保留并显式导出。
  return { resizeTick, resizeCanvas }
}
