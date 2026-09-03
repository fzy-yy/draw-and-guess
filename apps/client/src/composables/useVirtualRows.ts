/**
 * 虚拟滚动行组合式逻辑（可复用）：统一封装 @tanstack/vue-virtual 的行级虚拟化。
 * 词库管理的「散列视图」与「表格视图」共用同一套虚拟化参数与再测量时机，
 * 避免两处各自维护一份容易漂移的逻辑（曾因视图切换后测量失效出现白屏）。
 * - 行高先按 estimateSize 估算，再由 measureElement 逐行实测校准（适配 cqh 缩放）；
 * - 行数据变化后自动全量重新测量。
 */
import { computed, nextTick, watch, type Ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'

/** 组合式入参：滚动容器引用、虚拟项总数、初始估算行高（px）。 */
export function useVirtualRows(options: {
  /** 滚动容器元素引用（挂载前为 undefined，挂载后虚拟器自动接管）。 */
  scrollElement: Ref<HTMLElement | undefined>
  /** 虚拟项总数（响应式；为 0 时虚拟器不渲染任何项，空态由调用方自行展示）。 */
  count: Ref<number>
  /** 初始估算行高（px），随后由实测校准。 */
  estimateSize: number
  /** 每个虚拟项内实际渲染的行数（散列视图一行 6 个词条时传 6，表格传 1）。 */
  itemsPerVirtual?: number
}) {
  const virtualizer = useVirtualizer(
    computed(() => ({
      count: Math.ceil(options.count.value / (options.itemsPerVirtual ?? 1)),
      getScrollElement: () => options.scrollElement.value ?? null,
      estimateSize: () => options.estimateSize,
      overscan: 3,
    })),
  )

  /** 透传给 measureElement 的模板 ref 处理：Vue 传入的可能是组件实例，需先窄化。 */
  function measureElementRef(el: unknown): void {
    if (el instanceof HTMLElement) virtualizer.value.measureElement(el)
  }

  /** 取某个虚拟项对应的原始数据切片区间（末项可能不足 itemsPerVirtual）。 */
  function sliceFor(index: number): { start: number; end: number } {
    const per = options.itemsPerVirtual ?? 1
    const start = index * per
    return { start, end: Math.min(start + per, options.count.value) }
  }

  // 行数据变化（搜索/筛选/切视图）后触发一次全量重新测量，校正行高与总高。
  watch(options.count, async () => {
    await nextTick()
    virtualizer.value.measure()
  })

  return { virtualizer, measureElementRef, sliceFor }
}
