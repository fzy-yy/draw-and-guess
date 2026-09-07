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
  let resetTimer: number | undefined
  let resizeObserver: ResizeObserver | undefined

  function scrollToIndex(index: number): void {
    const safeIndex = Math.max(0, Math.min(index, Math.max(0, rows.value.length - 1)))
    const instance = virtualizer.value as unknown as {
      scrollToIndex(index: number, options?: { align: 'start' | 'center' | 'end' | 'auto' }): void
      scrollToOffset?: (offset: number) => void
    }
    if (safeIndex !== 0) {
      instance.scrollToIndex(safeIndex, { align: 'start' })
      return
    }
    const reset = (): void => {
      instance.scrollToOffset?.(0)
      if (scrollContainer.value) scrollContainer.value.scrollTop = 0
    }
    reset()
    instance.scrollToIndex(0, { align: 'start' })
    reset()
    Promise.resolve().then(reset)
    window.clearTimeout(resetTimer)
    resetTimer = window.setTimeout(reset, 0)
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
    window.clearTimeout(resetTimer)
    resizeObserver?.disconnect()
  })
  watch(rows, async () => {
    await nextTick()
    scrollToIndex(0)
  })

  const topSpacerHeight = computed(() => {
    const items = virtualizer.value.getVirtualItems()
    return items.length ? items[0]!.start : 0
  })
  const bottomSpacerHeight = computed(() => {
    const items = virtualizer.value.getVirtualItems()
    if (!items.length) return 0
    const last = items.at(-1)!
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
