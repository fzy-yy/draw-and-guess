/**
 * 虚拟滚动行组合式逻辑（可复用）：统一封装 @tanstack/vue-virtual 的行级虚拟化。
 * 词库管理的表格视图（DataTable）是唯一消费方；虚拟化参数与再测量时机集中在此，
 * 避免行高估算与「数据变化后重测」散落到各渲染层导致漂移（曾因视图切换后测量失效出现白屏）。
 * - 行高先按 estimateSize 估算，再由 measureElement 逐行实测校准（适配 cqh 缩放）；
 * - 行数据变化后自动全量重新测量。
 */
import { computed, nextTick, watch, type Ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'

/** 组合式入参：滚动容器引用、虚拟项总数、估算行高（支持数值、Ref 或函数）。 */
export function useVirtualRows(options: {
  /** 滚动容器元素引用（挂载前为 undefined，挂载后虚拟器自动接管）。 */
  scrollElement: Ref<HTMLElement | undefined>
  /** 虚拟项总数（响应式；为 0 时虚拟器不渲染任何项，空态由调用方自行展示）。 */
  count: Ref<number>
  /** 初始估算行高（px），随后可由实测校准。 */
  estimateSize: number | Ref<number> | (() => number)
}) {
  const getEstimate = (): number => {
    if (typeof options.estimateSize === 'function') return options.estimateSize()
    if (typeof options.estimateSize === 'number') return options.estimateSize
    return options.estimateSize.value
  }

  const virtualizer = useVirtualizer(
    computed(() => ({
      count: options.count.value,
      getScrollElement: () => options.scrollElement.value ?? null,
      estimateSize: getEstimate,
      overscan: 5,
    })),
  )

  /** 透传给 measureElement 的模板 ref 处理：Vue 传入的可能是组件实例，需先窄化。 */
  function measureElementRef(el: unknown): void {
    if (el instanceof HTMLElement) virtualizer.value.measureElement(el)
  }

  // 行数据变化（搜索/筛选/切视图）后触发一次全量重新测量，校正行高与总高。
  watch(options.count, async () => {
    await nextTick()
    virtualizer.value.measure()
  })

  return { virtualizer, measureElementRef }
}
