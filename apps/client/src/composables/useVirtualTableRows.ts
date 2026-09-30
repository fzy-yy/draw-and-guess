import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'
import { useVirtualRows } from './useVirtualRows'

/** DataTable 的测量、占位与可靠滚动归零状态。 */
export function useVirtualTableRows<T>(
  rows: Ref<readonly T[]>,
  scrollContainer: Ref<HTMLElement | undefined>,
) {
  // 默认行高兜底估算：首帧实测校准（updateRowHeight）前的初始值，只影响首次渲染的
  // 虚拟窗口数量与占位高，挂载后即刻被真实行高替换。
  const measuredRowHeight = ref(28)
  const { virtualizer } = useVirtualRows({
    scrollElement: scrollContainer,
    count: computed(() => rows.value.length),
    estimateSize: measuredRowHeight,
  })
  let resetFrame: number | undefined
  let resizeObserver: ResizeObserver | undefined

  /**
   * 滚动到指定行（越界钳制）。刻意**不**对外暴露：当前唯一用途是下方
   * watch(rows) 的数据变化归零与 scrollToTop 复用；「搜索定位跳转」属未兑现的
   * 预留，对外滚动能力只有归零一项（DataTable / Vocab*TableView / ScrollableTable
   * 契约同此口径）。
   */
  function scrollToIndex(index: number): void {
    const safeIndex = Math.max(0, Math.min(index, Math.max(0, rows.value.length - 1)))
    // @tanstack Virtualizer 实例直连即可：scrollToIndex/scrollToOffset/measure
    // 都是其实例公开 API，无需类型断言中转。
    const instance = virtualizer.value
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
    // 对外只开放「滚动归零」；内部 scrollToIndex 不上架（理由见其函数注释）
    scrollToTop: () => scrollToIndex(0),
  }
}
