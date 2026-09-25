import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useVirtualRows } from './useVirtualRows'

/** DataTable 的测量、占位与可靠滚动归零状态。 */
export function useVirtualTableRows<T>(
  rows: Ref<readonly T[]>,
  scrollContainer: Ref<HTMLElement | undefined>,
) {
  const measuredRowHeight = ref(28)
  const { virtualizer } = useVirtualRows({
    scrollElement: scrollContainer,
    count: computed(() => rows.value.length),
    estimateSize: measuredRowHeight,
  })
  let resetFrame: number | undefined
  let resizeObserver: ResizeObserver | undefined

  function scrollToIndex(index: number): void {
    const safeIndex = Math.max(0, Math.min(index, Math.max(0, rows.value.length - 1)))
    const instance = virtualizer.value as unknown as {
      scrollToIndex(index: number, options?: { align: 'start' | 'center' | 'end' | 'auto' }): void
      scrollToOffset(offset: number): void
      measure(): void
    }
    if (safeIndex !== 0) {
      instance.scrollToIndex(safeIndex, { align: 'start' })
      return
    }
    // 归零：先按最新数据重测，再用官方滚动 API 一次性置顶。
    // 虚拟器可能在测量修正后回写滚动位置，因此下一帧仅在确实漂移时纠正一次
    // （替代旧的「微任务 + 多次 setTimeout 反复重置」写法）。
    instance.measure()
    instance.scrollToOffset(0)
    if (scrollContainer.value) scrollContainer.value.scrollTop = 0
    if (resetFrame !== undefined) window.cancelAnimationFrame(resetFrame)
    resetFrame = window.requestAnimationFrame(() => {
      resetFrame = undefined
      const container = scrollContainer.value
      if (!container || container.scrollTop === 0) return
      instance.scrollToOffset(0)
      container.scrollTop = 0
    })
  }

  function updateRowHeight(): void {
    const firstRow = scrollContainer.value?.querySelector(
      'tbody tr:not([aria-hidden])',
    ) as HTMLElement | null
    const height = firstRow?.getBoundingClientRect().height ?? 0
    if (height > 0 && Math.abs(height - measuredRowHeight.value) > 0.5) {
      measuredRowHeight.value = height
      virtualizer.value.measure()
    }
  }

  onMounted(() => {
    void nextTick(updateRowHeight)
    if (typeof ResizeObserver === 'undefined' || !scrollContainer.value) return
    resizeObserver = new ResizeObserver(updateRowHeight)
    resizeObserver.observe(scrollContainer.value)
  })
  onBeforeUnmount(() => {
    if (resetFrame !== undefined) window.cancelAnimationFrame(resetFrame)
    resizeObserver?.disconnect()
  })
  watch(rows, async () => {
    await nextTick()
    scrollToIndex(0)
  })

  const topSpacerHeight = computed(() => {
    const items = virtualizer.value.getVirtualItems()
    return items[0]?.start ?? 0
  })
  const bottomSpacerHeight = computed(() => {
    const items = virtualizer.value.getVirtualItems()
    const last = items.at(-1)
    if (!last) return 0
    return virtualizer.value.getTotalSize() - (last.start + last.size)
  })

  return {
    virtualizer,
    topSpacerHeight,
    bottomSpacerHeight,
    rowAt: (index: number) => rows.value[index],
    scrollToIndex,
    scrollToTop: () => scrollToIndex(0),
  }
}
