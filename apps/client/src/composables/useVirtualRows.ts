/**
 * 虚拟滚动行组合式逻辑（可复用）：统一封装 @tanstack/vue-virtual 的行级虚拟化。
 * 词库管理的表格视图（DataTable 经 useVirtualTableRows）是唯一消费方；虚拟化参数
 * 与「数据变化后重测」时机集中在此，避免估算与刷新逻辑散落到各渲染层（曾因视图
 * 切换后测量失效出现白屏）。
 * - 行高由调用方实测校准后写进 estimateSize（本模块不逐行 measureElement：
 *   表格行等高，单行实测一次即覆盖全部行，见 useVirtualTableRows.updateRowHeight）；
 * - 行数据数量变化后自动全量重新测量，校正总高与窗口区间。
 */
import { computed, nextTick, watch, type Ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'

/** 组合式入参：滚动容器引用、虚拟项总数、（已实测校准的）估算行高。 */
export function useVirtualRows(options: {
  /** 滚动容器元素引用（挂载前为 undefined，挂载后虚拟器自动接管）。 */
  scrollElement: Ref<HTMLElement | undefined>
  /** 虚拟项总数（响应式；为 0 时虚拟器不渲染任何项，空态由调用方自行展示）。 */
  count: Ref<number>
  /** 估算行高（px）；调用方实测校准后写回本 Ref 即驱动全部行。 */
  estimateSize: Ref<number>
}) {
  const virtualizer = useVirtualizer(
    computed(() => ({
      count: options.count.value,
      getScrollElement: () => options.scrollElement.value ?? null,
      estimateSize: () => options.estimateSize.value,
      overscan: 5,
    })),
  )

  // 行数据变化（搜索/筛选/切视图）后触发一次全量重新测量，校正行高与总高。
  watch(options.count, async () => {
    await nextTick()
    virtualizer.value.measure()
  })

  return { virtualizer }
}
